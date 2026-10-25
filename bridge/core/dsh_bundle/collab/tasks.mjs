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
import { mentions, nameCalled, split } from './mentions.mjs';
import { NOTICE_PREFIXES } from './cloudweb.mjs';

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
// Workspace watch (#574 B2, same rule as contrib/lead/d10-fire MAX_RENEW): at the check time a
// workspace task with new role messages since its window opened gets another CHECK_AFTER_S, at
// most MAX_RENEWALS times; otherwise it is parked (paused queue). Replaces the old one-hour park.
// Source: 聊天频道橘 10-25 15:19 「有新进展续 10 分钟，最多续 2 次，没有就暂停」.
export const MAX_RENEWALS = 2;
// setTimeout's own maximum delay (Node clamps anything larger to 1 ms).
const MAX_TIMER_MS = 2 ** 31 - 1;
const STANCE_LINE = /^\s*【(接|问|退|升)】\s*(?:#(\d+))?\s*(.*)$/;
const HUMAN = 'owner';
const PLACEHOLDERS = WORKING.map(() => '?').join(', ');
// A paused task (park: the bridge released its workspace with the task stopped at a clean
// point) keeps its status but is not in progress: no check timer, not counted. Any status
// change by its owner or the lead (stance, hand-back, review) resumes it.
const LIVE = `status IN (${PLACEHOLDERS}) AND paused_at IS NULL`;
// #574 dispatch fields (same checks as contrib/lead/ws-handoff has_ref_impl/multi_editor/has_base,
// user 2026-10-25 「交活带参照实现，非代码活写『无（新建）』算过」): `ref` names the existing
// implementation to follow as `file:line`, or 无（新建） for work with none; when the task says
// several members edit the same files (「共改文件」/「多人改」) it also needs `base`, the branch to start from.
const REF_RE = /[~\w.\-/]*[A-Za-z_][~\w.\-/]*:\d+/g;
const NO_REF = /^无\s*[（(]\s*新建\s*[)）]/;
export const MISSING_REF = '缺参照实现：写 文件:行，非代码活写「无（新建）」';
const REF_EXAMPLE = '示例：ref: "dsh/collab/tasks.mjs:226"，或 ref: "无（新建）"';
const MISSING_BASE = '多人改同组文件要写底分支：base 填分支名，示例：base: "feat/approvals-card"';
const MISSING_REWORK_NOTE = '返工要写原因：note 填为什么打回，示例：note: "没先读现有实现"';

/** True when ref is 无（新建） or holds at least one `path:line` (path with / or ., so 14:30 does not count). */
export function hasRef(ref) {
  const s = String(ref ?? '').trim();
  if (NO_REF.test(s)) return true;
  return (s.match(REF_RE) ?? []).some(m => m.includes('/') || m.split(':')[0].includes('.'));
}

/** The task says several members edit the same files. */
export function multiEditor(text) { return /共改文件|多人改/.test(String(text ?? '')); }

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
    /** released(roomId) -> a workspace finished its last task and went back to the pool. */
    this.releasers = [];
    const cols = new Set(this.db.prepare('PRAGMA table_info(rooms)').all().map(c => c.name));
    // rooms.kind/parent_id come with team mode A (#134); without them every room is its own chat channel.
    this.tree = cols.has('parent_id') && cols.has('kind');
    this.q = {
      get: this.db.prepare('SELECT * FROM tasks WHERE id = ?'),
      add: this.db.prepare(`INSERT INTO tasks (room_id, parent_task, title, owner, created_by, status, next_check_at, assign_msg_id, created_at, updated_at, reason, ref, base)
        VALUES (?, ?, ?, ?, ?, 'assigned', ?, ?, ?, ?, ?, ?, ?) RETURNING *`),
      // The last ? keeps (1) or drops (0) an undelivered reminder: only 接/问 stay the owner's turn.
      // A resumed (was paused) task starts a fresh watch: renewals back to 0 (rework: resetRenewals).
      set: this.db.prepare(`UPDATE tasks SET status = ?, paused_at = NULL, next_check_at = ?, note = ?, updated_at = ?, remind_msg_id = CASE WHEN ? THEN remind_msg_id END,
        renewals = CASE WHEN paused_at IS NOT NULL THEN 0 ELSE renewals END WHERE id = ? AND status = ? RETURNING *`),
      handBack: this.db.prepare(`UPDATE tasks SET status = 'returned', paused_at = NULL, next_check_at = NULL, remind_msg_id = NULL, result_msg_id = ?, returned_at = ?, updated_at = ?
        WHERE id = ? AND status = ? RETURNING *`),
      bindAssign: this.db.prepare('UPDATE tasks SET assign_msg_id = ? WHERE id = ? AND assign_msg_id IS NULL'),
      due: this.db.prepare(`SELECT * FROM tasks WHERE next_check_at IS NOT NULL AND next_check_at <= ?
        AND ${LIVE} ORDER BY next_check_at, id`),
      // Posting the reminder and marking it undelivered is one step; the check time is spent.
      unremind: this.db.prepare('UPDATE tasks SET next_check_at = NULL, remind_msg_id = ? WHERE id = ? AND next_check_at IS NOT NULL RETURNING *'),
      undelivered: this.db.prepare(`SELECT * FROM tasks WHERE remind_msg_id IS NOT NULL AND ${LIVE} ORDER BY id`),
      // Clear before waking (a success is never re-sent); restore only if nobody took it.
      takeRemind: this.db.prepare('UPDATE tasks SET remind_msg_id = NULL WHERE id = ? AND remind_msg_id = ? RETURNING *'),
      putRemind: this.db.prepare('UPDATE tasks SET remind_msg_id = ? WHERE id = ? AND remind_msg_id IS NULL'),
      active: this.db.prepare(`SELECT COUNT(*) AS n FROM tasks WHERE room_id = ? AND ${LIVE}`),
      paused: this.db.prepare(`SELECT COUNT(*) AS n FROM tasks WHERE room_id = ? AND status IN (${PLACEHOLDERS}) AND paused_at IS NOT NULL`),
      ownerSaid: this.db.prepare("SELECT text FROM messages WHERE room_id = ? AND author_kind = 'role' AND author = ? AND card IS NULL AND deleted = 0 AND created_at > ?"),
      // paused_chat: the chat channel that owned the workspace when the task was paused (resumeClaim).
      resetRenewals: this.db.prepare('UPDATE tasks SET renewals = 0 WHERE id = ?'),
      renew: this.db.prepare(`UPDATE tasks SET next_check_at = ?, renewals = ? WHERE id = ? AND ${LIVE} RETURNING *`),
      park: this.db.prepare(`UPDATE tasks SET paused_at = ?, paused_chat = ?, next_check_at = NULL WHERE room_id = ? AND ${LIVE}`),
      busyOfOwner: this.db.prepare(`SELECT * FROM tasks WHERE owner = ? AND ${LIVE} ORDER BY updated_at DESC`),
      allBusy: this.db.prepare(`SELECT * FROM tasks WHERE ${LIVE} ORDER BY updated_at DESC`),
      // A stance line without #id only answers a dispatch the owner has not answered yet.
      latestAssigned: this.db.prepare("SELECT * FROM tasks WHERE room_id = ? AND owner = ? AND status = 'assigned' ORDER BY id DESC LIMIT 1"),
      // Chat-side tasks (source 'mention' / 'card'): opened from the lead's @ or the bridge task card.
      setSource: this.db.prepare('UPDATE tasks SET source = ? WHERE id = ?'),
      openChat: this.db.prepare(`SELECT * FROM tasks WHERE room_id = ? AND owner = ? AND created_by = ? AND source IS NOT NULL
        AND status IN (${PLACEHOLDERS}) ORDER BY id DESC LIMIT 1`),
      returnedChat: this.db.prepare("SELECT * FROM tasks WHERE room_id = ? AND created_by = ? AND source IS NOT NULL AND status = 'returned' ORDER BY id"),
      children: this.tree ? this.db.prepare("SELECT id FROM rooms WHERE kind = 'workspace' AND parent_id = ? ORDER BY id") : undefined,
      // #597 G24: a job the lead already handed to one of this chat channel's workspaces.
      openHanded: this.tree ? this.db.prepare(`SELECT * FROM tasks WHERE owner = ? AND created_by = ? AND source = 'workspace'
        AND status IN (${PLACEHOLDERS}) AND room_id IN (SELECT id FROM rooms WHERE kind = 'workspace' AND parent_id = ?) ORDER BY id DESC LIMIT 1`) : undefined,
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

  /** released(roomId) runs after a workspace is released (releaseIfDone), to drop its sessions. */
  onRelease(fn) { this.releasers.push(fn); }

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
    // A paused task stays on the board of the chat channel it was paused under (paused_chat), even
    // after its workspace went back to the pool and another chat channel claimed it: a to-do is never lost.
    const rows = this.db.prepare(`SELECT * FROM tasks WHERE (room_id IN (${rooms.map(() => '?').join(', ')})
      AND (paused_at IS NULL OR paused_chat IS NULL OR paused_chat = ?)) OR (paused_at IS NOT NULL AND paused_chat = ?)
      ORDER BY id DESC`).all(...rooms, chat, chat);
    return rows.map(r => this.view(r));
  }

  /** In-progress tasks in one room (the "进行中 N 件" next to it in the channel list). */
  countActive(roomId) { return this.q.active.get(roomId, ...WORKING).n; }

  /** Paused tasks in roomId (park): not counted by countActive. */
  countPaused(roomId) { return this.q.paused.get(roomId, ...WORKING).n; }

  /** Public task row: codes plus display names. */
  view(t) {
    return {
      id: t.id, room_id: t.room_id, parent_task: t.parent_task, title: t.title,
      owner: t.owner, owner_name: this.nameOf(t.owner), created_by: t.created_by, created_by_name: this.nameOf(t.created_by),
      status: t.status, next_check_at: t.next_check_at, assign_msg_id: t.assign_msg_id, result_msg_id: t.result_msg_id,
      note: t.note, reason: t.reason, ref: t.ref ?? null, base: t.base ?? null, created_at: t.created_at, updated_at: t.updated_at, returned_at: t.returned_at,
      paused_at: t.paused_at ?? null,
    };
  }

  nameOf(id) { return this.hub.members.get(id)?.name ?? id; }

  /** Get all ancestor task IDs of a given task ID (including itself). */
  ancestorsOf(taskId) {
    const ids = new Set();
    let cur = taskId;
    while (cur != null) {
      ids.add(cur);
      const t = this.task(cur);
      if (!t || t.parent_task == null) break;
      cur = t.parent_task;
    }
    return ids;
  }

  /** Active (working) tasks for a member across all rooms, optionally excluding specific task IDs. */
  activeTasksOf(owner, excludeIds = new Set()) {
    const rows = this.q.busyOfOwner.all(owner, ...WORKING);
    if (!excludeIds || excludeIds.size === 0) return rows;
    return rows.filter(t => !excludeIds.has(t.id));
  }

  /** Busy info of a member across all rooms, optionally excluding task IDs (e.g. ancestors when dispatching subtasks). */
  busyInfo(owner, excludeIds = new Set()) {
    const tasks = this.activeTasksOf(owner, excludeIds);
    if (!tasks || tasks.length === 0) return { busy: false };
    const task = tasks[0];
    const room = this.store.room(task.room_id);
    const roomName = room ? (room.name ? `#${room.name}` : `房间 ${task.room_id}`) : `房间 ${task.room_id}`;
    const dur = duration(this.now() - (task.created_at ?? this.now()));
    return {
      busy: true,
      task: this.view(task),
      roomName,
      durationText: dur,
    };
  }

  /** Map of memberId -> busy info for all active tasks across all rooms. */
  busyMap() {
    const rows = this.q.allBusy.all(...WORKING);
    const map = new Map();
    for (const r of rows) {
      if (map.has(r.owner)) continue;
      const room = this.store.room(r.room_id);
      const roomName = room ? (room.name ? `#${room.name}` : `房间 ${r.room_id}`) : `房间 ${r.room_id}`;
      const dur = duration(this.now() - (r.created_at ?? this.now()));
      map.set(r.owner, {
        task: this.view(r),
        roomName,
        durationText: dur,
      });
    }
    return map;
  }

  /**
   * Dispatch: the actor (the lead for this task) assigns `title` in `roomId` to member `owner`.
   * `reason` is the dispatcher's own one-line why-this-member, shown in the record (team mode C).
   * `force` allows assigning even if the member has an in-progress task in any room.
   * `ref`/`base` (#574): an API dispatch passes ref (string, checked by hasRef) and, for a
   * multi-editor task, base; undefined ref (tasks opened from chat or bridge cards) skips the check.
   */
  assign({ roomId, title, owner, actor, parentTask, messageId, reason, ref, base, force = false }) {
    const room = this.store.room(roomId);
    if (room === undefined) throw new CollabError('room-missing', `room ${roomId} does not exist`);
    const text = String(title ?? '').trim();
    if (!text || text.length > MAX_TEXT) throw new CollabError('invalid', 'task title is empty or too long');
    this.member(owner);
    this.member(actor);
    if (parentTask != null && this.task(parentTask) === undefined) throw new CollabError('task-missing', `task ${parentTask} does not exist`);
    if (messageId != null && this.store.message(messageId) === undefined) throw new CollabError('invalid', `message ${messageId} does not exist`);
    if (ref !== undefined && !hasRef(ref)) throw new CollabError('invalid', `${MISSING_REF}。${REF_EXAMPLE}`);
    if (ref !== undefined && multiEditor(text) && !clip(base)) throw new CollabError('invalid', MISSING_BASE);
    const excludeIds = parentTask != null ? this.ancestorsOf(parentTask) : new Set();
    const busy = this.busyInfo(owner, excludeIds);
    if (busy.busy && !force) {
      const targetName = this.nameOf(owner);
      throw new CollabError('member-busy', `${targetName} 在「${busy.roomName}」已有进行中的任务 #${busy.task.id}「${busy.task.title}」（已用时 ${busy.durationText}），请换人或稍后再派；确需并行派请带 force`);
    }
    const now = this.now();
    const why = clip(reason);
    const refText = ref === undefined ? null : clip(ref);
    const baseText = ref === undefined ? null : clip(base);
    const task = this.q.add.get(roomId, parentTask ?? null, text, owner, actor, now + CHECK_AFTER_S, messageId ?? null, now, now, why, refText, baseText);
    const refNote = `${refText ? `，参照：${refText}` : ''}${baseText ? `，底分支：${baseText}` : ''}`;
    const busyNote = busy.busy ? `（注：该成员在「${busy.roomName}」已有进行中任务 #${busy.task.id}）` : '';
    const record = this.record(task, 'assign', `派活 #${task.id}「${task.title}」→ ${this.nameOf(owner)}（${this.nameOf(actor)} 派）${why ? `，理由：${why}` : ''}${refNote}${busyNote ? ` ${busyNote}` : ''}`);
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
    this.resumeClaim(task, true);
    // 退/升 hand the turn to the lead: the reminder is cancelled.
    // A paused task answered again is back in work with a fresh check time.
    const check = status === 'declined' || status === 'escalated' ? null
      : task.paused_at != null ? this.now() + CHECK_AFTER_S : task.next_check_at;
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
    this.resumeClaim(task, false);
    const now = this.now();
    const row = this.q.handBack.get(messageId, now, now, id, task.status);
    if (row === undefined) throw new CollabError('conflict', `task ${id} changed meanwhile`);
    this.record(row, 'return', `#${id}「${row.title}」${this.nameOf(row.owner)} 交回，用时 ${duration(row.returned_at - row.created_at)}`);
    this.releaseIfDone(row.room_id);
    return this.changed(id);
  }

  /** The lead (or the human owner) closes the task or sends it back for rework. */
  review(id, { actor, verdict, note }) {
    const task = this.mustTask(id);
    if (actor !== task.created_by && actor !== HUMAN) throw new CollabError('forbidden', `only ${this.nameOf(task.created_by)} can review task ${id}`);
    if (!REVIEWABLE.includes(task.status)) throw new CollabError('conflict', `task ${id} is ${STATUS[task.status]}, nothing to review`);
    if (verdict !== 'done' && verdict !== 'rework') throw new CollabError('invalid', 'verdict must be done or rework');
    // #574: a send-back always says why (same rule as board done: rework count > 0 needs a reason).
    if (verdict === 'rework' && !clip(note)) throw new CollabError('invalid', MISSING_REWORK_NOTE);
    // Rework is a new round with the same check time as a dispatch (source above).
    const check = verdict === 'rework' ? this.now() + CHECK_AFTER_S : null;
    const row = this.q.set.get(verdict, check, clip(note) ?? task.note, this.now(), 0, id, task.status);
    if (row === undefined) throw new CollabError('conflict', `task ${id} changed meanwhile`);
    if (verdict === 'rework') this.q.resetRenewals.run(id);
    const tail = clip(note) ? `：${clip(note)}` : '';
    this.record(row, verdict, verdict === 'done'
      ? `#${id}「${row.title}」验收完成（${this.nameOf(actor)}）`
      : `#${id}「${row.title}」返工 → ${this.nameOf(row.owner)}（${this.nameOf(actor)}）${tail}`);
    if (verdict === 'done') this.releaseIfDone(row.room_id);
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
      case 'assign': return this.assign({ roomId, title: body.title, owner: String(body.owner ?? ''), actor, parentTask: optional(body.parent_task), messageId: optional(body.message_id), reason: body.reason, ref: String(body.ref ?? ''), base: body.base, force: Boolean(body.force) });
      case 'stance': return this.stance(id, { actor, stance: String(body.stance ?? ''), note: body.note });
      case 'return': return this.handBack(id, { actor, messageId: optional(body.message_id) });
      case 'review': return this.review(id, { actor, verdict: String(body.verdict ?? ''), note: body.note });
      default: throw new CollabError('invalid', 'action must be assign, stance, return or review');
    }
  }

  /** A member reply whose first line is 【接】【问】【退】【升】 (optionally #id) answers its task. */
  fromMessage(msg) {
    if (msg.author_kind !== 'role' || msg.card !== null) return undefined;
    const stance = this.stanceOf(msg);
    // A DSH member (local CLI members too, dsh-member.mjs) posts one reply, when its turn has
    // ended: a 【接】 there is also the delivery, and nothing else would hand the task back.
    // A bridge bot may keep working after its 【接】, so its stance stays a stance.
    if (stance?.status === 'accepted' && this.hub.members.get(msg.author)?.kind === 'dsh') {
      return this.handBack(stance.id, { actor: msg.author, messageId: msg.id });
    }
    if (stance !== undefined) return stance;
    // A 【问】【退】【升】 reply with no task to answer is a question or a pushback, never a hand-back.
    if (/^【(问|退|升)】/.test(withoutLeadingMentions(String(msg.text), this.hub.routable()).trimStart())) return undefined;
    if (NOTICE_PREFIXES.some(p => String(msg.text).trimStart().startsWith(p))) return undefined;
    return this.fromChat(msg);
  }

  stanceOf(msg) {
    // A bridge final reply opens with the lead's @ (lead_return.go), so skip leading mentions.
    const first = withoutLeadingMentions(String(msg.text), this.hub.routable()).split('\n', 1)[0];
    const m = STANCE_LINE.exec(first);
    if (m === null) return undefined;
    // Members open every reply with a stance, so without #id only a not-yet-answered
    // dispatch counts; once answered, changing that task needs its #id.
    const task = m[2] !== undefined ? this.task(Number(m[2]))
      : this.q.latestAssigned.get(msg.room_id, msg.author);
    if (task === undefined || task.owner !== msg.author || !WORKING.includes(task.status)) return undefined;
    return this.stance(task.id, { actor: msg.author, stance: m[1], note: m[3] });
  }

  /**
   * The board follows the channel the way Discord's task card follows a lead's dispatch,
   * without the task API: the primary role @-ing (or calling by leading name) teammates
   * opens one task per teammate that has none open from it in this room; a teammate's
   * reply that @-s the dispatcher (cloud-web lead_return adds it to every final reply)
   * hands its open task back; the dispatcher's next message accepts what was handed back.
   */
  fromChat(msg) {
    const lead = this.hub.primaryMember();
    const team = this.hub.routable();
    const text = String(msg.text);
    if (lead !== undefined && msg.author === lead.id) {
      for (const t of this.q.returnedChat.all(msg.room_id, lead.id)) {
        try { this.review(t.id, { actor: lead.id, verdict: 'done' }); } catch { /* changed meanwhile */ }
      }
      const called = mentions(text, team);
      const names = team.map(m => m.name);
      for (const m of team) if (nameCalled(text, m.name, names)) called.add(m.id);
      called.delete(lead.id);
      const title = taskTitle(text, team);
      if (!title) return undefined;
      for (const owner of called) this.openFromChat({ roomId: msg.room_id, owner, lead: lead.id, title, messageId: msg.id, source: 'mention' });
      return undefined;
    }
    const callsLead = lead !== undefined && (mentions(text, team).has(lead.id) || nameCalled(text, lead.name, team.map(m => m.name)));
    if (!callsLead) return undefined;
    const open = this.q.openChat.get(msg.room_id, msg.author, lead.id, ...WORKING);
    if (open === undefined) return undefined;
    return this.handBack(open.id, { actor: msg.author, messageId: msg.id });
  }

  /**
   * Open a chat-side task unless the owner already has one open from this lead in this room, or one
   * the lead handed to a workspace under it (the lead's later @ just tells the owner about it).
   */
  openFromChat({ roomId, owner, lead, title, messageId, source }) {
    if (!this.hub.members.has(owner) || this.q.openChat.get(roomId, owner, lead, ...WORKING) !== undefined) return undefined;
    if (this.q.openHanded?.get(owner, lead, ...WORKING, roomId) !== undefined) return undefined;
    // force: the channel already dispatched it; the board records it even if the owner is busy elsewhere.
    const task = this.assign({ roomId, title, owner, actor: lead, messageId, force: true });
    this.q.setSource.run(source, task.id);
    return task;
  }

  /**
   * Bridge task card members (cloud-web public_progress.go task_members) in room roomId,
   * posted by lead as card message messageId: a live top-level member opens its task, one
   * that ended (core.TaskMember: completed/failed/cancelled/interrupted) hands it back bound
   * to the card. Sub-rows (parent_id set) belong to their parent member and are skipped.
   */
  fromCard(roomId, lead, messageId, members) {
    if (!Array.isArray(members) || !this.hub.members.has(lead)) return;
    const team = this.hub.routable();
    for (const m of members) {
      if (m === null || typeof m !== 'object' || m.parent_id) continue;
      const project = String(m.reporter_project ?? '');
      const name = String(m.name ?? '').toLowerCase();
      const owner = team.find(t => (project && t.id === project) || (name && t.name.toLowerCase() === name));
      if (owner === undefined || owner.id === lead) continue;
      const status = String(m.status ?? '');
      try {
        if (['queued', 'running', 'waiting'].includes(status)) {
          const title = String(m.title ?? '').trim() || String(m.name ?? '').trim();
          if (title) this.openFromChat({ roomId, owner: owner.id, lead, title, messageId, source: 'card' });
        // `result` is the public-progress report kind; newer bridge cards
        // normalize it to `completed`, while older cards expose it directly.
        // Keep `done` for cards produced by older task-card implementations.
        } else if (['result', 'completed', 'done', 'failed', 'cancelled', 'interrupted'].includes(status)) {
          const open = this.q.openChat.get(roomId, owner.id, lead, ...WORKING);
          if (open !== undefined) this.handBack(open.id, { actor: owner.id, messageId });
        }
      } catch (error) {
        this.hub.logger?.warn?.('collab: task card sync failed: %s', error?.message ?? error);
      }
    }
  }

  /**
   * At its check time a workspace task is renewed or parked (watch); a task in any other room
   * gets one reminder @-ing the owner, which also wakes it. A workspace held by a bridge claim is
   * the bridge's to watch (core/team_watch.go): its tasks get neither.
   */
  tick() {
    if (this.closed || !this.started) return;
    const now = this.now();
    for (const task of this.q.allBusy.all(...WORKING)) {
      if (this.watched(task) && watchDue(task) <= now) this.watch(task, now);
    }
    for (const task of this.q.due.all(now, ...WORKING)) {
      if (this.store.room(task.room_id)?.kind === 'workspace') continue;
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

  /** A workspace task this gateway watches: not in a workspace the bridge claimed. */
  watched(task) {
    return this.store.room(task.room_id)?.kind === 'workspace' && !this.store.bridgeClaimed(task.room_id);
  }

  /**
   * A workspace task at its check time: progress by its owner since the window opened
   * (watchDue - CHECK_AFTER_S) and fewer than MAX_RENEWALS renewals → another CHECK_AFTER_S;
   * otherwise it is parked through pauseTask, and the pause record @-s the owner and wakes it
   * (the record goes first, while the workspace still names its chat channel).
   */
  watch(task, now) {
    const renewals = task.renewals ?? 0;
    if (renewals < MAX_RENEWALS && this.progressed(task, watchDue(task) - CHECK_AFTER_S)) {
      if (this.q.renew.get(now + CHECK_AFTER_S, renewals + 1, task.id, ...WORKING) !== undefined) this.changed(task.id);
      return;
    }
    const why = renewals >= MAX_RENEWALS ? `已续期 ${MAX_RENEWALS} 次` : `${CHECK_AFTER_S / 60} 分钟内没有新进展`;
    const message = this.record(task, 'pause', `@${this.nameOf(task.owner)} #${task.id}「${task.title}」${why}，已暂停；表态或交回即恢复`);
    if (this.pauseTask(task.id)) this.wake(task.owner, message);
  }

  /**
   * Progress = the owner's own messages since `since`, not counting stance lines (【接】【问】
   * 【退】【升】) or status notices. Same rule as contrib/lead/d10-fire chat_active.
   */
  progressed(task, since) {
    return this.q.ownerSaid.all(task.room_id, task.owner, since).some(({ text }) => {
      const body = withoutLeadingMentions(String(text ?? ''), this.hub.routable()).trim();
      return body !== '' && !/^【(接|问|退|升)】/.test(body) && !NOTICE_PREFIXES.some(p => body.startsWith(p));
    });
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
    this.delivering = true;
    let taken;
    try { taken = this.wake(task.owner, message); } finally { this.delivering = false; }
    if (!taken) this.q.putRemind.run(msgId, taskId);
  }

  /** Start memberId on message through the first waker that takes it; true if one did. */
  wake(memberId, message) {
    for (const wake of this.wakers) {
      try { if (wake(memberId, message)) return true; } catch (error) { this.hub.logger.warn('collab: task reminder wake failed: %s', error?.message ?? error); }
    }
    return false;
  }

  /** Schedule tick() for the earliest pending check time. */
  arm() {
    if (this.timer !== undefined) this.clearTimer(this.timer);
    this.timer = undefined;
    if (this.closed) return;
    // Workspace tasks are due at watchDue (also those whose check time an older reminder spent),
    // except in bridge-claimed workspaces; other tasks at their check time.
    const at = this.q.allBusy.all(...WORKING)
      .map(t => this.store.room(t.room_id)?.kind !== 'workspace' ? t.next_check_at : this.watched(t) ? watchDue(t) : null)
      .filter(t => t != null).sort((a, b) => a - b)[0];
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

  /**
   * A workspace whose handoff (the chat channel's task, store.handoffDone) is handed back or
   * done and has no other task in work has finished: release it to the shared pool for any chat
   * channel and clear its sessions (store.releaseWorkspace), so the next chat channel's
   * [ask]/[report] never go to this one. A subtask handed back while the handoff is open (the
   * lead still summing up), a claim no task followed yet, or a bridge claim (released only by
   * the bridge's op release) keeps it owned.
   */
  releaseIfDone(roomId) {
    if (!this.tree || this.store.room(roomId)?.kind !== 'workspace') return;
    if (this.countActive(roomId) > 0 || !this.store.handoffDone(roomId)) return;
    this.release(roomId);
  }

  /**
   * Release workspace roomId (store.releaseWorkspace; throws 'busy' while tasks are in work)
   * and tell the onRelease listeners. Also called for a cloud-web bot's workspace session
   * reset (cloudweb.mjs op release, naming the claim it ends: claim). Returns whether it was released now.
   */
  release(roomId, claim = null) {
    if (!this.store.releaseWorkspace(roomId, claim)) return false;
    for (const released of this.releasers) {
      try { released(roomId); } catch (error) { this.hub.logger?.warn?.('collab: workspace release hook failed', error); }
    }
    return true;
  }

  /**
   * Park workspace roomId (the bridge's op release with park, core ParkTeamWorkspace): its tasks
   * in work are marked paused (still the owner's, resumed by any status change) and the workspace
   * is released to the pool like release() (same claim check, 'stale-claim' before anything is
   * paused). Returns whether it was released now.
   */
  park(roomId, claim = null) {
    if (this.store.room(roomId)?.kind !== 'workspace' || this.store.workspaceOwner(roomId) == null) return false;
    if (claim != null && String(claim) !== this.store.claimId(roomId)) {
      throw new CollabError('stale-claim', `workspace ${roomId} was claimed again since claim ${claim}`);
    }
    this.q.park.run(this.now(), this.store.workspaceOwner(roomId), roomId, ...WORKING);
    const released = this.release(roomId, claim);
    this.arm();
    return released;
  }

  /** Pause one task through the same queue/release path as park; other work stays busy. */
  pauseTask(id) {
    const task = this.task(id);
    if (!task || task.paused_at != null || !WORKING.includes(task.status)
        || this.store.room(task.room_id)?.kind !== 'workspace') return false;
    this.db.prepare(`UPDATE tasks SET paused_at = ?, paused_chat = ?, next_check_at = NULL
      WHERE id = ?`).run(this.now(), this.store.workspaceOwner(task.room_id), id);
    if (this.countActive(task.room_id) === 0) this.release(task.room_id);
    this.changed(id);
    return true;
  }

  /**
   * A paused task's workspace was released by park and may have been claimed by another chat
   * channel since. Resuming it there would make the workspace serve two chat channels and send
   * its asks/reports (team-exit, by rooms.parent_id) to the later one. So: owned by another chat
   * channel → refused with 'workspace-owned' and nothing changes (the task stays paused, still
   * listed; hand it off again to a free workspace). Free and reclaim → claimed back for the chat
   * channel it was paused under. Tasks not paused, or paused before paused_chat existed, pass.
   */
  resumeClaim(task, reclaim) {
    if (task.paused_at == null || task.paused_chat == null || !this.tree) return;
    const owner = this.store.workspaceOwner(task.room_id);
    if (owner != null && owner !== task.paused_chat) {
      throw new CollabError('workspace-owned', `task ${task.id} is paused and its workspace now belongs to room ${owner}; hand it off again to a free workspace`);
    }
    if (owner == null && reclaim) this.store.claimWorkspace(task.paused_chat, task.room_id);
  }

  changed(id) {
    const task = this.view(this.task(id));
    this.hub.emit({ type: 'task', task, chat_id: this.chatOf(task.room_id), active: this.countActive(task.room_id) });
    this.hub.emit({ type: 'rooms', rooms: this.store.roomsView() });
    this.arm();
    return task;
  }
}

/** First non-empty line of a dispatch with the @-mentions taken out (the task title). */
function taskTitle(text, team) {
  const plain = split(text, team).map(([seg, id]) => (id ? '' : seg)).join('');
  const line = plain.split('\n').map(l => l.replace(/^[\s，,：:、]+/, '').trim()).find(Boolean) ?? '';
  return line.slice(0, MAX_TEXT);
}

function withoutLeadingMentions(text, team) {
  const parts = split(text, team);
  let i = 0;
  while (i < parts.length && (parts[i][1] !== null || !parts[i][0].trim())) i++;
  return parts.slice(i).map(([seg]) => seg).join('').trimStart();
}

/** When a workspace task's watch is due: its check time, or CHECK_AFTER_S after its last change. */
function watchDue(task) {
  return task.next_check_at ?? task.updated_at + CHECK_AFTER_S;
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
