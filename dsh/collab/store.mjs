// Channel facts for the collab plugin: rooms, messages, DSH session bindings,
// and DSH delivery jobs. One SQLite file; every write is a single statement or
// an explicit transaction, so a crash leaves either the old or the new row.
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export const MAX_TEXT = 128 * 1024;
// v7 is #133 (reply_to), v8 is #139 team mode A, v9 is #139 team mode B tasks; columns are
// added by ensureSchema() on every open (checked with PRAGMA table_info), so either merge
// or release order ends with every column; user_version only records the newest schema known.
const SCHEMA_VERSION = 9;
/** Columns added after v1, as [table, column, definition]; ensureSchema() adds any missing one. */
const COLUMNS = [
  ['jobs', 'input_id', 'TEXT'], // v2: jobs remember the id of the input they admitted, to bind its consuming turn.
  ['members', 'cli', 'TEXT'], // v4: a member may be a local CLI agent (claude | codex | gemini) instead of a model route.
  ['members', 'avatar', 'TEXT'], // v5: a member may show an avatar (built-in slug); NULL means the initial badge.
  // v6 (#121): a streamed reply is stored as a draft (shown, not fanned out) until commit
  // clears the flag. Durable, so a restart between commit and finishJob never fans it out twice.
  ['messages', 'draft', 'INTEGER NOT NULL DEFAULT 0'],
  ['messages', 'reply_to', 'INTEGER'], // v7 (#133): the message a user reply quotes.
  // v8 (#139 team mode A): a room is a chat channel or a workspace under one chat channel.
  ['rooms', 'kind', "TEXT NOT NULL DEFAULT 'chat' CHECK (kind IN ('chat', 'workspace'))"],
  ['rooms', 'parent_id', 'INTEGER REFERENCES rooms(id)'],
];
/** Workspace rooms are named 工作区<n> (setting added in #139 team mode A, not user-specified). */
export const WORKSPACE_PREFIX = '工作区';
// Workspaces take ids from their own range, starting at 1000000, so a configured chat
// channel added later (users write small ids like 1, 2) can never collide with one.
// PM-set floor, not user-specified; bot sessions are keyed room-<id> (cloudweb.mjs roomKey),
// so a workspace id must never change once a bot has used it.
export const WORKSPACE_ID_MIN = 1000000;

