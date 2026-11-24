import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import en from '@/i18n/locales/en.json';
import PlatformManualForm from '@/pages/Projects/PlatformManualForm';
import CloudWebConnections from './CloudWebConnections';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => key.split('.').reduce<any>((node, part) => node?.[part], en) ?? fallback ?? key,
  }),
}));

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: ReturnType<typeof createRoot> | undefined;
let container: HTMLDivElement | undefined;

afterEach(async () => {
  await act(async () => root?.unmount());
  container?.remove();
  vi.unstubAllGlobals();
});

it('creates, applies, edits, and removes a connection without putting its token in the project form', async () => {
  const ok = (data: unknown) => Response.json({ ok: true, data });
  const service = vi.fn<(url: string, options: RequestInit) => Promise<Response>>();
  const saved = { id: 'fixture-id', name: 'Work Hub', url: 'https://work.test' };
  service.mockResolvedValueOnce(ok({ connections: [] }));
  service.mockResolvedValueOnce(ok(saved));
  service.mockResolvedValueOnce(ok({ connections: [saved] }));
  service.mockResolvedValueOnce(ok({ restart_required: true }));
  service.mockResolvedValueOnce(ok({ ...saved, name: 'Team Hub' }));
  service.mockResolvedValueOnce(ok({ id: saved.id }));
  vi.stubGlobal('fetch', service);

  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  const applied = vi.fn();
  await act(async () => root?.render(<MemoryRouter><CloudWebConnections /><div id="project-form" /></MemoryRouter>));

  const click = async (text: string, scope: ParentNode = document) => {
    const button = [...scope.querySelectorAll('button')].find(b => b.textContent?.trim() === text);
    expect(button).toBeDefined();
    await act(async () => button?.click());
  };
  const fill = async (label: string, value: string, scope = '[role="dialog"]') => {
    const input = document.querySelector<HTMLInputElement>(`${scope} input[aria-label="${label}"]`)!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  };

  await click('Add connection');
  await fill('Connection name', saved.name);
  await fill('Server URL', saved.url);
  await fill('Bot Token', 'fixture-token');
  await click('Save');
  expect(container.textContent).toContain(saved.name);

  await act(async () => root?.render(<MemoryRouter><CloudWebConnections /><div id="project-form">
    <PlatformManualForm platformType="cloud_web" projectName="relay" onComplete={applied} onCancel={() => {}} />
  </div></MemoryRouter>));
  const picker = container.querySelector<HTMLSelectElement>('#project-form select')!;
  await act(async () => {
    picker.value = saved.id;
    picker.dispatchEvent(new Event('change', { bubbles: true }));
  });
  const projectForm = container.querySelector('#project-form')!;
  await click('Advanced options (4)', projectForm);
  await fill('WebSocket URL', 'wss://work.test/custom', '#project-form');
  await fill('Allowed users', 'owner', '#project-form');
  const sharedSession = projectForm.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
  expect(sharedSession.checked).toBe(true);
  await act(async () => sharedSession.click());
  await click('Add platform', projectForm);
  expect(applied).toHaveBeenCalledOnce();
  expect(service).toHaveBeenLastCalledWith('/api/v1/projects/relay/add-platform', expect.objectContaining({
    body: JSON.stringify({
      type: 'cloud_web', connection_id: saved.id,
      options: { ws_url: 'wss://work.test/custom', allow_from: 'owner', share_session_in_channel: false },
    }),
  }));

  await click('Edit connection');
  expect(document.querySelector<HTMLInputElement>('[role="dialog"] input[type="password"]')?.value).toBe('');
  await fill('Connection name', 'Team Hub');
  await click('Save');
  expect(container.textContent).toContain('Team Hub');
  await click('Remove');
  await click('Remove', document.querySelector('[role="dialog"]')!);
  expect(container.textContent).toContain('No Cloud Web connections saved');
});
