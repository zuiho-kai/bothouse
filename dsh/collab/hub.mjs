// Room hub: one place that appends a message and fans it out — to browser
// event streams, to connected cc-connect bots, and to DSH member drivers.
import { publicMessage } from './store.mjs';
import { mentions, nameCalled } from './mentions.mjs';

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
    this.maxRelay = 6;
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
    return this.memberList().map(({ id, name, kind, online, model, persona, source }) => ({
      id, name, kind, online: online !== false,
      ...(kind === 'dsh' ? { model: model ?? null, persona: persona ?? '', editable: source === 'ui' } : {}),
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
    let route = false;
    let capped = false;
    const result = this.store.transaction(() => {
      const r = this.store.append(roomId, m);
      if (r.created) {
        route = !this.store.control(roomId).stopped;
        const hit = mentions(r.message.text, this.routable());
        capped = route && r.message.author_kind === 'role' && r.message.card === null
          && this.routable().some(member => member.id !== r.message.author && (hit.has(member.id) || nameCalled(r.message.text, member.name)))
          && this.store.relayDepth(roomId, r.message.id) > this.maxRelay;
        if (capped) { this.store.blockRelay(roomId, r.message.id); route = false; }
        if (r.message.author_kind === 'user') this.store.clearBlocked(roomId);
      }
      if (r.created && route) for (const plan of this.planners) { const next = plan(r.message); if (next) after.push(next); }
      return r;
    });
    if (!result.created) return result;
    for (const next of after) {
      Promise.resolve().then(next).catch((error) => {
        this.logger.warn('collab: post-commit step failed: %s', error?.stack ?? error);
      });
    }
    this.emit({ type: 'message', message: publicMessage(result.message) });
    if (capped) this.post(roomId, {
      authorKind: 'system', author: 'system', name: 'system', clientKey: `relay-cap-${result.message.id}`,
      text: `Agent 之间已经连续接力 ${this.maxRelay} 次以上，暂停自动接力；点击继续或请人来 @。`,
      card: JSON.stringify({ type: 'relay_limit', room_id: roomId }),
    });
    if (route) for (const listener of this.listeners) {
      Promise.resolve().then(() => listener(result.message)).catch((error) => {
        this.logger.warn('collab: message listener failed: %s', error?.stack ?? error);
      });
    }
    return result;
  }

  /** Fence delayed dispatches before cancelling any running work. */
  stopRoom(roomId) {
    this.store.transaction(() => {
      const c = this.store.control(roomId);
      if (!c.stopped) this.store.writeControl({ ...c, stopped: 1, epoch: c.epoch + 1, cutoff: this.store.latestId(roomId) });
      this.store.clearBlocked(roomId);
    });
    this.emit({ type: 'room_control', ...this.store.control(roomId) });
  }

  canDispatch(message) {
    const c = this.store.control(message.room_id);
    return !c.stopped && message.id > c.cutoff;
  }

  /** Reset the budget and resume capped messages once, without duplicating history. */
  continueRoom(roomId) {
    const after = [];
    const messages = this.store.transaction(() => {
      const c = this.store.control(roomId);
      const blocked = this.store.blocked(roomId);
      if (!c.stopped && blocked.length === 0) return [];
      this.store.writeControl({ ...c, stopped: 0, relay_after: this.store.latestId(roomId) });
      this.store.clearBlocked(roomId);
      for (const message of blocked) for (const plan of this.planners) {
        const next = plan(message); if (next) after.push(next);
      }
      return blocked;
    });
    for (const next of after) Promise.resolve().then(next).catch(e => this.logger.warn('collab: continue failed: %s', e));
    for (const message of messages) for (const listener of this.listeners) {
      Promise.resolve().then(() => listener(message)).catch(e => this.logger.warn('collab: continue delivery failed: %s', e));
    }
    this.emit({ type: 'room_control', ...this.store.control(roomId) });
    return { room_id: roomId, resumed: messages.length, stopped: false };
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
