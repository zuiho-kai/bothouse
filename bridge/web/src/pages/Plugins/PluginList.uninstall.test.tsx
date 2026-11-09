import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import PluginList from './PluginList';
import { ApiError } from '@/api/client';
import type { DSHPluginsState } from '@/api/plugins';

/**
 * 插件卸载 (#1377): the page side of POST /plugins/uninstall.
 *
 * What these pin: the button appears only where the backend would accept a removal (a layer this
 * profile installed, not a shipped surface and not a name with no switch), the confirm button stays
 * locked until the package name is typed, a refusal is shown as its own sentence rather than
 * pnpm's English, and a success marks the row in place instead of reloading the page.
 */

const removable: DSHPluginsState = {
  profile: 'web',
  profile_dir: '/home/u/.dsh/profiles/web',
  plugins: [
    {
      name: 'demo-bundle', version: '0.4.2', layer: true, client_only: false, enabled: true, shipped: false,
      rows: [{ id: 'demo-tool', name: 'demo-tool', disabled: false }],
    },
    {
      name: '@deepseek-ai/dsh-web-app', version: '0.2.1', layer: true, client_only: false, enabled: true, shipped: true,
      rows: [{ id: 'system-prompt', name: 'system-prompt', disabled: false }],
    },
    {
      name: '@deepseek-ai/dsh-experimental-client-ui-discord', version: '0.2.1-rc.2',
      layer: false, client_only: true, enabled: false, shipped: false,
    },
  ],
  can_install: true,
  writes_allowed: true,
  allow_non_registry: false,
  registry: 'https://registry.npmjs.org',
};

// The real endpoint answers with the state *after* the removal, so the package is gone from it;
// the page still has to show the row, marked, where it was.
const afterRemoval: DSHPluginsState = {
  ...removable,
  plugins: removable.plugins.filter((p) => p.name !== 'demo-bundle'),
};
const uninstallPlugin = vi.fn(async (_name: string, _confirm: string) => ({
  uninstalled: true, restart_required: true, state: afterRemoval,
}));

vi.mock('react-i18next', async () => {
  const zh = (await import('@/i18n/locales/zh.json')).default as { [k: string]: unknown };
  const lookup = (key: string) =>
    key.split('.').reduce<unknown>((node, part) => (node as Record<string, unknown>)?.[part], zh);
  return {
    useTranslation: () => ({
      t: (k: string, f?: string) => (typeof lookup(k) === 'string' ? (lookup(k) as string) : f ?? k),
      i18n: { language: 'zh', changeLanguage: vi.fn() },
    }),
  };
});
vi.mock('@/api/plugins', async (orig) => {
  const real = await orig<typeof import('@/api/plugins')>();
  return {
    ...real,
    listPlugins: async () => removable,
    uninstallPlugin: (name: string, confirm: string) => uninstallPlugin(name, confirm),
    inspectPlugin: vi.fn(),
    installPlugin: vi.fn(),
    getPluginConfig: vi.fn(),
    savePluginConfig: vi.fn(),
    switchPlugin: vi.fn(),
  };
});

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: ReturnType<typeof createRoot> | undefined;
let container: HTMLDivElement;

beforeEach(() => { uninstallPlugin.mockClear(); });
afterEach(() => { act(() => root?.unmount()); container?.remove(); });

const render = async () => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(<MemoryRouter><PluginList /></MemoryRouter>);
  });
};

// The confirm dialog renders through a portal into document.body, so look there rather than in
// the page container.
const byTestId = (id: string) => document.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;

const openDialog = async (name = 'demo-bundle') => {
  await act(async () => { byTestId(`plugin-${name}-uninstall`)!.click(); });
};

const typeConfirm = async (value: string) => {
  const input = byTestId('plugins-uninstall-confirm-input') as HTMLInputElement;
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
};

describe('插件卸载', () => {
  it('offers 卸载 on a package this profile installed, but not on a shipped layer', async () => {
    await render();
    expect(byTestId('plugin-demo-bundle-uninstall')).not.toBeNull();
    // A shipped surface removes the panel itself, so the button is not offered (#1377 §二.1).
    expect(byTestId('plugin-@deepseek-ai/dsh-web-app-uninstall')).toBeNull();
    // A client UI package has no switch, but it is this profile's dependency: a wrong install of it
    // is exactly what the button is for.
    expect(byTestId('plugin-@deepseek-ai/dsh-experimental-client-ui-discord-uninstall')).not.toBeNull();
  });

  it('keeps the confirm button locked until the package name is typed', async () => {
    await render();
    await openDialog();
    const go = byTestId('plugins-uninstall-go') as HTMLButtonElement;
    expect(go.disabled).toBe(true);
    await typeConfirm('demo');
    expect(go.disabled).toBe(true);
    await typeConfirm('demo-bundle');
    expect(go.disabled).toBe(false);
  });

  it('sends the name and its confirmation, then marks the row in place', async () => {
    await render();
    await openDialog();
    await typeConfirm('demo-bundle');
    await act(async () => { byTestId('plugins-uninstall-go')!.click(); });
    expect(uninstallPlugin).toHaveBeenCalledWith('demo-bundle', 'demo-bundle');
    // The dialog closes and the row says so where it stands; nothing reloads the list.
    expect(byTestId('plugins-uninstall-dialog')).toBeNull();
    // The row stays where it was, marked, even though the server's list no longer has it.
    expect(byTestId('plugin-demo-bundle')).not.toBeNull();
    expect(byTestId('plugin-demo-bundle-uninstalled')?.textContent).toContain('重启 DSH');
    expect(byTestId('plugin-@deepseek-ai/dsh-web-app')).not.toBeNull();
    expect(byTestId('plugin-demo-bundle-toggle')).toBeNull();
  });

  it('names the package that still needs it instead of showing pnpm output', async () => {
    uninstallPlugin.mockRejectedValueOnce(new ApiError(
      'dependent-bundle 还在用它，先卸载 dependent-bundle。', 409,
      { error: 'dependent-bundle 还在用它，先卸载 dependent-bundle。', kind: 'in-use', in_use_by: ['dependent-bundle'] },
    ));
    await render();
    await openDialog();
    await typeConfirm('demo-bundle');
    await act(async () => { byTestId('plugins-uninstall-go')!.click(); });
    const error = byTestId('plugins-uninstall-error')?.textContent || '';
    expect(error).toContain('dependent-bundle');
    expect(error).toContain('先卸载');
    // The dialog stays open so the person can cancel or fix it.
    expect(byTestId('plugins-uninstall-dialog')).not.toBeNull();
    // Nothing was marked removed.
    expect(byTestId('plugin-demo-bundle-uninstalled')).toBeNull();
  });

  it('shows the shared sentence for a layer that ships with DSH', async () => {
    uninstallPlugin.mockRejectedValueOnce(new ApiError(
      '这一层随 DSH 一起安装，不能在这里卸载。', 403,
      { error: '这一层随 DSH 一起安装，不能在这里卸载。', kind: 'not-removable' },
    ));
    await render();
    await openDialog();
    await typeConfirm('demo-bundle');
    await act(async () => { byTestId('plugins-uninstall-go')!.click(); });
    expect(byTestId('plugins-uninstall-error')?.textContent).toContain('随 DSH 一起安装');
  });
});