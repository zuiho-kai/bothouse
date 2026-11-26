'use strict';
// Conversation branches (checkpoints) of the App conversation, stored in the local
// SocialStore database (schema version 5; version 6 adds the group speaker columns). A branch is a full copy of one conversation up to
// and including a chosen message, kept under its own scope; the index below groups the
// branches of one root conversation. Mixed into SocialStore, and usable only by a store
// constructed with `branches:true` - the QQ companion database never has these tables.
//
// Memory facts are not copied: they stay on the root scope and are shared by every branch.
// Correcting or forgetting one therefore drops the derived conversation of the root AND of
// every branch in the same transaction (see discardDerived in social-continuity-store.cjs).
const invalid = (message, reason) => Object.assign(Error(message), {code: 'social_invalid_input', ...(reason ? {reason} : {})});
const ID = /^[0-9a-f]{16}$/;
const MAX_BRANCHES = 30, NAME_CHARS = 60, MAX_REGISTERED = 400;
const TABLES = ['messages', 'scoped_notes', 'scope_state', 'facts', 'actions', 'followups', 'public_journal'];

function initializeBranches(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS branches (root TEXT NOT NULL,id TEXT NOT NULL,scope TEXT NOT NULL UNIQUE,name TEXT NOT NULL,parent TEXT,forked_from TEXT NOT NULL,created_at INTEGER NOT NULL,PRIMARY KEY(root,id));
    CREATE TABLE IF NOT EXISTS conversation_scopes (scope TEXT PRIMARY KEY);`);
}
const branchId = value => { if (typeof value !== 'string' || !ID.test(value)) throw invalid('Invalid branch identifier.'); return value; };
function branchName(value) {
  if (typeof value !== 'string' || /[\x00-\x1f\x7f]/.test(value) || !value.trim() || value.trim().length > NAME_CHARS) throw invalid('Invalid branch name.');
  return value.trim();
}
const record = row => ({id: row.id, name: row.name, parentBranchId: row.parent ?? null, forkedFromMessageId: row.forked_from, createdAt: row.created_at, messages: row.messages});
const SELECT = 'SELECT b.id,b.name,b.parent,b.forked_from,b.created_at,b.scope,(SELECT count(*) FROM messages WHERE scope=b.scope) AS messages FROM branches b';
const missing = () => invalid('The branch was not found.', 'branch_not_found');
function enabled(store) { if (!store.branchesEnabled) throw invalid('Conversation branches are not enabled for this store.'); }
function erase(db, key) {
  for (const table of TABLES) db.prepare(`DELETE FROM ${table} WHERE scope=?`).run(key);
  db.prepare('DELETE FROM scopes WHERE id=?').run(key);
}

const branchMethods = {
  // Marks a scope as a character conversation so idle-slot reclaim never takes it. This does
  // not create the scope or use one of the store's scope slots.
  registerConversation(scope) {
    enabled(this); const key = this.scope(scope);
    return this.withDb(db => {
      if (db.prepare('SELECT count(*) AS count FROM conversation_scopes').get().count >= MAX_REGISTERED)
        db.prepare('DELETE FROM conversation_scopes WHERE scope NOT IN (SELECT id FROM scopes) AND scope NOT IN (SELECT root FROM branches)').run();
      db.prepare('INSERT OR IGNORE INTO conversation_scopes(scope) VALUES(?)').run(key);
      return true;
    });
  },
  branches(rootScope) {
    enabled(this); const root = this.scope(rootScope);
    return this.withDb(db => db.prepare(`${SELECT} WHERE b.root=? ORDER BY b.created_at,b.rowid`).all(root).map(record));
  },
  branch(rootScope, id) {
    enabled(this); const root = this.scope(rootScope); branchId(id);
    return this.withDb(db => { const row = db.prepare(`${SELECT} WHERE b.root=? AND b.id=?`).get(root, id); return row ? record(row) : null; });
  },
  /**
   * Copies `sourceScope` (the root conversation when `parentId` is null, else that branch) up to
   * and including `messageId` - rows with their alternatives and edit marks, plus the lorebook
   * timing state as it is now - into the new `scope`, and records the branch under `rootScope`.
   */
  createBranch(rootScope, {id, scope, sourceScope, parentId = null, messageId, name} = {}) {
    enabled(this);
    const root = this.scope(rootScope), target = this.scope(scope), source = this.scope(sourceScope);
    branchId(id); if (parentId !== null) branchId(parentId); const label = branchName(name);
    if (typeof messageId !== 'string' || !messageId || messageId.length > 180) throw invalid('Invalid message identifier.');
    if (target === root || target === source) throw invalid('A branch needs its own scope.');
    return this.withDb(db => {
      const parent = parentId === null ? null : db.prepare('SELECT scope FROM branches WHERE root=? AND id=?').get(root, parentId);
      if (parentId === null ? source !== root : parent?.scope !== source) throw missing();
      const at = db.prepare('SELECT rowid,at FROM messages WHERE scope=? AND id=?').get(source, messageId);
      if (!at) throw invalid('The message was not found.', 'message_not_found');
      if (db.prepare('SELECT 1 FROM branches WHERE (root=? AND id=?) OR scope=?').get(root, id, target)) throw invalid('This branch already exists.');
      if (db.prepare('SELECT count(*) AS count FROM branches WHERE root=?').get(root).count >= MAX_BRANCHES) throw invalid(`A conversation holds at most ${MAX_BRANCHES} branches. Remove one first.`, 'branch_limit');
      this.ensureScope(db, target);
      db.prepare('INSERT INTO messages(scope,id,role,text,at,swipes,swipe_index,edited_at,speaker,speaker_name,greeting_chars,drawing_sha,drawing_request_key,drawing_kind,drawing_credit) SELECT ?,id,role,text,at,swipes,swipe_index,edited_at,speaker,speaker_name,greeting_chars,drawing_sha,drawing_request_key,drawing_kind,drawing_credit FROM messages WHERE scope=? AND (at<? OR (at=? AND rowid<=?)) ORDER BY at,rowid').run(target, source, at.at, at.at, at.rowid);
      const state = db.prepare('SELECT world_info FROM scope_state WHERE scope=?').get(source);
      if (state) db.prepare('INSERT OR REPLACE INTO scope_state(scope,world_info) VALUES(?,?)').run(target, state.world_info);
      db.prepare('INSERT INTO branches(root,id,scope,name,parent,forked_from,created_at) VALUES(?,?,?,?,?,?,?)').run(root, id, target, label, parentId, messageId, this.now());
      db.prepare('INSERT OR IGNORE INTO conversation_scopes(scope) VALUES(?)').run(root);
      return record(db.prepare(`${SELECT} WHERE b.root=? AND b.id=?`).get(root, id));
    });
  },
  renameBranch(rootScope, id, name) {
    enabled(this); const root = this.scope(rootScope); branchId(id); const label = branchName(name);
    return this.withDb(db => {
      if (!db.prepare('UPDATE branches SET name=? WHERE root=? AND id=?').run(label, root, id).changes) throw missing();
      return record(db.prepare(`${SELECT} WHERE b.root=? AND b.id=?`).get(root, id));
    });
  },
  // Erases the branch's own copy. Its children are complete copies too, so they are kept and
  // re-parented to the removed branch's parent.
  removeBranch(rootScope, id) {
    enabled(this); const root = this.scope(rootScope); branchId(id);
    return this.withDb(db => {
      const row = db.prepare('SELECT scope,parent FROM branches WHERE root=? AND id=?').get(root, id);
      if (!row) throw missing();
      db.prepare('UPDATE branches SET parent=? WHERE root=? AND parent=?').run(row.parent ?? null, root, id);
      erase(db, row.scope);
      db.prepare('DELETE FROM branches WHERE root=? AND id=?').run(root, id);
      return {removed: true};
    });
  },
  // Every branch of a root conversation, and the root's registration.
  removeBranches(rootScope) {
    enabled(this); const root = this.scope(rootScope);
    return this.withDb(db => {
      const rows = db.prepare('SELECT scope FROM branches WHERE root=?').all(root);
      for (const row of rows) erase(db, row.scope);
      db.prepare('DELETE FROM branches WHERE root=?').run(root);
      db.prepare('DELETE FROM conversation_scopes WHERE scope=?').run(root);
      return {removed: rows.length};
    });
  },
};

module.exports = {initializeBranches, branchMethods, MAX_BRANCHES, NAME_CHARS};
