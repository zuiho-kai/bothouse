// The plugin is an adapter: it hosts the channels, and every channel member runs as a bothouse role
// (one bridge project per member, joined to these channels as a cloud_web bot). Team work — dispatch,
// workspaces, the task board, wakes, the rules text, memory — is the bridge's, written once there.
//
// What the plugin does here: hand the member list to the bridge's own setup (`bothouse setup apply`,
// the same entry the wizard and AI agents use), which writes the roles and the team around them; take
// out the roles of removed members (`remove_projects`); and keep the bridge running. With no bothouse
// on the machine it runs the official installer first (install.sh / install.ps1, the README's one line).
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, openSync, readFileSync, watch, writeFileSync } from 'node:fs';
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
// 来源：桥向频道主机发 team_workspace 帧等 ack 的上限是 10 秒（bridge/platform/cloud-web/workspaces.go），加命令启动的余量。
const WORKSPACE_TIMEOUT_MS = 30_000;
const TOKEN_FILE = 'bot-token';
// 来源：装桥后首次起后台、gate 导入 scorer、各成员拨进频道，隔离 HOME 实测一分钟内（install-walk-1119）；给 90 秒。
const CHECK_WAIT_MS = 90_000;
const CHECK_POLL_MS = 3_000;
/** Why the gate did not start (POST /setup/gate/start reason, bridge core/gate_proc.go), in plain words. */
const GATE_REASONS = {
  python_missing: '本机缺 Python',
  python_too_old: '本机 Python 版本太旧',
  starting: '还在启动，过一会儿再看',
  not_managed: '后台服务没接管它，重启一次 bothouse 再试',
};

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

/**
 * What went wrong with the memory wiki in a `setup apply` answer's steps ('' = nothing): a failed
 * "wiki" / "role N wiki" / "memory index" step, or a skip because there is no main wiki and none could be
 * made (core/setup_wiki.go applyWizardWiki, core/rolewiki.go applyRoleWikis). The bridge makes the wiki
 * when there is none, so a skip means it could not.
 */
export function wikiProblem(steps) {
  for (const st of steps ?? []) {
    const name = String(st?.step ?? '');
    if (!/wiki|memory/i.test(name)) continue;
    const detail = String(st?.detail ?? '');
    if (st?.ok === false) return detail || name;
    if (/^(skipped: no main wiki|跳过：没有主 wiki|スキップ：メイン wiki がな)/.test(detail)) return detail;
  }
  return '';
}

/** How to log in each local CLI, in plain words (the bridge's own fix text is long and points at bothouse commands). */
const LOGIN_HINTS = {
  claude: '在终端运行 claude，按提示登录一次',
  codex: '在终端运行 codex login，按提示登录一次',
  gemini: '在终端运行 gemini，选 Login with Google 登录一次',
  dsh: '在 设置 → 模型 里填 DeepSeek API Key',
};

/**
 * #1798: the `setup apply` warnings marked blocking (a member's CLI not logged in…: the role is written but
 * cannot answer) as self-check items, in plain words. members: the stored members (warning.project = member id).
 */
export function blockingItems(warnings, members = []) {
  const items = [];
  for (const w of warnings ?? []) {
    if (w?.blocking !== true) continue;
    const m = members.find(x => x.id === w.project || x.name === w.project);
    const name = m?.name ?? w.project ?? '';
    // The bridge's fix up to its first sentence: the rest is about bothouse commands.
    const fix = String(w.fix ?? '').split(/[；。]/)[0].trim();
    const why = w.code === 'agent_not_logged_in'
      ? `${name} 还没登录：${(m && LOGIN_HINTS[m.cli || 'dsh']) || fix || '按它自己的说明登录'}`
      : `${String(w.message ?? w.code ?? '').replace(/[。.]\s*$/, '')}${fix ? `：${fix}` : ''}`;
    items.push({ key: `blocking:${w.code ?? ''}:${w.project ?? ''}`, ok: false, why });
  }
  return items;
}

/** selfCheck()'s result as the one line said in the channel. */
export function checkText(result) {
  if (result.ok) return `装好了：后台服务、记忆服务、记忆 wiki 都正常，成员 ${result.members.join('、')} 都已在线。@ 谁就找谁干活。`;
  return `还没完全装好，卡在这几项：\n${result.items.filter(i => !i.ok).map(i => `- ${i.why}`).join('\n')}`;
}

/**
 * onCheck for the plugin: post selfCheck()'s result in room roomId() as a system message, once per state
 * (all good, or the same failing items); the last state said is kept in stateFile across restarts.
 */
