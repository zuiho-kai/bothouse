// DSH-native channel members. Each (member, room) owns one ordinary DSH root
// Session that shows up in the DSH Web UI; a channel @-mention becomes one
// durable job. The job records the Session offset and the id of the input it
// admits, and its reply is taken only from the turn that consumed that input,
// so a turn started from the DSH Web UI is never posted to the channel.
// After a restart an input that was never consumed is withdrawn and reported;
// one that was consumed is settled from the Session log. Nothing is re-sent,
// so a prompt is executed at most once.
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { exitTarget } from './team-exit.mjs';
import { DEFAULT_DISPATCH_MODE, MAX_TEXT } from './store.mjs';
import { ChannelApprovals, DEFAULT_ACTIONS } from './approvals.mjs';
import { DEFAULT_PERMISSION_PRESET, presetDecision } from './cli-member.mjs';
// Shared with the bridge (bridge/core/team_mode.go): a common part, then one
// "## <mode>" section per dispatch mode; a member sees only its room's section.
const TEAM_MODE_FILE = readFileSync(new URL('./team-mode-rules.md', import.meta.url), 'utf8');
export function teamModeRules(mode = DEFAULT_DISPATCH_MODE) {
  const [common, ...parts] = TEAM_MODE_FILE.split(/^## /m);
  const section = parts.find(p => p.startsWith(`${mode}\n`)) ?? parts.find(p => p.startsWith(`${DEFAULT_DISPATCH_MODE}\n`));
  return `${common.trim()}\n${section.slice(section.indexOf('\n') + 1).trim()}`;
}
/** Opening brief for a new workspace: the rules of the chat channel's mode. */
export function workspaceInstructions(mode) { return teamModeRules(mode); }
export function memberStatus(hub, tasks = hub?.tasks) {
  const thinking = new Set([...(hub?.thinking?.values() ?? [])].flatMap(s => [...s]));
  const busyMap = tasks?.busyMap?.() ?? new Map();
  return '【队友状态】\n' + hub.routable().map(m => {
    if (m.online === false || m.error) return `${m.name} (${m.id})：离线`;
    const taskBusy = busyMap.get(m.id);
    if (taskBusy) {
      return `${m.name} (${m.id})：在${taskBusy.roomName}忙碌（任务 #${taskBusy.task.id}「${taskBusy.task.title}」，已用时 ${taskBusy.durationText}）`;
    }
    if (thinking.has(m.id)) return `${m.name} (${m.id})：忙碌`;
    return `${m.name} (${m.id})：空闲`;
  }).join('\n');
}
import { mentions, nameCalled, split } from './mentions.mjs';
import { quotePrefix } from './store.mjs';
import { progressCardOf } from './cloudweb.mjs';
import { attachmentBlocks, namedAttachmentBlocks, nativeAttachmentBlocks } from './attachments.mjs';

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
export function promptText(room, member, messages, status = '', mode = DEFAULT_DISPATCH_MODE, store = undefined) {
  if (status && typeof status === 'object' && typeof status.quote === 'function') {
    store = status;
    status = '';
    mode = DEFAULT_DISPATCH_MODE;
  }
  const lines = messages.map(m => `【${m.name}】${quotePrefix(store?.quote?.(m))}${m.text}`);
  const model = member.model === undefined ? '' : `你底层用的模型是 ${member.model.provider}/${member.model.model}。`;
  const persona = member.persona?.trim() ? ['你的人设：', member.persona.trim(), ''] : [];
  return [
    `你是频道 #${room.name} 的成员「${member.name}」。${model}频道里其他人各有自己的身份，他们的自我介绍说的是他们自己，不是你。`,
    ...persona,
    teamModeRules(mode),
    status,
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

/**
 * Card text of one approval request, in cc-connect's permission prompt layout:
 * the tool, what it wants to run (the call's first argument), and DSH's reason.
 */
function approvalText(request, session, seqBefore) {
  const call = request.callId === undefined ? undefined
    : session.snapshotEvents(seqBefore).find(e => e.type === 'tool/call' && e.data?.callId === request.callId);
  const arg = call === undefined ? '' : toolArgText(call.data.arguments).trim();
  // displayReason is a locale map ({ en, zh?, ... }) in DSH's escalation request; reason is a plain string.
  const shown = request.displayReason;
  const reason = String((shown && typeof shown === 'object' ? shown.zh ?? shown.en : shown) ?? request.reason ?? '').trim();
  const lines = [`⚠️ **权限请求** ${request.toolName}`, arg && `\`${arg.replace(/`/g, "'")}\``, reason, '回复 **允许** / **拒绝** / **允许所有**'];
  return lines.filter(Boolean).join('\n').slice(0, MAX_TEXT);
}

/**
 * Card of one ACP session/request_permission from a local CLI member: the same
 * layout as approvalText, with only the buttons the CLI offered. ACP option
 * kinds (agentclientprotocol.com/protocol/tool-calls#permission-options) map to
 * the card decisions: allow_once -> allow, allow_always -> allow_all, reject_* -> deny.
 */
export function cliApprovalCard(request) {
  const kinds = { allow_once: 'allow', allow_always: 'allow_all', reject_once: 'deny', reject_always: 'deny' };
  const byDecision = new Map();
  for (const o of request.options ?? []) {
    const d = kinds[o.kind];
    if (d !== undefined && !byDecision.has(d)) byDecision.set(d, o.optionId);
  }
  const actions = DEFAULT_ACTIONS.filter(a => byDecision.has(a.decision));
  const tc = request.toolCall ?? {};
  const arg = toolArgText(JSON.stringify(tc.rawInput ?? {})).trim();
  const words = { allow: '**允许**', deny: '**拒绝**', allow_all: '**允许所有**' };
  const lines = [`⚠️ **权限请求** ${tc.title ?? tc.kind ?? ''}`, arg && arg !== '{}' && `\`${arg.replace(/`/g, "'")}\``, `回复 ${actions.map(a => words[a.decision]).join(' / ')}`];
  // A text reply can say 允许所有 even when the CLI offered no allow_always: answer with
  // its allow_once instead, and let the card show what was actually sent.
  const mapDecision = d => (d === 'allow_all' && !byDecision.has(d) && byDecision.has('allow') ? 'allow' : d);
  return { text: lines.filter(Boolean).join('\n').slice(0, MAX_TEXT), actions, byDecision, mapDecision };
}

