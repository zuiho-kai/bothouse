'use strict';
/*
 * Adapted from SillyTavern, https://github.com/SillyTavern/SillyTavern
 * Upstream paths and functions:
 * - src/endpoints/characters.js: `getCharaCardV2`, `convertToV2`, `readFromV2`, `charaFormatData`
 *   (V1 flat fields to V2 data, data fields taking precedence over flat ones, tag and alternate
 *   greeting coercion) and `convertWorldInfoToCharacterBook` (character_book entry layout);
 * - src/validator/TavernCardValidator.js: V1 / V2 / V3 detection rules;
 * - public/scripts/world-info.js: `convertCharacterBook` (entry id, keys, enabled, position,
 *   case sensitivity and order defaults of an embedded character_book).
 * Upstream revision: 06bde939fb1e9c4c8d8641d810f0a916b5bce127 (branch release)
 * License: GNU AGPL-3.0 (see LICENSE in the repository root).
 *
 * Modified for Agent Arcade on 2026-11-13:
 * - rewritten as one CommonJS module without lodash, Express, user directories, chat files,
 *   avatars or world-info files; nothing is read from or written to disk here;
 * - the result is a single frozen, bounded structure with camelCase field names instead of
 *   SillyTavern's mutable character object; over-long text is truncated with a warning;
 * - lorebook entries carry the matching fields plus, as explicit bounded typed fields, the
 *   SillyTavern entry settings the activation engine uses (extended 2026-11-13: placement,
 *   depth, role, selective logic, probability, inclusion group, sticky / cooldown / delay, scan
 *   depth, whole-word matching, recursion flags, ignore-budget); outlets, vector flags,
 *   automation ids, triggers, character filters and group scoring are not carried;
 * - `normalizeCharacterBook` exposes the lorebook normalizer for standalone lorebooks;
 * - `extensions` is kept only as size-capped inert JSON and is never interpreted or executed;
 * - `toCardObject` writes a plain V2 / V3 envelope without SillyTavern's private flat fields
 *   (chat, avatar, fav, talkativeness, depth prompt, json_data).
 */

const LIMITS = Object.freeze({
  name: 80, text: 20000, creatorNotes: 4000, creator: 200, characterVersion: 80,
  greetings: 20, tags: 50, tag: 60, extensionsBytes: 64 * 1024, warnings: 60,
  bookName: 200, bookEntries: 500, entryContent: 8000, entryKeys: 30, entryKey: 100, entryComment: 500, entryGroup: 200,
});
const SPECS = Object.freeze(['chara_card_v1', 'chara_card_v2', 'chara_card_v3']);
const bad = message => Object.assign(new Error(message), {code: 'character_card_invalid'});
const isObject = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const CONTROL = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g;

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) deepFreeze(value[key]);
  }
  return value;
}

function collector() {
  const list = [];
  const warn = message => { if (list.length < LIMITS.warnings && !list.includes(message)) list.push(message); };
  return {list, warn};
}

function text(value, max, label, warn) {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') { warn(`Ignored ${label}: it is not text.`); return ''; }
  let result = value.replace(CONTROL, '');
  if (result.length > max) { result = result.slice(0, max); warn(`Shortened ${label} to ${max} characters.`); }
  return result;
}

function strings(value, {maxItems, maxLength, label, warn, truncate}) {
  // As upstream: a single string is accepted where an array is expected.
  const source = Array.isArray(value) ? value : typeof value === 'string' ? [value] : [];
  if (value !== undefined && value !== null && !Array.isArray(value) && typeof value !== 'string') warn(`Ignored ${label}: not a list.`);
  const result = [];
  for (const item of source) {
    if (typeof item !== 'string') { warn(`Ignored a non-text item in ${label}.`); continue; }
    let entry = item.replace(CONTROL, '');
    if (!truncate) entry = entry.trim();
    if (!entry) continue;
    if (entry.length > maxLength) {
      if (!truncate) { warn(`Dropped an item longer than ${maxLength} characters from ${label}.`); continue; }
      entry = entry.slice(0, maxLength); warn(`Shortened an item in ${label} to ${maxLength} characters.`);
    }
    if (result.length >= maxItems) { warn(`Kept only the first ${maxItems} items of ${label}.`); break; }
    result.push(entry);
  }
  return result;
}

function tags(value, warn) {
  // Upstream `charaFormatData` splits a comma-separated tag string.
  const list = typeof value === 'string' ? value.split(',') : value;
  const result = [];
  for (const tag of strings(list, {maxItems: Infinity, maxLength: Infinity, label: 'tags', warn})) {
    let entry = tag;
    if (entry.length > LIMITS.tag) { entry = entry.slice(0, LIMITS.tag); warn(`Shortened a tag to ${LIMITS.tag} characters.`); }
    if (result.includes(entry)) continue;
    if (result.length >= LIMITS.tags) { warn(`Kept only the first ${LIMITS.tags} tags.`); break; }
    result.push(entry);
  }
  return result;
}

