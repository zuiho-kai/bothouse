import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import PluginList from './PluginList';
import type { DSHPluginsState, PluginInspection } from '@/api/plugins';

/**
 * 插件安装的来源二次确认 (#150): the non-registry acknowledgement is part of the install request.
 *
 * The backend refuses a git/tarball/path spec without `confirm_source` regardless of the config
 * switch (core/management_plugins.go handlePluginsInstall). These pin the page side of that
 * contract: the literal is only sent when the box is ticked, and a registry install sends nothing.
 */

const state: DSHPluginsState = {
  profile: 'web',
  profile_dir: '/home/u/.dsh/profiles/web',
  plugins: [],
  can_install: true,
  writes_allowed: true,
  allow_non_registry: true,
  registry: 'https://registry.npmjs.org',
};

const gitInspection: PluginInspection = {
  spec: 'git+https://host/x',
  name: 'git+https://host/x',
  kind: 'git',
  bundle: true,
  required: '插件和面板、agent 在同一个进程里跑',
  allowed: true,
};

const registryInspection: PluginInspection = {
  ...gitInspection,
  spec: 'demo-bundle',
  name: 'demo-bundle',
  kind: 'registry',
  registry: 'https://registry.npmjs.org',
};

const inspectPlugin = vi.fn(async (_spec: string) => gitInspection);
const installPlugin = vi.fn(async (_spec: string, _confirm: string, _onEvent: (e: unknown) => void) => state);

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string, f?: string) => f ?? k, i18n: { language: 'zh', changeLanguage: vi.fn() } }),
}));
vi.mock('@/api/plugins', async (orig) => {
  const real = await orig<typeof import('@/api/plugins')>();
  return {
    ...real,
    listPlugins: async () => state,
    inspectPlugin: (spec: string) => inspectPlugin(spec),
    installPlugin: (spec: string, confirm: string, onEvent: (e: unknown) => void) => installPlugin(spec, confirm, onEvent),
    getPluginConfig: vi.fn(),
    savePluginConfig: vi.fn(),
    switchPlugin: vi.fn(),
  };
});

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: ReturnType<typeof createRoot> | undefined;
let container: HTMLDivElement;

beforeEach(() => {
  inspectPlugin.mockClear();
  installPlugin.mockClear();
  inspectPlugin.mockImplementation(async () => gitInspection);
});
afterEach(() => { act(() => root?.unmount()); container?.remove(); });

const render = async () => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(<MemoryRouter><PluginList /></MemoryRouter>);
  });
};

const byTestId = (id: string) => container.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;

const typeSpec = async (value: string) => {
  const input = byTestId('plugins-install-spec') as HTMLInputElement;
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
};

const inspect = async () => {
  await act(async () => { byTestId('plugins-inspect-go')!.click(); });
};

describe('插件安装的来源确认', () => {
  it('sends the literal only after the box is ticked', async () => {
    await render();
    await typeSpec('git+https://host/x');
    await inspect();
    const go = byTestId('plugins-install-go') as HTMLButtonElement;
    expect(go.disabled).toBe(true); // nothing installs before the acknowledgement
    await act(async () => { (byTestId('plugins-inspect-nonregistry-ack') as HTMLInputElement).click(); });
    expect(go.disabled).toBe(false);
    await act(async () => { go.click(); });
    expect(installPlugin).toHaveBeenCalledTimes(1);
    const [spec, confirm] = installPlugin.mock.calls[0];
    expect(spec).toBe('git+https://host/x');
    expect(confirm).toBe('non-registry');
  });

  it('sends no confirmation for a registry package', async () => {
    inspectPlugin.mockImplementation(async () => registryInspection);
    await render();
    await typeSpec('demo-bundle');
    await inspect();
    expect(byTestId('plugins-inspect-nonregistry')).toBeNull();
    await act(async () => { byTestId('plugins-install-go')!.click(); });
    expect(installPlugin).toHaveBeenCalledTimes(1);
    const [spec, confirm] = installPlugin.mock.calls[0];
    expect(spec).toBe('demo-bundle');
    expect(confirm).toBe('');
  });

  it('shows the backend refusal that names the missing confirmation', async () => {
    installPlugin.mockRejectedValueOnce(new Error('其它来源需要先在这个页面上显式确认：勾选「我知道这个地址是什么，继续」后再装。'));
    await render();
    await typeSpec('git+https://host/x');
    await inspect();
    await act(async () => { (byTestId('plugins-inspect-nonregistry-ack') as HTMLInputElement).click(); });
    await act(async () => { byTestId('plugins-install-go')!.click(); });
    expect(byTestId('plugins-install-error')?.textContent).toContain('显式确认');
  });
});