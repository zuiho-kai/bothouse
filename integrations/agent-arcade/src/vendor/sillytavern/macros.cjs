'use strict';
/*
 * Adapted from SillyTavern, https://github.com/SillyTavern/SillyTavern
 * Upstream path: public/scripts/macros.js (`evaluateMacros`, `getRandomReplaceMacro`,
 * `getDiceRollMacro`; the pre-env / env / post-env ordering of replacement passes)
 * Upstream revision: 06bde939fb1e9c4c8d8641d810f0a916b5bce127 (branch release)
 * License: GNU AGPL-3.0 (see LICENSE in the repository root).
 *
 * Modified for Agent Arcade on 2026-11-13:
 * - converted to CommonJS with one pure function; no DOM, chat, settings, registry or globals;
 * - only side-effect-free macros are kept. Variable macros (setvar/getvar/addvar/...), instruct
 *   and chat-state macros, {{input}}, {{pick}}, {{outlet}}, {{banned}}, {{timeDiff}},
 *   {{datetimeformat}}, {{reverse}}, {{pipe}}, STscript and registered custom macros are NOT
 *   ported; such text is left untouched, as is {{original}} (upstream resolves it elsewhere,
 *   only for prompt overrides);
 * - moment, droll and seedrandom are replaced by Intl formatting (English, upstream default
 *   locale), a small NdM+K dice parser and an injectable `random` source;
 * - time, clock and random source are parameters so results are reproducible;
 * - bounds: input length, replacement count, output growth, bounded list / dice arguments, and
 *   linear scanning for {{trim}} and comments, so hostile card text cannot make it spin.
 */

const MAX_INPUT = 200000;
const MAX_REPLACEMENTS = 10000;
const MAX_OUTPUT = 400000;
const MAX_VALUE = 20000;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const bad = message => Object.assign(new Error(message), {code: 'macro_input_invalid'});
const value = input => (input === undefined || input === null ? '' : String(input)).slice(0, MAX_VALUE);

