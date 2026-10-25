// Room hub: one place that appends a message and fans it out — to browser
// event streams, to connected cc-connect bots, and to DSH member drivers.
import { publicMessage } from './store.mjs';
import { mentions } from './mentions.mjs';

export class Hub {
  /**
   * @param store - Store instance.
   * @param logger - { warn(msg, ...args) }.
   */
  constructor(store, logger, leadState = undefined, fallbackLead = '') {
    this.store = store;
    this.logger = logger;
    this.leadState = leadState;
    this.fallbackLead = fallbackLead;
    /** id -> { id, name, kind: 'dsh' | 'bot' | 'human', mentionId?, online } */
    this.members = new Map();
    /** roomId -> Set<memberId> currently working */
    this.thinking = new Map();
    this.listeners = [];
    this.planners = [];
    this.subscribers = new Set();
  }

  memberList() { return [...this.members.values()]; }

  /** Members whose @-forms are parsed in channel text (agents only; humans are not routed). */
  routable() { return this.memberList().filter(m => m.kind !== 'human'); }

  /** The explicitly selected primary role, or undefined before a choice. */
  selectedPrimaryMember() {
    const selected = this.leadState?.selected();
    const member = selected === undefined ? undefined : this.members.get(selected);
    return member !== undefined && member.kind !== 'human' ? member : undefined;
  }

  /** UI-only fallback; callers that route messages must use selectedPrimaryMember(). */
  primaryMember() {
    const fallback = this.fallbackLead === '' ? undefined : this.members.get(this.fallbackLead);
    return this.selectedPrimaryMember() ?? (fallback?.kind !== 'human' ? fallback : undefined);
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
    return this.memberList().map(({ id, name, kind, online, model, cli, permissionPreset, persona, nameCustomized, avatar, source, error }) => ({
      id, name, kind, online: online !== false && !error, ...(error ? { error } : {}), ...(avatar ? { avatar } : {}),
      ...(kind === 'dsh' ? { model: model ?? null, ...(cli ? { cli, ...(permissionPreset ? { permissionPreset } : {}) } : {}), ...(nameCustomized === undefined ? {} : { nameCustomized }), persona: persona ?? '', editable: source === 'ui' } : {}),
    }));
  }

  /**
   * Who a human reply addresses, mirroring bridge/platform/discord/reply_routing.go:
   * null = not a reply to settle (normal @ rules apply); otherwise the only
   * member ids that may take it. With an explicit @, the @-ed members plus the
   * replied-to agent; without one, only the replied-to agent; a deleted
   * original names nobody (no guessing); a reply to a human keeps normal rules.
   */
  replyRoute(msg) {
    if (msg.reply_to == null || msg.author_kind !== 'user') return null;
    const ref = this.store.message(msg.reply_to);
    const refAgent = ref !== undefined && ref.room_id === msg.room_id && ref.author_kind === 'role' ? ref.author : undefined;
    const explicit = mentions(msg.text, this.routable());
    if (explicit.size > 0) return refAgent === undefined ? explicit : new Set([...explicit, refAgent]);
    if (ref === undefined || ref.room_id !== msg.room_id) return new Set();
    if (refAgent !== undefined) return new Set([refAgent]);
    return null;
  }

  /** Register an async consumer of newly created messages. */
  onMessage(listener) { this.listeners.push(listener); }

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
    this.emit({ type: 'message', message: publicMessage(result.message, this.store) });
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
    if (r.created) this.emit({ type: 'message', message: publicMessage(r.message, this.store) });
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
    this.emit({ type: 'message', message: publicMessage(row, this.store) });
    if (!r.first) return row;
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
    if (row !== undefined) this.emit({ type: 'message', message: publicMessage(row, this.store) });
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
