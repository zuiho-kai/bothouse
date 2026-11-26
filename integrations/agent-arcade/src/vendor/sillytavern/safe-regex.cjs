'use strict';
/*
 * Agent Arcade helper, not SillyTavern code: the shared path for running regular expressions that
 * come from imported files (lorebook keys, regex scripts). Factored out of `world-info.cjs` on
 * 2026-11-13 so `regex-scripts.cjs` uses the same screen and the same timeout guard.
 * License: GNU AGPL-3.0 (see LICENSE in the repository root).
 *
 * A pattern is data. It is compiled only with `new RegExp` by the caller and executed inside a
 * V8 context by one of the two fixed scripts below, which is the only way to interrupt a
 * synchronous match; imported text is never compiled or evaluated as code.
 */

const vm = require('node:vm');

/**
 * Cheap static screen of a regex source. Returns null when acceptable, else a reason.
 * `info.repeats` is set when the pattern has any repetition and must run under a timeout.
 * Strict mode (default, lorebook keys) also refuses backreferences and repeated groups that
 * hold an alternation; `allowBackreferences` / `allowAlternation` relax that for callers that
 * run every match under the timeout anyway. A repeated group holding a repetition, such as
 * (a+)+ or ((a*))*, is always refused.
 */
function screenPattern(pattern, info = {}, {allowBackreferences = false, allowAlternation = false} = {}) {
  const stack = [{risky: false}];
  let inClass = false, closed = null;
  for (let i = 0; i < pattern.length; i++) {
    const char = pattern[i];
    const justClosed = closed;
    closed = null;
    if (char === '\\') {
      const next = pattern[i + 1];
      if (!allowBackreferences && ((next >= '1' && next <= '9') || next === 'k')) return 'a backreference';
      i++; continue;
    }
    if (inClass) { if (char === ']') inClass = false; continue; }
    if (char === '[') { inClass = true; continue; }
    if (char === '(') { stack.push({risky: false}); if (pattern[i + 1] === '?') i++; continue; }
    if (char === '|') { if (!allowAlternation) stack[stack.length - 1].risky = true; continue; }
    if (char === ')') {
      if (stack.length < 2) return 'unbalanced parentheses';
      closed = stack.pop();
      // Whatever a group holds, its enclosing group holds too: ((a+))+ is as bad as (a+)+.
      if (closed.risky) stack[stack.length - 1].risky = true;
      continue;
    }
    let repeats = char === '*' || char === '+';
    if (char === '{') {
      const brace = /^\{(\d{1,6})(,(\d{0,6}))?\}/.exec(pattern.slice(i, i + 16));
      if (brace) {
        repeats = brace[2] ? brace[3] === '' || Number(brace[3]) > 1 : Number(brace[1]) > 1;
        i += brace[0].length - 1;
      }
    }
    if (repeats) {
      // A repeated group that itself holds a repetition (or, in strict mode, an alternation)
      // can backtrack exponentially: (a+)+, (.*)*, (a|aa)+.
      if (justClosed?.risky) return allowAlternation ? 'a nested repeated group' : 'a nested or alternating repeated group';
      stack[stack.length - 1].risky = true;
      info.repeats = true;
    }
  }
  return stack.length > 1 ? 'unbalanced parentheses' : null;
}

const timeoutOf = ms => Math.max(1, Math.min(1000, Math.trunc(Number(ms)) || 1));

let testGuard = null;
/** `regex.test(text)` under a wall-clock timeout. `{done:true,value}` or `{done:false,timeout}`. */
function guardedTest(regex, text, timeoutMs) {
  try {
    if (!testGuard) testGuard = {context: vm.createContext(Object.create(null)), script: new vm.Script('regex.test(text)')};
    testGuard.context.regex = regex; testGuard.context.text = text;
    return {done: true, value: Boolean(testGuard.script.runInContext(testGuard.context, {timeout: timeoutOf(timeoutMs)}))};
  } catch (error) {
    return {done: false, timeout: error?.code === 'ERR_SCRIPT_EXECUTION_TIMEOUT'};
  } finally {
    if (testGuard) { testGuard.context.regex = null; testGuard.context.text = ''; }
  }
}

// Collects what String.prototype.replace would match: every match for a global regex (empty
// matches advance by one character, or one code point with the u flag), else the first.
const MATCH_SOURCE = `(() => {
  const out = [];
  regex.lastIndex = 0;
  if (!regex.global) { const m = regex.exec(text); if (m) out.push(m); return out; }
  for (;;) {
    const m = regex.exec(text);
    if (!m) break;
    out.push(m);
    if (out.length > max) break;
    if (m[0] === '') {
      const at = regex.lastIndex, code = text.charCodeAt(at);
      regex.lastIndex = at + (regex.unicode && code >= 0xd800 && code <= 0xdbff && at + 1 < text.length ? 2 : 1);
    }
  }
  return out;
})()`;
let matchGuard = null;
/**
 * The matches `text.replace(regex, ...)` would visit, found under a wall-clock timeout.
 * @returns {{done:true, matches:{index:number,groups:(string|undefined)[],named:object|null}[]} |
 *   {done:false, timeout:boolean, tooMany:boolean}} `groups[0]` is the whole match
 */
function guardedMatches(regex, text, timeoutMs, maxMatches = 10000) {
  try {
    if (!matchGuard) matchGuard = {context: vm.createContext(Object.create(null)), script: new vm.Script(MATCH_SOURCE)};
    matchGuard.context.regex = regex; matchGuard.context.text = text; matchGuard.context.max = maxMatches;
    const found = matchGuard.script.runInContext(matchGuard.context, {timeout: timeoutOf(timeoutMs)});
    if (found.length > maxMatches) return {done: false, timeout: false, tooMany: true};
    const matches = [];
    for (let i = 0; i < found.length; i++) {
      const match = found[i], groups = [];
      for (let g = 0; g < match.length; g++) groups.push(typeof match[g] === 'string' ? match[g] : undefined);
      matches.push({index: match.index, groups, named: match.groups && typeof match.groups === 'object' ? match.groups : null});
    }
    return {done: true, matches};
  } catch (error) {
    return {done: false, timeout: error?.code === 'ERR_SCRIPT_EXECUTION_TIMEOUT', tooMany: false};
  } finally {
    if (matchGuard) { matchGuard.context.regex = null; matchGuard.context.text = ''; }
    try { regex.lastIndex = 0; } catch { /* frozen regex */ }
  }
}

module.exports = {screenPattern, guardedTest, guardedMatches};
