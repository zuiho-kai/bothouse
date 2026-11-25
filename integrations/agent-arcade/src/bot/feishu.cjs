'use strict';

const {randomUUID} = require('node:crypto');
const {prepareInbound} = require('./weixin.cjs');
const {createFeishuSDKTransport} = require('./feishu-sdk.cjs');

const MAX_QUEUE = 200, MAX_SEEN = 10000, MAX_TEXT = 16000;
class FeishuError extends Error {
  constructor(code) { super(`Feishu request failed (${code}).`); this.name = code === 'aborted' ? 'AbortError' : 'FeishuError'; this.code = code; }
}
function validateFeishuAppId(value) {
  if (typeof value !== 'string' || !/^cli_[a-fA-F0-9]{16}$/.test(value)) throw new FeishuError('invalid_app_id');
  return value;
}
function validateFeishuOwner(value) {
  if (typeof value !== 'string' || !/^ou_[A-Za-z0-9_-]{8,128}$/.test(value)) throw new FeishuError('invalid_owner');
  return value;
}
function validId(value, prefix) { return typeof value === 'string' && new RegExp(`^${prefix}_[A-Za-z0-9_-]{8,128}$`).test(value); }
function validKey(value) { return typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value); }
function timestamp(value) { return typeof value === 'string' && /^\d{10,16}$/.test(value) && Number.isSafeInteger(Number(value)) ? Number(value) : null; }
function safeCode(error, fallback = 'connection_failed') {
  return ['aborted','closed','timeout','disconnected','account_changed','invalid_response','permission_denied',
    'connection_failed','send_unknown','send_not_submitted','stale_context'].includes(error?.code) ? error.code : fallback;
}
function checkBot(data) {
  if (!data || data.code !== 0 || !validId(data.bot?.open_id, 'ou')) throw new FeishuError(data?.code ? 'permission_denied' : 'invalid_response');
  return data.bot.open_id;
}
function prepareFeishuInbound(message) {
  if (message.unsupported) return {...message, text: '', rejection: '当前飞书接入只处理指定主人的私聊文字。图片、文件、语音和其他内容未作为任务执行，请单独输入文字需求。'};
  return prepareInbound(message);
}
function feishuConnectionProblem(code, {retrying = false} = {}) {
  const messages = {
    invalid_app_id: '飞书 App ID 格式不正确，请填写企业自建应用的 App ID。',
    invalid_owner: '请填写这一个应用内指定主人的 open_id（ou_ 开头），不能使用昵称或其他应用的 ID。',
    invalid_app_secret: '请保存飞书企业自建应用的 App Secret。',
    permission_denied: '飞书身份核实失败，请检查应用凭据、机器人能力与消息权限。',
    invalid_response: '飞书未返回可核实的机器人身份或状态，请检查应用设置后重新连接。',
    account_changed: '飞书机器人身份已变化，已停止此连接；请核对应用配置后重新连接。',
    queue_overflow: '飞书待处理消息达到上限，已关闭接收；请重新连接并发送新的需求，旧消息不会重放。',
    closed: '飞书连接已关闭。',
    send_unknown: '飞书发送结果未能确认，没有自动重发，请核对飞书会话。'
  };
  return messages[code] || (retrying ? '飞书长连接暂不可用，正在等待恢复；旧任务回复不会自动重发。' : '飞书连接未完成，请检查企业应用凭据、长连接事件订阅和网络。');
}