/** Short text of a tool call's arguments for the card: the first string field (command, path, query), else the raw text. */
function toolArgText(raw) {
  try {
    const args = JSON.parse(raw);
    const first = args !== null && typeof args === 'object' ? Object.values(args).find(v => typeof v === 'string' && v.trim()) : undefined;
    if (first !== undefined) return first;
  } catch { /* not JSON: show it as is */ }
  return typeof raw === 'string' ? raw : '';
}

/**
 * Live progress card of one member turn, the DSH-side counterpart of the
 * bridge's progress card (cloudweb.mjs progressCard): posted in the room at the
 * turn's first event (thought or tool call), edited as events arrive, and
 * closed as 已完成 or 失败 when the turn ends. A turn without thoughts or tool
 * calls posts no card, like the bridge.
 */
export class TurnProgress {
  constructor(hub, roomId, member, jobId, now = Date.now) {
    this.hub = hub;
    this.roomId = roomId;
    this.member = member;
    this.jobId = jobId;
    this.now = now;
    this.started = now();
    this.items = [];
    this.steps = 0;
    this.names = new Map();
    this.resolved = new Set();
    this.id = undefined;
    this.queued = false;
    this.ended = false;
  }

  call(callId, name, args) {
    if (this.ended) return;
    this.steps++;
    if (callId !== undefined) this.names.set(callId, name);
    this.items.push({ kind: 'tool_use', tool: name, text: toolArgText(args) });
    this.schedule();
  }

  /** One thought chunk (ACP agent_thought_chunk); consecutive chunks grow one thinking line. */
  thought(text) {
    if (this.ended || typeof text !== 'string' || text === '') return;
    const last = this.items[this.items.length - 1];
    if (last?.kind === 'thinking') last.text += text;
    else this.items.push({ kind: 'thinking', text });
    this.schedule();
  }

