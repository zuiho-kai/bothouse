// Per-turn wiki pages and task board for DSH-native members, from the local gate's
// POST /context (bridge/contrib/gate/gate.py -> ctxsvc.context): the same source and the same
// block the bridge puts before a bot's turn (bridge/core/gate.go turnContext).
//
// The gate's port: GATE_PORT, which bothouse sets on the `dsh web` it starts to the port it runs the
// gate on (core/gate_proc.go gatePort). A `dsh web` started another way (reload-dsh.py reusing an old
// environment, the desktop app) has no GATE_PORT, so it is read from the same config.toml the bridge
// itself reads: [gate] port (core/gate_proc.go LocalGatePort), default 9930 when the file has no
// [gate] table (that is gate.py's own PORT). Without a config file either, no port: a turn goes out
// as before, and the log says why instead of the badge and the pages vanishing without a word.
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { dataDirCandidates } from './memory-sources.mjs';

// Same as the bridge's wait for /context (core/gate.go turnContext: 2s).
export const GATE_CONTEXT_TIMEOUT_MS = 2_000;
// 来源：contrib/gate/gate.py PORT = 9930，core/setup_wizard_warnings.go defaultGatePort 同值
// （LocalGatePort 在 config [gate] port 缺省或为 0 时也用它）。
export const DEFAULT_GATE_PORT = 9930;

/** `port\0where` of the log lines already written: one line per process, not one per member. */
const announced = new Set();

/** `[gate] port` of a bridge config's text, as Go reads cfg.Gate.Port; 0 when it has no such table. */
export function gatePortSetting(text) {
  let inside = false;
  for (const line of String(text).split(/\r?\n/)) {
    const header = /^\s*\[\s*([^\]]+?)\s*\]/.exec(line);
    if (header !== null) { inside = header[1] === 'gate'; continue; }
    if (!inside) continue;
    const kv = /^\s*port\s*=\s*(\d+)\s*(?:#.*)?$/.exec(line);
    if (kv === null) continue;
    const port = Number(kv[1]);
    if (Number.isInteger(port) && port > 0) return port;
  }
  return 0;
}

/**
 * The bridge config this process should read: $BOTHOUSE_CONFIG (the bridge's --config), else
 * <its data dir>/config.toml, the data dir being the one the gate itself would pick
 * (bridge/brand.go dataDir, bridge/contrib/gate/datadir.py data_dir). The process's own ./config.toml
 * is deliberately not tried: that is the bridge's rule for the bridge's cwd, not for a plugin's.
 * @param {NodeJS.ProcessEnv} env
 * @param {string} home
 * @returns {string}
 */
export function bridgeConfigFile(env = process.env, home = homedir()) {
  const explicit = String(env.BOTHOUSE_CONFIG ?? '').trim();
  if (explicit !== '' && explicit !== '~' && !explicit.startsWith('~/')) return explicit;
  if (explicit !== '') return join(home, explicit.slice(2));
  return join(dataDirCandidates(env, home)[0], 'config.toml');
}

/**
 * The gate port to use, and where it came from (for the log line).
 * @param {NodeJS.ProcessEnv} env
 * @param {string} home
 * @param {(file: string, encoding: string) => string} readFile
 * @returns {{ port: string, why: string }}
 */
export function resolveGatePort(env = process.env, home = homedir(), readFile = readFileSync) {
  const fromEnv = String(env.GATE_PORT ?? '').trim();
  if (fromEnv !== '') return { port: fromEnv, why: 'GATE_PORT' };
  const file = bridgeConfigFile(env, home);
  let text;
  try { text = readFile(file, 'utf8'); } catch { return { port: '', why: `没有配置文件 ${file}` }; }
  const port = gatePortSetting(text);
  if (port !== 0) return { port: String(port), why: `${file} [gate] port` };
  return { port: String(DEFAULT_GATE_PORT), why: `${file} 没有 [gate] port，用默认端口` };
}

export class GateContext {
  /**
   * @param options - { port?: gate port (default: GATE_PORT, else the bridge config's [gate] port),
   *   timeoutMs?, fetch?, logger? }.
   */
  constructor({ port, timeoutMs = GATE_CONTEXT_TIMEOUT_MS, fetch: fetchFn = globalThis.fetch, logger } = {}) {
    const from = port === undefined ? resolveGatePort() : { port: String(port ?? '').trim(), why: 'port 参数' };
    this.port = String(from.port ?? '').trim();
    this.timeoutMs = timeoutMs;
    this.fetch = fetchFn;
    this.logger = logger;
    // One line per process (a member each builds its own GateContext): which port the context goes
    // to and from where, so a missing one is a line in the log instead of a silently missing block.
    const line = `${this.port}\u0000${from.why}`;
    if (!announced.has(line)) {
      announced.add(line);
      if (this.port !== '') this.logger?.info?.('collab: gate context: port %s（%s）', this.port, from.why);
      else this.logger?.warn?.('collab: gate context: 没有 gate 端口（%s）；每轮不带 wiki 页和任务板', from.why);
    }
    /** `${member}\0${room}` -> { session, epoch }: the name of that conversation's context for the gate. */
    this.sent = new Map();
  }

  /**
   * The block of pages this (member, room) conversation has not been given yet. The gate keeps what
   * it pushed per (key, bot, epoch) and returns only new entries (ctxsvc.only_new, 11-03); here we only
   * name the context: a new `session`, reset, forget or resetRoom gives a new epoch (as core/gate.go turnEpoch).
   * @returns {Promise<{ block: string, commit: () => void }>} block is '' when there is nothing new.
   */
  async turn({ member, room, session, text }) {
    const none = { block: '', commit: () => {} };
    if (!this.port || typeof this.fetch !== 'function') return none;
    const key = `${member}\u0000${room}`;
    let entry = this.sent.get(key);
    if (entry === undefined || entry.session !== session) {
      entry = { session, epoch: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}` };
      this.sent.set(key, entry);
    }
    let out;
    try {
      const res = await this.fetch(`http://127.0.0.1:${this.port}/context`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // bot = dsh:<member id>: the gate finds the kind "dsh" team entry with that id (lead.member),
        // apart from the bridge bots' keys, which may be the same word.
        body: JSON.stringify({ key: `dsh:${member}:${room}`, text: text ?? '', bot: `dsh:${member}`, epoch: entry.epoch }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (!res.ok) throw new Error(`status ${res.status}`);
      out = await res.json();
    } catch (error) {
      this.logger?.debug?.('collab: gate context fetch failed: %s', error?.message ?? error);
      return none;
    }
    const fresh = (Array.isArray(out?.wiki) ? out.wiki : []).filter(w => w && typeof w.path === 'string');
    if (fresh.length === 0) return none;
    const block = '（可能相关的 wiki 页，需要时去读）' + fresh.map(w => `\n- ${w.path} — ${w.desc ?? ''}`).join('');
    return { block, commit: () => {} };
  }

  /** /new for a (member, room) whose session key does not change (a local CLI member): start it over. */
  reset(member, room) {
    this.sent.delete(`${member}\u0000${room}`);
  }

  /** This member's conversation in room lost its context (a CLI session that could not be resumed): give it again. */
  forget(member, room) {
    this.sent.delete(`${member}\u0000${room}`);
  }

  /** A released workspace starts its conversations over: give every page again. */
  resetRoom(room) {
    for (const key of this.sent.keys()) if (key.endsWith(`\u0000${room}`)) this.sent.delete(key);
  }
}
