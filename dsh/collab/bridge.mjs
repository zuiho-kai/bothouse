// The plugin is an adapter: it hosts the channels, and every channel member runs as a bothouse role
// (one bridge project per member, joined to these channels as a cloud_web bot). Team work — dispatch,
// workspaces, the task board, wakes, the rules text, memory — is the bridge's, written once there.
//
// What the plugin does here: hand the member list to the bridge's own setup (`bothouse setup apply`,
// the same entry the wizard and AI agents use), which writes the roles and the team around them; take
// out the roles of removed members (`remove_projects`); and keep the bridge running. With no bothouse
// on the machine it runs the official installer first (install.sh / install.ps1, the README's one line).
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { defaultBridgeConfig, dialHost, managementSettings } from './panel.mjs';

// 来源：仓库根 README / docs/GETTING_STARTED.md 第 1 步的一行安装命令。
export const INSTALL_SH = 'https://raw.githubusercontent.com/zuiho-kai/bothouse/main/install.sh';
export const INSTALL_PS1 = 'https://raw.githubusercontent.com/zuiho-kai/bothouse/main/install.ps1';
/** Member cli → bridge agent type (bridge config [projects.agent] type). No cli = a DSH member. */
export const AGENT_TYPES = { claude: 'claudecode', codex: 'codex', gemini: 'gemini' };
// 来源：一次 setup apply 实测几秒；装桥要下载约 40 MB，按慢网 10 分钟给。
const APPLY_TIMEOUT_MS = 120_000;
const INSTALL_TIMEOUT_MS = 600_000;
const SYNC_DEBOUNCE_MS = 1_000;
const TOKEN_FILE = 'bot-token';

/** The bothouse binary: on PATH, else where the installer puts it (~/.local/bin). */
export function bridgeBinary(env = process.env, platform = process.platform, exists = existsSync) {
  const exe = platform === 'win32' ? 'bothouse.exe' : 'bothouse';
  const dirs = String(env.PATH ?? env.Path ?? '').split(platform === 'win32' ? ';' : delimiter).filter(Boolean);
  for (const dir of [...dirs, join(env.HOME || env.USERPROFILE || homedir(), '.local', 'bin')]) {
    const p = join(dir, exe);
    if (exists(p)) return p;
  }
  return undefined;
}

/** The cloud_web bot token: the configured one, else one kept in the data directory (made once). */
export function botToken(configured, dataDir) {
  if (configured) return configured;
  const file = join(dataDir, TOKEN_FILE);
  try {
    const saved = readFileSync(file, 'utf8').trim();
    if (saved) return saved;
  } catch { /* first start */ }
  const token = randomBytes(24).toString('hex');
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(file, token + '\n', { mode: 0o600 });
  return token;
}

/** One stored member → a `setup apply` role (project = member id, so the bot it becomes keeps the id). */
export function memberRole(m) {
  const role = { project: m.id, name: m.name, agent_type: m.cli ? AGENT_TYPES[m.cli] : 'dsh', persona: m.persona ?? '', edit_persona: true };
  if (m.nameCustomized !== undefined) role.name_customized = m.nameCustomized;
  if (typeof m.model === 'string' && m.model) role.model = m.model;
  // DSH's ACP names a model as the JSON pair it lists in its model option: ["<provider route>","<model>"].
  else if (m.model?.provider && m.model?.model) role.model = JSON.stringify([m.model.provider, m.model.model]);
  if (m.avatar && !m.avatar.startsWith('upload:')) role.avatar = m.avatar;
  return role;
}

/** The whole `setup apply` request for this channel host. */
export function applyRequest(members, { url, token, lead, remove = [] }) {
  const req = { platform: 'cloud_web', cloud_web: { url, token }, allow_from: 'owner', roles: members.map(memberRole) };
  if (lead) req.fallback_role = lead;
  if (remove.length) req.remove_projects = remove;
  return req;
}

function run(cmd, args, { input, timeout, log, env }) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, env });
    let out = '';
    const timer = setTimeout(() => child.kill(), timeout);
    child.stdout.on('data', d => { out += d; });
    child.stderr.on('data', d => { out += d; });
    child.on('error', error => { clearTimeout(timer); resolve({ code: -1, out: String(error?.message ?? error) }); });
    child.on('close', code => { clearTimeout(timer); if (log) writeFileSync(log, out, { mode: 0o600 }); resolve({ code, out }); });
    child.stdin.end(input ?? '');
  });
}

export class Bridge {
  /**
   * @param opts.dataDir - channel data directory (logs, the bot token).
   * @param opts.origin - () => this DSH's http origin (where the bots dial in), or undefined before it is known.
   * @param opts.token - cloud_web bot token.
   * @param opts.members - () => the stored members (roster rows as members).
   * @param opts.lead - () => the selected primary role id, if any.
   */
  constructor({ dataDir, origin, token, members, lead = () => undefined, logger, env = process.env, configFile = defaultBridgeConfig(env) }) {
    Object.assign(this, { dataDir, origin, token, members, lead, logger, env, configFile });
    this.removed = new Set();
    this.changed = false;
    this.first = true;
    this.timer = undefined;
    this.running = Promise.resolve();
    this.personaCache = new Map();
  }

  /** The bothouse binary, installing it once when the machine has none. */
  binary() {
    const bin = bridgeBinary(this.env);
    if (bin !== undefined) return Promise.resolve(bin);
    this.installing ??= this.install().finally(() => { this.installing = undefined; });
    return this.installing;
  }

