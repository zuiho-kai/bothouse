'use strict';
// On-disk library of standalone (global) lorebooks. Each book is one file <root>/<id>.json
// holding the normalized, bounded book plus id, display name and timestamps. Lorebook content
// is data: nothing stored here is executed, and ids never derive from book text.
// `importWorldInfoFile` reads a SillyTavern world-info export or a character_book object; the
// field mapping follows SillyTavern's `convertWorldInfoToCharacterBook`
// (src/endpoints/characters.js) and `newWorldInfoEntryDefinition` defaults
// (public/scripts/world-info.js), revision 06bde939fb1e9c4c8d8641d810f0a916b5bce127.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {atomicJSON} = require('../../core/files.cjs');
const {libraryContentHash} = require('../library-content-hash.cjs');
const {normalizeCharacterBook, toCharacterBookObject, LIMITS: CARD_LIMITS} = require('../../vendor/sillytavern/character-card.cjs');

const MAX_BOOKS = 200;
const MAX_BOOK_BYTES = 2 * 1024 * 1024;
const MAX_NAME = 60;
const ID = /^[0-9a-f]{16}$/;
const FILE = /^([0-9a-f]{16})\.json$/;
const fail = (message, code) => Object.assign(new Error(message), {code});
const isObject = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const isFile = file => { try { const stat = fs.lstatSync(file); return stat.isFile() && !stat.isSymbolicLink() ? stat : null; } catch { return null; } };

function bookName(value) {
  if (typeof value !== 'string') throw fail('The lorebook needs a name.', 'lorebook_invalid');
  const name = value.replace(/[\x00-\x1f\x7f]/g, ' ').trim();
  if (!name || name.length > MAX_NAME) throw fail(`The lorebook name must have 1 to ${MAX_NAME} characters.`, 'lorebook_invalid');
  return name;
}

// Re-applies every bound to a normalized book (stored, edited or freshly imported).
function revalidateBook(book) {
  if (!isObject(book) || !Array.isArray(book.entries)) throw fail('Invalid lorebook.', 'lorebook_invalid');
  const result = normalizeCharacterBook(toCharacterBookObject(book)).book;
  if (!result) throw fail('Invalid lorebook.', 'lorebook_invalid');
  return result;
}

function importTitle(name, book) {
  return bookName(name === undefined || name === null || name === '' ? book.name.slice(0, MAX_NAME) || 'Lorebook' : name);
}

/**
 * Reads a lorebook file: a SillyTavern world-info export (`entries` is an object keyed by uid)
 * or a character_book object (`entries` is a list). JSON text, a buffer or a parsed object.
 * @returns {{book: object, warnings: string[], format: 'world_info'|'character_book'}} frozen book
 */
function importWorldInfoFile(json) {
  let source = json;
  if (Buffer.isBuffer(source)) {
    if (source.length > MAX_BOOK_BYTES) throw fail('Choose a lorebook file smaller than 2 MiB.', 'lorebook_invalid');
    try { source = new TextDecoder('utf-8', {fatal: true}).decode(source); } catch { throw fail('The lorebook file is not valid UTF-8.', 'lorebook_invalid'); }
  }
  if (typeof source === 'string') {
    if (Buffer.byteLength(source, 'utf8') > MAX_BOOK_BYTES) throw fail('Choose a lorebook file smaller than 2 MiB.', 'lorebook_invalid');
    try { source = JSON.parse(source.replace(/^﻿/, '')); } catch { throw fail('The lorebook file is not valid JSON.', 'lorebook_invalid'); }
  }
  if (!isObject(source)) throw fail('The file is not a lorebook.', 'lorebook_invalid');
  let characterBook = source, format = 'character_book';
  if (isObject(source.entries)) {
    format = 'world_info';
    const entries = [];
    for (const raw of Object.values(source.entries).slice(0, CARD_LIMITS.bookEntries + 1)) {
      if (!isObject(raw)) { entries.push(raw); continue; }
      // Defaults of a missing field are upstream's template values.
      const position = typeof raw.position === 'number' ? raw.position : 0;
      entries.push({
        id: raw.uid, keys: raw.key, secondary_keys: raw.keysecondary, comment: raw.comment, content: raw.content,
        constant: raw.constant, selective: raw.selective ?? true, insertion_order: raw.order ?? 100, enabled: !raw.disable,
        position: position === 0 ? 'before_char' : 'after_char',
        extensions: {
          position, depth: raw.depth, role: raw.role, selectiveLogic: raw.selectiveLogic, probability: raw.probability, useProbability: raw.useProbability,
          group: raw.group, group_override: raw.groupOverride, group_weight: raw.groupWeight, sticky: raw.sticky, cooldown: raw.cooldown, delay: raw.delay,
          scan_depth: raw.scanDepth, case_sensitive: raw.caseSensitive, match_whole_words: raw.matchWholeWords, exclude_recursion: raw.excludeRecursion,
          prevent_recursion: raw.preventRecursion, delay_until_recursion: raw.delayUntilRecursion, ignore_budget: raw.ignoreBudget,
        },
      });
    }
    characterBook = {name: source.name, entries};
  } else if (!Array.isArray(source.entries)) throw fail('The file is not a lorebook: it has no entries.', 'lorebook_invalid');
  const {book, warnings} = normalizeCharacterBook(characterBook);
  if (!book) throw fail('The file is not a lorebook.', 'lorebook_invalid');
  return Object.freeze({book, warnings: [...warnings], format});
}

class LorebookLibrary {
  #reviewRecords = new Map();