function inertJSON(value, label, warn) {
  if (value === undefined || value === null) return {};
  if (!isObject(value)) { warn(`Ignored ${label}: not an object.`); return {}; }
  try {
    const encoded = JSON.stringify(value);
    if (Buffer.byteLength(encoded, 'utf8') > LIMITS.extensionsBytes) { warn(`Dropped ${label}: larger than ${LIMITS.extensionsBytes / 1024} KiB.`); return {}; }
    // JSON round trip: plain data only, no functions, accessors or shared references.
    return JSON.parse(encoded);
  } catch { warn(`Dropped ${label}: not plain JSON.`); return {}; }
}

const integer = (value, min, max) => typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, Math.trunc(value))) : null;
// Upstream numeric enums (world_info_position, world_info_logic, extension_prompt_roles) as names.
const PLACEMENTS = Object.freeze(['before', 'after', 'an_top', 'an_bottom', 'at_depth', 'em_top', 'em_bottom', 'outlet']);
const SELECTIVE_LOGICS = Object.freeze(['and_any', 'not_all', 'not_any', 'and_all']);
const ROLES = Object.freeze(['system', 'user', 'assistant']);
const flag = value => typeof value === 'boolean' ? value : null;

// SillyTavern entry settings (upstream `convertCharacterBook` defaults), bounded and typed.
function entrySettings(raw, extensions, warn) {
  const stPosition = extensions.position;
  const recursionDelay = extensions.delay_until_recursion;
  return {
    placement: PLACEMENTS[typeof stPosition === 'number' ? stPosition : raw.position === 'before_char' ? 0 : 1] ?? 'after',
    depth: integer(extensions.depth, 0, 1000) ?? 4,
    role: ROLES[extensions.role] ?? 'system',
    selectiveLogic: SELECTIVE_LOGICS[extensions.selectiveLogic] ?? 'and_any',
    probability: integer(extensions.probability, 0, 100) ?? 100,
    useProbability: flag(extensions.useProbability) ?? true,
    group: text(extensions.group, LIMITS.entryGroup, 'a lorebook group', warn).trim(),
    groupOverride: extensions.group_override === true,
    groupWeight: integer(extensions.group_weight, 0, 10000) ?? 100,
    sticky: integer(extensions.sticky, 0, 100000),
    cooldown: integer(extensions.cooldown, 0, 100000),
    delay: integer(extensions.delay, 0, 100000),
    scanDepth: integer(extensions.scan_depth, 0, 1000),
    matchWholeWords: flag(extensions.match_whole_words),
    excludeRecursion: extensions.exclude_recursion === true,
    preventRecursion: extensions.prevent_recursion === true,
    delayUntilRecursion: recursionDelay === true ? 1 : integer(recursionDelay, 0, 10) ?? 0,
    ignoreBudget: extensions.ignore_budget === true,
  };
}

function characterBook(value, warn) {
  if (value === undefined || value === null) return null;
  // Upstream validator: a character book needs an `entries` array.
  if (!isObject(value) || !Array.isArray(value.entries)) { warn('Ignored character_book: it has no entry list.'); return null; }
  const entries = [];
  const used = new Set();
  let next = 0;
  for (const [index, raw] of value.entries.entries()) {
    if (entries.length >= LIMITS.bookEntries) { warn(`Kept only the first ${LIMITS.bookEntries} lorebook entries.`); break; }
    if (!isObject(raw)) { warn('Ignored a lorebook entry that is not an object.'); continue; }
    const extensions = isObject(raw.extensions) ? raw.extensions : {};
    // Upstream assigns the array index when an entry has no id. Ids are also made unique here.
    let id = Number.isSafeInteger(raw.id) && raw.id >= 0 ? raw.id : index;
    if (used.has(id)) { while (used.has(next)) next++; id = next; }
    used.add(id);
    const keyOptions = {maxItems: LIMITS.entryKeys, maxLength: LIMITS.entryKey, warn};
    const stPosition = extensions.position;
    const caseSensitive = extensions.case_sensitive ?? raw.case_sensitive;
    const comment = text(raw.comment, LIMITS.entryComment, 'a lorebook comment', warn) || text(raw.name, LIMITS.entryComment, 'a lorebook entry name', warn);
    entries.push({
      id,
      keys: strings(raw.keys, {...keyOptions, label: 'lorebook keys'}),
      secondaryKeys: strings(raw.secondary_keys, {...keyOptions, label: 'lorebook secondary keys'}),
      content: text(raw.content, LIMITS.entryContent, 'a lorebook entry', warn),
      // Upstream: `disable: !entry.enabled`, so a missing flag means disabled.
      enabled: Boolean(raw.enabled),
      constant: Boolean(raw.constant),
      selective: Boolean(raw.selective),
      insertionOrder: integer(raw.insertion_order, -1000000, 1000000) ?? 100,
      // Upstream: the SillyTavern numeric position wins; 0 is "before character definitions".
      position: (typeof stPosition === 'number' ? stPosition === 0 : raw.position === 'before_char') ? 'before_char' : 'after_char',
      caseSensitive: typeof caseSensitive === 'boolean' ? caseSensitive : null,
      comment,
      priority: integer(raw.priority, -1000000, 1000000),
      ...entrySettings(raw, extensions, warn),
    });
  }
  return {
    name: text(value.name, LIMITS.bookName, 'the lorebook name', warn),
    scanDepth: integer(value.scan_depth, 0, 1000),
    tokenBudget: integer(value.token_budget, 0, 1000000),
    recursiveScanning: Boolean(value.recursive_scanning),
    entries,
  };
}

