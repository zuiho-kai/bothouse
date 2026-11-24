'use strict';
/*
 * Adapted from SillyTavern, https://github.com/SillyTavern/SillyTavern
 * Upstream path: public/scripts/world-info.js
 * - `checkWorldInfo`: the scan loop (entry suppression order, constant / sticky / decorator
 *   activation, primary keys, selective secondary keys with AND ANY / NOT ALL / NOT ANY /
 *   AND ALL, sticky-first ordering, probability rolls, budget overflow, recursion with
 *   exclude / prevent / delay-until-recursion levels, final placement by insertion order);
 * - `WorldInfoBuffer` (`get`, `matchKeys`): scan text assembly and key matching;
 * - `WorldInfoTimedEffects`: sticky / cooldown / delay bookkeeping;
 * - `filterByInclusionGroups`, `filterGroupsByTimedEffects`: inclusion groups;
 * - `parseRegexFromString`, `parseDecorators`, `getSortedEntries` (insertion strategies).
 * Upstream revision: 06bde939fb1e9c4c8d8641d810f0a916b5bce127 (branch release)
 * License: GNU AGPL-3.0 (see LICENSE in the repository root).
 *
 * Modified for Agent Arcade on 2026-11-13:
 * - rewritten as one synchronous CommonJS function over already normalized entries; no DOM,
 *   settings globals, events, extension prompts, slash commands, editor or file access;
 * - timed effects live in a small serialisable `state` object passed in and returned, instead
 *   of chat metadata; the upstream clock (chat length in messages) is `2 * turn + 1` unless the
 *   caller passes `chatLength`; effects are keyed by entry key, not by content hash;
 * - budgets are counted in characters, not tokens; an entry that would overflow is skipped and
 *   later entries are not added, as upstream; the comparison is `>` instead of upstream's `>=`;
 * - regex keys are attacker-controlled data here: pattern length is capped, backreferences,
 *   nested and alternation-bearing repeated groups are refused, any pattern with a repetition
 *   runs under a hard per-test timeout, and the whole scan has a time budget;
 * - hard caps on entries, activations, scanned text, recursion loops and tracked effects;
 * - Author's Note top / bottom entries become at-depth entries, example-message entries go
 *   after the character definitions, outlet entries are dropped; each fallback warns once;
 * - NOT ported: group scoring, min activations, generation-type triggers, character / tag
 *   filters, per-entry match-persona / description / scenario flags (one opt-in
 *   `extraScanText` replaces them), external activations, automation ids, vectorized entries,
 *   regex-script post-processing, outlets;
 * - not reproduced: upstream removes the wrong entry when an inclusion-group loser was already
 *   removed through another group, lets such a removed entry win a later group, and on a
 *   recursion pass does not see that an entry listed in several groups already won one.
 */

const {substituteMacros} = require('./macros.cjs');
// The pattern screen and the timeout guard are shared with regex-scripts.cjs.
const {screenPattern, guardedTest} = require('./safe-regex.cjs');

const LIMITS = Object.freeze({
  entries: 2000, activated: 200, scanChars: 60000, content: 8000, key: 300, keys: 60, regexPattern: 200,
  stateEntries: 500, warnings: 40, loops: 10, timeBudgetMs: 50, regexTimeoutMs: 20, scanDepth: 1000, extraScanChars: 40000,
});
const DEFAULT_DEPTH = 4;
const DEFAULT_WEIGHT = 100;
const DEFAULT_BUDGET_CHARS = 12000;
const CHARS_PER_TOKEN = Object.freeze({latin: 4, cjk: 1.5});
const MATCHER = '\x01';
const JOINER = '\n' + MATCHER;
const STATE = Object.freeze({NONE: 0, INITIAL: 1, RECURSION: 2});
const PLACEMENTS = ['before', 'after', 'an_top', 'an_bottom', 'at_depth', 'em_top', 'em_bottom', 'outlet'];
const LOGICS = ['and_any', 'not_all', 'not_any', 'and_all'];
const ROLES = ['system', 'user', 'assistant'];
const KNOWN_DECORATORS = ['@@activate', '@@dont_activate'];
const bad = message => Object.assign(new TypeError(message), {code: 'world_info_invalid'});
const isObject = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const int = (value, min, max, fallback) => typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, Math.trunc(value))) : fallback;
const sortFn = (a, b) => b.order - a.order;

