'use strict';
// Prompt presets for imported characters: a strict validator for Agent Arcade's own preset
// shape and a one-way importer for SillyTavern chat-completion preset files. Only the parts
// that have a counterpart here are read (main prompt, post-history instructions, section order
// and switches, three sampling values); everything else in such a file is ignored and listed.
// Preset text is untrusted data and is only ever copied into prompt strings.
const {SECTION_IDS, DEFAULT_PRESET, completeOrder} = require('./prompt-builder.cjs');

const LIMITS = Object.freeze({name: 60, prompt: 8000, jsonBytes: 1024 * 1024, ignoredKeys: 20, order: 64, prompts: 500});
const SAMPLING = Object.freeze({temperature: [0, 2], topP: [0, 1], maxTokens: [64, 8192]});
const KEYS = ['name', 'order', 'sections', 'mainPrompt', 'postHistory', 'preferCardSystemPrompt', 'preferCardPostHistory', 'sampling'];
const CONTROL = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/;
const bad = message => Object.assign(new Error(message), {code: 'preset_invalid'});
const isObject = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.freeze(value); Object.values(value).forEach(deepFreeze); }
  return value;
}

function boundedText(value, max, label, fallback) {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || value.length > max || CONTROL.test(value)) throw bad(`Invalid ${label}.`);
  return value;
}

/**
 * Strict validation of a preset. Unknown keys, unknown or repeated section ids, wrong types,
 * over-long text and out-of-range sampling values are rejected. Section ids missing from
 * `order` are inserted at their default position.
 * @returns {object} frozen `{name, order, sections, mainPrompt, postHistory,
 *   preferCardSystemPrompt, preferCardPostHistory, sampling: {temperature, topP, maxTokens}}`
 */
function validatePreset(value) {
  if (!isObject(value)) throw bad('Invalid preset.');
  for (const key of Object.keys(value)) if (!KEYS.includes(key)) throw bad('The preset has an unknown setting.');
  const name = boundedText(value.name, LIMITS.name, 'preset name', DEFAULT_PRESET.name).replace(/[\r\n\t]/g, ' ').trim();
  if (!name) throw bad('The preset needs a name.');
  let order = [...SECTION_IDS];
  if (value.order !== undefined) {
    if (!Array.isArray(value.order) || value.order.length > LIMITS.order) throw bad('Invalid preset order.');
    if (value.order.some(id => !SECTION_IDS.includes(id)) || new Set(value.order).size !== value.order.length) throw bad('The preset order has an unknown or repeated section.');
    order = completeOrder(value.order).order;
  }
  const sections = {};
  if (value.sections !== undefined && !isObject(value.sections)) throw bad('Invalid preset sections.');
  for (const key of Object.keys(value.sections || {})) if (!SECTION_IDS.includes(key)) throw bad('The preset has an unknown section.');
  for (const id of SECTION_IDS) {
    const section = value.sections?.[id];
    if (section === undefined) { sections[id] = {enabled: DEFAULT_PRESET.sections[id].enabled}; continue; }
    if (!isObject(section) || Object.keys(section).some(key => key !== 'enabled') || typeof section.enabled !== 'boolean') throw bad('Invalid preset section.');
    sections[id] = {enabled: id === 'main' ? true : section.enabled}; // the main prompt cannot be switched off
  }
  const flag = (key, fallback) => {
    if (value[key] === undefined) return fallback;
    if (typeof value[key] !== 'boolean') throw bad(`Invalid ${key}.`);
    return value[key];
  };
  const sampling = {temperature: null, topP: null, maxTokens: null};
  if (value.sampling !== undefined) {
    if (!isObject(value.sampling) || Object.keys(value.sampling).some(key => !(key in SAMPLING))) throw bad('Invalid preset sampling.');
    for (const [key, [min, max]] of Object.entries(SAMPLING)) {
      const item = value.sampling[key];
      if (item === undefined || item === null) continue;
      if (typeof item !== 'number' || !Number.isFinite(item) || item < min || item > max || (key === 'maxTokens' && !Number.isInteger(item))) throw bad(`Invalid sampling ${key}.`);
      sampling[key] = item;
    }
  }
  return deepFreeze({
    name, order, sections,
    mainPrompt: boundedText(value.mainPrompt, LIMITS.prompt, 'main prompt', DEFAULT_PRESET.mainPrompt),
    postHistory: boundedText(value.postHistory, LIMITS.prompt, 'post-history instructions', DEFAULT_PRESET.postHistory),
    preferCardSystemPrompt: flag('preferCardSystemPrompt', true),
    preferCardPostHistory: flag('preferCardPostHistory', true),
    sampling,
  });
}

/**
 * Reads a SillyTavern chat-completion preset file (JSON text or buffer, at most 1 MiB).
 * @param {string|Buffer} json
 * @param {{name?: string}} [options] preset files carry no name; the caller may pass the file name
 * @returns {{preset: object, warnings: string[]}}
 */
