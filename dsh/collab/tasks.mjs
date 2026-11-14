// Team mode B (#139): tasks dispatched in a channel. A lead assigns a task to a
// member, the member states 接/问/退/升 (API or the first line of its reply),
// hands it back bound to the delivery message, and the lead accepts or sends it
// back. Every step leaves one short system record in the task's room and, when
// that room is a workspace, in its chat channel; records never @ anyone and
// never start a bot turn (system rows are skipped by every router). One
// reminder @s the owner when the check time passes without a hand-back; if no
// waker can reach the owner (cloud-web bot offline, or not reconnected yet after
// a restart) the reminder stays pending and is delivered once when it comes online.
import { CollabError, MAX_TEXT, messageAttachments } from './store.mjs';
import { mentions, nameCalled, split, withoutLeadingMentions } from './mentions.mjs';
import { NOTICE_PREFIXES } from './cloudweb.mjs';
import { exitMark, workspaceAskMark } from './team-exit.mjs';
import { checkDispatch, HandoffRulesError } from './handoff-rules.mjs';
import { execFile } from 'node:child_process';
import { modelErrorReply } from './model-errors.mjs';

/** Status codes and their labels. Cancellation/supersession are not acceptance. */
export const STATUS = {
  assigned: '派出', accepted: '已接', asked: '有疑问', declined: '退回',
  escalated: '升级', returned: '交回', done: '完成', rework: '返工',
  cancelled: '已取消', superseded: '已替代',
  // #1540: the owner's turn ended in a CLI/model error (满载、超时、鉴权): not a hand-back, never accepted;
  // the lead's next call to the owner re-dispatches it (fromChat).
  failed: '出错',
};
export const TERMINAL = ['done', 'cancelled', 'superseded'];
/** First-line stance marks used by the team (本机团队模式【接/问/退/升】). */
export const STANCES = { 接: 'accepted', 问: 'asked', 退: 'declined', 升: 'escalated' };
const STANCE_WORDS = { accept: '接', ask: '问', decline: '退', escalate: '升' };
/** The owner's turn: the check timer runs and the task counts as in progress. */
export const WORKING = ['assigned', 'accepted', 'asked', 'rework'];
/** Waiting for the lead: review may close or send back. */
const REVIEWABLE = ['returned', 'declined', 'escalated'];
/** The owner delivered: handed back, or the lead accepted it (fromChat reads the next call as an answer). */
const DELIVERED = ['returned', 'done'];
// #597 r12: how long a bare-name call after a delivery waits for the owner's stance (Tasks.pendingCalls).
// Source: 聊天频道橘 10-26「超过 30 分钟没回也丢弃」.
const PENDING_CALL_S = 30 * 60;
// Default check time after dispatch or rework. Source: user 2026-10-23「这10分钟之内搞不完就滚蛋」.
export const CHECK_AFTER_S = 10 * 60;
// Workspace watch (#574 B2, same rule as contrib/lead/d10-fire MAX_RENEW, 0 = no cap): at the
// check time a workspace task with new role messages since its window opened gets another
// CHECK_AFTER_S, renewing while there is progress; otherwise it is parked (paused queue).
// Replaces the old one-hour park. Source: user 2026-10-26 agreed「有进展就一直续，没进展才停」(#429),
// replacing 橘 10-25 15:19「最多续 2 次」; same as Go watchMaxRenew.
export const MAX_RENEWALS = 0;
// setTimeout's own maximum delay (Node clamps anything larger to 1 ms).
const MAX_TIMER_MS = 2 ** 31 - 1;
/**
 * The bridge watch posts its wake (「接着做 X，做完跑 ws-up --report <草稿文件> 交回」, i18n MsgWatchResume) and its notices
 * (「看门：…」, MsgWatchIdleEscalate / MsgWatchFailEscalate …) in the lead's name. They chase work that
 * already exists; read as a lead dispatch they opened a new task per wake (#221, 11-06: 「#6 接着做 -」).
 * The text follows bridge/core/i18n.go; keep both in step.
 */
const WATCH_NOTICE_PREFIXES = ['看门：', '看門：', 'Watch: ', '見守り：'];
const WATCH_RESUME_LINES = [
  /^接着做 .+，做完跑 ws-up --report <草稿文件> 交回$/,
  /^接著做 .+，做完再結束本輪，交回時第一行寫 \[report\]$/,
  /^接著做 .+，做完跑 ws-up --report <草稿檔> 交回$/,
  /^Continue .+ and finish it; when done, start the reply with \[report\]$/,
  /^.+ を続けて完了させてください。完了したら返信の1行目を \[report\] にしてください$/,
  /^Continúa .+ hasta terminarlo; al terminar, empieza la respuesta con \[report\]$/,
];
export function isWatchNotice(text, team = []) {
  // A wake may have a handoff-file line after it. A report instruction elsewhere in a dispatch is not a wake.
  const first = withoutLeadingMentions(String(text), team).split('\n', 1)[0].trim();
  return WATCH_NOTICE_PREFIXES.some(p => first.startsWith(p)) || WATCH_RESUME_LINES.some(p => p.test(first));
}

