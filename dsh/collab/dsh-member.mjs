// DSH-native channel members. Each (member, room) owns one ordinary DSH root
// Session that shows up in the DSH Web UI; a channel @-mention becomes one
// durable job. The job records the Session offset and the id of the input it
// admits, and its reply is taken only from the turn that consumed that input,
// so a turn started from the DSH Web UI is never posted to the channel.
// After a restart an input that was never consumed is withdrawn and reported;
// one that was consumed is settled from the Session log. Nothing is re-sent,
// so a prompt is executed at most once.
import { randomUUID } from 'node:crypto';
import { resolve, join, sep } from 'node:path';
import { mentions, nameCalled } from './mentions.mjs';
import { CollabError } from './store.mjs';

const CONTEXT_LIMIT = 50;
const CLOSE_TIMEOUT_MS = 5_000;
// Agent-to-agent relay cap: after this many agent messages in a row without a
// human message, agent mentions stop dispatching turns (including external bots).
export const DEFAULT_MAX_RELAY = 6;

/** Final reply text of a turn: the last non-empty assistant message's text blocks. */
export function finalText(events) {
  let text;
  for (const event of events) {
    if (event.type !== 'assistant/message') continue;
    const blocks = event.data?.message?.content ?? [];
    const joined = blocks.filter(b => b.type === 'text').map(b => b.text).join('').trim();
    if (joined) text = joined;
  }
  return text;
}

/** Events of one turn, from its turn/start through its turn/end. */
export function turnEvents(events, turn) {
  const out = [];
  let open = false;
  for (const event of events) {
    if (event.type === 'turn/start' && event.data?.turn === turn) open = true;
    if (open) out.push(event);
    if (open && event.type === 'turn/end' && event.data?.turn === turn) break;
  }
  return out;
}

/**
 * Locate the turn that consumed `inputId` in a Session log suffix.
 * @returns { turn, end } where end is that turn's turn/end event (or undefined), or undefined if never consumed.
 */
export function consumingTurn(events, inputId) {
  let open;
  for (let i = 0; i < events.length; i++) {
    const event = events[i];
    if (event.type === 'turn/start') open = event.data?.turn;
    if (event.type === 'user/message' && event.data?.id === inputId && open !== undefined) {
      const end = events.slice(i).find(e => e.type === 'turn/end' && e.data?.turn === open);
      return { turn: open, end };
    }
  }
  return undefined;
}

/**
 * The prompt a member receives: who it is (name, model, persona), then the
 * unseen channel messages up to the trigger. Identity is restated every time
 * because other members' messages in the same history name themselves.
 */
export function promptText(room, member, messages) {
  const lines = messages.map(m => `【${m.name}】${m.text}`);
  const model = member.model === undefined ? '' : `你底层用的模型是 ${member.model.provider}/${member.model.model}。`;
  const persona = member.persona?.trim() ? ['你的人设：', member.persona.trim(), ''] : [];
  return [
    `你是频道 #${room.name} 的成员「${member.name}」。${model}频道里其他人各有自己的身份，他们的自我介绍说的是他们自己，不是你。`,
    ...persona,
    '下面是频道里你还没看过的消息，最后一条 @ 了你。直接写出你要在频道里说的话；你这一轮最后一条回复会原样发到频道。',
    '',
    ...lines,
  ].join('\n');
}

/** One-line turn/end reason: kind plus a truncated error message when present. */
export function describeReason(reason) {
  if (reason === undefined || reason === null) return 'unknown';
  if (typeof reason !== 'object') return String(reason);
  const detail = reason.error?.message ?? reason.reason?.kind ?? '';
  return `${reason.kind ?? 'unknown'}${detail ? `：${String(detail).replace(/\s+/g, ' ').slice(0, 200)}` : ''}`;
}

/** Driver outcome -> the three results the stop API is allowed to report. */
const OUTCOME = { idle: 'confirmed', withdrawn: 'confirmed', timeout: 'requested', error: 'requested',
  // No Agent loaded means no turn was running, so nothing is left running either: the room is
  // stopped for that member, which is a confirmed stop. Reporting it as unsupported used to tell
  // a DSH member "you are not a DSH task", which was simply false.
  'not-loaded': 'confirmed' };
