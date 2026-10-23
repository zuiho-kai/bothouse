// DSH-native channel members. Each (member, room) owns one ordinary DSH root
// Session that shows up in the DSH Web UI; a channel @-mention becomes one
// durable job. The job records the Session offset and the id of the input it
// admits, and its reply is taken only from the turn that consumed that input,
// so a turn started from the DSH Web UI is never posted to the channel.
// After a restart an input that was never consumed is withdrawn and reported;
// one that was consumed is settled from the Session log. Nothing is re-sent,
// so a prompt is executed at most once.
import { randomUUID } from 'node:crypto';
import { mentions, nameCalled } from './mentions.mjs';

const CONTEXT_LIMIT = 50;
const CLOSE_TIMEOUT_MS = 5_000;
// Agent-to-agent relay cap: after this many agent messages in a row without a
// human message, agent mentions stop starting DSH turns (prevents loops with bots).
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

const INTERRUPTED = Symbol('interrupted');

export function friendlyFailure(raw) {
  const text = String(raw);
  if (/no.{0,12}(api.?key|key)|missing.{0,12}(key|credential)|api.?key.{0,12}(missing|not set|required)|未配置.*key/i.test(text)) return '还没有配置模型的 API Key，请先去配置模型。';
  if (/model.{0,30}(not found|unavailable|not available|unsupported)|unknown model|模型.*不可用|404/i.test(text)) return '这个模型暂时不可用，请检查模型名称或换一个模型。';
  if (/login|log.?in|auth|unauthorized|401|未登录/i.test(text)) return '模型或 CLI 还没有登录，或登录已过期。请先登录后再试。';
  if (/exit|ENOENT|spawn|没有输出文字/i.test(text)) return '本机 CLI 未能正常运行或已退出，请检查安装和登录状态。';
  return `这次没能完成，请检查配置后重试。原始错误：${text}`;
}

export class DshMembers {
  /**
   * @param hub - Hub instance.
   * @param runtime - { ctx, createUserMessage, workspacePath, logger }.
   * @param members - [{ id, name, agentPreset?, permissionPreset?, model?: { provider, model } }].
   * @param options - { maxRelay? }.
   */
  constructor(hub, runtime, members, { maxRelay = DEFAULT_MAX_RELAY } = {}) {
    this.maxRelay = maxRelay;
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
    /** memberId -> { cli, agent } live local CLI agents (members with a `cli` field). */
    this.cliAgents = new Map();
    for (const m of members) this.publish(m);
    hub.onPlan(message => this.plan(message));
  }

  publish(m) {
    this.hub.setMember({ id: m.id, name: m.name, kind: 'dsh', online: true, model: m.model, ...(m.cli ? { cli: m.cli } : {}), persona: m.persona ?? '', ...(m.avatar ? { avatar: m.avatar } : {}), source: m.source ?? 'config' });
  }

  /** Add or replace a member at runtime; its bound Sessions pick up the new model on their next request. */
  putMember(m) {
    if (this.cliAgents.get(m.id)?.cli !== m.cli) this.dropCli(m.id);
    this.config.set(m.id, m);
    this.publish(m);
  }

  /** Stop routing to a member. Pending jobs for it fail when they run; history keeps its name. */
  dropMember(id) {
    this.dropCli(id);
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
    if (msg.author_kind === 'system' || msg.card !== null) return undefined;
    const hit = mentions(msg.text, this.hub.routable());
    const targets = [...this.config.keys()].filter(id => id !== msg.author
      && (hit.has(id) || (msg.author_kind === 'role' && nameCalled(msg.text, this.config.get(id).name))));
    if (targets.length === 0) return undefined;
    if (msg.author_kind === 'role' && this.store.relayDepth(msg.room_id, msg.id) > this.maxRelay) {
      return () => this.hub.post(msg.room_id, {
        authorKind: 'system', author: 'system', name: 'system', clientKey: `relay-cap-${msg.id}`,
        text: `Agent 之间已经连续接力 ${this.maxRelay} 次以上，暂停自动接力；需要继续请人来 @。`,
      });
    }
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
    if (member.cli !== undefined) { await this.runCli(job, member, room); return; }
    const agent = await this.ensureAgent(member, room);
    if (this.closed) return;
    this.syncSelection(agent, member);
    const binding = this.store.binding(member.id, room.id);
    const unseen = this.store.page(room.id, job.trigger_id + 1, CONTEXT_LIMIT * 4)
      .filter(m => m.id > binding.context_cursor && m.author !== member.id && m.author_kind !== 'system' && m.card === null && !m.draft)
      .slice(-CONTEXT_LIMIT);
    const input = this.rt.createUserMessage({ content: [{ type: 'text', text: promptText(room, member, unseen) }], source: { kind: 'user' } });
    const seqBefore = agent.session.seq;
    if (!this.store.markSent(jobId, agent.session.id, seqBefore, input.id)) return;
    await this.admitAndSettle(job, member, agent, input, seqBefore);
  }

