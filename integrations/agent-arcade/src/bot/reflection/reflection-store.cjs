'use strict';
// Reflection state of one profile: per-character switch and hour, rule candidates with their
// verified evidence, the owner's approved rules, and the run journal. A candidate becomes a rule
// only through decide(id, 'approve'), which the owner triggers; the rule text is what the owner
// approved (their own wording when they changed it). One small SQLite file; a short transaction
// per call and no connection kept open. This file holds no bothouse code.
const fs = require('node:fs');
const path = require('node:path');
const {randomUUID} = require('node:crypto');
const {normalise, KINDS, DRAFT_CHARS, MAX_EVIDENCE} = require('./reflection-verify.cjs');

const SCHEMA_VERSION = 1;
const LIMITS = Object.freeze({rules: 20, ruleChars: 1500, ruleText: 200, open: 100, rejected: 200, decided: 200, runs: 400, characters: 200, list: 100});
const CHARACTER = /^[a-z0-9][a-z0-9-]{0,63}$/;
const DAY = /^\d{4}-\d\d-\d\d$/;
const OUTCOMES = new Set(['ok', 'no_new_messages', 'invalid_output', 'runner_failed', 'unavailable', 'cancelled', 'failed']);
const fail = code => Object.assign(new Error(`Reflection refused this operation (${code}).`), {code});
const character = value => { if (typeof value !== 'string' || !CHARACTER.test(value)) throw fail('reflection_invalid_request'); return value; };
const ruleText = value => {
  if (typeof value !== 'string' || /[\x00-\x1f\x7f]/.test(value) || !value.trim() || value.trim().length > LIMITS.ruleText) throw fail('reflection_rule_invalid');
  return value.trim();
};
function candidateOf(row) {
  let evidence = [];
  try { const parsed = JSON.parse(row.evidence); if (Array.isArray(parsed)) evidence = parsed.filter(item => item && typeof item.messageId === 'string' && typeof item.quote === 'string' && typeof item.day === 'string').map(item => ({messageId: item.messageId, quote: item.quote, day: item.day, ...groupEvidence(item)})); } catch { evidence = []; }
  return {id: row.id, characterId: row.character_id, kind: row.kind, ruleDraft: row.rule_draft, state: row.state, evidence, count: row.count, ruleId: row.rule_id, createdAt: row.created_at, updatedAt: row.updated_at, decidedAt: row.decided_at};
}
function groupEvidence(item) {
  return typeof item.speaker === 'string' && /^[a-f0-9]{16}$/.test(item.speaker) &&
    Number.isSafeInteger(item.at) && item.at >= 0 ? {speaker: item.speaker, at: item.at} : {};
}

const ruleOf = row => ({id: row.id, characterId: row.character_id, text: row.text, enabled: row.enabled === 1, createdAt: row.created_at, updatedAt: row.updated_at});

class ReflectionStore {
  #scopedConnection = null;

