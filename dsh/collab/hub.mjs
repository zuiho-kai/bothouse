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
    /** #1020: room id -> member id -> ids of the owner's messages waiting behind that member's running turn. */
    this.queued = new Map();
    /** id -> optional busy fields published by the team-status reader (#876). */
    this.presence = new Map();
    this.listeners = [];
    this.planners = [];
    this.subscribers = new Set();
  }

  memberList() { return [...this.members.values()]; }

  membersInRoom(roomId) {
    // #1023: a private chat has the owner and its one agent, whatever that agent's channel list says.
    const dm = this.store.dmMember?.(roomId);
    if (dm !== undefined) return this.memberList().filter(m => m.kind === 'human' || m.id === dm);
    const channel = this.store.settingsRoom(roomId);
    return this.memberList().filter(m => !m.rooms?.length || m.rooms.includes(channel));
  }

  routableIn(roomId) { return this.membersInRoom(roomId).filter(m => m.kind !== 'human'); }

  /** Members whose @-forms are parsed in channel text (agents only; humans are not routed). */
  routable() { return this.memberList().filter(m => m.kind !== 'human'); }

  /** The explicitly selected primary role, or undefined before a choice. */
  selectedPrimaryMember() {
    const selected = this.leadState?.selected();
    const member = selected === undefined ? undefined : this.members.get(selected);
    return member !== undefined && member.kind !== 'human' ? member : undefined;
  }

  /** Channel primary for delegation; unset channels retain the selected global role. */
  primaryIn(roomId) {
    const dm = this.store.dmMember?.(roomId);
    if (dm !== undefined) return this.routableIn(roomId).find(m => m.id === dm);
    const id = this.store.leadId(roomId);
    const member = id === null ? this.selectedPrimaryMember() : this.members.get(id);
    return member && this.routableIn(roomId).some(m => m.id === member.id) ? member : undefined;
  }

  /** Default replies are channel-local and do not change delegation authority. */
  defaultReplyIn(roomId) {
    // #1023: in a private chat the one agent answers every owner message, @ or not.
    const dm = this.store.dmMember?.(roomId);
    if (dm !== undefined) return this.routableIn(roomId).find(m => m.id === dm);
    const id = this.store.leadId(roomId);
    const members = this.routableIn(roomId);
    if (id === null) return members.length === 1 ? members[0] : undefined;
    return members.find(member => member.id === id);
  }

  /** UI-only fallback; message routing uses defaultReplyIn(), delegation uses primaryIn(). */
  primaryMember() {
    const fallback = this.fallbackLead === '' ? undefined : this.members.get(this.fallbackLead);
    return this.selectedPrimaryMember() ?? (fallback?.kind !== 'human' ? fallback : undefined);
  }

  setMember(member) {
    if (member.avatar?.startsWith('upload:')) member.avatarVersion = Math.random().toString(36).slice(2);
    this.members.set(member.id, member);
    this.emit({ type: 'members', members: this.memberView() });
    // Membership determines an unset channel's effective primary, including its workspaces.
    this.emit({ type: 'rooms', rooms: this.store.roomsView() });
  }

  removeMember(id) {
    if (!this.members.delete(id)) return;
    this.presence.delete(id);
    for (const room of this.thinking.keys()) this.setThinking(room, id, false);
    for (const room of [...this.queued.keys()]) this.setQueue(room, id, []);
    this.emit({ type: 'members', members: this.memberView() });
    this.emit({ type: 'rooms', rooms: this.store.roomsView() });
  }

  setOnline(id, online) {
    const m = this.members.get(id);
    if (m === undefined || m.online === online) return;
    m.online = online;
    if (!online) {
      this.presence.delete(id);
      for (const room of this.thinking.keys()) this.setThinking(room, id, false);
      for (const room of [...this.queued.keys()]) this.setQueue(room, id, []);
    }
    this.emit({ type: 'members', members: this.memberView() });
  }

  /**
   * Publish optional busy fields on one member (#876). undefined clears them;
   * unchanged values do not emit, so a 2s poll never floods the SSE stream.
   */
  setPresence(id, presence) {
    if (!this.members.has(id)) return;
    const prev = this.presence.get(id);
    if (presence === undefined) {
      if (prev === undefined) return;
      this.presence.delete(id);
    } else {
      if (JSON.stringify(prev) === JSON.stringify(presence)) return;
      this.presence.set(id, presence);
    }
    this.emit({ type: 'members', members: this.memberView() });
  }

  setError(id, error) {
    const member = this.members.get(id);
    if (member === undefined) return;
    member.error = error;
    if (error !== undefined) this.presence.delete(id);
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

  /** #1020: replace the queue a member has in a room (ids in queue order; [] clears it). */
  setQueue(roomId, id, ids) {
    const room = this.queued.get(roomId) ?? new Map();
    const before = room.get(id) ?? [];
    if (before.length === ids.length && before.every((x, i) => x === ids[i])) return;
    if (ids.length) room.set(id, [...ids]); else room.delete(id);
    if (room.size) this.queued.set(roomId, room); else this.queued.delete(roomId);
    this.emit({ type: 'queue', room_id: roomId, queued: this.queueView(roomId) });
  }

  /** #1020: { member id: [message ids] } waiting in a room. */
  queueView(roomId) {
    return Object.fromEntries([...(this.queued.get(roomId) ?? new Map())]);
  }

  memberView() {
    return this.memberList().map(({ id, name, kind, online, model, cli, permissionPreset, persona, nameCustomized, avatar, avatarVersion, source, error, rooms }) => ({
      id, name, kind, ...(rooms ? { rooms } : {}), online: online !== false && !error, ...(error ? { error } : {}), ...(avatar ? { avatar, ...(avatarVersion ? { avatarVersion } : {}) } : {}),
      ...(kind === 'dsh' ? { model: model ?? null, ...(cli ? { cli, ...(permissionPreset ? { permissionPreset } : {}) } : {}), ...(nameCustomized === undefined ? {} : { nameCustomized }), persona: persona ?? '', editable: source === 'ui' } : {}),
      ...(this.presence.get(id) ?? {}),
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
    const explicit = mentions(msg.text, this.routableIn(msg.room_id));
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
    result.message = this.withMemories(result.message);
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

  commit(id, authorKind, author, text, fromTurn, attachments) {
    const after = [];
    const r = this.store.transaction(() => {
      const c = this.store.commit(id, authorKind, author, text, fromTurn, attachments);
      if (c?.first) for (const plan of this.planners) { const next = plan(c.message); if (next) after.push(next); }
      return c;
    });
    if (r === undefined) return undefined;
    const row = r.first ? this.withMemories(r.message) : r.message;
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

  /**
   * #1020: attach to a member's reply the memory entries it cited here since its last reply
   * (memory-sources.mjs). Command answers (from_turn 0), cards and drafts take none.
   */
  withMemories(row) {
    if (!this.memorySources || row?.author_kind !== 'role' || row.card != null || row.draft || row.from_turn === 0) return row;
    const voter = this.members.get(row.author)?.voter ?? `dsh:${row.author}`;
    let items;
    try { items = this.memorySources.take(voter, row.room_id); } catch (error) {
      this.logger.warn('collab: memory sources failed: %s', error?.message ?? error);
      return row;
    }
    return items.length ? (this.store.setMemories(row.id, items) ?? row) : row;
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
    if (event.type === 'rooms') event = { ...event, rooms: event.rooms.map(room => ({ ...room,
      lead_id: this.store.leadId(room.id), effective_lead_id: this.defaultReplyIn(room.id)?.id ?? null,
      workspace_path: this.store.workspacePath(room.id, this.workspacePath),
    })) };
    for (const s of this.subscribers) {
      try { s(event); } catch (error) { this.logger.warn('collab: subscriber failed: %s', error?.message ?? error); }
    }
  }
}
