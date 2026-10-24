// Durable workspace questions; system forwards never enter agent routing.
import { randomBytes } from 'node:crypto';
import { ensureHandoffs } from './store.mjs';

export function exitTarget(msg) {
  return /^team-answer:([^:]+):/.exec(msg.client_key ?? '')?.[1];
}

export class TeamExit {
  constructor(hub) {
    this.hub = hub;
    this.db = hub.store.db;
    this.enabled = this.db.prepare('PRAGMA table_info(rooms)').all().some(c => c.name === 'parent_id');
    if (!this.enabled) return;
    this.db.exec(`CREATE TABLE IF NOT EXISTS team_exit_asks (
      id TEXT PRIMARY KEY, parent_id INTEGER NOT NULL, workspace_id INTEGER NOT NULL,
      member_id TEXT NOT NULL, forwarded_id INTEGER UNIQUE, source_id INTEGER UNIQUE,
      answer_source_id INTEGER UNIQUE, answered INTEGER NOT NULL DEFAULT 0)`);
    ensureHandoffs(this.db);
    hub.onMessage(msg => this.onMessage(msg));
  }

  answerFor(msg) {
    if (!this.enabled || msg.author_kind !== 'user' || exitTarget(msg)) return;
    const prior = this.db.prepare('SELECT * FROM team_exit_asks WHERE answer_source_id = ?').get(msg.id);
    if (prior) return prior;
    const token = /\bask-[0-9a-f]{8}\b/.exec(msg.text)?.[0];
    return this.db.prepare(`SELECT * FROM team_exit_asks WHERE parent_id = ? AND answered = 0
      AND (forwarded_id = ? OR id = ?) ORDER BY source_id LIMIT 1`).get(msg.room_id, msg.reply_to ?? null, token ?? null);
  }

  /** Chat room a workspace [ask]/[report] goes to: the handoff its text names, else the only
   *  chat with open handoffs here, else (none open) rooms.parent_id; null = ambiguous.
   *  A quoted id also finds a closed handoff; closed ones never make a plain one ambiguous. */
  origin(room, text) {
    const rows = this.db.prepare('SELECT id, parent_id, closed FROM team_exit_handoffs WHERE workspace_id = ?').all(room.id);
    for (const ref of text.match(/\btask-[0-9a-f]{8}\b/g) ?? []) {
      const hit = rows.find(r => r.id === ref);
      if (hit) return hit.parent_id;
    }
    const open = rows.filter(r => !r.closed);
    const chats = new Set(open.map(r => r.parent_id));
    if (chats.size === 0) return room.parent_id;
    if (chats.size === 1) return open[0].parent_id;
    return null;
  }

  onMessage(msg) {
    const answer = this.answerFor(msg);
    if (answer) {
      if (answer.answered) return;
      // Stable client key prevents duplicate delivery if acknowledgement is retried.
      const { message } = this.hub.post(answer.workspace_id, {
        authorKind: 'user', author: msg.author, name: msg.name,
        text: `@${answer.member_id} 用户回复 ${answer.id}：\n${msg.text}`,
        clientKey: `team-answer:${answer.member_id}:${answer.id}`,
      });
      this.db.prepare('UPDATE team_exit_asks SET answered = 1, answer_source_id = ? WHERE id = ?').run(msg.id, answer.id);
      return message;
    }
    if (msg.author_kind !== 'role' || msg.card != null) return;
    const mark = /^\[(ask|report)\]\s*\n([\s\S]+)$/i.exec(msg.text.trim());
    if (!mark) return;
    const room = this.db.prepare('SELECT * FROM rooms WHERE id = ?').get(msg.room_id);
    if (!room?.parent_id || room.parent_id === room.id) return;
    const parent = this.origin(room, mark[2]);
    if (parent == null) {
      // Tasks of several chat channels and the text names none: never guess the last claimer.
      const tasks = this.db.prepare('SELECT id, parent_id FROM team_exit_handoffs WHERE workspace_id = ? AND closed = 0 ORDER BY rowid DESC').all(room.id);
      this.hub.post(room.id, {
        authorKind: 'system', author: 'system', name: 'system', clientKey: `team-exit-ambiguous:${msg.id}`,
        text: `📬 没有转发：这个工作区手上有多个聊天频道交来的活，用下面的一个编号再发一次，第一行写 [ask] task-xxxxxxxx 或 [report] task-xxxxxxxx：\n${tasks.map(t => `${t.id} ← room-${t.parent_id}`).join('\n')}`,
      });
      return;
    }
    const ask = mark[1].toLowerCase() === 'ask';
    let record;
    if (ask) {
      this.db.prepare(`INSERT OR IGNORE INTO team_exit_asks (id, parent_id, workspace_id, member_id, source_id)
        VALUES (?, ?, ?, ?, ?)`).run(`ask-${randomBytes(4).toString('hex')}`, parent, room.id, msg.author, msg.id);
      record = this.db.prepare('SELECT * FROM team_exit_asks WHERE source_id = ?').get(msg.id);
    }
    const { message } = this.hub.post(parent, {
      authorKind: 'system', author: 'system', name: 'system', clientKey: `team-exit:${msg.id}`,
      text: `📬 来自 ${room.name} · ${msg.name}${ask ? ` · ${record.id}` : ' · 阶段结果'}\n${mark[2]}`,
    });
    if (ask) this.db.prepare('UPDATE team_exit_asks SET forwarded_id = ? WHERE id = ?').run(message.id, record.id);
  }
}
