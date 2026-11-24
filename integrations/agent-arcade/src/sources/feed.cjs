'use strict';
// RSS 2.0 / Atom items and whole-page change detection over a bounded HTTPS
// GET. Everything read from the network is data: titles are tag-stripped and
// bounded, links are kept only when they are plain http(s) URLs.
const {createHash} = require('node:crypto');
const {makeEvent, isSourceId, cleanText, digest} = require('./event.cjs');

const MAX_BYTES = 2 * 1024 * 1024, MAX_ITEMS = 200, MAX_SEEN = 500, MAX_EVENTS = 20;
const MIN_INTERVAL = 300000, MAX_INTERVAL = 86400000;
const fail = (code, message) => Object.assign(new Error(message || code), {code});
const isHexDigest = (value, length) => typeof value === 'string' && value.length === length && !/[^a-f0-9]/.test(value);

function httpsUrl(value) {
  if (typeof value !== 'string' || !value || value.length > 2048 || /[\s\x00-\x1f\x7f]/.test(value)) throw fail('invalid_input', 'The URL must be an https:// address.');
  let url;
  try { url = new URL(value); } catch { throw fail('invalid_input', 'The URL must be an https:// address.'); }
  if (url.protocol !== 'https:') throw fail('invalid_input', 'The URL must be an https:// address.');
  if (url.username || url.password) throw fail('invalid_input', 'The URL must not contain a user name or password.');
  url.hash = '';
  return url;
}
const displayUrl = url => `${url.origin}${url.pathname}`;

