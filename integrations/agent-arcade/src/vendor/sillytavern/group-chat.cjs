'use strict';
/*
 * Adapted from SillyTavern, https://github.com/SillyTavern/SillyTavern
 * Upstream paths:
 * - public/scripts/group-chats.js: `group_activation_strategy`, `group_generation_mode`, the
 *   strategy dispatch in `generateGroupWrapper` (enabled members, `force_chid`),
 *   `activateNaturalOrder`, `activateListOrder`, `activatePooledOrder`,
 *   `getGroupCharacterCardsLazy` (joined card fields);
 * - public/scripts/utils.js: `extractAllWords`, `shuffle`, `onlyUnique`.
 * Upstream revision: 06bde939fb1e9c4c8d8641d810f0a916b5bce127 (branch release)
 * License: GNU AGPL-3.0 (see LICENSE in the repository root).
 *
 * Modified for Agent Arcade on 2026-11-13:
 * - rewritten as pure CommonJS functions: no chat array, character list globals, DOM, events,
 *   generation loop, saving, auto mode, swipe / continue / impersonate / quiet selection;
 * - members are library character ids instead of avatar file names; the turn is described by
 *   `lastMessage` and a short `history` instead of the live chat and the input box, and a
 *   last message from the user stands for upstream's "user typed something";
 * - `Math.random` is an injectable `random`, consumed in upstream's order (shuffle, then one
 *   roll per candidate, then fallback picks);
 * - the natural-order self-response ban compares speaker ids, not display names;
 * - mention detection keeps upstream's ASCII word extraction and adds a substring match for
 *   the Han / kana / Hangul runs of a member name, which upstream's `\b\w+\b` never matches;
 *   mentions are ordered by position in the text;
 * - manual strategy: upstream picks a random member when triggered without user text; here it
 *   yields nobody unless the caller names `manualSpeakerId` (upstream `force_chid`, which is
 *   honoured for every strategy), and a muted member cannot be forced;
 * - the two join modes (include / exclude muted members) are one 'join' that excludes muted
 *   members other than the speaker; join prefix / suffix settings, the `<FIELDNAME>` token and
 *   the chat-level scenario / example overrides are not ported; in joined text only
 *   {{char}} / <BOT> / <CHAR> are resolved (to the owning member's name), other macros are
 *   left for the caller's macro pass;
 * - bounded names, member count, scanned text, history and field lengths.
 */

const LIMITS = Object.freeze({name: 60, members: 8, speakers: 8, field: 20000, mentionChars: 20000, history: 200, warnings: 20});
const STRATEGIES = Object.freeze(['natural', 'list', 'manual', 'pooled']);
const MODES = Object.freeze(['swap', 'join']);
const TALKATIVENESS_DEFAULT = 0.5;
const ID = /^[0-9a-f]{16}$/;
const CJK_RUN = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]+/gu;
const FIELDS = Object.freeze(['description', 'personality', 'scenario', 'exampleDialogue']);
const bad = message => Object.assign(new TypeError(message), {code: 'group_invalid'});
const isObject = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const pick = (raw, ...keys) => { for (const key of keys) if (raw[key] !== undefined) return raw[key]; return undefined; };

/**
 * Normalizes a group definition (camelCase, or upstream's snake_case fields with numeric
 * strategy / mode) into a frozen, bounded object. Throws `group_invalid` for a non-object or
 * a missing name.
 * @returns {{id?: string, name: string, members: string[], disabledMembers: string[],
 *   activationStrategy: 'natural'|'list'|'manual'|'pooled', allowSelfResponses: boolean,
 *   generationMode: 'swap'|'join', autoMode: false, warnings: string[]}}
 */