/**
 * Converts a lorebook token budget to characters: about 4 characters per token for Latin
 * text and 1.5 for CJK-heavy text (more than 30 % CJK characters in `sample`). An estimate.
 */
function tokenBudgetToChars(tokens, sample = '') {
  if (typeof tokens !== 'number' || !Number.isFinite(tokens) || tokens <= 0) return 0;
  const text = typeof sample === 'string' ? sample.slice(0, 4000) : '';
  let cjk = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if ((code >= 0x3040 && code <= 0x30ff) || (code >= 0x3400 && code <= 0x9fff) || (code >= 0xac00 && code <= 0xd7af) || (code >= 0xf900 && code <= 0xfaff)) cjk++;
  }
  const ratio = text.length && cjk / text.length > 0.3 ? CHARS_PER_TOKEN.cjk : CHARS_PER_TOKEN.latin;
  return Math.min(2000000, Math.floor(tokens * ratio));
}

// Upstream `parseDecorators`: leading "@@" lines; "@@@" escapes; unknown decorators fall back.
function parseDecorators(content) {
  if (!content.startsWith('@@')) return [[], content];
  const lines = content.split('\n');
  const decorators = [];
  let rest = content, fallbacked = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.startsWith('@@')) { rest = lines.slice(i).join('\n'); break; }
    if (line.startsWith('@@@') && !fallbacked) continue;
    const name = line.startsWith('@@@') ? line.slice(1) : line;
    if (KNOWN_DECORATORS.some(known => name.startsWith(known))) { decorators.push(name); fallbacked = false; } else fallbacked = true;
  }
  return [decorators, rest];
}

/**
 * Upstream `parseRegexFromString` plus the safety screen. Returns null for a plain-text key,
 * `{regex, guarded}` for an accepted regex key, `{rejected: reason}` otherwise.
 */
