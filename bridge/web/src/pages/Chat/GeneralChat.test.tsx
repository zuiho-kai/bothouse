import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import api from '@/api/client';
import type { GeneralMessage } from '@/api/general';
import GeneralChat from './GeneralChat';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }) }));

class MessageStream {
  static current: MessageStream | undefined;
  static CLOSED = 2;
  readyState = 1;
  onopen?: () => void;
  onerror?: () => void;
  onmessage?: (event: MessageEvent) => void;
  close = vi.fn();

  constructor(public url: string) { MessageStream.current = this; }

  emit(message: GeneralMessage) {
    this.onmessage?.(new MessageEvent('message', { data: JSON.stringify(message) }));
  }
}

function message(id: string, text: string): GeneralMessage {
  return { id, kind: 'agent', author_id: 'review', author: 'Reviewer', text, created_at: '2026-11-23T00:00:00Z' };
}

function success(data: unknown) { return Response.json({ ok: true, data }); }

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('EventSource', MessageStream);
  api.setToken('local & token');
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  MessageStream.current = undefined;
  api.setToken('');
  vi.unstubAllGlobals();
});

async function renderRoom() {
  await act(async () => root.render(<MemoryRouter><GeneralChat /></MemoryRouter>));
}

function typeDraft(text: string) {
  const input = container.querySelector('textarea')!;
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, text);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

it('starts after fetched history and keeps ordered, unique messages across POST and stream', async () => {
  const sent = { ...message('11', '@review Please take a look'), kind: 'user' as const, author: 'Web Admin', author_id: 'web-admin' };
  const fetch = vi.fn(async (url: string, request: RequestInit) => {
    if (url.endsWith('/members')) return success({ members: [{ project: 'review', display_name: 'Reviewer' }] });
    if (request.method === 'POST') return success(sent);
    return success({ messages: [message('9', 'Already saved')] });
  });
  vi.stubGlobal('fetch', fetch);
  await renderRoom();

  const stream = MessageStream.current!;
  const { pathname, searchParams } = new URL(stream.url, location.origin);
  expect(pathname).toBe('/api/v1/general/events');
  expect(searchParams.get('after')).toBe('9');
  expect(searchParams.get('token')).toBe('local & token');
  await act(async () => stream.onopen?.());
  await act(async () => typeDraft('Please take a look'));
  const member = Array.from(container.querySelectorAll('button')).find((button) => button.textContent?.includes('@review'))!;
  await act(async () => member.click());
  expect(container.querySelector('textarea')?.value).toBe(sent.text);
  await act(async () => container.querySelector<HTMLButtonElement>('button[type="submit"]')!.click());
  expect(fetch).toHaveBeenCalledWith('/api/v1/general/messages', expect.objectContaining({ method: 'POST', body: JSON.stringify({ text: sent.text }) }));
  expect(container.querySelector('textarea')?.value).toBe('');

  await act(async () => {
    stream.onerror?.();
    stream.emit(message('10', 'Saved before the stream opened'));
    stream.emit(sent);
  });
  const rows = Array.from(container.querySelectorAll('[role="log"] ol > li')).map((row) => row.textContent);
  expect(rows).toEqual([expect.stringContaining('Already saved'), expect.stringContaining('Saved before the stream opened'), expect.stringContaining(sent.text)]);
  expect(container.querySelector('[role="status"]')?.textContent).toBe('general.status.reconnecting');
  await act(async () => stream.onopen?.());
  expect(container.querySelector('[role="status"]')?.textContent).toBe('general.status.live');
  await act(async () => root.render(null));
  expect(stream.close).toHaveBeenCalledOnce();
});

it('keeps an unsent draft and reports a failed POST', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string, request: RequestInit) => {
    if (url.endsWith('/members')) return success({ members: [] });
    if (request.method === 'POST') return Response.json({ ok: false, error: 'disk error' }, { status: 500 });
    return success({ messages: [] });
  }));
  await renderRoom();
  await act(async () => typeDraft('Keep this draft'));
  await act(async () => container.querySelector<HTMLButtonElement>('button[type="submit"]')!.click());
  expect(container.querySelector('textarea')?.value).toBe('Keep this draft');
  expect(container.querySelector('[role="alert"]')?.textContent).toBe('general.sendError');
  expect(container.querySelector('[role="log"] ol')?.children.length).toBe(0);
});

it('shows how to enable the room when the management API returns 404', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ ok: false }, { status: 404 })));
  await renderRoom();
  expect(container.textContent).toContain('general.enableHint');
  expect(container.querySelector('textarea')).toBeNull();
  expect(MessageStream.current).toBeUndefined();
});

it('joins an existing project to General and waits for an explicit restart', async () => {
  let restarted = false;
  const fetch = vi.fn(async (url: string, request: RequestInit) => {
    if (url.endsWith('/projects')) return success({ projects: [
      { name: 'load test', agent_type: 'codex', platforms: ['discord'] },
      { name: 'member', agent_type: 'codex', platforms: ['general'] },
    ] });
    if (url.endsWith('/add-platform') && request.method === 'POST') return success({ restart_required: true });
    if (url.endsWith('/restart') && request.method === 'POST') {
      restarted = true;
      return success({});
    }
    if (restarted && url.endsWith('/members')) return success({ members: [{ project: 'load test', display_name: 'Load test' }] });
    if (restarted && url.endsWith('/messages')) return success({ messages: [] });
    return Response.json({ ok: false }, { status: 404 });
  });
  vi.stubGlobal('fetch', fetch);
  vi.stubGlobal('confirm', vi.fn(() => true));
  await renderRoom();

  const addProject = container.querySelector<HTMLButtonElement>('button[aria-haspopup="dialog"]');
  expect(addProject).not.toBeNull();
  await act(async () => addProject!.click());
  const dialog = document.querySelector('[role="dialog"]')!;
  const select = dialog.querySelector('select')!;
  expect(Array.from(select.options).map((option) => option.value)).toEqual(['', 'load test']);
  await act(async () => {
    select.value = 'load test';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await act(async () => dialog.querySelector<HTMLButtonElement>('button[type="submit"]')!.click());
  expect(fetch).toHaveBeenCalledWith('/api/v1/projects/load%20test/add-platform', expect.objectContaining({
    method: 'POST', body: JSON.stringify({ type: 'general', options: {} }),
  }));
  expect(fetch.mock.calls.some(([url]) => url.endsWith('/restart'))).toBe(false);
  expect(container.textContent).toContain('general.projectSaved');

  const restart = Array.from(container.querySelectorAll('button')).find((button) => button.textContent === 'setup.restartNow')!;
  await act(async () => restart.click());
  const reload = Array.from(container.querySelectorAll('button')).find((button) => button.textContent === 'general.reloadRoom')!;
  await act(async () => reload.click());
  expect(container.textContent).toContain('@load test');
  expect(container.textContent).not.toContain('general.projectSaved');
});
