'use strict';
// Settings of the App conversation's imported-character (SillyTavern-style) pipeline.
// One strict, versioned JSON document per profile: <localRoot>/st-settings.json. Everything
// here is the owner's own configuration; card, lorebook and preset TEXT stays untrusted data
// and is only ever copied into prompt strings by prompt-builder.cjs.
const fs = require('node:fs');
const {atomicJSON} = require('../../core/files.cjs');
const {DEFAULT_PRESET} = require('./prompt-builder.cjs');
const {validatePreset} = require('./presets.cjs');
const {CHAT_PROMPT_CHARS, RANGES} = require('../generation.cjs');
const {publicCatalog} = require('../../core/personas.cjs');

const VERSION = 1;
const MAX_FILE_BYTES = 200000;
const ID = /^[0-9a-f]{16}$/;
const CONTROL = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/;
const LIMITS = Object.freeze({
  userName: 40, userDescription: 2000, lorebooks: 10, noteText: 2000, noteDepth: [0, 100], greeting: [0, 100],
  contextChars: [4000, CHAT_PROMPT_CHARS], budgetChars: [500, 12000], scanDepth: [1, 20],
});
const ROLES = ['system', 'user', 'assistant'];
const KEYS = ['version', 'characterId', 'greeting', 'user', 'lorebookIds', 'useCharacterBook', 'authorsNote', 'preset', 'sampling', 'contextChars', 'worldInfo', 'regex', 'streaming', 'branchId', 'groupId', 'wikiAccess', 'builtinPersonaId'];
// wikiAccess keys: a library character id or a built-in persona id.
const ACCESS_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const MAX_WIKI_ACCESS = 200;
const NESTED = Object.freeze({user: ['name', 'description'], authorsNote: ['text', 'depth', 'role'], sampling: ['temperature', 'topP', 'maxTokens'], worldInfo: ['budgetChars', 'scanDepth', 'recursive'], regex: ['enabled']});
const bad = message => Object.assign(new Error(message), {code: 'st_settings_invalid'});
const isObject = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

function presetShape(value) {
  try { return validatePreset(value); } catch { throw bad('Invalid preset.'); }
}
function defaults() {
  return {
    version: VERSION, characterId: null, builtinPersonaId: null, greeting: 0, user: {name: '你', description: ''}, lorebookIds: [], useCharacterBook: true,
    authorsNote: {text: '', depth: 4, role: 'system'}, preset: presetShape({name: DEFAULT_PRESET.name}),
    sampling: {temperature: null, topP: null, maxTokens: null}, contextChars: CHAT_PROMPT_CHARS,
    worldInfo: {budgetChars: 6000, scanDepth: 2, recursive: true},
    // Added later without a version change: a file written before them simply takes these
    // defaults. regex: run the regex-script library; streaming: show a reply while it arrives;
    // branchId: the active branch of the selected character's conversation (null = main).
    // groupId: a group chat (st/group-library.cjs) as the conversation target. While it is set
    // the conversation is the group's: characterId stays stored but unused, and branchId is null
    // (group conversations have no branches).
    regex: {enabled: true}, streaming: true, branchId: null, groupId: null,
    // wikiAccess: per character, whether it may read the owner's memory wiki in its prompt and
    // whether it may be asked to propose changes to it (companion-knowledge.cjs). A character
    // without an entry has both switched off. At most 200 entries; replaced whole by patch().
    wikiAccess: {},
  };
}
function wikiAccessShape(value) {
  if (!isObject(value) || Object.keys(value).length > MAX_WIKI_ACCESS) throw bad('Invalid wiki access.');
  const result = {};
  for (const [id, item] of Object.entries(value)) {
    if (!ACCESS_ID.test(id) || !isObject(item) || Object.keys(item).length !== 2 || typeof item.read !== 'boolean' || typeof item.propose !== 'boolean') throw bad('Invalid wiki access.');
    result[id] = {read: item.read, propose: item.propose};
  }
  return result;
}
const integer = (value, [min, max], label) => {
  if (!Number.isInteger(value) || value < min || value > max) throw bad(`Invalid ${label}.`);
  return value;
};
const text = (value, max, label) => {
  if (typeof value !== 'string' || value.length > max || CONTROL.test(value)) throw bad(`Invalid ${label}.`);
  return value;
};
const flag = (value, label) => { if (typeof value !== 'boolean') throw bad(`Invalid ${label}.`); return value; };
function section(value, key) {
  if (!isObject(value) || Object.keys(value).some(name => !NESTED[key].includes(name))) throw bad(`Invalid ${key}.`);
  return value;
}

/**
 * Strict validation. Unknown keys (top level and nested), wrong types and out-of-range values
 * are rejected; a missing key takes its default. Returns a fresh plain object (`preset` frozen).
 */