  result(callId, failed, reason) {
    if (this.ended || this.resolved.has(callId)) return;
    if (callId !== undefined) this.resolved.add(callId);
    this.items.push({ kind: 'tool_result', tool: this.names.get(callId) ?? '', success: !failed, text: failed ? (reason ?? '') : '' });
    this.schedule();
  }

  /** Coalesce a burst of events into one store write per event-loop turn. */
  schedule() {
    if (this.queued) return;
    this.queued = true;
    setImmediate(() => { this.queued = false; if (!this.ended) this.write('running'); });
  }

  end(state) {
    if (this.ended) return;
    this.ended = true;
    // Only a turn that had events has a card to close.
    if (this.steps > 0 || this.items.length > 0) this.write(state);
  }

  write(state) {
    const body = progressCardOf({ agent: this.member.name, state, steps: this.steps, elapsed_sec: Math.floor((this.now() - this.started) / 1000), items: this.items });
    if (this.id === undefined) {
      this.id = this.hub.post(this.roomId, { authorKind: 'role', author: this.member.id, name: this.member.name, clientKey: `dsh-job-${this.jobId}-progress`, text: body.text, card: body.card }).message.id;
    } else {
      this.hub.edit(this.id, 'role', this.member.id, body.text, body.card);
    }
  }
}

