'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {randomBytes, randomUUID} = require('node:crypto');
const {atomicJSON} = require('../core/files.cjs');
const {clean} = require('./dispatcher.cjs');
const {Index, TOP_PAGES} = require('./wiki/wiki-search.cjs');

const SCHEMA = 1;
const MAX_SCOPES = 24;
const MAX_PENDING = 24;
const MAX_APPROVED = 48;
const MAX_BYTES = 2 * 1024 * 1024;
const MAX_TITLE = 80;
const MAX_TEXT = 180;
const MAX_EXCERPT = 120;
const QQ_ID = /^[1-9]\d{4,14}$/;
const ROLE_ID = /^[a-z0-9-]{1,50}$/;
const ROW_ID = /^[a-f0-9]{64}$/;
const MEMBER_ALIAS = /^[a-f0-9]{16}$/;
const ENTRY_ID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const SCOPE_KEYS = ['accountId', 'groupId', 'roleId'];
const STATE_KEYS = [...SCOPE_KEYS, 'read', 'propose', 'revision', 'readEpoch', 'pending', 'approved'];
const ENTRY_KEYS = ['id', 'title', 'text', 'evidence', 'origin', 'createdAt'];
const STAGE_KEYS = ['revision', 'title', 'text', 'evidence'];
const validOrigin = origin => origin === 'manual' || origin === 'model';

const wikiError = reason => Object.assign(
  Error('Group Wiki is unavailable for this operation.'),
  {code: 'group_wiki_' + reason},
);
const plain = value => !!value && typeof value === 'object' && !Array.isArray(value);
const exact = (value, keys) => plain(value) && Object.keys(value).length === keys.length &&
  keys.every(key => Object.hasOwn(value, key));
const matches = (value, regex) => typeof value === 'string' && regex.test(value);
const timestamp = value => Number.isSafeInteger(value) && value >= 0;
const allowedLine = (value, max) => typeof value === 'string' && value.length <= max && value.isWellFormed() &&
  !!value.trim() && !/[\p{Cc}\u2028-\u202e\u2066-\u2069]/u.test(value) && clean(value) === value;
const savedLine = (value, max) => allowedLine(value, max) && value.trim() === value;

function validScope(scope) {
  return matches(scope?.accountId, QQ_ID) && matches(scope.groupId, QQ_ID) && matches(scope.roleId, ROLE_ID);
}

function scopeKey({accountId, groupId, roleId}) {
  return JSON.stringify([accountId, groupId, roleId]);
}

function evidenceShape(evidence) {
  return exact(evidence, ['id', 'speaker', 'at', 'quote']) && matches(evidence.id, ROW_ID) &&
    matches(evidence.speaker, MEMBER_ALIAS) && timestamp(evidence.at);
}

function validEntry(row, approved) {
  return exact(row, approved ? [...ENTRY_KEYS, 'approvedAt'] : ENTRY_KEYS) && matches(row.id, ENTRY_ID) &&
    savedLine(row.title, MAX_TITLE) && savedLine(row.text, MAX_TEXT) && validOrigin(row.origin) &&
    evidenceShape(row.evidence) && savedLine(row.evidence.quote, MAX_EXCERPT) &&
    (row.origin === 'model' || row.evidence.quote === row.text) &&
    timestamp(row.createdAt) && (!approved || timestamp(row.approvedAt));
}

function validState(row) {
  if (!exact(row, STATE_KEYS) || !validScope(row) || typeof row.read !== 'boolean' ||
      typeof row.propose !== 'boolean' || !Number.isSafeInteger(row.revision) || row.revision < 1 ||
      !(row.read ? matches(row.readEpoch, ROW_ID) : row.readEpoch === null) ||
      !Array.isArray(row.pending) || row.pending.length > MAX_PENDING ||
      !Array.isArray(row.approved) || row.approved.length > MAX_APPROVED ||
      !row.pending.every(item => validEntry(item, false)) || !row.approved.every(item => validEntry(item, true))) {
    return false;
  }
  const ids = [...row.pending, ...row.approved].map(item => item.id);
  return new Set(ids).size === ids.length;
}

function publicView({read, propose, revision, pending, approved}) {
  return structuredClone({read, propose, revision, pending, approved});
}

/** Owner-reviewed notes from one ordinary QQ group and role. App notebooks
 * and member fact stores are separate inputs and are never opened here. */
class GroupWiki {
  constructor({file, now = Date.now} = {}) {
    if (typeof file !== 'string' || !path.isAbsolute(file) || typeof now !== 'function') throw wikiError('invalid');
    this.file = file;
    this.now = now;
  }

