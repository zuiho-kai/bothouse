// Room hub: one place that appends a message and fans it out — to browser
// event streams, to connected cc-connect bots, and to DSH member drivers.
import { publicMessage } from './store.mjs';
import { mentions, hasUnknownMention } from './mentions.mjs';

// Same status/footer exclusions as the existing cloud-web transport.
const NOTICE_PREFIXES = ['📬', '✅', '↪', '⏳', '🔄', '⏹', '⏸'];
const FOOTER = /(?:^|\n+)\*[^*\n]*·[^*]*\*\s*$/s;
export function channelText(msg) {
  if (msg.author_kind === 'system' || msg.card != null) return undefined;
  if (msg.author_kind !== 'role') return msg.text;
  if (NOTICE_PREFIXES.some(p => msg.text.trimStart().startsWith(p))) return undefined;
  return msg.text.replace(FOOTER, '').trim() || undefined;
}

export class Hub {
  /**
   * @param store - Store instance.
   * @param logger - { warn(msg, ...args) }.
   */
  constructor(store, logger, routing) {
    this.store = store;
    this.logger = logger;
    /** id -> { id, name, kind: 'dsh' | 'bot' | 'human', mentionId?, online } */
    this.members = new Map();
    /** roomId -> Set<memberId> currently working */
    this.thinking = new Map();
    this.listeners = [];
    this.planners = [];
    this.controlHandlers = [];
    this.subscribers = new Set();
    this.routing = routing;
    this.routes = new WeakMap();
  }

  memberList() { return [...this.members.values()]; }

  /** Members whose @-forms are parsed in channel text (agents only; humans are not routed). */
  routable() { return this.memberList().filter(m => m.kind !== 'human'); }

  /** One routing decision shared by durable native jobs and cloud-web delivery. */
  route(msg) {
    const cached = this.routes.get(msg);
    if (cached) return cached;
    const decision = { targets: new Set(), reason: 'context' };
    // Classify control input before native planners create durable jobs. The
    // predicates are read-only; the owning transport executes it after commit.
    if (this.controlHandlers.some(handles => handles(msg))) {
      decision.reason = 'control';
      this.routes.set(msg, decision);
      return decision;
    }
    const text = channelText(msg);
    if (text !== undefined) {
      const members = this.routable();
      const explicit = mentions(text, members);
      const unknown = hasUnknownMention(text, members);
      if (explicit.size || unknown) {
        decision.reason = 'mention';
        const unavailable = [];
        for (const id of explicit) {
          if (id === msg.author) continue;
          if (this.members.get(id)?.online === false) unavailable.push(id);
          else decision.targets.add(id);
        }
        if (unknown || unavailable.length) decision.error = `未能投递给${unknown ? '未识别的 @成员' : ''}${unknown && unavailable.length ? '、' : ''}${unavailable.join('、')}${unavailable.length ? '（离线）' : ''}；请检查成员或连接。`;
      } else if (msg.author_kind === 'user' && this.routing !== undefined) {
        decision.reason = 'lead';
        const id = this.routing.leadMember;
        const lead = this.members.get(id);
        if (!id) decision.error = '尚未配置主 bot（leadMember），请先配置，或显式 @成员。';
        else if (!lead || lead.kind === 'human') decision.error = `主 bot ${id} 尚未注册；请检查配置，或显式 @其他成员。`;
        else if (lead.online === false || lead.error) decision.error = `主 bot ${id} 当前不可用；请恢复连接，或显式 @成员重试。`;
        else decision.targets.add(id);
      }
    }
    this.routes.set(msg, decision);
    return decision;
  }

  /** Feedback is persisted after commit and cannot itself start another agent turn. */
  routingNotice(msg, key, text) {
    this.post(msg.room_id, { authorKind: 'system', author: 'system', name: '投递反馈',
      text, clientKey: `route:${msg.id}:${key}` });
  }

  deliveryFailed(msg, memberId) {
    this.logger.warn('collab: route message=%s target=%s outcome=failed', msg.id, memberId);
    this.routingNotice(msg, `failed:${memberId}`, `消息 #${msg.id} 未能投递给 ${memberId}；连接不可用，请恢复后重新发送。`);
  }

  setMember(member) {
    this.members.set(member.id, member);
    this.emit({ type: 'members', members: this.memberView() });
  }

  removeMember(id) {
    if (!this.members.delete(id)) return;
    for (const room of this.thinking.keys()) this.setThinking(room, id, false);
    this.emit({ type: 'members', members: this.memberView() });
  }

  setOnline(id, online) {
    const m = this.members.get(id);
    if (m === undefined || m.online === online) return;
    m.online = online;
    if (!online) for (const room of this.thinking.keys()) this.setThinking(room, id, false);
    this.emit({ type: 'members', members: this.memberView() });
  }

  setError(id, error) {
    const member = this.members.get(id);
    if (member === undefined) return;
    member.error = error;
    this.emit({ type: 'members', members: this.memberView() });
  }