  constructor({root, now = Date.now, maxBooks = 50} = {}) {
    if (typeof root !== 'string' || !path.isAbsolute(root)) throw fail('The lorebook library needs an absolute directory.', 'lorebook_library_invalid');
    if (!Number.isInteger(maxBooks) || maxBooks < 1 || maxBooks > MAX_BOOKS) throw fail('Invalid lorebook limit.', 'lorebook_library_invalid');
    this.root = root; this.now = now; this.maxBooks = maxBooks;
  }

  #file(id) {
    if (typeof id !== 'string' || !ID.test(id)) throw fail('Invalid lorebook id.', 'lorebook_id_invalid');
    return path.join(this.root, `${id}.json`);
  }

  #ids() {
    let entries;
    try { entries = fs.readdirSync(this.root, {withFileTypes: true}); } catch (error) { if (error.code === 'ENOENT') return []; throw error; }
    return entries.filter(entry => entry.isFile() && FILE.test(entry.name)).map(entry => FILE.exec(entry.name)[1]);
  }

  #read(id) {
    const file = this.#file(id);
    const stat = isFile(file);
    if (!stat) return null;
    if (stat.size > MAX_BOOK_BYTES) throw fail('The stored lorebook is oversized.', 'lorebook_library_corrupt');
    try {
      const stored = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (stored.id !== id || !Number.isSafeInteger(stored.addedAt) || !Number.isSafeInteger(stored.updatedAt)) throw Error('metadata');
      return {id, name: bookName(stored.name), book: revalidateBook(stored.book), addedAt: stored.addedAt, updatedAt: stored.updatedAt};
    } catch { throw fail('The stored lorebook cannot be read.', 'lorebook_library_corrupt'); }
  }

  #write(id, name, book, addedAt, updatedAt) {
    const record = {id, name: bookName(name), book: revalidateBook(book), addedAt, updatedAt};
    if (Buffer.byteLength(JSON.stringify(record, null, 2), 'utf8') > MAX_BOOK_BYTES) throw fail('The lorebook exceeds 2 MiB.', 'lorebook_too_large');
    atomicJSON(this.#file(id), record);
    return record;
  }

  /** Light summaries sorted by name. Corrupt or foreign files are skipped. */
  list() {
    const result = [];
    for (const id of this.#ids()) {
      try {
        const record = this.#read(id);
        if (record) result.push({id, name: record.name, entries: record.book.entries.length, enabledEntries: record.book.entries.filter(entry => entry.enabled).length, addedAt: record.addedAt, updatedAt: record.updatedAt});
      } catch { /* skip corrupt entry */ }
    }
    return result.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  }

  /** Full stored record `{id, name, book, addedAt, updatedAt}`, or null. Throws for a corrupt file. */
  get(id) { return this.#read(id); }

  /** Match normalized book contents independently of a display title supplied by the filename. */
  batchImporter() {
    const books = new Map();
    for (const id of this.#ids()) {
      try {
        const record = this.#read(id);
        if (record) books.set(libraryContentHash(record.book), id);
      } catch { /* Unreadable entries remain untouched and still count toward capacity. */ }
    }
    return ({name, book} = {}) => {
      const checked = revalidateBook(book), title = importTitle(name, checked);
      const key = libraryContentHash(checked);
      if (books.has(key)) return {id: books.get(key), skipped: true};
      const {id} = this.add({name: title, book: checked});
      books.set(key, id);
      return {id, skipped: false};
    };
  }

  revision(id) {
    const stat = isFile(this.#file(id));
    return stat ? [stat.dev, stat.ino, stat.size, stat.mtimeMs, stat.ctimeMs].join(':') : null;
  }

  // Read-only, normalized book data shared across group approvals. A file
  // replaced between metadata and content reads never enters the cache.
  reviewRecord(id) {
    const revision = this.revision(id);
    const cached = this.#reviewRecords.get(id);
    if (revision && cached?.revision === revision) return cached.record;
    this.#reviewRecords.delete(id);
    if (!revision) return null;
    const record = this.get(id);
    if (!record || this.revision(id) !== revision) return null;
    if (this.#reviewRecords.size >= this.maxBooks) this.#reviewRecords.delete(this.#reviewRecords.keys().next().value);
    Object.freeze(record);
    this.#reviewRecords.set(id, {revision, record});
    return record;
  }

  add({name, book, reservedId} = {}) {
    const checked = revalidateBook(book);
    const title = importTitle(name, checked);
    const existing = new Set(this.#ids());
    if (existing.size >= this.maxBooks) throw fail(`The library holds at most ${this.maxBooks} lorebooks.`, 'lorebook_library_full');
    let id=reservedId;
    if(id!==undefined){
      this.#file(id);
      if(existing.has(id))throw fail('The reserved lorebook already exists.','lorebook_exists');
    }else do id = crypto.randomBytes(8).toString('hex'); while (existing.has(id));
    const at = this.now();
    return this.#write(id, title, checked, at, at);
  }

  /** Patch `name` and / or `book`. */
  update(id, patch) {
    if (!isObject(patch) || Object.keys(patch).some(key => !['name', 'book'].includes(key))) throw fail('Invalid lorebook update.', 'lorebook_update_invalid');
    const current = this.#read(id);
    if (!current) throw fail('No such lorebook.', 'lorebook_not_found');
    return this.#write(id, patch.name === undefined ? current.name : patch.name, patch.book === undefined ? current.book : patch.book, current.addedAt, this.now());
  }

  /** Deletes only this book's own file. */
  remove(id) {
    const file = this.#file(id);
    if (!isFile(file)) return {removed: false, reason: 'not_found'};
    fs.unlinkSync(file);
    return {removed: true};
  }
}

module.exports = {LorebookLibrary, importWorldInfoFile, MAX_BOOKS, MAX_BOOK_BYTES};