/**
 * Normalizes a standalone character_book object (untrusted data) with the same bounds.
 * @returns {{book: object|null, warnings: string[]}} frozen
 */
function normalizeCharacterBook(value) {
  const {list: warnings, warn} = collector();
  return deepFreeze({book: characterBook(value, warn), warnings});
}

// Inverse of `entrySettings`; only fields present on the entry are written.
function entryExtensions(entry) {
  const out = {};
  const put = (key, value) => { if (value !== undefined && value !== null) out[key] = value; };
  const index = (list, value) => { const at = list.indexOf(value); return at < 0 ? undefined : at; };
  put('position', index(PLACEMENTS, entry.placement));
  put('depth', entry.depth); put('role', index(ROLES, entry.role));
  put('selectiveLogic', index(SELECTIVE_LOGICS, entry.selectiveLogic));
  put('probability', entry.probability); put('useProbability', entry.useProbability);
  put('group', entry.group); put('group_override', entry.groupOverride); put('group_weight', entry.groupWeight);
  put('sticky', entry.sticky); put('cooldown', entry.cooldown); put('delay', entry.delay);
  put('scan_depth', entry.scanDepth); put('match_whole_words', entry.matchWholeWords);
  put('exclude_recursion', entry.excludeRecursion); put('prevent_recursion', entry.preventRecursion);
  put('delay_until_recursion', entry.delayUntilRecursion); put('ignore_budget', entry.ignoreBudget);
  return out;
}

/**
 * Normalizes a parsed V1, V2 or V3 character card object. The input is untrusted data.
 * @param {object} raw parsed card JSON
 * @returns {object} frozen normalized card
 */
function normalizeCard(raw) {
  if (!isObject(raw)) throw bad('Invalid character card.');
  const {list: warnings, warn} = collector();
  let spec, data;
  if (raw.spec === undefined || raw.spec === null) {
    spec = 'chara_card_v1'; data = raw;
  } else if (raw.spec === 'chara_card_v2' || raw.spec === 'chara_card_v3') {
    if (!isObject(raw.data)) throw bad('The character card has no data.');
    spec = raw.spec; data = raw.data;
    if (spec === 'chara_card_v2' && raw.spec_version !== '2.0') warn('Unexpected Character Card V2 version; read as 2.0.');
    if (spec === 'chara_card_v3' && !(Number(raw.spec_version) >= 3 && Number(raw.spec_version) < 4)) warn('Unexpected Character Card V3 version; read as 3.0.');
  } else throw bad('Use a Character Card V1, V2 or V3 file.');
  // Upstream `readFromV2`: V2 data wins; flat V1 fields fill what the data block lacks.
  const pick = (key, ...flat) => {
    if (data[key] !== undefined && data[key] !== null) return data[key];
    for (const name of data === raw ? flat : [key, ...flat]) if (raw[name] !== undefined && raw[name] !== null) return raw[name];
    return undefined;
  };
  const rawName = pick('name');
  if (typeof rawName !== 'string') throw bad('The character card has no name.');
  const name = rawName.replace(/[\x00-\x1f\x7f]/g, ' ').trim();
  if (!name) throw bad('The character card has no name.');
  if (name.length > LIMITS.name) throw bad(`The character name exceeds ${LIMITS.name} characters.`);
  const field = (key, label, ...flat) => text(pick(key, ...flat), LIMITS.text, label, warn);
  const card = {
    spec,
    name,
    description: field('description', 'the description'),
    personality: field('personality', 'the personality'),
    scenario: field('scenario', 'the scenario'),
    firstMessage: field('first_mes', 'the first message'),
    alternateGreetings: strings(data.alternate_greetings, {maxItems: LIMITS.greetings, maxLength: LIMITS.text, label: 'alternate greetings', warn, truncate: true}),
    exampleDialogue: field('mes_example', 'the example dialogue'),
    systemPrompt: text(data.system_prompt, LIMITS.text, 'the system prompt', warn),
    postHistoryInstructions: text(data.post_history_instructions, LIMITS.text, 'the post-history instructions', warn),
    // Upstream `convertToV2`: V1 cards keep creator notes in `creatorcomment`.
    creatorNotes: text(pick('creator_notes', 'creatorcomment'), LIMITS.creatorNotes, 'the creator notes', warn),
    creator: text(pick('creator'), LIMITS.creator, 'the creator', warn).trim(),
    characterVersion: text(data.character_version, LIMITS.characterVersion, 'the character version', warn).trim(),
    tags: tags(pick('tags'), warn),
    characterBook: characterBook(data.character_book, warn),
    extensions: inertJSON(data.extensions, 'extensions', warn),
    warnings,
  };
  return deepFreeze(card);
}

