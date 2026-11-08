import api from './client';
import { withBase } from '@/lib/basePath';

/** One plugin row a bundle's patch inserts (what DSH itself calls a plugin). */
export interface PluginRow {
  id: string;
  name: string;
  disabled: boolean;
}

/** One dependency of the DSH profile (core/management_plugins.go listDSHPlugins). */
export interface DSHPlugin {
  name: string;
  version?: string;
  description?: string;
  source?: string;
  /** declarse dsh.bundle, so selecting it adds a profile layer */
  layer: boolean;
  /** selected in package.json's dsh.profile.bundles */
  enabled: boolean;
  /** ships with the DSH installation (a surface layer); the page does not offer its switch */
  shipped: boolean;
  rows?: PluginRow[];
  error?: string;
}

export interface DSHPluginsState {
  profile: string;
  profile_dir: string;
  plugins: DSHPlugin[];
  can_install: boolean;
  /** false when the management API has no token: the page lists but cannot install or switch */
  writes_allowed: boolean;
  /** config.toml [plugins] allow_non_registry: git/tarball/path sources need this and a second confirm */
  allow_non_registry: boolean;
  /** the registry the panel will name as the source */
  registry: string;
}

/** What POST /plugins/inspect says the person is about to install (core/plugin_spec.go). */
export interface PluginInspection {
  spec: string;
  name: string;
  kind: 'registry' | 'git' | 'tarball' | 'path' | 'unknown';
  version?: string;
  registry?: string;
  publisher?: string;
  description?: string;
  /** declares dsh.bundle: DSH will load it as a profile layer */
  bundle: boolean;
  runtime?: string;
  /** the declared DSH requirement, e.g. "engines.dsh ^0.2.0" */
  requires?: string;
  /** false when the requirement does not fit this DSH; absent when the range was not evaluated here */
  compatible?: boolean;
  /** what the plugin may do once loaded */
  required: string;
  allowed: boolean;
  reason?: string;
  error?: string;
}

export const inspectPlugin = (spec: string) =>
  api.get<PluginInspection>('/plugins/inspect', { spec });

/**
 * One row's config as the API reads it (core/management_plugin_config.go GetDSHPluginConfig).
 *
 * `config_yaml` is YAML text on purpose: the fields belong to the plugin, and a `!!js` expression
 * has to go back exactly as it came out. `layer` says who set the value that is in effect.
 */
export interface PluginConfig {
  id: string;
  name: string;
  /** "profile" (this file, editable) | "bundle" | "home" | "none" */
  layer: 'profile' | 'bundle' | 'home' | 'none';
  /** false when a HOME patch decides this value: saving here would not take effect */
  editable: boolean;
  reason?: string;
  config_yaml: string;
  /** the profile patch sets this row's config itself */
  overridden: boolean;
}

export const getPluginConfig = (id: string) => api.get<PluginConfig>('/plugins/config', { id });

export const savePluginConfig = (id: string, configYaml: string) =>
  api.post<{ changed: boolean; restart_required: boolean; config: PluginConfig }>('/plugins/config', {
    id,
    config_yaml: configYaml,
  });

export const listPlugins = () => api.get<DSHPluginsState>('/plugins');

export const switchPlugin = (name: string, enabled: boolean) =>
  api.post<{ changed: boolean; restart_required: boolean; state: DSHPluginsState }>('/plugins/switch', { name, enabled });

/** One line of the POST /plugins/install NDJSON stream (core/management_plugins.go handlePluginsInstall). */
export interface PluginInstallEvent {
  line?: string;
  done?: boolean;
  state?: DSHPluginsState;
  /** pnpm's own error line; the readable text comes from kind + texts.ts */
  error?: string;
  kind?: string;
  log?: string;
}

/**
 * Runs `dsh plugin add <spec>` and reports each streamed line. Rejects with the classifier kind on
 * the thrown error so the page can say what happened in the reader's language; the raw log rides
 * along as `.log` for the details fold.
 */
export async function installPlugin(spec: string, onEvent: (e: PluginInstallEvent) => void): Promise<DSHPluginsState> {
  const token = api.getToken();
  const res = await fetch(withBase('/api/v1/plugins/install'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ spec }),
  });
  if (!res.ok || !res.body) {
    const text = await res.text();
    let msg = text;
    try { msg = JSON.parse(text).error || text; } catch { /* plain-text body */ }
    throw new Error(msg || `HTTP ${res.status}`);
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    buf += dec.decode(value, { stream: !done });
    let i: number;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line) continue;
      const ev = JSON.parse(line) as PluginInstallEvent;
      onEvent(ev);
      if (ev.error !== undefined) {
        throw Object.assign(new Error(ev.error), { kind: ev.kind, log: ev.log });
      }
      if (ev.done && ev.state) return ev.state;
    }
    if (done) throw new Error('install stream ended without a result');
  }
}