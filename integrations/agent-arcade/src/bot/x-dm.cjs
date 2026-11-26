'use strict';

// Fixed-owner X standard-DM channel. Live platform/account acceptance is separate.
const {randomUUID} = require('node:crypto');
const {prepareInbound} = require('./weixin.cjs');
const {createXTransport, XError, id, text, plain, pagination} = require('./x-transport.cjs');
const POLL_INTERVAL = 75000, WINDOW = 900000, MAX_BATCH = 200, MAX_PAGES = 3, MAX_SEEN = 10000;
const EVENT_FIELDS = new Set(['id','event_type','sender_id','dm_conversation_id','created_at','text','participant_ids',
  'attachments','entities','referenced_posts','referenced_tweets','reply_to','in_reply_to','quote','quoted_message']);
const FATAL = new Set(['account_mismatch','account_changed','requires_reauthorization','permission_denied',
  'credits_required','invalid_response','response_too_large','backlog_limit','seen_limit','redirect_rejected']);
function delay(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new XError('aborted'));
    const timer = setTimeout(done, ms);
    function done() { signal.removeEventListener('abort', abort); resolve(); }
    function abort() { clearTimeout(timer); signal.removeEventListener('abort', abort); reject(new XError('aborted')); }
    signal.addEventListener('abort', abort, {once:true});
  });
}
function conversation(a, b) { return BigInt(a) < BigInt(b) ? `${a}-${b}` : `${b}-${a}`; }
function result(value) {
  if (!plain(value?.data) || (value.data.errors !== undefined && (!Array.isArray(value.data.errors) || value.data.errors.length))) throw new XError('invalid_response');
  return value.data;
}
function created(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(value)) throw new XError('invalid_response');
  const time = Date.parse(value);
  const normalized = value.includes('.') ? value.replace(/\.(\d{1,3})Z$/, (_,fraction) => `.${fraction.padEnd(3,'0')}Z`) : value.replace(/Z$/,'.000Z');
  if (!Number.isSafeInteger(time) || new Date(time).toISOString() !== normalized) throw new XError('invalid_response');
  return time;
}
function has(value) { return value !== undefined && value !== null && (!plain(value) || Object.keys(value).length !== 0); }
function prepareXInbound(message) {
  if (message.unsupported) return {...message, text:'', rejection:'X 渠道只处理指定主人的单独私信文字。附件和混合内容不会作为任务或授权执行。'};
  return prepareInbound(message);
}
// Main may share this token-free budget across clients for the same expected
// account. Closing/reauthorizing a client does not reset the shared windows.
// This is an in-process request guard, not a billing or cross-process limit.
class XRateBudget {
  constructor({now = Date.now} = {}) {
    this.now = now;
    this.times = {identity:[], read:[], write:[]};
    this.blockedUntil = {identity:0, read:0, write:0};
  }
  quota(kind, consume = true) {
    if (!Object.hasOwn(this.times, kind)) throw new XError('invalid_input');
    const now = this.now(), write = kind === 'write';
    const entries = this.times[kind].filter(time => time > now - (write ? 86400000 : WINDOW));
    this.times[kind] = entries;
    const recent = entries.filter(time => time > now - WINDOW);
    let retryAt = this.blockedUntil[kind];
    if (recent.length >= (kind === 'identity' ? 75 : 15)) retryAt = Math.max(retryAt, recent[0] + WINDOW);
    if (write && entries.length >= 1440) retryAt = Math.max(retryAt, entries[0] + 86400000);
    if (retryAt > now) throw new XError('rate_limited', {retryAt});
    if (consume) entries.push(now);
  }
  block(kind, retryAt) {
    if (!Object.hasOwn(this.times, kind)) throw new XError('invalid_input');
    const now = this.now();
    const bounded = Number.isSafeInteger(retryAt) && retryAt > now && retryAt <= now + 86400000;
    this.blockedUntil[kind] = Math.max(this.blockedUntil[kind], bounded ? retryAt : now + POLL_INTERVAL);
  }
  rate(kind, response) {
    if (response?.rate?.remaining === 0) this.block(kind, response.rate.retryAt);
  }
}
class XDirectMessageClient {
  constructor({accessToken, expectedAccountId, ownerId, acceptAfter, seenIds = [], now = Date.now,
    sleep = delay, timeoutMs = 15000, transportFactory = createXTransport, rateBudget} = {}) {
    if (!id(expectedAccountId)) throw new XError('invalid_account');
    if (!id(ownerId) || ownerId === expectedAccountId) throw new XError('invalid_owner');
    this.expectedAccountId = expectedAccountId; this.ownerId = ownerId;
    this.now = now; this.sleep = sleep; this.acceptAfter = acceptAfter ?? now();
    if (!Number.isSafeInteger(this.acceptAfter) || this.acceptAfter < 0 || this.acceptAfter > now()) throw new XError('invalid_input');
    if (!Array.isArray(seenIds) || seenIds.length > MAX_SEEN || seenIds.some(value => !id(value))) throw new XError('invalid_seen');
    if (rateBudget !== undefined && !(rateBudget instanceof XRateBudget)) throw new XError('invalid_input');
    this.rateBudget = rateBudget || new XRateBudget({now});
    this.seen = new Set(seenIds); this.attempted = new Set(); this.nextPollAt = 0;
    this.accountId = ''; this.contextToken = null; this.generation = 0; this.cursor = 0;
    this.closed = false; this.ready = false; this.connecting = null; this.polling = false; this.sending = false; this.fatal = null;
    this.lifetime = new AbortController();
    this.transport = transportFactory({accessToken, ownerId, timeoutMs, now});
  }
  _signal(signal) { return AbortSignal.any([this.lifetime.signal, ...(signal ? [signal] : [])]); }
  _base(signal) {
    if (this.closed) throw new XError('closed');
    if (signal?.aborted) throw new XError('aborted');
    if (this.fatal) throw new XError(this.fatal);
  }
  _guard(generation, contextToken, signal) {
    this._base(signal);
    if (!this.ready || generation !== this.generation || !contextToken || contextToken !== this.contextToken) throw new XError('stale_context');
  }
  _problem(error) {
    const allowed = new Set([...FATAL,'rate_limited','timeout','closed','aborted','connection_failed','stale_context','concurrent_poll','concurrent_send','send_unknown','send_limit','already_attempted']);
    const code = allowed.has(error?.code) ? error.code : 'connection_failed';
    if (FATAL.has(code)) { this.fatal = code; this.ready = false; this.contextToken = null; this.generation++; }
    return new XError(code, {retryAt:error?.retryAt, submitted:error?.submitted});
  }
  async _identity(signal, guard = () => this._base(signal)) {
    guard(); this.rateBudget.quota('identity');
    let raw;
    try { raw = await this.transport.me({signal, assertCurrent:guard}); }
    catch (error) { if (error?.code === 'rate_limited') this.rateBudget.block('identity', error.retryAt); throw error; }
    guard(); this.rateBudget.rate('identity', raw);
    const response = result(raw);
    if (!plain(response.data) || !id(response.data.id)) throw new XError('invalid_response');
    if (response.data.id !== this.expectedAccountId) throw new XError(this.accountId ? 'account_changed' : 'account_mismatch');
    return response.data.id;
  }
  connect(signal) {
    try { this._base(signal); } catch (error) { return Promise.reject(error); }
    if (this.ready) return Promise.resolve({accountId:this.accountId, ownerId:this.ownerId});
    if (this.connecting) return Promise.reject(new XError('operation_in_progress'));
    const combined = this._signal(signal);
    const pending = (async () => {
      try {
        const account = await this._identity(combined); this._base(combined);
        this.accountId = account; this.ready = true; this.generation++; this.contextToken = randomUUID();
        return {accountId:account, ownerId:this.ownerId};
      } catch (error) { throw this._problem(error); }
    })();
    this.connecting = pending;
    return pending.finally(() => { if (this.connecting === pending) this.connecting = null; });
  }
  async getUpdates(cursor = '', signal) {
    this._base(signal);
    if (!(cursor === '' || typeof cursor === 'string' && /^\d{1,12}$/.test(cursor) && Number(cursor) === this.cursor)) throw new XError('invalid_cursor');
    if (this.polling) throw new XError('concurrent_poll');
    this.polling = true;
    const combined = this._signal(signal);
    try {
      await this.connect(combined);
      const generation = this.generation, context = this.contextToken;
      const guard = () => this._guard(generation, context, combined);
      if (this.nextPollAt > this.now()) await this.sleep(this.nextPollAt - this.now(), combined);
      guard();
      this.nextPollAt = this.now() + POLL_INTERVAL;
      this.rateBudget.quota('read', false);
      await this._identity(combined, guard);
      const pending = new Map(), pageTokens = new Set();
      let next, complete = false, previousTime = Infinity;
      for (let page = 0; page < MAX_PAGES; page++) {
        guard(); this.rateBudget.quota('read');
        let raw;
        try { raw = await this.transport.events({paginationToken:next, signal:combined, assertCurrent:guard}); }
        catch (error) { if (error?.code === 'rate_limited') this.rateBudget.block('read', error.retryAt); throw error; }
        guard(); this.rateBudget.rate('read', raw);
        const response = result(raw), rows = response.data ?? [];
        if (!Array.isArray(rows) || rows.length > 100 || !plain(response.meta) || response.meta.result_count !== rows.length) throw new XError('invalid_response');
        let boundary = false;
        for (const row of rows) {
          if (!plain(row) || !id(row.id) || typeof row.event_type !== 'string') throw new XError('invalid_response');
          if (row.event_type !== 'MessageCreate') throw new XError('invalid_response');
          if (!id(row.sender_id) || typeof row.dm_conversation_id !== 'string') throw new XError('invalid_response');
          const at = created(row.created_at);
          if (at > this.now() + 60000 || at > previousTime) throw new XError('invalid_response');
          previousTime = at;
          if (at < this.acceptAfter || this.seen.has(row.id)) boundary = true;
          if (row.dm_conversation_id !== conversation(this.accountId, this.ownerId)) throw new XError('invalid_response');
          if (row.participant_ids !== undefined && (!Array.isArray(row.participant_ids) || row.participant_ids.length !== 2 ||
              new Set(row.participant_ids).size !== 2 || !row.participant_ids.includes(this.accountId) || !row.participant_ids.includes(this.ownerId))) throw new XError('invalid_response');
          if (row.sender_id !== this.ownerId && row.sender_id !== this.accountId) throw new XError('invalid_response');
          if (row.sender_id !== this.ownerId || at < this.acceptAfter || this.seen.has(row.id)) continue;
          // New event shapes are not automatically plain typed authority.
          // Preserve only known fields; an unfamiliar reply/media wrapper must
          // not turn an embedded /allow into a direct control message.
          const unsupported = has(row.attachments) || typeof row.text !== 'string' || Object.keys(row).some(key => !EVENT_FIELDS.has(key));
          if (typeof row.text === 'string' && !text(row.text)) throw new XError('invalid_response');
          const quoted = ['referenced_posts','referenced_tweets','reply_to','in_reply_to','quote','quoted_message'].some(key => row[key] !== undefined);
          const message = {id:row.id, from:this.ownerId, text:unsupported ? '' : row.text, createdAt:at, contextToken:context,
            ...(unsupported ? {unsupported:'x_nontext'} : {}),
            ...(quoted ? {quote:{id:null,title:'X referenced content (not fetched)',text:''}} : {})};
          const before = pending.get(row.id);
          if (before && JSON.stringify(before) !== JSON.stringify(message)) throw new XError('invalid_response');
          pending.set(row.id, message);
          if (pending.size > MAX_BATCH) throw new XError('backlog_limit');
        }
        next = response.meta.next_token;
        if (next !== undefined) { try { pagination(next); } catch { throw new XError('invalid_response'); } }
        if (next === undefined || boundary) { complete = true; break; }
        if (!rows.length || pageTokens.has(next)) throw new XError('invalid_response');
        pageTokens.add(next);
      }
      if (!complete) throw new XError('backlog_limit');
      await this._identity(combined, guard); guard();
      if (this.seen.size + pending.size > MAX_SEEN) throw new XError('seen_limit');
      const messages = [...pending.values()].sort((a,b) => a.createdAt - b.createdAt || (BigInt(a.id) < BigInt(b.id) ? -1 : 1));
      for (const message of messages) this.seen.add(message.id);
      this.cursor += messages.length;
      return {cursor:String(this.cursor), messages};
    } catch (error) {
      throw this._problem(error);
    } finally { this.polling = false; }
  }
  async sendText(to, body, contextToken, clientId = randomUUID(), signal) {
    if (to !== this.ownerId) throw new XError('owner_required');
    if (!text(body) || typeof clientId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(clientId)) throw new XError('invalid_input');
    if (this.sending) throw new XError('concurrent_send');
    if (this.attempted.has(clientId)) throw new XError('already_attempted');
    if (this.attempted.size >= 1000) throw new XError('send_limit');
    const combined = this._signal(signal), generation = this.generation;
    const guard = () => this._guard(generation, contextToken, combined);
    guard(); this.sending = true;
    let submitted = false;
    try {
      this.rateBudget.quota('write', false);
      await this._identity(combined, guard); guard();
      const raw = await this.transport.sendText({text:body, signal:combined, assertCurrent:() => {
        guard(); this.rateBudget.quota('write'); this.attempted.add(clientId); submitted = true;
      }});
      this.rateBudget.rate('write', raw);
      const response = result(raw);
      if (!plain(response.data) || !id(response.data.dm_event_id) || response.data.dm_conversation_id !== conversation(this.accountId, this.ownerId)) throw new XError('send_unknown');
      // A validated acceptance remains an acceptance even if the panel closed
      // after submission. Return its captured identity; never update a new one.
      return {id:response.data.dm_event_id, clientId, accountId:this.accountId, ownerId:this.ownerId, contextToken};
    } catch (error) {
      if (submitted || error?.submitted) {
        if (error?.retryAt !== undefined) this.rateBudget.block('write', error.retryAt);
        throw new XError('send_unknown', {submitted:true});
      }
      throw this._problem(error);
    } finally { this.sending = false; }
  }
  seenIds() { return [...this.seen]; }
  close() {
    if (this.closed) return;
    this.closed = true; this.ready = false; this.contextToken = null; this.generation++;
    this.lifetime.abort(); this.transport.close();
  }
}
module.exports = {XDirectMessageClient, XRateBudget, prepareXInbound, conversation, POLL_INTERVAL, MAX_BATCH, MAX_PAGES};
