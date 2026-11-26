'use strict';
// On-disk library of regex scripts: one file <root>/regex-scripts.json holding the ordered
// list, because scripts run in list order and the whole set is small (at most 100 scripts,
// 1 MiB). Scripts are data: each is re-normalized on every read and write, nothing stored here
// is executed, and ids are random, never derived from script text.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {atomicJSON} = require('../../core/files.cjs');
const {normalizeRegexScript} = require('../../vendor/sillytavern/regex-scripts.cjs');

const MAX_SCRIPTS = 100;
const MAX_FILE_BYTES = 1024 * 1024;
const FILE_NAME = 'regex-scripts.json';
const ID = /^[0-9a-f]{16}$/;
const FIELDS = ['scriptName', 'findRegex', 'replaceString', 'trimStrings', 'placement', 'disabled', 'markdownOnly', 'promptOnly', 'runOnEdit', 'substituteRegex', 'minDepth', 'maxDepth'];
const fail = (message, code) => Object.assign(new Error(message), {code});
const isObject = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const checkId = id => { if (typeof id !== 'string' || !ID.test(id)) throw fail('Invalid regex script id.', 'regex_script_id_invalid'); return id; };

// The stored form of a script: the normalized fields without the per-normalization warnings.
function storedScript(raw, id) {
  let script;
  try { script = normalizeRegexScript({...raw, id}); } catch (error) {
    if (error?.code === 'regex_script_invalid') throw fail(error.message, 'regex_script_invalid');
    throw error;
  }
  const result = {id};
  for (const key of FIELDS) result[key] = Array.isArray(script[key]) ? [...script[key]] : script[key];
  return result;
}

class RegexLibrary {
  constructor({root, now = Date.now, maxScripts = MAX_SCRIPTS} = {}) {
    if (typeof root !== 'string' || !path.isAbsolute(root)) throw fail('The regex library needs an absolute directory.', 'regex_library_invalid');
    if (!Number.isInteger(maxScripts) || maxScripts < 1 || maxScripts > MAX_SCRIPTS) throw fail('Invalid regex script limit.', 'regex_library_invalid');
    this.root = root; this.now = now; this.maxScripts = maxScripts;
    this.file = path.join(root, FILE_NAME);
  }

  // Records `{...script, addedAt, updatedAt}` in run order. A missing file is an empty library.
  #read() {
    let stat;
    try { stat = fs.lstatSync(this.file); } catch (error) { if (error.code === 'ENOENT') return []; throw error; }
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_FILE_BYTES) throw fail('The stored regex scripts cannot be read.', 'regex_library_corrupt');
    try {
      const stored = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (!isObject(stored) || stored.version !== 1 || !Array.isArray(stored.scripts) || stored.scripts.length > MAX_SCRIPTS) throw Error('shape');
      const seen = new Set();
      return stored.scripts.map(item => {
        if (!isObject(item) || !ID.test(item.id) || seen.has(item.id) || !Number.isSafeInteger(item.addedAt) || !Number.isSafeInteger(item.updatedAt)) throw Error('record');
        seen.add(item.id);
        return {...storedScript(item, item.id), addedAt: item.addedAt, updatedAt: item.updatedAt};
      });
    } catch { throw fail('The stored regex scripts cannot be read.', 'regex_library_corrupt'); }
  }

  #write(records) {
    const value = {version: 1, scripts: records};
    if (Buffer.byteLength(JSON.stringify(value, null, 2), 'utf8') > MAX_FILE_BYTES) throw fail('The regex scripts exceed 1 MiB.', 'regex_library_too_large');
    atomicJSON(this.file, value);
  }

  /** Every script in run order: `{id, ...script fields, addedAt, updatedAt}`. */
  list() { return this.#read(); }

  /** One stored script, or null. */
  get(id) { checkId(id); return this.#read().find(item => item.id === id) || null; }

  /** Appends a script (upstream or normalized shape) under a new id; it runs last. */
  add(script) {
    const records = this.#read();
    if (records.length >= this.maxScripts) throw fail(`The library holds at most ${this.maxScripts} regex scripts.`, 'regex_library_full');
    let id;
    do id = crypto.randomBytes(8).toString('hex'); while (records.some(item => item.id === id));
    const at = this.now();
    const record = {...storedScript(script, id), addedAt: at, updatedAt: at};
    this.#write([...records, record]);
    return record;
  }

  /** Patches script fields; the position in the run order is kept. */
  update(id, patch) {
    checkId(id);
    if (!isObject(patch) || !Object.keys(patch).length || Object.keys(patch).some(key => !FIELDS.includes(key))) throw fail('Invalid regex script update.', 'regex_script_update_invalid');
    const records = this.#read();
    const index = records.findIndex(item => item.id === id);
    if (index < 0) throw fail('No such regex script.', 'regex_script_not_found');
    const current = records[index];
    const record = {...storedScript({...current, ...patch}, id), addedAt: current.addedAt, updatedAt: this.now()};
    records[index] = record;
    this.#write(records);
    return record;
  }

  remove(id) {
    checkId(id);
    const records = this.#read();
    const rest = records.filter(item => item.id !== id);
    if (rest.length === records.length) return {removed: false, reason: 'not_found'};
    this.#write(rest);
    return {removed: true};
  }

  /** Sets the run order. `ids` must name every stored script exactly once. */
  reorder(ids) {
    const records = this.#read();
    if (!Array.isArray(ids) || ids.length !== records.length || new Set(ids).size !== ids.length) throw fail('The new order must list every regex script once.', 'regex_script_order_invalid');
    const byId = new Map(records.map(item => [item.id, item]));
    const next = ids.map(id => { const record = byId.get(checkId(id)); if (!record) throw fail('The new order must list every regex script once.', 'regex_script_order_invalid'); return record; });
    this.#write(next);
    return next.map(item => item.id);
  }
}

module.exports = {RegexLibrary, MAX_SCRIPTS, MAX_FILE_BYTES, FILE_NAME};
