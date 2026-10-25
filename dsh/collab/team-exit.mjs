// Durable workspace questions; system forwards never enter agent routing.
import { randomBytes } from 'node:crypto';

export function exitTarget(msg) {
  return /^team-answer:([^:]+):/.exec(msg.client_key ?? '')?.[1];
}

// #574 B4: an [ask] must carry 「自验：」 (evidence) and 「类别：」 before it waits on
// the user; only 方向、花钱、需要用户看的成品、权限确认 may write 「自验：无需」.
// Same check in the Go bridge: bridge/core/team_ask_evidence.go askEvidenceProblems.
const SELF_CHECK = /自验\s*[：:]/;
const CATEGORY = /类别\s*[：:]/;
const EXEMPT = /方向|花钱|成品|权限/;
const NO_CHECK = /^(无需|不需要|无|免)([\s，。,.;；（(]|$)/;
export const ASK_MISSING_SELF_CHECK = '缺「自验：」（附证据：截图或命令输出）';
export const ASK_MISSING_CATEGORY = '缺「类别：」（方向、花钱、需要用户看的成品、权限确认之一，或写别的类别）';
export const ASK_NO_CHECK_NOT_EXEMPT = '「自验：无需」只限方向、花钱、需要用户看的成品、权限确认四类，其它类别要附证据';
// Consecutive bounces that still wake the asking member; later ones are only posted.
const BOUNCE_WAKE_LIMIT = 2;

/** What an [ask] body lacks; [] means it may go to the user. */
export function askEvidenceProblems(body) {
  const cat = CATEGORY.exec(body);
  const category = cat ? body.slice(cat.index + cat[0].length).split('\n')[0].trim() : '';
  const own = SELF_CHECK.exec(body);
  let check = '';
  if (own) {
    let rest = body.slice(own.index + own[0].length);
    const next = CATEGORY.exec(rest);
    if (next) rest = rest.slice(0, next.index);
    check = rest.trim();
  }
  const problems = [];
  if (!check) problems.push(ASK_MISSING_SELF_CHECK);
  if (!category) problems.push(ASK_MISSING_CATEGORY);
  if (check && category && NO_CHECK.test(check) && !EXEMPT.test(category)) problems.push(ASK_NO_CHECK_NOT_EXEMPT);
  return problems;
}

export function askBounceText(problems) {
  return `这条 [ask] 没有转给用户：${problems.join('；')}。补上后重发：第一行只写 [ask]，正文写「自验：」附证据和「类别：」；`
    + '方向、花钱、需要用户看的成品、权限确认四类可写「自验：无需」。';
}

const FIRST_MARK = /^\[(ask|report)\][ \t]*\n?([\s\S]*\S[\s\S]*)$/i;
const LINE_MARK = /(?:^|\n)[ \t]*\[(ask|report)\][ \t]*/gi;

/**
 * The [ask] / [report] mark of a role reply: { kind, body } or undefined. Marked on the first
 * line, as the bridge reads it (core/team_exit.go parseExitKind, first line only). lastLine (a
 * DSH member, whose reply is one row for the whole turn: first line 【接】#id, then everything it
 * said) also takes the line starting the turn's last part: the last line that opens with the mark.
 */
export function exitMark(text, { lastLine = false } = {}) {
  const t = String(text ?? '').trim();
  let m = FIRST_MARK.exec(t);
  if (m === null && lastLine) {
    const last = [...t.matchAll(LINE_MARK)].at(-1);
    if (last !== undefined) m = FIRST_MARK.exec(`[${last[1]}]${t.slice(last.index + last[0].length)}`);
  }
  return m === null ? undefined : { kind: m[1].toLowerCase(), body: m[2] };
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
    this.bounces = new Map(); // `${room}:${member}` -> consecutive [ask] bounces
    hub.onMessage(msg => this.onMessage(msg));
  }

  /** Post why the [ask] stayed in the workspace and wake its author to fix it. */
  bounce(room, msg, problems) {
    const key = `${room.id}:${msg.author}`;
    const count = (this.bounces.get(key) ?? 0) + 1;
    this.bounces.set(key, count);
    const { message } = this.hub.post(room.id, {
      authorKind: 'system', author: 'system', name: 'system', clientKey: `team-exit-bounce:${msg.id}`,
      text: `📬 @${msg.name} ${askBounceText(problems)}`,
    });
    if (count > BOUNCE_WAKE_LIMIT) return;
    for (const wake of this.hub.tasks?.wakers ?? []) {
      try { if (wake(msg.author, message)) break; } catch (error) { this.hub.logger?.warn?.('collab: ask bounce wake failed: %s', error?.message ?? error); }
    }
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
    if (msg.author_kind !== 'role') return;
    const mark = msg.card == null ? exitMark(msg.text, this.markOpts(msg)) : undefined;
    const room = this.workspaceOf(msg);
    if (!room) return;
    const ask = mark?.kind === 'ask';
    if (ask) {
      const problems = askEvidenceProblems(mark.body);
      if (problems.length) return this.bounce(room, msg, problems);
    }
    // Any reply without a bounced [ask] ends the run of bounces.
    this.bounces.delete(`${room.id}:${msg.author}`);
    if (!mark) return;
    let record;
    if (ask) {
      this.db.prepare(`INSERT OR IGNORE INTO team_exit_asks (id, parent_id, workspace_id, member_id, source_id)
        VALUES (?, ?, ?, ?, ?)`).run(`ask-${randomBytes(4).toString('hex')}`, room.parent_id, room.id, msg.author, msg.id);
      record = this.db.prepare('SELECT * FROM team_exit_asks WHERE source_id = ?').get(msg.id);
    }
    const message = this.forward(room, msg, mark.body, record);
    if (ask) {
      this.db.prepare('UPDATE team_exit_asks SET forwarded_id = ? WHERE id = ?').run(message.id, record.id);
      const tasks = this.hub.tasks;
      // #597 G35: a DSH member's [ask] keeps its task in work and watched (and its workspace, so the
      // answer reaches the same session); a bridge bot's [ask] parks it as before (#280).
      if (tasks && !this.markOpts(msg).lastLine) {
        const taskId = /任务\s*#(\d+)\b/.exec(mark.body)?.[1];
        const inRoom = tasks.q.allBusy.all('assigned', 'accepted', 'asked', 'rework')
          .filter(t => t.room_id === room.id);
        const marked = taskId ? tasks.task(Number(taskId)) : undefined;
        const selected = marked?.room_id === room.id ? marked : inRoom[0];
        if (selected?.room_id === room.id) tasks.pauseTask(selected.id);
      }
    }
  }

  /** A DSH member's one-row reply may carry its mark on a later line; a bridge bot's only on the first. */
  markOpts(msg) {
    return { lastLine: this.hub.members?.get(msg.author)?.kind === 'dsh' };
  }

  /** The workspace room msg was posted in (with a chat channel above it), or undefined. */
  workspaceOf(msg) {
    if (!this.enabled) return undefined;
    const room = this.db.prepare('SELECT * FROM rooms WHERE id = ?').get(msg.room_id);
    return room?.parent_id && room.parent_id !== room.id ? room : undefined;
  }

  /**
   * Copy a workspace reply into its chat channel (once per source row: a repeated client key
   * returns the copy already posted). ask: its team_exit_asks record; otherwise a 阶段结果.
   */
  forward(room, msg, body, ask) {
    return this.hub.post(room.parent_id, {
      authorKind: 'system', author: 'system', name: 'system', clientKey: `team-exit:${msg.id}`,
      text: `📬 来自 ${room.name} · ${msg.name}${ask ? ` · ${ask.id}` : ' · 阶段结果'}\n${body}`,
    }).message;
  }

  /**
   * The delivery msg of a workspace task, copied into the chat channel (Tasks.handBack): its
   * [report] body, already forwarded by onMessage, or else the reply without its stance line, so
   * the chat channel always gets the result and not only the 交回 record. undefined outside a
   * workspace and for an [ask] (a question, not a result).
   */
  forwardResult(msg) {
    const room = this.workspaceOf(msg);
    if (!room || msg.author_kind !== 'role' || msg.card != null) return undefined;
    const mark = exitMark(msg.text, this.markOpts(msg));
    if (mark?.kind === 'ask') return undefined;
    const lines = String(msg.text).trim().split('\n');
    if (/^\s*(?:@\S+\s+)*【(接|问|退|升)】/.test(lines[0])) lines.shift();
    const body = mark?.body ?? (lines.join('\n').trim() || String(msg.text).trim());
    return this.forward(room, msg, body);
  }
}