/** Stronger result wins when two jobs share a member. */
const STRENGTH = { confirmed: 3, requested: 2, unsupported: 1 };

/** System line for one stop, per the three results above. */
export function stopNotice(stopped, notRunning = [], nameOf = id => id) {
  // A member whose Agent was not loaded had no turn to stop: saying "已停止" would claim we
  // stopped something. It gets its own line, and is kept out of the other buckets.
  const idle = new Set(notRunning);
  // Users read names in the channel, so never show a bare member id here.
  const by = state => stopped.filter(r => r.outcome === state && !idle.has(r.member)).map(r => nameOf(r.member));
  const parts = [];
  const confirmed = by('confirmed'); const requested = by('requested'); const unsupported = by('unsupported');
  if (confirmed.length) parts.push(`已停止：${confirmed.join('、')}`);
  if (requested.length) parts.push(`已请求停止、未确认退出：${requested.join('、')}（迟到回复将被忽略）`);
  if (unsupported.length) parts.push(`不支持终止、只屏蔽旧输出：${unsupported.join('、')}`);
  const wasIdle = stopped.filter(r => idle.has(r.member)).map(r => nameOf(r.member));
  if (wasIdle.length) parts.push(`本来就没在跑：${wasIdle.join('、')}`);
  return parts.length ? `${parts.join('；')}。` : '已停止。';
}

/** Reason DSH reports when the user cancels the running turn. */
const STOPPED_REASON = { kind: 'aborted', reason: { kind: 'user' } };
const INTERRUPTED = Symbol('interrupted');

export class DshMembers {
  /**
   * @param hub - Hub instance.
   * @param runtime - { ctx, createUserMessage, workspacePath, logger }.
   * @param members - [{ id, name, agentPreset?, permissionPreset?, model?: { provider, model } }].
   * @param options - { maxRelay?, stopTimeoutMs? }.
   */
  constructor(hub, runtime, members, { maxRelay = DEFAULT_MAX_RELAY, stopTimeoutMs = 5_000 } = {}) {
    hub.maxRelay = maxRelay;
    this.stopTimeoutMs = stopTimeoutMs;
    this.stopping = new Map();
    this.hub = hub;
    this.store = hub.store;
    this.rt = runtime;
    this.config = new Map(members.map(m => [m.id, m]));
    this.queues = new Map();
    this.closed = false;
    /** sessionId -> { jobId, inputId, seqBefore, turn, resolve } while a turn is outstanding */
    this.watching = new Map();
    /** sessionId -> currently open turn number, for binding a consumed input */
    this.openTurns = new Map();
    /** Agents whose request hook was installed after they were loaded by someone else. */
    this.hooked = new WeakSet();
    for (const m of members) this.publish(m);
    hub.onPlan(message => this.plan(message));
  }

  publish(m) {
    this.hub.setMember({ id: m.id, name: m.name, kind: 'dsh', online: true, model: m.model, persona: m.persona ?? '', source: m.source ?? 'config' });
  }

  /** Add or replace a member at runtime; its bound Sessions pick up the new model on their next request. */
  putMember(m) {
    this.config.set(m.id, m);
    this.publish(m);
  }

  /** Stop routing to a member. Pending jobs for it fail when they run; history keeps its name. */
  dropMember(id) {
    this.config.delete(id);
    this.hub.removeMember(id);
  }

  /** Root session/event listener (installed by the plugin). */
  onSessionEvent(session, event) {
    if (event.type === 'turn/start') this.openTurns.set(session.id, event.data?.turn);
    const w = this.watching.get(session.id);
    if (w === undefined) return;
    if (event.type === 'user/message' && event.data?.id === w.inputId && w.turn === undefined) {
      w.turn = this.openTurns.get(session.id);
      return;
    }
    if (event.type === 'turn/end' && w.turn !== undefined && event.data?.turn === w.turn) {
      this.watching.delete(session.id);
      w.resolve({ events: turnEvents(session.snapshotEvents(w.seqBefore), w.turn), reason: event.data?.reason });
    }
  }

