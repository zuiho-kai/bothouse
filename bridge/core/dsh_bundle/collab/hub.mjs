// Room hub: one place that appends a message and fans it out — to browser
// event streams, to connected cc-connect bots, and to DSH member drivers.
import { publicMessage } from './store.mjs';

export class Hub {
  /**
   * @param store - Store instance.
   * @param logger - { warn(msg, ...args) }.
   */
  constructor(store, logger) {
    this.store = store;
    this.logger = logger;
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

  setThinking(roomId, id, on) {
    const set = this.thinking.get(roomId) ?? new Set();
    if (on === set.has(id)) return;
    if (on) set.add(id); else set.delete(id);
    this.thinking.set(roomId, set);
    this.emit({ type: 'thinking', room_id: roomId, members: [...set] });
  }

  memberView() {
    return this.memberList().map(({ id, name, kind, online, model, cli, persona, source }) => ({
      id, name, kind, online: online !== false,
      ...(kind === 'dsh' ? { model: model ?? null, ...(cli ? { cli } : {}), persona: persona ?? '', editable: source === 'ui' } : {}),
    }));
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
    this.emit({ type: 'message', message: publicMessage(result.message) });
    for (const listener of this.listeners) {
      Promise.resolve().then(() => listener(result.message)).catch((error) => {
        this.logger.warn('collab: message listener failed: %s', error?.stack ?? error);
      });
    }
    return result;
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
