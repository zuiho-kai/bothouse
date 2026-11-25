'use strict';
// On-disk library of imported character cards. Each character lives in <root>/<id>/ as
// card.json (normalized, bounded card plus id and timestamps) and an optional portrait.png.
// Card content is data: nothing stored here is executed, and ids never derive from card text.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {atomicJSON} = require('../core/files.cjs');
const {libraryContentHash} = require('./library-content-hash.cjs');
const {revalidateCard} = require('../vendor/sillytavern/character-card.cjs');
const {isPng, MAX_PNG_BYTES, MAX_JSON_BYTES} = require('../vendor/sillytavern/character-card-parser.cjs');

const MAX_CHARACTERS = 200;
const ID = /^[0-9a-f]{16}$/;
const CARD_FILE = 'card.json', PORTRAIT_FILE = 'portrait.png';
// Leftovers of an interrupted atomic write of one of this library's own two files.
const OWN_TEMP = /^(?:card\.json|portrait\.png)\.[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.tmp$/;
const CARD_KEYS = ['spec', 'name', 'description', 'personality', 'scenario', 'firstMessage', 'alternateGreetings', 'exampleDialogue',
  'systemPrompt', 'postHistoryInstructions', 'creatorNotes', 'creator', 'characterVersion', 'tags', 'characterBook', 'extensions', 'warnings'];
const fail = (message, code) => Object.assign(new Error(message), {code});
const isFile = file => { try { const stat = fs.lstatSync(file); return stat.isFile() && !stat.isSymbolicLink() ? stat : null; } catch { return null; } };
const isDirectory = dir => { try { const stat = fs.lstatSync(dir); return stat.isDirectory() && !stat.isSymbolicLink(); } catch { return false; } };

function cardHash({id, addedAt, updatedAt, spec, warnings, ...content}) {
  return libraryContentHash(content);
}
const portraitHash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

class CharacterLibrary {
  constructor({root, now = Date.now, maxCharacters = MAX_CHARACTERS} = {}) {
    if (typeof root !== 'string' || !path.isAbsolute(root)) throw fail('The character library needs an absolute directory.', 'character_library_invalid');
    if (!Number.isInteger(maxCharacters) || maxCharacters < 1 || maxCharacters > MAX_CHARACTERS) throw fail('Invalid character limit.', 'character_library_invalid');
    this.root = root; this.now = now; this.maxCharacters = maxCharacters;
  }

  #dir(id) {
    if (typeof id !== 'string' || !ID.test(id)) throw fail('Invalid character id.', 'character_id_invalid');
    return path.join(this.root, id);
  }

  #ids() {
    let entries;
    try { entries = fs.readdirSync(this.root, {withFileTypes: true}); } catch (error) { if (error.code === 'ENOENT') return []; throw error; }
    return entries.filter(entry => entry.isDirectory() && ID.test(entry.name)).map(entry => entry.name);
  }

  #read(id) {
    const file = path.join(this.#dir(id), CARD_FILE);
    const stat = isFile(file);
    if (!stat) return null;
    if (stat.size > MAX_JSON_BYTES) throw fail('The stored character is oversized.', 'character_library_corrupt');
    try {
      const stored = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (stored.id !== id || !Number.isSafeInteger(stored.addedAt) || !Number.isSafeInteger(stored.updatedAt)) throw Error('metadata');
      return {...revalidateCard(stored), id, addedAt: stored.addedAt, updatedAt: stored.updatedAt};
    } catch { throw fail('The stored character cannot be read.', 'character_library_corrupt'); }
  }

  #writeCard(id, card, addedAt, updatedAt) {
    const record = {...revalidateCard(card), id, addedAt, updatedAt};
    if (Buffer.byteLength(JSON.stringify(record, null, 2), 'utf8') > MAX_JSON_BYTES) throw fail('The character exceeds 2 MiB.', 'character_too_large');
    atomicJSON(path.join(this.#dir(id), CARD_FILE), record);
    return record;
  }

  #checkPortrait(portrait) {
    if (!Buffer.isBuffer(portrait) || !isPng(portrait)) throw fail('The portrait must be a PNG image.', 'character_portrait_invalid');
    if (portrait.length > MAX_PNG_BYTES) throw fail('The portrait exceeds 16 MiB.', 'character_portrait_invalid');
  }

  #writePortrait(id, portrait) {
    const file = path.join(this.#dir(id), PORTRAIT_FILE);
    const tmp = `${file}.${crypto.randomUUID()}.tmp`;
    try { fs.writeFileSync(tmp, portrait, {mode: 0o600}); fs.renameSync(tmp, file); }
    finally { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); }
  }

  #summary(record) {
    return {id: record.id, name: record.name, creator: record.creator, tags: [...record.tags], hasPortrait: Boolean(this.portraitPath(record.id)),
      hasBook: Boolean(record.characterBook?.entries.length), greetings: (record.firstMessage ? 1 : 0) + record.alternateGreetings.length,
      addedAt: record.addedAt, updatedAt: record.updatedAt};
  }

  /** Light summaries sorted by name. Corrupt or foreign directories are skipped. */
  list() {
    const result = [];
    for (const id of this.#ids()) {
      try { const record = this.#read(id); if (record) result.push(this.#summary(record)); } catch { /* skip corrupt entry */ }
    }
    return result.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  }

  /** Full stored card, or null when there is no such character. Throws for a corrupt entry. */
  get(id) {
    const record = this.#read(id);
    return record && {...record, hasPortrait: Boolean(this.portraitPath(id))};
  }

  #storedPortraitHash(id) {
    const file = path.join(this.#dir(id), PORTRAIT_FILE);
    let stat;
    try { stat = fs.lstatSync(file); }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
    if (!stat.isFile() || stat.size > MAX_PNG_BYTES) throw fail('Invalid stored portrait.', 'character_library_corrupt');
    const bytes = fs.readFileSync(file);
    this.#checkPortrait(bytes);
    return portraitHash(bytes);
  }

  /** Reuse one index for a synchronous import batch, hashing portraits only for matching card content. */
  batchImporter() {
    const cards = new Map();
    function groupFor(card) {
      const key = cardHash(card);
      if (!cards.has(key)) cards.set(key, {unread: [], portraits: new Map()});
      return cards.get(key);
    }
    for (const id of this.#ids()) {
      try {
        const record = this.#read(id);
        if (record) groupFor(record).unread.push(id);
      } catch { /* Unreadable entries remain untouched and still count toward capacity. */ }
    }
    return ({card, portrait = null} = {}) => {
      if (portrait !== null) this.#checkPortrait(portrait);
      const checked = revalidateCard(card), group = groupFor(checked);
      const key = portrait === null ? null : portraitHash(portrait);
      while (!group.portraits.has(key) && group.unread.length) {
        const id = group.unread.pop();
        try {
          const stored = this.#storedPortraitHash(id);
          if (!group.portraits.has(stored)) group.portraits.set(stored, id);
        }
        catch { /* An unreadable portrait cannot establish a match, even for a card without a portrait. */ }
      }
      if (group.portraits.has(key)) return {id: group.portraits.get(key), skipped: true};
      const {id} = this.add({card: checked, portrait});
      group.portraits.set(key, id);
      return {id, skipped: false};
    };
  }

  add({card, portrait = null, reservedId} = {}) {
    if (portrait !== null) this.#checkPortrait(portrait);
    const checked = revalidateCard(card);
    const existing = new Set(this.#ids());
    if (existing.size-(existing.has(reservedId)?1:0) >= this.maxCharacters) throw fail(`The library holds at most ${this.maxCharacters} characters.`, 'character_library_full');
    let id=reservedId;
    if(id!==undefined){
      this.#dir(id);
      if(this.get(id))throw fail('The reserved character already exists.','character_exists');
    }else do id = crypto.randomBytes(8).toString('hex'); while (existing.has(id));
    const at = this.now();
    const dir = this.#dir(id);
    fs.mkdirSync(dir, {recursive: true, mode: 0o700});
    try {
      if (portrait !== null) this.#writePortrait(id, portrait);
      const record = this.#writeCard(id, checked, at, at);
      return {...record, hasPortrait: portrait !== null};
    } catch (error) {
      this.remove(id);
      throw error;
    }
  }

  /** Patch card fields; `portrait` may be a PNG buffer to replace it or null to delete it. */
  update(id, patch) {
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw fail('Invalid character update.', 'character_update_invalid');
    const current = this.#read(id);
    if (!current) throw fail('No such character.', 'character_not_found');
    const {portrait, ...fields} = patch;
    if (Object.keys(fields).some(key => !CARD_KEYS.includes(key))) throw fail('Invalid character update.', 'character_update_invalid');
    if (portrait !== undefined && portrait !== null) this.#checkPortrait(portrait);
    const record = this.#writeCard(id, {...current, ...fields}, current.addedAt, this.now());
    if (portrait === null) { const file = this.portraitPath(id); if (file) fs.unlinkSync(file); }
    else if (portrait !== undefined) this.#writePortrait(id, portrait);
    return {...record, hasPortrait: Boolean(this.portraitPath(id))};
  }

  /** Deletes only this character's own files, then its (now empty) directory. Never recursive. */
  remove(id) {
    const dir = this.#dir(id);
    if (!isDirectory(dir)) return {removed: false, reason: 'not_found'};
    const names = fs.readdirSync(dir);
    const own = name => (name === CARD_FILE || name === PORTRAIT_FILE || OWN_TEMP.test(name)) && isFile(path.join(dir, name));
    if (!names.every(own)) return {removed: false, reason: 'unexpected_files'};
    for (const name of names) fs.unlinkSync(path.join(dir, name));
    fs.rmdirSync(dir);
    return {removed: true};
  }

  portraitFingerprint(id) {
    return this.#storedPortraitHash(id);
  }

  /** Reference source. Return null only for absence and reject damaged entries. */
  portraitSource(id) {
    const dir = this.#dir(id);
    if (!isDirectory(dir)) throw fail('Invalid stored portrait directory.', 'character_library_corrupt');
    const file = path.join(dir, PORTRAIT_FILE);
    const stat = fs.lstatSync(file,{throwIfNoEntry:false});
    if (!stat) return null;
    if (!stat.isFile() || stat.size > MAX_PNG_BYTES) throw fail('Invalid stored portrait.', 'character_library_corrupt');
    return file;
  }

  /** Absolute path of the stored portrait, or null. */
  portraitPath(id) {
    const file = path.join(this.#dir(id), PORTRAIT_FILE);
    return isFile(file) ? file : null;
  }
}

module.exports = {CharacterLibrary, MAX_CHARACTERS};
