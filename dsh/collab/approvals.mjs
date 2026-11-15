// Channel approval cards (#120, #557): one permission card in a room, decided by
// the owner with a button or a text reply. Member-type neutral: cloud-web bots
// (cloudweb.mjs) and DSH members (dsh-member.mjs) both open their cards here and
// get the decision back through their own callback, so the card, the pending
// table, the text vocabulary and the HTTP route are shared.
//
//   const { messageId, decision } = ChannelApprovals.of(hub).open({
//     room, author: { id, name }, text,
//     actions: [{ decision: 'allow', label: '允许' }, ...],   // default: DEFAULT_ACTIONS
//     signal,                       // abort = request withdrawn, card expires
//     meta,                         // caller data, matched by expireWhere()
//     check() {},                   // throw a CollabError to refuse a decision now (e.g. offline)
//     onDecide(decision, by) {},    // 'allow' | 'deny' | 'allow_all'; by = 'button' | 'text'
//     mapDecision(decision) {},     // optional: the decision actually applied (card state, decision, onDecide),
//                                   // e.g. a text 'allow_all' becomes 'allow' when the asker has no allow-all
//   });
//   await decision;                 // 'allow' | 'deny' | 'allow_all' | 'expired'
import { CollabError, publicMessage } from './store.mjs';

const STATES = { allow: 'allowed', deny: 'denied', allow_all: 'allowed_all' };
// Labels and order of cc-connect's permission buttons (bridge core/engine.go), so
// a DSH member's card reads the same as a cloud-web bot's.
export const DEFAULT_ACTIONS = [
  { decision: 'allow', label: '允许' },
  { decision: 'deny', label: '拒绝' },
  { decision: 'allow_all', label: '允许所有 (本次会话)' },
];
export class ChannelApprovals {
  constructor(hub) {
    this.hub = hub;
    /** card message id -> { room, author, meta, check, onDecide, resolve } while undecided */
    this.pending = new Map();
    /**
     * Owner message row -> Set of member ids its text answered or was withheld from.
     * The DSH planner and the cloud-web listener both ask about the same row
     * object (hub.post hands both the one row), so it is answered once.
     */
    this.answers = new WeakMap();
    hub.approvals = this;
  }

  /** The hub's shared instance, created on first use. */
  static of(hub) { return hub.approvals ?? new ChannelApprovals(hub); }

  /**
   * Post a pending permission card in `room` as `author` and register it.
   * @returns { messageId, decision } — decision settles with the owner's choice, or 'expired'.
   */
  open({ room, author, text, actions = DEFAULT_ACTIONS, signal, meta, check, onDecide, mapDecision, kind = 'permission' }) {
    const card = { kind, title: kind === 'question' ? '需要答复' : '权限请求', state: 'pending', actions: actions.map(a => ({ decision: a.decision, label: a.label })) };
    const { message } = this.hub.post(room, { authorKind: 'role', author: author.id, name: author.name, text, card: JSON.stringify(card) });
    let resolve;
    const decision = new Promise(r => { resolve = r; });
    this.pending.set(message.id, { room, author: author.id, meta, check, onDecide, mapDecision, resolve });
    const workspace = this.hub.store.room(room);
    if (workspace?.parent_id && workspace.parent_id !== room) {
      this.hub.post(workspace.parent_id, {
        authorKind: 'role', author: author.id, name: author.name, text,
        card: JSON.stringify({ ...card, request_id: message.id }),
        clientKey: `approval-copy:${message.id}`,
      });
    }
    if (signal !== undefined) {
      const onAbort = () => this.expire(message.id);
      if (signal.aborted) onAbort();
      else {
        signal.addEventListener('abort', onAbort, { once: true });
        decision.then(() => signal.removeEventListener('abort', onAbort));
      }
    }
    return { messageId: message.id, decision };
  }