  /**
   * The bridge's persona presets (`bothouse setup personas`, core/persona_presets.go) in the shape the
   * add-member picker reads: { slug, name, intro, avatar, text }. #1662: the catalog is the bridge's,
   * not a copy in the plugin.
   */
  async personas(lang = 'zh') {
    const key = String(lang).toLowerCase().startsWith('zh') ? 'zh' : 'en';
    if (this.personaCache.has(key)) return this.personaCache.get(key);
    const bin = await this.binary();
    if (bin === undefined) return [];
    const r = await run(bin, ['setup', 'personas', '--lang', key], { timeout: APPLY_TIMEOUT_MS, env: this.env });
    let list;
    try { list = JSON.parse(r.out.slice(r.out.indexOf('['))); } catch { list = undefined; }
    if (!Array.isArray(list)) {
      this.logger?.warn?.('conest-collab: bothouse setup personas failed: %s', r.out.slice(-300));
      return [];
    }
    const out = list.map(({ id, ...rest }) => ({ slug: id, ...rest }));
    this.personaCache.set(key, out);
    return out;
  }

  /**
   * Re-apply the member list soon (several edits in a row become one apply). removedId: a member taken out;
   * changed: an existing member was edited (its role's model or persona only take effect after a bridge restart).
   */
  sync(removedId, changed = false) {
    if (removedId) this.removed.add(removedId);
    if (changed) this.changed = true;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => { this.running = this.running.then(() => this.apply()).catch(() => {}); }, SYNC_DEBOUNCE_MS);
    this.timer.unref?.();
  }

  close() { clearTimeout(this.timer); }

  /** No bothouse yet: the official installer puts it in ~/.local/bin. Returns the binary or undefined. */
  async install() {
    const win = process.platform === 'win32';
    this.logger?.info?.('conest-collab: no bothouse on this machine; installing it (%s)', win ? INSTALL_PS1 : INSTALL_SH);
    const r = win
      ? await run('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', `irm ${INSTALL_PS1} | iex`], { timeout: INSTALL_TIMEOUT_MS, log: join(this.dataDir, 'bothouse-install.log'), env: this.env })
      : await run('/bin/sh', ['-c', `curl -fsSL ${INSTALL_SH} | sh`], { timeout: INSTALL_TIMEOUT_MS, log: join(this.dataDir, 'bothouse-install.log'), env: this.env });
    const bin = bridgeBinary(this.env);
    if (r.code !== 0 || bin === undefined) this.logger?.warn?.('conest-collab: installing bothouse failed (exit %s), see %s', r.code, join(this.dataDir, 'bothouse-install.log'));
    return bin;
  }

  /** Write the roles (setup apply), then have the running bridge load them, or start it. */
  async apply() {
    const url = this.origin();
    if (url === undefined) return;
    const bin = await this.binary();
    if (bin === undefined) return;
    const remove = [...this.removed];
    const req = applyRequest(this.members(), { url, token: this.token, lead: this.lead(), remove });
    const before = this.configText();
    const r = await run(bin, ['setup', 'apply', '--json', '-'], { input: JSON.stringify(req), timeout: APPLY_TIMEOUT_MS, log: join(this.dataDir, 'bothouse-apply.log'), env: this.env });
    let res;
    try { res = JSON.parse(r.out.slice(r.out.indexOf('{'))); } catch { res = undefined; }
    // saved = the roles are written; its warnings (a CLI not logged in…) are for the user, the roles still run.
    if (res?.saved !== true) {
      this.logger?.warn?.('conest-collab: bothouse setup apply failed: %s', res?.error ?? r.out.slice(-500));
      return;
    }
    for (const w of res.warnings ?? []) this.logger?.warn?.('conest-collab: bothouse: %s', w.message);
    for (const id of remove) this.removed.delete(id);
    // New roles hot-load; a removed or edited one keeps its old setup until the bridge restarts, and so does
    // one edited while this DSH was closed (the first apply after a start that changed the config).
    const restart = remove.length > 0 || this.changed || (this.first && this.configText() !== before);
    this.changed = false;
    this.first = false;
    if (!await this.manage(restart ? 'restart' : 'reload')) this.start(bin);
  }

  configText() {
    try { return readFileSync(this.configFile, 'utf8'); } catch { return ''; }
  }

  /** POST /api/v1/<what> on the running bridge's management server. false = not reachable. */
  async manage(what) {
    let s;
    try { s = managementSettings(readFileSync(this.configFile, 'utf8')); } catch { return false; }
    if (!s.enabled) return false;
    try {
      const res = await fetch(`http://${dialHost(s.host)}:${s.port}/api/v1/${what}`, { method: 'POST', headers: s.token ? { authorization: `Bearer ${s.token}` } : {}, signal: AbortSignal.timeout(10_000) });
      return res.ok;
    } catch {
      return false;
    }
  }

  /** Start the bridge in the background; it outlives this DSH. A second start while one runs exits on its lock. */
  start(bin) {
    const log = openSync(join(this.dataDir, 'bothouse.log'), 'a', 0o600);
    const child = spawn(bin, ['--headless'], { detached: true, stdio: ['ignore', log, log], windowsHide: true, env: this.env });
    child.on('error', error => this.logger?.warn?.('conest-collab: starting bothouse failed: %s', error?.message ?? error));
    child.unref();
    this.logger?.info?.('conest-collab: started bothouse (pid %d)', child.pid);
  }
}