  /**
   * A local CLI member (claude/codex/gemini over ACP): same job, cursor,
   * thinking and relay rules as a DSH member, but the turn runs in the CLI's
   * own ACP session for this room and its reply text is posted directly.
   */
  async runCli(job, member, room) {
    const sessionId = `cli:${member.cli}`;
    if (this.store.binding(member.id, room.id) === undefined) this.store.bind(member.id, room.id, sessionId);
    const binding = this.store.binding(member.id, room.id);
    const unseen = this.store.page(room.id, job.trigger_id + 1, CONTEXT_LIMIT * 4)
      .filter(m => m.id > binding.context_cursor && m.author !== member.id && m.author_kind !== 'system' && m.card === null && !m.draft)
      .slice(-CONTEXT_LIMIT);
    if (!this.store.markSent(job.id, sessionId, 0, undefined)) return;
    let entry = this.cliAgents.get(member.id);
    if (entry === undefined) {
      // Persona goes through promptText every turn, so an edit applies without restarting the CLI.
      entry = { cli: member.cli, agent: this.rt.createCliMember({ cli: member.cli, cwd: this.rt.workspacePath, persona: '' }) };
      this.cliAgents.set(member.id, entry);
    }
    this.hub.setError(member.id, undefined);
    this.hub.setThinking(job.room_id, member.id, true);
    // #121: the first public chunk opens a draft row, later chunks edit it in place
    // (one store write per event-loop turn), and the full reply commits that same row.
    const clientKey = `dsh-job-${job.id}`;
    let draft;
    let latest = '';
    let flushing = false;
    const flush = () => {
      flushing = false;
      const text = latest.trim();
      if (this.closed || !text) return;
      if (draft === undefined) draft = this.hub.draft(job.room_id, { authorKind: 'role', author: member.id, name: member.name, clientKey, text }).message;
      // A rerun after a restart finds its row already committed: leave it alone.
      else if (draft.draft && draft.text !== text) draft = this.hub.edit(draft.id, 'role', member.id, text) ?? draft;
    };
    const onText = (full) => {
      latest = full;
      if (!flushing) { flushing = true; setImmediate(flush); }
    };
    let done = false;
    try {
      this.store.advanceCursor(member.id, job.room_id, job.trigger_id);
      const text = (await entry.agent.ask(promptText(room, member, unseen), String(room.id), onText))?.trim();
      if (this.closed) return;
      if (!text) { this.fail(job.id, `${member.name} 这一轮没有给出回复（${member.cli} 没有输出文字）`); return; }
      latest = '';
      const committed = draft === undefined ? undefined : this.hub.commit(draft.id, 'role', member.id, text);
      const message = committed ?? this.hub.post(job.room_id, { authorKind: 'role', author: member.id, name: member.name, clientKey, text }).message;
      done = true;
      this.store.finishJob(job.id, 'done', message.id);
    } finally {
      latest = '';
      // Error, cancel or empty turn: drop the partial draft so the room never keeps a cut-off reply.
      if (!done && draft?.draft) this.hub.remove(draft.id, 'role', member.id);
      this.hub.setThinking(job.room_id, member.id, false);
    }
  }

  dropCli(id) {
    this.cliAgents.get(id)?.agent.close();
    this.cliAgents.delete(id);
  }

  /** Watch for the consuming turn, admit the input, and post the outcome. */
  async admitAndSettle(job, member, agent, input, seqBefore) {
    const sessionId = agent.session.id;
    const done = new Promise((resolve) => {
      this.watching.set(sessionId, { jobId: job.id, inputId: input.id, seqBefore, turn: undefined, resolve });
    });
    this.hub.setError(member.id, undefined);
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
    const text = finalText(events);
    if (text === undefined) {
      this.fail(job.id, `${member.name} 这一轮没有给出回复（${describeReason(reason)}）`);
      return;
    }
    const kind = reason?.kind;
    const complete = kind === undefined || kind === 'completed' || kind === 'max-tokens';
    const { message } = this.hub.post(job.room_id, {
      authorKind: 'role', author: member.id, name: member.name, clientKey: `dsh-job-${job.id}`,
      text: complete ? text : `${text}\n\n（这一轮没有正常结束：${describeReason(reason)}）`,
    });
    this.store.finishJob(job.id, 'done', message.id);
  }

  fail(jobId, notice, state = 'failed') {
    if (this.closed) return;
    const job = this.store.job(jobId);
    if (job === undefined || !this.store.finishJob(jobId, state)) return;
    const error = friendlyFailure(notice);
    this.hub.setError(job.member_id, error);
    this.hub.post(job.room_id, {
      authorKind: 'system', author: 'system', name: 'system', text: error, clientKey: `dsh-job-${jobId}-${state}`,
      card: JSON.stringify({ title: '成员出错', state: 'failed', action: 'configure-model' }),
    });
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
      workspace = await ctx.workspaceRegistry.create(this.rt.workspacePath);
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
      this.enqueue(job, () => (job.state === 'pending' ? this.run(job.id) : this.settleSent(job)));
    }
  }

  /** Settle one job that was sent before a restart, without sending it again. */
  async settleSent(job) {
    const member = this.config.get(job.member_id);
    const interrupted = (why) => this.fail(job.id, `${member?.name ?? job.member_id} 上次被重启打断，${why}，需要的话请重新 @。`, 'interrupted');
    if (member === undefined || member.cli !== undefined || !job.input_id) { interrupted('这条没有完成'); return; }
    const agent = await this.liveAgent(job.session_id, member);
    if (this.closed) return;
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
    for (const w of this.watching.values()) w.resolve(INTERRUPTED);
    this.watching.clear();
    for (const id of [...this.cliAgents.keys()]) this.dropCli(id);
    // A queue still waiting on the host (for example a resume during shutdown) must not block unload forever.
    let timer;
    const limit = new Promise((resolve) => { timer = setTimeout(resolve, CLOSE_TIMEOUT_MS); });
    await Promise.race([Promise.allSettled(this.queues.values()), limit]);
    clearTimeout(timer);
  }
}