function normalizeGroup(raw) {
  if (!isObject(raw)) throw bad('A group must be an object.');
  const warnings = [];
  const warn = message => { if (warnings.length < LIMITS.warnings && !warnings.includes(message)) warnings.push(message); };
  if (typeof raw.name !== 'string' || !raw.name.trim()) throw bad('The group needs a name.');
  let name = raw.name.replace(/[\x00-\x1f\x7f]/g, ' ').trim();
  if (name.length > LIMITS.name) { name = name.slice(0, LIMITS.name); warn(`The group name was cut to ${LIMITS.name} characters.`); }

  const members = [];
  const rawMembers = Array.isArray(raw.members) ? raw.members : [];
  for (const member of rawMembers.slice(0, 200)) {
    if (typeof member !== 'string' || !ID.test(member)) { warn('A member that is not a library character id was dropped.'); continue; }
    if (members.includes(member)) continue;
    if (members.length >= LIMITS.members) { warn(`Only the first ${LIMITS.members} members were kept.`); break; }
    members.push(member);
  }
  const rawDisabled = pick(raw, 'disabledMembers', 'disabled_members');
  const disabledMembers = members.filter(member => Array.isArray(rawDisabled) && rawDisabled.includes(member));

  let activationStrategy = 'natural';
  const strategy = pick(raw, 'activationStrategy', 'activation_strategy');
  if (typeof strategy === 'string' && STRATEGIES.includes(strategy)) activationStrategy = strategy;
  else if (typeof strategy === 'number' && STRATEGIES[strategy]) activationStrategy = STRATEGIES[strategy];
  else if (strategy !== undefined && strategy !== null) warn('Unknown activation strategy; natural order is used.');

  let generationMode = 'swap';
  const mode = pick(raw, 'generationMode', 'generation_mode');
  if (typeof mode === 'string' && MODES.includes(mode)) generationMode = mode;
  else if (mode === 1) generationMode = 'join';
  else if (mode === 2) { generationMode = 'join'; warn('Joining the cards of muted members is not supported; muted members are left out of joined fields.'); }
  else if (mode !== undefined && mode !== null && mode !== 0) warn('Unknown generation mode; each speaker uses its own card.');
  if (generationMode === 'join' && (pick(raw, 'generation_mode_join_prefix', 'joinPrefix') || pick(raw, 'generation_mode_join_suffix', 'joinSuffix'))) warn('Join prefix and suffix are not supported and were ignored.');

  if (pick(raw, 'autoMode', 'auto_mode')) warn('Auto mode is not supported and stays off.');
  const result = {name, members: Object.freeze(members), disabledMembers: Object.freeze(disabledMembers), activationStrategy,
    allowSelfResponses: Boolean(pick(raw, 'allowSelfResponses', 'allow_self_responses')), generationMode, autoMode: false, warnings: Object.freeze(warnings)};
  return Object.freeze(typeof raw.id === 'string' && ID.test(raw.id) ? {id: raw.id, ...result} : result);
}

const groupOf = group => (isObject(group) && Object.isFrozen(group) && Array.isArray(group.members) && Array.isArray(group.disabledMembers) ? group : normalizeGroup(group));

function unit(random) {
  const value = Number(random());
  return Number.isFinite(value) && value >= 0 && value < 1 ? value : 0;
}

// Upstream `extractAllWords`: lower-cased ASCII word runs. `\w` is [A-Za-z0-9_], so a name
// written in CJK characters has no words at all.
function extractAllWords(value) {
  const words = [];
  if (typeof value !== 'string' || !value) return words;
  for (const match of value.matchAll(/\b\w+\b/g)) words.push({word: match[0].toLowerCase(), index: match.index});
  return words;
}

/**
 * Members mentioned in `text`, in order of first mention. `candidates` are `{id, name}` in
 * member order. Upstream rule: an input word activates the first member whose name contains
 * that word. Extension: each Han / kana / Hangul run of a name is searched as a substring.
 */
