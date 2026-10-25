// Durable workspace questions; system forwards never enter agent routing.
import { randomBytes } from 'node:crypto';

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
    const ask = mark[1].toLowerCase() === 'ask';
    let record;
    if (ask) {
      this.db.prepare(`INSERT OR IGNORE INTO team_exit_asks (id, parent_id, workspace_id, member_id, source_id)
        VALUES (?, ?, ?, ?, ?)`).run(`ask-${randomBytes(4).toString('hex')}`, room.parent_id, room.id, msg.author, msg.id);
      record = this.db.prepare('SELECT * FROM team_exit_asks WHERE source_id = ?').get(msg.id);
    }
    const { message } = this.hub.post(room.parent_id, {
      authorKind: 'system', author: 'system', name: 'system', clientKey: `team-exit:${msg.id}`,
      text: `📬 来自 ${room.name} · ${msg.name}${ask ? ` · ${record.id}` : ' · 阶段结果'}\n${mark[2]}`,
    });
    if (ask) {
      this.db.prepare('UPDATE team_exit_asks SET forwarded_id = ? WHERE id = ?').run(message.id, record.id);
      const tasks = this.hub.tasks;
      if (tasks) {
        const taskId = /#(\d+)\b/.exec(mark[2])?.[1];
        const selected = taskId
          ? tasks.task(Number(taskId))
          : tasks.q.allBusy.all('assigned', 'accepted', 'asked', 'rework')
            .filter(t => t.room_id === room.id).at(-1);
        if (selected?.room_id === room.id) tasks.pauseTask(selected.id);
      }
    }
  }
}