  /** @param {{file: string, now?: () => number, loadSqlite?: Function, groupState?: boolean}} options file: absolute path of the SQLite file */
  constructor({file, now = Date.now, loadSqlite = () => require('node:sqlite'), groupState = false} = {}) {
    if (typeof file !== 'string' || !path.isAbsolute(file)) throw fail('reflection_unavailable');
    Object.assign(this, {file, now, groupState});
    try {
      this.DatabaseSync = loadSqlite().DatabaseSync;
      fs.mkdirSync(path.dirname(file), {recursive: true});
      this.#db(db => {
        if (db.prepare('PRAGMA user_version').get().user_version > SCHEMA_VERSION) throw fail('reflection_unavailable');
        db.exec(`CREATE TABLE IF NOT EXISTS settings (character_id TEXT PRIMARY KEY, enabled INTEGER NOT NULL, hour INTEGER NOT NULL, cursor_at INTEGER,
            last_run_at INTEGER, last_outcome TEXT, last_read INTEGER, updated_at INTEGER NOT NULL);
          CREATE TABLE IF NOT EXISTS candidates (id TEXT PRIMARY KEY, character_id TEXT NOT NULL, kind TEXT NOT NULL, rule_draft TEXT NOT NULL, norm TEXT NOT NULL,
            state TEXT NOT NULL, evidence TEXT NOT NULL, count INTEGER NOT NULL, rule_id TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, decided_at INTEGER);
          CREATE INDEX IF NOT EXISTS candidate_state ON candidates(character_id, state, updated_at);
          CREATE TABLE IF NOT EXISTS rules (id TEXT PRIMARY KEY, character_id TEXT NOT NULL, text TEXT NOT NULL, enabled INTEGER NOT NULL, candidate_id TEXT,
            created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
          CREATE INDEX IF NOT EXISTS rule_character ON rules(character_id, created_at);
          CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY, character_id TEXT NOT NULL, day TEXT NOT NULL, kind TEXT NOT NULL, at INTEGER NOT NULL, outcome TEXT NOT NULL, read INTEGER NOT NULL);
          CREATE UNIQUE INDEX IF NOT EXISTS run_scheduled ON runs(character_id, day) WHERE kind='scheduled';
          PRAGMA user_version=${SCHEMA_VERSION};`);
        // Only the separate group database has exact source-ID checkpointing.
        if (this.groupState) db.exec(`CREATE TABLE IF NOT EXISTS group_reflection_state (
            character_id TEXT PRIMARY KEY, revision TEXT NOT NULL, rule_revision TEXT, claimed_day TEXT);
          CREATE TABLE IF NOT EXISTS group_reflection_consumed (
            character_id TEXT NOT NULL, message_id TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY(character_id,message_id));`);
      });
    } catch { throw fail('reflection_unavailable'); }
  }

  #db(operation) {
    if (this.#scopedConnection) return operation(this.#scopedConnection);
    let db, done = false;
    try {
      db = new this.DatabaseSync(this.file, {allowExtension: false});
      db.exec('PRAGMA busy_timeout=1000; PRAGMA trusted_schema=OFF; BEGIN IMMEDIATE;');
      const result = operation(db);
      db.exec('COMMIT'); done = true;
      return result;
    } catch (error) {
      if (db && !done) { try { db.exec('ROLLBACK'); } catch { /* no open transaction */ } }
      if (typeof error?.code === 'string' && (error.code.startsWith('reflection_') ||
          this.groupState && error.code.startsWith('group_reflection_'))) throw error;
      throw fail('reflection_unavailable');
    } finally { try { db?.close(); } catch { /* already closed */ } }
  }

  /** Keep a group's checkpoint, proposals and run result in one transaction. */
  groupTransaction(operation) {
    if (!this.groupState || this.#scopedConnection || typeof operation !== 'function') throw fail('reflection_invalid_request');
    return this.#db(db => {
      this.#scopedConnection = db;
      try {
        const result = operation(db);
        if (result && typeof result.then === 'function') throw fail('reflection_invalid_request');
        return result;
      } finally { this.#scopedConnection = null; }
    });
  }

  #settings(db, characterId) {
    const row = db.prepare('SELECT * FROM settings WHERE character_id=?').get(characterId);
    const scheduled = db.prepare("SELECT day FROM runs WHERE character_id=? AND kind='scheduled' ORDER BY day DESC LIMIT 1").get(characterId)?.day || null;
    return {characterId, enabled: row?.enabled === 1, hour: row ? row.hour : 3, cursorAt: row?.cursor_at ?? null, lastRunAt: row?.last_run_at ?? null, lastOutcome: row?.last_outcome ?? null, lastRead: row?.last_read ?? null, scheduledDay: scheduled};
  }

  /** `{characterId, enabled, hour, cursorAt, lastRunAt, lastOutcome, lastRead, scheduledDay}`; off at 03:00 until configured. */
  settings(characterId) { character(characterId); return this.#db(db => this.#settings(db, characterId)); }

  /** Every character whose reflection is switched on. */
  enabled() { return this.#db(db => db.prepare('SELECT character_id FROM settings WHERE enabled=1 ORDER BY character_id LIMIT ?').all(LIMITS.characters).map(row => this.#settings(db, row.character_id))); }

  configure(characterId, {enabled, hour} = {}) {
    character(characterId);
    if (enabled !== undefined && typeof enabled !== 'boolean' || hour !== undefined && (!Number.isInteger(hour) || hour < 0 || hour > 23)) throw fail('reflection_invalid_request');
    return this.#db(db => {
      const current = this.#settings(db, characterId), exists = db.prepare('SELECT 1 FROM settings WHERE character_id=?').get(characterId);
      if (!exists && db.prepare('SELECT count(*) AS count FROM settings').get().count >= LIMITS.characters) throw fail('reflection_limit');
      const next = {enabled: enabled === undefined ? current.enabled : enabled, hour: hour === undefined ? current.hour : hour};
      if (exists) db.prepare('UPDATE settings SET enabled=?,hour=?,updated_at=? WHERE character_id=?').run(next.enabled ? 1 : 0, next.hour, this.now(), characterId);
      else db.prepare('INSERT INTO settings(character_id,enabled,hour,updated_at) VALUES(?,?,?,?)').run(characterId, next.enabled ? 1 : 0, next.hour, this.now());
      return this.#settings(db, characterId);
    });
  }

  /**
   * Claims today's scheduled run for a character. False when one was already claimed for that
   * local day: at most one scheduled run per character per day, whatever its outcome.
   */
  claimScheduled(characterId, day) {
    character(characterId); if (typeof day !== 'string' || !DAY.test(day)) throw fail('reflection_invalid_request');
    return this.#db(db => {
      if (db.prepare("SELECT 1 FROM runs WHERE character_id=? AND day=? AND kind='scheduled'").get(characterId, day)) return false;
      db.prepare("INSERT INTO runs(id,character_id,day,kind,at,outcome,read) VALUES(?,?,?,'scheduled',?,'started',0)").run(randomUUID(), characterId, day, this.now());
      return true;
    });
  }

  /** Journals a finished run; `cursorAt` (the newest owner message read) moves only with it. */
  finishRun(characterId, {kind, day, outcome, read = 0, cursorAt} = {}) {
    character(characterId);
    if (!['scheduled', 'manual'].includes(kind) || typeof day !== 'string' || !DAY.test(day) || !OUTCOMES.has(outcome) || !Number.isInteger(read) || read < 0 || cursorAt !== undefined && (!Number.isSafeInteger(cursorAt) || cursorAt < 0)) throw fail('reflection_invalid_request');
    return this.#db(db => {
      const at = this.now();
      if (kind === 'scheduled' && db.prepare("SELECT 1 FROM runs WHERE character_id=? AND day=? AND kind='scheduled'").get(characterId, day)) db.prepare("UPDATE runs SET at=?,outcome=?,read=? WHERE character_id=? AND day=? AND kind='scheduled'").run(at, outcome, read, characterId, day);
      else db.prepare('INSERT INTO runs(id,character_id,day,kind,at,outcome,read) VALUES(?,?,?,?,?,?,?)').run(randomUUID(), characterId, day, kind, at, outcome, read);
      db.prepare('DELETE FROM runs WHERE rowid NOT IN (SELECT rowid FROM runs ORDER BY at DESC,rowid DESC LIMIT ?)').run(LIMITS.runs);
      if (!db.prepare('SELECT 1 FROM settings WHERE character_id=?').get(characterId)) db.prepare('INSERT INTO settings(character_id,enabled,hour,updated_at) VALUES(?,0,3,?)').run(characterId, at);
      db.prepare('UPDATE settings SET last_run_at=?,last_outcome=?,last_read=?,cursor_at=COALESCE(?,cursor_at) WHERE character_id=?').run(at, outcome, read, cursorAt ?? null, characterId);
      return this.#settings(db, characterId);
    });
  }

  runs(characterId, limit = 20) { character(characterId); return this.#db(db => db.prepare('SELECT day,kind,at,outcome,read FROM runs WHERE character_id=? ORDER BY at DESC,rowid DESC LIMIT ?').all(characterId, Math.min(limit, 100)).map(row => ({...row}))); }

  /** Candidates of one character, newest first. `states`: any of seen / pending / approved / rejected / retired. */
  candidates(characterId, {states = ['pending']} = {}) {
    character(characterId);
    if (!Array.isArray(states) || !states.length || states.some(state => !['seen', 'pending', 'approved', 'rejected', 'retired'].includes(state))) throw fail('reflection_invalid_request');
    return this.#db(db => db.prepare(`SELECT * FROM candidates WHERE character_id=? AND state IN (${states.map(() => '?').join(',')}) ORDER BY updated_at DESC,rowid DESC LIMIT ?`).all(characterId, ...states, LIMITS.list).map(candidateOf));
  }

  /** Rule drafts the owner rejected, as data for the next run and for the deterministic filter. */
  rejectedDrafts(characterId) { character(characterId); return this.#db(db => db.prepare("SELECT rule_draft FROM candidates WHERE character_id=? AND state='rejected' ORDER BY decided_at DESC,rowid DESC LIMIT ?").all(characterId, LIMITS.rejected).map(row => row.rule_draft)); }

  /** Applies the operations of reflection-verify.cjs (already verified). Returns `{created, merged, pending}`. */
  applyOperations(characterId, operations) {
    character(characterId);
    return this.#db(db => {
      let created = 0, merged = 0;
      for (const operation of Array.isArray(operations) ? operations.slice(0, 20) : []) {
        if (!operation || !KINDS.includes(operation.kind) || typeof operation.ruleDraft !== 'string' || !operation.ruleDraft || operation.ruleDraft.length > DRAFT_CHARS || !['seen', 'pending'].includes(operation.state)
          || !Array.isArray(operation.evidence) || !operation.evidence.length || operation.evidence.length > MAX_EVIDENCE || !Number.isInteger(operation.count) || operation.count < 1) continue;
        const evidence = JSON.stringify(operation.evidence.map(item => ({messageId: String(item.messageId).slice(0, 180), quote: String(item.quote).slice(0, 120), day: String(item.day).slice(0, 10), ...(this.groupState ? groupEvidence(item) : {})}))), at = this.now();
        if (operation.type === 'merge') {
          const row = db.prepare("SELECT id FROM candidates WHERE id=? AND character_id=? AND state IN ('seen','pending')").get(operation.id, characterId);
          if (!row) continue;
          db.prepare('UPDATE candidates SET kind=?,state=?,evidence=?,count=?,rule_id=?,updated_at=? WHERE id=?').run(operation.kind, operation.state, evidence, operation.count, operation.ruleId || null, at, row.id);
          merged++;
        } else {
          db.prepare('INSERT INTO candidates(id,character_id,kind,rule_draft,norm,state,evidence,count,rule_id,created_at,updated_at,decided_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,NULL)')
            .run(randomUUID(), characterId, operation.kind, operation.ruleDraft, normalise(operation.ruleDraft), operation.state, evidence, operation.count, operation.ruleId || null, at, at);
          created++;
        }
      }
      // Bounded: the oldest "seen once" notes go first, then the oldest pending candidates.
      db.prepare("DELETE FROM candidates WHERE character_id=? AND state IN ('seen','pending') AND rowid NOT IN (SELECT rowid FROM candidates WHERE character_id=? AND state IN ('seen','pending') ORDER BY CASE state WHEN 'pending' THEN 1 ELSE 0 END DESC,updated_at DESC,rowid DESC LIMIT ?)").run(characterId, characterId, LIMITS.open);
      return {created, merged, pending: db.prepare("SELECT count(*) AS count FROM candidates WHERE character_id=? AND state='pending'").get(characterId).count};
    });
  }

  #cap(db, characterId, {adding = '', replacing = null} = {}) {
    const rows = db.prepare('SELECT id,text FROM rules WHERE character_id=?').all(characterId).filter(row => row.id !== replacing);
    const chars = rows.reduce((sum, row) => sum + row.text.length, 0);
    return {count: rows.length, chars, full: rows.length + 1 > LIMITS.rules || chars + adding.length > LIMITS.ruleChars};
  }

  /** `{rules, count, chars, atCap}` of one character; `atCap`: adding one more needs another one removed first. */
  rules(characterId) {
    character(characterId);
    return this.#db(db => {
      const rules = db.prepare('SELECT * FROM rules WHERE character_id=? ORDER BY created_at,rowid').all(characterId).map(ruleOf), chars = rules.reduce((sum, rule) => sum + rule.text.length, 0);
      return {rules, count: rules.length, chars, atCap: rules.length >= LIMITS.rules || chars >= LIMITS.ruleChars, limits: {rules: LIMITS.rules, chars: LIMITS.ruleChars, text: LIMITS.ruleText}};
    });
  }

  /** Texts of the approved, enabled rules of one character, oldest first. */
  activeRules(characterId) { character(characterId); return this.#db(db => db.prepare('SELECT text FROM rules WHERE character_id=? AND enabled=1 ORDER BY created_at,rowid LIMIT ?').all(characterId, LIMITS.rules).map(row => row.text)); }

  /**
   * The owner decides one pending candidate. approve: its draft (or the owner's `text`) becomes
   * an enabled rule; for a `rule_violated` candidate tied to an existing rule, that rule is
   * rewritten to `text` when given and no second rule is added. `reflection_rule_cap` when the
   * character's rules are full. reject: kept, and never proposed again.
   */
  decide(id, action, {text} = {}) {
    if (typeof id !== 'string' || id.length > 64 || !['approve', 'reject'].includes(action)) throw fail('reflection_invalid_request');
    return this.#db(db => {
      const row = db.prepare('SELECT * FROM candidates WHERE id=?').get(id);
      if (!row) throw fail('reflection_candidate_not_found');
      if (row.state !== 'pending') throw fail('reflection_candidate_decided');
      const at = this.now();
      let rule = null;
      if (action === 'approve') {
        const existing = row.rule_id ? db.prepare('SELECT * FROM rules WHERE id=? AND character_id=?').get(row.rule_id, row.character_id) : null;
        if (existing) {
          if (text !== undefined) {
            const wording = ruleText(text);
            if (this.#cap(db, row.character_id, {adding: wording, replacing: existing.id}).chars + wording.length > LIMITS.ruleChars) throw fail('reflection_rule_cap');
            db.prepare('UPDATE rules SET text=?,updated_at=? WHERE id=?').run(wording, at, existing.id);
          }
          rule = ruleOf(db.prepare('SELECT * FROM rules WHERE id=?').get(existing.id));
        } else {
          const wording = ruleText(text === undefined ? row.rule_draft : text);
          if (this.#cap(db, row.character_id, {adding: wording}).full) throw fail('reflection_rule_cap');
          const ruleId = randomUUID();
          db.prepare('INSERT INTO rules(id,character_id,text,enabled,candidate_id,created_at,updated_at) VALUES(?,?,?,1,?,?,?)').run(ruleId, row.character_id, wording, id, at, at);
          rule = ruleOf(db.prepare('SELECT * FROM rules WHERE id=?').get(ruleId));
        }
      } else if (text !== undefined) throw fail('reflection_invalid_request');
      const state = action === 'approve' ? 'approved' : 'rejected';
      db.prepare('UPDATE candidates SET state=?,decided_at=?,updated_at=? WHERE id=?').run(state, at, at, id);
      for (const [kept, limit] of [['rejected', LIMITS.rejected], ['approved', LIMITS.decided], ['retired', LIMITS.decided]])
        db.prepare('DELETE FROM candidates WHERE character_id=? AND state=? AND rowid NOT IN (SELECT rowid FROM candidates WHERE character_id=? AND state=? ORDER BY decided_at DESC,rowid DESC LIMIT ?)').run(row.character_id, kept, row.character_id, kept, limit);
      return {candidate: candidateOf(db.prepare('SELECT * FROM candidates WHERE id=?').get(id)), rule};
    });
  }

  /** The owner switches one rule on / off or removes it (its candidate then reads 'retired'). */
  updateRule(id, {enabled, remove} = {}) {
    if (typeof id !== 'string' || id.length > 64 || enabled !== undefined && typeof enabled !== 'boolean' || remove !== undefined && remove !== true || (enabled === undefined) === (remove === undefined)) throw fail('reflection_invalid_request');
    return this.#db(db => {
      const row = db.prepare('SELECT * FROM rules WHERE id=?').get(id);
      if (!row) throw fail('reflection_rule_not_found');
      const at = this.now();
      if (remove) {
        db.prepare('DELETE FROM rules WHERE id=?').run(id);
        if (row.candidate_id) db.prepare("UPDATE candidates SET state='retired',decided_at=?,updated_at=? WHERE id=? AND state='approved'").run(at, at, row.candidate_id);
        return {removed: true, characterId: row.character_id};
      }
      db.prepare('UPDATE rules SET enabled=?,updated_at=? WHERE id=?').run(enabled ? 1 : 0, at, id);
      return {rule: ruleOf(db.prepare('SELECT * FROM rules WHERE id=?').get(id)), characterId: row.character_id};
    });
  }
}

module.exports = {ReflectionStore, LIMITS, SCHEMA_VERSION, CHARACTER};
