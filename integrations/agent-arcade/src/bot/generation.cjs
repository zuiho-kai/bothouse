'use strict';
// Shared per-request generation settings for the conversation runners.
// Task (tool) mode keeps the 6,000-character message bound used by every
// channel; companion conversation may carry a longer assembled context
// (character card, lorebook entries, history).
const {SafeError, checkAbort, abortable} = require('./file-tools.cjs');
const TASK_PROMPT_CHARS = 6000, CHAT_PROMPT_CHARS = 24000;
const promptLimit = conversationOnly => conversationOnly ? CHAT_PROMPT_CHARS : TASK_PROMPT_CHARS;
const RANGES = Object.freeze({temperature:[0, 2], topP:[0, 1], maxTokens:[64, 8192]});
// Returns a clean {temperature?, topP?, maxTokens?}; absent or null fields are omitted.
function sampling(value) {
  if (value === undefined || value === null) return {};
  if (typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !Object.hasOwn(RANGES, key))) throw Error('Invalid sampling settings.');
  const out = {};
  for (const [key, [low, high]] of Object.entries(RANGES)) {
    const item = value[key];
    if (item === undefined || item === null) continue;
    if (typeof item !== 'number' || !Number.isFinite(item) || item < low || item > high || key === 'maxTokens' && !Number.isInteger(item)) throw Error('Invalid sampling settings.');
    out[key] = item;
  }
  return out;
}
// The App's explicit numeric fields override its preset values. Group setup
// can copy the result without reading any of the preset's prompt sections.
function presetSampling(settings = {}) {
  const values = Object.create(null);
  for (const source of [settings.preset?.sampling, settings.sampling]) {
    for (const [key, value] of Object.entries(source || {})) {
      if (value !== null && value !== undefined) values[key] = value;
    }
  }
  return sampling(values);
}
// Streamed replies (conversation-only path of the API runners). `onDelta(chunk)` receives each
// new piece of reply text in order; it is best-effort display data: a throwing or rejecting
// callback is ignored and never reaches the request. The runner still resolves with the same
// final result as a non-streamed request, and only that result may be stored.
function deltaEmitter(onDelta) {
  if (typeof onDelta !== 'function') return null;
  return chunk => {
    if (typeof chunk !== 'string' || !chunk) return;
    try { const pending = onDelta(chunk); if (pending && typeof pending.then === 'function') pending.then(undefined, () => {}); } catch { /* display only */ }
  };
}
const streamErrors = label => ({
  malformed: () => new SafeError(`${label} returned malformed data.`),
  unsupported: () => new SafeError(`${label} returned an unsupported response.`),
  failed: () => new SafeError(`${label} could not complete this request. Check its service and your connection.`),
});
function sseJSON(payload, label) {
  let value;
  try { value = JSON.parse(payload); } catch { throw streamErrors(label).malformed(); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw streamErrors(label).malformed();
  return value;
}
/**
 * Reads a `text/event-stream` body. `onData(payload)` gets the joined `data:` lines of each
 * event and returns true to stop reading. Bytes are counted across the whole stream against
 * `maxBytes`; UTF-8 sequences and lines may be split anywhere between chunks. An event that is
 * not terminated by a blank line when the stream ends is discarded.
 */
async function readSSE(response, signal, {maxBytes, label, onData}) {
  if (!response?.body?.getReader) throw new SafeError(`${label} returned an unreadable response.`);
  const reader = response.body.getReader(), decoder = new TextDecoder('utf-8', {fatal: true});
  let size = 0, buffer = '', data = [], stop = false;
  const line = text => {
    if (text === '') { if (data.length) { const payload = data.join('\n'); data = []; if (onData(payload) === true) stop = true; } return; }
    if (text.startsWith(':')) return;
    const colon = text.indexOf(':'), field = colon < 0 ? text : text.slice(0, colon);
    if (field !== 'data') return;
    const value = colon < 0 ? '' : text.slice(colon + 1);
    data.push(value.startsWith(' ') ? value.slice(1) : value);
  };
  try {
    while (!stop) {
      checkAbort(signal);
      const {done, value} = await abortable(reader.read(), signal);
      if (done) break;
      if (!(value instanceof Uint8Array)) throw new SafeError(`${label} returned unreadable data.`);
      size += value.byteLength;
      if (size > maxBytes) throw new SafeError(`${label} response exceeded the local size limit.`, 'limit');
      try { buffer += decoder.decode(value, {stream: true}); } catch { throw streamErrors(label).malformed(); }
      let index;
      while (!stop && (index = buffer.indexOf('\n')) >= 0) {
        const raw = buffer.slice(0, index);
        buffer = buffer.slice(index + 1);
        line(raw.endsWith(String.fromCharCode(13)) ? raw.slice(0, -1) : raw);
      }
    }
  } finally {
    try { Promise.resolve(reader.cancel()).catch(() => {}); } catch { /* already closed */ }
    try { reader.releaseLock(); } catch { /* already released */ }
  }
}
/**
 * Collector for an OpenAI-style chat-completions stream (DeepSeek, Ark): `choices[0].delta.content`
 * chunks, a `finish_reason`, then `data: [DONE]`. `result()` returns the equivalent non-streamed
 * body, or throws the malformed-response error when the stream ended without both terminal marks.
 * Conversation-only: any tool-call delta is refused.
 */
function chatStream(label, emit) {
  const errors = streamErrors(label);
  let content = '', finish, done = false, refusal = false;
  return {
    data(payload) {
      if (payload === '[DONE]') { done = true; return true; }
      const value = sseJSON(payload, label);
      if (value.error) throw errors.failed();
      if (value.choices === undefined || Array.isArray(value.choices) && !value.choices.length) return false;
      if (!Array.isArray(value.choices) || value.choices.length !== 1 || !value.choices[0] || typeof value.choices[0] !== 'object') throw errors.unsupported();
      const choice = value.choices[0], delta = choice.delta;
      if (delta !== undefined && delta !== null) {
        if (typeof delta !== 'object' || Array.isArray(delta)) throw errors.unsupported();
        if (delta.tool_calls !== undefined && delta.tool_calls !== null && !(Array.isArray(delta.tool_calls) && !delta.tool_calls.length)) throw new SafeError('A tool call was refused in conversation-only mode. No action was performed.');
        if (delta.refusal) refusal = true;
        if (typeof delta.content === 'string') { if (delta.content) { content += delta.content; emit(delta.content); } }
        else if (delta.content !== undefined && delta.content !== null) throw errors.unsupported();
      }
      if (typeof choice.finish_reason === 'string') finish = choice.finish_reason;
      return false;
    },
    result() {
      if (!done || finish === undefined) throw errors.malformed();
      return {choices: [{message: {role: 'assistant', content, ...(refusal ? {refusal: true} : {})}, finish_reason: finish}]};
    },
  };
}
module.exports = {TASK_PROMPT_CHARS, CHAT_PROMPT_CHARS, promptLimit, sampling, presetSampling, RANGES, deltaEmitter, readSSE, sseJSON, chatStream};