function findMentions(text, candidates) {
  const input = typeof text === 'string' ? text.slice(0, LIMITS.mentionChars) : '';
  if (!input) return [];
  const hits = [];
  const nameWords = candidates.map(candidate => new Set(extractAllWords(candidate.name).map(item => item.word)));
  for (const {word, index} of extractAllWords(input)) {
    const at = nameWords.findIndex(words => words.has(word));
    if (at >= 0) hits.push({index, order: at, id: candidates[at].id});
  }
  const lower = input.toLowerCase();
  candidates.forEach((candidate, order) => {
    let first = -1;
    for (const run of String(candidate.name).toLowerCase().match(CJK_RUN) || []) {
      const index = lower.indexOf(run);
      if (index >= 0 && (first < 0 || index < first)) first = index;
    }
    if (first >= 0) hits.push({index: first, order, id: candidate.id});
  });
  hits.sort((a, b) => a.index - b.index || a.order - b.order);
  return [...new Set(hits.map(hit => hit.id))];
}

/**
 * Chooses who replies to this turn. Pure: no model call, nothing stored.
 * @param {object} options group (normalized or raw); characters `[{id, name, talkativeness}]`
 *   (talkativeness 0-1, default 0.5); lastMessage `{role, speakerId, text}` or null; history
 *   `[{role, speakerId}]` newest last (pooled order only); random; manualSpeakerId
 * @returns {string[]} character ids in reply order, at most 8
 */
function pickSpeakers({group, characters = [], lastMessage = null, history = [], random = Math.random, manualSpeakerId} = {}) {
  const normalized = groupOf(group);
  if (!Array.isArray(characters)) throw bad('Characters must be a list.');
  if (typeof random !== 'function') random = Math.random;
  const byId = new Map();
  for (const character of characters.slice(0, 1000)) {
    if (!isObject(character) || typeof character.id !== 'string' || byId.has(character.id)) continue;
    const talk = Number(character.talkativeness);
    byId.set(character.id, {id: character.id, name: typeof character.name === 'string' ? character.name.slice(0, 200) : '',
      talkativeness: character.talkativeness === undefined || character.talkativeness === null || Number.isNaN(talk) ? TALKATIVENESS_DEFAULT : talk});
  }
  // Upstream: muted members never activate; a member without a character is skipped.
  const members = normalized.members.filter(member => !normalized.disabledMembers.includes(member) && byId.has(member));
  const done = list => [...new Set(list)].slice(0, LIMITS.speakers);
  if (manualSpeakerId !== undefined && manualSpeakerId !== null) return done(members.includes(manualSpeakerId) ? [manualSpeakerId] : []);
  if (!members.length) return [];
  const last = isObject(lastMessage) ? lastMessage : null;
  const isUserInput = last?.role === 'user';
  const lastSpeaker = last && !isUserInput && typeof last.speakerId === 'string' ? last.speakerId : null;
  const randomOf = list => list[Math.floor(unit(random) * list.length)];

  if (normalized.activationStrategy === 'manual') return [];
  if (normalized.activationStrategy === 'list') return done(members);

  if (normalized.activationStrategy === 'pooled') {
    // Upstream `activatePooledOrder`: someone who has not spoken since the user did, else
    // anyone but the last speaker.
    const spoken = new Set();
    if (!isUserInput) {
      const recent = (Array.isArray(history) ? history : []).slice(-LIMITS.history);
      for (let i = recent.length - 1; i >= 0; i--) {
        const message = recent[i];
        if (!isObject(message)) continue;
        if (message.role === 'user') break;
        if (message.role === 'assistant' && typeof message.speakerId === 'string') spoken.add(message.speakerId);
      }
      if (lastSpeaker) spoken.add(lastSpeaker);
    }
    const haveNotSpoken = members.filter(member => !spoken.has(member));
    if (haveNotSpoken.length) return [randomOf(haveNotSpoken)];
    const pool = members.length > 1 && lastSpeaker ? members.filter(member => member !== lastSpeaker) : members;
    return pool.length ? [randomOf(pool)] : [];
  }

  // Upstream `activateNaturalOrder`.
  const banned = normalized.allowSelfResponses ? null : lastSpeaker;
  const activated = findMentions(last && typeof last.text === 'string' ? last.text : '', members.filter(member => member !== banned).map(member => byId.get(member)));
  const shuffled = [...members];
  for (let current = shuffled.length; current !== 0;) {
    const index = Math.floor(unit(random) * current);
    current--;
    [shuffled[current], shuffled[index]] = [shuffled[index], shuffled[current]];
  }
  const chatty = [];
  for (const member of shuffled) {
    if (member === banned) continue;
    const roll = unit(random);
    const {talkativeness} = byId.get(member);
    if (talkativeness >= roll) activated.push(member);
    if (talkativeness > 0) chatty.push(member);
  }
  // Nobody activated: one at random, preferring members that can talk at all. As upstream,
  // only the all-silent fallback pool can still hold the banned last speaker.
  if (!activated.length) { const pool = chatty.length ? chatty : members; activated.push(randomOf(pool)); }
  return done(activated);
}