  /** Root agent/inbox/claimed listener: binds the job to the turn that took its input. */
  onClaimed(sessionId, messageId, turn) {
    const w = this.watching.get(sessionId);
    if (w !== undefined && w.inputId === messageId) w.turn = turn;
  }

  /** Root agent/inbox/discarded listener: a withdrawn input ends its job. */
  onDiscarded(sessionId, messageId) {
    const w = this.watching.get(sessionId);
    if (w === undefined || w.inputId !== messageId || w.turn !== undefined) return;
    this.watching.delete(sessionId);
    w.resolve({ discarded: true });
  }

  /**
   * Plan jobs for a new message inside the hub's append transaction, so an
   * accepted @ always has its job. Returns the post-commit continuation.
   */
  plan(msg) {
    if (msg.author_kind === 'system' || msg.card !== null || !this.hub.canDispatch(msg)) return undefined;
    const hit = mentions(msg.text, this.hub.routable());
    const targets = [...this.config.keys()].filter(id => id !== msg.author
      && (hit.has(id) || (msg.author_kind === 'role' && nameCalled(msg.text, this.config.get(id).name))));
    if (targets.length === 0) return undefined;
    const jobs = targets.map(id => this.store.addJob(id, msg.room_id, msg.id)).filter(Boolean);
    return () => { for (const job of jobs) this.enqueue(job, () => this.run(job.id)); };
  }

  /** Serialize work per (member, room): runs, recoveries, and Session resumes never overlap. */
  enqueue(job, task) {
    const key = `${job.member_id}\u0000${job.room_id}`;
    const tail = (this.queues.get(key) ?? Promise.resolve()).then(() => (this.closed ? undefined : task())).catch((error) => {
      this.rt.logger.warn('collab: DSH job %d failed: %s', job.id, error?.stack ?? error);
      if (!this.closed) this.fail(job.id, `出错了：${error?.message ?? error}`);
    });
    this.queues.set(key, tail);
    return tail;
  }

  async run(jobId) {
    const job = this.store.job(jobId);
    if (job === undefined || job.state !== 'pending') return;
    const member = this.config.get(job.member_id);
    const room = this.store.room(job.room_id);
    if (member === undefined || room === undefined) { this.store.finishJob(jobId, 'failed'); return; }
    const agent = await this.ensureAgent(member, room);
    if (this.closed || this.store.job(jobId)?.state !== 'pending') return;
    this.syncSelection(agent, member);
    const binding = this.store.binding(member.id, room.id);
    const unseen = this.store.page(room.id, job.trigger_id + 1, CONTEXT_LIMIT * 4)
      .filter(m => m.id > binding.context_cursor && m.author !== member.id && m.author_kind !== 'system' && m.card === null)
      .slice(-CONTEXT_LIMIT);
    const input = this.rt.createUserMessage({ content: [{ type: 'text', text: promptText(room, member, unseen) }], source: { kind: 'user' } });
    const seqBefore = agent.session.seq;
    if (!this.store.markSent(jobId, agent.session.id, seqBefore, input.id)) return;
    await this.admitAndSettle(job, member, agent, input, seqBefore);
  }

  /** Watch for the consuming turn, admit the input, and post the outcome. */
  async admitAndSettle(job, member, agent, input, seqBefore) {
    const sessionId = agent.session.id;
    const done = new Promise((resolve) => {
      this.watching.set(sessionId, { jobId: job.id, inputId: input.id, seqBefore, turn: undefined, resolve });
    });
    this.hub.setThinking(job.room_id, member.id, true);
    try {
      if (input.admit !== false) agent.followup(input);
      this.store.advanceCursor(member.id, job.room_id, job.trigger_id);
      const outcome = await done;
      if (outcome === INTERRUPTED || this.closed) return;
      if (outcome.discarded) this.fail(job.id, `${member.name} 的这条任务在开始前被取消了。`);
      else this.finish(job, member, outcome);
    } finally {
      // A failed admission must not leave a watcher that claims a later, unrelated turn.
      if (this.watching.get(sessionId)?.jobId === job.id) this.watching.delete(sessionId);
      this.hub.setThinking(job.room_id, member.id, false);
    }
  }

