'use strict';
// Normalized envelope for everything a listen source reports. All text is
// external DATA: it is bounded and stripped here and must never be executed or
// treated as instructions by a consumer.
const {createHash} = require('node:crypto');

const KINDS = Object.freeze(['calendar.upcoming', 'calendar.due', 'folder.added', 'folder.changed', 'folder.removed',
  'feed.item', 'page.changed']);
const IMPORTANCE = Object.freeze(['low', 'normal', 'high']);
const LIMITS = Object.freeze({source:64, subject:200, title:200, detail:1000, dataBytes:2000});
const SOURCE_ID = /^[A-Za-z0-9_-]{1,64}$/;
// C0/C1 controls, zero-width and bidirectional overrides, line/paragraph separators, BOM.
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u2069\ufeff]/g;

const isKind = value => typeof value === 'string' && KINDS.includes(value);
const isSourceId = value => typeof value === 'string' && SOURCE_ID.test(value);
const digest = (value, length = 32) => createHash('sha256').update(String(value)).digest('hex').slice(0, length);

function cleanText(value, max) {
  let out = String(value).slice(0, max * 8 + 256).replace(CONTROL, ' ').replace(/\s+/g, ' ').trim();
  if (out.length > max) {
    out = out.slice(0, max - 1);
    if (/[\ud800-\udbff]$/.test(out)) out = out.slice(0, -1);
    out += '\u2026';
  }
  return out;
}
function freezeDeep(value) {
  if (value && typeof value === 'object') { for (const item of Object.values(value)) freezeDeep(item); Object.freeze(value); }
  return value;
}
function boundedData(value) {
  if (value === undefined) return {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Event data must be a plain object.');
  try {
    const json = JSON.stringify(value);
    if (typeof json !== 'string' || Buffer.byteLength(json) > LIMITS.dataBytes) return {};
    const copy = JSON.parse(json);
    return copy && typeof copy === 'object' && !Array.isArray(copy) ? copy : {};
  } catch { return {}; }
}
function makeEvent(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('Event input must be an object.');
  const {source, kind, subject, title, detail = '', at, importance = 'normal', data, key = ''} = input;
  if (!isSourceId(source)) throw new TypeError('Event source must be 1-64 characters of A-Z, a-z, 0-9, _ or -.');
  if (!isKind(kind)) throw new TypeError('Unknown event kind.');
  for (const [label, value] of [['subject', subject], ['title', title], ['detail', detail]]) {
    if (typeof value !== 'string') throw new TypeError(`Event ${label} must be a string.`);
  }
  if (!Number.isSafeInteger(at) || at < 0) throw new TypeError('Event time must be an integer number of milliseconds.');
  if (!IMPORTANCE.includes(importance)) throw new TypeError('Event importance must be low, normal or high.');
  if (typeof key !== 'string' && !Number.isSafeInteger(key)) throw new TypeError('Event key must be a string or an integer.');
  const cleanSubject = cleanText(subject, LIMITS.subject);
  return freezeDeep({
    id: digest(JSON.stringify([source, kind, cleanSubject, String(key).slice(0, 2000)])),
    at, source, kind, subject: cleanSubject, title: cleanText(title, LIMITS.title), detail: cleanText(detail, LIMITS.detail),
    importance, data: boundedData(data),
  });
}

module.exports = {makeEvent, KINDS, IMPORTANCE, LIMITS, isKind, isSourceId, cleanText, digest};