function importSillyTavernPreset(json, {name} = {}) {
  if (Buffer.isBuffer(json)) {
    if (json.length > LIMITS.jsonBytes) throw bad('Choose a preset file smaller than 1 MiB.');
    try { json = new TextDecoder('utf-8', {fatal: true}).decode(json); } catch { throw bad('The preset file is not valid UTF-8.'); }
  }
  if (typeof json !== 'string' || Buffer.byteLength(json, 'utf8') > LIMITS.jsonBytes) throw bad('Choose a preset file smaller than 1 MiB.');
  let source;
  try { source = JSON.parse(json.replace(/^﻿/, '')); } catch { throw bad('The preset file is not valid JSON.'); }
  if (!isObject(source)) throw bad('The preset file is not a preset.');
  const warnings = [];
  const clean = (text, label) => {
    if (typeof text !== 'string') return undefined;
    let result = text.replace(new RegExp(CONTROL.source, 'g'), '').replace(/\{\{charIfNotGroup\}\}/gi, '{{char}}');
    if (result.length > LIMITS.prompt) { result = result.slice(0, LIMITS.prompt); warnings.push(`Shortened the ${label} to ${LIMITS.prompt} characters.`); }
    return result;
  };
  const prompts = Array.isArray(source.prompts) ? source.prompts.slice(0, LIMITS.prompts).filter(isObject) : [];
  const find = identifier => prompts.find(prompt => prompt.identifier === identifier);
  const preset = {name: (typeof name === 'string' ? name.replace(/[\x00-\x1f\x7f]/g, ' ').trim().slice(0, LIMITS.name) : '') || 'Imported preset'};
  const main = find('main'), post = find('jailbreak');
  const mainText = clean(main?.content, 'main prompt'), postText = clean(post?.content, 'post-history instructions');
  if (mainText !== undefined) preset.mainPrompt = mainText;
  if (postText !== undefined) preset.postHistory = postText;
  // Upstream: a prompt with `forbid_overrides` is not replaced by the character card's own text.
  if (main?.forbid_overrides === true) preset.preferCardSystemPrompt = false;
  if (post?.forbid_overrides === true) preset.preferCardPostHistory = false;
  const skippedPrompts = prompts.filter(prompt => !SECTION_IDS.includes(prompt.identifier) || (prompt.identifier === 'nsfw' && typeof prompt.content === 'string' && prompt.content.trim()));
  if (skippedPrompts.length) warnings.push(`Ignored ${skippedPrompts.length} custom or auxiliary prompt(s); only the main prompt and post-history instructions are imported.`);

  // prompt_order: [{character_id, order: [{identifier, enabled}]}]; 100001 is upstream's global order.
  let list = null;
  if (Array.isArray(source.prompt_order)) {
    const groups = source.prompt_order.filter(isObject);
    const chosen = groups.find(group => group.character_id === 100001 && Array.isArray(group.order)) || groups.filter(group => Array.isArray(group.order)).pop();
    list = chosen ? chosen.order : source.prompt_order.every(item => isObject(item) && typeof item.identifier === 'string') ? source.prompt_order : null;
  }
  if (list) {
    const order = [], sections = {}, unknown = [];
    for (const item of list.slice(0, LIMITS.prompts)) {
      if (!isObject(item) || typeof item.identifier !== 'string') continue;
      if (!SECTION_IDS.includes(item.identifier)) { if (unknown.length < 10) unknown.push(item.identifier.slice(0, 40)); continue; }
      if (order.includes(item.identifier)) continue;
      order.push(item.identifier);
      if (typeof item.enabled === 'boolean') sections[item.identifier] = {enabled: item.enabled};
    }
    preset.order = order; preset.sections = sections;
    if (unknown.length) warnings.push(`Ignored prompt order items without a counterpart: ${unknown.join(', ')}.`);
  }

  const sampling = {};
  for (const [key, from] of [['temperature', 'temperature'], ['topP', 'top_p'], ['maxTokens', 'openai_max_tokens']]) {
    const raw = source[from];
    if (raw === undefined || raw === null) continue;
    if (typeof raw !== 'number' || !Number.isFinite(raw)) { warnings.push(`Ignored ${from}: not a number.`); continue; }
    const [min, max] = SAMPLING[key];
    const bounded = Math.min(max, Math.max(min, key === 'maxTokens' ? Math.round(raw) : raw));
    if (bounded !== raw) warnings.push(`Adjusted ${from} to ${bounded}.`);
    sampling[key] = bounded;
  }
  preset.sampling = sampling;

  const read = ['prompts', 'prompt_order', 'temperature', 'top_p', 'openai_max_tokens'];
  const ignored = Object.keys(source).filter(key => !read.includes(key));
  if (ignored.length) {
    const shown = ignored.slice(0, LIMITS.ignoredKeys).map(key => key.replace(/[^\w.-]/g, '?').slice(0, 40));
    warnings.push(`Ignored ${ignored.length} other setting(s): ${shown.join(', ')}${ignored.length > shown.length ? ', ...' : ''}.`);
  }
  return {preset: validatePreset(preset), warnings};
}

module.exports = {LIMITS, SAMPLING, validatePreset, importSillyTavernPreset};
