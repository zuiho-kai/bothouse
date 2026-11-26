'use strict';
// Proposed line-level changes to the owner's wiki, waiting for the owner's decision. A model may
// only ever add rows here (through wiki-propose.cjs, after deterministic checks); a page changes
// only in approve(), which the owner triggers for one proposal at a time and which goes through
// WikiStore.applyChange. One small SQLite file beside the wiki folder; a short transaction per
// call and no connection kept open. This file holds no bothouse code.
const fs = require('node:fs');
const path = require('node:path');
const {createHash, randomUUID} = require('node:crypto');
const {SECTIONS, parsePage, splitLines} = require('./wiki-store.cjs');
const {flat} = require('./quote-verify.cjs');

const SCHEMA_VERSION = 1;
const LIMITS = Object.freeze({pending: 50, rejected: 500, decided: 500, text: 300, quote: 120, evidence: 5, note: 200, list: 100});
const STATES = Object.freeze(['pending', 'approved', 'rejected', 'superseded']);
const CHARACTER = /^[a-z0-9][a-z0-9-]{0,63}$/;
const fail = (code, details) => Object.assign(new Error(`Wiki proposals refused this operation (${code}).`), {code, ...(details ? {details} : {})});
const fingerprint = ({page, section, op, text, targetText}) => createHash('sha256').update(JSON.stringify([page, section, op, flat(op === 'remove' ? targetText : text)])).digest('hex');
const line = (value, max) => typeof value === 'string' && value.length <= max && !/[\x00-\x1f\x7f]/.test(value);

function rowOf(row) {
  let evidence = [];
  try { const parsed = JSON.parse(row.evidence); if (Array.isArray(parsed)) evidence = parsed.filter(item => item && typeof item.messageId === 'string' && typeof item.quote === 'string').map(item => ({messageId: item.messageId, quote: item.quote})); } catch { evidence = []; }
  return {id: row.id, characterId: row.character_id, page: row.page, section: row.section, op: row.op, text: row.text, targetLine: row.target_line, targetText: row.target_text, pageSha: row.page_sha, evidence,
    state: row.state, note: row.note, createdAt: row.created_at, decidedAt: row.decided_at, revision: row.revision};
}

