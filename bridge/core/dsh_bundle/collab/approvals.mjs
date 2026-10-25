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
//   });
//   await decision;                 // 'allow' | 'deny' | 'allow_all' | 'expired'
import { forMember, mentions } from './mentions.mjs';
import { CollabError, publicMessage } from './store.mjs';

const STATES = { allow: 'allowed', deny: 'denied', allow_all: 'allowed_all' };
// Labels and order of cc-connect's permission buttons (bridge core/engine.go), so
// a DSH member's card reads the same as a cloud-web bot's.
export const DEFAULT_ACTIONS = [
  { decision: 'allow', label: '允许' },
  { decision: 'deny', label: '拒绝' },
  { decision: 'allow_all', label: '允许所有 (本次会话)' },
];
// Same vocabularies and order as bridge core/engine.go approveAllPhrases /
// approveAllSingleTokens / allowKeywords / denyKeywords, so a text reply and a
// button click resolve to the same decision.
const APPROVE_ALL_PHRASES = ['allow all', 'approve all', 'yes all'];
const APPROVE_ALL_TOKENS = ['allowall', '允许所有', '允许全部', '全部允许', '所有允许', '都允许', '全部同意'];
const ALLOW_TOKENS = ['allow', 'yes', 'y', 'ok', 'approve', '允许', '同意', '可以', '好', '好的', '是', '确认'];
const DENY_TOKENS = ['deny', 'no', 'n', 'reject', 'cancel', '拒绝', '不允许', '不行', '不', '否', '取消'];

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
  open({ room, author, text, actions = DEFAULT_ACTIONS, signal, meta, check, onDecide }) {
    const card = { kind: 'permission', title: '权限请求', state: 'pending', actions: actions.map(a => ({ decision: a.decision, label: a.label })) };
    const { message } = this.hub.post(room, { authorKind: 'role', author: author.id, name: author.name, text, card: JSON.stringify(card) });
    let resolve;
    const decision = new Promise(r => { resolve = r; });
    this.pending.set(message.id, { room, author: author.id, meta, check, onDecide, resolve });
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
    if (!Object.hasOwn(STATES, decision)) throw new CollabError('invalid', `unknown decision ${decision}`);
    const row = this.hub.store.message(msgId);
    const card = row === undefined ? undefined : parseCard(row.card);
    if (card?.kind !== 'permission') throw new CollabError('not-permission', '这条消息不是权限请求');
    if (card.state !== 'pending') throw new CollabError('conflict', card.state === 'expired' ? '这个权限请求已过期' : '这个权限请求已经处理过了');
    const p = this.pending.get(msgId);
    if (p === undefined) {
      // Pending in the store but not in memory: collab restarted, the asker's side is gone.
      this.close(msgId, 'expired', row);
      throw new CollabError('conflict', '这个权限请求已过期');
    }
    p.check?.();
    this.close(msgId, STATES[decision], row, by);
    p.resolve(decision);
    p.onDecide?.(decision, by);
    return publicMessage(this.hub.store.message(msgId), this.hub.store);
  }

  /** Withdraw card `msgId`: it shows as expired and its decision settles 'expired'. */
  expire(msgId) {
    const p = this.pending.get(msgId);
    this.close(msgId, 'expired');
    p?.resolve('expired');
  }

  /** Expire every pending card whose entry matches pred({ room, author, meta }). */
  expireWhere(pred) {
    for (const [msgId, p] of [...this.pending]) if (pred(p)) this.expire(msgId);
  }

  /** Mark a card decided/expired and update it for browsers. */
  close(msgId, state, row = this.hub.store.message(msgId), by) {
    this.pending.delete(msgId);
    const card = row === undefined ? undefined : parseCard(row.card);
    if (card?.kind !== 'permission' || card.state !== 'pending') return;
    const next = { ...card, state, ...(by ? { decided_by: by } : {}), decided_at: Math.floor(Date.now() / 1000) };
    this.hub.edit(row.id, 'role', row.author, row.text, JSON.stringify(next));
  }

  /**
   * Owner text reply → decision on the room's pending cards; returns the ids of
   * the members that must not also get the text as a message (card answered,
   * or withheld from them). Idempotent per message row.
   *
   * cc-connect checks a pending permission before its gate and before any
   * mention rule (bridge core/engine.go handleMessage → handlePendingPermission,
   * ahead of applyGate), and hub bots run with group_reply_all
   * (core/setup_wizard.go), so every bot with a pending prompt that receives an
   * allow/deny word acts on it. Hence: no @ → the decision applies to every
   * pending card in the room; an @ → only the @'d members', and the other
   * pending members are not sent the text so their cards stay open.
   */
  answerByText(msg) {
    const memo = this.answers.get(msg);
    if (memo !== undefined) return memo;
    const answered = new Set();
    this.answers.set(msg, answered);
    if (msg.author_kind !== 'user') return answered;
    const inRoom = [...this.pending].filter(([, p]) => p.room === msg.room_id);
    if (inRoom.length === 0) return answered;
    const members = this.hub.routable();
    const mentioned = mentions(msg.text, members);
    for (const [msgId, p] of inRoom) {
      const to = this.hub.members.get(p.author) ?? { id: p.author, name: '' };
      const decision = textDecision(forMember(msg.text, to, members));
      if (decision === undefined) continue;
      if (mentioned.size > 0 && !mentioned.has(p.author)) {
        answered.add(p.author); // addressed to someone else: withhold it so this member doesn't approve
        continue;
      }
      try { this.decide(msgId, decision, 'text'); } catch { continue; }
      answered.add(p.author);
    }
    return answered;
  }
}

export function parseCard(raw) {
  if (typeof raw !== 'string') return undefined;
  try { return JSON.parse(raw); } catch { return undefined; }
}

// Same rune set as bridge core/engine.go permissionTokenSeparator (whitespace plus these).
const PERM_TOKEN_SEPARATORS = /[\s@＠,，.。!！?？:：;；()（）[\]【】"'“”‘’、·]+/u;

/** Port of bridge core/engine.go isApproveAllResponse / isAllowResponse / isDenyResponse (checked in that order). */
export function textDecision(text) {
  const tokens = String(text).toLowerCase().trim().split(PERM_TOKEN_SEPARATORS).filter(Boolean);
  if (tokens.length === 0) return undefined;
  const joined = tokens.join(' ');
  if (APPROVE_ALL_PHRASES.some(ph => joined === ph || ` ${joined} `.includes(` ${ph} `))) return 'allow_all';
  if (tokens.some(t => APPROVE_ALL_TOKENS.includes(t))) return 'allow_all';
  if (tokens.some(t => ALLOW_TOKENS.includes(t))) return 'allow';
  if (tokens.some(t => DENY_TOKENS.includes(t))) return 'deny';
  return undefined;
}
