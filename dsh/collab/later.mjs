// Durable one-shot wakes for every channel member. Registration goes through the
// plugin's HTTP route and is bound to (member, room) by an HMAC ticket the plugin
// hands each member with its prompt; the plugin owns delivery through the member routers.
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { closeSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync, writeSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CollabError } from './store.mjs';

function schema(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS member_later (
    id INTEGER PRIMARY KEY, member_id TEXT NOT NULL, room_id INTEGER NOT NULL,
    due_at INTEGER NOT NULL, title TEXT NOT NULL, todo TEXT NOT NULL,
    message_id INTEGER, announced INTEGER NOT NULL DEFAULT 0, delivered INTEGER NOT NULL DEFAULT 0)`);
}
export function registerLater(db, { member, room, delay, title, todo }, now = Date.now()) {
  const match = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(String(delay));
  const ms = match && ((Number(match[1] ?? 0) * 3600 + Number(match[2] ?? 0) * 60 + Number(match[3] ?? 0)) * 1000);
  if (!ms || !Number.isSafeInteger(now + ms) || typeof member !== 'string' || !member.trim() ||
      typeof title !== 'string' || !title.trim() || typeof todo !== 'string' || !todo.trim() ||
      !Number.isSafeInteger(room) || !db.prepare('SELECT id FROM rooms WHERE id = ?').get(room)) {
    throw new CollabError('invalid', 'later requires member, room, positive delay (10m/1h30m), title and todo');
  }
  schema(db);
  return db.prepare('INSERT INTO member_later (member_id, room_id, due_at, title, todo) VALUES (?, ?, ?, ?, ?) RETURNING *')
    .get(member, room, now + ms, title.trim(), todo.trim());
}
/**
 * Load the plugin's ticket key, creating it (0600) when missing; ':memory:' stores get a per-process key.
 * A key file that does not decode to 32 bytes (empty, truncated, garbage) is replaced atomically
 * (temp 0600 -> fsync -> rename) and re-read, so racing processes settle on the renamed file.
 * Never falls back to an empty key: an unreadable result throws.
 */
function loadKey(file) {
  if (!file) return randomBytes(32);
  const read = () => {
    try { const key = Buffer.from(readFileSync(file, 'utf8').trim(), 'hex'); return key.length === 32 ? key : undefined; } catch (error) { if (error.code === 'ENOENT') return undefined; throw error; }
  };
  const existing = read();
  if (existing) return existing;
  const tmp = `${file}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
  try {
    const fd = openSync(tmp, 'wx', 0o600);
    try { writeSync(fd, randomBytes(32).toString('hex')); fsyncSync(fd); } finally { closeSync(fd); }
    renameSync(tmp, file);
  } catch (error) { try { unlinkSync(tmp); } catch {} throw error; }
  const key = read();
  if (!key) throw new Error(`later: ticket key ${file} is not 32 bytes after regeneration`);
  return key;
}
const b64 = value => Buffer.from(value).toString('base64url');
/** Unverified decode, for the local command to find the room; the plugin verifies. */
export function ticketClaims(ticket) {
  try { const [payload] = String(ticket).split('.'); const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')); return claims && typeof claims === 'object' ? claims : undefined; } catch { return undefined; }
}
/**
 * #1651: one local command line a member's shell tool can run as is. DSH's shell tool on Windows is
 * PowerShell, where a quoted program path is a string, not a command: it needs the call operator `&`,
 * and a quote inside a single-quoted word is doubled. Elsewhere the POSIX single-quote form.
 * #1653: in DSH Desktop the plugin runs inside the app's Electron binary (process.execPath is
 * "DeepSeek Harness", made a node by ELECTRON_RUN_AS_NODE=1). The line sets that variable itself, so a
 * shell that did not inherit it still gets a node instead of a second app window.
 */
export function localCommand(words, platform = process.platform, electron = Boolean(process.versions.electron)) {
  if (platform === 'win32') return (electron ? "$env:ELECTRON_RUN_AS_NODE='1'; " : '') + '& ' + words.map(word => "'" + String(word).replaceAll("'", "''") + "'").join(' ');
  return (electron ? 'ELECTRON_RUN_AS_NODE=1 ' : '') + words.map(word => "'" + String(word).replaceAll("'", "'\\''") + "'").join(' ');
}
/**
 * #1651: JSON as a command-line word. Windows PowerShell 5.1 drops bare double quotes on the way to a
 * program, so the Windows prompt writes them as \" and newer PowerShell hands that over literally:
 * parse the text as is, else with \" read as ".
 */
export function looseJson(text) {
  try { return JSON.parse(text); } catch (error) {
    try { return JSON.parse(String(text).replaceAll('\\"', '"')); } catch { throw error; }
  }
}
/** #1651: a memory page name: one .md file beside MEMORY.md, no folders, no hidden files. */
const MEMORY_PAGE = /^[^\\/:*?"<>|\u0000-\u001f.][^\\/:*?"<>|\u0000-\u001f]*\.md$/;
/**
 * #1651: write one page of a member's memory wiki (dir = the folder of its MEMORY.md). DSH's file
 * sandbox lets a member write only inside its working directory, so the page comes in through the
 * plugin (plugin.mjs memoryRoute) instead of the member's own write tool.
 */
export function writeMemoryPage(dir, page, content) {
  if (!dir || typeof page !== 'string' || !MEMORY_PAGE.test(page) || typeof content !== 'string' || !content.trim()) {
    throw new CollabError('invalid', 'memory requires page (a .md file name, no folders) and content');
  }
  mkdirSync(dir, { recursive: true });
  const file = join(dir, page);
  writeFileSync(file, content);
  return file;
}
export class Later {
  constructor(hub, filename, wake, { now = Date.now, start = true, platform = process.platform, keyFile = filename === ':memory:' ? undefined : join(dirname(filename), 'later.key') } = {}) {
    this.hub = hub; this.platform = platform; this.db = hub.store.db; this.filename = filename; this.wake = wake; this.now = now;
    this.key = loadKey(keyFile);
    /** Local origin of the DSH web server, learned from the first request the plugin serves. */
    this.origin = undefined;
    schema(this.db);
    if (start) this.start();
  }
  start() {
    this.tick();
    this.timer = setInterval(() => this.tick(), 1000);
    this.timer.unref();
  }
  sign(payload) { return createHmac('sha256', this.key).update(payload).digest('base64url'); }
  /** Ticket binding one member to one room: base64url({m, r}).HMAC. */
  ticket(member, room) {
    const payload = b64(JSON.stringify({ m: String(member), r: Number(room) }));
    return `${payload}.${this.sign(payload)}`;
  }
  /** Verified (member, room) of a ticket, or undefined; constant-time signature check. */
  verify(ticket) {
    if (typeof ticket !== 'string') return undefined;
    const [payload, mac, extra] = ticket.split('.');
    if (!payload || !mac || extra !== undefined) return undefined;
    const want = Buffer.from(this.sign(payload)); const got = Buffer.from(mac);
    if (want.length !== got.length || !timingSafeEqual(want, got)) return undefined;
    const claims = ticketClaims(ticket);
    if (typeof claims?.m !== 'string' || !Number.isSafeInteger(claims.r)) return undefined;
    return { member: claims.m, room: claims.r };
  }
  /** The shell the command lines are written for: PowerShell for a DSH-native member on Windows (#1651). */
  shell(cli) { return this.platform === 'win32' && !cli ? 'win32' : 'posix'; }
  /**
   * cli: the reader is a local CLI member or a bridge bot, whose shell is not DSH's. Elsewhere that is a
   * POSIX shell. #1653: on Windows it is PowerShell (Codex, Claude Code without Git) or Git Bash
   * (Claude Code with Git), and the plugin cannot see which, so the prompt gives one line for each.
   */
  instructions(member, room, { cli = false } = {}) {
    const ticket = this.ticket(member, room);
    const words = [process.execPath, fileURLToPath(import.meta.url), this.origin, ticket, '10m', '事情', '到点要做什么'];
    const local = !this.origin ? '' : cli && this.platform === 'win32'
      ? `用本机命令登记（重启后仍触发），按你的 shell 用其中一条：\nPowerShell：${localCommand(words, 'win32')}\nGit Bash：${localCommand(words, 'posix')}\n`
      : `用本机命令登记（重启后仍触发）：\n${localCommand(words, this.shell(cli))}\n`;
    return `\n【一次性回查】要过会儿回来，${local}或 POST /collab/api/rooms/${room}/later（头 X-Later-Ticket: ${ticket}，JSON: delay, title, todo）。凭据只对你和本房间有效。登记成功才说已挂；到点在原房间唤醒你。\n`;
  }
  /**
   * #597 G24: how a DSH member opens a workspace and hands work to it (one call: workspace, task,
   * ten-minute watch, wake). Only DSH members get this (dsh-member.mjs); bridge bots use
   * `bothouse workspace new`, so it stays out of instructions().
   */
  workspaceInstructions(member, room) {
    const quote = value => "'" + String(value).replaceAll("'", "'\\''") + "'";
    const ticket = this.ticket(member, room);
    const win = this.shell(false) === 'win32';
    // PowerShell 5.1 drops an empty word, which would shift 交接说明 into the owner: Windows names self as '-'.
    const local = this.origin ? `首选本机命令（直接复制，改后三个参数）：\n${localCommand([process.execPath, fileURLToPath(import.meta.url), 'workspace', this.origin, ticket, '任务标题', win ? '接活人id（-=你自己）' : '接活人id（空串=你自己）', '交接说明'], this.shell(false))}\n` : '';
    // #597 G26: a member once sent the ticket to /tasks and gave up on the 401; spell out the one call.
    const url = `${this.origin ?? 'http://<本机 DSH 地址>'}/collab/api/rooms/${room}/workspaces`;
    // In Windows PowerShell `curl` is Invoke-WebRequest and takes none of these flags: Windows gets the plain description.
    const curl = win ? `${url}（头 X-Later-Ticket: ${ticket}，JSON: title, owner（省略=你自己）, reason）` : `curl -sS -X POST ${quote(url)} -H 'content-type: application/json' -H ${quote(`X-Later-Ticket: ${ticket}`)} -d '{"title":"任务标题","owner":"接活人id（省略=你自己）","reason":"交接说明"}'`;
    return `\n【开工作区】整块活要交出去时，建工作区=这一条，任务和十分钟看门会自动开，不要另调 /tasks（它不认票据）。${local}或等价的接口 POST /collab/api/rooms/${room}/workspaces：\n${curl}\n一步建好工作区、开任务、挂十分钟看门并叫醒接活人；不要再在频道里 @ 同一件活。返回不是 200 就把返回原样告诉用户，不要悄悄自己做。工作区里的接活人是新会话，只看得到交接说明：里面要写清用户原话、参照的现成实现、以哪个分支为底、验收标准。\n`;
  }
  /**
   * 一句话拉团队 (user 11-04): how the primary role builds a channel of new roles in one call.
   * Primary-only like workspaceInstructions (dsh-member.mjs workspaceHint).
   */
  teamInstructions(member, room) {
    const ticket = this.ticket(member, room);
    const win = this.shell(false) === 'win32';
    const json = '{"channel":"小团队","model":"模型id（用户没说就省略=DSH默认模型）","members":[{"name":"写手","persona":"你是写手，负责写和改博客文章。"},{"name":"程序员","persona":"你是程序员，负责写代码和审代码。"}]}';
    const local = this.origin ? `本机命令（改 JSON 里的内容）：\n${localCommand([process.execPath, fileURLToPath(import.meta.url), 'team', this.origin, ticket, win ? json.replaceAll('"', '\\"') : json], this.shell(false))}\n` : '';
    const url = `${this.origin ?? 'http://<本机 DSH 地址>'}/collab/api/rooms/${room}/team`;
    return `\n【建团队】用户要你建几个角色、拉个群/频道时，一条就建好：新频道、每个角色（名字、人设、模型），你是新频道的主角色。${local}或 POST ${url}（头 X-Later-Ticket: ${ticket}，JSON 同上${win ? '，去掉反斜杠' : ''}）。名字不带空格和 @；人设一两句写清分工；用户说了模型就填 model（如 deepseek-v4.1-flash），没说就省略。返回不是 200 就把返回原样告诉用户。建好后告诉用户频道名、每个角色和模型，问要不要丢个题目试跑。\n`;
  }
  /**
   * #1651: how a DSH-native member adds to its memory wiki. Its write tool is fenced to the working
   * directory (DSH workspace-write), and the wiki is one per member across rooms, so it lives outside:
   * the member writes the page in its working directory and this command hands it to the plugin.
   */
  memoryInstructions(member, room) {
    if (!this.origin) return '';
    const command = localCommand([process.execPath, fileURLToPath(import.meta.url), 'memory', this.origin, this.ticket(member, room), '页面.md', '工作目录里写好的那个文件'], this.shell(false));
    return `\n【写记忆】记忆 wiki 在工作目录外，写文件工具写不进去（读可以）。要记一页：先把内容写成工作目录里的一个文件，再用本机命令收进记忆 wiki（收完会删掉那个文件）：\n${command}\n改目录页同法，页面名写 MEMORY.md。`;
  }
  tick() {
    for (const row of this.db.prepare('SELECT * FROM member_later WHERE announced = 0').all()) {
      this.hub.post(row.room_id, { authorKind: 'system', author: 'system', name: '回查登记',
        clientKey: `member-later-${row.id}-registered`,
        text: `${row.member_id}「${row.title}」：下次看 ${new Date(row.due_at).toISOString()}，到点：${row.todo}` });
      this.db.prepare('UPDATE member_later SET announced = 1 WHERE id = ?').run(row.id);
    }
    for (const row of this.db.prepare('SELECT * FROM member_later WHERE delivered = 0 AND due_at <= ? ORDER BY id').all(this.now())) {
      if (this.hub.quota?.cooling(row.member_id)) continue;
      let message;
      if (row.message_id === null) {
        // A stable client key makes a crash before receipt persistence reuse the same message.
        message = this.hub.post(row.room_id, { authorKind: 'system', author: 'system', name: '回查提醒',
          clientKey: `member-later-${row.id}`, text: `【later 到点】${row.title}：${row.todo}` }).message;
        this.db.prepare('UPDATE member_later SET message_id = ? WHERE id = ?').run(message.id, row.id);
      } else message = this.hub.store.message(row.message_id);
      if (message && this.wake(row.member_id, message)) this.db.prepare('UPDATE member_later SET delivered = 1 WHERE id = ?').run(row.id);
    }
  }
  close() { clearInterval(this.timer); }
}
if (process.argv[1] === fileURLToPath(import.meta.url) && process.argv[2] === 'workspace') {
  const [origin, ticket, title, owner, reason] = process.argv.slice(3);
  const room = ticketClaims(ticket)?.r;
  if (!origin || !Number.isSafeInteger(room) || !title) { console.error('usage: later.mjs workspace <origin> <ticket> <title> [owner] [reason] (ticket from your prompt; owner \'\' or - = yourself)'); process.exit(2); }
  const res = await fetch(new URL(`/collab/api/rooms/${room}/workspaces`, origin), { method: 'POST',
    headers: { 'content-type': 'application/json', 'x-later-ticket': ticket }, body: JSON.stringify({ title, ...(owner && owner !== '-' ? { owner } : {}), ...(reason ? { reason } : {}) }) });
  const body = await res.text();
  if (!res.ok) { console.error(`workspace: ${res.status} ${body}`); process.exit(1); }
  console.log(body);
} else if (process.argv[1] === fileURLToPath(import.meta.url) && process.argv[2] === 'team') {
  const [origin, ticket, spec] = process.argv.slice(3);
  const room = ticketClaims(ticket)?.r;
  let parsed;
  try { parsed = spec ? looseJson(spec) : undefined; } catch (error) { console.error(`team: JSON 解析失败：${error.message}`); process.exit(2); }
  if (!origin || !Number.isSafeInteger(room) || !spec) { console.error('usage: later.mjs team <origin> <ticket> \'{"channel":"…","model":"…","members":[{"name":"…","persona":"…"}]}\''); process.exit(2); }
  const res = await fetch(new URL(`/collab/api/rooms/${room}/team`, origin), { method: 'POST',
    headers: { 'content-type': 'application/json', 'x-later-ticket': ticket }, body: JSON.stringify(parsed) });
  const body = await res.text();
  if (!res.ok) { console.error(`team: ${res.status} ${body}`); process.exit(1); }
  console.log(body);
} else if (process.argv[1] === fileURLToPath(import.meta.url) && process.argv[2] === 'memory') {
  const [origin, ticket, page, source] = process.argv.slice(3);
  const room = ticketClaims(ticket)?.r;
  if (!origin || !Number.isSafeInteger(room) || !page || !source) { console.error('usage: later.mjs memory <origin> <ticket> <page.md> <file with the page content> (ticket from your prompt)'); process.exit(2); }
  let content;
  try { content = readFileSync(source, 'utf8'); } catch (error) { console.error(`memory: 读不到 ${source}：${error.message}`); process.exit(2); }
  const res = await fetch(new URL(`/collab/api/rooms/${room}/memory`, origin), { method: 'POST',
    headers: { 'content-type': 'application/json', 'x-later-ticket': ticket }, body: JSON.stringify({ page, content }) });
  const body = await res.text();
  if (!res.ok) { console.error(`memory: ${res.status} ${body}`); process.exit(1); }
  try { unlinkSync(source); } catch {}
  console.log(body);
} else if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [origin, ticket, delay, title, todo] = process.argv.slice(2);
  const room = ticketClaims(ticket)?.r;
  if (!origin || !Number.isSafeInteger(room)) { console.error('usage: later.mjs <origin> <ticket> <delay> <title> <todo> (ticket from your prompt)'); process.exit(2); }
  const res = await fetch(new URL(`/collab/api/rooms/${room}/later`, origin), { method: 'POST',
    headers: { 'content-type': 'application/json', 'x-later-ticket': ticket }, body: JSON.stringify({ delay, title, todo }) });
  const body = await res.text();
  if (!res.ok) { console.error(`later: ${res.status} ${body}`); process.exit(1); }
  console.log(body);
}
