import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import PluginList from './PluginList';
import type { DSHPluginsState, PluginConfig } from '@/api/plugins';

/**
 * 插件配置 (#150 ②a): the row's own config is editable in the panel.
 *
 * What these pin: the editor is offered per row (not for a shipped surface layer, not without the
 * write token), it shows the value that is in effect with the layer it came from, a save sends the
 * text back unchanged, and a refusal from the API is shown instead of being swallowed.
 */

const state: DSHPluginsState = {
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
      // #1376: dsh.client without dsh.bundle — the Discord shell the install script adds.
      name: '@deepseek-ai/dsh-experimental-client-ui-discord', version: '0.2.1-rc.2',
      layer: false, client_only: true, enabled: false, shipped: false,
    },
    {
      // A plain runtime dependency: neither block, so it stays "not a plugin".
      name: 'is-odd', version: '3.0.1', layer: false, client_only: false, enabled: false, shipped: false,
    },
  ],
  can_install: true,
  writes_allowed: true,
  allow_non_registry: false,
  registry: 'https://registry.npmjs.org',
};

const bundleConfig: PluginConfig = {
  id: 'demo-tool', name: 'demo-tool', layer: 'bundle', editable: true, overridden: false,
  config_yaml: "dataDir: !!js process.env.DEMO_DATA || (process.env.HOME + '/.demo')",
};

const getPluginConfig = vi.fn(async (_id: string) => bundleConfig);
const savePluginConfig = vi.fn(async (_id: string, _text: string) => ({
  changed: true, restart_required: true,
  config: { ...bundleConfig, layer: 'profile' as const, overridden: true, config_yaml: 'dataDir: /tmp/x' },
}));

vi.mock('react-i18next', async () => {
  // Same as the browser: the page reads the real locale file, so a missing key would show the key
  // name itself instead of being covered up by a default in the test (#1376).
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
vi.mock('@/api/plugins', () => ({
  listPlugins: async () => state,
  getPluginConfig: (id: string) => getPluginConfig(id),
  savePluginConfig: (id: string, text: string) => savePluginConfig(id, text),
  inspectPlugin: vi.fn(),
  installPlugin: vi.fn(),
  switchPlugin: vi.fn(),
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: ReturnType<typeof createRoot> | undefined;
let container: HTMLDivElement;

beforeEach(() => { getPluginConfig.mockClear(); savePluginConfig.mockClear(); });
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

const openRow = async () => {
  const toggle = byTestId('plugin-demo-bundle-row-demo-tool-config');
  expect(toggle).not.toBeNull();
  await act(async () => { toggle!.click(); });
};

describe('插件配置', () => {
  it('blocks row switching while its configuration is loading', async () => {
    let finish!: (value: PluginConfig) => void;
    getPluginConfig.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    await render();
    await openRow();
    const button = byTestId('plugin-demo-bundle-row-demo-tool-config') as HTMLButtonElement;
    const disabledWhileLoading = button.disabled;
    const textReadOnly = (byTestId('plugins-config-text') as HTMLTextAreaElement).readOnly;
    await act(async () => { finish(bundleConfig); });
    expect(disabledWhileLoading).toBe(true);
    expect(textReadOnly).toBe(true);
    expect(button.disabled).toBe(false);
  });

  it('offers the editor on a plugin row but not on a shipped surface layer', async () => {
    await render();
    expect(byTestId('plugin-demo-bundle-row-demo-tool-config')).not.toBeNull();
    expect(byTestId('plugin-@deepseek-ai/dsh-web-app-row-system-prompt-config')).toBeNull();
  });

  it('shows the value in effect and where it came from', async () => {
    await render();
    await openRow();
    expect(getPluginConfig).toHaveBeenCalledWith('demo-tool');
    const text = byTestId('plugins-config-text') as HTMLTextAreaElement;
    // The `!!js` expression must be in the box verbatim: a person editing it needs to see it.
    expect(text.value).toContain('!!js process.env.DEMO_DATA');
    expect(byTestId('plugins-config-layer')?.textContent).toContain('插件自带');
  });

  it('sends the edited text back unchanged and says a restart is needed', async () => {
    await render();
    await openRow();
    const text = byTestId('plugins-config-text') as HTMLTextAreaElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
      setter.call(text, 'dataDir: /tmp/x\n');
      text.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => { byTestId('plugins-config-save')!.click(); });
    expect(savePluginConfig).toHaveBeenCalledWith('demo-tool', 'dataDir: /tmp/x\n');
    expect(byTestId('plugins-config-saved')?.textContent).toContain('重启');
    expect(byTestId('plugins-config-layer')?.textContent).toContain('这份 profile');
  });

  it('shows a refusal instead of pretending the save worked', async () => {
    savePluginConfig.mockRejectedValueOnce(new Error('这段配置不是合法的 YAML：bad'));
    await render();
    await openRow();
    await act(async () => { byTestId('plugins-config-save')!.click(); });
    expect(byTestId('plugins-config-error')?.textContent).toContain('不是合法的 YAML');
    expect(byTestId('plugins-config-saved')).toBeNull();
  });

  it('keeps the editor and secret placeholders usable on a disabled plugin', async () => {
    const plugin = state.plugins[0];
    const row = plugin.rows![0];
    plugin.enabled = false;
    row.disabled = true;
    const config = { ...bundleConfig, config_yaml: 'token: !bothouse/secret /token\n' };
    getPluginConfig.mockResolvedValueOnce(config);
    try {
      await render();
      await openRow();
      expect((byTestId('plugins-config-text') as HTMLTextAreaElement).value).toBe(config.config_yaml);
      expect(container.textContent).toContain('已设置');
      await act(async () => { byTestId('plugins-config-save')!.click(); });
      expect(savePluginConfig).toHaveBeenCalledWith('demo-tool', config.config_yaml);
      expect(plugin.enabled).toBe(false);
      expect(row.disabled).toBe(true);
    } finally {
      plugin.enabled = true;
      row.disabled = false;
    }
  });

  it('does not offer the editor when the API has no token to write with', async () => {
    state.writes_allowed = false;
    await render();
    expect(byTestId('plugin-demo-bundle-row-demo-tool-config')).toBeNull();
    state.writes_allowed = true;
  });
});

describe('插件种类 (#1376)', () => {
  it('labels a bundle, a client UI package and a plain dependency apart', async () => {
    await render();
    // The badge is the only chip in the row (version is a plain span, hence the ring class).
    const badge = (id: string) => byTestId(`plugin-${id}`)!.querySelector('span.ring-1')!.textContent;
    const clientUi = badge('@deepseek-ai/dsh-experimental-client-ui-discord');
    const plain = badge('is-odd');
    expect(badge('demo-bundle')).toBe('已启用');
    expect(clientUi).toBe('客户端 UI 包');
    expect(plain).toBe('不是插件包');
    expect(new Set([badge('demo-bundle'), clientUi, plain]).size).toBe(3);
  });

  it('says a client UI package comes from DSH with no switch, and offers no switch', async () => {
    await render();
    const note = byTestId('plugin-@deepseek-ai/dsh-experimental-client-ui-discord-client-note');
    expect(note?.textContent).toBe('由 DSH 提供，面板不能开关。');
    expect(byTestId('plugin-@deepseek-ai/dsh-experimental-client-ui-discord-toggle')).toBeNull();
    // A plain dependency gets no explanation either: nothing to explain about a plain package.
    expect(byTestId('plugin-is-odd-client-note')).toBeNull();
  });

  it('leaves a switchable bundle switchable', async () => {
    await render();
    expect(byTestId('plugin-demo-bundle-toggle')).not.toBeNull();
  });
});
