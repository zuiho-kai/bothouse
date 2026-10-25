// Durable one-shot wakes for every channel member. The local CLI writes only
// the queue; the plugin owns delivery through the existing member routers.
import { DatabaseSync } from 'node:sqlite';
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
export class Later {
  constructor(hub, filename, wake, { now = Date.now, start = true } = {}) {
    this.hub = hub; this.db = hub.store.db; this.filename = filename; this.wake = wake; this.now = now;
    schema(this.db);
    if (start) this.start();
  }
  start() {
    this.tick();
    this.timer = setInterval(() => this.tick(), 1000);
    this.timer.unref();
  }
  instructions(member, room) {
    const quote = value => "'" + String(value).replaceAll("'", "'\\''") + "'";
    return `\n【一次性回查】要过会儿回来，用本机命令登记（重启后仍触发）：\n${quote(process.execPath)} ${quote(fileURLToPath(import.meta.url))} ${quote(this.filename)} ${quote(member)} ${room} 10m '事情' '到点要做什么'\n登记成功才说已挂；到点在原房间唤醒你。远程 cc-connect 成员可用自己的 timer，或 POST /collab/api/rooms/${room}/later（bot token 认证，JSON: member, delay, title, todo）。\n`;
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
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [filename, member, room, delay, title, todo] = process.argv.slice(2);
  const db = new DatabaseSync(filename); db.exec('PRAGMA busy_timeout=5000');
  try { console.log(JSON.stringify(registerLater(db, { member, room: Number(room), delay, title, todo }))); }
  finally { db.close(); }
}