  finish(job, member, { events, reason }) {
    if (!['pending', 'sent'].includes(this.store.job(job.id)?.state)) return;
    // A user stop keeps the text the turn already produced; the marker says why it stopped.
    const cancelled = reason?.kind === 'aborted' && reason.reason?.kind === 'user';
    const text = finalText(events);
    if (text === undefined) {
      // Same wording as the HTTP stop path, so both entries say the same thing.
      if (cancelled) this.fail(job.id, `已停止：${member.name}。`, 'interrupted');
      else this.fail(job.id, `${member.name} 这一轮没有给出回复（${describeReason(reason)}）`);
      return;
    }
    const kind = reason?.kind;
    const complete = kind === undefined || kind === 'completed' || kind === 'max-tokens';
    const { message } = this.hub.post(job.room_id, {
      authorKind: 'role', author: member.id, name: member.name, clientKey: `dsh-job-${job.id}`,
      text: complete ? text : `${text}\n\n（这一轮没有正常结束：${describeReason(reason)}）`,
    });
    this.store.finishJob(job.id, cancelled ? 'interrupted' : 'done', message.id);
  }

  fail(jobId, notice, state = 'failed') {
    if (this.closed) return;
    const job = this.store.job(jobId);
    if (job === undefined || !this.store.finishJob(jobId, state)) return;
    this.hub.post(job.room_id, {
      authorKind: 'system', author: 'system', name: 'system', text: notice, clientKey: `dsh-job-${jobId}-${state}`,
    });
  }

  /** Member id -> the name the channel shows. Users never see bare ids in these lines. */
  nameOf = id => this.config.get(id)?.name ?? this.hub.members.get(id)?.name ?? id;

  /** Members that only had their output fenced: name them, or the user reads silence as success. */
  unsupportedNotice(stopped) {
    const names = stopped.map(r => this.nameOf(r.member)).join('、');
    return `停止只发生在频道里：${names} 这些成员不是 DSH 任务，不支持终止，只屏蔽它们的旧输出。`;
  }

  requireRoom(roomId) {
    if (this.store.room(roomId) === undefined) throw new CollabError('room-missing', 'room not found');
  }

  stopRoom(roomId, { outputOnly = [], recalled = [] } = {}) {
    this.requireRoom(roomId);
    if (this.stopping.has(roomId)) return this.stopping.get(roomId);
    this.hub.stopRoom(roomId);
    const stopping = this.cancelRoomJobs(roomId, outputOnly, recalled).finally(() => this.stopping.delete(roomId));
    this.stopping.set(roomId, stopping);
    return stopping;
  }