export function checkPoster(hub, roomId, stateFile) {
  return (result) => {
    const state = result.ok ? 'ok' : result.items.filter(i => !i.ok).map(i => `${i.key}:${i.why}`).join('|');
    let last;
    try { last = JSON.parse(readFileSync(stateFile, 'utf8')).state; } catch { last = undefined; }
    if (state === last) return false;
    hub.post(roomId(), { authorKind: 'system', author: 'system', name: '系统', text: checkText(result) });
    writeFileSync(stateFile, JSON.stringify({ state, at: new Date().toISOString() }) + '\n', { mode: 0o600 });
    return true;
  };
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
  constructor({ dataDir, origin, token, members, lead = () => undefined, online = () => false, logger, env = process.env, configFile = defaultBridgeConfig(env), checkWait = CHECK_WAIT_MS, checkPoll = CHECK_POLL_MS }) {
    Object.assign(this, { dataDir, origin, token, members, lead, online, logger, env, configFile, checkWait, checkPoll });
    /** #1798: called with selfCheck()'s result after each successful apply (the plugin posts it in #general). */
    this.onCheck = undefined;
    this.checkRun = 0;
    this.removed = new Set();
    this.changed = false;
    this.first = true;
    this.timer = undefined;
    this.running = Promise.resolve();
    this.personaCache = new Map();
    /** #1797: 'no-key' = the last setup apply was refused because DSH has no model key yet. */
    this.noKey = false;
    this.keyWatch = undefined;
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

  close() { clearTimeout(this.timer); this.keyWatch?.close(); }

  /**
   * #1797: the key is saved in DSH (Settings → Models writes $DSH_HOME/.credentials.yaml; a key can also be
   * in $DSH_HOME/.env): apply again then, so the roles are written and the bridge starts without reopening DSH.
   */
  watchKey() {
    if (this.keyWatch !== undefined) return;
    const dir = this.env.DSH_HOME || join(this.env.HOME || this.env.USERPROFILE || homedir(), '.dsh');
    try {
      this.keyWatch = watch(dir, (_event, name) => {
        if (name == null || /^\.(credentials|env)/.test(String(name))) this.sync();
      });
    } catch (error) {
      this.logger?.warn?.('conest-collab: cannot watch %s for the model key: %s', dir, error?.message ?? error);
    }
  }

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
    const members = this.members();
    // No member yet (the default one is still being added): nothing to hand over; setup apply refuses an empty list.
    if (members.length === 0 && remove.length === 0) return;
    const req = applyRequest(members, { url, token: this.token, lead: this.lead(), remove });
    const before = this.configText();
    const r = await run(bin, ['setup', 'apply', '--json', '-'], { input: JSON.stringify(req), timeout: APPLY_TIMEOUT_MS, log: join(this.dataDir, 'bothouse-apply.log'), env: this.env });
    let res;
    try { res = JSON.parse(r.out.slice(r.out.indexOf('{'))); } catch { res = undefined; }
    // saved = the roles are written; its warnings (a CLI not logged in…) are for the user, the roles still run.
    if (res?.saved !== true) {
      this.logger?.warn?.('conest-collab: bothouse setup apply failed: %s', res?.error ?? r.out.slice(-500));
      this.noKey = res?.error_code === 'dsh_no_key';
      if (this.noKey) this.watchKey();
      // No key has its own card (plugin.mjs onOfflineMember); any other refusal is said in the channel.
      else this.onCheck?.({ ok: false, items: [{ key: 'apply', ok: false, why: `成员没写进后台：${String(res?.error ?? r.out.trim().slice(-200)) || '没有输出'}（日志 ${join(this.dataDir, 'bothouse-apply.log')}）` }], members: [] });
      return;
    }
    this.noKey = false;
    this.keyWatch?.close();
    this.keyWatch = undefined;
    for (const w of res.warnings ?? []) this.logger?.warn?.('conest-collab: bothouse: %s', w.message);
    for (const id of remove) this.removed.delete(id);
    // New roles hot-load; a removed or edited one keeps its old setup until the bridge restarts, and so does
    // one edited while this DSH was closed (the first apply after a start that changed the config).
    const restart = remove.length > 0 || this.changed || (this.first && this.configText() !== before);
    this.changed = false;
    this.first = false;
    if (!await this.manage(restart ? 'restart' : 'reload')) this.start(bin);
    // In the background: the next apply must not wait for the bridge to come up.
    if (this.onCheck !== undefined) {
      const run = ++this.checkRun;
      this.selfCheck(res.steps ?? [], run, res.warnings ?? []).then(result => { if (result !== undefined) this.onCheck?.(result); })
        .catch(error => this.logger?.warn?.('conest-collab: self-check failed: %s', error?.message ?? error));
    }
  }

  /**
   * #1798 (user 11-19「之前有人反应没装一些必备的东西导致没上下文啥的，这个也得强制装上」): after an apply, check
   * the things a member needs, starting what can be started: the bridge answers (GET /status), the gate runs
   * (GET /setup/gate; not running → POST /setup/gate/start), the memory wiki was made (the apply's wiki
   * steps), every member is connected. Waits up to checkWait for things still coming up. Returns
   * { ok, items: [{ key, ok, why }], members: [names] }; undefined when a newer apply's check took over.
   * warnings: the apply's warnings; the blocking ones (a CLI not logged in) are items too, so「装好了」is not
   * said while a member cannot answer (blockingItems).
   */
  async selfCheck(steps, run = this.checkRun, warnings = []) {
    const wiki = wikiProblem(steps);
    const blocking = blockingItems(warnings, this.members());
    const deadline = Date.now() + this.checkWait;
    let items;
    for (;;) {
      if (run !== this.checkRun) return undefined;
      items = [];
      const status = await this.api('GET', 'status');
      items.push({ key: 'service', ok: status?.ok === true, why: status?.ok === true ? '' : `后台服务没起来：连不上 bothouse（日志 ${join(this.dataDir, 'bothouse.log')}）` });
      if (status?.ok === true) {
        let gate = (await this.api('GET', 'setup/gate'))?.data?.gate;
        let reason = '';
        if (gate?.running !== true) {
          const started = await this.api('POST', 'setup/gate/start');
          reason = started?.data?.reason ?? '';
          if (started?.data?.running === true || started?.data?.started === true) gate = { running: true };
          else gate = (await this.api('GET', 'setup/gate'))?.data?.gate;
        }
        items.push({ key: 'gate', ok: gate?.running === true, why: gate?.running === true ? '' : `记忆服务没起来：${GATE_REASONS[reason || gate?.status] ?? (reason || gate?.status || '原因不明')}` });
      }
      items.push({ key: 'wiki', ok: wiki === '', why: wiki === '' ? '' : `记忆 wiki 没建好：${wiki}` });
      const offline = this.members().filter(m => !this.online(m.id)).map(m => m.name);
      items.push({ key: 'members', ok: offline.length === 0, why: offline.length === 0 ? '' : `成员没连上：${offline.join('、')}` });
      // The wiki and the blocking warnings are what the apply found; waiting does not change them.
      if (items.every(i => i.ok || i.key === 'wiki') || Date.now() >= deadline) { items.push(...blocking); break; }
      await new Promise(resolve => setTimeout(resolve, this.checkPoll));
    }
    return { ok: items.every(i => i.ok), items, members: this.members().map(m => m.name) };
  }

  /**
   * #1904: have the bridge delete workspace `workspace` ("room-<id>"). The bridge keeps the tasks, so it
   * decides whether the workspace is idle (`bothouse workspace delete`) and has the room removed through
   * its own team_workspace frame. Answers the bridge's { deleted, reason?, error? }; reason 'unreachable'
   * when there is no running bridge to ask.
   */
  async deleteWorkspace(workspace) {
    const bin = bridgeBinary(this.env);
    if (bin === undefined) return { deleted: false, reason: 'unreachable', error: 'bothouse is not installed' };
    const r = await run(bin, ['workspace', 'delete', workspace, '--session-key', `cloud_web:${workspace}`, '--json'], { timeout: WORKSPACE_TIMEOUT_MS, env: this.env });
    let res;
    try { res = JSON.parse(r.out.slice(r.out.indexOf('{'))); } catch { res = undefined; }
    if (typeof res?.deleted !== 'boolean') return { deleted: false, reason: 'unreachable', error: r.out.trim().slice(-300) };
    return res;
  }

  configText() {
    try { return readFileSync(this.configFile, 'utf8'); } catch { return ''; }
  }

  /** POST /api/v1/<what> on the running bridge's management server. false = not reachable. */
  async manage(what) {
    return (await this.api('POST', what))?.ok === true;
  }

  /**
   * <method> /api/v1/<what> on the running bridge's management server: { ok, status, data } (data: the
   * answer's "data", mgmtJSON), or undefined when it is not configured or not reachable.
   */
  async api(method, what) {
    let s;
    try { s = managementSettings(readFileSync(this.configFile, 'utf8')); } catch { return undefined; }
    if (!s.enabled) return undefined;
    try {
      const res = await fetch(`http://${dialHost(s.host)}:${s.port}/api/v1/${what}`, { method, headers: s.token ? { authorization: `Bearer ${s.token}` } : {}, signal: AbortSignal.timeout(10_000) });
      let body;
      try { body = await res.json(); } catch { body = undefined; }
      return { ok: res.ok, status: res.status, data: body?.data };
    } catch {
      return undefined;
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