  setThinking(roomId, id, on) {
    if (on) this.setError(id, undefined);
    const set = this.thinking.get(roomId) ?? new Set();
    if (on === set.has(id)) return;
    if (on) set.add(id); else set.delete(id);
    this.thinking.set(roomId, set);
    this.emit({ type: 'thinking', room_id: roomId, members: [...set] });
  }

  memberView() {
    return this.memberList().map(({ id, name, kind, online, model, cli, persona, avatar, source, error }) => ({
      id, name, kind, online: online !== false && !error, ...(error ? { error } : {}), ...(avatar ? { avatar } : {}),
      ...(kind === 'dsh' ? { model: model ?? null, ...(cli ? { cli } : {}), persona: persona ?? '', editable: source === 'ui' } : {}),
    }));
  }

  /** Register an async consumer of newly created messages. */
  onMessage(listener) { this.listeners.push(listener); }

  /** Register a pure predicate for input handled as a control action, not chat. */
  onControlMessage(handles) { this.controlHandlers.push(handles); }

  /**
   * Register a planner run inside the append transaction (durable side
   * records such as jobs); it may return a continuation run after commit.
   */
  onPlan(planner) { this.planners.push(planner); }

  /**
   * Append and fan out. A repeated clientKey returns the stored row and
   * notifies nobody, so retries never trigger a second agent turn.
   */
  post(roomId, m) {
    const after = [];
    const result = this.store.transaction(() => {
      const r = this.store.append(roomId, m);
      if (r.created) for (const plan of this.planners) { const next = plan(r.message); if (next) after.push(next); }
      return r;
    });
    if (!result.created) return result;
    for (const next of after) {
      Promise.resolve().then(next).catch((error) => {
        this.logger.warn('collab: post-commit step failed: %s', error?.stack ?? error);
      });
    }
    this.emit({ type: 'message', message: publicMessage(result.message) });
    const decision = this.route(result.message);
    if (decision.error) this.routingNotice(result.message, 'decision', decision.error);
    for (const listener of this.listeners) {
      Promise.resolve().then(() => listener(result.message)).catch((error) => {
        this.logger.warn('collab: message listener failed: %s', error?.stack ?? error);
      });
    }
    return result;
  }

  /**
   * Streamed reply (#121): draft() stores and shows a row without telling
   * agents; commit() writes the complete text and then fans out exactly like
   * post() (planners, listeners), once per row (the durable draft flag, so a
   * restart cannot fan out twice), so teammates only ever see the final text. A repeated clientKey returns the existing draft.
   */
  draft(roomId, m) {
    const r = this.store.append(roomId, { ...m, draft: true });
    if (r.created) this.emit({ type: 'message', message: publicMessage(r.message) });
    return r;
  }

  commit(id, authorKind, author, text, fromTurn) {
    const after = [];
    const r = this.store.transaction(() => {
      const c = this.store.commit(id, authorKind, author, text, fromTurn);
      if (c?.first) for (const plan of this.planners) { const next = plan(c.message); if (next) after.push(next); }
      return c;
    });
    if (r === undefined) return undefined;
    const row = r.message;
    this.emit({ type: 'message', message: publicMessage(row) });
    if (!r.first) return row;
    const decision = this.route(row);
    if (decision.error) this.routingNotice(row, 'decision', decision.error);
    for (const next of after) {
      Promise.resolve().then(next).catch((error) => {
        this.logger.warn('collab: post-commit step failed: %s', error?.stack ?? error);
      });
    }
    for (const listener of this.listeners) {
      Promise.resolve().then(() => listener(row)).catch((error) => {
        this.logger.warn('collab: message listener failed: %s', error?.stack ?? error);
      });
    }
    return row;
  }

  /** Edit/delete a row the same author wrote, and tell browsers. */
  edit(id, authorKind, author, text, card) {
    const row = this.store.edit(id, authorKind, author, text, card);
    if (row !== undefined) this.emit({ type: 'message', message: publicMessage(row) });
    return row;
  }

  remove(id, authorKind, author) {
    const row = this.store.remove(id, authorKind, author);
    if (row !== undefined) this.emit({ type: 'deleted', id: row.id, room_id: row.room_id });
    return row;
  }

  /**
   * Drop text drafts an interrupted stream left behind (#121): all of the
   * author's, or only the one with clientKey. Committed rows are kept.
   */
  dropDrafts(authorKind, author, clientKey) {
    for (const d of this.store.drafts(authorKind, author)) {
      if (clientKey === undefined || d.client_key === clientKey) this.remove(d.id, authorKind, author);
    }
  }

  /** Browser event streams: subscriber(event) is called for every event. */
  subscribe(subscriber) {
    this.subscribers.add(subscriber);
    return () => this.subscribers.delete(subscriber);
  }

  emit(event) {
    for (const s of this.subscribers) {
      try { s(event); } catch (error) { this.logger.warn('collab: subscriber failed: %s', error?.message ?? error); }
    }
  }
}