  async cancelRoomJobs(roomId, outputOnly = [], recalled = []) {
    const jobs = this.store.openJobs().filter(j => j.room_id === roomId);
    // Do this synchronously, before callbacks or awaits can release a queued job.
    this.store.transaction(() => { for (const job of jobs) this.store.finishJob(job.id, 'interrupted'); });
    const results = await Promise.all(jobs.filter(j => j.state === 'sent').map(async job => {
      const agent = this.rt.ctx.agents.get(job.session_id);
      const watcher = this.watching.get(job.session_id);
      const name = this.config.get(job.member_id)?.name ?? job.member_id;
      let timer;
      try {
        if (agent === undefined) return { member: job.member_id, name, job: job.id, outcome: 'not-loaded' };
        const events = agent.session.snapshotEvents(job.seq_before);
        const consumed = consumingTurn(events, job.input_id);
        // inbox/claimed precedes user/message while input assembly awaits I/O.
        const claimedTurn = watcher?.jobId === job.id ? watcher.turn : undefined;
        const active = consumed ? consumed.end === undefined : claimedTurn !== undefined
          && !events.some(e => e.type === 'turn/end' && e.data?.turn === claimedTurn);
        // Withdraw only our input. Never clear the Web UI's queued messages.
        agent.inbox.remove(job.input_id);
        // Nothing ran for our input: this channel turn produced no text, and the events since
        // seq_before may belong to a Web UI turn in the same session, so publish nothing.
        if (!active) return { member: job.member_id, name, job: job.id, outcome: 'withdrawn' };
        agent.cancel({ kind: 'user' }, { keepInbox: true });
        const idle = Promise.resolve(agent.whenIdle()).then(() => 'idle');
        const timeout = new Promise(resolve => { timer = setTimeout(() => resolve('timeout'), this.stopTimeoutMs); });
        const outcome = await Promise.race([idle, timeout]);
        // Read the text only now: whatever the turn wrote up to the moment it went idle counts,
        // not just what existed when cancel() was called. Restrict it to the turn we stopped —
        // another turn can start in the same Session (Web UI), and its words are not ours.
        const finished = agent.session.snapshotEvents(job.seq_before);
        const stoppedTurn = consumingTurn(events, job.input_id)?.turn ?? claimedTurn;
        const partial = finalText(stoppedTurn === undefined ? events : turnEvents(finished, stoppedTurn));
        return { member: job.member_id, name, job: job.id, outcome, partial };
      } catch (error) {
        this.rt.logger.warn('collab: stop job %d failed: %s', job.id, error?.message ?? error);
        return { member: job.member_id, name, job: job.id, outcome: 'error' };
      } finally {
        clearTimeout(timer);
        if (watcher?.jobId === job.id) {
          if (this.watching.get(job.session_id) === watcher) this.watching.delete(job.session_id);
          watcher.resolve(INTERRUPTED);
        }
        this.hub.setThinking(roomId, job.member_id, false);
      }
    }));
    for (const id of this.config.keys()) this.hub.setThinking(roomId, id, false);
    // A member whose Agent was not loaded was never running, so there is nothing left unconfirmed
    // (and no late output to fence): only a cancel we could not confirm inside the deadline counts.
    const unconfirmed = results.filter(r => ['timeout', 'error'].includes(r.outcome)).map(r => r.member);
    // A member counts as "was not running" only when every job of theirs found no live Agent;
    // mixing that with a real turn must not hide the turn that was actually stopped.
    const notRunning = [...new Set(results.map(r => r.member))]
      .filter(m => results.filter(r => r.member === m).every(r => r.outcome === 'not-loaded'));
    // Publish what each stopped turn had already written, so a stop loses no text.
    const partials = results.filter(r => r.partial !== undefined);
    for (const r of partials) {
      if (this.closed) break;
      this.hub.post(roomId, {
        authorKind: 'role', author: r.member, name: r.name, clientKey: `dsh-job-${r.job}-interrupted`,
        text: `${r.partial}\n\n（这一轮没有正常结束：${describeReason(STOPPED_REASON)}）`,
      });
    }
    // One entry per member: confirmed (the turn really ended), requested (cancel sent, not
    // confirmed within stopTimeoutMs) or unsupported (nothing to cancel here).
    const byMember = new Map();
    for (const r of results) {
      const outcome = OUTCOME[r.outcome] ?? 'unsupported';
      const seen = byMember.get(r.member);
      if (seen === undefined || STRENGTH[outcome] > STRENGTH[seen]) byMember.set(r.member, outcome);
    }
    const stopped = [...byMember].map(([member, outcome]) => ({ member, outcome }));
    // A recalled bot was asked to stop (cc-connect sends no ack): requested. Without a recall
    // only the output fence is running for it: that is not a stop, and must be said.
    for (const id of outputOnly) {
      if (!stopped.some(r => r.member === id)) stopped.push({ member: id, outcome: recalled.includes(id) ? 'requested' : 'unsupported' });
    }
    const allUnsupported = stopped.length > 0 && stopped.every(r => r.outcome === 'unsupported');
    // Silence would read as "stopped"; say either what stopped, what could not, or that nothing ran.
    const notice = stopped.length === 0 ? '没有在跑的任务。'
      : allUnsupported ? this.unsupportedNotice(stopped) : stopNotice(stopped, notRunning, this.nameOf);
    if (!this.closed) this.hub.post(roomId, { authorKind: 'system', author: 'system', name: 'system', text: notice });
    return { room_id: roomId, stopped: true, cancelled_jobs: jobs.length, unconfirmed, stopped_members: stopped };
  }

