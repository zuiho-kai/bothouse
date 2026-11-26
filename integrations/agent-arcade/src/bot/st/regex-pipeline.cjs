'use strict';
// The three regex-script passes of the App conversation with an imported (library) character,
// as pure functions over a prepared script list. They follow upstream's selection rule (see
// vendor/sillytavern/regex-scripts.cjs):
//   stored  - scripts with neither only-flag rewrite the text that is saved (the owner's
//             message before it is stored, the model's reply before it is stored, an edit when
//             the script has runOnEdit);
//   prompt  - prompt-only scripts change what the model is shown (history lines by depth,
//             lorebook content), never what is stored;
//   display - markdown-only scripts change what the chat view shows, never what is stored.
// Scripts are untrusted data. A script that is refused, times out or fails is skipped with a
// warning and leaves the text as it was; nothing here can block a reply.
const {applyRegexScripts, normalizeRegexScript} = require('../../vendor/sillytavern/regex-scripts.cjs');

const PLACEMENT = Object.freeze({user: 'user_input', assistant: 'ai_output'});
const LIMITS = Object.freeze({scripts: 100, warnings: 10, warning: 200, promptChars: 16000, displayChars: 32000, passMs: 400});
const UNSTORABLE = /[\x00-\x08\x0b-\x1f\x7f]/g;
const EMPTY = Object.freeze([]);

/** Normalizes library records once; invalid ones are left out. Returns a frozen list. */
function prepareScripts(list) {
  const out = [];
  for (const item of Array.isArray(list) ? list.slice(0, LIMITS.scripts) : []) {
    try { const script = normalizeRegexScript(item); if (!script.disabled && script.findRegex && script.placement.length) out.push(script); } catch { /* skipped */ }
  }
  return Object.freeze(out);
}
const forPass = (scripts, pass) => !Array.isArray(scripts) || !scripts.length ? EMPTY
  : scripts.filter(script => pass === 'display' ? script.markdownOnly : pass === 'prompt' ? script.promptOnly : !script.markdownOnly && !script.promptOnly);
function note(warnings, message) {
  const text = String(message).slice(0, LIMITS.warning);
  if (warnings.length < LIMITS.warnings && !warnings.includes(text)) warnings.push(text);
}
function run(text, scripts, options, warnings) {
  try {
    const result = applyRegexScripts(text, {...options, scripts});
    for (const warning of result.warnings) note(warnings, warning);
    return result.text;
  } catch { note(warnings, 'Regex scripts could not be applied to a message; it was left as written.'); return text; }
}

/**
 * Stored-text pass. Returns storable text: without control characters, never empty and never
 * above `maxChars` - in either case the original text is kept and a warning says so.
 * @returns {{text: string, warnings: string[]}}
 */
function storedText(text, {scripts, role, isEdit = false, macroEnv, maxChars, trim = true}) {
  const warnings = [], selected = forPass(scripts, 'stored').filter(script => !isEdit || script.runOnEdit);
  if (!selected.length || typeof text !== 'string' || !text || !PLACEMENT[role]) return {text, warnings};
  const raw = run(text, selected, {placement: PLACEMENT[role], isEdit, macroEnv}, warnings);
  if (raw === text) return {text, warnings};
  const next = trim ? raw.replace(UNSTORABLE, '').trim() : raw.replace(UNSTORABLE, '');
  if (!next.trim()) { note(warnings, 'Regex scripts would have emptied a message; it was stored as written.'); return {text, warnings}; }
  if (next.length > maxChars) { note(warnings, `Regex scripts would have grown a message beyond ${maxChars} characters; it was stored as written.`); return {text, warnings}; }
  return {text: next, warnings};
}

/**
 * Prompt-only pass over the history lines of one prompt (newest last). `offset` is the depth of
 * the newest line: 1 when a current incoming message follows it, else 0.
 * @returns {{history: {role: string, text: string}[], warnings: string[]}}
 */
function promptHistory(history, {scripts, macroEnv, offset = 0, now = Date.now}) {
  const warnings = [], selected = forPass(scripts, 'prompt');
  if (!selected.length) return {history, warnings};
  const started = now(), out = history.slice();
  // Newest first, so a time limit leaves the oldest lines untouched rather than the newest.
  for (let index = out.length - 1; index >= 0; index--) {
    const item = history[index];
    if (!PLACEMENT[item.role]) continue;
    if (now() - started > LIMITS.passMs) { note(warnings, 'Regex scripts took too long on the history; older lines were left as stored.'); break; }
    const next = run(item.text, selected, {placement: PLACEMENT[item.role], isPrompt: true, depth: history.length - 1 - index + offset, macroEnv}, warnings);
    if (next.length > LIMITS.promptChars) { note(warnings, 'Regex scripts would have grown a history line too far; it was left as stored.'); continue; }
    out[index] = {...item, text: next};
  }
  return {history: out, warnings};
}

/** Prompt-only pass for one text (the incoming message, depth 0, or lorebook content). */
function promptText(text, {scripts, placement, depth = null, macroEnv, maxChars = LIMITS.promptChars, keepEmpty = false}) {
  const warnings = [], selected = forPass(scripts, 'prompt');
  if (!selected.length || typeof text !== 'string' || !text) return {text, warnings};
  const next = run(text, selected, {placement, isPrompt: true, depth, macroEnv}, warnings);
  if (next.length > maxChars) { note(warnings, 'Regex scripts would have grown a prompt text too far; it was left as written.'); return {text, warnings}; }
  if (!keepEmpty && !next.trim()) return {text, warnings};
  return {text: next, warnings};
}

/**
 * Display pass for one message of the chat view. Pure: stored text is never changed; the
 * caller shows `text` instead of the stored text when they differ.
 * @returns {{text: string, warnings: string[]}}
 */
function displayText(text, {scripts, role, depth = null, macroEnv}) {
  const warnings = [], selected = forPass(scripts, 'display');
  if (!selected.length || typeof text !== 'string' || !text || !PLACEMENT[role]) return {text, warnings};
  const next = run(text, selected, {placement: PLACEMENT[role], isMarkdown: true, depth, macroEnv}, warnings);
  if (next.length > LIMITS.displayChars) { note(warnings, 'Regex scripts would have grown a displayed message too far; it is shown as stored.'); return {text, warnings}; }
  return {text: next, warnings};
}

module.exports = {LIMITS, PLACEMENT, prepareScripts, forPass, storedText, promptHistory, promptText, displayText};