function clock(now, timeZone) {
  const date = now instanceof Date && !Number.isNaN(now.getTime()) ? now : new Date();
  const options = {year: 'numeric', month: 'long', day: 'numeric', weekday: 'long', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'};
  let parts;
  try { parts = new Intl.DateTimeFormat('en-US', {...options, timeZone: timeZone || undefined}).formatToParts(date); }
  catch { parts = new Intl.DateTimeFormat('en-US', options).formatToParts(date); }
  const get = type => parts.find(part => part.type === type)?.value || '';
  const hour = Number(get('hour')) % 24, minute = get('minute').padStart(2, '0');
  const month = String(MONTHS.indexOf(get('month')) + 1).padStart(2, '0');
  return {
    time: `${hour % 12 || 12}:${minute} ${hour < 12 ? 'AM' : 'PM'}`, // moment 'LT'
    date: `${get('month')} ${Number(get('day'))}, ${get('year')}`, // moment 'LL'
    weekday: get('weekday'), // moment 'dddd'
    isotime: `${String(hour).padStart(2, '0')}:${minute}`,
    isodate: `${get('year')}-${month}-${get('day').padStart(2, '0')}`,
  };
}

function unit(random) {
  const result = Number(random());
  return Number.isFinite(result) && result >= 0 && result < 1 ? result : 0;
}

function roll(formulaText, random) {
  let formula = formulaText.trim();
  if (/^\d+$/.test(formula)) formula = `1d${formula}`; // upstream: digits only means one die
  const match = /^(\d{0,3})d(\d{1,4})([+-]\d{1,6})?$/i.exec(formula);
  if (!match) return '';
  const count = match[1] === '' ? 1 : Number(match[1]), sides = Number(match[2]);
  if (count < 1 || count > 100 || sides < 1 || sides > 1000) return '';
  let total = Number(match[3] || 0);
  for (let i = 0; i < count; i++) total += 1 + Math.floor(unit(random) * sides);
  return String(total);
}

const COMMA = String.fromCharCode(0);
function pickRandom(listString, random) {
  // Upstream: split on double colons, else on commas (trimmed, a backslash escapes a comma).
  const list = listString.includes('::')
    ? listString.split('::')
    : listString.replace(/\\,/g, COMMA).split(',').map(item => item.trim().split(COMMA).join(','));
  if (!list.length) return '';
  return list[Math.floor(unit(random) * list.length)];
}

// Linear equivalent of upstream's "{{trim}} with any surrounding line breaks" pattern.
function applyTrim(content, budget) {
  const pieces = content.split(/(\{\{trim\}\})/gi);
  let out = pieces[0];
  for (let i = 1; i < pieces.length; i += 2) {
    const next = pieces[i + 1];
    if (!budget.take(0)) { out += pieces[i] + next; continue; }
    let end = out.length;
    while (end > 0 && out.charCodeAt(end - 1) === 10) end -= end > 1 && out.charCodeAt(end - 2) === 13 ? 2 : 1;
    let start = 0;
    for (;;) {
      if (next.charCodeAt(start) === 10) start++;
      else if (next.charCodeAt(start) === 13 && next.charCodeAt(start + 1) === 10) start += 2;
      else break;
    }
    out = out.slice(0, end) + next.slice(start);
  }
  return out;
}

// Linear equivalent of upstream's lazy "{{// ... }}" comment pattern.
function stripComments(content, budget) {
  let out = '', from = 0;
  for (;;) {
    const start = content.indexOf('{{//', from);
    if (start < 0) break;
    const end = content.indexOf('}}', start + 4);
    if (end < 0 || !budget.take(0)) break;
    out += content.slice(from, start);
    from = end + 2;
  }
  return out + content.slice(from);
}

/**
 * Substitutes the supported {{macros}} in a string. Unknown macros are left untouched.
 * @param {string} text input text (untrusted)
 * @param {object} [env] values: char, user, persona, description, personality, scenario,
 *   now (Date), random (() => number in [0,1)), timeZone (IANA name)
 * @returns {string}
 */
function substituteMacros(text, {char = '', user = '', persona = '', description = '', personality = '', scenario = '', now = new Date(), random = Math.random, timeZone} = {}) {
  if (text === undefined || text === null || text === '') return '';
  if (typeof text !== 'string') throw bad('Macro input must be text.');
  if (text.length > MAX_INPUT) throw bad(`Macro input exceeds ${MAX_INPUT} characters.`);
  if (typeof random !== 'function') random = Math.random;
  let content = text;
  // One shared budget for every pass: replacement count and total growth.
  const budget = {
    left: MAX_REPLACEMENTS, growth: MAX_OUTPUT - text.length,
    take(added) { if (this.left <= 0 || added > this.growth) return false; this.left--; this.growth -= Math.max(0, added); return true; },
  };
  const pass = (regex, replace) => {
    content = content.replace(regex, (...args) => {
      const result = String(replace(...args) ?? '');
      return budget.take(result.length - args[0].length) ? result : args[0];
    });
  };
  const names = {char: value(char), user: value(user)};
  let times;
  const at = key => (times ||= clock(now, timeZone))[key];

  // Pre-env built-ins, in upstream order. Legacy non-curly forms first.
  pass(/<USER>/gi, () => names.user);
  pass(/<BOT>/gi, () => names.char);
  pass(/<CHAR>/gi, () => names.char);
  if (!content.includes('{{')) return content;
  pass(/\{\{roll[ :]([^}]{1,64})\}\}/gi, (_, formula) => roll(formula, random));
  pass(/\{\{newline\}\}/gi, () => '\n');
  content = applyTrim(content, budget);
  pass(/\{\{noop\}\}/gi, () => '');

  // Env values. As upstream, a value may itself contain a later macro, which the following
  // passes expand; a pass never rescans its own output.
  const env = {user: names.user, char: names.char, description: value(description), personality: value(personality), scenario: value(scenario), persona: value(persona)};
  for (const [name, replacement] of Object.entries(env)) {
    if (!content.includes('{{')) return content;
    pass(new RegExp(`\\{\\{${name}\\}\\}`, 'gi'), () => replacement);
  }

  // Post-env built-ins, in upstream order.
  if (!content.includes('{{')) return content;
  content = stripComments(content, budget);
  pass(/\{\{time\}\}/gi, () => at('time'));
  pass(/\{\{date\}\}/gi, () => at('date'));
  pass(/\{\{weekday\}\}/gi, () => at('weekday'));
  pass(/\{\{isotime\}\}/gi, () => at('isotime'));
  pass(/\{\{isodate\}\}/gi, () => at('isodate'));
  pass(/\{\{random\s?::?([^}]{1,4000})\}\}/gi, (_, list) => pickRandom(list, random));
  return content;
}

module.exports = {MAX_INPUT, MAX_REPLACEMENTS, substituteMacros};
