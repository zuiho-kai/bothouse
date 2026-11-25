'use strict';
// Strict validation and persistence of the user's listen-source list.
const fs = require('node:fs');
const path = require('node:path');
const {atomicJSON} = require('../core/files.cjs');
const {isSourceId} = require('./event.cjs');
const {createIcsSource} = require('./ics.cjs');
const {createFolderSource} = require('./folder.cjs');
const {createFeedSource} = require('./feed.cjs');

const VERSION = 1, MAX_SOURCES = 20, MAX_FILE_BYTES = 256 * 1024;
const NOTIFY = Object.freeze(['none', 'desktop', 'companion', 'both']);
const COMMON = ['id', 'kind', 'name', 'enabled', 'notify'];
const FIELDS = Object.freeze({
  ics: Object.freeze(['file', 'url', 'leadMinutes', 'timeZone']),
  folder: Object.freeze(['dir', 'intervalMs', 'maxEntries']),
  feed: Object.freeze(['url', 'mode', 'intervalMs', 'timeoutMs']),
});
const FACTORIES = Object.freeze({ics:createIcsSource, folder:createFolderSource, feed:createFeedSource});
const invalid = message => Object.assign(new Error(message), {code:'sources_invalid'});
const plain = value => !!value && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));

// Kind-specific options exactly as the factory accepts them.
function sourceOptions(source) {
  const options = {id:source.id};
  for (const key of FIELDS[source.kind]) if (Object.hasOwn(source, key)) options[key] = source[key];
  return options;
}
function validateSource(value, index) {
  const label = `Source ${index + 1}`;
  if (!plain(value)) throw invalid(`${label} must be an object.`);
  if (!isSourceId(value.id)) throw invalid(`${label}: the id must be 1-64 characters of A-Z, a-z, 0-9, _ or -.`);
  if (!Object.hasOwn(FIELDS, value.kind)) throw invalid(`${label}: the kind must be "ics", "folder" or "feed".`);
  const unknown = Object.keys(value).find(key => !COMMON.includes(key) && !FIELDS[value.kind].includes(key));
  if (unknown !== undefined) throw invalid(`${label}: unknown setting "${String(unknown).slice(0, 40)}".`);
  if (typeof value.name !== 'string' || !value.name.trim() || value.name.length > 60 || /[\x00-\x1f\x7f]/.test(value.name)) throw invalid(`${label}: the name must be 1-60 characters.`);
  if (typeof value.enabled !== 'boolean') throw invalid(`${label}: "enabled" must be true or false.`);
  if (!NOTIFY.includes(value.notify)) throw invalid(`${label}: "notify" must be none, desktop, companion or both.`);
  for (const key of FIELDS[value.kind]) {
    if (Object.hasOwn(value, key) && !['string', 'number'].includes(typeof value[key])) throw invalid(`${label}: invalid "${key}".`);
  }
  const normalized = {id:value.id, kind:value.kind, name:value.name.trim(), enabled:value.enabled, notify:value.notify, ...sourceOptions(value)};
  // The factory is the single authority on option types and ranges; building
  // a source performs no I/O.
  try { FACTORIES[value.kind](sourceOptions(normalized)); } catch (error) { throw invalid(`${label}: ${String(error?.message || 'invalid settings').slice(0, 160)}`); }
  return normalized;
}
function validateSources(value) {
  let list = value;
  if (!Array.isArray(value)) {
    if (!plain(value) || Object.keys(value).some(key => key !== 'version' && key !== 'sources')) throw invalid('The source list has unknown settings.');
    if (value.version !== VERSION) throw invalid('Unsupported source list version.');
    list = value.sources;
  }
  if (!Array.isArray(list)) throw invalid('The source list must be an array.');
  if (list.length > MAX_SOURCES) throw invalid(`At most ${MAX_SOURCES} sources are supported.`);
  const ids = new Set(), out = [];
  list.forEach((item, index) => {
    const source = validateSource(item, index);
    if (ids.has(source.id)) throw invalid(`Source ${index + 1}: duplicate id "${source.id}".`);
    ids.add(source.id); out.push(source);
  });
  return out;
}
// Display-safe description of what a source reads: no query string, no credentials.
function displayTarget(source) {
  try {
    if (source.kind === 'folder') return String(source.dir);
    if (source.kind === 'ics' && source.file !== undefined) return path.basename(String(source.file));
    const url = new URL(source.url);
    return `${url.origin}${url.pathname}`;
  } catch { return ''; }
}
function loadSources(file) {
  let text;
  try {
    if (fs.statSync(file).size > MAX_FILE_BYTES) return {sources:[], problem:'The source list file is too large and was ignored.'};
    text = fs.readFileSync(file, 'utf8');
  } catch (error) {
    return error?.code === 'ENOENT' ? {sources:[]} : {sources:[], problem:'The source list could not be read and was ignored.'};
  }
  try { return {sources:validateSources(JSON.parse(text))}; }
  catch (error) {
    return {sources:[], problem:error?.code === 'sources_invalid' ? `The source list was ignored. ${error.message}` : 'The source list is not valid JSON and was ignored.'};
  }
}
function saveSources(file, value) {
  const sources = validateSources(value);
  atomicJSON(file, {version:VERSION, sources});
  return sources;
}

module.exports = {validateSources, loadSources, saveSources, sourceOptions, displayTarget, VERSION, MAX_SOURCES, NOTIFY, FIELDS};
