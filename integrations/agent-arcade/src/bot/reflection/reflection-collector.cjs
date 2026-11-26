'use strict';
/*
 * Deterministic collection of what the owner said in one character's App conversation, each
 * message with the companion reply it answered, for the nightly reflection and the wiki
 * proposals. No model, no storage, no clock of its own.
 *
 * Adapted from bothouse, https://github.com/zuiho-kai/bothouse
 * Upstream path: bridge/contrib/wiki/llmwiki/ingest.py (`dialog()`: the owner's lines since the
 *   last run, each after the assistant reply it answered, cut short; `SECRET` and its redaction)
 * Upstream revision: 218051eccbb31923aa2b0d837801cf4d82c4799f
 * License: Apache-2.0, Copyright (c) 2026 zuiho-kai and bothouse contributors
 *
 * Re-implemented and modified for Agent Arcade (AGPL-3.0) on 2026-11-13:
 * - reads stored App-conversation rows (`{id, role, text, at}`) instead of session transcripts;
 *   there are no teammates, channels or speaker labels: a row is the owner's or the companion's;
 * - every owner message keeps its stored id so that quotes can be checked against it;
 * - memory-command exchanges, image placeholders and source notices are skipped;
 * - bounded: a first run looks back 24 hours, and the newest messages are kept within a
 *   character budget.
 */
const REPLY_CHARS = 1500, MAX_CHARS = 24000, DAY_MS = 86400000;
const SECRET = /(-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----|\b(sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|xox[abp]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16})|((?:password|passwd|pwd|密码|token|secret|api[_-]?key)\s*[:=：]\s*)\S+)/gi;
// Rows the app wrote itself: receipts of memory commands and source notices are not companion replies.
const APP_LINE = /^local-out:(?:command|notice):/;

/** Replaces private keys, well-known token shapes and `password: value` style values with [REDACTED]. */
const redact = text => String(text ?? '').replace(SECRET, (_match, _whole, _token, label) => `${label || ''}[REDACTED]`);
const localDay = ms => { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

/**
 * @param {object} input
 * @param {{id: string, role: 'user'|'assistant', text: string, at: number}[]} input.rows the stored
 *   conversation, oldest first
 * @param {number|null} [input.since] only owner messages stored after this time; null: the last 24 hours
 * @param {number} input.now
 * @param {number} [input.maxChars] budget for owner text plus replies; the oldest messages are dropped first
 * @param {number} [input.replyChars] cut of the preceding companion reply; 0 leaves replies out
 * @returns {{messages: {id: string, at: number, day: string, text: string, reply: string}[], read: number,
 *   dropped: number, chars: number, lastAt: number|null}} `lastAt`: the newest eligible message, kept or not
 */
function collect({rows, since = null, now, maxChars = MAX_CHARS, replyChars = REPLY_CHARS} = {}) {
  const list = Array.isArray(rows) ? rows : [], from = Number.isSafeInteger(since) ? since : now - DAY_MS;
  const budget = Number.isInteger(maxChars) && maxChars > 0 ? Math.min(maxChars, MAX_CHARS) : MAX_CHARS;
  const found = [];
  let lastAt = null;
  list.forEach((row, index) => {
    if (!row || row.role !== 'user' || typeof row.id !== 'string' || typeof row.text !== 'string' || !Number.isSafeInteger(row.at) || row.at <= from || row.at > now) return;
    if (row.id.startsWith('local-image:')) return;
    const next = list[index + 1], previous = list[index - 1];
    if (next && next.role === 'assistant' && typeof next.id === 'string' && next.id.startsWith('local-out:command:')) return;
    const text = redact(row.text).trim();
    if (!text) return;
    const answered = replyChars > 0 && previous && previous.role === 'assistant' && typeof previous.text === 'string' && !(typeof previous.id === 'string' && APP_LINE.test(previous.id)) ? redact(previous.text).trim() : '';
    found.push({id: row.id, at: row.at, day: localDay(row.at), text, reply: answered.length > replyChars ? `${answered.slice(0, replyChars)}…` : answered});
    if (lastAt === null || row.at > lastAt) lastAt = row.at;
  });
  let chars = found.reduce((sum, item) => sum + item.text.length + item.reply.length, 0), dropped = 0;
  while (found.length && chars > budget) { const gone = found.shift(); chars -= gone.text.length + gone.reply.length; dropped += 1; }
  return {messages: found, read: found.length, dropped, chars, lastAt};
}

/** `Map<id, {role: 'user', text, at, day}>` of collected messages, for quote verification. */
const messageMap = messages => new Map(messages.map(item => [item.id, {role: 'user', text: item.text, at: item.at, day: item.day}]));

/**
 * The model's whole output must be one JSON array of at most `maxItems` items (a single
 * surrounding code fence is tolerated). Anything else returns null: the run is discarded.
 */
function parseStrictArray(output, maxItems) {
  if (typeof output !== 'string' || output.length > 40000) return null;
  let text = output.trim();
  const fenced = /^```(?:json)?[ \t]*\r?\n([\s\S]*?)\r?\n```$/.exec(text);
  if (fenced) text = fenced[1].trim();
  let value;
  try { value = JSON.parse(text); } catch { return null; }
  return Array.isArray(value) && value.length <= maxItems ? value : null;
}

module.exports = {collect, redact, messageMap, parseStrictArray, localDay, SECRET, REPLY_CHARS, MAX_CHARS};
