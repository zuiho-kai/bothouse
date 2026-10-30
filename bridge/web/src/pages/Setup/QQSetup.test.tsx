import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import QQSetup from './QQSetup';
import QQSettingsPanel from '../Projects/QQSettingsPanel';

const mocks = vi.hoisted(() => ({ add: vi.fn(), get: vi.fn(), save: vi.fn() }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@/api/projects', () => ({ addPlatformToProject: mocks.add }));
vi.mock('@/api/qq', () => ({ getQQSettings: mocks.get, saveQQSettings: mocks.save }));
vi.mock('@/api/status', () => ({ restartSystem: vi.fn() }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: ReturnType<typeof createRoot>;
let host: HTMLDivElement;
beforeEach(() => {
  mocks.add.mockReset().mockResolvedValue({ restart_required: true });
  mocks.save.mockReset().mockResolvedValue({ restart_required: true, changed: ['share_session_in_channel'] });
  mocks.get.mockReset().mockResolvedValue({ configured: true, capabilities: [], settings: {
    ws_url: 'ws://localhost:3001', http_url: '', token_set: true, allow_from: '123', share_session_in_channel: true,
  } });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); });
async function render(element: React.ReactNode) { await act(async () => root.render(<MemoryRouter>{element}</MemoryRouter>)); }
async function fill(label: string, value: string) {
  const input = host.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
  expect(input).toBeTruthy();
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function click(text: string) {
  const button = [...host.querySelectorAll('button')].find(b => b.textContent === text)!;
  expect(button).toBeTruthy(); await act(async () => button.click());
}
const clis = [{ agent_type: 'codex', label: 'Codex', binary: 'codex', path: '/test/codex', login: 'logged_in' as const, protocol: 'cli', supported: true }];

it('saves a new OneBot role through the existing platform API and reports restart, not connectivity', async () => {
  await render(<QQSetup clis={clis} projects={[]} onBack={() => {}} />);
  await fill('qq.projectID', 'qq-role');
  await fill('fields.wsUrl', 'ws://localhost:3001');
  await click('setup.addPlatform');
  expect(mocks.add).toHaveBeenCalledWith('qq-role', { type: 'qq', agent_type: 'codex', work_dir: '', options: { ws_url: 'ws://localhost:3001' } });
  expect(host.querySelector('[role="status"]')?.textContent).toBe('qq.savedRestart');
});

it('keeps official QQ credentials on the official route and blocks reused IDs', async () => {
  await render(<QQSetup clis={clis} projects={['existing']} onBack={() => {}} />);
  await fill('qq.projectID', 'existing');
  expect(host.querySelector('[role="alert"]')?.textContent).toBe('qq.invalidProject');
  expect([...host.querySelectorAll('button')].some(b => b.textContent === 'setup.addPlatform')).toBe(false);
  await fill('qq.projectID', 'official');
  const select = host.querySelector<HTMLSelectElement>('[aria-label="qq.route"]')!;
  await act(async () => { select.value = 'qqbot'; select.dispatchEvent(new Event('change', { bubbles: true })); });
  await fill('fields.appId', 'app-example'); await fill('fields.appSecret', 'test-secret');
  expect(host.querySelector<HTMLInputElement>('[aria-label="fields.appSecret"]')?.type).toBe('password');
  await click('setup.addPlatform');
  expect(mocks.add).toHaveBeenCalledWith('official', expect.objectContaining({ type: 'qqbot', options: { app_id: 'app-example', app_secret: 'test-secret' } }));
});

it('preserves the saved token and sends an explicit false when disabling shared sessions', async () => {
  await render(<QQSettingsPanel project="qq-role" />);
  expect(mocks.get).toHaveBeenCalledWith('qq-role');
  const toggle = [...host.querySelectorAll('label')].find(l => l.textContent === 'fields.sharedGroupSession')!.querySelector('input')!;
  await act(async () => toggle.click());
  await click('common.save');
  expect(mocks.save).toHaveBeenCalledWith('qq-role', { ws_url: 'ws://localhost:3001', http_url: '', share_session_in_channel: false });
  expect(host.querySelector('[role="status"]')?.textContent).toBe('qq.savedRestart');
});

it('keeps edits on save failure and clears a stored token only when explicitly selected', async () => {
  mocks.save.mockRejectedValueOnce(new Error('disk full'));
  await render(<QQSettingsPanel project="qq-role" />);
  await fill('fields.wsUrl', 'ws://localhost:3002');
  const clear = [...host.querySelectorAll('label')].find(l => l.textContent === 'qq.clearToken')!.querySelector('input')!;
  await act(async () => clear.click());
  await click('common.save');
  expect(host.querySelector('[role="alert"]')?.textContent).toBe('disk full');
  expect(host.querySelector('[role="status"]')).toBeNull();
  expect(host.querySelector<HTMLInputElement>('[aria-label="fields.wsUrl"]')?.value).toBe('ws://localhost:3002');
  await click('common.save');
  expect(mocks.save).toHaveBeenLastCalledWith('qq-role', expect.objectContaining({ token: '', ws_url: 'ws://localhost:3002' }));
  expect(host.querySelector('[role="alert"]')).toBeNull();
});