  #load() {
    try {
      const stat = fs.lstatSync(this.file);
      if (!stat.isFile() || stat.size > MAX_BYTES) throw wikiError('unavailable');
      const raw = fs.readFileSync(this.file);
      if (raw.length > MAX_BYTES) throw wikiError('unavailable');
      const state = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(raw));
      if (!exact(state, ['schema', 'scopes']) || state.schema !== SCHEMA ||
          !Array.isArray(state.scopes) || state.scopes.length > MAX_SCOPES ||
          !state.scopes.every(validState) || new Set(state.scopes.map(scopeKey)).size !== state.scopes.length) {
        throw wikiError('unavailable');
      }
      return state;
    } catch (error) {
      if (error?.code === 'ENOENT') return {schema: SCHEMA, scopes: []};
      throw wikiError('unavailable');
    }
  }

  #read(scope) {
    if (!exact(scope, SCOPE_KEYS) || !validScope(scope)) throw wikiError('invalid');
    const state = this.#load();
    const key = scopeKey(scope);
    const index = state.scopes.findIndex(row => scopeKey(row) === key);
    const row = state.scopes[index] || {
      ...scope, read: false, propose: false, revision: 0, readEpoch: null, pending: [], approved: [],
    };
    return {state, index, row};
  }

  #write(state) {
    if (Buffer.byteLength(JSON.stringify(state, null, 2)) > MAX_BYTES) throw wikiError('limit');
    try { atomicJSON(this.file, state); } catch { throw wikiError('unavailable'); }
  }

  #mutate(scope, revision, change) {
    if (!Number.isSafeInteger(revision) || revision < 0) throw wikiError('invalid');
    const {state, index, row} = this.#read(scope);
    if (revision !== row.revision) throw wikiError('changed');
    if (revision === Number.MAX_SAFE_INTEGER) throw wikiError('limit');
    if (!change(row)) return publicView(row);
    row.revision++;
    if (index === -1) {
      if (state.scopes.length >= MAX_SCOPES) throw wikiError('limit');
      state.scopes.push(row);
    }
    this.#write(state);
    return publicView(row);
  }

  #advanceRead(row) {
    // A fresh grant is distinct even after disabling and re-enabling without
    // editing any entry. Async requests using an old epoch can never resume.
    row.readEpoch = row.read ? randomBytes(32).toString('hex') : null;
  }

  view(scope) {
    return publicView(this.#read(scope).row);
  }

  configure(scope, value) {
    if (!exact(value, ['revision', 'read', 'propose']) ||
        typeof value.read !== 'boolean' || typeof value.propose !== 'boolean') throw wikiError('invalid');
    return this.#mutate(scope, value.revision, row => {
      const changed = row.read !== value.read;
      if (!changed && row.propose === value.propose) return false;
      row.read = value.read;
      row.propose = value.propose;
      if (changed) this.#advanceRead(row);
      return true;
    });
  }

  stage(scope, value) {
    if ((!exact(value, STAGE_KEYS) && !exact(value, [...STAGE_KEYS, 'origin'])) ||
        !allowedLine(value.title, MAX_TITLE) || !allowedLine(value.text, MAX_TEXT) ||
        !evidenceShape(value.evidence) || !allowedLine(value.evidence.quote, MAX_EXCERPT)) throw wikiError('invalid');
    const origin = Object.hasOwn(value, 'origin') ? value.origin : 'manual';
    const title = value.title.trim(), text = value.text.trim(), quote = value.evidence.quote.trim();
    if (!validOrigin(origin) || origin === 'manual' && text !== quote) throw wikiError('invalid');
    return this.#mutate(scope, value.revision, row => {
      if (!row.propose) throw wikiError('propose_off');
      if (row.pending.length >= MAX_PENDING) throw wikiError('limit');
      if ([...row.pending, ...row.approved].some(item => item.title === title && item.text === text)) {
        throw wikiError('duplicate');
      }
      const evidence = {...value.evidence, quote};
      const createdAt = this.now();
      if (!timestamp(createdAt)) throw wikiError('unavailable');
      row.pending.unshift({id: randomUUID(), title, text, evidence, origin, createdAt});
      return true;
    });
  }

  decide(scope, value) {
    if (!exact(value, ['revision', 'id', 'action']) || !matches(value.id, ENTRY_ID) ||
        !['approve', 'reject', 'revoke'].includes(value.action)) throw wikiError('invalid');
    return this.#mutate(scope, value.revision, row => {
      const rows = value.action === 'revoke' ? row.approved : row.pending;
      const index = rows.findIndex(entry => entry.id === value.id);
      if (index === -1) throw wikiError('not_found');
      if (value.action === 'approve') {
        if (row.approved.length >= MAX_APPROVED) throw wikiError('limit');
        const approvedAt = this.now();
        if (!timestamp(approvedAt)) throw wikiError('unavailable');
        row.approved.unshift({...rows[index], approvedAt});
      }
      rows.splice(index, 1);
      if (value.action !== 'reject') this.#advanceRead(row);
      return true;
    });
  }

  readRevision(scope) {
    try { return this.#read(scope).row.readEpoch; } catch { return null; }
  }

  recall(scope, query) {
    try {
      const {readEpoch: revision, approved} = this.#read(scope).row;
      if (!revision || !approved.length || typeof query !== 'string' || !query.trim()) return {revision, pages: []};
      const byId = new Map(approved.map(entry => [entry.id, entry]));
      const index = new Index(approved.map(({id, title, text}) => ({rel: id, text: '- ' + title + ' ' + text})), this.now());
      const pages = index.search(query, TOP_PAGES).map(({rel}) => {
        const {title, text} = byId.get(rel);
        return {title, text};
      });
      return {revision, pages};
    } catch { return {revision: null, pages: []}; }
  }
}

module.exports = {GroupWiki};