function parseRegexKey(input) {
  if (typeof input !== 'string' || input.length < 3 || input[0] !== '/') return null;
  const match = /^\/([\w\W]+?)\/([gimsuy]*)$/.exec(input);
  if (!match) return null;
  let [, pattern, flags] = match;
  if (/(^|[^\\])\//.test(pattern)) return null; // unescaped delimiter inside: plain text, as upstream
  pattern = pattern.split('\\/').join('/');
  if (pattern.length > LIMITS.regexPattern) return {rejected: `longer than ${LIMITS.regexPattern} characters`};
  const info = {repeats: false};
  const reason = screenPattern(pattern, info);
  if (reason) return {rejected: reason};
  try {
    // One RegExp object is reused for the scan, so stateful flags are dropped.
    return {regex: new RegExp(pattern, [...new Set(flags)].filter(flag => flag !== 'g' && flag !== 'y').join('')), guarded: info.repeats};
  } catch { return {rejected: 'invalid syntax'}; }
}

function unit(random) {
  const value = Number(random());
  return Number.isFinite(value) && value >= 0 && value < 1 ? value : 0;
}

function keyList(value) {
  if (!Array.isArray(value)) return [];
  const result = [];
  for (const key of value) {
    if (typeof key !== 'string' || !key.trim() || key.length > LIMITS.key) continue;
    if (result.length >= LIMITS.keys) break;
    result.push(key);
  }
  return result;
}

function prepareEntry(raw) {
  const [decorators, content] = parseDecorators(typeof raw.content === 'string' ? raw.content.slice(0, LIMITS.content) : '');
  const book = typeof raw.book === 'string' ? raw.book.slice(0, 80) : '';
  const placement = PLACEMENTS.includes(raw.placement) ? raw.placement : raw.position === 'before_char' ? 'before' : 'after';
  return {
    key: `${book}.${raw.id}`, id: raw.id, book, comment: typeof raw.comment === 'string' ? raw.comment.slice(0, 500) : '',
    character: raw.source === 'character',
    keys: keyList(raw.keys), secondaryKeys: keyList(raw.secondaryKeys), content, decorators,
    disabled: !raw.enabled, constant: Boolean(raw.constant), selective: Boolean(raw.selective),
    order: int(raw.insertionOrder, -1000000, 1000000, 100),
    logic: LOGICS.includes(raw.selectiveLogic) ? raw.selectiveLogic : 'and_any',
    placement, depth: int(raw.depth, 0, 1000, DEFAULT_DEPTH), role: ROLES.includes(raw.role) ? raw.role : 'system',
    probability: int(raw.probability, 0, 100, 100), useProbability: raw.useProbability !== false,
    group: typeof raw.group === 'string' ? raw.group.slice(0, 200) : '', groupOverride: raw.groupOverride === true,
    groupWeight: int(raw.groupWeight, 0, 10000, DEFAULT_WEIGHT),
    sticky: int(raw.sticky, 0, 100000, 0), cooldown: int(raw.cooldown, 0, 100000, 0), delay: int(raw.delay, 0, 100000, 0),
    scanDepth: int(raw.scanDepth, 0, LIMITS.scanDepth, null),
    caseSensitive: typeof raw.caseSensitive === 'boolean' ? raw.caseSensitive : null,
    matchWholeWords: typeof raw.matchWholeWords === 'boolean' ? raw.matchWholeWords : null,
    excludeRecursion: raw.excludeRecursion === true, preventRecursion: raw.preventRecursion === true,
    delayUntilRecursion: raw.delayUntilRecursion === true ? 1 : int(raw.delayUntilRecursion, 0, 10, 0),
    ignoreBudget: raw.ignoreBudget === true,
  };
}

function readState(state, warn) {
  const result = {turn: 0, sticky: {}, cooldown: {}};
  if (state === undefined || state === null) return result;
  if (!isObject(state)) { warn('Ignored the world-info state: not an object.'); return result; }
  result.turn = int(state.turn, 0, Number.MAX_SAFE_INTEGER - 1, 0);
  let kept = 0;
  for (const type of ['sticky', 'cooldown']) {
    if (!isObject(state[type])) continue;
    for (const [key, value] of Object.entries(state[type])) {
      if (kept >= LIMITS.stateEntries) break;
      if (!isObject(value) || key.length > 120 || key === '__proto__') continue;
      const start = int(value.start, 0, Number.MAX_SAFE_INTEGER, null), end = int(value.end, 0, Number.MAX_SAFE_INTEGER, null);
      if (start === null || end === null) continue;
      result[type][key] = {start, end, protected: value.protected === true};
      kept++;
    }
  }
  return result;
}

// Upstream `WorldInfoTimedEffects.checkTimedEffects`.
function checkTimedEffects(effects, entries, byKey, clock) {
  const active = {sticky: new Set(), cooldown: new Set(), delay: new Set()};
  const check = (type, onEnded) => {
    for (const [key, value] of Object.entries(effects[type])) {
      const entry = byKey.get(key);
      if (clock <= value.start && !value.protected) { delete effects[type][key]; continue; } // chat not advanced
      if (!entry) { if (clock >= value.end) delete effects[type][key]; continue; } // another book's entry
      if (!entry[type]) { delete effects[type][key]; continue; }
      if (clock >= value.end) { delete effects[type][key]; onEnded?.(entry); continue; }
      active[type].add(key);
    }
  };
  check('sticky', entry => {
    // A sticky entry that ends goes on cooldown immediately.
    if (!entry.cooldown) return;
    effects.cooldown[entry.key] = {start: clock, end: clock + entry.cooldown, protected: true};
    active.cooldown.add(entry.key);
  });
  check('cooldown');
  for (const entry of entries) if (entry.delay && clock < entry.delay) active.delay.add(entry.key);
  return active;
}

const groupNames = entry => entry.group ? entry.group.split(/,\s*/).filter(Boolean) : [];

// Upstream `filterByInclusionGroups` without group scoring.
function filterByInclusionGroups(newEntries, activated, active, random) {
  const grouped = new Map();
  for (const entry of newEntries) {
    if (!entry.group) continue;
    for (const name of groupNames(entry)) {
      if (!grouped.has(name)) grouped.set(name, []);
      grouped.get(name).push(entry);
    }
  }
  if (!grouped.size) return;
  const remove = entry => { const index = newEntries.indexOf(entry); if (index >= 0) newEntries.splice(index, 1); };
  const removeAllBut = (group, chosen) => { for (const entry of group) if (entry !== chosen) remove(entry); };
  const hasSticky = new Map();
  for (const [name, group] of grouped) {
    const sticky = group.filter(entry => active.sticky.has(entry.key));
    hasSticky.set(name, sticky.length > 0);
    if (sticky.length) for (const entry of group) if (!sticky.includes(entry)) remove(entry);
    for (const entry of group) if (active.cooldown.has(entry.key) || active.delay.has(entry.key)) remove(entry);
  }
  for (const [name, all] of grouped) {
    if (hasSticky.get(name)) continue;
    const group = all.filter(entry => newEntries.includes(entry));
    // A group that already has a winner from an earlier scan loop admits nobody else.
    if ([...activated.values()].some(entry => groupNames(entry).includes(name))) { removeAllBut(group, null); continue; }
    if (group.length <= 1) continue;
    const prioritised = group.filter(entry => entry.groupOverride).sort(sortFn);
    if (prioritised.length) { removeAllBut(group, prioritised[0]); continue; }
    const total = group.reduce((sum, entry) => sum + entry.groupWeight, 0);
    const roll = unit(random) * total;
    let current = 0, winner = null;
    for (const entry of group) {
      current += entry.groupWeight;
      if (roll <= current) { winner = entry; break; }
    }
    if (winner) removeAllBut(group, winner);
  }
}

/**
 * Decides which lorebook entries are active for this turn. All entry text is untrusted data.
 *
 * @param {object} options
 * @param {object[]} options.entries normalized lorebook entries (see character-card.cjs). When
 *   several books are merged, tag each entry with `book` (a short id that keeps entry keys
 *   apart) and the character's own entries with `source: 'character'`.
 * @param {{role?: string, name?: string, text: string}[]} options.messages newest last
 * @param {number} [options.budgetChars] characters available to activated entries
 * @param {number} [options.scanDepth=2] messages scanned (an entry's own `scanDepth` wins)
 * @param {boolean} [options.recursive=true]
 * @param {number} [options.maxRecursionSteps=3] scan loops including the first; 0 = internal cap
 * @param {object} [options.state] value returned by the previous call for this conversation
 * @param {() => number} [options.random]
 * @param {() => number} [options.now] milliseconds clock for the scan time budget
 * @param {string} [options.extraScanText] extra text every entry scans (persona, description)
 * @param {number} [options.authorsNoteDepth=4] depth used for Author's Note top / bottom entries
 * @param {boolean} [options.caseSensitive=false] default when an entry does not say
 * @param {boolean} [options.matchWholeWords=false] default when an entry does not say
 * @param {'character_first'|'global_first'|'evenly'} [options.insertionStrategy]
 * @param {object} [options.macroEnv] `substituteMacros` environment applied to keys and content
 * @param {number} [options.chatLength] total messages in the chat, the upstream clock for
 *   sticky / cooldown / delay; defaults to `2 * state.turn + 1`
 * @param {number} [options.timeBudgetMs=50]
 * @returns {{before: string[], after: string[], atDepth: {depth: number, role: string, content: string}[],
 *   activated: {id: *, comment: string, book?: string}[], state: object, warnings: string[]}}
 */
function scanWorldInfo(options) {
  if (!isObject(options)) throw bad('World-info options must be an object.');
  const {
    entries, messages, budgetChars = DEFAULT_BUDGET_CHARS, scanDepth = 2, recursive = true, maxRecursionSteps = 3, state,
    random = Math.random, now = Date.now, extraScanText = '', authorsNoteDepth = DEFAULT_DEPTH, caseSensitive = false,
    matchWholeWords = false, insertionStrategy = 'character_first', macroEnv = null, chatLength, timeBudgetMs = LIMITS.timeBudgetMs,
  } = options;
  if (!Array.isArray(entries)) throw bad('World-info entries must be a list.');
  if (!Array.isArray(messages)) throw bad('World-info messages must be a list.');
  if (typeof random !== 'function' || typeof now !== 'function') throw bad('World-info random and now must be functions.');
  if (typeof extraScanText !== 'string') throw bad('World-info extra scan text must be text.');
  if (macroEnv !== null && !isObject(macroEnv)) throw bad('World-info macro environment must be an object.');
  const warnings = [];
  const warn = message => { if (warnings.length < LIMITS.warnings && !warnings.includes(message)) warnings.push(message); };
  const budget = int(budgetChars, 0, 2000000, DEFAULT_BUDGET_CHARS);
  const globalDepth = int(scanDepth, 0, LIMITS.scanDepth, 2);
  const maxLoops = Math.min(LIMITS.loops, int(maxRecursionSteps, 0, LIMITS.loops, 3) || LIMITS.loops);
  const noteDepth = int(authorsNoteDepth, 0, 1000, DEFAULT_DEPTH);
  const timeBudget = int(timeBudgetMs, 1, 10000, LIMITS.timeBudgetMs);
  const substitute = text => {
    if (!macroEnv || !text.includes('{{') && !text.includes('<')) return text;
    try { return substituteMacros(text, {...macroEnv, random}); } catch { return text; }
  };

  // Entries, in upstream scan order (`getSortedEntries`).
  if (entries.length > LIMITS.entries) warn(`Only the first ${LIMITS.entries} lorebook entries were considered.`);
  const prepared = [];
  const byKey = new Map();
  for (const raw of entries.slice(0, LIMITS.entries)) {
    if (!isObject(raw) || (typeof raw.id !== 'number' && typeof raw.id !== 'string')) { warn('Ignored a lorebook entry without an id.'); continue; }
    const entry = prepareEntry(raw);
    if (byKey.has(entry.key)) { warn('Ignored a lorebook entry with a duplicate id; tag merged books with `book`.'); continue; }
    byKey.set(entry.key, entry);
    prepared.push(entry);
  }
  const stable = list => list.map((entry, index) => [entry, index]).sort((a, b) => sortFn(a[0], b[0]) || a[1] - b[1]).map(pair => pair[0]);
  const characterLore = prepared.filter(entry => entry.character), globalLore = prepared.filter(entry => !entry.character);
  const sorted = insertionStrategy === 'evenly' ? stable([...globalLore, ...characterLore])
    : insertionStrategy === 'global_first' ? [...stable(globalLore), ...stable(characterLore)]
      : [...stable(characterLore), ...stable(globalLore)];
  const sortedIndex = new Map(sorted.map((entry, index) => [entry, index]));

  // Timed effects.
  const effects = readState(state, warn);
  const clock = Number.isSafeInteger(chatLength) && chatLength >= 0 ? chatLength : 2 * effects.turn + 1;
  const active = checkTimedEffects(effects, sorted, byKey, clock);

  // Scan text (upstream `WorldInfoBuffer`): newest message first, then extra text, then recursion text.
  const depthBuffer = [];
  for (let index = messages.length - 1; index >= 0 && depthBuffer.length < LIMITS.scanDepth; index--) {
    const message = messages[index];
    const text = isObject(message) && typeof message.text === 'string' ? message.text.trim() : '';
    const name = isObject(message) && typeof message.name === 'string' ? message.name.trim().slice(0, 80) : '';
    depthBuffer.push((name ? `${name}: ${text}` : text).slice(0, LIMITS.scanChars));
  }
  const extra = extraScanText.slice(0, LIMITS.extraScanChars).trim();
  const recurseBuffer = [];
  const haystacks = new Map();
  const haystack = entry => {
    const depth = entry.scanDepth ?? globalDepth;
    const cacheKey = `${depth}|${recurseBuffer.length}`;
    let cached = haystacks.get(cacheKey);
    if (!cached) {
      let text = '';
      if (depth > 0) {
        text = MATCHER + depthBuffer.slice(0, depth).join(JOINER);
        if (extra) text += JOINER + extra;
        if (recurseBuffer.length) text += JOINER + recurseBuffer.join(JOINER);
        if (text.length > LIMITS.scanChars) { text = text.slice(0, LIMITS.scanChars); warn(`Scanned only the first ${LIMITS.scanChars} characters of the chat text.`); }
      }
      cached = {text, lower: null};
      haystacks.set(cacheKey, cached);
    }
    return cached;
  };

  const startedAt = now();
  let outOfTime = false;
  const expired = () => {
    if (!outOfTime && now() - startedAt > timeBudget) { outOfTime = true; warn(`The lorebook scan exceeded ${timeBudget} ms and was stopped; later keys were not checked.`); }
    return outOfTime;
  };
  const regexCache = new Map();
  // Upstream `WorldInfoBuffer.matchKeys`.
  const matchKey = (hay, rawKey, entry) => {
    const key = substitute(rawKey).trim();
    if (!key) return false;
    let parsed = regexCache.get(key);
    if (parsed === undefined) { parsed = parseRegexKey(key); regexCache.set(key, parsed); }
    if (parsed) {
      if (parsed.rejected) { warn(`Ignored a regular-expression key (${parsed.rejected}).`); return false; }
      if (!parsed.guarded) return parsed.regex.test(hay.text);
      const result = guardedTest(parsed.regex, hay.text, LIMITS.regexTimeoutMs);
      if (result.done) return result.value;
      parsed.rejected = result.timeout ? 'it ran too long' : 'it could not be run safely';
      warn(`Ignored a regular-expression key (${parsed.rejected}).`);
      return false;
    }
    const sensitive = entry.caseSensitive ?? Boolean(caseSensitive);
    const text = sensitive ? hay.text : (hay.lower ??= hay.text.toLowerCase());
    const needle = sensitive ? key : key.toLowerCase();
    if (!(entry.matchWholeWords ?? Boolean(matchWholeWords)) || needle.split(/\s+/).length > 1) return text.includes(needle);
    // Upstream boundary rule (?:^|\W)key(?:$|\W), done with indexOf.
    for (let at = text.indexOf(needle); at >= 0; at = text.indexOf(needle, at + 1)) {
      const before = at === 0 || /\W/.test(text[at - 1]);
      const end = at + needle.length;
      if (before && (end === text.length || /\W/.test(text[end]))) return true;
    }
    return false;
  };
  const matchSecondary = (hay, entry) => {
    let any = false, all = true;
    for (const key of entry.secondaryKeys) {
      const hit = matchKey(hay, key, entry);
      if (hit) any = true; else all = false;
      if (entry.logic === 'and_any' && hit) return true;
      if (entry.logic === 'not_all' && !hit) return true;
    }
    if (entry.logic === 'not_any' && !any) return true;
    return entry.logic === 'and_all' && all;
  };

  // Delay-until-recursion levels, lowest first.
  const delayLevels = [...new Set(sorted.filter(entry => entry.delayUntilRecursion).map(entry => entry.delayUntilRecursion))].sort((a, b) => a - b);
  let currentDelayLevel = delayLevels.shift() ?? 0;

  const activated = new Map();
  const failedProbability = new Set();
  let scanState = STATE.INITIAL, overflowed = false, capped = false, used = 0, count = 0;
  while (scanState) {
    if (maxLoops <= count) break;
    count++;
    let nextState = STATE.NONE;
    const activatedNow = new Set();
    for (const entry of sorted) {
      if (failedProbability.has(entry) || activated.has(entry.key)) continue;
      if (entry.disabled) continue;
      const isSticky = active.sticky.has(entry.key);
      if (active.delay.has(entry.key)) continue;
      if (active.cooldown.has(entry.key) && !isSticky) continue;
      if (scanState !== STATE.RECURSION && entry.delayUntilRecursion && !isSticky) continue;
      if (scanState === STATE.RECURSION && entry.delayUntilRecursion && entry.delayUntilRecursion > currentDelayLevel && !isSticky) continue;
      if (scanState === STATE.RECURSION && recursive && entry.excludeRecursion && !isSticky) continue;
      if (entry.decorators.includes('@@activate')) { activatedNow.add(entry); continue; }
      if (entry.decorators.includes('@@dont_activate')) continue;
      if (entry.constant || isSticky) { activatedNow.add(entry); continue; }
      if (!entry.keys.length) continue;
      if (expired()) continue;
      const hay = haystack(entry);
      if (!entry.keys.some(key => matchKey(hay, key, entry))) continue;
      if (!(entry.selective && entry.secondaryKeys.length) || matchSecondary(hay, entry)) activatedNow.add(entry);
    }

    // Sticky entries first, then scan order; then groups, probability and budget.
    const newEntries = [...activatedNow].sort((a, b) => (active.sticky.has(b.key) ? 1 : 0) - (active.sticky.has(a.key) ? 1 : 0) || sortedIndex.get(a) - sortedIndex.get(b));
    filterByInclusionGroups(newEntries, activated, active, random);
    const added = [];
    let ignoresBudget = newEntries.filter(entry => entry.ignoreBudget).length;
    for (const entry of newEntries) {
      ignoresBudget -= entry.ignoreBudget ? 1 : 0;
      if (overflowed && !entry.ignoreBudget) { if (ignoresBudget > 0) continue; break; }
      if (entry.useProbability && entry.probability !== 100 && !active.sticky.has(entry.key) && unit(random) * 100 > entry.probability) { failedProbability.add(entry); continue; }
      if (activated.size >= LIMITS.activated) { capped = true; warn(`Only ${LIMITS.activated} lorebook entries can be active at once.`); break; }
      entry.content = substitute(entry.content).slice(0, LIMITS.content);
      if (!entry.ignoreBudget && used + entry.content.length + 1 > budget) {
        // Skipped whole, never truncated; later entries are not added either.
        if (!overflowed) warn(`The lorebook budget of ${budget} characters was reached after ${activated.size} entries.`);
        overflowed = true;
        continue;
      }
      used += entry.content.length + 1;
      activated.set(entry.key, entry);
      added.push(entry);
    }

    const forRecursion = added.filter(entry => !entry.preventRecursion);
    const canContinue = !overflowed && !capped && !outOfTime;
    if (recursive && canContinue && forRecursion.length) nextState = STATE.RECURSION;
    if (nextState === STATE.NONE && delayLevels.length && canContinue) { nextState = STATE.RECURSION; currentDelayLevel = delayLevels.shift(); }
    scanState = nextState;
    if (scanState) {
      const text = forRecursion.map(entry => entry.content).join('\n');
      if (text) recurseBuffer.push(text);
    }
  }

  // Placement: ascending insertion order inside each slot (upstream sorts descending, then unshifts).
  const before = [], after = [], depthGroups = [];
  const atDepth = (depth, role, content) => {
    const existing = depthGroups.find(group => group.depth === depth && group.role === role);
    if (existing) existing.entries.unshift(content); else depthGroups.push({depth, role, entries: [content]});
  };
  for (const entry of stable([...activated.values()])) {
    const content = entry.content;
    if (!content) continue;
    switch (entry.placement) {
      case 'before': before.unshift(content); break;
      case 'after': after.unshift(content); break;
      case 'em_top': case 'em_bottom':
        warn('Example-message lorebook positions are not supported; those entries were placed after the character definitions.');
        after.unshift(content); break;
      case 'an_top': case 'an_bottom':
        warn(`Author's Note lorebook positions are not supported; those entries were inserted at depth ${noteDepth}.`);
        atDepth(noteDepth, 'system', content); break;
      case 'at_depth': atDepth(entry.depth, entry.role, content); break;
      default: warn('Outlet lorebook entries are not supported and were left out.');
    }
  }

  // Upstream `setTimedEffects`, then bound the tracked effects.
  for (const entry of activated.values()) {
    for (const type of ['sticky', 'cooldown']) {
      if (entry[type] && !effects[type][entry.key]) effects[type][entry.key] = {start: clock, end: clock + entry[type], protected: false};
    }
  }
  const tracked = ['sticky', 'cooldown'].flatMap(type => Object.entries(effects[type]).map(([key, value]) => ({type, key, end: value.end})));
  if (tracked.length > LIMITS.stateEntries) {
    warn(`Only ${LIMITS.stateEntries} timed lorebook effects are tracked; the ones ending soonest were dropped.`);
    for (const item of tracked.sort((a, b) => a.end - b.end).slice(0, tracked.length - LIMITS.stateEntries)) delete effects[item.type][item.key];
  }

  return {
    before, after,
    atDepth: depthGroups.map(group => ({depth: group.depth, role: group.role, content: group.entries.join('\n')})),
    activated: [...activated.values()].map(entry => ({id: entry.id, comment: entry.comment, ...(entry.book ? {book: entry.book} : {})})),
    state: {turn: effects.turn + 1, sticky: effects.sticky, cooldown: effects.cooldown},
    warnings,
  };
}

module.exports = {LIMITS, DEFAULT_BUDGET_CHARS, CHARS_PER_TOKEN, scanWorldInfo, parseRegexKey, tokenBudgetToChars};
