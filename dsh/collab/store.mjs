// Channel facts for the collab plugin: rooms, messages, DSH session bindings,
// and DSH delivery jobs. One SQLite file; every write is a single statement or
// an explicit transaction, so a crash leaves either the old or the new row.
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export const MAX_TEXT = 128 * 1024;
// Per chat channel dispatch mode (user 2026-10-24 01:25: 单模型多进程 / 完全团队 / 混合,
// 「默认混合模型」); the same names as the bridge's dispatch_mode config.
export const DISPATCH_MODES = ['solo', 'team', 'mixed'];
export const DEFAULT_DISPATCH_MODE = 'mixed';
// v7 is #133 (reply_to), v8 is #139 team mode A, v9 is #139 team mode B tasks, v10 is #177
// (room_settings.dispatch_explicit); columns are added by ensureSchema() on every open
// (checked with PRAGMA table_info), so either merge or release order ends with every column;
// user_version only records the newest schema known.
// v11 is #148 (edited_at).
const SCHEMA_VERSION = 11;
/** Columns added after v1, as [table, column, definition]; ensureSchema() adds any missing one. */
const COLUMNS = [
  ['jobs', 'input_id', 'TEXT'], // v2: jobs remember the id of the input they admitted, to bind its consuming turn.
  ['members', 'cli', 'TEXT'], // v4: a member may be a local CLI agent (claude | codex | gemini) instead of a model route.
  ['members', 'avatar', 'TEXT'], // v5: a member may show an avatar (built-in slug); NULL means the initial badge.
  // A local CLI member's DSH permission preset (cli-member.mjs PERMISSION_PRESETS); NULL means DSH's default.
  ['members', 'permission_preset', 'TEXT'],
  // v6 (#121): a streamed reply is stored as a draft (shown, not fanned out) until commit
  // clears the flag. Durable, so a restart between commit and finishJob never fans it out twice.
  ['messages', 'draft', 'INTEGER NOT NULL DEFAULT 0'],
  ['messages', 'reply_to', 'INTEGER'], // v7 (#133): the message a user reply quotes.
  // #144: JSON list of uploaded files ({id, name, mime, size}); bytes live under dataDir/attachments.
  ['messages', 'attachments', 'TEXT'],
  // v8 (#139 team mode A): a room is a chat channel or a workspace under one chat channel.
  ['rooms', 'kind', "TEXT NOT NULL DEFAULT 'chat' CHECK (kind IN ('chat', 'workspace'))"],
  ['rooms', 'parent_id', 'INTEGER REFERENCES rooms(id)'],
  // Team mode C (single owner, added on open like every column here): a workspace belongs to its parent_id chat channel until it
  // finishes its last task; free = 1 means released, any chat channel may claim it.
  ['rooms', 'free', 'INTEGER NOT NULL DEFAULT 0'],
  // The room's highest task id when its owner last claimed it; a claim no task followed
  // yet (the handoff is not worked on) keeps it owned when an earlier task ends (Tasks.releaseIfDone).
  ['rooms', 'claim_task', 'INTEGER'],
  // 1 = the bridge claimed it (cloudweb.mjs op claim/create): its lead is a bridge session, so
  // only the bridge's op release (lead reset) frees it, never Tasks.releaseIfDone.
  ['rooms', 'claim_bridge', 'INTEGER NOT NULL DEFAULT 0'],
  // Id of the current claim, bumped by every claim (claimWorkspace, createWorkspace): a release
  // naming an earlier claim (the bridge's late op release) is refused ('stale-claim').
  ['rooms', 'claim_seq', 'INTEGER NOT NULL DEFAULT 0'],
  ['messages', 'edited_at', 'REAL'], // v11 (#148): when the owner last edited their own message; NULL if never.
  // #597 G34: when a role last changed the row in place (a streamed draft growing, a progress card
  // edited, the draft committed); NULL if never. The task watch counts it as progress (Tasks.progressed).
  ['messages', 'changed_at', 'REAL'],
];
/** Workspace rooms are named 工作区<n> (setting added in #139 team mode A, not user-specified). */
export const WORKSPACE_PREFIX = '工作区';
// Workspaces take ids from their own range, starting at 1000000, so a configured chat
// channel added later (users write small ids like 1, 2) can never collide with one.
// PM-set floor, not user-specified; bot sessions are keyed room-<id> (cloudweb.mjs roomKey),
// so a workspace id must never change once a bot has used it.
export const WORKSPACE_ID_MIN = 1000000;
// Quote excerpt length, same as Discord history (bridge/platform/discord/discord.go:1645-1650).
export const QUOTE_CHARS = 40;

