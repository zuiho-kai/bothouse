// Channel facts for the collab plugin: rooms, messages, DSH session bindings,
// and DSH delivery jobs. One SQLite file; every write is a single statement or
// an explicit transaction, so a crash leaves either the old or the new row.
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export const MAX_TEXT = 128 * 1024;
// The human owner's member id. Written once here so the access predicate and the plugin
// cannot disagree about who bypasses room membership.
export const OWNER_ID = 'owner';
const SCHEMA_VERSION = 5;

export class Store {
  constructor(path) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
    const version = this.db.prepare('PRAGMA user_version').get().user_version;
    if (version > SCHEMA_VERSION) throw Error(`collab: store schema ${version} is newer than ${SCHEMA_VERSION}`);
    if (version < SCHEMA_VERSION) this.transaction(() => this.migrate(version));
    this.q = {
      control: this.db.prepare('SELECT * FROM room_controls WHERE room_id = ?'),
      controlWrite: this.db.prepare(`INSERT INTO room_controls (room_id, stopped, epoch, cutoff, relay_after)
        VALUES (?, ?, ?, ?, ?) ON CONFLICT(room_id) DO UPDATE SET stopped=excluded.stopped,
        epoch=excluded.epoch, cutoff=excluded.cutoff, relay_after=excluded.relay_after`),
      block: this.db.prepare('INSERT OR IGNORE INTO relay_blocked (room_id, message_id) VALUES (?, ?)'),
      blocked: this.db.prepare('SELECT message_id FROM relay_blocked WHERE room_id = ? ORDER BY message_id'),
      clearBlocked: this.db.prepare('DELETE FROM relay_blocked WHERE room_id = ?'),
      latest: this.db.prepare('SELECT COALESCE(MAX(id), 0) AS id FROM messages WHERE room_id = ?'),
      room: this.db.prepare('SELECT id, name FROM rooms WHERE id = ?'),
      rooms: this.db.prepare('SELECT id, name FROM rooms ORDER BY id'),
      ensureRoom: this.db.prepare('INSERT INTO rooms (id, name) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET name = excluded.name'),
      visibility: this.db.prepare('SELECT visibility FROM rooms WHERE id = ?'),
      setVisibility: this.db.prepare('UPDATE rooms SET visibility = ? WHERE id = ?'),
      isRoomMember: this.db.prepare('SELECT 1 AS ok FROM room_members WHERE room_id = ? AND member_id = ?'),
      roomMembers: this.db.prepare('SELECT member_id, role FROM room_members WHERE room_id = ? ORDER BY added_at'),
      addRoomMember: this.db.prepare(`INSERT INTO room_members (room_id, member_id, role, added_at)
        VALUES (?, ?, ?, ?) ON CONFLICT(room_id, member_id) DO UPDATE SET role = excluded.role`),
      removeRoomMember: this.db.prepare('DELETE FROM room_members WHERE room_id = ? AND member_id = ?'),
      // Public rooms plus the private ones this member is listed in; the owner enumerates all instead.
      roomsFor: this.db.prepare(`SELECT r.id, r.name FROM rooms r
        LEFT JOIN room_members m ON m.room_id = r.id AND m.member_id = ?
        WHERE r.visibility = 'public' OR m.member_id IS NOT NULL ORDER BY r.id`),
      insert: this.db.prepare(`INSERT INTO messages (room_id, author_kind, author, name, text, created_at, from_turn, card, client_key)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`),
      byKey: this.db.prepare('SELECT * FROM messages WHERE client_key = ?'),
      byId: this.db.prepare('SELECT * FROM messages WHERE id = ? AND deleted = 0'),
      edit: this.db.prepare('UPDATE messages SET text = ?, card = ? WHERE id = ? AND author_kind = ? AND author = ? AND deleted = 0 RETURNING *'),
      del: this.db.prepare('UPDATE messages SET deleted = 1 WHERE id = ? AND author_kind = ? AND author = ? AND deleted = 0 RETURNING *'),
      before: this.db.prepare('SELECT * FROM messages WHERE room_id = ? AND id < ? AND deleted = 0 ORDER BY id DESC LIMIT ?'),
      after: this.db.prepare('SELECT * FROM messages WHERE room_id = ? AND id > ? AND deleted = 0 ORDER BY id ASC LIMIT ?'),
      relay: this.db.prepare(`SELECT COUNT(*) AS n FROM messages WHERE room_id = ? AND id <= ? AND deleted = 0 AND author_kind = 'role'
        AND id > MAX(COALESCE((SELECT MAX(id) FROM messages WHERE room_id = ? AND id <= ? AND author_kind = 'user'), 0),
          COALESCE((SELECT relay_after FROM room_controls WHERE room_id = ?), 0))`),
      binding: this.db.prepare('SELECT session_id, context_cursor FROM bindings WHERE member_id = ? AND room_id = ?'),
      bind: this.db.prepare('INSERT INTO bindings (member_id, room_id, session_id, context_cursor) VALUES (?, ?, ?, 0)'),
      cursor: this.db.prepare('UPDATE bindings SET context_cursor = MAX(context_cursor, ?) WHERE member_id = ? AND room_id = ?'),
      addJob: this.db.prepare(`INSERT INTO jobs (member_id, room_id, trigger_id, state, created_at)
        VALUES (?, ?, ?, 'pending', ?) ON CONFLICT(member_id, trigger_id) DO NOTHING RETURNING *`),
      job: this.db.prepare('SELECT * FROM jobs WHERE id = ?'),
      openJobs: this.db.prepare("SELECT * FROM jobs WHERE state IN ('pending', 'sent') ORDER BY id"),
      sent: this.db.prepare("UPDATE jobs SET state = 'sent', session_id = ?, seq_before = ?, input_id = ? WHERE id = ? AND state = 'pending' RETURNING *"),
      finish: this.db.prepare("UPDATE jobs SET state = ?, reply_id = ? WHERE id = ? AND state IN ('pending', 'sent') RETURNING *"),
      createRoom: this.db.prepare('INSERT INTO rooms (name) VALUES (?) RETURNING id, name'),
      members: this.db.prepare('SELECT * FROM members WHERE removed = 0 ORDER BY created_at, id'),
      member: this.db.prepare('SELECT * FROM members WHERE id = ?'),
      seedMember: this.db.prepare(`INSERT INTO members (id, name, provider, model, persona, source, created_at, removed)
        VALUES (?, ?, ?, ?, ?, 'config', ?, 0)
        ON CONFLICT(id) DO UPDATE SET name = excluded.name, provider = excluded.provider, model = excluded.model,
          persona = excluded.persona, source = 'config', removed = 0`),
      addMember: this.db.prepare(`INSERT INTO members (id, name, provider, model, persona, source, created_at, removed)
        VALUES (?, ?, ?, ?, ?, 'ui', ?, 0) RETURNING *`),
      updateMember: this.db.prepare(`UPDATE members SET name = ?, provider = ?, model = ?, persona = ?
        WHERE id = ? AND source = 'ui' AND removed = 0 RETURNING *`),
      removeMember: this.db.prepare("UPDATE members SET removed = 1 WHERE id = ? AND source = 'ui' AND removed = 0 RETURNING *"),
    };
  }

  migrate(from) {
    if (from < 1) this.createV1();
    // v2: jobs remember the id of the input they admitted, to bind its consuming turn.
    if (from < 2) this.db.exec('ALTER TABLE jobs ADD COLUMN input_id TEXT');
    // v3: DSH members live in the database; config rows are seeds the UI cannot edit.
    // A removed member keeps its row (and id) so old messages and bindings stay attributable.
    if (from < 3) {
      this.db.exec(`CREATE TABLE members (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        provider TEXT,
        model TEXT,
        persona TEXT NOT NULL DEFAULT '',
        source TEXT NOT NULL CHECK (source IN ('config', 'ui')),
        created_at REAL NOT NULL,
        removed INTEGER NOT NULL DEFAULT 0)`);
    }
    if (from < 4) this.db.exec(`
      CREATE TABLE room_controls (
        room_id INTEGER PRIMARY KEY REFERENCES rooms(id), stopped INTEGER NOT NULL,
        epoch INTEGER NOT NULL, cutoff INTEGER NOT NULL, relay_after INTEGER NOT NULL);
      CREATE TABLE relay_blocked (
        room_id INTEGER NOT NULL REFERENCES rooms(id), message_id INTEGER NOT NULL REFERENCES messages(id),
        PRIMARY KEY (room_id, message_id));`);
    // v5: private threads. A room is 'public' until someone closes it; private rooms admit only
    // listed members (plus the human owner), for reads, writes and broadcasts alike.
    // Existing rooms stay public so upgrading does not lock anyone out of their history.
    if (from < 5) {
      this.db.exec(`ALTER TABLE rooms ADD COLUMN visibility TEXT NOT NULL DEFAULT 'public'
        CHECK (visibility IN ('public', 'private'))`);
      this.db.exec(`CREATE TABLE room_members (
        room_id INTEGER NOT NULL REFERENCES rooms(id),
        member_id TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'member')),
        added_at REAL NOT NULL,
        PRIMARY KEY (room_id, member_id));
        CREATE INDEX room_members_member ON room_members (member_id)`);
    }
    this.db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
  }

  createV1() {
    this.db.exec(`
      CREATE TABLE rooms (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
      CREATE TABLE messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        room_id INTEGER NOT NULL REFERENCES rooms(id),
        author_kind TEXT NOT NULL CHECK (author_kind IN ('user', 'role', 'system')),
        author TEXT NOT NULL,
        name TEXT NOT NULL,
        text TEXT NOT NULL,
        created_at REAL NOT NULL,
        from_turn INTEGER,
        card TEXT,
        client_key TEXT UNIQUE,
        deleted INTEGER NOT NULL DEFAULT 0);
      CREATE INDEX messages_room ON messages (room_id, id);
      CREATE TABLE bindings (
        member_id TEXT NOT NULL,
        room_id INTEGER NOT NULL REFERENCES rooms(id),
        session_id TEXT NOT NULL UNIQUE,
        context_cursor INTEGER NOT NULL,
        PRIMARY KEY (member_id, room_id));
      CREATE TABLE jobs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        member_id TEXT NOT NULL,
        room_id INTEGER NOT NULL REFERENCES rooms(id),
        trigger_id INTEGER NOT NULL REFERENCES messages(id),
        state TEXT NOT NULL CHECK (state IN ('pending', 'sent', 'done', 'failed', 'interrupted')),
        session_id TEXT,
        seq_before INTEGER,
        reply_id INTEGER,
        created_at REAL NOT NULL,
        UNIQUE (member_id, trigger_id));
      `);
  }

  close() { this.db.close(); }

  /** Run fn in one write transaction; a throw rolls back every statement it made. */
  transaction(fn) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  ensureRoom(id, name) { this.q.ensureRoom.run(id, name); }
  createRoom(name) { return this.q.createRoom.get(name); }

  /**
   * Who may see and write a room. One predicate for reads, writes and broadcasts so the
   * three paths cannot drift apart. The human owner always passes; unknown rooms never do.
   */
  canAccess(memberId, roomId) {
    if (typeof memberId !== 'string' || memberId === '') return false;
    if (memberId === OWNER_ID) return true;
    const room = this.q.visibility.get(roomId);
    if (room === undefined) return false;
    if (room.visibility === 'public') return true;
    return this.q.isRoomMember.get(roomId, memberId) !== undefined;
  }

  /** Rooms this member may see: every public room plus the private ones it is listed in. */
  roomsFor(memberId) {
    if (memberId === OWNER_ID) return this.q.rooms.all();
    return this.q.roomsFor.all(memberId);
  }

  visibility(roomId) { return this.q.visibility.get(roomId)?.visibility; }
  setVisibility(roomId, visibility) { this.q.setVisibility.run(visibility, roomId); }
  roomMembers(roomId) { return this.q.roomMembers.all(roomId); }
  addRoomMember(roomId, memberId, role = 'member', now = Date.now() / 1000) {
    this.q.addRoomMember.run(roomId, memberId, role, now);
  }
  removeRoomMember(roomId, memberId) { this.q.removeRoomMember.run(roomId, memberId); }

  /** Active DSH members, config seeds and UI-created alike. */
  members() { return this.q.members.all(); }
  member(id) { return this.q.member.get(id); }
  /** Upsert a config member; config always wins for its own ids. */
  seedMember(m, now = Date.now() / 1000) {
    this.q.seedMember.run(m.id, m.name, m.model?.provider ?? null, m.model?.model ?? null, m.persona ?? '', now);
  }
  addMember(m, now = Date.now() / 1000) {
    return this.q.addMember.get(m.id, m.name, m.model?.provider ?? null, m.model?.model ?? null, m.persona ?? '', now);
  }
  /** Edit a UI-created member; config members and removed ones are refused (undefined). */
  updateMember(id, m) {
    return this.q.updateMember.get(m.name, m.model?.provider ?? null, m.model?.model ?? null, m.persona ?? '', id);
  }
  removeMember(id) { return this.q.removeMember.get(id); }
  room(id) { return this.q.room.get(id); }
  rooms() { return this.q.rooms.all(); }

  /**
   * Append one message. A repeated non-null clientKey returns the stored row
   * with `created: false` instead of inserting twice.
   */
  append(roomId, m, now = Date.now() / 1000) {
    if (this.room(roomId) === undefined) throw new CollabError('room-missing', `room ${roomId} does not exist`);
    const text = String(m.text ?? '');
    if (!text.trim() && m.card == null) throw new CollabError('empty', 'message text is empty');
    if (text.length > MAX_TEXT) throw new CollabError('too-long', `message exceeds ${MAX_TEXT} characters`);
    if (m.clientKey != null) {
      const existing = this.q.byKey.get(m.clientKey);
      if (existing !== undefined) return { message: existing, created: false };
    }
    const row = this.q.insert.get(roomId, m.authorKind, m.author, m.name, text, now,
      m.fromTurn == null ? null : (m.fromTurn ? 1 : 0), m.card ?? null, m.clientKey ?? null);
    return { message: row, created: true };
  }

  message(id) { return this.q.byId.get(id); }
  /** Edit or delete only a row the same author wrote; returns the row or undefined. */
  edit(id, authorKind, author, text, card) { return this.q.edit.get(text, card ?? null, id, authorKind, author); }
  remove(id, authorKind, author) { return this.q.del.get(id, authorKind, author); }

  /** Up to `limit` messages before `beforeId` (exclusive), oldest first. */
  page(roomId, beforeId, limit) {
    return this.q.before.all(roomId, beforeId ?? Number.MAX_SAFE_INTEGER, clampLimit(limit)).reverse();
  }

  /** Up to `limit` messages after `afterId` (exclusive), oldest first. */
  since(roomId, afterId, limit) { return this.q.after.all(roomId, afterId ?? 0, clampLimit(limit)); }

  /** Agent messages posted since the last human message, up to and including messageId. */
  relayDepth(roomId, messageId) { return this.q.relay.get(roomId, messageId, roomId, messageId, roomId).n; }

  control(roomId) { return this.q.control.get(roomId) ?? { room_id: roomId, stopped: 0, epoch: 0, cutoff: 0, relay_after: 0 }; }
  writeControl(c) { this.q.controlWrite.run(c.room_id, c.stopped, c.epoch, c.cutoff, c.relay_after); }
  latestId(roomId) { return this.q.latest.get(roomId).id; }
  blockRelay(roomId, messageId) { this.q.block.run(roomId, messageId); }
  blocked(roomId) { return this.q.blocked.all(roomId).map(r => this.message(r.message_id)).filter(Boolean); }
  clearBlocked(roomId) { this.q.clearBlocked.run(roomId); }

  binding(memberId, roomId) { return this.q.binding.get(memberId, roomId); }
  bind(memberId, roomId, sessionId) { this.q.bind.run(memberId, roomId, sessionId); }
  advanceCursor(memberId, roomId, messageId) { this.q.cursor.run(messageId, memberId, roomId); }

  /** Create the job for (member, trigger) once; a repeat returns undefined. */
  addJob(memberId, roomId, triggerId, now = Date.now() / 1000) {
    return this.q.addJob.get(memberId, roomId, triggerId, now);
  }
  job(id) { return this.q.job.get(id); }
  openJobs() { return this.q.openJobs.all(); }
  /** Record admission before the prompt reaches the Agent; false if already moved on. */
  markSent(jobId, sessionId, seqBefore, inputId) { return this.q.sent.get(sessionId, seqBefore, inputId ?? null, jobId) !== undefined; }
  finishJob(jobId, state, replyId = null) { return this.q.finish.get(state, replyId, jobId) !== undefined; }
}

export class CollabError extends Error {
  constructor(code, message) { super(message); this.code = code; this.name = 'CollabError'; }
}

function clampLimit(limit) {
  const n = Number.parseInt(limit, 10);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 200) : 50;
}

/** Public JSON row for browsers and the cloud-web history endpoint (rh/hub.py field names). */
export function publicMessage(row) {
  return {
    id: row.id, room_id: row.room_id, author_kind: row.author_kind, author: row.author, name: row.name,
    text: row.text, created_at: row.created_at, card: row.card, from_turn: row.from_turn,
  };
}