  /**
   * Resolve card `msgId` with `decision` on behalf of the owner (callers check
   * that). Throws CollabError when the message is not a permission card, is
   * already decided or expired, or its asker refuses (check()).
   */
  decide(msgId, decision, by = 'button') {
    const requested = this.hub.store.message(msgId);
    const requestCard = parseCard(requested?.card);
    const sourceId = requestCard?.request_id ?? msgId;
    const row = this.hub.store.message(sourceId);
    const card = row === undefined ? undefined : parseCard(row.card);
    if (card?.kind !== 'permission' && card?.kind !== 'question') throw new CollabError('not-permission', '这条消息不是权限请求或提问');
    if (requestCard?.request_id && (requested.room_id !== this.hub.store.room(row.room_id)?.parent_id || requestCard.kind !== card.kind)) {
      throw new CollabError('not-permission', '这个频道副本不属于该请求');
    }
    if (card.kind === 'permission' ? !Object.hasOwn(STATES, decision) : !card.actions.some(a => a.decision === decision)) {
      throw new CollabError('invalid', `unknown decision ${decision}`);
    }
    if (card.state !== 'pending') throw new CollabError('conflict', card.state === 'expired' ? '这个权限请求已过期' : '这个权限请求已经处理过了');
    const p = this.pending.get(sourceId);
    if (p === undefined) {
      // Pending in the store but not in memory: collab restarted, the asker's side is gone.
      this.close(sourceId, 'expired', row);
      throw new CollabError('conflict', '这个权限请求已过期');
    }
    p.check?.();
    const applied = p.mapDecision?.(decision) ?? decision;
    this.close(sourceId, STATES[applied] ?? 'answered', row, by);
    p.resolve(applied);
    if (card.kind === 'question') this.hub.tasks?.rewatch?.(p.room, p.author);
    p.onDecide?.(applied, by);
    return publicMessage(this.hub.store.message(msgId), this.hub.store);
  }

  /** Withdraw card `msgId`: it shows as expired and its decision settles 'expired'. */
  expire(msgId) {
    const p = this.pending.get(msgId);
    this.close(msgId, 'expired');
    p?.resolve('expired');
    if (p?.meta?.question) this.hub.tasks?.rewatch?.(p.room, p.author);
  }

  /** Expire every pending card whose entry matches pred({ room, author, meta }). */
  expireWhere(pred) {
    for (const [msgId, p] of [...this.pending]) if (pred(p)) this.expire(msgId);
  }

  /**
   * The asker already applied `decision` (the owner answered its prompt in text, #1662): close every
   * pending card matching pred as decided by text, without calling onDecide back.
   */
  settleWhere(pred, decision) {
    if (!Object.hasOwn(STATES, decision)) return;
    for (const [msgId, p] of [...this.pending]) {
      if (!pred(p)) continue;
      this.close(msgId, STATES[decision], undefined, 'text');
      p.resolve(decision);
    }
  }

  /** Mark a card decided/expired and update it for browsers. */
  close(msgId, state, row = this.hub.store.message(msgId), by) {
    this.pending.delete(msgId);
    const card = row === undefined ? undefined : parseCard(row.card);
    if (!['permission', 'question'].includes(card?.kind) || card.state !== 'pending') return;
    const next = { ...card, state, ...(by ? { decided_by: by } : {}), decided_at: Math.floor(Date.now() / 1000) };
    this.hub.edit(row.id, 'role', row.author, row.text, JSON.stringify(next));
    const copies = this.hub.store.db.prepare('SELECT * FROM messages WHERE client_key = ? AND deleted = 0').all(`approval-copy:${msgId}`);
    for (const copy of copies) {
      this.hub.edit(copy.id, 'role', copy.author, copy.text, JSON.stringify({ ...next, request_id: msgId }));
    }
  }

  /**
   * Owner text reply to a pending question card → its answer; returns the ids of the members that
   * must not also get the text as a message. Idempotent per message row. A text "允许"/"拒绝" to a
   * permission prompt goes to the bots like any message: the bridge applies it (core/engine.go
   * handlePendingPermission; an @ of other members leaves this bot's prompt alone) and sends
   * permission_resolved, which closes the card (settleWhere, #1662).
   */
  answerByText(msg) {
    const memo = this.answers.get(msg);
    if (memo !== undefined) return memo;
    const answered = new Set();
    this.answers.set(msg, answered);
    if (msg.author_kind !== 'user') return answered;
    const replied = this.hub.store.message(msg.reply_to);
    const replyCard = parseCard(replied?.card);
    if (replyCard?.kind === 'question' && replyCard.state === 'pending' && msg.text.trim()) {
      const requestId = replyCard.request_id ?? replied.id;
      const question = this.pending.get(requestId);
      if (!question) {
        this.close(requestId, 'expired');
        answered.add(replied.author);
      } else if (question.room === msg.room_id || this.hub.store.room(question.room)?.parent_id === msg.room_id) {
        this.close(requestId, 'answered', this.hub.store.message(requestId), 'text');
        question.resolve(msg.text);
        this.hub.tasks?.rewatch?.(question.room, question.author);
        question.onDecide?.(msg.text, 'text', msg.id);
        answered.add(question.author);
      }
    }
    return answered;
  }
}

export function parseCard(raw) {
  if (typeof raw !== 'string') return undefined;
  try { return JSON.parse(raw); } catch { return undefined; }
}