/**
 * The card fields the speaker's prompt should use under the group's generation mode.
 * 'swap': the speaker's own. 'join' (upstream `getGroupCharacterCardsLazy` without affixes):
 * each field of every enabled member, plus the speaker even when muted, trimmed, with
 * {{char}} resolved to that member's name, joined by a line break; example dialogue blocks
 * get a leading "<START>" line when they lack one.
 * @param {object} options group; characters `[{id, name, description, personality, scenario,
 *   exampleDialogue}]` or `[{id, card: {...}}]`; speakerId
 * @returns {{description: string, personality: string, scenario: string, exampleDialogue: string, warnings: string[]}} frozen
 */
function groupCardFields({group, characters = [], speakerId} = {}) {
  const normalized = groupOf(group);
  if (!Array.isArray(characters)) throw bad('Characters must be a list.');
  const byId = new Map();
  for (const item of characters.slice(0, 1000)) {
    if (!isObject(item) || typeof item.id !== 'string' || byId.has(item.id)) continue;
    const card = isObject(item.card) ? item.card : item;
    const entry = {name: typeof card.name === 'string' ? card.name.slice(0, 200) : ''};
    for (const field of FIELDS) entry[field] = typeof card[field] === 'string' ? card[field] : '';
    byId.set(item.id, entry);
  }
  const speaker = byId.get(speakerId);
  if (!speaker) throw bad('The speaker is not among the characters.');
  const warnings = [];
  const bound = (field, value) => {
    if (value.length <= LIMITS.field) return value;
    warnings.push(`The ${normalized.generationMode === 'join' ? 'joined ' : ''}${field} was cut to ${LIMITS.field} characters.`);
    return value.slice(0, LIMITS.field);
  };
  const result = {};
  if (normalized.generationMode !== 'join') {
    for (const field of FIELDS) result[field] = bound(field, speaker[field]);
  } else {
    for (const field of FIELDS) {
      const values = [];
      let size = 0;
      for (const member of normalized.members) {
        const character = byId.get(member);
        if (!character) continue;
        if (normalized.disabledMembers.includes(member) && member !== speakerId) continue;
        if (size > LIMITS.field) break; // already past the bound; the cut below reports it
        let value = character[field].slice(0, LIMITS.field + 1).trim();
        if (!value) continue;
        if (field === 'exampleDialogue' && !value.startsWith('<START>')) value = `<START>\n${value}`;
        value = value.replace(/\{\{char\}\}|<BOT>|<CHAR>/gi, () => character.name).trim();
        if (!value) continue;
        values.push(value);
        size += value.length + 1;
      }
      result[field] = bound(field, values.join('\n'));
    }
  }
  return Object.freeze({...result, warnings: Object.freeze(warnings)});
}

module.exports = {LIMITS, STRATEGIES, TALKATIVENESS_DEFAULT, normalizeGroup, pickSpeakers, groupCardFields, extractAllWords, findMentions};