async function fetchBounded(href, {fetchImpl, timeoutMs = 20000, signal, maxBytes = MAX_BYTES, accept = '*/*'} = {}) {
  if (signal?.aborted) throw fail('aborted');
  const timeout = new AbortController(), timer = setTimeout(() => timeout.abort(), timeoutMs);
  const combined = signal ? AbortSignal.any([timeout.signal, signal]) : timeout.signal;
  const reason = () => fail(timeout.signal.aborted ? 'timeout' : 'aborted');
  let onAbort, reader;
  const aborted = new Promise((resolve, reject) => { onAbort = () => reject(reason()); combined.addEventListener('abort', onAbort, {once:true}); });
  aborted.catch(() => {});
  try {
    let response;
    try {
      response = await Promise.race([aborted,
        fetchImpl(href, {method:'GET', redirect:'manual', credentials:'omit', signal:combined, headers:{accept}})]);
    } catch (error) { throw combined.aborted ? reason() : error?.code === 'aborted' || error?.code === 'timeout' ? error : fail('fetch_failed', 'The request failed.'); }
    if (!response || typeof response.status !== 'number') throw fail('invalid_response');
    if ((response.status >= 300 && response.status < 400) || response.type === 'opaqueredirect') {
      await response.body?.cancel().catch(() => {});
      throw fail('redirected', 'The server redirected the request; redirects are not followed.');
    }
    if (!response.ok) { await response.body?.cancel().catch(() => {}); throw fail('http_error', `The server answered HTTP ${response.status}.`); }
    if (Number(response.headers?.get('content-length')) > maxBytes) { await response.body?.cancel().catch(() => {}); throw fail('too_large', 'The response is larger than 2 MiB.'); }
    if (!response.body) throw fail('invalid_response');
    reader = response.body.getReader();
    const chunks = []; let size = 0;
    while (true) {
      if (combined.aborted) throw reason();
      const chunk = await Promise.race([aborted, reader.read()]);
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > maxBytes) throw fail('too_large', 'The response is larger than 2 MiB.');
      chunks.push(chunk.value);
    }
    return {bytes:Buffer.concat(chunks, size), contentType:String(response.headers?.get('content-type') || '')};
  } finally {
    clearTimeout(timer); combined.removeEventListener('abort', onAbort);
    if (reader) { reader.cancel().catch(() => {}); try { reader.releaseLock(); } catch {} }
  }
}
function decodeBody(bytes, contentType) {
  const label = /charset\s*=\s*"?([\w.:-]{1,40})/i.exec(contentType)?.[1]
    || /^<\?xml[^>]{0,200}encoding\s*=\s*["']([\w.:-]{1,40})["']/i.exec(bytes.subarray(0, 300).toString('latin1'))?.[1] || 'utf-8';
  try { return new TextDecoder(label).decode(bytes); } catch { return new TextDecoder('utf-8').decode(bytes); }
}

const ENTITIES = {amp:'&', lt:'<', gt:'>', quot:'"', apos:"'"};
// Exactly one decoding pass over the five XML entities and numeric references;
// no DTD and no other entity is ever expanded.
function decodeEntities(text) {
  return text.replace(/&(?:#(\d{1,7})|#x([0-9a-f]{1,6})|(amp|lt|gt|quot|apos));/gi, (match, dec, hex, name) => {
    if (name) return ENTITIES[name.toLowerCase()];
    const point = dec ? Number(dec) : parseInt(hex, 16);
    return point > 0 && point <= 0x10ffff && !(point >= 0xd800 && point <= 0xdfff) ? String.fromCodePoint(point) : '';
  });
}
function innerText(raw) {
  let out = '', index = 0;
  while (true) {
    const start = raw.indexOf('<![CDATA[', index);
    if (start < 0) { out += decodeEntities(raw.slice(index)); break; }
    out += decodeEntities(raw.slice(index, start));
    const end = raw.indexOf(']]>', start + 9);
    if (end < 0) { out += raw.slice(start + 9); break; }
    out += raw.slice(start + 9, end); index = end + 3;
  }
  return out;
}
const plainText = (raw, max) => cleanText(innerText(raw).replace(/<\/?[A-Za-z!?][^>]*>/g, ' '), max);
function blocks(xml, name, max) {
  const open = new RegExp(`<${name}(?:\\s[^>]*)?>`, 'g'), close = `</${name}>`, out = [];
  let match;
  while (out.length < max && (match = open.exec(xml))) {
    const end = xml.indexOf(close, open.lastIndex);
    if (end < 0) break;
    out.push(xml.slice(open.lastIndex, end)); open.lastIndex = end + close.length;
  }
  return out;
}
function tag(block, name) {
  const match = new RegExp(`<${name}(?:\\s[^>]*)?>`).exec(block);
  if (!match) return '';
  const from = match.index + match[0].length, end = block.indexOf(`</${name}>`, from);
  return end < 0 ? '' : block.slice(from, end);
}
function webLink(value) {
  const text = cleanText(value, 2001);
  if (!text || text.length > 2000) return '';
  try {
    const url = new URL(text);
    return (url.protocol === 'https:' || url.protocol === 'http:') && !url.username && !url.password ? url.href : '';
  } catch { return ''; }
}
function atomLink(block) {
  for (const match of block.matchAll(/<link\b([^>]*)>/g)) {
    const href = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)')/.exec(match[1]);
    if (!href) continue;
    const rel = /\brel\s*=\s*(?:"([^"]*)"|'([^']*)')/.exec(match[1]);
    if ((rel ? (rel[1] ?? rel[2]) : 'alternate') === 'alternate') return decodeEntities(href[1] ?? href[2]);
  }
  return '';
}
function parseFeed(xml) {
  if (typeof xml !== 'string') throw fail('invalid_feed', 'The feed is not text.');
  if (Buffer.byteLength(xml) > MAX_BYTES) throw fail('too_large', 'The feed is larger than 2 MiB.');
  const atom = /<feed[\s>]/.test(xml);
  if (!atom && !/<(?:rss|rdf:RDF|channel)[\s>]/.test(xml)) throw fail('invalid_feed', 'The response is not an RSS or Atom feed.');
  const items = [];
  for (const block of blocks(xml, atom ? 'entry' : 'item', MAX_ITEMS)) {
    const title = plainText(tag(block, 'title'), 200);
    const link = webLink(atom ? atomLink(block) : innerText(tag(block, 'link')));
    const rawId = cleanText(innerText(tag(block, atom ? 'id' : 'guid')), 2000) || link || title;
    if (!rawId) continue;
    const dateText = atom ? tag(block, 'published') || tag(block, 'updated') : tag(block, 'pubDate') || tag(block, 'dc:date');
    const date = Date.parse(cleanText(innerText(dateText), 80));
    items.push({id:digest(rawId, 24), title, link, publishedAt:Number.isFinite(date) ? date : null});
  }
  return items;
}