export class Store {
  constructor(path) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
    let version = this.db.prepare('PRAGMA user_version').get().user_version;
    if (version > SCHEMA_VERSION) throw Error(`collab: store schema ${version} is newer than ${SCHEMA_VERSION}`);
    this.ensureSchema(version);
    this.q = {
      room: this.db.prepare('SELECT id, name, kind, parent_id FROM rooms WHERE id = ?'),
      rooms: this.db.prepare('SELECT id, name, kind, parent_id FROM rooms ORDER BY id'),
      children: this.db.prepare("SELECT id, name FROM rooms WHERE kind = 'workspace' AND parent_id = ? ORDER BY id"),
      // A new workspace is claimed with no task yet (claim_task 0): its first task is the handoff.
      createWorkspace: this.db.prepare(`INSERT INTO rooms (id, name, kind, parent_id, claim_task, claim_bridge)
        SELECT MAX(${WORKSPACE_ID_MIN}, COALESCE((SELECT MAX(id) + 1 FROM rooms WHERE id >= ${WORKSPACE_ID_MIN}), ${WORKSPACE_ID_MIN})),
          ?, 'workspace', ?, 0, ? RETURNING id, name, kind, parent_id`),
      ensureRoom: this.db.prepare('INSERT INTO rooms (id, name) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET name = excluded.name'),
      insert: this.db.prepare(`INSERT INTO messages (room_id, author_kind, author, name, text, created_at, from_turn, card, client_key, draft, reply_to, attachments)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`),
      byKey: this.db.prepare('SELECT * FROM messages WHERE client_key = ?'),
      byId: this.db.prepare('SELECT * FROM messages WHERE id = ? AND deleted = 0'),
      edit: this.db.prepare('UPDATE messages SET text = ?, card = ?, changed_at = ? WHERE id = ? AND author_kind = ? AND author = ? AND deleted = 0 RETURNING *'),
      commit: this.db.prepare('UPDATE messages SET text = ?, from_turn = ?, draft = 0, changed_at = ? WHERE id = ? AND author_kind = ? AND author = ? AND deleted = 0 AND card IS NULL AND draft = 1 RETURNING *'),
      editUser: this.db.prepare(`UPDATE messages SET text = ?, edited_at = ? WHERE id = ? AND author_kind = 'user' AND author = ?
        AND deleted = 0 AND draft = 0 AND card IS NULL RETURNING *`),
      del: this.db.prepare('UPDATE messages SET deleted = 1 WHERE id = ? AND author_kind = ? AND author = ? AND deleted = 0 RETURNING *'),
      before: this.db.prepare('SELECT * FROM messages WHERE room_id = ? AND id < ? AND deleted = 0 ORDER BY id DESC LIMIT ?'),
      after: this.db.prepare('SELECT * FROM messages WHERE room_id = ? AND id > ? AND deleted = 0 ORDER BY id ASC LIMIT ?'),
      relay: this.db.prepare(`SELECT COUNT(*) AS n FROM messages WHERE room_id = ? AND id <= ? AND deleted = 0 AND author_kind = 'role' AND card IS NULL
        AND id > COALESCE((SELECT MAX(id) FROM messages WHERE room_id = ? AND id <= ? AND author_kind = 'user'), 0)`),
      binding: this.db.prepare('SELECT session_id, context_cursor FROM bindings WHERE member_id = ? AND room_id = ?'),
      // A fresh session starts reading after the room's last release (room_resets), not from its start.
      bind: this.db.prepare(`INSERT INTO bindings (member_id, room_id, session_id, context_cursor)
        VALUES (?, ?, ?, COALESCE((SELECT message_id FROM room_resets WHERE room_id = ?), 0))`),
      rebind: this.db.prepare('UPDATE bindings SET session_id = ? WHERE member_id = ? AND room_id = ?'),
      cursor: this.db.prepare('UPDATE bindings SET context_cursor = MAX(context_cursor, ?) WHERE member_id = ? AND room_id = ?'),
      firstDraft: this.db.prepare(`SELECT MIN(id) AS id FROM messages WHERE room_id = ? AND id <= ? AND author <> ?
        AND draft = 1 AND deleted = 0 AND card IS NULL`),
      authorDrafts: this.db.prepare(`SELECT * FROM messages WHERE author_kind = ? AND author = ?
        AND draft = 1 AND deleted = 0 AND card IS NULL ORDER BY id`),
      addJob: this.db.prepare(`INSERT INTO jobs (member_id, room_id, trigger_id, state, created_at)
        VALUES (?, ?, ?, 'pending', ?) ON CONFLICT(member_id, trigger_id) DO NOTHING RETURNING *`),
      job: this.db.prepare('SELECT * FROM jobs WHERE id = ?'),
      jobByTrigger: this.db.prepare('SELECT * FROM jobs WHERE member_id = ? AND trigger_id = ?'),
      resetJob: this.db.prepare("UPDATE jobs SET state = ?, created_at = ?, reply_id = NULL, session_id = NULL, seq_before = NULL, input_id = NULL WHERE id = ? RETURNING *"),
      lastUserMessage: this.db.prepare("SELECT * FROM messages WHERE room_id = ? AND id < ? AND author_kind = 'user' AND deleted = 0 ORDER BY id DESC LIMIT 1"),
      openJobs: this.db.prepare("SELECT * FROM jobs WHERE state IN ('pending', 'sent') ORDER BY id"),
      sent: this.db.prepare("UPDATE jobs SET state = 'sent', session_id = ?, seq_before = ?, input_id = ? WHERE id = ? AND state = 'pending' RETURNING *"),
      finish: this.db.prepare("UPDATE jobs SET state = ?, reply_id = ? WHERE id = ? AND state IN ('pending', 'sent') RETURNING *"),
      createRoom: this.db.prepare("INSERT INTO rooms (name, kind) VALUES (?, 'chat') RETURNING id, name, kind, parent_id"),
      members: this.db.prepare('SELECT * FROM members WHERE removed = 0 ORDER BY created_at, id'),
      member: this.db.prepare('SELECT * FROM members WHERE id = ?'),
      seedMember: this.db.prepare(`INSERT INTO members (id, name, provider, model, cli, persona, avatar, permission_preset, source, created_at, removed)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'config', ?, 0)
        ON CONFLICT(id) DO UPDATE SET name = excluded.name, provider = excluded.provider, model = excluded.model,
          cli = excluded.cli, persona = excluded.persona, avatar = excluded.avatar, permission_preset = excluded.permission_preset, source = 'config', removed = 0`),
      addMember: this.db.prepare(`INSERT INTO members (id, name, provider, model, cli, persona, avatar, permission_preset, source, created_at, removed)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ui', ?, 0) RETURNING *`),
      updateMember: this.db.prepare(`UPDATE members SET name = ?, provider = ?, model = ?, cli = ?, persona = ?, avatar = ?, permission_preset = ?
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
      const added = new Set();
      for (const [table, column, definition] of COLUMNS) {
        if (!has.has(table)) has.set(table, new Set(this.db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name)));
        if (!has.get(table).has(column)) {
          this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
          added.add(`${table}.${column}`);
        }
      }
      this.migrateWorkspaceIds();
      this.dedupeWorkspaceNames();
      // v9: the tasks table (#139 team mode B), ensured idempotently like the columns above.
      this.ensureTasks();
      // Team mode C upgrade: before it a workspace's parent_id only named the last chat channel
      // that handed off, never cleared. A workspace with no task in work then is done: put it in
      // the pool, else it would belong to that channel forever (no task left to release it).
      if (added.has('rooms.free')) {
        this.db.exec(`UPDATE rooms SET free = 1 WHERE kind = 'workspace' AND NOT EXISTS (SELECT 1 FROM tasks
          WHERE tasks.room_id = rooms.id AND status IN ('assigned', 'accepted', 'asked', 'rework'))`);
      }
      // Team mode C: where a released workspace's fresh sessions start reading (releaseWorkspace).
      this.db.exec(`CREATE TABLE IF NOT EXISTS room_resets (
        room_id INTEGER PRIMARY KEY REFERENCES rooms(id) ON DELETE CASCADE,
        message_id INTEGER NOT NULL)`);
      this.db.exec(`CREATE TABLE IF NOT EXISTS room_settings (
        room_id INTEGER PRIMARY KEY REFERENCES rooms(id) ON DELETE CASCADE,
        dispatch_mode TEXT NOT NULL DEFAULT '${DEFAULT_DISPATCH_MODE}'
          CHECK (dispatch_mode IN (${DISPATCH_MODES.map(m => `'${m}'`).join(', ')})))`);
      const settingColumns = this.db.prepare('PRAGMA table_info(room_settings)').all();
      if (!settingColumns.some(c => c.name === 'dispatch_explicit')) {
        this.db.exec('ALTER TABLE room_settings ADD COLUMN dispatch_explicit INTEGER NOT NULL DEFAULT 0');
        // Old mixed rows were also generated by reads, so they are not explicit choices.
        this.db.exec("UPDATE room_settings SET dispatch_explicit = 1 WHERE dispatch_mode <> 'mixed'");
      }
      this.db.exec('DROP TABLE IF EXISTS collab_settings');
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
        remind_msg_id INTEGER,
        reason TEXT,
        paused_at REAL,
        paused_chat INTEGER,
        source TEXT,
        ref TEXT,
        base TEXT,
        renewals INTEGER NOT NULL DEFAULT 0)`);
    } else {
      const cols = new Set(this.db.prepare('PRAGMA table_info(tasks)').all().map(c => c.name));
      for (const [name, type] of [['parent_task', 'INTEGER'], ['next_check_at', 'REAL'], ['result_msg_id', 'INTEGER'],
        ['assign_msg_id', 'INTEGER'], ['note', 'TEXT'], ['returned_at', 'REAL'], ['remind_msg_id', 'INTEGER'], ['reason', 'TEXT'], ['paused_at', 'REAL'], ['paused_chat', 'INTEGER'], ['source', 'TEXT'], ['ref', 'TEXT'], ['base', 'TEXT'], ['renewals', 'INTEGER NOT NULL DEFAULT 0']]) {
        if (!cols.has(name)) this.db.exec(`ALTER TABLE tasks ADD COLUMN ${name} ${type}`);
      }
      // #574 B2 upgrade: workspace tasks in work with no check time start their 10-minute watch
      // now (tasks.mjs CHECK_AFTER_S), not from their last change, so an upgrade parks none at once.
      if (!cols.has('renewals')) {
        this.db.prepare(`UPDATE tasks SET next_check_at = ? WHERE next_check_at IS NULL AND paused_at IS NULL
          AND status IN ('assigned', 'accepted', 'asked', 'rework') AND room_id IN (SELECT id FROM rooms WHERE kind = 'workspace')`)
          .run(Date.now() / 1000 + 10 * 60);
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

  /**
   * Before the shared pool each chat channel numbered its own 工作区1..n, so two chat
   * channels can both have a 「工作区1」. Workspace numbers are now unique across the server:
   * the oldest room keeps its name, every later duplicate becomes 工作区(max+1). Idempotent.
   */
  dedupeWorkspaceNames() {
    const re = new RegExp(`^${WORKSPACE_PREFIX}(\\d+)$`);
    const all = this.db.prepare("SELECT id, name FROM rooms WHERE kind = 'workspace' ORDER BY id").all();
    let top = Math.max(0, ...all.map(w => Number(re.exec(w.name)?.[1] ?? 0)));
    const seen = new Set();
    const rename = this.db.prepare('UPDATE rooms SET name = ? WHERE id = ?');
    for (const w of all) {
      if (!re.test(w.name)) continue;
      if (!seen.has(w.name)) { seen.add(w.name); continue; }
      top += 1;
      rename.run(`${WORKSPACE_PREFIX}${top}`, w.id);
    }
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
  /** Create a chat channel; its first workspace is made on the first createWorkspace() call. */
  createRoom(name) {
    const room = this.transaction(() => this.q.createRoom.get(name));
    this.ensureRoomSettings(room.id);
    return room;
  }
  /**
   * Give a chat channel its next workspace: the lowest-numbered free 工作区<k> of the shared
   * pool (released by any chat channel after its last task) if there is one, else a new
   * 工作区<n+1>, n being the highest existing 工作区<k> of any chat channel (one shared pool,
   * unique numbers). Called on a workspace, it works for that workspace's chat channel.
   */
  createWorkspace(roomId, { bridge = false } = {}) {
    return this.transaction(() => {
      const room = this.q.room.get(roomId);
      if (room === undefined) throw new CollabError('room-missing', `room ${roomId} does not exist`);
      const parent = room.kind === 'workspace' ? room.parent_id : room.id;
      const re = new RegExp(`^${WORKSPACE_PREFIX}(\\d+)$`);
      // One shared pool: numbers are unique across every chat channel's workspaces.
      const all = this.db.prepare("SELECT id, name, free FROM rooms WHERE kind = 'workspace'").all();
      const num = w => Number(re.exec(w.name)?.[1] ?? 0);
      const free = all.filter(w => w.free && num(w) > 0 && this.activeTasks(w.id) === 0).sort((a, b) => num(a) - num(b))[0];
      if (free !== undefined) {
        return this.db.prepare(`UPDATE rooms SET parent_id = ?, free = 0, claim_bridge = ?, claim_seq = claim_seq + 1,
          claim_task = (SELECT COALESCE(MAX(id), 0) FROM tasks WHERE room_id = ?) WHERE id = ? RETURNING id, name, kind, parent_id`)
          .get(parent, bridge ? 1 : 0, free.id, free.id);
      }
      const n = Math.max(0, ...all.map(num));
      return this.q.createWorkspace.get(`${WORKSPACE_PREFIX}${n + 1}`, parent, bridge ? 1 : 0);
    });
  }

  /**
   * Record chatId as the owner of workspace workspaceId, so the unified exit (team-exit.mjs,
   * by rooms.parent_id) sends its asks and reports there. A workspace belongs to one chat
   * channel at a time: one another chat channel owns (not free) is refused with
   * 'workspace-owned' until it is released after its last task (releaseWorkspace).
   * chatId may be a workspace (then its chat channel is used). bridge: the claim comes from the
   * bridge (cloudweb.mjs), whose lead session the bridge releases itself. handoff: the task this
   * claim is for when it already exists (a paused task resumed, Tasks.resumeClaim), so handoffDone
   * waits for that task instead of one dispatched later. Returns the workspace room.
   */
  claimWorkspace(chatId, workspaceId, { bridge = false, handoff = null } = {}) {
    return this.transaction(() => {
      const chat = this.q.room.get(chatId);
      const ws = this.q.room.get(workspaceId);
      if (chat === undefined || ws === undefined) throw new CollabError('room-missing', `room ${chat === undefined ? chatId : workspaceId} does not exist`);
      if (ws.kind !== 'workspace') throw new CollabError('not-workspace', `room ${workspaceId} is not a workspace`);
      const parent = chat.kind === 'workspace' ? chat.parent_id : chat.id;
      const owner = this.workspaceOwner(ws.id);
      if (owner != null && owner !== parent) {
        throw new CollabError('workspace-owned', `workspace ${ws.name} belongs to room ${owner} until it finishes its last task`);
      }
      return this.db.prepare(`UPDATE rooms SET parent_id = ?, free = 0, claim_bridge = ?, claim_seq = claim_seq + 1,
        claim_task = COALESCE(?, (SELECT COALESCE(MAX(id), 0) FROM tasks WHERE room_id = ?)) WHERE id = ? RETURNING id, name, kind, parent_id`)
        .get(parent, bridge ? 1 : 0, handoff == null ? null : Number(handoff) - 1, ws.id, ws.id);
    });
  }

  /** The id of workspace roomId's current claim (claim_seq), named by the bridge's op release. */
  claimId(roomId) {
    return String(this.db.prepare('SELECT claim_seq FROM rooms WHERE id = ?').get(roomId)?.claim_seq ?? 0);
  }

  /** The chat channel that owns workspace roomId now; null = free (released) or no owner. */
  workspaceOwner(roomId) {
    const r = this.db.prepare('SELECT parent_id, free FROM rooms WHERE id = ?').get(roomId);
    return r === undefined || r.free ? null : r.parent_id;
  }

  /**
   * True once the handoff of the current claim of workspace roomId is finished: the first task
   * dispatched there after the claim (the work the chat channel handed off; later ones are its
   * subtasks) is handed back or done. False while no task followed the claim yet, and for a
   * bridge claim (its handoff is the bridge lead's work, no task here). A claim from before
   * claim_task existed has no recorded handoff: true.
   */
  handoffDone(roomId) {
    const r = this.db.prepare('SELECT claim_task, claim_bridge FROM rooms WHERE id = ?').get(roomId);
    if (r === undefined || r.claim_bridge) return false;
    if (r.claim_task == null) return true;
    const handoff = this.db.prepare('SELECT status FROM tasks WHERE room_id = ? AND id > ? ORDER BY id LIMIT 1').get(roomId, r.claim_task);
    return handoff !== undefined && (handoff.status === 'returned' || handoff.status === 'done');
  }

  /**
   * True while workspace roomId is held by a bridge claim: the bridge's handoff watch checks it
   * (core/team_watch.go), so the task watch here leaves it alone (one watcher per handoff).
   */
  bridgeClaimed(roomId) {
    return Boolean(this.db.prepare('SELECT claim_bridge FROM rooms WHERE id = ?').get(roomId)?.claim_bridge);
  }

  /** Tasks in work in roomId (same statuses as tasks.mjs WORKING; paused ones do not count). */
  activeTasks(roomId) {
    return this.db.prepare(`SELECT COUNT(*) AS n FROM tasks WHERE room_id = ?
      AND status IN ('assigned', 'accepted', 'asked', 'rework') AND paused_at IS NULL`).get(roomId).n;
  }

  /**
   * Release workspace roomId after its last task: it goes back to the pool (free) for any chat
   * channel, and its sessions are cleared (bindings dropped; fresh ones start reading after the
   * room's last message, room_resets). Refused with 'busy' while tasks are in work there.
   * Returns false if roomId is no owned workspace (already free, or a chat channel). claim (from
   * the bridge's op release): the claim being ended; refused with 'stale-claim' once the
   * workspace was claimed again, so a late release never frees the new claim. null = any claim.
   */
  releaseWorkspace(roomId, claim = null) {
    return this.transaction(() => {
      const ws = this.q.room.get(roomId);
      if (ws === undefined) throw new CollabError('room-missing', `room ${roomId} does not exist`);
      if (ws.kind !== 'workspace' || this.workspaceOwner(ws.id) == null) return false;
      if (claim != null && String(claim) !== this.claimId(ws.id)) {
        throw new CollabError('stale-claim', `workspace ${ws.name} was claimed again since claim ${claim}`);
      }
      if (this.activeTasks(ws.id) > 0) throw new CollabError('busy', `workspace ${ws.name} has tasks in work`);
      this.db.prepare('UPDATE rooms SET free = 1, claim_task = NULL, claim_bridge = 0 WHERE id = ?').run(ws.id);
      this.db.prepare('DELETE FROM bindings WHERE room_id = ?').run(ws.id);
      const last = this.db.prepare('SELECT MAX(id) AS id FROM messages WHERE room_id = ?').get(ws.id).id ?? 0;
      this.db.prepare(`INSERT INTO room_resets (room_id, message_id) VALUES (?, ?)
        ON CONFLICT (room_id) DO UPDATE SET message_id = excluded.message_id`).run(ws.id, last);
      return true;
    });
  }

  ensureRoomSettings(roomId) {
    this.db.prepare('INSERT OR IGNORE INTO room_settings (room_id) VALUES (?)').run(roomId);
  }

  /** The chat channel whose setting a room uses: a workspace's parent (needs rooms.parent_id), else itself. */
  settingsRoom(roomId) {
    if (!this.db.prepare('PRAGMA table_info(rooms)').all().some(c => c.name === 'parent_id')) return roomId;
    const parent = this.db.prepare('SELECT parent_id FROM rooms WHERE id = ?').get(roomId)?.parent_id;
    return parent == null || parent === roomId ? roomId : parent;
  }

  /** Dispatch mode of a room; a workspace inherits its chat channel's (PR #138 review 6). */
  dispatchMode(roomId) {
    roomId = this.settingsRoom(roomId);
    this.ensureRoomSettings(roomId);
    return this.db.prepare('SELECT dispatch_mode FROM room_settings WHERE room_id = ?').get(roomId).dispatch_mode;
  }

  dispatchSetting(roomId) {
    roomId = this.settingsRoom(roomId);
    this.ensureRoomSettings(roomId);
    const row = this.db.prepare('SELECT dispatch_mode, dispatch_explicit FROM room_settings WHERE room_id = ?').get(roomId);
    return { dispatch_mode: row.dispatch_mode, dispatch_explicit: Boolean(row.dispatch_explicit) };
  }

  setDispatchMode(roomId, mode) {
    if (!DISPATCH_MODES.includes(mode)) throw new CollabError('invalid', `dispatch mode must be ${DISPATCH_MODES.join(', ')}`);
    roomId = this.settingsRoom(roomId); // set on a workspace = set on its chat channel
    this.ensureRoomSettings(roomId);
    this.db.prepare('UPDATE room_settings SET dispatch_mode = ?, dispatch_explicit = 1 WHERE room_id = ?').run(mode, roomId);
    return mode;
  }

  /** Active DSH members, config seeds and UI-created alike. */
  members() { return this.q.members.all(); }
  member(id) { return this.q.member.get(id); }
  /** Upsert a config member; config always wins for its own ids. */
  seedMember(m, now = Date.now() / 1000) {
    this.q.seedMember.run(m.id, m.name, m.model?.provider ?? null, m.model?.model ?? null, m.cli ?? null, m.persona ?? '', m.avatar || null, m.permissionPreset ?? null, now);
  }
  addMember(m, now = Date.now() / 1000) {
    return this.q.addMember.get(m.id, m.name, m.model?.provider ?? null, m.model?.model ?? null, m.cli ?? null, m.persona ?? '', m.avatar || null, m.permissionPreset ?? null, now);
  }
  /** Edit a UI-created member; config members and removed ones are refused (undefined). */
  updateMember(id, m) {
    return this.q.updateMember.get(m.name, m.model?.provider ?? null, m.model?.model ?? null, m.cli ?? null, m.persona ?? '', m.avatar || null, m.permissionPreset ?? null, id);
  }
  removeMember(id) { return this.q.removeMember.get(id); }
  room(id) { return this.q.room.get(id); }
  rooms() { return this.q.rooms.all(); }
  /** Rooms for clients: each carries kind, parent_id and its open task count. */
  roomsView() {
    const counts = new Map(this.db.prepare(`SELECT room_id, COUNT(*) AS n FROM tasks
      WHERE status IN ('assigned', 'accepted', 'asked', 'rework') GROUP BY room_id`).all().map(t => [t.room_id, t.n]));
    return this.rooms().map(r => ({ ...r, active: counts.get(r.id) ?? 0, ...this.dispatchSetting(r.id) }));
  }

  /**
   * Append one message. A repeated non-null clientKey returns the stored row
   * with `created: false` instead of inserting twice.
   */
  append(roomId, m, now = Date.now() / 1000) {
    if (this.room(roomId) === undefined) throw new CollabError('room-missing', `room ${roomId} does not exist`);
    const text = String(m.text ?? '');
    const attachments = Array.isArray(m.attachments) && m.attachments.length ? m.attachments : null;
    if (!text.trim() && m.card == null && attachments === null) throw new CollabError('empty', 'message text is empty');
    if (text.length > MAX_TEXT) throw new CollabError('too-long', `message exceeds ${MAX_TEXT} characters`);
    if (m.clientKey != null) {
      const existing = this.q.byKey.get(m.clientKey);
      if (existing !== undefined) return { message: existing, created: false };
    }
    let replyTo = null;
    if (m.replyTo != null) {
      const ref = this.message(Number(m.replyTo));
      // Only a live message of the same room can be quoted; anything else would leak or dangle.
      if (ref === undefined || ref.room_id !== roomId) throw new CollabError('reply-missing', 'the message being replied to does not exist');
      replyTo = ref.id;
    }
    const row = this.q.insert.get(roomId, m.authorKind, m.author, m.name, text, now,
      m.fromTurn == null ? null : (m.fromTurn ? 1 : 0), m.card ?? null, m.clientKey ?? null, m.draft ? 1 : 0, replyTo,
      attachments === null ? null : JSON.stringify(attachments));
    return { message: row, created: true };
  }

  message(id) { return this.q.byId.get(id); }

  /**
   * What a reply quotes: undefined for a plain message; `{ id, deleted: true }`
   * when the original is gone (no author or text leaks); else id, author, and
   * a QUOTE_CHARS excerpt.
   */
  quote(row) {
    if (row.reply_to == null) return undefined;
    const ref = this.message(row.reply_to);
    if (ref === undefined || ref.room_id !== row.room_id) return { id: row.reply_to, deleted: true };
    const chars = [...ref.text];
    const text = chars.length > QUOTE_CHARS ? chars.slice(0, QUOTE_CHARS).join('') + '…' : ref.text;
    return { id: ref.id, author_kind: ref.author_kind, author: ref.author, name: ref.name, text };
  }
  /** Edit or delete only a row the same author wrote; returns the row or undefined. */
  /** #144: {id, name, mime, size} of a stored attachment, or undefined when no live message carries it. */
  attachmentMeta(id) {
    const row = this.db.prepare("SELECT attachments FROM messages WHERE deleted = 0 AND attachments LIKE ? LIMIT 1").get(`%"${id}"%`);
    return messageAttachments(row).find(a => a.id === id);
  }

  edit(id, authorKind, author, text, card, now = Date.now() / 1000) { return this.q.edit.get(text, card ?? null, now, id, authorKind, author); }
  /**
   * Finish a streamed draft row with its complete text (#121). Returns
   * { message, first }: first is true only when this call turned the draft
   * into a reply (the caller fans out once). A row already committed gets the
   * text and first = false. undefined if it is not that author's live text row.
   */
  commit(id, authorKind, author, text, fromTurn, now = Date.now() / 1000) {
    if (!text.trim() || text.length > MAX_TEXT) return undefined;
    const row = this.q.commit.get(text, fromTurn == null ? null : (fromTurn ? 1 : 0), now, id, authorKind, author);
    if (row !== undefined) return { message: row, first: true };
    const old = this.message(id);
    if (old === undefined || old.card != null) return undefined;
    const again = this.edit(id, authorKind, author, text, undefined, now);
    return again === undefined ? undefined : { message: again, first: false };
  }
  /** #148: a person edits their own plain message; returns the row, or undefined if it is not theirs. */
  editUser(id, author, text, now = Date.now() / 1000) {
    text = String(text ?? '');
    if (!text.trim()) throw new CollabError('empty', 'message text is empty');
    if (text.length > MAX_TEXT) throw new CollabError('too-long', `message exceeds ${MAX_TEXT} characters`);
    return this.q.editUser.get(text, now, id, author);
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
  bind(memberId, roomId, sessionId) { this.q.bind.run(memberId, roomId, sessionId, roomId); }
  /** Point an existing binding at a new Session; the context cursor stays. */
  rebind(memberId, roomId, sessionId) { this.q.rebind.run(sessionId, memberId, roomId); }
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
  jobByTrigger(memberId, triggerId) {
    return this.q.jobByTrigger.get(memberId, triggerId);
  }
  retryJob(memberId, roomId, triggerId, now = Date.now() / 1000) {
    const existing = this.jobByTrigger(memberId, triggerId);
    if (existing !== undefined) {
      return this.q.resetJob.get('pending', now, existing.id);
    }
    return this.addJob(memberId, roomId, triggerId, now);
  }
  lastUserMessage(roomId, beforeId) {
    return this.q.lastUserMessage.get(roomId, beforeId);
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

/**
 * Public JSON row for browsers and the cloud-web history endpoint (rh/hub.py field names).
 * With a store, a reply carries `reply_to` = store.quote(row).
 */
export function publicMessage(row, store) {
  const out = {
    id: row.id, room_id: row.room_id, author_kind: row.author_kind, author: row.author, name: row.name,
    text: row.text, created_at: row.created_at, card: row.card, from_turn: row.from_turn,
    ...(row.edited_at != null ? { edited_at: row.edited_at } : {}),
  };
  const quote = store?.quote(row);
  if (quote !== undefined) out.reply_to = quote;
  const attachments = messageAttachments(row);
  if (attachments.length) out.attachments = attachments;
  return out;
}

/** #144: the uploaded files a message carries ([] when none or unreadable). */
export function messageAttachments(row) {
  if (!row?.attachments) return [];
  try { const list = JSON.parse(row.attachments); return Array.isArray(list) ? list : []; } catch { return []; }
}

/** Discord-style quote prefix for agent prompts: `[回复 作者：前40字…] ` (discord.go:1645-1650). */
export function quotePrefix(quote) {
  if (quote === undefined) return '';
  if (quote.deleted) return '[回复 原消息已删除] ';
  return `[回复 ${quote.name}：${quote.text}] `;
}
