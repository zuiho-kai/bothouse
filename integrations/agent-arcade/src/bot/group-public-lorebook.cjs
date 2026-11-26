'use strict';

const {createHash} = require('node:crypto');
const {scanWorldInfo} = require('../vendor/sillytavern/world-info.cjs');
const {LIMITS: {lorebooks: MAX_GROUP_LOREBOOKS}} = require('./st/local-settings.cjs');
const {validGroupLorebookState} = require('./group-lorebook-state.cjs');

const MAX_GROUPS = 5;
const MAX_GROUP_LOREBOOK_BINDINGS = MAX_GROUPS * MAX_GROUP_LOREBOOKS;
const SCAN_DEPTH = 4;
const MAX_SCAN_DEPTH = 8;
const MAX_MESSAGE_CHARS = 2000;
const SCAN_BUDGET = 900;
const SCAN_LOOPS = 3;
const BOOK_ID = /^[0-9a-f]{16}$/;
const ROLE_ID = /^[a-z0-9-]{1,64}$/;
const APPROVAL = /^[0-9a-f]{64}$/;
const ROW_KEYS = ['accountId', 'groupId', 'roleId', 'bookId', 'name', 'approval'];
const projectionData = new WeakMap();
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const exact = (value, keys) => object(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const match = (value, pattern) => typeof value === 'string' && pattern.test(value);
const qqId = value => match(value, /^[1-9]\d{4,14}$/);
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const nameValid = value => typeof value === 'string' && value.length >= 1 && value.length <= 60 &&
  value === value.trim() && !/[\x00-\x1f\x7f]/.test(value);
const unavailable = (code, message) => Object.assign(new Error(message), {code: `group_lorebook_${code}`});

function projectGroupLorebook(library, {accountId, groupId, roleId, bookId} = {}) {
  if (!qqId(accountId) || !qqId(groupId) || !match(roleId, ROLE_ID) || !match(bookId, BOOK_ID)) {
    throw unavailable('invalid', 'Choose an existing standalone world book for the saved QQ group and role.');
  }
  let record;
  try {
    record = typeof library.reviewRecord === 'function' ? library.reviewRecord(bookId) : library.get(bookId);
  } catch {
    throw unavailable('unavailable', 'The standalone world book could not be read.');
  }
  if (!record) throw unavailable('missing', 'The standalone world book is no longer available.');
  if (record.id !== bookId || !nameValid(record.name) || !Array.isArray(record.book?.entries)) {
    throw unavailable('unavailable', 'The standalone world book could not be read.');
  }

  const enabled = record.book.entries.filter(entry => entry.enabled === true);
  const review = Object.freeze(enabled.map(entry => {
    const keys = Object.freeze([...entry.keys]);
    const secondaryKeys = Object.freeze([...entry.secondaryKeys]);
    // Group lore enters one context slot as plain text. Desktop prompt
    // placement, comment metadata and budget overrides are outside this view.
    return Object.freeze({
      id: entry.id, keys, secondaryKeys, content: entry.content, enabled: true,
      constant: entry.constant, selective: entry.selective, selectiveLogic: entry.selectiveLogic,
      insertionOrder: entry.insertionOrder, probability: entry.probability, useProbability: entry.useProbability,
      group: entry.group, groupOverride: entry.groupOverride, groupWeight: entry.groupWeight,
      sticky: entry.sticky, cooldown: entry.cooldown, delay: entry.delay,
      scanDepth: Math.min(entry.scanDepth ?? record.book.scanDepth ?? SCAN_DEPTH, MAX_SCAN_DEPTH),
      caseSensitive: entry.caseSensitive, matchWholeWords: entry.matchWholeWords,
      excludeRecursion: entry.excludeRecursion, preventRecursion: entry.preventRecursion,
      delayUntilRecursion: entry.delayUntilRecursion, ignoreBudget: false,
    });
  }));
  const name = record.name;
  const approval = digest([
    'qq-group-world-book-v1', accountId, groupId, roleId, bookId, name, SCAN_BUDGET, SCAN_LOOPS, review,
  ]);
  const result = Object.freeze({bookId, name, approval, entries: review, review});
  projectionData.set(result, {
    scope: JSON.stringify([accountId, groupId, roleId]),
    entries: review.map(entry => ({...entry, id: digest(['qq-group-world-book-entry-v1', bookId, entry.id])})),
  });
  return result;
}

function groupLorebookBindings(rows, accountId, groupIds) {
  if (!qqId(accountId) || !Array.isArray(groupIds) || groupIds.length > MAX_GROUPS ||
      !Array.isArray(rows) || rows.length > MAX_GROUP_LOREBOOK_BINDINGS) return [];
  const byScope = new Map();
  for (const row of rows) {
    const groupId = row?.groupId;
    if (row?.accountId !== accountId || !qqId(groupId) || !groupIds.includes(groupId) ||
        !match(row.roleId, ROLE_ID) || !match(row.bookId, BOOK_ID)) continue;
    const {roleId, bookId, name, approval} = row;
    const scope = `${groupId}:${roleId}`;
    if (!byScope.has(scope)) byScope.set(scope, new Map());
    const books = byScope.get(scope);
    if (books.has(bookId) || !exact(row, ROW_KEYS) || !nameValid(name) || !match(approval, APPROVAL)) {
      books.set(bookId, null);
      continue;
    }
    books.set(bookId, {accountId, groupId, roleId, bookId, name, approval});
  }
  return [...byScope.values()].flatMap(books => {
    const valid = [...books.values()].filter(Boolean);
    return valid.length <= MAX_GROUP_LOREBOOKS ? valid : [];
  });
}

function scopedEffects(approval, entries, state) {
  if (state?.approval !== approval || !validGroupLorebookState(state)) return undefined;
  const {effects} = state;
  const byKey = new Map(entries.map(entry => [`.${entry.id}`, entry]));
  for (const type of ['sticky', 'cooldown']) {
    for (const [key, value] of Object.entries(effects[type])) {
      if (value.end - value.start !== byKey.get(key)?.[type]) return undefined;
    }
  }
  return effects;
}

function scanGroupLorebooks(projections, messages, state) {
  if (!Array.isArray(projections) || !projections.length || projections.length > MAX_GROUP_LOREBOOKS) {
    return {texts: [], state: null};
  }
  const scope = projectionData.get(projections[0])?.scope;
  if (!scope) return {texts: [], state: null};
  const seen = new Set();
  for (const book of projections) {
    if (projectionData.get(book)?.scope !== scope || seen.has(book.bookId)) return {texts: [], state: null};
    seen.add(book.bookId);
  }
  const entries = projections.flatMap(book => projectionData.get(book).entries);
  const approval = digest(projections.map(book => book.approval));
  const scanMessages = Array.isArray(messages) ? messages.slice(-MAX_SCAN_DEPTH).map(message => {
    const text = typeof message === 'string' ? message : message?.text;
    return {text: typeof text === 'string' ? text.slice(0, MAX_MESSAGE_CHARS) : ''};
  }) : [];
  const result = scanWorldInfo({
    entries, messages: scanMessages,
    budgetChars: SCAN_BUDGET, scanDepth: SCAN_DEPTH, maxRecursionSteps: SCAN_LOOPS, recursive: true,
    state: scopedEffects(approval, entries, state),
  });
  return {texts: result.after, state: {approval, effects: result.state}};
}

module.exports = {projectGroupLorebook, groupLorebookBindings, scanGroupLorebooks, MAX_GROUP_LOREBOOKS, MAX_GROUP_LOREBOOK_BINDINGS};