class WikiProposals {
  /** @param {{file: string, store: object, now?: () => number, loadSqlite?: Function}} options file: absolute path of the SQLite file; store: the WikiStore */
  constructor({file, store, now = Date.now, loadSqlite = () => require('node:sqlite')} = {}) {
    if (typeof file !== 'string' || !path.isAbsolute(file) || !store || typeof store.applyChange !== 'function') throw fail('wiki_proposals_unavailable');
    Object.assign(this, {file, store, now});
    try {
      this.DatabaseSync = loadSqlite().DatabaseSync;
      fs.mkdirSync(path.dirname(file), {recursive: true});
      this.#db(db => {
        const version = db.prepare('PRAGMA user_version').get().user_version;
        if (version > SCHEMA_VERSION) throw fail('wiki_proposals_unavailable');
        db.exec(`CREATE TABLE IF NOT EXISTS proposals (id TEXT PRIMARY KEY, character_id TEXT NOT NULL, page TEXT NOT NULL, section TEXT NOT NULL, op TEXT NOT NULL,
            text TEXT NOT NULL, target_line INTEGER, target_text TEXT NOT NULL, page_sha TEXT NOT NULL, evidence TEXT NOT NULL, fingerprint TEXT NOT NULL,
            state TEXT NOT NULL, note TEXT NOT NULL, created_at INTEGER NOT NULL, decided_at INTEGER, revision INTEGER NOT NULL);
          CREATE INDEX IF NOT EXISTS proposal_state ON proposals(state, created_at);
          CREATE TABLE IF NOT EXISTS cursors (character_id TEXT PRIMARY KEY, at INTEGER NOT NULL);
          PRAGMA user_version=${SCHEMA_VERSION};`);
      });
    } catch { throw fail('wiki_proposals_unavailable'); }
  }

  #db(operation) {
    let db, done = false;
    try {
      db = new this.DatabaseSync(this.file, {allowExtension: false});
      db.exec('PRAGMA busy_timeout=1000; PRAGMA trusted_schema=OFF; BEGIN IMMEDIATE;');
      const result = operation(db);
      db.exec('COMMIT'); done = true;
      return result;
    } catch (error) {
      if (db && !done) { try { db.exec('ROLLBACK'); } catch { /* no open transaction */ } }
      if (typeof error?.code === 'string' && error.code.startsWith('wiki_')) throw error;
      throw fail('wiki_proposals_unavailable');
    } finally { try { db?.close(); } catch { /* already closed */ } }
  }

  /**
   * Stores one verified proposal as pending. Returns `{id}` or `{skipped}` ('duplicate': an
   * identical one is pending; 'rejected_before': the owner already rejected an identical one).
   */
  add({characterId, page, section, op, text = '', targetLine = null, targetText = '', pageSha, evidence} = {}) {
    if (typeof characterId !== 'string' || !CHARACTER.test(characterId) || typeof page !== 'string' || !page || page.length > 200 || !SECTIONS.includes(section) || !['add', 'replace', 'remove'].includes(op)
      || typeof pageSha !== 'string' || !/^[0-9a-f]{64}$/.test(pageSha)) throw fail('wiki_proposal_invalid');
    if (op === 'remove' ? text !== '' : !line(text, LIMITS.text) || !text.trim()) throw fail('wiki_proposal_invalid');
    if (op === 'add' ? targetLine !== null || targetText !== '' : !Number.isInteger(targetLine) || targetLine < 1 || !line(targetText, 2000) || !targetText.trim()) throw fail('wiki_proposal_invalid');
    if (!Array.isArray(evidence) || !evidence.length || evidence.length > LIMITS.evidence || evidence.some(item => !item || !line(item.messageId, 180) || !item.messageId || !line(item.quote, LIMITS.quote) || !item.quote.trim())) throw fail('wiki_proposal_invalid');
    const print = fingerprint({page, section, op, text, targetText});
    return this.#db(db => {
      const same = db.prepare("SELECT state FROM proposals WHERE fingerprint=? AND state IN ('pending','rejected') LIMIT 1").get(print);
      if (same) return {skipped: same.state === 'rejected' ? 'rejected_before' : 'duplicate'};
      if (db.prepare("SELECT count(*) AS count FROM proposals WHERE state='pending'").get().count >= LIMITS.pending) throw fail('wiki_proposals_full');
      const id = randomUUID();
      db.prepare('INSERT INTO proposals(id,character_id,page,section,op,text,target_line,target_text,page_sha,evidence,fingerprint,state,note,created_at,decided_at,revision) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,NULL,1)')
        .run(id, characterId, page, section, op, text, targetLine, targetText, pageSha, JSON.stringify(evidence.map(item => ({messageId: item.messageId, quote: item.quote}))), print, 'pending', '', this.now());
      return {id};
    });
  }

  /** Newest first, at most 100. `state`: one of pending / approved / rejected / superseded, or absent for all. */
  list({state} = {}) {
    if (state !== undefined && state !== null && !STATES.includes(state)) throw fail('wiki_proposal_invalid');
    return this.#db(db => (state ? db.prepare('SELECT * FROM proposals WHERE state=? ORDER BY created_at DESC,rowid DESC LIMIT ?').all(state, LIMITS.list)
      : db.prepare('SELECT * FROM proposals ORDER BY created_at DESC,rowid DESC LIMIT ?').all(LIMITS.list)).map(rowOf));
  }

  get(id) { return typeof id === 'string' && id.length <= 64 ? this.#db(db => { const row = db.prepare('SELECT * FROM proposals WHERE id=?').get(id); return row ? rowOf(row) : null; }) : null; }

  pendingCount() { return this.#db(db => db.prepare("SELECT count(*) AS count FROM proposals WHERE state='pending'").get().count); }

  /** Texts of proposals the owner rejected (newest first), as data for the next proposal prompt. */
  rejectedTexts(limit = 20) { return this.#db(db => db.prepare("SELECT text,target_text,op FROM proposals WHERE state='rejected' ORDER BY decided_at DESC,rowid DESC LIMIT ?").all(Math.min(limit, 50)).map(row => (row.op === 'remove' ? row.target_text : row.text))); }

  #pending(db, id) {
    const row = typeof id === 'string' && id.length <= 64 ? db.prepare('SELECT * FROM proposals WHERE id=?').get(id) : null;
    if (!row) throw fail('wiki_proposal_not_found');
    if (row.state !== 'pending') throw fail('wiki_proposal_decided');
    return row;
  }

  #decide(id, state, {text, note = ''} = {}) {
    return this.#db(db => {
      const row = this.#pending(db, id), at = this.now();
      db.prepare('UPDATE proposals SET state=?,text=?,note=?,decided_at=?,revision=revision+1 WHERE id=?').run(state, text === undefined ? row.text : text, note, at, id);
      for (const [kept, limit] of [['rejected', LIMITS.rejected], ['approved', LIMITS.decided], ['superseded', LIMITS.decided]])
        db.prepare('DELETE FROM proposals WHERE state=? AND rowid NOT IN (SELECT rowid FROM proposals WHERE state=? ORDER BY decided_at DESC,rowid DESC LIMIT ?)').run(kept, kept, limit);
      return rowOf(db.prepare('SELECT * FROM proposals WHERE id=?').get(id));
    });
  }

  // Our own approved change moved the page to a new text. Other pending proposals made against
  // the same earlier text stay valid: an add is position-independent; a replace / remove follows
  // its target line when exactly one line of that section still has the same text.
  #rebase(page, oldSha, newSha) {
    let lines = null, sections = [];
    try { const text = this.store.pageText(page); if (text !== null) { lines = splitLines(text); sections = parsePage(lines).sections; } } catch { lines = null; }
    this.#db(db => {
      for (const row of db.prepare("SELECT * FROM proposals WHERE state='pending' AND page=? AND page_sha=?").all(page, oldSha)) {
        if (row.op === 'add') { db.prepare('UPDATE proposals SET page_sha=? WHERE id=?').run(newSha, row.id); continue; }
        const section = lines && sections.find(item => item.name === row.section);
        if (!section) continue;
        const hits = [];
        for (let number = section.line + 1; number <= section.end; number++) if (lines[number - 1] === row.target_text) hits.push(number);
        if (hits.length === 1) db.prepare('UPDATE proposals SET page_sha=?,target_line=? WHERE id=?').run(newSha, hits[0], row.id);
      }
    });
  }

  /**
   * The owner approves one pending proposal, optionally with their own wording. The page must
   * still be the text the proposal was made against, otherwise the proposal becomes
   * 'superseded' and nothing is written. The change goes through WikiStore.applyChange; when
   * that refuses (for example `wiki_lint_failed`), its error is thrown, nothing is written and
   * the proposal stays pending. Only after a successful write is it marked approved.
   * @returns {{state: 'approved'|'superseded', proposal: object, applied?: object}}
   */
  approve(id, {text} = {}) {
    const row = this.#db(db => rowOf(this.#pending(db, id)));
    if (text !== undefined && (row.op === 'remove' || !line(text, LIMITS.text) || !text.trim())) throw fail('wiki_proposal_invalid');
    if (this.store.pageSha(row.page) !== row.pageSha) return {state: 'superseded', proposal: this.#decide(id, 'superseded')};
    const finalText = row.op === 'remove' ? undefined : text === undefined ? row.text : text.trim();
    const applied = this.store.applyChange({page: row.page, section: row.section, op: row.op, text: finalText, targetLine: row.targetLine, expectedSha: row.pageSha});
    const proposal = this.#decide(id, 'approved', finalText === undefined ? {} : {text: finalText});
    try { this.#rebase(row.page, row.pageSha, applied.sha); } catch { /* the others are re-checked when the owner decides them */ }
    return {state: 'approved', proposal, applied};
  }

  /** The owner rejects one pending proposal. It is kept so that the same change is not proposed again. */
  reject(id, note = '') {
    if (!line(note, LIMITS.note)) throw fail('wiki_proposal_invalid');
    return {state: 'rejected', proposal: this.#decide(id, 'rejected', {note})};
  }

  /** Time of the newest owner message the last successful proposal run of this character has read, or null. */
  cursor(characterId) { return this.#db(db => db.prepare('SELECT at FROM cursors WHERE character_id=?').get(characterId)?.at ?? null); }

  setCursor(characterId, at) {
    if (typeof characterId !== 'string' || !CHARACTER.test(characterId) || !Number.isSafeInteger(at) || at < 0) throw fail('wiki_proposal_invalid');
    this.#db(db => { db.prepare('INSERT OR REPLACE INTO cursors(character_id,at) VALUES(?,?)').run(characterId, at); if (db.prepare('SELECT count(*) AS count FROM cursors').get().count > 300) db.prepare('DELETE FROM cursors WHERE rowid IN (SELECT rowid FROM cursors ORDER BY at LIMIT 50)').run(); });
  }
}

module.exports = {WikiProposals, LIMITS, STATES, CHARACTER, SCHEMA_VERSION, fingerprint};
