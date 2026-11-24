'use strict';
/*
 * Adapted from SillyTavern, https://github.com/SillyTavern/SillyTavern
 * Upstream paths:
 * - public/scripts/extensions/regex/engine.js: `getRegexedString` (script selection: the
 *   markdownOnly / promptOnly rule, runOnEdit, the minDepth / maxDepth window, placement),
 *   `runRegexScript` ({{match}}, numbered and named groups, find-pattern macro substitution),
 *   `filterString` (trim strings), `sanitizeRegexMacro`, `regex_placement`,
 *   `substitute_find_regex`;
 * - public/scripts/extensions/regex/index.js: the script object shape, `migrateSettings`
 *   (legacy MD-display and sendAs placements), `onRegexImportFileChange` /
 *   `onRegexImportObjectChange` (one object or an array, a name is required, a new id is
 *   assigned);
 * - public/scripts/utils.js: `regexFromString`.
 * Upstream revision: 06bde939fb1e9c4c8d8641d810f0a916b5bce127 (branch release)
 * License: GNU AGPL-3.0 (see LICENSE in the repository root).
 *
 * Modified for Agent Arcade on 2026-11-13:
 * - rewritten as pure CommonJS functions over an explicit script list; no extension settings,
 *   global / scoped / preset script stores or their allow-lists, DOM editor, debugger, slash
 *   commands, events or `characterOverride`;
 * - scripts are untrusted data: they are normalized into frozen, bounded objects with string
 *   placements; the slash-command placement is dropped with a warning;
 * - the find pattern is screened (length, unbalanced or nested repeated groups) and every match
 *   runs inside a V8 context under a per-script timeout and one shared time budget (see
 *   safe-regex.cjs); a refused, invalid or timed-out script is skipped with a warning and
 *   leaves the text as it was, where upstream runs it unguarded;
 * - the replacement is assembled from the collected matches instead of a replace callback;
 *   `$N` beyond the pattern's groups yields the empty string (upstream reads the callback's
 *   offset / input arguments there);
 * - macros come from the local `substituteMacros` subset; for the "escaped" find-pattern mode
 *   the macro values are escaped before substitution instead of through a sanitizer hook;
 * - bounds on script count, input and output length and match count; the compiled-regex LRU
 *   cache is not ported.
 */

const crypto = require('node:crypto');
const {substituteMacros} = require('./macros.cjs');
const {screenPattern, guardedMatches} = require('./safe-regex.cjs');

