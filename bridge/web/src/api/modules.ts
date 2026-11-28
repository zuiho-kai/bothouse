import api from './client';

/** One row of the 接入应用 page: a chat app (or DSH itself) and how this household uses it. */
export interface PlatformModule {
  name: 'qq' | 'discord' | 'feishu' | 'dsh';
  label: string;
  /** enabled: some project has an active section; disabled: all its sections are marked off. */
  state: 'enabled' | 'disabled' | 'not_configured';
  enabled?: string[];
  disabled?: string[];
  /** Setup wizard add-platform entry, e.g. /setup?add=1&platform=qq */
  add_path: string;
}

export interface PlatformModules {
  modules: PlatformModule[];
  configured: number;
}

export async function listModules(): Promise<PlatformModules> {
  return api.get<PlatformModules>('/modules');
}

// #2113: whether DSH is set up on this machine (its module enabled). 「DSH 未运行」 is noise for
// someone who never chose DSH, so the notices ask this first; one request per page load.
// undefined = could not tell (the notice then shows, as before).
let dshSetUpOnce: Promise<boolean | undefined> | null = null;
export function dshIsSetUp(): Promise<boolean | undefined> {
  dshSetUpOnce ??= listModules().then((r) => r.modules.some((x) => x.name === 'dsh' && x.state === 'enabled')).catch(() => { dshSetUpOnce = null; return undefined; });
  return dshSetUpOnce;
}