const STANCE_LINE = /^\s*【(接|问|退|升)】\s*(?:#(\d+))?\s*(.*)$/;
// The dispatcher's explicit review of a workspace task, a line of its chat-channel reply:
// 【验收】#id closes it, 【返工】#id 原因 sends it back (Tasks.verdictsOf).
const VERDICT_LINE = /^[ \t]*【(验收|返工)】[ \t]*#(\d+)[ \t]*(.*)$/gm;
const HUMAN = 'owner';
// #597 G35 briefing sizes (chars): enough for the handoff's goal and acceptance lines and the
// report's summary, short of MAX_TEXT with the record around them. Not user-specified.
const BRIEF_HANDOFF = 1500;
const BRIEF_REPORT = 800;
const PLACEHOLDERS = WORKING.map(() => '?').join(', ');
// A paused task (park: the bridge released its workspace with the task stopped at a clean
// point) keeps its status but is not in progress: no check timer, not counted. Any status
// change by its owner or the lead (stance, hand-back, review) resumes it.
const LIVE = `status IN (${PLACEHOLDERS}) AND paused_at IS NULL`;
// #574 dispatch fields: `ref` names the existing implementation to follow, `base` the branch to start
// from when several members edit the same files. The checks and their messages are in the shared
// handoff rules (handoff-rules.json, also read by ws-handoff); a dispatch runs the ones listed under
// its `dispatch` key. The rules file not being readable refuses the dispatch (HTTP 500), never skips it.
// Review handover (user 11-05「派活的角色忙超过 10 分钟，就转给空着的队友去验收。小活交回时，只要检查都过了
// 就自动收口，大活才需要人看」): a workspace task handed back waits CHECK_AFTER_S for its dispatcher's
// verdict, then goes to a free teammate other than its author (reviewOf). A small task closes itself:
// every GitHub PR its report links is merged with no failing check, or its handoff scope says 改：无.
// Not user-specified (橘 11-05, listed in the PR): the words below that keep a task for a person, and
// one extra wake of an idle dispatcher before handing over.
const PR_URL = /https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+/g;
const NEEDS_PERSON = /发版|发布|release|线上|生产|部署|deploy|花钱|付费|付款|下单|充值|用户看|用户确认|用户拍板/i;
const CHANGE_LINE = /^[\s>*-]*改\s*[:：]\s*(.*)$/gm;
const ASKS_USER = /要你做的\s*[:：]\s*(.*)/;
const NOTHING = /^(没有|无)\s*[。.]?\s*$/;
const GREEN = new Set(['SUCCESS', 'NEUTRAL', 'SKIPPED']);

/** gh's view of one PR: { merged, green } (no checks is not green, same as board.py #1003); rejects when gh is missing or fails. */
export function ghPrStatus(url) {
  return new Promise((resolve, reject) => {
    execFile('gh', ['pr', 'view', url, '--json', 'state,statusCheckRollup'], { timeout: 30_000 }, (error, stdout) => {
      if (error) return reject(error);
      try {
        const pr = JSON.parse(stdout);
        const checks = Array.isArray(pr.statusCheckRollup) ? pr.statusCheckRollup : [];
        const green = checks.length > 0 && checks.every(c => GREEN.has(String(c.conclusion ?? c.state ?? '').toUpperCase()));
        resolve({ merged: pr.state === 'MERGED', green });
      } catch (e) { reject(e); }
    });
  });
}

const MISSING_REWORK_NOTE = '返工要写原因：note 填为什么打回，示例：note: "没先读现有实现"';

/** Runs a handoff check; a missing or broken rules file becomes a CollabError instead of letting it through. */
export function withRules(fn) {
  try {
    return fn();
  } catch (e) {
    if (e instanceof HandoffRulesError) throw new CollabError('rules-missing', e.message);
    throw e;
  }
}

/** True when ref passes the shared reference-implementation check on its own. */
export function hasRef(ref) { return checkDispatch({ title: '', ref }) === null; }

export class Tasks {
  reassignForQuota(task, owner) {
    const row = this.db.prepare(`UPDATE tasks SET owner = ?, status = 'assigned', next_check_at = ?,
      renewals = 0, remind_msg_id = NULL, updated_at = ? WHERE id = ? AND owner = ? AND ${LIVE} RETURNING *`)
      .get(owner, this.now() + CHECK_AFTER_S, this.now(), task.id, task.owner, ...WORKING);
    if (row) {
      this.record(row, 'quota', `#${row.id}「${row.title}」额度冷却转交 → ${this.nameOf(owner)}。原交接：${task.reason ?? ''}\n参照：${task.ref ?? ''}\n底分支：${task.base ?? ''}`);
      this.changed(row.id);
    }
    return row;
  }
  /**
   * @param hub - Hub (store, members, post, emit).
   * @param options - { now?(): seconds, setTimer?, clearTimer? } (tests drive the clock);
   *   start: false defers the timer and pending deliveries until start() (the plugin
   *   starts after DSH recovery, so a reminder job is never mistaken for a leftover).
   */
  constructor(hub, { now = () => Date.now() / 1000, setTimer = setTimeout, clearTimer = clearTimeout, start = true, maxRenewals = MAX_RENEWALS, prStatus = ghPrStatus } = {}) {
    this.hub = hub;
    this.prStatus = prStatus;
    this.maxRenewals = maxRenewals;
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
    /**
     * #597 r12: bare-name calls after a delivery, and #1598 every @ in a chat channel of the tree,
     * waiting for the owner's stance line, keyed
     * `room\0owner`: { roomId, owner, lead, title, messageId, at }. In memory only: a restart drops them.
     */
    this.pendingCalls = new Map();
    /**
     * #1616 (user 11-14「为什么一个工作区只有一个模型」): one job called to several members goes into one
     * workspace. `${chat room}\0${first trigger message}` -> { id, claim } of the workspace the first
     * member's 【接】 opened; the next member's 【接】 to the same message joins it while that claim holds.
     */
    this.jointWorkspaces = new Map();
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
      // A returned workspace task waiting for its verdict: next_check_at is its review watch (reviewWatch).
      reviewWait: this.db.prepare(`SELECT * FROM tasks WHERE status = 'returned' AND next_check_at IS NOT NULL ORDER BY next_check_at, id`),
      setReviewCheck: this.db.prepare("UPDATE tasks SET next_check_at = ?, remind_msg_id = COALESCE(?, remind_msg_id) WHERE id = ? AND status = 'returned' RETURNING *"),
      openReviews: this.db.prepare(`SELECT * FROM tasks WHERE parent_task = ? AND source = 'review' AND status IN (${PLACEHOLDERS})`),
      bindAssign: this.db.prepare('UPDATE tasks SET assign_msg_id = ? WHERE id = ? AND assign_msg_id IS NULL'),
      due: this.db.prepare(`SELECT * FROM tasks WHERE next_check_at IS NOT NULL AND next_check_at <= ?
        AND ${LIVE} ORDER BY next_check_at, id`),
      // Posting the reminder and marking it undelivered is one step; the check time is spent.
      unremind: this.db.prepare('UPDATE tasks SET next_check_at = NULL, remind_msg_id = ? WHERE id = ? AND next_check_at IS NOT NULL RETURNING *'),
      undelivered: this.db.prepare(`SELECT * FROM tasks WHERE remind_msg_id IS NOT NULL AND ${LIVE} ORDER BY id`),
      // Clear before waking (a success is never re-sent); restore only if nobody took it.
      takeRemind: this.db.prepare(`UPDATE tasks SET remind_msg_id = NULL WHERE id = ? AND remind_msg_id = ? AND ${LIVE} RETURNING *`),
      putRemind: this.db.prepare(`UPDATE tasks SET remind_msg_id = ? WHERE id = ? AND remind_msg_id IS NULL AND ${LIVE}`),
      active: this.db.prepare(`SELECT COUNT(*) AS n FROM tasks WHERE room_id = ? AND ${LIVE}`),
      paused: this.db.prepare(`SELECT COUNT(*) AS n FROM tasks WHERE room_id = ? AND status IN (${PLACEHOLDERS}) AND paused_at IS NOT NULL`),
      // Rows the owner posted or changed in place since a time. Cards use changed_at (a progress
      // card edited in place is real progress); text rows use only created_at so that a streaming
      // reply still growing after the window opened does not count as new progress.
      ownerSaid: this.db.prepare(`SELECT text, card FROM messages WHERE room_id = ? AND author_kind = 'role' AND author = ? AND deleted = 0
        AND (CASE WHEN card IS NOT NULL THEN COALESCE(changed_at, created_at) ELSE created_at END) > ?`),
      // paused_chat: the chat channel that owned the workspace when the task was paused (resumeClaim).
      resetRenewals: this.db.prepare('UPDATE tasks SET renewals = 0 WHERE id = ?'),
      renew: this.db.prepare(`UPDATE tasks SET next_check_at = ?, renewals = ? WHERE id = ? AND ${LIVE} RETURNING *`),
      park: this.db.prepare(`UPDATE tasks SET paused_at = ?, paused_chat = ?, next_check_at = NULL WHERE room_id = ? AND ${LIVE}`),
      open: this.db.prepare(`SELECT * FROM tasks WHERE status IN (${PLACEHOLDERS}) ORDER BY id`),
      autoClose: this.db.prepare(`UPDATE tasks SET status = 'returned', next_check_at = NULL, remind_msg_id = NULL,
        note = ?, returned_at = ?, updated_at = ? WHERE id = ? AND status IN (${PLACEHOLDERS}) RETURNING *`),
      busyOfOwner: this.db.prepare(`SELECT * FROM tasks WHERE owner = ? AND ${LIVE} ORDER BY updated_at DESC`),
      allBusy: this.db.prepare(`SELECT * FROM tasks WHERE ${LIVE} ORDER BY updated_at DESC`),
      // A stance line without #id only answers a dispatch the owner has not answered yet.
      latestAssigned: this.db.prepare("SELECT * FROM tasks WHERE room_id = ? AND owner = ? AND status = 'assigned' ORDER BY id DESC LIMIT 1"),
      // The owner's newest task in a room, whatever its status (fromChat: did she just deliver?).
      latestOf: this.db.prepare('SELECT * FROM tasks WHERE room_id = ? AND owner = ? ORDER BY id DESC LIMIT 1'),
      // Chat-side tasks (source 'mention' / 'card'): opened from the lead's @ or the bridge task card.
      setSource: this.db.prepare('UPDATE tasks SET source = ? WHERE id = ?'),
      openChat: this.db.prepare(`SELECT * FROM tasks WHERE room_id = ? AND owner = ? AND created_by = ? AND source IS NOT NULL
        AND status IN (${PLACEHOLDERS}) ORDER BY id DESC LIMIT 1`),
      returnedChat: this.db.prepare("SELECT * FROM tasks WHERE room_id = ? AND created_by = ? AND source IN ('mention', 'card') AND status = 'returned' ORDER BY id"),
      children: this.tree ? this.db.prepare("SELECT id FROM rooms WHERE kind = 'workspace' AND parent_id = ? ORDER BY id") : undefined,
      // #597 G24: a job the lead already handed to one of this chat channel's workspaces.
      openHanded: this.tree ? this.db.prepare(`SELECT * FROM tasks WHERE owner = ? AND created_by = ? AND source = 'workspace'
        AND status IN (${PLACEHOLDERS}) AND room_id IN (SELECT id FROM rooms WHERE kind = 'workspace' AND parent_id = ?) ORDER BY id DESC LIMIT 1`) : undefined,
    };
    hub.onMessage(message => this.fromMessage(message));
    // A member coming online (cloud-web register, DSH member published) gets its pending reminders.
    this.unsubscribe = hub.subscribe(event => {
      if (event.type === 'members') { this.deliverPending(); this.arm(); }
    });
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
      termination_reason: t.termination_reason ?? null, superseded_by: t.superseded_by ?? null,
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
   * `ref`/`base` (#574): an API dispatch passes ref (string, checked by the shared rules) and, for a
   * multi-editor task, base; undefined ref (tasks opened from chat or bridge cards) skips the check.
   */
  assign({ roomId, title, owner, actor, parentTask, reviewOf, messageId, reason, ref, base, force = false }) {
    const room = this.store.room(roomId);
    if (room === undefined) throw new CollabError('room-missing', `room ${roomId} does not exist`);
    const text = String(title ?? '').trim();
    if (!text || text.length > MAX_TEXT) throw new CollabError('invalid', 'task title is empty or too long');
    this.member(owner);
    if (!this.hub.membersInRoom(roomId).some(m => m.id === owner)) throw new CollabError('member-missing', `member ${owner} does not belong to room ${roomId}`);
    this.member(actor);
    if (reviewOf != null) {
      const original = this.mustTask(reviewOf);
      if (actor !== original.created_by && actor !== HUMAN) throw new CollabError('forbidden', 'only the dispatcher or owner can delegate a review');
      if (owner === original.owner) throw new CollabError('forbidden', 'the author cannot review their own task');
      if (!REVIEWABLE.includes(original.status)) throw new CollabError('conflict', 'only a returned task can be delegated for review');
      if (this.chatOf(original.room_id) !== this.chatOf(roomId)) throw new CollabError('forbidden', 'a review must stay in the task chat channel');
      parentTask = original.id;
    }
    if (parentTask != null && this.task(parentTask) === undefined) throw new CollabError('task-missing', `task ${parentTask} does not exist`);
    if (messageId != null && this.store.message(messageId) === undefined) throw new CollabError('invalid', `message ${messageId} does not exist`);
    const refError = ref === undefined ? null : withRules(() => checkDispatch({ title: text, ref, base }));
    if (refError) throw new CollabError('invalid', refError);
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
    if (reviewOf != null) this.q.setSource.run('review', task.id);
    const refNote = `${refText ? `，参照：${refText}` : ''}${baseText ? `，底分支：${baseText}` : ''}`;
    const busyNote = busy.busy ? `（注：该成员在「${busy.roomName}」已有进行中任务 #${busy.task.id}）` : '';
    // The task card shows the title, so the record does not repeat it. A task opened from a message
    // (an @ dispatch, a handoff) gets its card under that message on the page (TaskCard by
    // assign_msg_id), so no record goes to the message's own room: the dispatch text shows once.
    const source = messageId == null ? undefined : this.store.message(messageId).room_id;
    const record = this.record(task, 'assign', `派活 #${task.id} → ${this.nameOf(owner)}（${this.nameOf(actor)} 派）${why ? `，理由：${why}` : ''}${refNote}${busyNote ? ` ${busyNote}` : ''}`, source);
    if (messageId == null) this.q.bindAssign.run(record.id, task.id);
    return this.changed(task.id);
  }

  /** The owner states 接/问/退/升 (also accept/ask/decline/escalate). */
  stance(id, { actor, stance, note, messageId }) {
    const mark = STANCES[stance] !== undefined ? stance : STANCE_WORDS[stance];
    if (mark === undefined) throw new CollabError('invalid', 'stance must be one of 接 问 退 升');
    const task = this.mustTask(id);
    if (actor !== task.owner && actor !== HUMAN) throw new CollabError('forbidden', `only ${this.nameOf(task.owner)} can answer task ${id}`);
    if (!WORKING.includes(task.status)) throw new CollabError('conflict', `task ${id} is ${STATUS[task.status]}, not waiting for its owner`);
    const status = STANCES[mark];
    const source = messageId == null ? undefined : this.store.message(messageId);
    if (messageId != null && (source === undefined || source.room_id !== task.room_id || source.author !== actor || source.author_kind !== 'role')) {
      throw new CollabError('invalid', 'message_id must name the owner message in the task room');
    }
    const body = source === undefined ? null : clip(String(source.text).replace(/^\s*(?:@\S+\s+)*【[接问退升]】[^\n]*(?:\n|$)/, '').trim());
    const detail = clip(note) ?? body;
    this.resumeClaim(task, true);
    // 退/升 hand the turn to the lead: the reminder is cancelled.
    // A paused task answered again is back in work with a fresh check time.
    const check = status === 'declined' || status === 'escalated' ? null
      : task.paused_at != null ? this.now() + CHECK_AFTER_S : task.next_check_at;
    const row = this.q.set.get(status, check, detail, this.now(), check === null ? 0 : 1, id, task.status);
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
    const watched = this.reviewWatched(row);
    const small = watched ? this.smallTask(row, messageId) : undefined;
    // A small task's dispatcher is only woken if it does not close itself (checkPrs).
    const copy = this.returnToChat(row, messageId, { wake: small === undefined });
    if (watched) this.q.setReviewCheck.get(now + CHECK_AFTER_S, null, id);
    if (small?.readOnly) this.autoAccept(id, small.readOnly);
    else if (small?.prs) this.checkPrs(id, small.prs, copy);
    this.releaseIfDone(row.room_id);
    return this.changed(id);
  }

  /**
   * A workspace task handed back: its result goes to the chat channel (TeamExit.forwardResult:
   * the [report] body, or the delivery itself) and its dispatcher is woken there on it to review,
   * as a chat-channel hand-back @-s the lead (lead_return.go). A bridge-claimed workspace is the
   * bridge's (its lead session reads the workspace itself).
   */
  returnToChat(task, messageId, { wake = true } = {}) {
    if (!this.tree || this.store.room(task.room_id)?.kind !== 'workspace' || this.store.bridgeClaimed(task.room_id)) return undefined;
    const msg = this.store.message(messageId);
    let copy = msg === undefined ? undefined : this.hub.teamExit?.forwardResult(msg);
    if (copy === undefined || task.created_by === HUMAN) return copy;
    // The dispatcher is woken on this copy alone (a turn reads no other system row), so it says
    // how to review, as the pause record says how to answer (watch).
    const how = `\n\n验收 #${task.id}：回复里单独一行写【验收】#${task.id}；要返工就单独一行写【返工】#${task.id} 原因。`;
    if (!copy.text.includes(how)) copy = this.hub.edit(copy.id, 'system', 'system', copy.text + how, copy.card) ?? copy;
    if (wake) this.wake(task.created_by, copy);
    return copy;
  }

  /** A workspace task (not a bridge claim's, not a review) whose verdict this gateway waits for. */
  reviewWatched(task) {
    return this.tree && task.created_by !== HUMAN && task.source !== 'review'
      && this.store.room(task.room_id)?.kind === 'workspace' && !this.store.bridgeClaimed(task.room_id);
  }

  /**
   * A small task, closed without a person: { prs } (GitHub PR links in its report, checked by checkPrs)
   * or { readOnly: why } (every 改 line of its handoff says 无). undefined when it needs a person: its
   * report asks the user for something, or its handoff touches release, production, deploy or money.
   */
  smallTask(task, messageId) {
    const report = String(this.store.message(messageId)?.text ?? '');
    const asks = ASKS_USER.exec(report)?.[1]?.trim();
    if (asks !== undefined && !NOTHING.test(asks)) return undefined;
    const handoff = `${task.title}\n${task.reason ?? ''}\n${task.assign_msg_id == null ? '' : this.store.message(task.assign_msg_id)?.text ?? ''}`;
    const changes = [...handoff.matchAll(CHANGE_LINE)].map(m => m[1].trim());
    if (NEEDS_PERSON.test(changes.length ? changes.join('\n') : handoff)) return undefined;
    const prs = [...new Set(report.match(PR_URL) ?? [])];
    if (prs.length) return { prs };
    if (changes.length && changes.every(c => /^无/.test(c))) return { readOnly: '只查不改（交接范围「改：无」）' };
    return undefined;
  }

  /** Every PR merged with no failing check closes the task; anything else (or gh failing) wakes its dispatcher on copy. */
  checkPrs(id, prs, copy) {
    return Promise.all(prs.map(url => this.prStatus(url))).then(states => {
      if (states.every(s => s?.merged && s?.green)) {
        const nums = prs.map(u => `#${u.split('/').pop()}`).join('、');
        if (this.autoAccept(id, `PR ${nums} 已合、检查全绿`)) return;
      }
      this.wakeReviewer(id, copy);
    }, error => {
      this.hub.logger?.warn?.('collab: PR check for task #%s failed: %s', id, error?.message ?? error);
      this.wakeReviewer(id, copy);
    });
  }

  wakeReviewer(id, copy) {
    const task = this.task(id);
    if (!this.closed && copy !== undefined && task?.status === 'returned') this.wake(task.created_by, copy);
  }

  /** Close a returned task with no reviewer: one record says why. True when it closed it now. */
  autoAccept(id, why) {
    const task = this.task(id);
    if (this.closed || task?.status !== 'returned') return false;
    const row = this.q.set.get('done', null, clip(why), this.now(), 0, id, 'returned');
    if (row === undefined) return false;
    this.closeReviews(id, 'done');
    this.record(row, 'done', `#${id}「${row.title}」已自动收口：${why}`);
    this.releaseIfDone(row.room_id);
    this.changed(id);
    return true;
  }

  /** Delegated reviews of task id end with its verdict. */
  closeReviews(id, verdict, messageId) {
    for (const review of this.q.openReviews.all(id, ...WORKING)) {
      if (verdict === 'cancelled' || verdict === 'superseded') {
        this.terminate(review.id, { actor: HUMAN, status: 'cancelled', reason: `验收对象 #${id} ${STATUS[verdict]}，验收停止` });
        continue;
      }
      this.db.prepare(`UPDATE tasks SET status = 'done', next_check_at = NULL, remind_msg_id = NULL,
        paused_at = NULL, result_msg_id = ?, returned_at = ?, updated_at = ? WHERE id = ?`)
        .run(messageId ?? null, this.now(), this.now(), review.id);
      this.record(this.task(review.id), 'done', `#${review.id} 验收 #${id} 已结束：${verdict === 'done' ? '通过' : '返工'}`);
      this.changed(review.id);
      this.releaseIfDone(review.room_id);
    }
  }

  /** Busy or unreachable now: offline, cooling, in a turn, busy on the team status, or owning work. */
  memberBusy(id) {
    const m = this.hub.members.get(id);
    if (m === undefined || m.online === false || m.error) return true;
    if (this.hub.quota?.cooling(id)) return true;
    if ([...(this.hub.thinking?.values() ?? [])].some(s => s.has(id))) return true;
    if (this.hub.presence?.get(id)?.busy) return true;
    return this.busyInfo(id).busy;
  }

  /**
   * A returned workspace task at its review check (CHECK_AFTER_S after hand-back, then every
   * CHECK_AFTER_S): a delegated review in work → wait on it; an idle dispatcher → woken once more;
   * a busy one (or one woken already) → a free teammate other than the author and the dispatcher
   * reviews it (assign reviewOf), woken on a chat-channel note carrying the report; none free → wait.
   */
  reviewWatch(task, now) {
    if (!this.reviewWatched(task)) {
      this.db.prepare('UPDATE tasks SET next_check_at = NULL WHERE id = ?').run(task.id);
      return;
    }
    const next = now + CHECK_AFTER_S;
    const chat = this.chatOf(task.room_id);
    const lead = task.created_by;
    const how = `验收 #${task.id}：回复里单独一行写【验收】#${task.id}；要返工就单独一行写【返工】#${task.id} 原因。`;
    // A delegated review waits on its reviewer, unless that reviewer went offline or failed (a turn
    // error, e.g. no model key): then the review moves on to another free teammate.
    const reviews = this.q.openReviews.all(task.id, ...WORKING);
    const unreachable = id => { const m = this.hub.members.get(id); return m === undefined || m.online === false || Boolean(m.error); };
    if (reviews.some(r => !unreachable(r.owner))) {
      this.q.setReviewCheck.get(next, null, task.id);
      return;
    }
    const tried = new Set(reviews.map(r => r.owner));
    if (!reviews.length && !this.memberBusy(lead) && task.remind_msg_id == null) {
      const { message } = this.hub.post(chat, { authorKind: 'system', author: 'system', name: '任务',
        card: JSON.stringify({ kind: 'task', task_id: task.id, event: 'remind' }),
        text: `@${this.nameOf(lead)} #${task.id}「${task.title}」交回 ${CHECK_AFTER_S / 60} 分钟还没验收。${how}` });
      this.q.setReviewCheck.get(next, message.id, task.id);
      this.wake(lead, message);
      this.changed(task.id);
      return;
    }
    const reviewer = this.hub.routableIn(chat).find(m => m.id !== task.owner && m.id !== lead && !tried.has(m.id) && m.kind !== 'human' && !this.memberBusy(m.id));
    if (reviewer === undefined) {
      this.q.setReviewCheck.get(next, null, task.id);
      return;
    }
    const result = task.result_msg_id == null ? undefined : this.store.message(task.result_msg_id);
    const body = result === undefined ? '' : (exitMark(result.text, { lastLine: true, team: this.hub.routable() })?.body ?? String(result.text));
    const cut = String(body).trim().length > BRIEF_HANDOFF ? `${String(body).trim().slice(0, BRIEF_HANDOFF)}…` : String(body).trim();
    const why = reviews.length ? `${reviews.map(r => this.nameOf(r.owner)).join('、')} 掉线或出错`
      : this.memberBusy(lead) ? `${this.nameOf(lead)} 在忙` : `${this.nameOf(lead)} 提醒后仍没验收`;
    const { message } = this.hub.post(chat, { authorKind: 'system', author: 'system', name: '任务',
      text: `@${reviewer.name} #${task.id}「${task.title}」交回超过 ${CHECK_AFTER_S / 60} 分钟，${why}，转给你验收（写的人 ${this.nameOf(task.owner)} 不验收自己的活）。`
        + `${cut ? `\n\n交回内容：\n${cut}` : ''}\n\n${how}` });
    let review;
    try {
      review = this.assign({ roomId: chat, title: `验收 #${task.id}「${task.title}」`, owner: reviewer.id, actor: lead, reviewOf: task.id,
        messageId: message.id, reason: `派活人忙超 ${CHECK_AFTER_S / 60} 分钟，自动转验收` });
    } catch (error) {
      this.hub.logger?.warn?.('collab: review handover for #%s failed: %s', task.id, error?.message ?? error);
      this.q.setReviewCheck.get(next, null, task.id);
      return;
    }
    this.record(task, 'handover', `#${task.id}「${task.title}」已转给 ${reviewer.name} 验收（#${review.id}）：${why}`, chat);
    this.q.setReviewCheck.get(next, null, task.id);
    this.wake(reviewer.id, message);
    this.changed(task.id);
  }

  /** The lead (or the human owner) closes the task or sends it back for rework. */
  review(id, { actor, verdict, note, messageId }) {
    const task = this.mustTask(id);
    const reviews = this.q.openReviews.all(id, ...WORKING);
    const delegated = actor !== task.owner && reviews.some(r => r.owner === actor && r.paused_at == null);
    if (actor !== task.created_by && actor !== HUMAN && !delegated) throw new CollabError('forbidden', `only ${this.nameOf(task.created_by)} or their delegated reviewer can review task ${id}`);
    if (actor === task.owner && actor !== HUMAN) throw new CollabError('forbidden', 'the author cannot review their own task');
    if (!REVIEWABLE.includes(task.status)) throw new CollabError('conflict', `task ${id} is ${STATUS[task.status]}, nothing to review`);
    if (verdict !== 'done' && verdict !== 'rework') throw new CollabError('invalid', 'verdict must be done or rework');
    // #574: a send-back always says why (same rule as board done: rework count > 0 needs a reason).
    if (verdict === 'rework' && !clip(note)) throw new CollabError('invalid', MISSING_REWORK_NOTE);
    // Rework is a new round with the same check time as a dispatch (source above).
    const check = verdict === 'rework' ? this.now() + CHECK_AFTER_S : null;
    const reclaim = verdict === 'rework' && this.reworkClaim(task);
    const row = this.q.set.get(verdict, check, clip(note) ?? task.note, this.now(), 0, id, task.status);
    if (row === undefined) throw new CollabError('conflict', `task ${id} changed meanwhile`);
    this.closeReviews(id, verdict, messageId);
    if (verdict === 'rework') this.q.resetRenewals.run(id);
    const tail = clip(note) ? `：${clip(note)}` : '';
    // A workspace task sent back: its owner is woken there on the record (nobody routes it there
    // otherwise), which says how to hand back as the pause record does (watch).
    const how = reclaim ? `。做完了就交回：回复第一行写【接】#${id}，下面写 [report] 和结果；没做完就第一行写【问】#${id}，说明做到哪一步、卡在哪。${this.briefing(row)}` : '';
    const record = this.record(row, verdict, verdict === 'done'
      ? `#${id}「${row.title}」验收完成（${this.nameOf(actor)}）`
      : `${reclaim ? `@${this.nameOf(row.owner)} ` : ''}#${id}「${row.title}」返工 → ${this.nameOf(row.owner)}（${this.nameOf(actor)}）${tail}${how}`);
    if (verdict === 'done') this.releaseIfDone(row.room_id);
    if (reclaim || (delegated && verdict === 'rework')) this.wake(row.owner, record);
    return this.changed(id);
  }

  /** Explicitly end obsolete work without claiming it passed review; identical retries are no-ops. */
  terminate(id, { actor, status, reason, supersededBy }) {
    const task = this.mustTask(id);
    if (actor !== task.created_by && actor !== HUMAN) throw new CollabError('forbidden', '取消或替代任务需要原派活人或用户操作；请交给原派活人，或由用户在任务板操作');
    if (typeof reason !== 'string' || !reason.trim() || reason.length > MAX_TEXT) throw new CollabError('invalid', '请填写取消或替代原因，长度不能超过消息上限');
    reason = reason.trim();
    const replacement = supersededBy == null || supersededBy === '' ? null : Number(supersededBy);
    if (replacement !== null && (status !== 'superseded' || !Number.isSafeInteger(replacement) || replacement <= 0 || replacement === task.id)) throw new CollabError('invalid', '替代任务必须是另一条任务的编号');
    if (replacement !== null) this.mustTask(replacement);
    if (TERMINAL.includes(task.status)) {
      if (task.status === status && task.termination_reason === reason && task.superseded_by === replacement) return this.view(task);
      throw new CollabError('conflict', `task ${id} is already ${STATUS[task.status]}; a different terminal request cannot overwrite it`);
    }
    const row = this.db.prepare(`UPDATE tasks SET status = ?, termination_reason = ?, superseded_by = ?,
      next_check_at = NULL, remind_msg_id = NULL, updated_at = ? WHERE id = ? AND status = ? RETURNING *`)
      .get(status, reason, replacement, this.now(), id, task.status);
    if (row === undefined) throw new CollabError('conflict', `task ${id} changed meanwhile`);
    // No claim/resume: cancelling a parked task must never reclaim a reused workspace.
    this.closeReviews(id, status);
    // The card already carries the title; retain the full reason in the task even if the record needs clipping.
    const text = `#${id} ${STATUS[status]}（${this.nameOf(actor)}）${replacement === null ? '' : `；替代任务 #${replacement}`}：${reason}`;
    this.record(row, status, text.slice(0, MAX_TEXT));
    this.releaseIfDone(row.room_id);
    return this.changed(id);
  }

  /**
   * A workspace task (not a bridge claim's) about to be sent back: its hand-back may have released
   * the workspace, so it is claimed again for the chat channel above it with this task as the
   * handoff (as resumeClaim does); one another chat channel claimed since refuses the rework with
   * 'workspace-owned'. True when the task is such a workspace task.
   */
  reworkClaim(task) {
    if (!this.tree || this.store.room(task.room_id)?.kind !== 'workspace' || this.store.bridgeClaimed(task.room_id)) return false;
    const chat = this.chatOf(task.room_id);
    const owner = this.store.workspaceOwner(task.room_id);
    if (owner != null && owner !== chat) {
      throw new CollabError('workspace-owned', `task ${task.id}'s workspace now belongs to room ${owner}; hand it off again to a free workspace`);
    }
    if (owner == null) this.store.claimWorkspace(chat, task.room_id, { handoff: task.id });
    return true;
  }

  /**
   * One API action (#139 B) for a sender. `verified` says the actor comes from
   * the connection or session (owner's browser, a cloud-web bot's socket, the
   * author of a member's message), not from a self-reported body field.
   * Unverified actors (body.actor under the shared bot token) must name an
   * existing non-human member and can never review: acceptance only counts
   * from the dispatcher or the human owner when the server knows who it is.
   * @param action - assign | stance | return | review | cancel | supersede.
   * @param args - { id?: task id, roomId?: room for assign, body: request fields }.
   */
  perform(action, { id, roomId, body = {} }, { actor, verified }) {
    actor = String(actor ?? '');
    if (!verified) {
      const m = this.hub.members.get(actor);
      if (!actor || actor === HUMAN || m === undefined || m.kind === 'human') throw new CollabError('forbidden', 'actor must name an existing member other than the owner');
      if (['review', 'cancel', 'supersede'].includes(action)) throw new CollabError('forbidden', `${action} needs a verified sender: 请派活人通过自己的连接操作，或由用户在任务板操作；共享 bot token 和一次性回查票据不能关闭任务`);
    }
    const optional = v => (v == null || v === '' ? undefined : Number(v));
    switch (action) {
      case 'assign':
        if (body.review_of != null && !verified) throw new CollabError('forbidden', 'delegating review needs a verified sender');
        return this.assign({ roomId, title: body.title, owner: String(body.owner ?? ''), actor, parentTask: optional(body.parent_task), reviewOf: optional(body.review_of), messageId: optional(body.message_id), reason: body.reason, ref: String(body.ref ?? ''), base: body.base, force: Boolean(body.force) });
      case 'stance': return this.stance(id, { actor, stance: String(body.stance ?? ''), note: body.note, messageId: optional(body.message_id) });
      case 'return': return this.handBack(id, { actor, messageId: optional(body.message_id) });
      case 'review': return this.review(id, { actor, verdict: String(body.verdict ?? ''), note: body.note });
      case 'cancel':
      case 'supersede': return this.terminate(id, { actor, status: action === 'cancel' ? 'cancelled' : 'superseded', reason: body.reason, supersededBy: body.superseded_by });
      default: throw new CollabError('invalid', 'action must be assign, stance, return, review, cancel or supersede');
    }
  }

  /** A member reply whose first line is 【接】【问】【退】【升】 (optionally #id) answers its task. */
  fromMessage(msg) {
    return this.route(msg);
  }

  route(msg) {
    // #1598: a person's @ in a chat channel waits for the member's stance, like the lead's.
    if (msg.author_kind === 'user' && msg.card === null) { this.callsFromPerson(msg); return undefined; }
    if (msg.author_kind !== 'role' || msg.card !== null) return undefined;
    if (this.hub.teamExit?.consumeRejected(msg.id)) return undefined;
    const lead = this.store.leadId(msg.room_id) === null ? this.hub.primaryMember() : this.hub.primaryIn(msg.room_id);
    // Watch posts arrive as the lead. Ignore them before verdicts, stances, hand-backs or implicit reviews.
    if (msg.author === lead?.id && isWatchNotice(msg.text, this.hub.routableIn(msg.room_id))) return undefined;
    // #1540: a reply that is only a model error (a bridge bot posts the CLI's text as is) is no
    // stance, hand-back, verdict or dispatch: the owner's open task here is marked 出错.
    const failure = modelErrorReply(withoutLeadingMentions(String(msg.text), this.hub.routableIn(msg.room_id)));
    if (failure !== undefined) {
      if (msg.author !== lead?.id) this.failOpen(msg.room_id, msg.author, failure.zh);
      return undefined;
    }
    if (this.verdictsOf(msg)) return undefined;
    // #1598: her 【接】 to a call moved it into a workspace; this reply is only her stance.
    if (this.settleCall(msg)) return undefined;
    if (this.inWorkspace(msg.room_id) && workspaceAskMark(msg.text, this.hub.routableIn(msg.room_id))) return undefined;
    const stance = this.stanceOf(msg);
    const dsh = this.hub.members.get(msg.author)?.kind === 'dsh';
    const dshWorkspace = dsh && this.inWorkspace(msg.room_id);
    if (dshWorkspace) {
      // #597 G35: a DSH member (local CLI members too, dsh-member.mjs) posts one reply per turn, but a
      // turn ending is not a delivery. In a workspace only a reply marked [report] (team-exit exitMark,
      // first line or the turn's last part) hands its task back; a 【接】 alone (accepted, waiting) and an
      // [ask] (a question, forwarded by TeamExit) leave the task in work with its 10-minute watch.
      // Only the hand-back changes here: the lead's dispatch below (fromChat) goes on as before.
      const mark = exitMark(msg.text, { lastLine: true, team: this.hub.routable() });
      // A stance line naming #id speaks for that task only (gone or done: nothing to hand back).
      const named = STANCE_LINE.exec(withoutLeadingMentions(String(msg.text), this.hub.routable()).split('\n', 1)[0])?.[2] !== undefined;
      const task = stance !== undefined ? this.task(stance.id) : (named ? undefined : this.openOf(msg.room_id, msg.author));
      if (mark?.kind === 'report' && (stance === undefined || stance.status === 'accepted') && task !== undefined && task.source !== 'review' && WORKING.includes(task.status)) {
        // #597 G37: the hand-back does not end it: a lead's [report] @-ing a teammate dispatches too.
        const handed = this.handBack(task.id, { actor: msg.author, messageId: msg.id });
        this.fromChat(msg, { handBack: false });
        return handed;
      }
    } else if (stance?.status === 'accepted' && this.task(stance.id).source !== 'review' && dsh) {
      // #1598: in a chat channel of the tree a DSH member's 【接】 moves its task into a workspace
      // (she does it there and hands back with [report]); without workspaces it is still her delivery.
      // A bridge bot may keep working after its 【接】, so its stance stays a stance.
      const task = this.task(stance.id);
      if (this.chatChannel(task.room_id)) {
        this.toWorkspace({ roomId: task.room_id, owner: task.owner, lead: task.created_by, title: task.title, messageId: task.assign_msg_id }, msg, task);
        return undefined;
      }
      return this.handBack(stance.id, { actor: msg.author, messageId: msg.id });
    }
    if (stance !== undefined) return stance;
    // A stance naming a task of another room speaks about that task: it hands back nothing here either.
    if (this.foreignStance(msg)) return undefined;
    // A 【问】【退】【升】 reply with no task to answer is a question or a pushback, never a hand-back.
    if (/^【(问|退|升)】/.test(withoutLeadingMentions(String(msg.text), this.hub.routableIn(msg.room_id)).trimStart())) return undefined;
    if (NOTICE_PREFIXES.some(p => String(msg.text).trimStart().startsWith(p))) return undefined;
    return this.fromChat(msg, { handBack: !dshWorkspace });
  }

  /**
   * Lines 【验收】#id / 【返工】#id 原因 in a chat-channel reply review the workspace tasks they
   * name: only the task's dispatcher, only for a workspace under this chat channel. Anything
   * else the dispatcher says (a reply to someone else, a send-back without the line) changes nothing.
   */
  verdictsOf(msg) {
    let applied = false;
    for (const [, word, id, note] of String(msg.text).matchAll(VERDICT_LINE)) {
      const task = this.task(Number(id));
      if (task === undefined || this.chatOf(task.room_id) !== this.chatOf(msg.room_id)) continue;
      // A dispatcher teaching an independent reviewer the verdict syntax is delegating,
      // even when those example commands occupy their own lines.
      if (task.created_by === msg.author) {
        const team = this.hub.routableIn(msg.room_id);
        const explicit = mentions(String(msg.text), team);
        if (team.some(m => m.id !== msg.author && m.id !== task.owner
            && (explicit.has(m.id) || nameCalled(String(msg.text), m.name, team.map(t => t.name))))) continue;
      }
      // Dispatchers review in the chat channel; delegated reviewers may work in their review workspace.
      if (this.inWorkspace(msg.room_id) && !this.db.prepare(`SELECT id FROM tasks WHERE parent_task = ?
          AND source = 'review' AND room_id = ? AND owner = ? AND ${LIVE}`).get(task.id, msg.room_id, msg.author, ...WORKING)) continue;
      try {
        this.review(task.id, { actor: msg.author, verdict: word === '验收' ? 'done' : 'rework', note: word === '返工' ? note.trim() : undefined, messageId: msg.id });
        applied = true;
      } catch (error) {
        this.hub.logger?.warn?.('collab: %s #%s from %s refused: %s', word, id, msg.author, error?.message ?? error);
      }
    }
    return applied;
  }

  /**
   * #597 G35: a DSH owner woken (rework, pause) with no session left in the task's workspace (a new
   * claim cleared it, store.resetSessions) starts with nothing but the wake: it gets the original
   * handoff and its last [report], so it never reports on work it cannot see. '' while its session
   * is there (it goes on in it) and for other members.
   */
  briefing(task) {
    if (this.hub.members.get(task.owner)?.kind !== 'dsh' || this.store.binding(task.owner, task.room_id) !== undefined) return '';
    const handoff = task.assign_msg_id == null ? undefined : this.store.message(task.assign_msg_id);
    const result = task.result_msg_id == null ? undefined : this.store.message(task.result_msg_id);
    const report = result === undefined ? '' : (exitMark(result.text, { lastLine: true, team: this.hub.routable() })?.body ?? String(result.text));
    const cut = (t, n) => { const v = String(t ?? '').trim(); return v.length > n ? `${v.slice(0, n)}…` : v; };
    const parts = [];
    if (handoff !== undefined) parts.push(`原交接：\n${cut(handoff.text, BRIEF_HANDOFF)}`);
    if (report.trim()) parts.push(`上次 [report] 摘录：\n${cut(report, BRIEF_REPORT)}`);
    return parts.length ? `\n\n这是新会话，接着做要的上下文：\n${parts.join('\n\n')}` : '';
  }

  /** True when roomId is a workspace (team mode A). */
  inWorkspace(roomId) { return this.tree && this.store.room(roomId)?.kind === 'workspace'; }

  /** owner's latest task in work in roomId (not paused-only: a paused one is resumed by handBack). */
  openOf(roomId, owner) {
    return this.db.prepare(`SELECT * FROM tasks WHERE room_id = ? AND owner = ? AND status IN (${PLACEHOLDERS}) ORDER BY id DESC LIMIT 1`)
      .get(roomId, owner, ...WORKING);
  }

  /** The first line is a stance whose #id names a task in another room. */
  foreignStance(msg) {
    const m = STANCE_LINE.exec(withoutLeadingMentions(String(msg.text), this.hub.routable()).split('\n', 1)[0]);
    const task = m?.[2] !== undefined ? this.task(Number(m[2])) : undefined;
    return task !== undefined && task.room_id !== msg.room_id;
  }

  stanceOf(msg) {
    // A bridge final reply opens with the lead's @ (lead_return.go), so skip leading mentions.
    const first = withoutLeadingMentions(String(msg.text), this.hub.routableIn(msg.room_id)).split('\n', 1)[0];
    const m = STANCE_LINE.exec(first);
    if (m === null) return undefined;
    // Members open every reply with a stance, so without #id only a not-yet-answered
    // dispatch counts; once answered, changing that task needs its #id.
    const task = m[2] !== undefined ? this.task(Number(m[2]))
      : this.q.latestAssigned.get(msg.room_id, msg.author);
    // A task is answered in its own room: a 【接】#id in the chat channel about a workspace task is
    // talk about it (and for a DSH member would be a hand-back without the work), not its answer.
    if (task === undefined || task.room_id !== msg.room_id || task.owner !== msg.author || !WORKING.includes(task.status)) return undefined;
    return this.stance(task.id, { actor: msg.author, stance: m[1], note: m[3], messageId: msg.id });
  }

  /**
   * The board follows the channel the way Discord's task card follows a lead's dispatch,
   * without the task API: the primary role @-ing (or calling by leading name) teammates
   * opens one task per teammate that has none open from it in this room; a teammate's
   * reply that @-s the dispatcher (cloud-web lead_return adds it to every final reply)
   * hands its open task back; the dispatcher's next message accepts what was handed back here
   * (a workspace task needs its 【验收】#id line, verdictsOf).
   */
  fromChat(msg, { handBack = true } = {}) {
    const lead = this.store.leadId(msg.room_id) === null ? this.hub.primaryMember() : this.hub.primaryIn(msg.room_id);
    const team = this.hub.routableIn(msg.room_id);
    const text = String(msg.text);
    if (lead !== undefined && msg.author === lead.id) {
      const reviewIds = new Set([...text.matchAll(/【(?:验收|返工)】[ \t]*#(\d+)/g)].map(m => Number(m[1])));
      const reviewOf = reviewIds.size === 1 ? this.task([...reviewIds][0]) : undefined;
      const reviewing = reviewOf?.created_by === lead.id && REVIEWABLE.includes(reviewOf.status)
        && this.chatOf(reviewOf.room_id) === this.chatOf(msg.room_id) ? reviewOf : undefined;
      // Its next message after a chat-side hand-back accepts it. Workspace tasks need its explicit
      // 【验收】#id / 【返工】#id line (verdictsOf): it may be answering something else meanwhile.
      for (const t of this.q.returnedChat.all(msg.room_id, lead.id)) {
        if (t.id === reviewing?.id || this.db.prepare(`SELECT id FROM tasks WHERE parent_task = ? AND source = 'review' AND status IN (${PLACEHOLDERS})`).get(t.id, ...WORKING)) continue;
        try { this.review(t.id, { actor: lead.id, verdict: 'done' }); } catch { /* changed meanwhile */ }
      }
      const explicit = mentions(text, team);
      const called = new Set(explicit);
      const names = team.map(m => m.name);
      for (const m of team) if (nameCalled(text, m.name, names)) called.add(m.id);
      called.delete(lead.id);
      const title = taskTitle(text, team);
      if (!title) return undefined;
      for (const owner of called) {
        if (reviewing !== undefined) {
          this.openFromChat({ roomId: msg.room_id, owner, lead: lead.id, title, messageId: msg.id, source: 'review', reviewOf: reviewing.id });
          continue;
        }
        // #597 r12: structure, not wording. Once the owner's newest task here is handed back or
        // accepted, a bare-name call may be praise about the delivery or a send-back: the task opens
        // only when her next message here opens with a stance line (settleCall). For a bridge bot, and
        // without workspaces (no tree, a DM, a workspace), #1588 still holds: an explicit @ opens at once unless it is only
        // thanks or 「收到」 (ackOnly), and only a retry call re-sends a failed task (retryCall).
        const key = `${msg.room_id}\0${owner}`;
        // #1598: in a chat channel of the tree every @ is answered here first: a question or a small
        // job opens nothing; her reply opening with 【接】 moves it into a workspace (settleCall).
        if (this.staysForStance(msg.room_id, owner)) {
          this.addCall({ roomId: msg.room_id, owner, lead: lead.id, title, messageId: msg.id });
          continue;
        }
        this.pendingCalls.delete(key);
        // #1588: thanks or 「收到」 alone opens nothing and re-sends nothing.
        if (ackOnly(withoutLeadingMentions(text, team))) continue;
        const latest = this.q.latestOf.get(msg.room_id, owner);
        // #1540: a call after her turn failed sends the same task again; #1588: only a retry call
        // (its title, or 「重试」「继续」…) does, a new job opens a new task and keeps its own title.
        if (latest?.status === 'failed' && latest.created_by === lead.id && retryCall(title, latest)) { this.retryFailed(latest.id); continue; }
        // After a delivery an explicit @ opens at once; a bare name waits for her stance (r12).
        if (DELIVERED.includes(latest?.status)) {
          if (!explicit.has(owner)) {
            this.pendingCalls.set(key, { roomId: msg.room_id, owner, lead: lead.id, title, messageId: msg.id, at: this.now() });
            continue;
          }
        }
        this.openFromChat({ roomId: msg.room_id, owner, lead: lead.id, title, messageId: msg.id, source: 'mention' });
      }
      return undefined;
    }
    // handBack false: a DSH reply in a workspace, which hands back only with [report] (fromMessage).
    if (!handBack) return undefined;
    const callsLead = lead !== undefined && (mentions(text, team).has(lead.id) || nameCalled(text, lead.name, team.map(m => m.name)));
    if (!callsLead) return undefined;
    const open = this.q.openChat.get(msg.room_id, msg.author, lead.id, ...WORKING);
    if (open === undefined || open.source === 'review') return undefined;
    return this.handBack(open.id, { actor: msg.author, messageId: msg.id });
  }

  /**
   * #597 r12: the owner's next message in a room settles the lead's bare-name call waiting there
   * (fromChat). A first line 【接】【问】【退】【升】 without #id opens the task, which stanceOf then
   * answers with that stance; anything else (thanks, chat), a stance naming #id, or a reply after
   * PENDING_CALL_S drops it.
   */
  settleCall(msg) {
    const key = `${msg.room_id}\0${msg.author}`;
    const call = this.pendingCalls.get(key);
    if (call === undefined) return false;
    this.pendingCalls.delete(key);
    if (this.now() - call.at > PENDING_CALL_S) return false;
    const stays = this.staysForStance(call.roomId, call.owner);
    // #1598: her reply settles the calls she had read when her turn started (her session's cursor);
    // one that came in after waits for her next reply, so 「在吗」 answered does not drop the job after it.
    const ids = call.messageIds ?? [call.messageId];
    const seen = stays ? this.store.binding(msg.author, msg.room_id)?.context_cursor : undefined;
    const read = seen == null ? ids : ids.filter(id => id <= seen);
    const settled = read.length ? read : ids;
    const later = ids.filter(id => !settled.includes(id));
    if (later.length) {
      const first = this.store.message(later[0]);
      const title = taskTitle(String(first?.text ?? ''), this.hub.routableIn(call.roomId)) || call.title;
      this.pendingCalls.set(key, { ...call, title, messageId: later[0], messageIds: later, at: call.at });
    }
    const m = STANCE_LINE.exec(withoutLeadingMentions(String(msg.text), this.hub.routable()).split('\n', 1)[0]);
    if (m === null || m[2] !== undefined) return false;
    const answered = { ...call, messageIds: settled };
    try {
      if (stays) {
        // #1598: only the member who read the call can tell a big job; her 【接】 is that call.
        if (m[1] === '接') return this.toWorkspace(answered, msg) !== undefined;
        // Her 【问】 waits for the answer: the answer joins this call and her 【接】 then moves both.
        if (m[1] === '问') { this.pendingCalls.set(key, { ...call, messageIds: ids, at: this.now() }); return false; }
      }
      this.openFromChat({ ...answered, source: 'mention' });
    } catch (error) {
      this.hub.logger?.warn?.('collab: pending call failed: %s', error?.message ?? error);
    }
    return false;
  }

  /**
   * #1598: record a call waiting for owner's stance. Calls before her reply add up (a job told in
   * several messages, or a question's answer): the title stays the first one's, her 【接】 moves them all.
   */
  addCall(call) {
    const key = `${call.roomId}\0${call.owner}`;
    const was = this.pendingCalls.get(key);
    const fresh = was === undefined || was.lead !== call.lead || this.now() - was.at > PENDING_CALL_S;
    this.pendingCalls.set(key, fresh
      ? { ...call, messageIds: [call.messageId], at: this.now() }
      : { ...was, messageIds: [...(was.messageIds ?? [was.messageId]), call.messageId], at: this.now() });
  }

  /** #1598: roomId is a chat channel of the tree (not a DM). */
  chatChannel(roomId) {
    return this.tree && this.store.room(roomId)?.kind === 'chat' && this.store.dmMember(roomId) === undefined;
  }

  /**
   * #1598: an @ to owner in roomId waits for her stance and her 【接】 moves it into a workspace: a DSH
   * member in a chat channel of the tree. A bridge bot hands its own big job over (ws-handoff), so
   * its @ keeps opening a chat-side task and a second workspace never opens for the same job.
   */
  staysForStance(roomId, owner) {
    return this.chatChannel(roomId) && this.hub.members.get(owner)?.kind === 'dsh';
  }

  /**
   * #1598: a person's @ (or reply) to members in a chat channel waits for each one's stance, as the
   * lead's does: the task, on behalf of the channel's lead, opens only on her 【接】, in a workspace.
   */
  callsFromPerson(msg) {
    if (!this.chatChannel(msg.room_id)) return;
    const lead = this.store.leadId(msg.room_id) === null ? this.hub.primaryMember() : this.hub.primaryIn(msg.room_id);
    if (lead === undefined) return;
    const team = this.hub.routableIn(msg.room_id);
    // A command (/new, /stop …) is not a call.
    if (withoutLeadingMentions(String(msg.text), team).trimStart().startsWith('/')) return;
    const title = taskTitle(String(msg.text), team);
    if (!title) return;
    // Whom the message reaches (DshMembers.plan): its @s or the replied-to member, else the default reply.
    const only = this.hub.replyRoute(msg);
    const called = new Set(only ?? mentions(String(msg.text), team));
    const fallback = this.hub.defaultReplyIn?.(msg.room_id);
    if (only === null && called.size === 0 && fallback !== undefined) called.add(fallback.id);
    // The lead herself too: a big job asked of her moves on her own 【接】, the task hers to hand back.
    // Walk 11-14: that task is the person's, not dispatched by the lead to herself: review() forbids
    // reviewing your own task, so her 【验收】 was refused and it waited forever. The person accepts it.
    for (const owner of called) if (this.staysForStance(msg.room_id, owner)) this.addCall({ roomId: msg.room_id, owner, lead: owner === lead.id ? HUMAN : lead.id, title, messageId: msg.id });
  }

  /**
   * #1598: move a call (or the chat-side task `from`) into a workspace once the member's reply
   * opens with 【接】: a workspace from the pool (or a new one), a 【交接】 row with the call's body,
   * its files and what she wrote after her 【接】 (the workspace session has no chat history), the
   * task opened there for the lead to accept, and the member woken on that row. Returns the task.
   */
  toWorkspace(call, reply, from) {
    const team = this.hub.routableIn(call.roomId);
    const triggers = (call.messageIds ?? [call.messageId]).filter(id => id != null).map(id => this.store.message(id)).filter(Boolean);
    const body = triggers.map(t => withoutLeadingMentions(String(t.text ?? ''), team).trim()).filter(Boolean).join('\n\n') || call.title;
    const note = withoutLeadingMentions(String(reply.text), team).trim().replace(/^【接】[\s，,。.：:、]*/, '').trim();
    const name = this.nameOf(call.owner);
    const extra = note ? `\n\n${name}【接】时说：${note}` : '';
    // Never cut the call's body: what she added gives way first, then the prefix.
    const room = MAX_TEXT - body.length;
    const tail = extra.length <= room ? extra : '';
    const prefix = [`【交接】${name}：`, '【交接】'].find(p => p.length <= room - tail.length) ?? '';
    const attachments = triggers.flatMap(t => messageAttachments(t));
    // #1616: the same job already moved for another member: join her workspace, so both work on
    // one set of files and see each other's messages; the note tells who is already there.
    const jointKey = `${call.roomId}\0${triggers[0]?.id ?? call.messageId}`;
    const joint = this.jointWorkspaces.get(jointKey);
    const joined = joint !== undefined && this.store.workspaceOwner(joint.id) === this.chatOf(call.roomId)
      && this.store.claimId(joint.id) === joint.claim ? this.store.room(joint.id) : undefined;
    const workspace = joined ?? this.store.createWorkspace(call.roomId);
    if (joined === undefined) this.jointWorkspaces.set(jointKey, { id: workspace.id, claim: this.store.claimId(workspace.id), owners: [call.owner] });
    else joint.owners.push(call.owner);
    const together = joined === undefined ? '' : `\n\n同一件活 ${joint.owners.filter(o => o !== call.owner).map(o => this.nameOf(o)).join('、')} 也在这个工作区：先看上面的消息，按原话分工，要商量就 @ 对方。`;
    this.hub.emit({ type: 'rooms', rooms: this.store.roomsView() });
    const { message } = this.hub.post(workspace.id, {
      authorKind: 'system', author: 'system', name: '交接',
      text: `${prefix}${body}${tail}${together.length <= room - prefix.length - tail.length ? together : ''}`,
      ...(attachments.length ? { attachments } : {}),
    });
    let task;
    try {
      task = this.openFromChat({ roomId: workspace.id, owner: call.owner, lead: call.lead, title: call.title, messageId: message.id, source: 'workspace' });
    } finally {
      // A workspace no task followed into is never released by the idle sweep (claim_task 0).
      if (task === undefined && this.countActive(workspace.id) === 0) { try { this.release(workspace.id); } catch { /* claimed meanwhile */ } }
    }
    if (task === undefined) return undefined;
    if (from !== undefined) {
      try {
        this.handBack(from.id, { actor: from.owner, messageId: message.id });
        this.review(from.id, { actor: from.created_by, verdict: 'done', note: `转到${workspace.name} #${task.id}` });
      } catch (error) {
        this.hub.logger?.warn?.('collab: closing #%s after its move failed: %s', from.id, error?.message ?? error);
      }
    }
    this.wake(call.owner, message);
    return task;
  }

  /**
   * Open a chat-side task unless the owner already has one open from this lead in this room, or one
   * the lead handed to a workspace under it (the lead's later @ just tells the owner about it).
   */
  openFromChat({ roomId, owner, lead, title, messageId, source, reviewOf }) {
    if (!this.hub.members.has(owner) || this.q.openChat.get(roomId, owner, lead, ...WORKING) !== undefined) return undefined;
    if (this.q.openHanded?.get(owner, lead, ...WORKING, roomId) !== undefined) return undefined;
    // force: the channel already dispatched it; the board records it even if the owner is busy elsewhere.
    const task = this.assign({ roomId, title, owner, actor: lead, messageId, reviewOf, force: true });
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
    const team = this.hub.routableIn(roomId);
    for (const m of members) {
      if (m === null || typeof m !== 'object' || m.parent_id) continue;
      const project = String(m.reporter_project ?? '');
      const name = String(m.name ?? '').toLowerCase();
      const owner = team.find(t => (project && t.id === project) || (name && t.name.toLowerCase() === name));
      if (owner === undefined || owner.id === lead) continue;
      const status = String(m.status ?? '');
      try {
        const mirrored = m.id
          ? this.db.prepare("SELECT * FROM tasks WHERE room_id = ? AND assign_msg_id = ? AND card_member_id = ? AND source = 'card'").get(roomId, messageId, m.id)
          : this.db.prepare("SELECT * FROM tasks WHERE room_id = ? AND assign_msg_id = ? AND owner = ? AND card_member_id IS NULL AND source = 'card' ORDER BY id DESC LIMIT 1").get(roomId, messageId, owner.id);
        if (mirrored && TERMINAL.includes(mirrored.status)) continue;
        if (mirrored && mirrored.owner !== owner.id && WORKING.includes(mirrored.status)) this.reassignForQuota(mirrored, owner.id);
        if (['queued', 'running', 'waiting'].includes(status)) {
          const title = String(m.title ?? '').trim() || String(m.name ?? '').trim();
          if (title) {
            const opened = this.openFromChat({ roomId, owner: owner.id, lead, title, messageId, source: 'card' });
            if (opened && m.id) this.db.prepare('UPDATE tasks SET card_member_id = ? WHERE id = ?').run(m.id, opened.id);
          }
        // `result` is the public-progress report kind; newer bridge cards
        // normalize it to `completed`, while older cards expose it directly.
        // Keep `done` for cards produced by older task-card implementations.
        } else if (['result', 'completed', 'done', 'failed', 'cancelled', 'interrupted'].includes(status)) {
          const open = this.q.openChat.get(roomId, owner.id, lead, ...WORKING);
          if (open !== undefined && open.source !== 'review') this.handBack(open.id, { actor: owner.id, messageId });
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
    for (const task of this.q.open.all(...WORKING)) {
      // Only a member that was actually removed closes its work: a merely offline member, or a
      // pause the user asked for, must be able to resume later.
      if (task.owner === HUMAN) continue;
      const removed = this.db.prepare('SELECT removed FROM members WHERE id = ?').get(task.owner)?.removed === 1;
      if (!removed) continue;
      const reason = '负责人已移除，自动收口';
      const row = this.q.autoClose.get(reason, now, now, task.id, ...WORKING);
      if (row === undefined) continue;
      const text = `#${row.id}「${row.title}」${reason}。`;
      if (row.paused_at != null && row.paused_chat != null && row.paused_chat !== this.chatOf(row.room_id)) {
        const card = JSON.stringify({ kind: 'task', task_id: row.id, event: 'return' });
        const message = { authorKind: 'system', author: 'system', name: '任务', text, card };
        this.hub.post(row.room_id, message);
        this.hub.post(row.paused_chat, message);
      } else this.record(row, 'return', text);
      this.releaseIfDone(row.room_id);
      this.store.releaseIdleWorkspaces();
      this.changed(row.id);
    }
    for (const task of this.q.allBusy.all(...WORKING)) {
      if (this.watched(task) && watchDue(task) <= now) this.watch(task, now);
    }
    for (const task of this.q.reviewWait.all()) {
      if (task.next_check_at <= now) this.reviewWatch(task, now);
    }
    for (const task of this.q.due.all(now, ...WORKING)) {
      if (this.store.room(task.room_id)?.kind === 'workspace') continue;
      if (this.hub.quota?.cooling(task.owner)) {
        this.q.renew.get(now + CHECK_AFTER_S, task.renewals ?? 0, task.id, ...WORKING);
        continue;
      }
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
    if (this.hub.quota?.cooling(task.owner)) {
      this.q.renew.get(now + CHECK_AFTER_S, task.renewals ?? 0, task.id, ...WORKING);
      return;
    }
    const renewals = task.renewals ?? 0;
    // #597 G35: an owner waiting on its [ask] waits on the user, not stuck: no progress check, no
    // reminder, no pause (which would release the workspace the answer comes back to). The watch
    // only moves on, renewals untouched; the answer re-arms it (rewatch).
    if (this.awaitingUser(task)) {
      if (this.q.renew.get(now + CHECK_AFTER_S, renewals, task.id, ...WORKING) !== undefined) this.changed(task.id);
      return;
    }
    if ((this.maxRenewals <= 0 || renewals < this.maxRenewals) && this.progressed(task, watchDue(task) - CHECK_AFTER_S)) {
      if (this.q.renew.get(now + CHECK_AFTER_S, renewals + 1, task.id, ...WORKING) !== undefined) this.changed(task.id);
      return;
    }
    const why = this.maxRenewals > 0 && renewals >= this.maxRenewals ? `已续期 ${this.maxRenewals} 次` : `${CHECK_AFTER_S / 60} 分钟内没有新进展`;
    // The owner is woken on this record, often in a fresh session (the pause released the
    // workspace): it says what to answer, as the bridge's watch reminder does (core/team_watch.go).
    const message = this.record(task, 'pause', `@${this.nameOf(task.owner)} #${task.id}「${task.title}」${why}，已暂停。`
      + `做完了就交回：回复第一行写【接】#${task.id}，下面写 [report] 和结果；没做完就第一行写【问】#${task.id}，说明做到哪一步、卡在哪。${this.briefing(task)}`);
    if (this.pauseTask(task.id)) this.wake(task.owner, message);
  }

  /**
   * #597 G35: the task's owner is waiting on the user: its latest own text row in the task's
   * workspace is an [ask] (team-exit team_exit_asks, posted after the task was handed over) the user
   * has not answered yet. An older unanswered [ask] the owner moved on from (a later reply, a
   * hand-back, a rework turn) does not hold the watch.
   */
  awaitingUser(task) {
    if (!this.hub.teamExit?.enabled) return false;
    return this.db.prepare(`SELECT 1 FROM team_exit_asks WHERE workspace_id = ? AND member_id = ? AND answered = 0
      AND source_id > ? AND source_id = (SELECT MAX(id) FROM messages WHERE room_id = ? AND author = ?
        AND deleted = 0 AND card IS NULL) LIMIT 1`)
      .get(task.room_id, task.owner, task.assign_msg_id ?? 0, task.room_id, task.owner) !== undefined;
  }

  /**
   * #597 G35: the user's answer to owner's [ask] reached workspace roomId (TeamExit): the owner's
   * tasks in work there get a fresh CHECK_AFTER_S watch window from now.
   */
  rewatch(roomId, owner) {
    const now = this.now();
    for (const task of this.q.allBusy.all(...WORKING)) {
      if (task.room_id !== roomId || task.owner !== owner || !this.watched(task) || this.awaitingUser(task)) continue;
      if (this.q.renew.get(now + CHECK_AFTER_S, task.renewals ?? 0, task.id, ...WORKING) !== undefined) this.changed(task.id);
    }
    this.arm();
  }

  /**
   * Progress = the owner's own rows posted or changed in place since `since`: its progress card
   * (or any card it owns) moving, or text beyond a first stance line (【接】【问】【退】【升】) that is
   * not a status notice. Same rule as contrib/lead/d10-fire chat_active, with the stance line taken
   * off instead of the whole row: a DSH member's one reply opens with 【接】#id and grows in place.
   */
  progressed(task, since) {
    return this.q.ownerSaid.all(task.room_id, task.owner, since).some(({ text, card }) => {
      if (card != null) return true;
      const lines = withoutLeadingMentions(String(text ?? ''), this.hub.routableIn(task.room_id)).trim().split('\n');
      if (STANCE_LINE.test(lines[0])) lines.shift();
      const body = lines.join('\n').trim();
      return body !== '' && !NOTICE_PREFIXES.some(p => body.startsWith(p));
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
    const task = this.q.takeRemind.get(taskId, msgId, ...WORKING);
    if (task === undefined) return;
    if (message === undefined) return;
    this.delivering = true;
    let taken;
    try { taken = this.wake(task.owner, message); } finally { this.delivering = false; }
    if (!taken) this.q.putRemind.run(msgId, taskId, ...WORKING);
  }

  /** Start memberId on message through the first waker that takes it; true if one did. */
  wake(memberId, message) {
    if (this.hub.quota?.cooling(memberId)) return false;
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
    const at = this.q.open.all(...WORKING)
      .map(t => {
        if (t.owner === HUMAN) return null;
        const removed = this.db.prepare('SELECT removed FROM members WHERE id = ?').get(t.owner)?.removed === 1;
        if (removed) return this.now();
        if (t.paused_at != null) return null;
        return this.store.room(t.room_id)?.kind !== 'workspace' ? t.next_check_at : this.watched(t) ? watchDue(t) : null;
      })
      .concat(this.q.reviewWait.all().map(t => t.next_check_at))
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

  /**
   * One system record (task card) in the task room and, for a workspace, its chat channel; none in
   * room skip (the room of the dispatch message, which shows the card itself). Returns the task
   * room's record (undefined when skipped).
   */
  record(task, event, text, skip) {
    const card = JSON.stringify({ kind: 'task', task_id: task.id, event });
    const m = { authorKind: 'system', author: 'system', name: '任务', text, card };
    const currentChat = this.chatOf(task.room_id);
    const chat = task.paused_at != null && task.paused_chat != null ? task.paused_chat : currentChat;
    const message = task.room_id === skip || chat !== currentChat ? undefined : this.hub.post(task.room_id, m).message;
    if (chat !== undefined && chat !== task.room_id && chat !== skip) this.hub.post(chat, m);
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
    for (const [key, joint] of this.jointWorkspaces) if (joint.id === roomId) this.jointWorkspaces.delete(key);
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

  /** Park only this member's failed workspace work, with a notice but no retry wake. */
  /**
   * #1540: owner's turn in roomId ended in a model error (modelErrorReply, dsh-member fail). Its open
   * task there is 出错, not 交回: the lead's next message accepts nothing and its next call re-sends it.
   * A workspace task is parked instead (pauseForFailure), the same as an upstream internal error.
   */
  failOpen(roomId, owner, reason) {
    if (this.store.room(roomId)?.kind === 'workspace') return this.pauseForFailure(roomId, owner, reason);
    const task = this.openOf(roomId, owner);
    if (task === undefined) return undefined;
    const row = this.q.set.get('failed', null, clip(reason), this.now(), 0, task.id, task.status);
    if (row === undefined) return undefined;
    this.record(row, 'failed', `#${row.id}「${row.title}」${this.nameOf(row.owner)} 出错：${reason}（不算交回）`);
    return this.changed(row.id);
  }

  /** #1540: the lead called the owner again after her turn failed: the same task is in work again. */
  retryFailed(id) {
    const row = this.q.set.get('assigned', this.now() + CHECK_AFTER_S, null, this.now(), 0, id, 'failed');
    if (row === undefined) return undefined;
    this.record(row, 'retry', `#${id}「${row.title}」重新派给 ${this.nameOf(row.owner)}`);
    return this.changed(id);
  }

  pauseForFailure(roomId, owner, reason) {
    if (this.store.room(roomId)?.kind !== 'workspace') return;
    for (const task of this.q.allBusy.all(...WORKING)) {
      if (task.room_id !== roomId || task.owner !== owner || task.paused_at != null) continue;
      // Record before release so the parent chat still receives the notification.
      // Unlike the idle watch, never wake the failed provider on its own notice.
      this.record(task, 'pause', `#${task.id}「${task.title}」已暂停：${reason}`);
      this.pauseTask(task.id);
    }
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
    // The resumed task is this claim's handoff: handing it back frees the workspace again (handoffDone).
    if (owner == null && reclaim) this.store.claimWorkspace(task.paused_chat, task.room_id, { handoff: task.id });
  }

  changed(id) {
    const row = this.task(id);
    const task = this.view(row);
    this.hub.emit({ type: 'task', task, chat_id: row.paused_at != null && row.paused_chat != null ? row.paused_chat : this.chatOf(task.room_id), active: this.countActive(task.room_id) });
    this.hub.emit({ type: 'rooms', rooms: this.store.roomsView() });
    this.arm();
    return task;
  }
}

// #1588: a call that is only thanks or an acknowledgement is talk about a delivery, not a job.
const ACK_WORDS = /^(?:收到|好的?|好嘞|行|嗯+|ok(?:ay)?|谢谢?|多谢|感谢|辛苦(?:了|啦)?|thanks?|thx|thank you|了|啦|呀|哈+|你|您|啊|[\s\p{P}\p{S}])*$/iu;
export function ackOnly(body) {
  const s = String(body ?? '').trim();
  return s === '' || (s.length <= 24 && ACK_WORDS.test(s));
}

// #1588: a call after a failed turn sends that task again only when it asks for a retry or repeats its title.
const RETRY_WORDS = /^(?:重试|再试(?:一次|一下)?|再来(?:一次)?|继续|重新(?:做|来|跑)?(?:一次|一下)?|retry|try again|again|[\s\p{P}\p{S}])+$/iu;
function retryCall(title, failed) {
  return title === failed.title || RETRY_WORDS.test(title);
}

/**
 * First non-empty line of a dispatch with the @-mentions taken out (the task title). A stance line
 * and an [ask]/[report] mark are not content (#597 G37: a lead's [report] opening 【接】#id dispatches too);
 * the line calling the teammate comes first.
 */
function taskTitle(text, team) {
  const clean = l => l.replace(/^[\s，,：:、]+/, '').replace(/^\[(?:ask|report)\]/i, '').replace(/^[\s，,：:、]+/, '').trim();
  // #1539: only the @s a line opens with are dropped; one inside the sentence keeps the name
  // (「交给空闲的 @小蓝，并要求她…」 read 「交给空闲的 ，并要求她…」 on the card).
  const lines = String(text).split('\n').map(l => {
    const segs = split(l, team);
    let lead = true;
    const kept = segs.map(([seg, id]) => {
      if (!id) { if (seg.trim()) lead = false; return seg; }
      return lead ? '' : seg.replace(/^[@＠]/, '');
    });
    return { called: segs.some(([, id]) => id), text: clean(kept.join('')) };
  }).filter(l => l.text !== '' && !STANCE_LINE.test(l.text));
  // The line that calls the teammate says what the task is; else the first line of content.
  const line = (lines.find(l => l.called) ?? lines[0])?.text ?? '';
  return line.slice(0, MAX_TEXT);
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
