import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import QQBotSettingsPanel from './QQBotSettingsPanel';

const mocks = vi.hoisted(() => ({ get: vi.fn(), save: vi.fn() }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@/api/qqbot', () => ({ getQQBotSettings: mocks.get, saveQQBotSettings: mocks.save }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: ReturnType<typeof createRoot>;
let host: HTMLDivElement;
beforeEach(() => {
  mocks.save.mockReset().mockResolvedValue({ restart_required: true, changed: ['sandbox'] });
  mocks.get.mockReset().mockResolvedValue({ configured: true, settings: {
    app_id_set: true, app_secret_set: true, sandbox: false, allow_from: '123',
    share_session_in_channel: false, markdown_support: false,
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

// #710 件 5: the official Bot had no edit entry at all; this panel is it.
it('never echoes the credentials and keeps the secret when it is left blank', async () => {
  await render(<QQBotSettingsPanel project="bot-role" />);
  expect(mocks.get).toHaveBeenCalledWith('bot-role');
  // no input carries app_id or app_secret values
  expect(host.querySelector<HTMLInputElement>('input[aria-label="fields.appId"]')).toBeNull();
  expect(host.querySelector<HTMLInputElement>('input[aria-label="fields.appSecret"]')?.value).toBe('');
  expect(host.textContent).toContain('qqbot.stored');

  const sandbox = host.querySelector<HTMLInputElement>('input[aria-label="fields.sandboxMode"]')!;
  await act(async () => sandbox.click());
  await click('common.save');
  // app_secret is absent, not "": only a typed secret is sent
  expect(mocks.save).toHaveBeenCalledWith('bot-role', {
    sandbox: true, share_session_in_channel: false, markdown_support: false,
  });
  expect(host.querySelector('[role="status"]')?.textContent).toBe('qq.savedRestart');
});

it('sends a typed secret and keeps the panel editable after a failed save', async () => {
  mocks.save.mockRejectedValueOnce(new Error('config.toml is read-only'));
  await render(<QQBotSettingsPanel project="bot-role" />);
  await fill('fields.appSecret', 'new-secret');
  await click('common.save');
  expect(host.querySelector('[role="alert"]')?.textContent).toBe('config.toml is read-only');
  expect(host.querySelector<HTMLInputElement>('input[aria-label="fields.appSecret"]')?.value).toBe('new-secret');
  await click('common.save');
  expect(mocks.save).toHaveBeenLastCalledWith('bot-role', expect.objectContaining({ app_secret: 'new-secret' }));
  // the field clears after a successful save: it is write-only
  expect(host.querySelector<HTMLInputElement>('input[aria-label="fields.appSecret"]')?.value).toBe('');
});

it('keeps allow_from read-only and re-reads on cc:refresh', async () => {
  await render(<QQBotSettingsPanel project="bot-role" />);
  expect(host.querySelector('input[aria-label="fields.allowFrom"]')).toBeNull();
  expect(host.textContent).toContain('qq.allowFromReadonly');
  expect(mocks.get).toHaveBeenCalledTimes(1);
  mocks.get.mockResolvedValueOnce({ configured: true, settings: {
    app_id_set: false, app_secret_set: false, sandbox: true, allow_from: '',
    share_session_in_channel: true, markdown_support: true,
  } });
  await act(async () => { window.dispatchEvent(new Event('cc:refresh')); });
  expect(mocks.get).toHaveBeenCalledTimes(2);
  expect(host.querySelector<HTMLInputElement>('input[aria-label="fields.sandboxMode"]')?.checked).toBe(true);
  expect(host.querySelector<HTMLInputElement>('input[aria-label="qqbot.markdown"]')?.checked).toBe(true);
  expect(host.textContent).toContain('qqbot.missing');
});