/** Whether text, with @-mentions removed, is the /new command (bridge core cmdNew). */
export function isNewCommand(text, members) {
  const rest = split(text, members).filter(([, id]) => id === null).map(([seg]) => seg).join('').trim();
  return /^\/new(\s|$)/.test(rest);
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
    /** #557: permission cards of channel-started turns, shared with cloud-web bots. */
    this.approvals = ChannelApprovals.of(hub);
    /** Session ids whose owner chose 允许所有: later asks in that Session are allowed without a card. */
    this.allowAll = new Set();
    for (const m of members) this.publish(m);
    hub.onPlan(message => this.plan(message));
  }

  publish(m) {
    this.hub.setMember({ id: m.id, name: m.name, kind: 'dsh', online: true, model: m.model, ...(m.cli ? { cli: m.cli, ...(m.permissionPreset ? { permissionPreset: m.permissionPreset } : {}) } : {}), persona: m.persona ?? '', ...(m.avatar ? { avatar: m.avatar } : {}), source: m.source ?? 'config' });
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
    if (w.turn !== undefined && event.data?.turn === w.turn) {
      if (event.type === 'tool/call') w.progress?.call(event.data.callId, event.data.name, event.data.arguments);
      else if (event.type === 'tool/result') w.progress?.result(event.data.message?.toolCallId, event.data.error !== undefined || event.data.message?.isError === true, event.data.error?.reason ?? event.data.error?.name);
      else if (event.type === 'assistant/message') {
        for (const part of event.data.message?.content ?? []) {
          if (part?.type === 'reasoning' && typeof part.text === 'string' && part.text !== '') w.progress?.thought(part.text);
        }
      }
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

  /**
   * #148: the owner withdrew trigger message triggerId. Every job it planned
   * ends quietly, with no reply and no failure card: a queued one is closed, an
   * input still waiting in the member's inbox is taken back, and a turn already
   * running is cancelled the way DSH's stop button does (keepInbox, so the
   * member's later inputs still run). Jobs this cannot reach (a CLI member's
   * ask) keep running.
   * @returns { stopped, running } member ids whose turn was cancelled / left running.
   */
  recall(triggerId) {
    const stopped = [];
    const running = [];
    for (const job of this.store.openJobs()) {
      if (job.trigger_id !== triggerId) continue;
      if (job.state === 'pending') { this.store.finishJob(job.id, 'interrupted'); continue; }
      const w = this.watching.get(job.session_id);
      const agent = job.input_id ? this.rt.ctx.agents.get(job.session_id) : undefined;
      if (w?.jobId !== job.id || agent === undefined) { running.push(job.member_id); continue; }
      // Close the job first, so neither the discarded listener nor the settle path posts a card or a reply.
      this.store.finishJob(job.id, 'interrupted');
      this.approvals.expireWhere(p => p.meta?.sessionId === job.session_id);
      if (w.turn === undefined && agent.inbox.remove(job.input_id)) continue;
      this.watching.delete(job.session_id);
      w.resolve(INTERRUPTED);
      agent.cancel({ kind: 'user' }, { keepInbox: true });
      stopped.push(job.member_id);
    }
    return { stopped, running };
  }

  /**
   * #557: root approval/request answerer (installed prepended by the plugin).
   * The Session is held out of the DSH conversation list, so its approval
   * popup has nowhere to show: a turn the channel started asks in the room of
   * its job, as a permission card (approvals.mjs). Any other turn — one started
   * from the DSH Web UI — goes on to the next answerer. The approval service
   * applies the Session's policy first (Full access: no request at all;
   * \`never\`: rejected before any answerer), so a card appears exactly when
   * DSH would have asked. Withdrawing the request (turn cancelled or recalled)
   * expires the card.
   */
  async onApprovalRequest(request, next) {
    const session = request.agent?.session;
    const w = session === undefined ? undefined : this.watching.get(session.id);
    const job = w === undefined ? undefined : this.store.job(w.jobId);
    const member = job === undefined ? undefined : this.config.get(job.member_id);
    if (member === undefined || member.cli !== undefined) return next();
    if (this.allowAll.has(session.id)) return 'allowed-once';
    const { decision } = this.approvals.open({
      room: job.room_id, author: { id: member.id, name: member.name }, text: approvalText(request, session, w.seqBefore),
      signal: request.signal, meta: { sessionId: session.id },
    });
    const d = await decision;
    if (d === 'allow_all') this.allowAll.add(session.id);
    return d === 'allow' || d === 'allow_all' ? 'allowed-once' : d === 'deny' ? 'rejected' : 'cancelled';
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
    if (msg.author_kind === 'system' || msg.card !== null || this.hub.teamExit?.answerFor(msg)) return undefined;
    const target = exitTarget(msg);
    const mode = this.store.dispatchMode(msg.room_id);
    // Solo mode keeps agent-to-agent relays inside the lead's own runtime;
    // an explicit user mention still routes to the named DSH member.
    if (mode === 'solo' && msg.author_kind === 'role') return undefined;
    // An owner text reply that decides (or is withheld from) a member's permission card is not a new ask for it.
    const answered = this.approvals.answerByText(msg);
    const hit = mentions(msg.text, this.hub.routable());
    const only = this.hub.replyRoute(msg);
    const leadID = this.hub.selectedPrimaryMember()?.id;
    const leadTarget = msg.author_kind === 'user' && leadID !== undefined && target === undefined && only === null && hit.size === 0;
    const targets = [...this.config.keys()].filter(id => id !== msg.author && !answered.has(id) && (!target || target === id)
      && (only !== null ? only.has(id) : hit.has(id) || (leadTarget && id === leadID) || (msg.author_kind === 'role' && nameCalled(msg.text, this.config.get(id).name, [...this.config.keys()].filter(o => o !== id).map(o => this.config.get(o).name)))));
    if (targets.length === 0) return undefined;
    // /new goes to the members the message reaches, as on Discord where only the addressed bot handles it.
    if (msg.author_kind === 'user' && isNewCommand(msg.text, this.hub.routable())) {
      return () => {
        for (const id of targets) this.enqueue({ member_id: id, room_id: msg.room_id }, () => this.renew(id, msg));
      };
    }
    if (msg.author_kind === 'role' && this.store.relayDepth(msg.room_id, msg.id) > this.maxRelay) {
      return () => this.hub.post(msg.room_id, {
        authorKind: 'system', author: 'system', name: 'system', clientKey: `relay-cap-${msg.id}`,
        text: `Agent 之间已经连续接力 ${this.maxRelay} 次以上，暂停自动接力；需要继续请人来 @。`,
      });
    }
    const jobs = targets.map(id => this.store.addJob(id, msg.room_id, msg.id)).filter(Boolean);
    return () => {
      for (const job of jobs) this.enqueue(job, () => this.run(job.id));
    };
  }

  /**
   * Start a member on a system message addressed to it (#139 B task reminder).
   * System rows never plan jobs by themselves; this is the one explicit wake.
   * Returns false when the id is not a DSH member.
   */
  nudge(memberId, msg) {
    if (!this.config.has(memberId)) return false;
    const job = this.store.addJob(memberId, msg.room_id, msg.id);
    if (job) this.enqueue(job, () => this.run(job.id));
    return true;
  }

  /**
   * Retry a previous failed turn for (memberId, msg).
   * Wakes the member with the original trigger message and resets its job.
   */
  retry(memberId, msg) {
    if (!this.config.has(memberId)) return false;
    const job = this.store.retryJob(memberId, msg.room_id, msg.id);
    if (job) {
      this.hub.setError(memberId, undefined);
      this.enqueue(job, () => this.run(job.id));
      return true;
    }
    return false;
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
      .filter(m => (m.id > binding.context_cursor || m.id === job.trigger_id) && m.author !== member.id && (m.author_kind !== 'system' || m.id === job.trigger_id) && m.card === null && !m.draft)
      .slice(-CONTEXT_LIMIT);
    // DSH validates images again (count, total bytes, type, pixels). Attachments it
    // refuses are dropped one by one (the rest still go through), the member is told in
    // text and the channel gets a system note, instead of failing the turn: a failed turn
    // never advances the cursor, so the same image would block the room.
    const { parts: media, dropped: refused } = await nativeAttachmentBlocks(this.rt.ctx.attachments, namedAttachmentBlocks(this.rt.files, unseen));
    const dropped = refused.map(d => `\n\n[${d.name}: attachment not delivered (${d.reason})]`).join('');
    const input = this.rt.createUserMessage({ content: [{ type: 'text', text: promptText(room, member, unseen, memberStatus(this.hub), this.store.dispatchMode(room.id), this.store) + dropped + (this.rt.later?.instructions(member.id, room.id) ?? '') }, ...media], source: { kind: 'user' } });
    const seqBefore = agent.session.seq;
    if (!this.store.markSent(jobId, agent.session.id, seqBefore, input.id)) return;
    if (refused.length) {
      this.hub.post(room.id, {
        authorKind: 'system', author: 'system', name: 'system', clientKey: `dsh-job-${jobId}-attachments-dropped`,
        text: `⚠️ 有附件没送到 ${member.name}：${refused.map(d => `${d.name}（${d.reason}）`).join('；')}`,
      });
    }
    await this.admitAndSettle(job, member, agent, input, seqBefore);
  }

  /**
   * A local CLI member (claude/codex/gemini over ACP): same job, cursor,
   * thinking and relay rules as a DSH member, but the turn runs in the CLI's
   * own ACP session for this room and its reply text is posted directly.
   */
  async runCli(job, member, room) {
    // Until the ACP session exists the binding holds a placeholder unique to (member, room);
    // onSession below swaps in the real ACP sessionId so a restart can session/load it.
    const placeholder = `cli:${member.cli}:${member.id}:${room.id}`;
    if (this.store.binding(member.id, room.id) === undefined) this.store.bind(member.id, room.id, placeholder);
    const binding = this.store.binding(member.id, room.id);
    const sessionId = binding.session_id;
    const resumeId = sessionId.startsWith('cli:') ? undefined : sessionId;
    const unseen = this.store.page(room.id, job.trigger_id + 1, CONTEXT_LIMIT * 4)
      .filter(m => (m.id > binding.context_cursor || m.id === job.trigger_id) && m.author !== member.id && (m.author_kind !== 'system' || m.id === job.trigger_id) && m.card === null && !m.draft)
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
    const progress = new TurnProgress(this.hub, job.room_id, member, job.id);
    // ACP tool calls (agentclientprotocol.com/protocol/tool-calls): one call per toolCallId, its update says completed or failed.
    // Thoughts (agent_thought_chunk) feed the card too, as on the bridge.
    const onTool = (u) => {
      if (u.sessionUpdate === 'agent_thought_chunk') { if (u.content?.type === 'text') progress.thought(u.content.text); return; }
      if (u.sessionUpdate === 'tool_call') progress.call(u.toolCallId, u.title ?? u.kind ?? '', JSON.stringify(u.rawInput ?? {}));
      if (u.status === 'completed' || u.status === 'failed') progress.result(u.toolCallId, u.status === 'failed');
    };
    // Tool approval follows the member's DSH permission preset (cli-member.mjs presetDecision):
    // Full access answers at once, Read Only refuses, Workspace Write asks the owner in the room.
    // No timeout while the card waits, as cc-connect (bridge core/engine.go handlePendingPermission
    // has none); the turn ending withdraws the card and the request is cancelled.
    const turnOver = new AbortController();
    const onPermission = async (request) => {
      const preset = member.permissionPreset ?? DEFAULT_PERMISSION_PRESET;
      const fixed = presetDecision(preset, request.options ?? []);
      if (fixed === null) return { outcome: 'cancelled' };
      if (fixed !== 'ask') return { outcome: 'selected', ...fixed };
      const card = cliApprovalCard(request);
      if (card.actions.length === 0) return { outcome: 'cancelled' };
      const { decision } = this.approvals.open({
        room: job.room_id, author: { id: member.id, name: member.name }, text: card.text, actions: card.actions,
        signal: turnOver.signal, meta: { cliMember: member.id, jobId: job.id }, mapDecision: card.mapDecision,
      });
      const d = await decision;
      const optionId = card.byDecision.get(d);
      return optionId === undefined ? { outcome: 'cancelled' } : { outcome: 'selected', optionId };
    };
    let done = false;
    try {
      this.store.advanceCursor(member.id, job.room_id, job.trigger_id);
      const onSession = ({ sessionId: acpId, lost }) => {
        if (this.store.binding(member.id, room.id)?.session_id !== acpId) this.store.rebind(member.id, room.id, acpId);
        if (lost) {
          this.hub.post(job.room_id, {
            authorKind: 'system', author: 'system', name: 'system', clientKey: `dsh-job-${job.id}-session-lost`,
            text: `${member.name}（${member.cli}）这轮起是新会话，之前的上下文没了：${member.cli} 不支持续上原会话，或续会话失败。`,
          });
        }
      };
      const text = (await entry.agent.ask(promptText(room, member, unseen, memberStatus(this.hub), this.store.dispatchMode(room.id), this.store) + (this.rt.later?.instructions(member.id, room.id) ?? ''), String(room.id), onText, onTool, { resumeId, onSession, onPermission, attachments: attachmentBlocks(this.rt.files, unseen) }))?.trim();
      if (this.closed) return;
      if (!text) { this.fail(job.id, `${member.name} 这一轮没有给出回复（${member.cli} 没有输出文字）`); return; }
      latest = '';
      const reply = this.returnToLead(job, member, text);
      const committed = draft === undefined ? undefined : this.hub.commit(draft.id, 'role', member.id, reply);
      const message = committed ?? this.hub.post(job.room_id, { authorKind: 'role', author: member.id, name: member.name, clientKey, text: reply }).message;
      done = true;
      this.store.finishJob(job.id, 'done', message.id);
    } finally {
      turnOver.abort();
      latest = '';
      progress.end(done ? 'completed' : 'failed');
      // Error, cancel or empty turn: drop the partial draft so the room never keeps a cut-off reply.
      if (!done && draft?.draft) this.hub.remove(draft.id, 'role', member.id);
      this.hub.setThinking(job.room_id, member.id, false);
    }
  }

  /** A released workspace starts over: drop each local CLI member's ACP session for roomId. */
  resetRoom(roomId) {
    for (const { agent } of this.cliAgents.values()) {
      agent.sessions?.delete(String(roomId));
      agent.saved?.delete(String(roomId));
    }
  }

  dropCli(id) {
    this.cliAgents.get(id)?.agent.close();
    this.cliAgents.delete(id);
  }

  /** Watch for the consuming turn, admit the input, and post the outcome. */
  async admitAndSettle(job, member, agent, input, seqBefore) {
    const sessionId = agent.session.id;
    const progress = new TurnProgress(this.hub, job.room_id, member, job.id);
    let settled = 'failed';
    const done = new Promise((resolve) => {
      this.watching.set(sessionId, { jobId: job.id, inputId: input.id, seqBefore, turn: undefined, resolve, progress });
    });
    this.hub.setError(member.id, undefined);
    this.hub.setThinking(job.room_id, member.id, true);
    try {
      if (input.admit !== false) agent.followup(input);
      this.store.advanceCursor(member.id, job.room_id, job.trigger_id);
      const outcome = await done;
      if (outcome === INTERRUPTED || this.closed) return;
      if (outcome.discarded) this.fail(job.id, `${member.name} 的这条任务在开始前被取消了。`);
      else if (this.finish(job, member, outcome)) settled = 'completed';
    } finally {
      progress.end(settled);
      // A failed admission must not leave a watcher that claims a later, unrelated turn.
      if (this.watching.get(sessionId)?.jobId === job.id) this.watching.delete(sessionId);
      this.hub.setThinking(job.room_id, member.id, false);
    }
  }

  finish(job, member, { events, reason }) {
    const text = finalText(events);
    if (text === undefined) {
      this.fail(job.id, `${member.name} 这一轮没有给出回复（${describeReason(reason)}）`);
      return false;
    }
    const kind = reason?.kind;
    const complete = kind === undefined || kind === 'completed' || kind === 'max-tokens';
    const { message } = this.hub.post(job.room_id, {
      authorKind: 'role', author: member.id, name: member.name, clientKey: `dsh-job-${job.id}`,
      text: this.returnToLead(job, member, complete ? text : `${text}\n\n（这一轮没有正常结束：${describeReason(reason)}）`),
    });
    this.store.finishJob(job.id, 'done', message.id);
    return complete;
  }

  /**
   * The primary role whose dispatch this job answers, or undefined. Same rule as
   * bridge/platform/cloud-web/lead_return.go dispatchedBy: the lead's own message
   * called this member, or a person's message @-s this member and the lead together.
   */
  dispatchedBy(job, member) {
    const lead = this.hub.selectedPrimaryMember();
    if (lead === undefined || lead.id === member.id) return undefined;
    const trigger = this.store.message(job.trigger_id);
    if (trigger === undefined) return undefined;
    if (trigger.author_kind === 'role') return trigger.author === lead.id ? lead : undefined;
    if (trigger.author_kind !== 'user') return undefined;
    return mentions(trigger.text, this.hub.routable()).has(lead.id) ? lead : undefined;
  }

  /**
   * Port of lead_return.go returnToLead: a member's final answer to the lead's
   * dispatch starts with @lead even if the model forgot it, so the hand-back
   * wakes the lead the same way a cloud-web bot's does.
   */
  returnToLead(job, member, text) {
    const lead = this.dispatchedBy(job, member);
    if (lead === undefined || !text.trim() || mentions(text, this.hub.routable()).has(lead.id)) return text;
    return `@${lead.name} ${text}`;
  }

  fail(jobId, notice, state = 'failed') {
    if (this.closed) return;
    const job = this.store.job(jobId);
    if (job === undefined || !this.store.finishJob(jobId, state)) return;
    const error = friendlyFailure(notice);
    this.hub.setError(job.member_id, error);
    this.hub.post(job.room_id, {
      authorKind: 'system', author: 'system', name: 'system', text: error, clientKey: `dsh-job-${jobId}-${state}-${Date.now()}`,
      card: JSON.stringify({
        title: '成员出错',
        state: 'failed',
        action: 'configure-model',
        job_id: jobId,
        member_id: job.member_id,
        trigger_id: job.trigger_id,
      }),
    });
  }

  /**
   * Live Agent for (member, room): loaded, resumed, or newly created and bound.
   * A bound Session that was archived or is gone from session persistence is
   * replaced by a new one (rebind), so the member keeps answering; its old
   * memory stays in the old Session. Other resume errors propagate.
   */
  async ensureAgent(member, room) {
    const binding = this.store.binding(member.id, room.id);
    if (binding === undefined) return this.createAgent(member, room);
    const agent = await this.boundAgent(binding.session_id, member);
    return agent ?? this.createAgent(member, room);
  }

  /** The bound Session's Agent, or undefined when the Session can no longer serve the channel. */
  async boundAgent(sessionId, member) {
    const { ctx } = this.rt;
    const why = ctx.workspaceRegistry.archivedSessionIds?.includes(sessionId) ? 'archived'
      : ctx.agents.get(sessionId) === undefined && await ctx.sessionPersistence.stat(sessionId) === undefined ? 'missing' : undefined;
    // Any other resume error is a real failure: let it surface so the old
    // Session (and the member's memory in it) is not silently replaced.
    if (why === undefined) return this.liveAgent(sessionId, member);
    this.rt.logger.info('collab: Session %s is %s, starting a new one', sessionId, why);
    return undefined;
  }

  /**
   * Create a new Session for (member, room) and bind it, replacing any old
   * binding. The Session carries origin "subagent" so DSH keeps it out of the
   * conversation list: the plugin holds it, the user cannot archive it, and
   * /new in the channel is the way to start over.
   */
  async createAgent(member, room) {
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
        meta: { cwd: workspace.path, agentPreset: preset.id, origin: 'subagent' },
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
    // setup ran before the Agent existed, so record it here: liveAgent must not hook it again.
    this.hooked.add(handle.agent);
    if (member.permissionPreset !== undefined) ctx.permissionPresets.set(handle.agent.session, member.permissionPreset);
    ctx.sessionTitle.rename(handle.agent.session, `#${room.name} · ${member.name}`);
    if (this.store.binding(member.id, room.id) === undefined) this.store.bind(member.id, room.id, sessionId);
    else this.store.rebind(member.id, room.id, sessionId);
    return handle.agent;
  }

  /**
   * /new in the channel: each addressed member starts over in this room. A
   * DSH member gets a new Session (the old one is dropped from the binding),
   * a CLI member drops its ACP session for the room; both read on from the
   * /new message, not from earlier history.
   */
  async renew(memberId, msg) {
    const member = this.config.get(memberId);
    const room = this.store.room(msg.room_id);
    if (member === undefined || room === undefined) return;
    if (member.cli !== undefined) {
      // Drop the live and the persisted ACP session and point the binding back at
      // runCli's placeholder, so the next turn has no resumeId to session/load.
      const agent = this.cliAgents.get(member.id)?.agent;
      agent?.sessions?.delete(String(room.id));
      agent?.saved?.delete(String(room.id));
      if (this.store.binding(member.id, room.id) !== undefined) this.store.rebind(member.id, room.id, `cli:${member.cli}:${member.id}:${room.id}`);
    } else await this.createAgent(member, room);
    if (this.closed) return;
    this.store.advanceCursor(member.id, room.id, msg.id);
    this.hub.post(room.id, {
      authorKind: 'system', author: 'system', name: 'system', clientKey: `dsh-new-${msg.id}-${member.id}`,
      text: `✅ ${member.name} 的新会话已创建`,
    });
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
    if (member === undefined) return (await ctx.agents.resume({ resumeSessionId: sessionId })).agent;
    // Resume assembles the Agent the same way createAgent does: mount the
    // member's agent preset (its tool set) and apply its permission preset.
    // Installing only the request hook left a resumed Session with just the
    // built-in tools after a DSH restart.
    const preset = await ctx.agentPresets.resolve(member.agentPreset);
    const scope = await ctx.agentPresets.acquireScope(preset.id);
    let handle;
    try {
      handle = await ctx.agents.resume({
        resumeSessionId: sessionId,
        agentOptions: this.selection(member),
        setup: async (agentCtx) => {
          await ctx.agentPresets.mount(agentCtx, preset.id);
          this.setup(agentCtx, member);
        },
      });
    } finally {
      await scope[Symbol.asyncDispose]();
    }
    this.hooked.add(handle.agent);
    if (member.permissionPreset !== undefined) ctx.permissionPresets.set(handle.agent.session, member.permissionPreset);
    return handle.agent;
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
    const interrupted = (why) => {
      // #121: a CLI turn cut by the restart leaves its streamed draft behind; drop it.
      this.hub.dropDrafts('role', job.member_id, `dsh-job-${job.id}`);
      this.fail(job.id, `${member?.name ?? job.member_id} 上次被重启打断，${why}，需要的话请重新 @。`, 'interrupted');
    };
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