/** Builds a character_book object (spec layout, SillyTavern settings in `extensions`) from a normalized book. */
function toCharacterBookObject(book) {
  if (!isObject(book)) throw bad('Invalid lorebook.');
  const result = {
    name: book.name || '', extensions: {}, recursive_scanning: Boolean(book.recursiveScanning),
    entries: !Array.isArray(book.entries) ? book.entries : book.entries.filter(isObject).map(entry => {
      const out = {
        id: entry.id, keys: entry.keys, secondary_keys: entry.secondaryKeys, comment: entry.comment,
        content: entry.content, constant: Boolean(entry.constant), selective: Boolean(entry.selective),
        insertion_order: entry.insertionOrder, enabled: Boolean(entry.enabled), position: entry.position, extensions: entryExtensions(entry),
      };
      if (typeof entry.caseSensitive === 'boolean') out.case_sensitive = entry.caseSensitive;
      if (typeof entry.priority === 'number') out.priority = entry.priority;
      return out;
    }),
  };
  if (typeof book.scanDepth === 'number') result.scan_depth = book.scanDepth;
  if (typeof book.tokenBudget === 'number') result.token_budget = book.tokenBudget;
  return result;
}

/**
 * Builds a Character Card V2 or V3 object from a normalized card.
 * @param {object} card normalized card
 * @param {'v2'|'v3'} format target specification
 */
function toCardObject(card, format = 'v2') {
  if (!['v2', 'v3'].includes(format)) throw bad('Unsupported export format.');
  if (!isObject(card)) throw bad('Invalid character card.');
  const data = {
    name: card.name, description: card.description, personality: card.personality, scenario: card.scenario,
    first_mes: card.firstMessage, mes_example: card.exampleDialogue,
    creator_notes: card.creatorNotes, system_prompt: card.systemPrompt, post_history_instructions: card.postHistoryInstructions,
    alternate_greetings: card.alternateGreetings, tags: card.tags,
    creator: card.creator, character_version: card.characterVersion,
    extensions: isObject(card.extensions) ? card.extensions : {},
  };
  if (isObject(card.characterBook)) data.character_book = toCharacterBookObject(card.characterBook);
  if (format === 'v3') Object.assign(data, {group_only_greetings: [], assets: []});
  return {spec: format === 'v3' ? 'chara_card_v3' : 'chara_card_v2', spec_version: format === 'v3' ? '3.0' : '2.0', data};
}

/**
 * Re-applies every bound to an already normalized card (for stored or edited cards).
 * The original `spec` and bounded prior warnings are kept.
 */
function revalidateCard(card) {
  if (!isObject(card)) throw bad('Invalid character card.');
  const fresh = normalizeCard(toCardObject(card, 'v3'));
  const {list, warn} = collector();
  for (const message of Array.isArray(card.warnings) ? card.warnings : []) if (typeof message === 'string') warn(message.replace(CONTROL, '').slice(0, 300));
  for (const message of fresh.warnings) warn(message);
  return deepFreeze({...fresh, spec: SPECS.includes(card.spec) ? card.spec : 'chara_card_v3', warnings: list});
}

module.exports = {LIMITS, SPECS, PLACEMENTS, SELECTIVE_LOGICS, ROLES, normalizeCard, normalizeCharacterBook, toCharacterBookObject, toCardObject, revalidateCard};
