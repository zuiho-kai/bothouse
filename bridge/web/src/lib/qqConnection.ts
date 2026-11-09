/**
 * QQ panel's three states, because they call for different actions:
 *
 * - restart: the config has QQ but this process is not running it yet (or the user just
 *   saved here and the save said restart_required) — restart the bridge.
 * - offline: the bridge did start QQ and it is not ready (OneBot ws refused, dropped,
 *   still reconnecting) — check the address, NapCat, the token.
 * - connected: QQ is running and ready.
 *
 * `platforms` is the running-platform list from GET /projects/{name}; its `connected` is
 * the runtime readiness bit, not "the platform is in config.toml"
 * (core/management.go handleProjectDetail). `undefined` means it has not loaded yet:
 * say unknown rather than guess.
 */
export type QQConnectionState = 'restart' | 'offline' | 'connected' | 'unknown';

export function qqConnectionState(input: {
  /** QQ is written in config.toml (platform_configs); the panel only shows for these. */
  configured: boolean;
  /** Running platforms with their readiness; undefined until the detail has loaded. */
  platforms?: { type: string; connected: boolean }[];
  /** A save from this panel said restart_required and no restart has happened since. */
  pendingRestart?: boolean;
}): QQConnectionState {
  // Without the running-platform list there is nothing to judge from: say nothing rather
  // than guess. (A save note still tells the user a restart is pending.)
  if (!input.configured || !input.platforms) return 'unknown';
  if (input.pendingRestart) return 'restart';
  const qq = input.platforms.find((p) => p.type === 'qq');
  // In config.toml but not among the running platforms: saved, the bridge has not
  // restarted into it yet.
  if (!qq) return 'restart';
  return qq.connected ? 'connected' : 'offline';
}

export const QQ_STATE_LABEL: Record<Exclude<QQConnectionState, 'unknown'>, string> = {
  restart: 'qq.stateRestart',
  offline: 'qq.stateOffline',
  connected: 'qq.stateConnected',
};

export const QQ_STATE_HINT: Record<Exclude<QQConnectionState, 'unknown'>, string> = {
  restart: 'qq.stateRestartHint',
  offline: 'qq.stateOfflineHint',
  connected: 'qq.stateConnectedHint',
};