function validate(value) {
  if (!isObject(value) || Object.keys(value).some(key => !KEYS.includes(key))) throw bad('Invalid settings.');
  const base = defaults();
  if (value.version !== undefined && value.version !== VERSION) throw bad('These settings were written by a different app version.');
  const characterId = value.characterId === undefined ? base.characterId : value.characterId;
  if (characterId !== null && (typeof characterId !== 'string' || !ID.test(characterId))) throw bad('Invalid character.');
  const builtinPersonaId = value.builtinPersonaId === undefined ? null : value.builtinPersonaId;
  if (builtinPersonaId !== null && !publicCatalog().some(persona => persona.id === builtinPersonaId)) throw bad('Invalid built-in persona.');
  const user = {...base.user, ...section(value.user ?? {}, 'user')};
  const name = text(user.name, LIMITS.userName, 'user name');
  if (!name.trim() || /[\r\n\t]/.test(name) || name !== name.trim()) throw bad('Invalid user name.');
  const lorebookIds = value.lorebookIds === undefined ? base.lorebookIds : value.lorebookIds;
  if (!Array.isArray(lorebookIds) || lorebookIds.length > LIMITS.lorebooks || lorebookIds.some(id => typeof id !== 'string' || !ID.test(id)) || new Set(lorebookIds).size !== lorebookIds.length) throw bad('Invalid lorebook selection.');
  const note = {...base.authorsNote, ...section(value.authorsNote ?? {}, 'authorsNote')};
  if (!ROLES.includes(note.role)) throw bad('Invalid author\'s note role.');
  const sampling = {...base.sampling, ...section(value.sampling ?? {}, 'sampling')};
  for (const [key, [min, max]] of Object.entries(RANGES)) {
    const item = sampling[key];
    if (item === null) continue;
    if (typeof item !== 'number' || !Number.isFinite(item) || item < min || item > max || (key === 'maxTokens' && !Number.isInteger(item))) throw bad(`Invalid sampling ${key}.`);
  }
  const worldInfo = {...base.worldInfo, ...section(value.worldInfo ?? {}, 'worldInfo')};
  const regex = {...base.regex, ...section(value.regex ?? {}, 'regex')};
  const branchId = value.branchId === undefined ? base.branchId : value.branchId;
  if (branchId !== null && (typeof branchId !== 'string' || !ID.test(branchId))) throw bad('Invalid branch.');
  if (branchId !== null && characterId === null) throw bad('A branch needs a character.');
  const groupId = value.groupId === undefined ? base.groupId : value.groupId;
  if (groupId !== null && (typeof groupId !== 'string' || !ID.test(groupId))) throw bad('Invalid group.');
  if (groupId !== null && branchId !== null) throw bad('A group conversation has no branches.');
  return {
    version: VERSION, characterId, builtinPersonaId,
    greeting: integer(value.greeting ?? base.greeting, LIMITS.greeting, 'greeting'),
    user: {name, description: text(user.description, LIMITS.userDescription, 'user description')},
    lorebookIds: [...lorebookIds],
    useCharacterBook: flag(value.useCharacterBook ?? base.useCharacterBook, 'useCharacterBook'),
    authorsNote: {text: text(note.text, LIMITS.noteText, 'author\'s note'), depth: integer(note.depth, LIMITS.noteDepth, 'author\'s note depth'), role: note.role},
    preset: value.preset === undefined ? base.preset : presetShape(isObject(value.preset) ? value.preset : null),
    sampling: {temperature: sampling.temperature, topP: sampling.topP, maxTokens: sampling.maxTokens},
    contextChars: integer(value.contextChars ?? base.contextChars, LIMITS.contextChars, 'contextChars'),
    worldInfo: {budgetChars: integer(worldInfo.budgetChars, LIMITS.budgetChars, 'lorebook budget'), scanDepth: integer(worldInfo.scanDepth, LIMITS.scanDepth, 'lorebook scan depth'), recursive: flag(worldInfo.recursive, 'lorebook recursion')},
    regex: {enabled: flag(regex.enabled, 'regex scripts')}, streaming: flag(value.streaming ?? base.streaming, 'streaming'), branchId, groupId,
    wikiAccess: wikiAccessShape(value.wikiAccess ?? base.wikiAccess),
  };
}

/**
 * Applies a partial change and validates the merged result. `user`, `authorsNote`, `sampling`
 * `worldInfo` and `regex` merge key by key; `preset` and `lorebookIds` are replaced whole.
 * A branch belongs to one character: changing `characterId` returns to the main conversation
 * unless the same change names a branch. Selecting a group also returns to the main
 * conversation; naming a branch together with a group is invalid.
 */
function patch(current, partial) {
  if (!isObject(partial) || Object.keys(partial).some(key => !KEYS.includes(key))) throw bad('Invalid settings change.');
  const base = validate(current);
  const next = {...base, ...partial};
  if (partial.characterId !== undefined && partial.characterId !== base.characterId && partial.branchId === undefined) next.branchId = null;
  if (partial.groupId !== undefined && partial.groupId !== null && partial.branchId === undefined) next.branchId = null;
  for (const key of Object.keys(NESTED)) if (partial[key] !== undefined) next[key] = {...base[key], ...section(partial[key], key)};
  return validate(next);
}

/** Tolerant read: a missing file gives defaults; an unreadable or invalid one gives defaults plus `problem`. */
function load(file) {
  let stat;
  try { stat = fs.lstatSync(file); } catch (error) { return {settings: defaults(), problem: error.code === 'ENOENT' ? null : 'unreadable'}; }
  try {
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_FILE_BYTES) throw bad('Invalid settings file.');
    return {settings: validate(JSON.parse(fs.readFileSync(file, 'utf8'))), problem: null};
  } catch { return {settings: defaults(), problem: 'invalid'}; }
}

/** Validates, then writes atomically. Returns the stored value. */
function save(file, value) {
  const checked = validate(value);
  atomicJSON(file, checked);
  return checked;
}

module.exports = {VERSION, LIMITS, MAX_WIKI_ACCESS, defaults, validate, patch, load, save};