  continueRoom(roomId) {
    this.requireRoom(roomId);
    if (this.stopping.has(roomId)) throw new CollabError('conflict', 'room is still stopping');
    return this.hub.continueRoom(roomId);
  }

  /** Live Agent for (member, room): loaded, resumed, or newly created and bound. */
  async ensureAgent(member, room) {
    const binding = this.store.binding(member.id, room.id);
    if (binding !== undefined) return this.liveAgent(binding.session_id, member);
    const { ctx } = this.rt;
    const preset = await ctx.agentPresets.resolve(member.agentPreset);
    const scope = await ctx.agentPresets.acquireScope(preset.id);
    const sessionId = `collab-${randomUUID()}`;
    let handle;
    let workspace;
    try {
      workspace = await ctx.workspaceRegistry.create(this.workspaceFor(member));
      handle = await ctx.agents.create({
        sessionId,
        meta: { cwd: workspace.path, agentPreset: preset.id },
        agentOptions: this.selection(member),
        setup: async (agentCtx) => {
          await ctx.agentPresets.mount(agentCtx, preset.id);
          this.setup(agentCtx, member);
        },
      });
    } finally {
      await scope[Symbol.asyncDispose]();
    }
    await workspace.attachSession(sessionId);
    if (member.permissionPreset !== undefined) ctx.permissionPresets.set(handle.agent.session, member.permissionPreset);
    ctx.sessionTitle.rename(handle.agent.session, `#${room.name} · ${member.name}`);
    this.store.bind(member.id, room.id, sessionId);
    return handle.agent;
  }

  async liveAgent(sessionId, member) {
    const { ctx } = this.rt;
    const loaded = ctx.agents.get(sessionId);
    if (loaded !== undefined) {
      // Loaded by someone else (e.g. the Session is open in the DSH Web UI), so
      // our resume-time setup never ran: install the request hook on it now.
      if (member !== undefined && !this.hooked.has(loaded)) this.setup(loaded.ctx, member, loaded);
      return loaded;
    }
    return (await ctx.agents.resume({
      resumeSessionId: sessionId,
      ...(member === undefined ? {} : { agentOptions: this.selection(member), setup: s => this.setup(s, member) }),
    })).agent;
  }

  /** The member's model, or the host default at the time of the call (webhook pattern). */
  selection(member) {
    const { provider, model } = member.model ?? this.rt.ctx.agentDefaultModel.currentSelection();
    return { provider, model };
  }

  /**
   * Each member gets its own directory under the configured root, so two threads never
   * see each other's files or tool side effects. Member ids reach us from config and from
   * the network, so anything that is not a plain slug is refused rather than sanitised:
   * a silently rewritten id would land two members in the same directory.
   */
  workspaceFor(member) {
    const id = String(member?.id ?? '');
    if (!/^[a-z0-9][a-z0-9_-]{0,31}$/.test(id)) throw new CollabError('bad-member-id', `member id ${JSON.stringify(id)} cannot name a workspace`);
    const root = resolve(this.rt.workspacePath);
    const dir = resolve(root, id);
    // Belt and braces: the slug rule already forbids '..' and separators.
    if (dir !== join(root, id) || !dir.startsWith(root + sep)) {
      throw new CollabError('bad-workspace', `workspace for ${id} escapes ${root}`);
    }
    return dir;
  }

