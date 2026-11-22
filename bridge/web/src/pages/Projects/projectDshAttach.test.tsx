import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import ProjectDetail from '@/pages/Projects/ProjectDetail';
import en from '@/i18n/locales/en.json';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => key.split('.').reduce<any>((node, part) => node?.[part], en) ?? fallback ?? key,
    i18n: { language: 'en' },
  }),
}));
vi.mock('@/api/projects', () => ({
  getProject: async () => ({ name: 'relay bot', agent_type: 'codex', platforms: [{ type: 'discord', connected: true }], sessions_count: 0 }),
  listAgentTypes: async () => ({ agents: ['codex'], platforms: ['discord'] }),
  shownName: (project: { name: string }) => project.name,
}));
vi.mock('@/api/providers', () => ({ listProviders: async () => ({ providers: [] }), listGlobalProviders: async () => ({ providers: [] }) }));
vi.mock('@/api/heartbeat', () => ({ getHeartbeat: async () => null }));

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: ReturnType<typeof createRoot>;
let container: HTMLDivElement;
const fetchRequest = vi.fn<(url: string, init: RequestInit) => Promise<Response>>();

beforeEach(() => {
  fetchRequest.mockReset();
  vi.stubGlobal('fetch', fetchRequest);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

const ok = (data: unknown) => Response.json({ ok: true, data });
const button = (text: string) => {
  const match = [...document.querySelectorAll('button')].find(element => element.textContent?.includes(text));
  expect(match).toBeDefined();
  return match!;
};
const click = async (text: string) => { await act(async () => button(text).click()); };
const picker = () => document.querySelector<HTMLSelectElement>('[role="dialog"] select')!;
const pick = async (id: string) => {
  await act(async () => {
    picker().value = id;
    picker().dispatchEvent(new Event('change', { bubbles: true }));
  });
};
const open = async () => {
  await act(async () => root.render(<MemoryRouter initialEntries={['/projects/relay%20bot']}><Routes>
    <Route path="/projects/:name" element={<ProjectDetail />} />
  </Routes></MemoryRouter>));
  await click('Add platform');
  expect(button('Cloud Web (自建 IM)')).toBeDefined();
  await click('DSH (local)');
};

it('defaults to general, attaches the chosen room to this project, and prompts for restart', async () => {
  fetchRequest.mockResolvedValueOnce(ok({ rooms: [{ name: 'work', id: 2 }, { name: 'general', id: 1 }] }));
  fetchRequest.mockResolvedValueOnce(ok({ restart_required: true }));
  await open();
  expect(picker().value).toBe('1');
  expect(fetchRequest).toHaveBeenCalledWith('/api/v1/dsh/channels', expect.objectContaining({ method: 'GET' }));
  await pick('2');
  await click('Connect');
  expect(fetchRequest).toHaveBeenLastCalledWith('/api/v1/dsh/projects/relay%20bot', expect.objectContaining({ method: 'POST', body: '{"room_id":2}' }));
  expect(document.querySelector('[aria-label="Restart required"]')).not.toBeNull();
  expect(container.textContent).toContain('discord');
});

it('asks the user to choose when general is missing and still shows a failed save', async () => {
  fetchRequest.mockResolvedValueOnce(ok({ rooms: [{ name: 'work', id: 2 }] }));
  fetchRequest.mockResolvedValueOnce(Response.json({ ok: false, error: 'Choose another DSH channel.' }, { status: 400 }));
  await open();
  expect(picker().value).toBe('');
  expect(button('Connect').disabled).toBe(true);
  await pick('2');
  await click('Connect');
  expect(document.querySelector('[role="alert"]')?.textContent).toBe('Choose another DSH channel.');
  expect(picker().value).toBe('2');
  expect(document.querySelector('[aria-label="Restart required"]')).toBeNull();
});

it('offers retry for an older backend and for an empty room list', async () => {
  fetchRequest.mockResolvedValueOnce(new Response('404 page not found', { status: 404 }));
  fetchRequest.mockResolvedValueOnce(ok({ rooms: [] }));
  fetchRequest.mockResolvedValueOnce(ok({ rooms: [{ name: 'general', id: 1 }] }));
  await open();
  expect(document.querySelector('[role="alert"]')?.textContent).toContain('unavailable in this bothouse build');
  await click('Retry');
  expect(document.querySelector('[role="status"]')?.textContent).toContain('No group channels');
  await click('Retry');
  expect(picker().value).toBe('1');
});