export class Store {
  constructor(path) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
    const version = this.db.prepare('PRAGMA user_version').get().user_version;
    if (version > SCHEMA_VERSION) throw Error(`collab: store schema ${version} is newer than ${SCHEMA_VERSION}`);
    this.ensureSchema(version);
    this.q = {
      room: this.db.prepare('SELECT id, name, kind, parent_id FROM rooms WHERE id = ?'),
      rooms: this.db.prepare('SELECT id, name, kind, parent_id FROM rooms ORDER BY id'),
      children: this.db.prepare("SELECT id, name FROM rooms WHERE kind = 'workspace' AND parent_id = ? ORDER BY id"),
      createWorkspace: this.db.prepare(`INSERT INTO rooms (id, name, kind, parent_id)
        SELECT MAX(${WORKSPACE_ID_MIN}, COALESCE((SELECT MAX(id) + 1 FROM rooms WHERE id >= ${WORKSPACE_ID_MIN}), ${WORKSPACE_ID_MIN})),
          ?, 'workspace', ? RETURNING id, name, kind, parent_id`),
      ensureRoom: this.db.prepare('INSERT INTO rooms (id, name) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET name = excluded.name'),
      insert: this.db.prepare(`INSERT INTO messages (room_id, author_kind, author, name, text, created_at, from_turn, card, client_key, draft)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`),
      byKey: this.db.prepare('SELECT * FROM messages WHERE client_key = ?'),
      byId: this.db.prepare('SELECT * FROM messages WHERE id = ? AND deleted = 0'),
      edit: this.db.prepare('UPDATE messages SET text = ?, card = ? WHERE id = ? AND author_kind = ? AND author = ? AND deleted = 0 RETURNING *'),
      commit: this.db.prepare('UPDATE messages SET text = ?, from_turn = ?, draft = 0 WHERE id = ? AND author_kind = ? AND author = ? AND deleted = 0 AND card IS NULL AND draft = 1 RETURNING *'),
      del: this.db.prepare('UPDATE messages SET deleted = 1 WHERE id = ? AND author_kind = ? AND author = ? AND deleted = 0 RETURNING *'),
      before: this.db.prepare('SELECT * FROM messages WHERE room_id = ? AND id < ? AND deleted = 0 ORDER BY id DESC LIMIT ?'),
      after: this.db.prepare('SELECT * FROM messages WHERE room_id = ? AND id > ? AND deleted = 0 ORDER BY id ASC LIMIT ?'),
      relay: this.db.prepare(`SELECT COUNT(*) AS n FROM messages WHERE room_id = ? AND id <= ? AND deleted = 0 AND author_kind = 'role'
        AND id > COALESCE((SELECT MAX(id) FROM messages WHERE room_id = ? AND id <= ? AND author_kind = 'user'), 0)`),
      binding: this.db.prepare('SELECT session_id, context_cursor FROM bindings WHERE member_id = ? AND room_id = ?'),
      bind: this.db.prepare('INSERT INTO bindings (member_id, room_id, session_id, context_cursor) VALUES (?, ?, ?, 0)'),
      cursor: this.db.prepare('UPDATE bindings SET context_cursor = MAX(context_cursor, ?) WHERE member_id = ? AND room_id = ?'),
      firstDraft: this.db.prepare(`SELECT MIN(id) AS id FROM messages WHERE room_id = ? AND id <= ? AND author <> ?
        AND draft = 1 AND deleted = 0 AND card IS NULL`),
      authorDrafts: this.db.prepare(`SELECT * FROM messages WHERE author_kind = ? AND author = ?
        AND draft = 1 AND deleted = 0 AND card IS NULL ORDER BY id`),
      addJob: this.db.prepare(`INSERT INTO jobs (member_id, room_id, trigger_id, state, created_at)
        VALUES (?, ?, ?, 'pending', ?) ON CONFLICT(member_id, trigger_id) DO NOTHING RETURNING *`),
      job: this.db.prepare('SELECT * FROM jobs WHERE id = ?'),
      openJobs: this.db.prepare("SELECT * FROM jobs WHERE state IN ('pending', 'sent') ORDER BY id"),
      sent: this.db.prepare("UPDATE jobs SET state = 'sent', session_id = ?, seq_before = ?, input_id = ? WHERE id = ? AND state = 'pending' RETURNING *"),
      finish: this.db.prepare("UPDATE jobs SET state = ?, reply_id = ? WHERE id = ? AND state IN ('pending', 'sent') RETURNING *"),
      createRoom: this.db.prepare("INSERT INTO rooms (name, kind) VALUES (?, 'chat') RETURNING id, name, kind, parent_id"),
      members: this.db.prepare('SELECT * FROM members WHERE removed = 0 ORDER BY created_at, id'),
      member: this.db.prepare('SELECT * FROM members WHERE id = ?'),
      seedMember: this.db.prepare(`INSERT INTO members (id, name, provider, model, cli, persona, avatar, source, created_at, removed)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'config', ?, 0)
        ON CONFLICT(id) DO UPDATE SET name = excluded.name, provider = excluded.provider, model = excluded.model,
          cli = excluded.cli, persona = excluded.persona, avatar = excluded.avatar, source = 'config', removed = 0`),
      addMember: this.db.prepare(`INSERT INTO members (id, name, provider, model, cli, persona, avatar, source, created_at, removed)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'ui', ?, 0) RETURNING *`),
      updateMember: this.db.prepare(`UPDATE members SET name = ?, provider = ?, model = ?, cli = ?, persona = ?, avatar = ?
        WHERE id = ? AND source = 'ui' AND removed = 0 RETURNING *`),
      removeMember: this.db.prepare("UPDATE members SET removed = 1 WHERE id = ? AND source = 'ui' AND removed = 0 RETURNING *"),
    };
  }

  /**
   * Bring any older database up to date. Idempotent and run on every open: tables and
   * columns are created only when missing, so the version number never gates a column.
   */
  ensureSchema(version) {
    this.transaction(() => {
      if (version < 1) this.createV1();
      // v3: DSH members live in the database; config rows are seeds the UI cannot edit.
      // A removed member keeps its row (and id) so old messages and bindings stay attributable.
      this.db.exec(`CREATE TABLE IF NOT EXISTS members (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        provider TEXT,
        model TEXT,
        persona TEXT NOT NULL DEFAULT '',
        source TEXT NOT NULL CHECK (source IN ('config', 'ui')),
        created_at REAL NOT NULL,
        removed INTEGER NOT NULL DEFAULT 0)`);
      const has = new Map();
      for (const [table, column, definition] of COLUMNS) {
        if (!has.has(table)) has.set(table, new Set(this.db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name)));
        if (!has.get(table).has(column)) this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
      }
      // v8: every chat channel that has no workspace gets 「工作区1」.
      this.migrateWorkspaceIds();
      this.fillWorkspaces();
      // v9: the tasks table (#139 team mode B), ensured idempotently like the columns above.
      this.ensureTasks();
      if (version < SCHEMA_VERSION) this.db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
    });
  }

  /**
   * v9 (#139 team mode B): one row per dispatched task. Idempotent: creates the
   * table if missing and adds any column an older copy lacks, so it is safe to run
   * on every open regardless of user_version.
   */
  ensureTasks() {
    const exists = this.db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'tasks'").get() !== undefined;
    if (!exists) {
      this.db.exec(`CREATE TABLE tasks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        room_id INTEGER NOT NULL REFERENCES rooms(id),
        parent_task INTEGER REFERENCES tasks(id),
        title TEXT NOT NULL,
        owner TEXT NOT NULL,
        created_by TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('assigned', 'accepted', 'asked', 'declined', 'escalated', 'returned', 'done', 'rework')),
        next_check_at REAL,
        result_msg_id INTEGER,
        assign_msg_id INTEGER,
        note TEXT,
        created_at REAL NOT NULL,
        updated_at REAL NOT NULL,
        returned_at REAL,
        remind_msg_id INTEGER)`);
    } else {
      const cols = new Set(this.db.prepare('PRAGMA table_info(tasks)').all().map(c => c.name));
      for (const [name, type] of [['parent_task', 'INTEGER'], ['next_check_at', 'REAL'], ['result_msg_id', 'INTEGER'],
        ['assign_msg_id', 'INTEGER'], ['note', 'TEXT'], ['returned_at', 'REAL'], ['remind_msg_id', 'INTEGER']]) {
        if (!cols.has(name)) this.db.exec(`ALTER TABLE tasks ADD COLUMN ${name} ${type}`);
      }
    }
    this.db.exec('CREATE INDEX IF NOT EXISTS tasks_room ON tasks (room_id, id)');
  }

  /**
   * Move workspaces still on the old shared sequence (id < WORKSPACE_ID_MIN) into the
   * workspace range, repointing their messages, bindings and jobs. This exists only for
   * unreleased dev databases from before the separate range: no bot session has used
   * them yet, and it is the only place a room id is ever changed. Released databases
   * never hit this (no workspace was ever shipped on the shared sequence).
   */
  migrateWorkspaceIds() {
    const old = this.db.prepare(`SELECT id FROM rooms WHERE kind = 'workspace' AND id < ? ORDER BY id`).all(WORKSPACE_ID_MIN);
    if (!old.length) return;
    const next = this.db.prepare(`SELECT MAX(?, COALESCE((SELECT MAX(id) + 1 FROM rooms WHERE id >= ?), ?)) AS id`)
      .get(WORKSPACE_ID_MIN, WORKSPACE_ID_MIN, WORKSPACE_ID_MIN).id;
    for (const [i, { id }] of old.entries()) {
      const to = next + i;
      const cols = this.db.prepare('PRAGMA table_info(rooms)').all().map(c => c.name).filter(c => c !== 'id');
      this.db.prepare(`INSERT INTO rooms (id, ${cols}) SELECT ?, ${cols} FROM rooms WHERE id = ?`).run(to, id);
      for (const table of ['messages', 'bindings', 'jobs']) this.db.prepare(`UPDATE ${table} SET room_id = ? WHERE room_id = ?`).run(to, id);
      this.db.prepare('UPDATE rooms SET parent_id = ? WHERE parent_id = ?').run(to, id);
      this.db.prepare('DELETE FROM rooms WHERE id = ?').run(id);
    }
  }

  /** Give every chat channel without a workspace its 「工作区1」; returns the rooms created. */
  fillWorkspaces() {
    const orphans = this.db.prepare(`SELECT id FROM rooms r WHERE kind = 'chat'
      AND NOT EXISTS (SELECT 1 FROM rooms w WHERE w.kind = 'workspace' AND w.parent_id = r.id) ORDER BY id`).all();
    if (!orphans.length) return [];
    // Own statement: ensureSchema() runs before the shared prepared statements exist.
    const add = this.db.prepare(`INSERT INTO rooms (id, name, kind, parent_id)
      SELECT MAX(${WORKSPACE_ID_MIN}, COALESCE((SELECT MAX(id) + 1 FROM rooms WHERE id >= ${WORKSPACE_ID_MIN}), ${WORKSPACE_ID_MIN})),
        ?, 'workspace', ? RETURNING id, name, kind, parent_id`);
    return orphans.map(({ id }) => add.get(`${WORKSPACE_PREFIX}1`, id));
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
        UNIQUE (member_id, trigger_id));`);
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

  /**
   * Upsert a configured chat channel. Config ids are user-written small numbers; workspaces
   * live at WORKSPACE_ID_MIN and up, so a config id can only be a workspace if the database
   * predates that range or someone configured an id inside it. Refuse loudly instead of
   * moving the workspace: bot sessions are keyed room-<id> and must never see it change.
   */
  ensureRoom(id, name) {
    this.transaction(() => {
      if (this.q.room.get(id)?.kind === 'workspace') {
        throw new CollabError('workspace-id-conflict',
          `config room id ${id} collides with workspace room ${id}; workspace ids start at ${WORKSPACE_ID_MIN} and cannot be reassigned`);
      }
      this.q.ensureRoom.run(id, name);
    });
  }
  /** Give configured chat channels their 「工作区1」 (call after every ensureRoom). */
  ensureWorkspaces() { return this.transaction(() => this.fillWorkspaces()); }
  /** Create a chat channel together with its 「工作区1」. */
  createRoom(name) {
    return this.transaction(() => {
      const room = this.q.createRoom.get(name);
      const workspace = this.q.createWorkspace.get(`${WORKSPACE_PREFIX}1`, room.id);
      return { room, workspace };
    });
  }
  /**
   * Create the next workspace 工作区<n+1> under a chat channel, n being the highest
   * existing 工作区<k>. Called on a workspace, it adds a sibling under the same chat channel.
   */
  createWorkspace(roomId) {
    return this.transaction(() => {
      const room = this.q.room.get(roomId);
      if (room === undefined) throw new CollabError('room-missing', `room ${roomId} does not exist`);
      const parent = room.kind === 'workspace' ? room.parent_id : room.id;
      const re = new RegExp(`^${WORKSPACE_PREFIX}(\\d+)$`);
      const n = Math.max(0, ...this.q.children.all(parent).map(w => Number(re.exec(w.name)?.[1] ?? 0)));
      return this.q.createWorkspace.get(`${WORKSPACE_PREFIX}${n + 1}`, parent);
    });
  }

  /** Active DSH members, config seeds and UI-created alike. */
  members() { return this.q.members.all(); }
  member(id) { return this.q.member.get(id); }
  /** Upsert a config member; config always wins for its own ids. */
  seedMember(m, now = Date.now() / 1000) {
    this.q.seedMember.run(m.id, m.name, m.model?.provider ?? null, m.model?.model ?? null, m.cli ?? null, m.persona ?? '', m.avatar || null, now);
  }
  addMember(m, now = Date.now() / 1000) {
    return this.q.addMember.get(m.id, m.name, m.model?.provider ?? null, m.model?.model ?? null, m.cli ?? null, m.persona ?? '', m.avatar || null, now);
  }
  /** Edit a UI-created member; config members and removed ones are refused (undefined). */
  updateMember(id, m) {
    return this.q.updateMember.get(m.name, m.model?.provider ?? null, m.model?.model ?? null, m.cli ?? null, m.persona ?? '', m.avatar || null, id);
  }
  removeMember(id) { return this.q.removeMember.get(id); }
  room(id) { return this.q.room.get(id); }
  rooms() { return this.q.rooms.all(); }
  /** Rooms for clients: each carries kind, parent_id and its open task count. */
  roomsView() {
    // active: tasks in progress in this room; 0 until team mode B fills it from its tasks table (B 块填).
    return this.rooms().map(r => ({ ...r, active: 0 }));
  }

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
      m.fromTurn == null ? null : (m.fromTurn ? 1 : 0), m.card ?? null, m.clientKey ?? null, m.draft ? 1 : 0);
    return { message: row, created: true };
  }

  message(id) { return this.q.byId.get(id); }
  /** Edit or delete only a row the same author wrote; returns the row or undefined. */
  edit(id, authorKind, author, text, card) { return this.q.edit.get(text, card ?? null, id, authorKind, author); }
  /**
   * Finish a streamed draft row with its complete text (#121). Returns
   * { message, first }: first is true only when this call turned the draft
   * into a reply (the caller fans out once). A row already committed gets the
   * text and first = false. undefined if it is not that author's live text row.
   */
  commit(id, authorKind, author, text, fromTurn) {
    if (!text.trim() || text.length > MAX_TEXT) return undefined;
    const row = this.q.commit.get(text, fromTurn == null ? null : (fromTurn ? 1 : 0), id, authorKind, author);
    if (row !== undefined) return { message: row, first: true };
    const old = this.message(id);
    if (old === undefined || old.card != null) return undefined;
    const again = this.edit(id, authorKind, author, text);
    return again === undefined ? undefined : { message: again, first: false };
  }
  remove(id, authorKind, author) { return this.q.del.get(id, authorKind, author); }
  /** One author's live text drafts (#121), oldest first. */
  drafts(authorKind, author) { return this.q.authorDrafts.all(authorKind, author); }

  /** Up to `limit` messages before `beforeId` (exclusive), oldest first. */
  page(roomId, beforeId, limit) {
    return this.q.before.all(roomId, beforeId ?? Number.MAX_SAFE_INTEGER, clampLimit(limit)).reverse();
  }

  /** Up to `limit` messages after `afterId` (exclusive), oldest first. */
  since(roomId, afterId, limit) { return this.q.after.all(roomId, afterId ?? 0, clampLimit(limit)); }

  /** Agent messages posted since the last human message, up to and including messageId. */
  relayDepth(roomId, messageId) { return this.q.relay.get(roomId, messageId, roomId, messageId).n; }

  binding(memberId, roomId) { return this.q.binding.get(memberId, roomId); }
  bind(memberId, roomId, sessionId) { this.q.bind.run(memberId, roomId, sessionId); }
  /**
   * Move a member's context cursor up to messageId, but never past a
   * teammate's uncommitted text draft (#121): it keeps its old id when it
   * commits, so a cursor beyond it would hide the final reply for good.
   */
  advanceCursor(memberId, roomId, messageId) {
    const draft = this.q.firstDraft.get(roomId, messageId, memberId).id;
    this.q.cursor.run(draft == null ? messageId : Math.min(messageId, draft - 1), memberId, roomId);
  }

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