  /**
   * A member with a configured model uses it on every request, so changing the
   * config moves an already-bound Session too. Without one, the host default is
   * pinned only until the Session's first durable request header (webhook
   * pattern), after which the Session's own selection applies.
   */
  setup(agentCtx, initial, agent) {
    if (agent !== undefined) this.hooked.add(agent);
    // Read the member's current config on each request so an edit in the UI
    // reaches a Session whose hook was installed before the edit.
    const current = () => this.config.get(initial.id) ?? initial;
    const always = initial.model !== undefined;
    // Prepended so this listener is outermost: DSH's own model-selection listener
    // rewrites provider/model from the Session's selection, and the outermost
    // waterfall listener's result is the one the request uses.
    agentCtx.on('agent/request', async ({ agent }, next) => {
      const resolved = await next();
      const member = current();
      if (member.model === undefined && agent.session.requestHeader() !== undefined) return resolved;
      const { provider, model } = this.selection(member);
      const { reasoningEffort: _inherited, ...rest } = resolved;
      return { ...rest, provider, model };
    }, { prepend: always });
  }

  /**
   * Record a configured model as the Session's durable selection when it
   * differs, the same event the DSH Web UI writes on a model switch, so the
   * UI, prompt variables, and requests agree after a config change.
   */
  syncSelection(agent, member) {
    if (member.model === undefined) return;
    const { provider, model } = member.model;
    const logged = agent.session.requestHeader()?.config;
    if (logged === undefined || (logged.provider === provider && logged.model === model)) return;
    agent.session.append('model/selection', { provider, model });
  }

  /**
   * Queue every job a previous process left open, in the same per-(member,
   * room) order as new work. Pending jobs run normally; sent ones settle.
   */
  recover() {
    for (const job of this.store.openJobs()) {
      // A crash may occur after the durable room fence but before job cleanup.
      // Never resume those inputs simply because their job row is still open.
      if (!this.hub.canDispatch({ room_id: job.room_id, id: job.trigger_id })) {
        this.store.finishJob(job.id, 'interrupted');
        continue;
      }
      this.enqueue(job, () => (job.state === 'pending' ? this.run(job.id) : this.settleSent(job)));
    }
  }

  /** Settle one job that was sent before a restart, without sending it again. */
  async settleSent(job) {
    if (this.store.job(job.id)?.state !== 'sent') return;
    const member = this.config.get(job.member_id);
    const interrupted = (why) => this.fail(job.id, `${member?.name ?? job.member_id} 上次被重启打断，${why}，需要的话请重新 @。`, 'interrupted');
    if (member === undefined || !job.input_id) { interrupted('这条没有完成'); return; }
    const agent = await this.liveAgent(job.session_id, member);
    if (this.closed || this.store.job(job.id)?.state !== 'sent') return;
    const consumed = consumingTurn(agent.session.snapshotEvents(job.seq_before), job.input_id);
    if (consumed === undefined) {
      // Not consumed: withdraw it if still pending. Only a running Agent can be
      // consuming it right now; an idle Agent without it in its inbox has lost
      // it, and waiting would block this member's queue forever.
      if (agent.inbox.remove(job.input_id)) { interrupted('这条还没开始执行，已撤回'); return; }
      if (agent.status !== 'running') { interrupted('这条没有被执行'); return; }
      await this.admitAndSettle(job, member, agent, { id: job.input_id, admit: false }, job.seq_before);
      return;
    }
    // Resume closes a crash-orphaned turn with kind 'interrupted'; its partial text is not an answer.
    if (consumed.end === undefined || consumed.end.data?.reason?.kind === 'interrupted') { interrupted('这条没有完成'); return; }
    this.finish(job, member, { events: turnEvents(agent.session.snapshotEvents(job.seq_before), consumed.turn), reason: consumed.end.data?.reason });
  }

  /** Stop taking work and release waiters; open jobs stay for the next start's recovery. */
  async close() {
    this.closed = true;
    // Stop operations have their own bounded deadline; let their store access
    // finish before the plugin closes SQLite.
    await Promise.allSettled(this.stopping.values());
    for (const w of this.watching.values()) w.resolve(INTERRUPTED);
    this.watching.clear();
    // A queue still waiting on the host (for example a resume during shutdown) must not block unload forever.
    let timer;
    const limit = new Promise((resolve) => { timer = setTimeout(resolve, CLOSE_TIMEOUT_MS); });
    await Promise.race([Promise.allSettled(this.queues.values()), limit]);
    clearTimeout(timer);
  }
}