const LIMITS = Object.freeze({
  scripts: 100, importBytes: 1024 * 1024, name: 100, findRegex: 1000, replaceString: 4000, trimStrings: 20, trimString: 200,
  inputChars: 100000, outputChars: 200000, matches: 10000, timeBudgetMs: 50, regexTimeoutMs: 20, warnings: 40,
});
const PLACEMENTS = Object.freeze(['user_input', 'ai_output', 'world_info', 'reasoning']);
const SUBSTITUTE = Object.freeze(['none', 'raw', 'escaped']);
// Upstream `regex_placement`. 0 is the deprecated MD display, 4 the legacy sendAs.
const UPSTREAM = Object.freeze({MD_DISPLAY: 0, USER_INPUT: 1, AI_OUTPUT: 2, SLASH_COMMAND: 3, SEND_AS: 4, WORLD_INFO: 5, REASONING: 6});
const BY_NUMBER = Object.freeze({1: 'user_input', 2: 'ai_output', 5: 'world_info', 6: 'reasoning'});
const ID = /^(?:[0-9a-f]{16}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;
const bad = message => Object.assign(new TypeError(message), {code: 'regex_script_invalid'});
const isObject = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

function depthOf(value) {
  const number = typeof value === 'string' && /^-?\d{1,9}$/.test(value.trim()) ? Number(value) : value;
  return typeof number === 'number' && Number.isFinite(number) ? Math.min(1000000, Math.max(-1000000, Math.trunc(number))) : null;
}

/**
 * Normalizes one script (upstream shape or an already normalized one) into a frozen, bounded
 * object. Throws `regex_script_invalid` when it is not a script, has no name, or its find
 * pattern or replacement exceed the limits (cutting either would change what it does).
 */
function normalizeRegexScript(raw) {
  if (!isObject(raw)) throw bad('A regex script must be an object.');
  const warnings = [];
  const warn = message => { if (warnings.length < LIMITS.warnings) warnings.push(message); };
  if (typeof raw.scriptName !== 'string' || !raw.scriptName.trim()) throw bad('The regex script has no name.');
  let scriptName = raw.scriptName.replace(/[\x00-\x1f\x7f]/g, ' ').trim();
  if (scriptName.length > LIMITS.name) { scriptName = scriptName.slice(0, LIMITS.name); warn(`The script name was cut to ${LIMITS.name} characters.`); }
  const findRegex = raw.findRegex === undefined || raw.findRegex === null ? '' : raw.findRegex;
  if (typeof findRegex !== 'string') throw bad('The find pattern must be text.');
  if (findRegex.length > LIMITS.findRegex) throw bad(`The find pattern exceeds ${LIMITS.findRegex} characters.`);
  const replaceString = raw.replaceString === undefined || raw.replaceString === null ? '' : raw.replaceString;
  if (typeof replaceString !== 'string') throw bad('The replacement must be text.');
  if (replaceString.length > LIMITS.replaceString) throw bad(`The replacement exceeds ${LIMITS.replaceString} characters.`);

  const trimStrings = [];
  for (const item of Array.isArray(raw.trimStrings) ? raw.trimStrings : []) {
    if (typeof item !== 'string' || !item.length) continue;
    if (item.length > LIMITS.trimString) { warn(`A trim string longer than ${LIMITS.trimString} characters was dropped.`); continue; }
    if (trimStrings.length >= LIMITS.trimStrings) { warn(`Only the first ${LIMITS.trimStrings} trim strings were kept.`); break; }
    trimStrings.push(item);
  }

  // Placement, with upstream's `migrateSettings` steps for the two legacy values.
  let markdownOnly = Boolean(raw.markdownOnly), promptOnly = Boolean(raw.promptOnly);
  let list = (Array.isArray(raw.placement) ? raw.placement : []).slice(0, 32);
  if (list.includes(UPSTREAM.MD_DISPLAY)) {
    list = list.length === 1 ? [UPSTREAM.USER_INPUT, UPSTREAM.AI_OUTPUT, UPSTREAM.SLASH_COMMAND, UPSTREAM.WORLD_INFO, UPSTREAM.REASONING] : list.filter(item => item !== UPSTREAM.MD_DISPLAY);
    markdownOnly = true; promptOnly = true;
  }
  if (list.includes(UPSTREAM.SEND_AS)) list = list.length === 1 ? [UPSTREAM.SLASH_COMMAND] : list.filter(item => item !== UPSTREAM.SEND_AS);
  const chosen = new Set();
  let slash = false, unknown = false;
  for (const item of list) {
    if (item === UPSTREAM.SLASH_COMMAND) slash = true;
    else if (typeof item === 'number' && Object.hasOwn(BY_NUMBER, item)) chosen.add(BY_NUMBER[item]);
    else if (typeof item === 'string' && PLACEMENTS.includes(item)) chosen.add(item);
    else unknown = true;
  }
  if (slash) warn('The slash-command placement is not supported and was dropped.');
  if (unknown) warn('An unknown placement was dropped.');
  const placement = PLACEMENTS.filter(item => chosen.has(item));
  if (!placement.length) warn('The script has no supported placement and will not run.');

  // Upstream stores 0 / 1 / 2; older exports stored a boolean.
  let substituteRegex = 'none';
  const mode = raw.substituteRegex;
  if (typeof mode === 'string' && SUBSTITUTE.includes(mode)) substituteRegex = mode;
  else if (mode === true || Number(mode) === 1) substituteRegex = 'raw';
  else if (Number(mode) === 2) substituteRegex = 'escaped';
  else if (mode !== undefined && mode !== null && mode !== false && Number(mode) !== 0) warn('Unknown find-pattern substitution mode; the pattern is used as written.');

  const id = typeof raw.id === 'string' && ID.test(raw.id.toLowerCase()) ? raw.id.toLowerCase() : crypto.randomUUID();
  return Object.freeze({
    id, scriptName, findRegex, replaceString, trimStrings: Object.freeze(trimStrings), placement: Object.freeze(placement),
    disabled: Boolean(raw.disabled), markdownOnly, promptOnly, runOnEdit: Boolean(raw.runOnEdit), substituteRegex,
    minDepth: depthOf(raw.minDepth), maxDepth: depthOf(raw.maxDepth), warnings: Object.freeze(warnings),
  });
}

/**
 * Reads a SillyTavern regex export: one script object or an array of them, as JSON text, a
 * buffer or a parsed value. As upstream, every imported script gets a new id and a script
 * that is not valid is left out (here with a warning) without failing the others.
 * @returns {{scripts: object[], warnings: string[]}} frozen
 */
function importRegexScripts(json) {
  let source = json;
  const tooLarge = () => bad('Choose a regex script file smaller than 1 MiB.');
  if (Buffer.isBuffer(source)) {
    if (source.length > LIMITS.importBytes) throw tooLarge();
    try { source = new TextDecoder('utf-8', {fatal: true}).decode(source); } catch { throw bad('The regex script file is not valid UTF-8.'); }
  }
  if (typeof source === 'string') {
    if (Buffer.byteLength(source, 'utf8') > LIMITS.importBytes) throw tooLarge();
    try { source = JSON.parse(source.replace(/^﻿/, '')); } catch { throw bad('The regex script file is not valid JSON.'); }
  } else {
    let size;
    try { size = Buffer.byteLength(JSON.stringify(source) ?? '', 'utf8'); } catch { throw bad('The regex script data cannot be read.'); }
    if (size > LIMITS.importBytes) throw tooLarge();
  }
  const list = Array.isArray(source) ? source : [source];
  if (!list.length) throw bad('The file holds no regex script.');
  if (list.length > LIMITS.scripts) throw bad(`A file may hold at most ${LIMITS.scripts} regex scripts.`);
  const scripts = [], warnings = [];
  list.forEach((raw, index) => {
    try {
      const script = normalizeRegexScript(isObject(raw) ? {...raw, id: undefined} : raw);
      scripts.push(script);
      for (const warning of script.warnings) if (warnings.length < LIMITS.warnings) warnings.push(`${script.scriptName}: ${warning}`);
    } catch (error) {
      if (error?.code !== 'regex_script_invalid') throw error;
      if (warnings.length < LIMITS.warnings) warnings.push(`Script ${index + 1} was skipped: ${error.message}`);
    }
  });
  if (!scripts.length) throw bad(list.length === 1 ? warnings[0].replace(/^Script 1 was skipped: /, '') : 'The file holds no valid regex script.');
  return Object.freeze({scripts: Object.freeze(scripts), warnings: Object.freeze(warnings)});
}

// Upstream `sanitizeRegexMacro`.
const CONTROL = {'\n': '\\n', '\r': '\\r', '\t': '\\t', '\v': '\\v', '\f': '\\f', '\0': '\\0'};
const escapeForRegex = value => String(value ?? '').replace(/[\n\r\t\v\f\0.^$*+?{}[\]\\/|()]/g, char => CONTROL[char] ?? '\\' + char);

/**
 * Upstream `regexFromString` plus the safety screen: "/pattern/flags" or a bare pattern.
 * @returns {{regex: RegExp} | {rejected: string}}
 */
function parseFindRegex(input) {
  if (typeof input !== 'string' || !input) return {rejected: 'it is empty'};
  if (input.length > LIMITS.findRegex) return {rejected: `it is longer than ${LIMITS.findRegex} characters`};
  // Upstream's own parsing expression, applied to at most 1000 characters.
  const match = input.match(/(\/?)(.+)\1([a-z]*)/i);
  if (!match) return {rejected: 'it has invalid syntax'};
  let pattern = match[2], flags = match[3];
  // Upstream: flags outside its accepted set (or repeated) make the whole input the pattern.
  if (flags && !/^(?!.*?(.).*?\1)[gmixXsuUAJ]+$/.test(flags)) { pattern = input; flags = ''; }
  const reason = screenPattern(pattern, {}, {allowBackreferences: true, allowAlternation: true});
  if (reason) return {rejected: `it has ${reason}`};
  try { return {regex: new RegExp(pattern, flags)}; } catch { return {rejected: 'it has invalid syntax or unsupported flags'}; }
}

const macroEnvOf = (env, escaped) => {
  const source = isObject(env) ? env : {};
  if (!escaped) return source;
  const result = {...source};
  for (const key of ['char', 'user', 'persona', 'description', 'personality', 'scenario']) if (result[key] !== undefined && result[key] !== null) result[key] = escapeForRegex(result[key]);
  return result;
};

/**
 * Upstream `getRegexedString`: runs the scripts that apply to this text, in list order, each on
 * the previous one's output.
 * @param {string} text
 * @param {object} options scripts (normalized, or raw objects that are normalized here),
 *   placement ('user_input' | 'ai_output' | 'world_info' | 'reasoning'), isMarkdown (the text is
 *   being prepared for display), isPrompt (the text is being prepared for the model), isEdit,
 *   depth (0 = newest message; null skips the depth window), macroEnv (for substituteMacros),
 *   timeBudgetMs (shared by all scripts), now (clock, for tests)
 * @returns {{text: string, applied: string[], warnings: string[]}} frozen; `applied` lists the
 *   ids of scripts that changed the text
 */
function applyRegexScripts(text, {scripts = [], placement, isMarkdown = false, isPrompt = false, isEdit = false, depth = null, macroEnv, timeBudgetMs = LIMITS.timeBudgetMs, now = Date.now} = {}) {
  if (typeof text !== 'string') throw bad('Regex input must be text.');
  if (!PLACEMENTS.includes(placement)) throw bad('Unknown regex placement.');
  if (!Array.isArray(scripts)) throw bad('Regex scripts must be a list.');
  const warnings = [], applied = [];
  const warn = message => { if (warnings.length < LIMITS.warnings && !warnings.includes(message)) warnings.push(message); };
  const finish = value => Object.freeze({text: value, applied: Object.freeze(applied), warnings: Object.freeze(warnings)});
  if (!text) return finish(text);
  if (text.length > LIMITS.inputChars) { warn(`The text exceeds ${LIMITS.inputChars} characters; regex scripts were not applied.`); return finish(text); }
  if (scripts.length > LIMITS.scripts) warn(`Only the first ${LIMITS.scripts} regex scripts were considered.`);
  const budget = Math.max(1, Math.min(1000, Number.isFinite(timeBudgetMs) ? timeBudgetMs : LIMITS.timeBudgetMs));
  const startedAt = now();
  const plainEnv = macroEnvOf(macroEnv, false);
  const macros = (value, env) => { try { return substituteMacros(value, env); } catch { return value; } };
  let current = text;

  for (const candidate of scripts.slice(0, LIMITS.scripts)) {
    let script = candidate;
    if (!isObject(script) || !Object.isFrozen(script)) {
      try { script = normalizeRegexScript(candidate); } catch { warn('An invalid regex script was skipped.'); continue; }
    }
    // Upstream selection rule, verbatim: a markdown-only script runs on display text, a
    // prompt-only script on prompt text, a script with neither flag only on plain stored text.
    const selected = (script.markdownOnly && isMarkdown) || (script.promptOnly && isPrompt) || (!script.markdownOnly && !script.promptOnly && !isMarkdown && !isPrompt);
    if (!selected) continue;
    if (isEdit && !script.runOnEdit) continue;
    if (typeof depth === 'number' && !Number.isNaN(depth)) {
      if (script.minDepth !== null && script.minDepth >= -1 && depth < script.minDepth) continue;
      if (script.maxDepth !== null && script.maxDepth >= 0 && depth > script.maxDepth) continue;
    }
    if (!script.placement.includes(placement)) continue;
    if (script.disabled || !script.findRegex || !current) continue;

    const label = `Regex script "${script.scriptName}"`;
    const left = budget - (now() - startedAt);
    if (left <= 0) { warn(`Regex scripts exceeded ${budget} ms; the remaining scripts were not applied.`); break; }
    const find = script.substituteRegex === 'none' ? script.findRegex : macros(script.findRegex, macroEnvOf(macroEnv, script.substituteRegex === 'escaped'));
    const parsed = parseFindRegex(find);
    if (parsed.rejected) { warn(`${label} was skipped: ${parsed.rejected}.`); continue; }
    const found = guardedMatches(parsed.regex, current, Math.min(LIMITS.regexTimeoutMs, left), LIMITS.matches);
    if (!found.done) {
      warn(`${label} was skipped: ${found.timeout ? 'it ran too long' : found.tooMany ? `it matched more than ${LIMITS.matches} times` : 'it could not be run safely'}.`);
      continue;
    }
    if (!found.matches.length) continue;

    // Upstream `runRegexScript` replacement callback and `filterString`.
    const template = script.replaceString.replace(/{{match}}/gi, '$0');
    const trims = script.trimStrings.map(item => macros(item, plainEnv)).filter(item => item.length);
    const pieces = [];
    let cursor = 0, size = 0, overflow = false;
    for (const match of found.matches) {
      const replaced = template.replace(/\$(\d+)|\$<([^>]+)>/g, (_, number, groupName) => {
        let value;
        if (number) value = match.groups[Number(number)];
        else if (groupName && match.named && Object.hasOwn(match.named, groupName)) value = match.named[groupName];
        if (!value || typeof value !== 'string') return '';
        for (const trim of trims) value = value.split(trim).join('');
        return value;
      });
      const piece = current.slice(cursor, match.index) + macros(replaced, plainEnv);
      size += piece.length;
      if (size > LIMITS.outputChars) { overflow = true; break; }
      pieces.push(piece);
      cursor = match.index + match.groups[0].length;
    }
    if (!overflow) { pieces.push(current.slice(cursor)); size += current.length - cursor; }
    if (overflow || size > LIMITS.outputChars) {
      warn(`${label} would grow the text beyond ${LIMITS.outputChars} characters; it and the remaining scripts were not applied.`);
      break;
    }
    const next = pieces.join('');
    if (next !== current) { current = next; applied.push(script.id); }
  }
  return finish(current);
}

module.exports = {LIMITS, PLACEMENTS, normalizeRegexScript, importRegexScripts, applyRegexScripts, parseFindRegex};
