// The bridge's files as DSH sees them: the only module in dsh/collab that knows the bridge's data directory, file
// names and config format (#2051: one owner per data file; everyone else reads through here or a bothouse command).
// Writers: config.toml, lead.json — the bridge; board-events.jsonl — gate/board.py. This module only reads.
import { existsSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

// 来源：bothouse 管理接口默认端口（bridge config.example.toml [management] port）
export const DEFAULT_PORT = 9820;
// 任务板事件流（Issue #876）：与 board.jsonl 同目录，一行一个 JSON，只追加；写者是 gate 的 board.py。
export const BOARD_EVENTS_FILE = 'board-events.jsonl';

/**
 * Default bridge config path: $BOTHOUSE_CONFIG, else <data dir>/config.toml.
 * @param {NodeJS.ProcessEnv} env
 * @returns {string}
 */
export function defaultBridgeConfig(env = process.env, exists = existsSync, isDir = dirExists) {
  const explicit = String(env.BOTHOUSE_CONFIG ?? '').trim();
  if (explicit !== '') return explicit;
  return join(bridgeDataDir(env, exists, isDir), 'config.toml');
}

export function dirExists(path) {
  try { return statSync(path).isDirectory(); } catch { return false; }
}

/**
 * The bridge's data directory, resolved the way the bridge itself does (bridge/brand.go dataDir):
 * BOTHOUSE_DATA_DIR, else ~/.bothouse — unless that is missing and the legacy ~/.cc-connect exists.
 * The plugin used to assume ~/.bothouse, so on a machine that still had only ~/.cc-connect it wrote
 * one config while the bridge ran from the other: two instances fighting over the members
 * (外部用户 11-25 报告 #1997「配置分叉 / 重复实例」).
 */
export function bridgeDataDir(env = process.env, exists = existsSync, isDir = dirExists) {
  const home = env.HOME || env.USERPROFILE || homedir();
  const set = String(env.BOTHOUSE_DATA_DIR ?? '').trim();
  if (set !== '') return set === '~' || set.startsWith('~/') ? join(home, set.slice(1)) : set;
  const preferred = join(home, '.bothouse');
  const legacy = join(home, '.cc-connect');
  return !exists(preferred) && isDir(legacy) ? legacy : preferred;
}

/** Value of one TOML scalar (quoted string, number or bare word); comments stripped. */
function scalar(raw) {
  const s = raw.trim();
  const quoted = /^"((?:[^"\\]|\\.)*)"|^'([^']*)'/.exec(s);
  if (quoted !== null) return quoted[1] !== undefined ? JSON.parse(`"${quoted[1]}"`) : quoted[2];
  return s.replace(/\s+#.*$/, '').trim();
}

/**
 * Read host/port/token/enabled from the [management] table of a bridge config.
 * Only flat `key = value` lines are needed, so a full TOML parser is not pulled in.
 * @param {string} text - config.toml contents.
 * @returns {{ enabled: boolean, host: string, port: number, token: string }}
 */
export function managementSettings(text) {
  const out = { enabled: false, host: '', port: DEFAULT_PORT, token: '' };
  let inside = false;
  for (const line of text.split(/\r?\n/)) {
    const header = /^\s*\[\s*([^\]]+?)\s*\]/.exec(line);
    if (header !== null) { inside = header[1] === 'management'; continue; }
    if (!inside) continue;
    const kv = /^\s*([A-Za-z_][A-Za-z0-9_-]*)\s*=\s*(.*)$/.exec(line);
    if (kv === null) continue;
    const value = scalar(kv[2]);
    if (kv[1] === 'enabled') out.enabled = value === 'true';
    else if (kv[1] === 'host') out.host = String(value);
    else if (kv[1] === 'port' && Number.isInteger(Number(value)) && Number(value) > 0) out.port = Number(value);
    else if (kv[1] === 'token') out.token = String(value);
  }
  return out;
}

/**
 * lead.json (the lead the bridge picked; writer: bridge core/api_handoff.go writeLeadSelectionFile):
 * $CONEST_LEAD_FILE, else <data dir>/lead.json.
 * @param {NodeJS.ProcessEnv} env
 * @returns {string}
 */
export function leadFile(env = process.env, exists = existsSync, isDir = dirExists) {
  const explicit = String(env.CONEST_LEAD_FILE ?? '').trim();
  if (explicit !== '') return explicit;
  return join(bridgeDataDir(env, exists, isDir), 'lead.json');
}