class FeishuClient {
  constructor({appId, appSecret, ownerId, acceptAfter, seenIds = [], now = Date.now,
    timeoutMs = 15000, pollTimeoutMs = 25000, transportFactory = createFeishuSDKTransport} = {}) {
    this.appId = validateFeishuAppId(appId); this.ownerId = validateFeishuOwner(ownerId);
    if (typeof appSecret !== 'string' || !appSecret.trim() || appSecret.length > 4096 || /[\p{Cc}\p{Cf}]/u.test(appSecret)) throw new FeishuError('invalid_app_secret');
    this.appSecret = appSecret; this.now = now; this.acceptAfter = acceptAfter ?? now();
    if (!Number.isSafeInteger(this.acceptAfter) || this.acceptAfter < 0) throw new FeishuError('invalid_input');
    this.timeoutMs = Math.min(30000, Math.max(1, timeoutMs));
    this.pollTimeoutMs = Math.min(30000, Math.max(1, pollTimeoutMs));
    this.transportFactory = transportFactory; this.accountId = ''; this.tenantKey = '';
    this.seen = new Map((Array.isArray(seenIds) ? seenIds.filter(x => validId(x, 'om')).slice(-MAX_SEEN) : []).map(id => [id, this.acceptAfter]));
    this.queue = []; this.cursor = 0; this.generation = 0; this.ready = false; this.closed = false;
    this.contextToken = null; this.transport = null; this.connecting = null; this.waiter = null; this.fatalError = null;
  }
  connect(signal) {
    if (signal?.aborted) return Promise.reject(new FeishuError('aborted'));
    if (this.closed) return Promise.reject(new FeishuError('closed'));
    if (this.fatalError) return Promise.reject(this.fatalError);
    if (this.ready && this.transport?.state() === 'connected') return Promise.resolve({accountId: this.accountId, appId: this.appId});
    if (this.ready) this._invalidate();
    if (this.connecting) return this.connecting;
    const pending = this._connect(signal);
    this.connecting = pending;
    return pending.finally(() => { if (this.connecting === pending) this.connecting = null; });
  }
  async _connect(signal) {
    let transport = this.transport, fresh = false;
    try {
      if (!transport) {
        fresh = true;
        transport = this.transportFactory({appId: this.appId, appSecret: this.appSecret, timeoutMs: this.timeoutMs,
          onEvent: event => { if (transport === this.transport) this._receive(event); },
          onState: state => { if (transport === this.transport && state !== 'connected') this._invalidate(); }});
        this.transport = transport;
        const identity = checkBot(await transport.botInfo(signal));
        if (this.accountId && identity !== this.accountId) throw new FeishuError('account_changed');
        this.accountId = identity;
        await transport.start(signal);
      }
      if (transport.state() !== 'connected') throw new FeishuError('disconnected');
      // Also recheck identity after each SDK reconnection; a callback alone is
      // not a new authority to use this profile's old sending context.
      const identity = checkBot(await transport.botInfo(signal));
      if (identity !== this.accountId) throw new FeishuError('account_changed');
      if (signal?.aborted) throw new FeishuError('aborted');
      if (this.closed || transport !== this.transport) throw new FeishuError('closed');
      if (transport.state() !== 'connected') throw new FeishuError('disconnected');
      this.generation++; this.contextToken = randomUUID(); this.ready = true;
      return {accountId: this.accountId, appId: this.appId};
    } catch (error) {
      const code = safeCode(error);
      if (code === 'account_changed') this.fatalError = new FeishuError(code);
      if (fresh || this.fatalError || signal?.aborted || this.closed) {
        transport?.close(); if (transport === this.transport) this.transport = null;
      }
      this._invalidate(); throw new FeishuError(code);
    }
  }
  _invalidate() {
    this.ready = false; this.contextToken = null; this.generation++;
    this.queue.length = 0; this.acceptAfter = Math.max(this.acceptAfter, this.now());
    this.waiter?.();
  }
  _receive(event) {
    // SDK 1.76 EventDispatcher flattens schema/header/event for its handler.
    // Message ID, not event ID, is the semantic duplicate key (multiple pushes
    // of the same message can have different event identifiers).
    if (!this.ready || this.closed || this.transport?.state() !== 'connected' ||
        event?.schema !== '2.0' || event.app_id !== this.appId || event.event_type !== 'im.message.receive_v1' ||
        !validKey(event.tenant_key) || event.sender?.sender_type !== 'user' ||
        event.sender?.sender_id?.open_id !== this.ownerId || event.message?.chat_type !== 'p2p' ||
        !validId(event.message.chat_id, 'oc')) return;
    // open_id is application-scoped. The signed application connection supplies
    // the tenant context; bind the first accepted owner event and never migrate
    // this live client across tenants. An external sender's tenant may differ.
    if (this.tenantKey && event.tenant_key !== this.tenantKey) return;
    const message = event.message, id = message.message_id, createdAt = timestamp(message.create_time);
    if (!validId(id, 'om') || this.seen.has(id) || createdAt === null || createdAt < this.acceptAfter || createdAt > this.now() + 60000) return;
    if (typeof message.content !== 'string' || message.content.length > 65536) return;
    let content;
    try { content = JSON.parse(message.content); } catch { return; }
    if (!content || typeof content !== 'object' || Array.isArray(content)) return;
    const text = message.message_type === 'text' && typeof content.text === 'string' ? content.text : '';
    if (text.length > MAX_TEXT || text.includes('\0')) return;
    const quoteId = message.parent_id || message.root_id;
    if (quoteId && !validId(quoteId, 'om')) return;
    if (this.queue.length >= MAX_QUEUE) {
      this.fatalError = new FeishuError('queue_overflow'); this.transport.close(); this._invalidate(); return;
    }
    this.tenantKey = event.tenant_key;
    this.seen.set(id, createdAt);
    if (this.seen.size > MAX_SEEN) {
      const [oldId, oldTime] = this.seen.entries().next().value;
      this.seen.delete(oldId); this.acceptAfter = Math.max(this.acceptAfter, oldTime + 1);
    }
    this.queue.push({id, from: this.ownerId, text, createdAt, contextToken: this.contextToken,
      ...(message.message_type !== 'text' ? {unsupported: 'feishu_nontext'} : {}),
      ...(quoteId ? {quote: {id: quoteId, title: '飞书引用（原文未读取）', text: ''}} : {})});
    this.waiter?.();
  }
  async getUpdates(cursor = '', signal) {
    if (!(cursor === '' || typeof cursor === 'string' && /^\d{1,16}$/.test(cursor) && Number(cursor) === this.cursor)) throw new FeishuError('invalid_cursor');
    await this.connect(signal);
    if (!this.queue.length) {
      if (this.waiter) throw new FeishuError('concurrent_poll');
      await new Promise(resolve => {
        const done = () => { clearTimeout(timer); signal?.removeEventListener('abort', done); if (this.waiter === done) this.waiter = null; resolve(); };
        const timer = setTimeout(done, this.pollTimeoutMs); this.waiter = done;
        signal?.addEventListener('abort', done, {once: true});
        if (signal?.aborted || !this.ready) done();
      });
    }
    if (signal?.aborted) throw new FeishuError('aborted');
    if (this.fatalError) throw this.fatalError;
    if (!this.ready || this.transport?.state() !== 'connected') { this._invalidate(); throw new FeishuError('disconnected'); }
    const messages = this.queue.splice(0, MAX_QUEUE); this.cursor += messages.length;
    return {cursor: String(this.cursor), messages};
  }
  async sendText(to, text, contextToken, clientId = randomUUID(), signal) {
    if (to !== this.ownerId) throw new FeishuError('owner_required');
    if (typeof text !== 'string' || !text.trim() || text.length > MAX_TEXT || text.includes('\0') ||
        typeof clientId !== 'string' || !/^[A-Za-z0-9_-]{1,50}$/.test(clientId)) throw new FeishuError('invalid_input');
    const transport = this.transport, generation = this.generation;
    const guard = () => {
      if (signal?.aborted) throw new FeishuError('aborted');
      if (this.closed || !this.ready || transport !== this.transport || generation !== this.generation ||
          !contextToken || contextToken !== this.contextToken || transport?.state() !== 'connected') throw new FeishuError('stale_context');
    };
    guard();
    let response;
    try { response = await transport.sendText({ownerId: this.ownerId, text, uuid: clientId, assertCurrent: guard, signal}); }
    catch (error) { throw new FeishuError(safeCode(error, 'send_unknown')); }
    if (!response || response.code !== 0 || !validId(response.data?.message_id, 'om')) throw new FeishuError('send_unknown');
    return {id: response.data.message_id, clientId};
  }
  seenIds() { return [...this.seen.keys()]; }
  close() {
    if (this.closed) return;
    this.closed = true; this._invalidate(); const transport = this.transport; this.transport = null;
    transport?.close(); this.appSecret = ''; this.queue.length = 0;
  }
}

module.exports = {FeishuClient, FeishuError, validateFeishuAppId, validateFeishuOwner,
  prepareFeishuInbound, feishuConnectionProblem};
