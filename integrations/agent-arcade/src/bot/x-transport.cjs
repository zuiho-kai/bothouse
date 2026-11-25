'use strict';

// Fixed X standard-DM transport. No OAuth flow, token refresh,
// public listener, SDK retries, browser automation, or encrypted Chat API.
const ORIGIN = 'https://api.x.com';
const MAX_RESPONSE_BYTES = 1024 * 1024;
const MAX_TEXT = 6000;
const {TextDecoder} = require('node:util');

class XError extends Error {
  constructor(code, details = {}) {
    super(`X DM request failed (${code}).`);
    this.name = code === 'aborted' ? 'AbortError' : 'XError';
    this.code = code;
    if (details.submitted === true) this.submitted = true;
    if (Number.isSafeInteger(details.retryAt) && details.retryAt >= 0) this.retryAt = details.retryAt;
  }
}
function id(value) { return typeof value === 'string' && /^[1-9]\d{0,18}$/.test(value); }
function plain(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function text(value) {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= MAX_TEXT &&
    Buffer.byteLength(value) <= 24000 && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value) &&
    !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value);
}
function token(value) {
  if (typeof value !== 'string' || !/^[\x21-\x7e]{8,4096}$/.test(value)) throw new XError('invalid_token');
  return value;
}
function pagination(value) {
  if (value === undefined) return;
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{16,2048}$/.test(value)) throw new XError('invalid_pagination');
  return value;
}
function rate(headers, now) {
  const integer = key => { const value = headers.get(key); return typeof value === 'string' && /^\d{1,13}$/.test(value) ? Number(value) : null; };
  const remaining = integer('x-rate-limit-remaining'), reset = integer('x-rate-limit-reset');
  let retryAt = reset === null ? null : reset * 1000;
  const after = headers.get('retry-after');
  if (typeof after === 'string' && /^\d{1,8}$/.test(after)) retryAt = Math.max(retryAt || 0, now + Number(after) * 1000);
  // Header values are only a bounded delay hint, not proof of identity or quota.
  if (!Number.isSafeInteger(retryAt) || retryAt <= now || retryAt > now + 86400000) retryAt = null;
  return {remaining: Number.isSafeInteger(remaining) && remaining <= 1000000 ? remaining : null, retryAt};
}
async function boundedJSON(response, signal) {
  const length = response.headers.get('content-length');
  if (length !== null && (!/^\d{1,12}$/.test(length) || Number(length) > MAX_RESPONSE_BYTES)) {
    await response.body?.cancel().catch(() => {}); throw new XError('response_too_large');
  }
  const type = response.headers.get('content-type') || '';
  if (!/^application\/(?:json|[\w.+-]+\+json)(?:;|$)/i.test(type)) {
    await response.body?.cancel().catch(() => {}); throw new XError('invalid_response');
  }
  if (!response.body) throw new XError('invalid_response');
  const reader = response.body.getReader(), chunks = []; let size = 0;
  try {
    while (true) {
      if (signal.aborted) throw new XError('aborted');
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > MAX_RESPONSE_BYTES) throw new XError('response_too_large');
      chunks.push(chunk.value);
    }
    if (signal.aborted) throw new XError('aborted');
    let result;
    try { result = JSON.parse(new TextDecoder('utf-8', {fatal:true}).decode(Buffer.concat(chunks, size))); }
    catch { throw new XError('invalid_response'); }
    if (!plain(result)) throw new XError('invalid_response');
    return result;
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
function createXTransport({accessToken, ownerId, timeoutMs = 15000, now = Date.now, fetchImpl = globalThis.fetch} = {}) {
  let secret = token(accessToken), closed = false;
  if (!id(ownerId)) throw new XError('invalid_owner');
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000 || typeof fetchImpl !== 'function') throw new XError('invalid_input');
  const lifetime = new AbortController(), participantPath = `/2/dm_conversations/with/${ownerId}`;
  async function request(method, pathname, query, body, {signal, assertCurrent} = {}) {
    if (closed) throw new XError('closed');
    if (signal?.aborted) throw new XError('aborted');
    const timeout = new AbortController(), timer = setTimeout(() => timeout.abort(), timeoutMs);
    const combined = AbortSignal.any([lifetime.signal, timeout.signal, ...(signal ? [signal] : [])]);
    let submitted = false;
    try {
      const url = new URL(pathname, ORIGIN);
      if (query) url.search = query.toString();
      // No await between the caller's final binding check and the native fetch.
      assertCurrent?.();
      if (combined.aborted) throw new XError('aborted');
      submitted = method === 'POST';
      const response = await fetchImpl(url.href, {method, redirect:'manual', signal:combined,
        headers:{authorization:`Bearer ${secret}`, accept:'application/json', ...(body ? {'content-type':'application/json'} : {})},
        ...(body ? {body:JSON.stringify(body)} : {})});
      if (response.status >= 300 && response.status < 400) { await response.body?.cancel().catch(() => {}); throw new XError('redirect_rejected'); }
      const limits = rate(response.headers, now());
      if (!response.ok) {
        await response.body?.cancel().catch(() => {});
        const code = response.status === 401 ? 'requires_reauthorization' : response.status === 402 ? 'credits_required' :
          response.status === 403 ? 'permission_denied' : response.status === 429 ? 'rate_limited' : 'connection_failed';
        throw new XError(code, {retryAt:limits.retryAt ?? undefined});
      }
      const data = await boundedJSON(response, combined);
      return {data, rate:limits};
    } catch (error) {
      if (submitted) throw new XError('send_unknown', {submitted:true, retryAt:error?.retryAt});
      if (closed) throw new XError('closed');
      if (signal?.aborted) throw new XError('aborted');
      if (timeout.signal.aborted) throw new XError('timeout');
      if (error instanceof XError) throw error;
      throw new XError('connection_failed');
    } finally { clearTimeout(timer); }
  }
  return {
    me(options) { return request('GET', '/2/users/me', null, null, options); },
    events({paginationToken, ...options} = {}) {
      const next = pagination(paginationToken);
      const query = new URLSearchParams({max_results:'100', event_types:'MessageCreate',
        'dm_event.fields':'id,text,event_type,created_at,dm_conversation_id,attachments,entities',
        expansions:'sender_id,participant_ids,referenced_posts'});
      if (next) query.set('pagination_token', next);
      return request('GET', `${participantPath}/dm_events`, query, null, options);
    },
    sendText({text:body, ...options} = {}) {
      if (!text(body)) return Promise.reject(new XError('invalid_text'));
      return request('POST', `${participantPath}/messages`, null, {text:body}, options);
    },
    close() { if (!closed) { closed = true; secret = ''; lifetime.abort(); } }
  };
}
module.exports = {createXTransport, XError, id, text, plain, pagination, MAX_TEXT, MAX_RESPONSE_BYTES};