function createFeedSource({id, url, mode = 'feed', intervalMs = 900000, fetchImpl = globalThis.fetch, timeoutMs = 20000, now = Date.now} = {}) {
  if (!isSourceId(id)) throw fail('invalid_input', 'The source id must be 1-64 characters of A-Z, a-z, 0-9, _ or -.');
  const target = httpsUrl(url);
  if (mode !== 'feed' && mode !== 'page') throw fail('invalid_input', 'The mode must be "feed" or "page".');
  if (!Number.isInteger(intervalMs) || intervalMs < MIN_INTERVAL || intervalMs > MAX_INTERVAL) throw fail('invalid_input', 'The check interval must be between 5 minutes and 24 hours.');
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 60000) throw fail('invalid_input', 'The timeout must be between 1 and 60 seconds.');
  if (typeof fetchImpl !== 'function' || typeof now !== 'function') throw fail('invalid_input', 'Invalid feed source options.');
  const subject = displayUrl(target);
  const pageIdentity = mode === 'page' ? digest(target.href) : null;
  async function poll(cursor, signal) {
    const {bytes, contentType} = await fetchBounded(target.href, {fetchImpl, timeoutMs, signal,
      accept:mode === 'feed' ? 'application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.8' : 'text/html, */*;q=0.5'});
    const at = now(), previous = cursor && typeof cursor === 'object' ? cursor : {};
    if (mode === 'page') {
      const hash = createHash('sha256').update(bytes).digest('hex');
      if (!isHexDigest(previous.hash, 64)) return {cursor:{hash}, events:[]};
      const lastOccurrence = isHexDigest(previous.occurrence, 32) ? previous.occurrence : null;
      if (previous.hash === hash) return {cursor:{hash, ...(lastOccurrence ? {occurrence:lastOccurrence} : {})}, events:[]};
      // Track the transition, not just the arriving body. A saved-cursor retry
      // has the same identity, while a later return to the same bytes is new.
      const occurrence = digest(JSON.stringify([lastOccurrence || pageIdentity, previous.hash, hash]));
      const event = makeEvent({source:id, kind:'page.changed', subject, key:`page-occurrence-v1:${occurrence}`,
        title:'Page changed', detail:subject, at, data:{url:subject}});
      return {cursor:{hash, occurrence}, events:[event]};
    }
    const items = parseFeed(decodeBody(bytes, contentType));
    const baseline = !Array.isArray(previous.seen), seen = new Set(baseline ? [] : previous.seen.filter(x => typeof x === 'string'));
    // Document order is usually newest first: deliver the oldest unseen items
    // first and leave anything past the cap unseen for the next poll.
    const fresh = baseline ? [] : items.filter(item => !seen.has(item.id)).slice(-MAX_EVENTS).reverse();
    const events = fresh.map(item => makeEvent({source:id, kind:'feed.item', subject, key:item.id, title:item.title || '(untitled)',
      detail:item.link, at, data:{link:item.link, publishedAt:item.publishedAt}}));
    const current = new Set(items.map(item => item.id)), emitted = new Set(fresh.map(item => item.id));
    const kept = items.map(item => item.id).filter(x => baseline || seen.has(x) || emitted.has(x));
    return {cursor:{seen:[...[...seen].filter(x => !current.has(x)), ...new Set(kept)].slice(-MAX_SEEN)}, events};
  }
  return Object.freeze({id, kind:'feed', mode, intervalMs, target:subject, poll});
}

module.exports = {createFeedSource, parseFeed, fetchBounded, httpsUrl, displayUrl, MAX_BYTES};
