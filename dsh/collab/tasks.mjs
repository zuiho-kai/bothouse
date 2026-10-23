// Team mode B (#139): tasks dispatched in a channel. A lead assigns a task to a
// member, the member states 接/问/退/升 (API or the first line of its reply),
// hands it back bound to the delivery message, and the lead accepts or sends it
// back. Every step leaves one short system record in the task's room and, when
// that room is a workspace, in its chat channel; records never @ anyone and
// never start a bot turn (system rows are skipped by every router). One
// reminder @s the owner when the check time passes without a hand-back; if no
// waker can reach the owner (cloud-web bot offline, or not reconnected yet after
// a restart) the reminder stays pending and is delivered once when it comes online.
import { CollabError, MAX_TEXT } from './store.mjs';

/** Status codes and their labels (the eight names are a #139 B setting, not user-specified). */
export const STATUS = {
  assigned: '派出', accepted: '已接', asked: '有疑问', declined: '退回',
  escalated: '升级', returned: '交回', done: '完成', rework: '返工',
};
/** First-line stance marks used by the team (本机团队模式【接/问/退/升】). */
export const STANCES = { 接: 'accepted', 问: 'asked', 退: 'declined', 升: 'escalated' };
const STANCE_WORDS = { accept: '接', ask: '问', decline: '退', escalate: '升' };
/** The owner's turn: the check timer runs and the task counts as in progress. */
export const WORKING = ['assigned', 'accepted', 'asked', 'rework'];
/** Waiting for the lead: review may close or send back. */
const REVIEWABLE = ['returned', 'declined', 'escalated'];
// Default check time after dispatch or rework. Source: user 2026-10-23「这10分钟之内搞不完就滚蛋」.
export const CHECK_AFTER_S = 10 * 60;
// setTimeout's own maximum delay (Node clamps anything larger to 1 ms).
const MAX_TIMER_MS = 2 ** 31 - 1;
const STANCE_LINE = /^\s*【(接|问|退|升)】\s*(?:#(\d+))?\s*(.*)$/;
const HUMAN = 'owner';
const PLACEHOLDERS = WORKING.map(() => '?').join(', ');

export class Tasks {
  /**
   * @param hub - Hub (store, members, post, emit).
   * @param options - { now?(): seconds, setTimer?, clearTimer? } (tests drive the clock);
   *   start: false defers the timer and pending deliveries until start() (the plugin
   *   starts after DSH recovery, so a reminder job is never mistaken for a leftover).
   */
  constructor(hub, { now = () => Date.now() / 1000, setTimer = setTimeout, clearTimer = clearTimeout, start = true } = {}) {
    this.hub = hub;
    this.store = hub.store;
    this.db = hub.store.db;
    this.now = now;
    this.setTimer = setTimer;
    this.clearTimer = clearTimer;
    this.timer = undefined;
    this.closed = false;
    this.started = false;
    /** wake(memberId, message) -> start that member on the reminder (DSH member or cloud-web bot). */
    this.wakers = [];
    const cols = new Set(this.db.prepare('PRAGMA table_info(rooms)').all().map(c => c.name));
    // rooms.kind/parent_id come with team mode A (#134); without them every room is its own chat channel.
    this.tree = cols.has('parent_id') && cols.has('kind');
    this.q = {
      get: this.db.prepare('SELECT * FROM tasks WHERE id = ?'),
      add: this.db.prepare(`INSERT INTO tasks (room_id, parent_task, title, owner, created_by, status, next_check_at, assign_msg_id, created_at, updated_at, reason)
        VALUES (?, ?, ?, ?, ?, 'assigned', ?, ?, ?, ?, ?) RETURNING *`),
      // The last ? keeps (1) or drops (0) an undelivered reminder: only 接/问 stay the owner's turn.
      set: this.db.prepare('UPDATE tasks SET status = ?, next_check_at = ?, note = ?, updated_at = ?, remind_msg_id = CASE WHEN ? THEN remind_msg_id END WHERE id = ? AND status = ? RETURNING *'),
      handBack: this.db.prepare(`UPDATE tasks SET status = 'returned', next_check_at = NULL, remind_msg_id = NULL, result_msg_id = ?, returned_at = ?, updated_at = ?
        WHERE id = ? AND status = ? RETURNING *`),
      bindAssign: this.db.prepare('UPDATE tasks SET assign_msg_id = ? WHERE id = ? AND assign_msg_id IS NULL'),
      due: this.db.prepare(`SELECT * FROM tasks WHERE next_check_at IS NOT NULL AND next_check_at <= ?
        AND status IN (${PLACEHOLDERS}) ORDER BY next_check_at, id`),
      // Posting the reminder and marking it undelivered is one step; the check time is spent.
      unremind: this.db.prepare('UPDATE tasks SET next_check_at = NULL, remind_msg_id = ? WHERE id = ? AND next_check_at IS NOT NULL RETURNING *'),
      undelivered: this.db.prepare(`SELECT * FROM tasks WHERE remind_msg_id IS NOT NULL AND status IN (${PLACEHOLDERS}) ORDER BY id`),
      // Clear before waking (a success is never re-sent); restore only if nobody took it.
      takeRemind: this.db.prepare('UPDATE tasks SET remind_msg_id = NULL WHERE id = ? AND remind_msg_id = ? RETURNING *'),
      putRemind: this.db.prepare('UPDATE tasks SET remind_msg_id = ? WHERE id = ? AND remind_msg_id IS NULL'),
      next: this.db.prepare(`SELECT MIN(next_check_at) AS at FROM tasks WHERE next_check_at IS NOT NULL AND status IN (${PLACEHOLDERS})`),
      active: this.db.prepare(`SELECT COUNT(*) AS n FROM tasks WHERE room_id = ? AND status IN (${PLACEHOLDERS})`),
      // A stance line without #id only answers a dispatch the owner has not answered yet.
      latestAssigned: this.db.prepare("SELECT * FROM tasks WHERE room_id = ? AND owner = ? AND status = 'assigned' ORDER BY id DESC LIMIT 1"),
      children: this.tree ? this.db.prepare("SELECT id FROM rooms WHERE kind = 'workspace' AND parent_id = ? ORDER BY id") : undefined,
    };
    hub.onMessage(message => this.fromMessage(message));
    // A member coming online (cloud-web register, DSH member published) gets its pending reminders.
    this.unsubscribe = hub.subscribe(event => { if (event.type === 'members') this.deliverPending(); });
    if (start) this.start();
  }

  /** Arm the check timer and deliver reminders left undelivered (e.g. before a restart). */
  start() {
    if (this.started || this.closed) return;
    this.started = true;
    this.deliverPending();
    this.arm();
  }

  /** wake(memberId, message) returns true when it started that member on the message. */
  onWake(fn) { this.wakers.push(fn); }

  close() {
    this.closed = true;
    this.unsubscribe?.();
    if (this.timer !== undefined) this.clearTimer(this.timer);
    this.timer = undefined;
  }

  task(id) { return this.q.get.get(id); }

  /** The chat channel a room belongs to (itself unless it is a workspace). */
  chatOf(roomId) {
    const room = this.store.room(roomId);
    if (room === undefined) return undefined;
    return this.tree && room.kind === 'workspace' && room.parent_id != null ? room.parent_id : room.id;
  }

  /** Tasks on a chat channel's board: the channel itself and its workspaces, newest first. */
  list(roomId) {
    const chat = this.chatOf(roomId);
    if (chat === undefined) throw new CollabError('room-missing', `room ${roomId} does not exist`);
    const rooms = [chat, ...(this.tree ? this.q.children.all(chat).map(r => r.id) : [])];
    const rows = this.db.prepare(`SELECT * FROM tasks WHERE room_id IN (${rooms.map(() => '?').join(', ')}) ORDER BY id DESC`).all(...rooms);
    return rows.map(r => this.view(r));
  }

  /** In-progress tasks in one room (the "进行中 N 件" next to it in the channel list). */
  countActive(roomId) { return this.q.active.get(roomId, ...WORKING).n; }

  /** Public task row: codes plus display names. */
  view(t) {
    return {
      id: t.id, room_id: t.room_id, parent_task: t.parent_task, title: t.title,
      owner: t.owner, owner_name: this.nameOf(t.owner), created_by: t.created_by, created_by_name: this.nameOf(t.created_by),
      status: t.status, next_check_at: t.next_check_at, assign_msg_id: t.assign_msg_id, result_msg_id: t.result_msg_id,
      note: t.note, reason: t.reason, created_at: t.created_at, updated_at: t.updated_at, returned_at: t.returned_at,
    };
  }

  nameOf(id) { return this.hub.members.get(id)?.name ?? id; }

  /**
   * Dispatch: the actor (the lead for this task) assigns `title` in `roomId` to member `owner`.
   * `reason` is the dispatcher's own one-line why-this-member, shown in the record (team mode C).
   */
  assign({ roomId, title, owner, actor, parentTask, messageId, reason }) {
    const room = this.store.room(roomId);
    if (room === undefined) throw new CollabError('room-missing', `room ${roomId} does not exist`);
    const text = String(title ?? '').trim();
    if (!text || text.length > MAX_TEXT) throw new CollabError('invalid', 'task title is empty or too long');
    this.member(owner);
    this.member(actor);
    if (parentTask != null && this.task(parentTask) === undefined) throw new CollabError('task-missing', `task ${parentTask} does not exist`);
    if (messageId != null && this.store.message(messageId) === undefined) throw new CollabError('invalid', `message ${messageId} does not exist`);
    const now = this.now();
    const why = clip(reason);
    const task = this.q.add.get(roomId, parentTask ?? null, text, owner, actor, now + CHECK_AFTER_S, messageId ?? null, now, now, why);
    const record = this.record(task, 'assign', `派活 #${task.id}「${task.title}」→ ${this.nameOf(owner)}（${this.nameOf(actor)} 派）${why ? `，理由：${why}` : ''}`);
    if (messageId == null) this.q.bindAssign.run(record.id, task.id);
    return this.changed(task.id);
  }

  /** The owner states 接/问/退/升 (also accept/ask/decline/escalate). */
  stance(id, { actor, stance, note }) {
    const mark = STANCES[stance] !== undefined ? stance : STANCE_WORDS[stance];
    if (mark === undefined) throw new CollabError('invalid', 'stance must be one of 接 问 退 升');
    const task = this.mustTask(id);
    if (actor !== task.owner && actor !== HUMAN) throw new CollabError('forbidden', `only ${this.nameOf(task.owner)} can answer task ${id}`);
    if (!WORKING.includes(task.status)) throw new CollabError('conflict', `task ${id} is ${STATUS[task.status]}, not waiting for its owner`);
    const status = STANCES[mark];
    // 退/升 hand the turn to the lead: the reminder is cancelled.
    const check = status === 'declined' || status === 'escalated' ? null : task.next_check_at;
    const row = this.q.set.get(status, check, clip(note), this.now(), check === null ? 0 : 1, id, task.status);
    if (row === undefined) throw new CollabError('conflict', `task ${id} changed meanwhile`);
    const tail = row.note ? `：${row.note}` : '';
    this.record(row, 'stance', `#${id}「${row.title}」${this.nameOf(row.owner)} 表态【${mark}】${tail}`);
    return this.changed(id);
  }

  /** The owner hands the task back, bound to the delivery message; the reminder is cancelled. */
  handBack(id, { actor, messageId }) {
    const task = this.mustTask(id);
    if (actor !== task.owner && actor !== HUMAN) throw new CollabError('forbidden', `only ${this.nameOf(task.owner)} can hand back task ${id}`);
    if (!WORKING.includes(task.status)) throw new CollabError('conflict', `task ${id} is ${STATUS[task.status]}, nothing to hand back`);
    if (messageId == null || this.store.message(messageId) === undefined) throw new CollabError('invalid', 'message_id must name the delivery message');
    const now = this.now();
    const row = this.q.handBack.get(messageId, now, now, id, task.status);
    if (row === undefined) throw new CollabError('conflict', `task ${id} changed meanwhile`);
    this.record(row, 'return', `#${id}「${row.title}」${this.nameOf(row.owner)} 交回，用时 ${duration(row.returned_at - row.created_at)}`);
    return this.changed(id);
  }

  /** The lead (or the human owner) closes the task or sends it back for rework. */
  review(id, { actor, verdict, note }) {
    const task = this.mustTask(id);
    if (actor !== task.created_by && actor !== HUMAN) throw new CollabError('forbidden', `only ${this.nameOf(task.created_by)} can review task ${id}`);
    if (!REVIEWABLE.includes(task.status)) throw new CollabError('conflict', `task ${id} is ${STATUS[task.status]}, nothing to review`);
    if (verdict !== 'done' && verdict !== 'rework') throw new CollabError('invalid', 'verdict must be done or rework');
    // Rework is a new round with the same check time as a dispatch (source above).
    const check = verdict === 'rework' ? this.now() + CHECK_AFTER_S : null;
    const row = this.q.set.get(verdict, check, clip(note) ?? task.note, this.now(), 0, id, task.status);
    if (row === undefined) throw new CollabError('conflict', `task ${id} changed meanwhile`);
    const tail = clip(note) ? `：${clip(note)}` : '';
    this.record(row, verdict, verdict === 'done'
      ? `#${id}「${row.title}」验收完成（${this.nameOf(actor)}）`
      : `#${id}「${row.title}」返工 → ${this.nameOf(row.owner)}（${this.nameOf(actor)}）${tail}`);
    return this.changed(id);
  }

  /**
   * One API action (#139 B) for a sender. `verified` says the actor comes from
   * the connection or session (owner's browser, a cloud-web bot's socket, the
   * author of a member's message), not from a self-reported body field.
   * Unverified actors (body.actor under the shared bot token) must name an
   * existing non-human member and can never review: acceptance only counts
   * from the dispatcher or the human owner when the server knows who it is.
   * @param action - assign | stance | return | review.
   * @param args - { id?: task id, roomId?: room for assign, body: request fields }.
   */
  perform(action, { id, roomId, body = {} }, { actor, verified }) {
    actor = String(actor ?? '');
    if (!verified) {
      const m = this.hub.members.get(actor);
      if (!actor || actor === HUMAN || m === undefined || m.kind === 'human') throw new CollabError('forbidden', 'actor must name an existing member other than the owner');
      if (action === 'review') throw new CollabError('forbidden', 'review needs a verified sender: the dispatcher over its own connection, or the owner');
    }
    const optional = v => (v == null || v === '' ? undefined : Number(v));
    switch (action) {
      case 'assign': return this.assign({ roomId, title: body.title, owner: String(body.owner ?? ''), actor, parentTask: optional(body.parent_task), messageId: optional(body.message_id), reason: body.reason });
      case 'stance': return this.stance(id, { actor, stance: String(body.stance ?? ''), note: body.note });
      case 'return': return this.handBack(id, { actor, messageId: optional(body.message_id) });
      case 'review': return this.review(id, { actor, verdict: String(body.verdict ?? ''), note: body.note });
      default: throw new CollabError('invalid', 'action must be assign, stance, return or review');
    }
  }

  /** A member reply whose first line is 【接】【问】【退】【升】 (optionally #id) answers its task. */
  fromMessage(msg) {
    if (msg.author_kind !== 'role' || msg.card !== null) return undefined;
    const first = String(msg.text).split('\n', 1)[0];
    const m = STANCE_LINE.exec(first);
    if (m === null) return undefined;
    // Members open every reply with a stance, so without #id only a not-yet-answered
    // dispatch counts; once answered, changing that task needs its #id.
    const task = m[2] !== undefined ? this.task(Number(m[2]))
      : this.q.latestAssigned.get(msg.room_id, msg.author);
    if (task === undefined || task.owner !== msg.author || !WORKING.includes(task.status)) return undefined;
    return this.stance(task.id, { actor: msg.author, stance: m[1], note: m[3] });
  }

  /** Post the reminder for every task past its check time, once each, and wake its owner. */
  tick() {
    if (this.closed || !this.started) return;
    for (const task of this.q.due.all(this.now(), ...WORKING)) {
      const name = this.nameOf(task.owner);
      const { message } = this.hub.post(task.room_id, {
        authorKind: 'system', author: 'system', name: '任务提醒',
        text: `@${name} 任务 #${task.id}「${task.title}」到了检查时间还没交回：请交回结果，或说明卡在哪。`,
      });
      // The check time is spent and the reminder is marked undelivered in one update.
      if (this.q.unremind.get(message.id, task.id) === undefined) continue;
      this.deliver(task.id, message.id);
      this.changed(task.id);
    }
    this.arm();
  }

  /** Retry every undelivered reminder whose task is still the owner's turn. */
  deliverPending() {
    if (this.closed || !this.started) return;
    for (const task of this.q.undelivered.all(...WORKING)) this.deliver(task.id, task.remind_msg_id);
  }

  /** Wake the owner on one reminder; it stays pending unless some waker took it. */
  deliver(taskId, msgId) {
    if (this.delivering) return;
    const message = this.store.message(msgId);
    const task = this.q.takeRemind.get(taskId, msgId);
    if (task === undefined) return;
    if (message === undefined) return;
    let taken = false;
    this.delivering = true;
    try {
      for (const wake of this.wakers) {
        try { if (wake(task.owner, message)) { taken = true; break; } } catch (error) { this.hub.logger.warn('collab: task reminder wake failed: %s', error?.message ?? error); }
      }
    } finally { this.delivering = false; }
    if (!taken) this.q.putRemind.run(msgId, taskId);
  }

  /** Schedule tick() for the earliest pending check time. */
  arm() {
    if (this.timer !== undefined) this.clearTimer(this.timer);
    this.timer = undefined;
    if (this.closed) return;
    const at = this.q.next.get(...WORKING).at;
    if (at == null) return;
    const ms = Math.min(MAX_TIMER_MS, Math.max(0, (at - this.now()) * 1000));
    this.timer = this.setTimer(() => { this.timer = undefined; this.tick(); }, ms);
    this.timer?.unref?.();
  }

  member(id) {
    if (id === HUMAN || this.hub.members.has(id)) return;
    throw new CollabError('member-missing', `member ${JSON.stringify(id)} is not in this channel`);
  }

  mustTask(id) {
    const task = this.task(id);
    if (task === undefined) throw new CollabError('task-missing', `task ${id} does not exist`);
    return task;
  }

  /** One system record (task card) in the task room and, for a workspace, its chat channel. */
  record(task, event, text) {
    const card = JSON.stringify({ kind: 'task', task_id: task.id, event });
    const m = { authorKind: 'system', author: 'system', name: '任务', text, card };
    const { message } = this.hub.post(task.room_id, m);
    const chat = this.chatOf(task.room_id);
    if (chat !== undefined && chat !== task.room_id) this.hub.post(chat, m);
    return message;
  }

  changed(id) {
    const task = this.view(this.task(id));
    this.hub.emit({ type: 'task', task, chat_id: this.chatOf(task.room_id), active: this.countActive(task.room_id) });
    this.arm();
    return task;
  }
}

function clip(note) {
  const s = String(note ?? '').trim();
  return s ? s.slice(0, MAX_TEXT) : null;
}

/** 用时 as records show it (unit conversions only). */
export function duration(seconds) {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s} 秒`;
  if (s < 3600) return `${Math.round(s / 60)} 分钟`;
  const h = Math.floor(s / 3600);
  const m = Math.round((s % 3600) / 60);
  return m ? `${h} 小时 ${m} 分` : `${h} 小时`;
}
