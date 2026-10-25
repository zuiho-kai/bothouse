// Durable one-shot wakes for every channel member. Registration goes through the
// plugin's HTTP route and is bound to (member, room) by an HMAC ticket the plugin
// hands each member with its prompt; the plugin owns delivery through the member routers.
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { closeSync, fsyncSync, openSync, readFileSync, renameSync, unlinkSync, writeSync } from 'node:fs';
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
export class Later {
  constructor(hub, filename, wake, { now = Date.now, start = true, keyFile = filename === ':memory:' ? undefined : join(dirname(filename), 'later.key') } = {}) {
    this.hub = hub; this.db = hub.store.db; this.filename = filename; this.wake = wake; this.now = now;
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
  instructions(member, room) {
    const quote = value => "'" + String(value).replaceAll("'", "'\\''") + "'";
    const ticket = this.ticket(member, room);
    const local = this.origin ? `用本机命令登记（重启后仍触发）：\n${quote(process.execPath)} ${quote(fileURLToPath(import.meta.url))} ${quote(this.origin)} ${quote(ticket)} 10m '事情' '到点要做什么'\n` : '';
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
    const local = this.origin ? `首选本机命令（直接复制，改后三个参数）：\n${quote(process.execPath)} ${quote(fileURLToPath(import.meta.url))} workspace ${quote(this.origin)} ${quote(ticket)} '任务标题' '接活人id（空串=你自己）' '交接说明'\n` : '';
    // #597 G26: a member once sent the ticket to /tasks and gave up on the 401; spell out the one call.
    const url = `${this.origin ?? 'http://<本机 DSH 地址>'}/collab/api/rooms/${room}/workspaces`;
    const curl = `curl -sS -X POST ${quote(url)} -H 'content-type: application/json' -H ${quote(`X-Later-Ticket: ${ticket}`)} -d '{"title":"任务标题","owner":"接活人id（省略=你自己）","reason":"交接说明"}'`;
    return `\n【开工作区】整块活要交出去时，建工作区=这一条，任务和十分钟看门会自动开，不要另调 /tasks（它不认票据）。${local}或等价的接口 POST /collab/api/rooms/${room}/workspaces：\n${curl}\n一步建好工作区、开任务、挂十分钟看门并叫醒接活人；不要再在频道里 @ 同一件活。返回不是 200 就把返回原样告诉用户，不要悄悄自己做。工作区里的接活人是新会话，只看得到交接说明：里面要写清用户原话、参照的现成实现、以哪个分支为底、验收标准。\n`;
  }
  tick() {
    for (const row of this.db.prepare('SELECT * FROM member_later WHERE announced = 0').all()) {
      this.hub.post(row.room_id, { authorKind: 'system', author: 'system', name: '回查登记',
        clientKey: `member-later-${row.id}-registered`,
        text: `${row.member_id}「${row.title}」：下次看 ${new Date(row.due_at).toISOString()}，到点：${row.todo}` });
      this.db.prepare('UPDATE member_later SET announced = 1 WHERE id = ?').run(row.id);
    }
    for (const row of this.db.prepare('SELECT * FROM member_later WHERE delivered = 0 AND due_at <= ? ORDER BY id').all(this.now())) {
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
  if (!origin || !Number.isSafeInteger(room) || !title) { console.error('usage: later.mjs workspace <origin> <ticket> <title> [owner] [reason] (ticket from your prompt; owner \'\' = yourself)'); process.exit(2); }
  const res = await fetch(new URL(`/collab/api/rooms/${room}/workspaces`, origin), { method: 'POST',
    headers: { 'content-type': 'application/json', 'x-later-ticket': ticket }, body: JSON.stringify({ title, ...(owner ? { owner } : {}), ...(reason ? { reason } : {}) }) });
  const body = await res.text();
  if (!res.ok) { console.error(`workspace: ${res.status} ${body}`); process.exit(1); }
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
