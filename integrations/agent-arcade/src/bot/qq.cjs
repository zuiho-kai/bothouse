'use strict';
const {nativeDrawingAddress} = require('./group-drawing-request.cjs');

// Independent OneBot v11 client. A separately installed local bridge owns the
// QQ login; this module never requests credentials or changes the QQ client.
const {createHash,randomUUID} = require('node:crypto');
const {setTimeout:delay} = require('node:timers/promises');
const {prepareInbound} = require('./weixin.cjs');
const {validateImagePayload, QQMediaError} = require('./qq-media.cjs');
const {ownerRecordParams, groupRecordParams, QQVoiceError} = require('./qq-voice-payload.cjs');
const {QQOwnerRemarkError, validateRemark, safeCode: remarkCode} = require('./qq-owner-remark.cjs');
const {captureOwnerVoice} = require('./qq-inbound-voice.cjs');
const {captureGroupVoice} = require('./qq-group-voice.cjs');
const {groupMemberAlias,MAX_NATIVE_MENTION_SLOTS} = require('./group-public-context.cjs');
const {captureOwnerImage} = require('./qq-inbound-image.cjs');
const {captureOwnerQuote} = require('./qq-quoted-image.cjs');
const {GROUP_IMAGE_AGE_MS,captureGroupImage,captureGroupImageQuote,verifyGroupMessage} = require('./qq-group-image.cjs');
const {nativeFaceId, groupFaceLabel} = require('./onebot-segments.cjs');

const MAX_FRAME = 1024 * 1024;
const MAX_QUEUE = 200;
const MAX_PAUSED_GROUP_IDS = 512;
const GROUP_QUOTE_ANCHOR_AGE_MS = 10 * 60 * 1000;
const MAX_GROUP_REFERENCES = 512;
const MAX_ACTIVE_GROUP_DRAWING_SOURCES = 64;
const MAX_GROUP_IMAGE_REFERENCES = 64;
const MAX_GROUP_SENT_IMAGES = 4; // validateImagePayload limits each PNG to 4 MiB.
const GROUP_SENT_IMAGE_AGE_MS = 5 * 60 * 1000;
const GROUP_RECALL_CLOCK_SLOP_MS = 60000;
const MAX_GROUP_IMAGE_READS = 2;
const MAX_GROUP_VOICE_READS = 1;
const MAX_SEEN = 10000;
const MAX_TEXT = 16000;
const MAX_FRIENDS = 10000;
const MAX_SOCIAL_TEXT = 2000;
const DEFAULT_QQ_URL = 'ws://127.0.0.1:3001/';
// Keep just the kind of short answer requested by an explicitly addressed
// question. Punctuation and an interjection by themselves give no target.
const questionForms = [
  /哪(?:一)?天|星期几|周几|几号|几点|什么时候|何时|多久|多长时间|\b(?:when|what (?:day|time|date)|which day|how long)\b/iu,
  /哪里|哪儿|哪个(?:地方|位置)|什么地方|何处|\bwhere\b/iu,
  /多少|几个|几位|几份|\bhow (?:many|much)\b/iu,
  /谁|哪位|\bwho\b/iu,
  /为什么|为何|\bwhy\b/iu,
  /怎么|怎样|如何|\bhow\b/iu,
  /什么|哪个|哪些|\b(?:what|which)\b/iu,
  /(?:吗|么)$|是不是|能不能|可不可以|^(?:is|are|do|does|did|can|could|will|would)\b/iu,
];
function directedQuestionForm(text) {
  const body = text.trim();
  if (/[?？]$/u.test(body)) return questionForms.findIndex(pattern => pattern.test(body.replace(/[?？]+$/u, '').trim()));
  // In chat the final mark is optional. Look for a direct interrogative in
  // the speaker's own words, not a question they quoted or reported.
  const spoken = body.replace(/“[^”]*”|‘[^’]*’|「[^」]*」|『[^』]*』|"[^"]*"/gu, ' ').trim();
  if (/[。.!！]$/u.test(spoken)) return -1;
  if (!/\p{Script=Han}/u.test(spoken) && !/^(?:when|which|what|where|who|why|how|is|are|do|does|did|can|could|will|would)\b/iu.test(spoken)) return -1;
  const form = questionForms.findIndex(pattern => pattern.test(spoken));
  if (form < 0) return -1;
  const before = spoken.slice(0, spoken.search(questionForms[form]));
  if (/(?:知道|记得|记下|说过|提到|转述|问过|[他她]说|有人问|无论|不管)/u.test(before) &&
      !/(?:吗|么)$/u.test(spoken)) return -1;
  return form;
}
// Bridges can assign different local message numbers to the same group event.
function groupEventKey(senderId,createdAt,message){
  if(Array.isArray(message)&&message.length>40)return null;
  const text=value=>typeof value==='string'?value:'';
  const parts=Array.isArray(message)?message.map(part=>{
    const {type,data}=part||{};
    if(type==='text')return ['text',text(data?.text)];
    if(type==='at')return ['at',Number.isSafeInteger(data?.qq)?String(data.qq):text(data?.qq)];
    return [text(type)];
  }):[['text',text(message)]];
  return createHash('sha256').update(JSON.stringify([senderId,createdAt,parts])).digest('hex');
}
const ownMediaReference = speaker => speaker === 'self_voice' || speaker === 'self_image';
const mediaScopeId = value => typeof value === 'string' && !!value.trim() && value.length <= 256 && !/[\p{Cc}\p{Cf}]/u.test(value);

class QQError extends Error {
  constructor(code) {
    super(`QQ bridge request failed (${code}).`);
    this.name = code === 'aborted' ? 'AbortError' : 'QQError';
    this.code = code;
  }
}

function validateQQUrl(value = DEFAULT_QQ_URL) {
  let url;
  try { url = new URL(value); } catch { throw new QQError('invalid_bridge_url'); }
  if (!['ws:', 'wss:'].includes(url.protocol) || !['127.0.0.1', '[::1]'].includes(url.hostname) ||
      !url.port || url.pathname !== '/' || url.username || url.password || url.search || url.hash) {
    throw new QQError('invalid_bridge_url');
  }
  return url.href;
}

function validateQQOwner(value) {
  const id = Number.isSafeInteger(value) ? String(value) : value;
  if (typeof id !== 'string' || !/^[1-9]\d{4,14}$/.test(id) || !Number.isSafeInteger(Number(id))) {
    throw new QQError('invalid_owner');
  }
  return id;
}

function eventId(value) {
  if (Number.isSafeInteger(value)) return String(value);
  if (typeof value === 'string' && /^-?\d{1,20}$/.test(value)) return value;
  return null;
}

function sameQQ(value, expected) {
  return (Number.isSafeInteger(value) || typeof value === 'string') && String(value) === expected;
}

function socialText(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > MAX_SOCIAL_TEXT || value.includes('\0')) {
    throw new QQError('invalid_social_text');
  }
  return value;
}

function photoCaption(caption){
  if(caption===undefined)return [];
  if(typeof caption!=='string'||!caption||caption.length>600||/[\p{Cc}\p{Cf}\[\]<>]/u.test(caption.replace(/\n/gu,'')))throw new QQMediaError('invalid_request');
  return [{type:'text',data:{text:'\n'+caption}}];
}

function socialId(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 512 || /[\p{Cc}\p{Cf}]/u.test(value)) {
    throw new QQError('invalid_social_id');
  }
  return value;
}

function remarkGuard(client, signal, assertCurrent) {
  const accountId=client.accountId,ownerId=client.ownerId,generation=client.generation,socket=client.socket;
  return () => {
    if(signal?.aborted)throw new QQOwnerRemarkError('cancelled');
    if(client.ownerId!==ownerId||client.accountId!==accountId)throw new QQOwnerRemarkError('account_changed');
    if(client.generation!==generation||client.socket!==socket)throw new QQOwnerRemarkError('changed');
    if(!client.ready||client.closed||socket?.readyState!==1)throw new QQOwnerRemarkError('disconnected');
    assertCurrent();
  };
}

const FRIEND_REQUEST_CODES = new Set(['invalid_request', 'disconnected', 'changed', 'closed', 'expired',
  'stale_request', 'operation_in_progress', 'cancelled', 'invalid_response', 'account_changed', 'account_offline', 'status_unverified']);
function friendRequestCode(error) {
  if (error?.code === 'aborted') return 'cancelled';
  if (error?.code === 'account_mismatch') return 'account_changed';
  if (error?.code === 'bridge_unhealthy') return 'status_unverified';
  return FRIEND_REQUEST_CODES.has(error?.code) ? error.code : 'invalid_response';
}

function friendRequestGuard(client, signal, assertCurrent) {
  const accountId = client.accountId, ownerId = client.ownerId, generation = client.generation, socket = client.socket;
  const check = () => {
    if (signal?.aborted) throw new QQError('cancelled');
    if (client.closed) throw new QQError('closed');
    if (client.accountId !== accountId || client.ownerId !== ownerId) throw new QQError('account_changed');
    if (client.generation !== generation || client.socket !== socket) throw new QQError('changed');
    if (!client.ready || !accountId || socket?.readyState !== 1) throw new QQError('disconnected');
  };
  return () => {
    check();
    const result = assertCurrent();
    // The last guard must finish before the fixed write is invoked. An async
    // callback cannot authorize a write while its eventual decision is pending.
    if (result && typeof result.then === 'function') {
      Promise.resolve(result).catch(() => {});
      throw new QQError('invalid_request');
    }
    check();
  };
}

// Do not silently strip an image/file/CQ code and execute its remaining text.
// Replies stay text metadata by default. Only no-tools companionship may
// attach a private exact-reference descriptor; no lookup occurs in this parser.
function normalizeMessage(message, {groupFaces = false} = {}) {
  if (typeof message === 'string') {
    if (message.includes('[CQ:')) return {text: '', unsupported: 'qq_segments'};
    return {text: message};
  }
  if (!Array.isArray(message) || !message.length || message.length > 40) return {text: '', unsupported: 'qq_segments'};
  let text = '', quote = null, hasNativeFace = false;
  for (const segment of message) {
    if (segment?.type === 'text' && typeof segment.data?.text === 'string') {
      text += segment.data.text;
      if (text.length > MAX_TEXT) return {text: '', unsupported: 'qq_oversize'};
    } else if (segment?.type === 'reply' && !quote && eventId(segment.data?.id)) {
      quote = {id: eventId(segment.data.id), title: 'QQ 引用（原文未读取）', text: ''};
    } else if (groupFaces && segment?.type === 'face' && nativeFaceId(segment.data?.id) !== null) {
      hasNativeFace = true;
    } else return {text: '', unsupported: 'qq_segments'};
  }
  return {text, ...(quote ? {quote} : {}), ...(hasNativeFace ? {hasNativeFace} : {})};
}

function prepareQQInbound(message) {
  if (message.unsupported === 'qq_image') return {...message, text: '', rejection: '这张图片没有读到，请重新发送单张 JPG 或 PNG；可以附上一句想问的话。'};
  if (message.unsupported === 'qq_segments') return {...message, text: '', rejection: '当前 QQ 接入只处理文字和文字引用。图片、文件、语音及其他消息段未执行，请单独输入需求。'};
  if (message.unsupported === 'qq_oversize') return {...message, text: '', rejection: '这条 QQ 消息过长，没有作为任务执行，请缩短后重发。'};
  return prepareInbound(message);
}

function defaultSocketFactory(url, options) {
  const WebSocket = require('ws');
  return new WebSocket(url, options);
}

function groupMediaIds(values, groupIds) {
  if (!Array.isArray(values) || values.length > groupIds.size) throw new QQError('invalid_group');
  const ids = new Set(values.map(validateQQOwner));
  if (ids.size !== values.length || [...ids].some(id => !groupIds.has(id))) throw new QQError('invalid_group');
  return ids;
}

function activeGroupIds(values) {
  if (!Array.isArray(values) || values.length > 5) throw new QQError('invalid_group');
  const ids = new Set(Array.from(values, validateQQOwner));
  if (ids.size !== values.length) throw new QQError('invalid_group');
  return ids;
}

class QQClient {
  #groupSentImages = new Map();
  #activeGroupDrawingSources = new Map();
  #groupRecallAuthors = new Map();
  #groupAdmissions = new Map();
  #pausedGroupAdmissions = new Map();

  constructor({url = DEFAULT_QQ_URL, token, ownerId, expectedAccountId, acceptAfter, now = Date.now,
    socketFactory = defaultSocketFactory, timeoutMs = 10000, pollTimeoutMs = 20000,
    heartbeatTimeoutMs = 90000, onFriendRequest = () => {}, onGroupRecall = () => {},
    onReady = () => {},
    allowOwnerVoice = false, allowOwnerImage = false, receiveOwnerMessages = true, groupIds = [], groupImageIds = [], groupVoiceIds = []} = {}) {
    this.url = validateQQUrl(url);
    this.ownerId = validateQQOwner(ownerId);
    this.groupIds = activeGroupIds(groupIds);
    for (const id of this.groupIds) this.#groupAdmissions.set(id, {since:0, controller:new AbortController()});
    this.groupContexts = new Map();
    this.groupInputSequence = 0;
    this.groupSpeakers = new Map();
    this.recentGroupReplies = new Map();
    this.groupReferences = new Map();
    this.groupImageIds = groupMediaIds(groupImageIds,this.groupIds);
    this.groupVoiceIds = groupMediaIds(groupVoiceIds,this.groupIds);
    this.groupImageReferences = new Map();
    this.groupImageReads = new Set();
    this.groupVoiceReads = new Set();
    this.groupMediaRevisions = new Map();
    this.expectedAccountId = expectedAccountId === undefined ? '' : validateQQOwner(expectedAccountId);
    if (this.expectedAccountId === this.ownerId) throw new QQError('owner_is_agent_account');
    if (typeof token !== 'string' || !/^[\x21-\x7e]{16,256}$/.test(token)) throw new QQError('invalid_token');
    this.token = token;
    this.now = now;
    if ([onFriendRequest,onGroupRecall,onReady].some(listener=>typeof listener!=='function')) throw new QQError('invalid_input');
    if (typeof allowOwnerImage !== 'boolean') throw new QQError('invalid_input');
    this.allowOwnerImage = allowOwnerImage;
    if (typeof allowOwnerVoice !== 'boolean') throw new QQError('invalid_input');
    if (typeof receiveOwnerMessages !== 'boolean') throw new QQError('invalid_input');
    this.receiveOwnerMessages = receiveOwnerMessages;
    this.onFriendRequest = onFriendRequest;
    this.onGroupRecall = onGroupRecall;
    this.onReady = onReady;
    this.allowOwnerVoice = allowOwnerVoice;
    this.connectedAt = null;
    this.acceptAfter = acceptAfter ?? now();
    if (!Number.isSafeInteger(this.acceptAfter) || this.acceptAfter < 0) throw new QQError('invalid_input');
    this.socketFactory = socketFactory;
    this.timeoutMs = Math.max(1, Math.min(15000, timeoutMs));
    this.pollTimeoutMs = Math.max(1, Math.min(30000, pollTimeoutMs));
    this.heartbeatTimeoutMs = Math.max(100, Math.min(120000, heartbeatTimeoutMs));
    this.socket = null;
    this.generation = 0;
    this.accountId = '';
    this.nickname = '';
    this.ready = false;
    this.closed = false;
    this.pending = new Map();
    this.queue = [];
    this.seen = new Set();
    this.waiter = null;
    this.cursor = 0;
    this.lastError = null;
    this.connectionPromise = null;
    this.everConnected = false;
    this.contextToken = '';
  }

  connect(signal) {
    if (signal?.aborted) return Promise.reject(new QQError('aborted'));
    if (this.closed) return Promise.reject(new QQError('closed'));
    // Keep explicit expiry across a gap between polls. A user-requested new
    // connection creates a fresh client after the owner logs in through NapCat.
    if (this.lastError?.code === 'login_required') return Promise.reject(this.lastError);
    if (this.connectionPromise) return this.connectionPromise;
    if (this.ready && this.socket?.readyState === 1) return Promise.resolve({accountId: this.accountId, nickname: this.nickname});
    const operation = this._connect(signal);
    this.connectionPromise = operation;
    operation.then(() => { if (this.connectionPromise === operation) this.connectionPromise = null; },
      () => { if (this.connectionPromise === operation) this.connectionPromise = null; });
    return operation;
  }

  async _connect(signal) {
    const generation = ++this.generation;
    let socket;
    try {
      socket = this.socketFactory(this.url, {headers: {Authorization: `Bearer ${this.token}`},
        followRedirects: false, handshakeTimeout: this.timeoutMs, maxPayload: MAX_FRAME, perMessageDeflate: false});
    } catch { throw new QQError('connect_failed'); }
    this.socket = socket;
    this.lastError = null;
    if (this.everConnected) this.acceptAfter = Math.max(this.acceptAfter, this.now());
    this.everConnected = true;
    const current = () => this.socket === socket && this.generation === generation && !this.closed;
    const onAbort = () => { if (current()) this._drop(new QQError('aborted')); };
    this.removeSignal = () => signal?.removeEventListener('abort', onAbort);
    signal?.addEventListener('abort', onAbort, {once: true});
    try {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => fail(new QQError('connect_timeout')), this.timeoutMs);
        const cleanup = () => { clearTimeout(timer); socket.off('open', opened); socket.off('close', closed); socket.off('error', failed); socket.off('unexpected-response', unexpected); };
        const fail = error => { cleanup(); reject(error); };
        const opened = () => { cleanup(); current() ? resolve() : reject(new QQError('aborted')); };
        const closed = () => fail(new QQError('disconnected'));
        const failed = () => fail(new QQError('connect_failed'));
        const unexpected = (_request, response) => {
          response.resume?.();
          fail(new QQError([401, 403].includes(response.statusCode) ? 'unauthorized' : 'connect_failed'));
        };
        socket.once('open', opened); socket.once('close', closed); socket.once('error', failed);
        socket.once('unexpected-response', unexpected);
        socket.on('error', () => { if (current()) this._drop(new QQError('bridge_error')); });
        socket.on('close', () => { if (current()) this._drop(new QQError('disconnected')); });
        socket.on('message', (data, binary) => { if (current()) this._frame(data, binary); });
        socket.on('pong', () => { if (current()) this.lastActivity = this.now(); });
      });
      if (!current() || signal?.aborted) throw new QQError('aborted');
      const data = await this._request('get_login_info', {}, signal);
      let account;
      try { account = validateQQOwner(data?.user_id); } catch { throw new QQError('invalid_login_info'); }
      if (this.expectedAccountId && account !== this.expectedAccountId) throw new QQError('account_mismatch');
      if (account === this.ownerId) throw new QQError('owner_is_agent_account');
      if (this.accountId && account !== this.accountId) throw new QQError('account_changed');
      if (!current() || signal?.aborted) throw new QQError('aborted');
      this.accountId = account;
      this.nickname = typeof data.nickname === 'string' ? data.nickname.replace(/[\p{Cc}\p{Cf}\u2028\u2029]/gu, '')
        .trim().slice(0, 128).replace(/[\uD800-\uDBFF]$/u, '') : '';
      // A live socket and cached account identity do not prove a live QQ login.
      // Repeat this read-only check on every new socket, including reconnects.
      await this._requireOnline(signal);
      if (!current() || signal?.aborted) throw new QQError('aborted');
      const connectedAt = this.now();
      if (!Number.isSafeInteger(connectedAt) || connectedAt < 0) throw new QQError('invalid_input');
      this.contextToken = '';
      // Request-event freshness is relative to this verified socket, never the
      // ordinary-message replay cutoff retained in acceptAfter.
      this.connectedAt = connectedAt;
      this.ready = true;
      this.lastActivity = connectedAt;
      this.heartbeat = setInterval(() => {
        if (!current()) return;
        if (this.now() - this.lastActivity > this.heartbeatTimeoutMs) return this._drop(new QQError('heartbeat_timeout'));
        try { socket.ping(); } catch { this._drop(new QQError('disconnected')); }
      }, Math.max(100, Math.min(15000, Math.floor(this.heartbeatTimeoutMs / 3))));
      this.heartbeat.unref?.();
      if (this.groupIds.size) {
        // OneBot posts whole seconds. Keep the exact replay cutoff and wait
        // before reporting readiness in the final, ambiguous partial second.
        const firstGroupSecond = Math.ceil(this.acceptAfter / 1000) * 1000;
        const wait = firstGroupSecond - connectedAt;
        if (wait > 0) {
          if (wait > 1000) throw new QQError('connect_timeout');
          await delay(wait + 1, undefined, {signal}).catch(() => { throw new QQError('aborted'); });
          if (!current() || signal?.aborted) throw this.lastError || new QQError('aborted');
          if (this.now() < firstGroupSecond) throw new QQError('connect_timeout');
        }
      }
      // Publish only after identity, online status and the group cutoff have
      // all been checked for this socket. A quiet inbox needs no extra poll.
      try { this.onReady({accountId:account,generation},this); } catch { /* Observer failure does not close the socket. */ }
      return {accountId: this.accountId, nickname: this.nickname};
    } catch (error) {
      if (current()) this._drop(error instanceof QQError ? error : new QQError('connect_failed'));
      throw error instanceof QQError ? error : new QQError('connect_failed');
    }
  }

  async _requireOnline(signal) {
    const status = await this._request('get_status', {}, signal);
    if (!status || typeof status !== 'object' || Array.isArray(status) || typeof status.online !== 'boolean') {
      throw new QQError('status_unverified');
    }
    if (!status.online) throw new QQError('account_offline');
    if (status.good === false) throw new QQError('bridge_unhealthy');
  }

  async inspect(signal) {
    const alreadyReady = this.ready && this.socket?.readyState === 1;
    const {accountId, nickname} = await this.connect(signal);
    const generation = this.generation;
    const assertConnected = () => {
      if (signal?.aborted) throw new QQError('aborted');
      if (!this.ready || this.generation !== generation || this.accountId !== accountId) {
        throw this.lastError || new QQError('disconnected');
      }
    };
    const optional = async action => {
      try {
        const data = await this._request(action, {}, signal);
        assertConnected();
        return data;
      } catch (error) {
        assertConnected();
        if (error.code === 'aborted') throw error;
        return null;
      }
    };
    // The new connection has already checked online status. Inspecting an
    // existing socket must check it again; only friendship remains optional.
    if (alreadyReady) {
      try { await this._requireOnline(signal); assertConnected(); }
      catch (error) { if (this.generation === generation) this._drop(error); throw error; }
    }
    const friends = await optional('get_friend_list');
    assertConnected();
    let ownerIsFriend = null;
    if (Array.isArray(friends) && friends.length <= MAX_FRIENDS) {
      try {
        const ids = friends.map(friend => validateQQOwner(friend?.user_id));
        ownerIsFriend = ids.includes(this.ownerId);
      } catch { /* An incomplete or malformed list cannot prove friendship. */ }
    }
    return {accountId, nickname, online: true, ownerIsFriend};
  }

  _drop(error) {
    const socket = this.socket;
    this.socket = null;
    this.generation++;
    this.ready = false;
    this.connectedAt = null;
    this.lastError = error;
    this.contextToken = '';
    this.queue = [];
    for (const token of this.groupContexts.keys()) this.finishGroupInput(token);
    this.groupContexts.clear();
    this.#activeGroupDrawingSources.clear();
    this.groupSpeakers.clear();
    this.recentGroupReplies.clear();
    this.groupReferences.clear();
    this.groupImageReferences.clear();
    this.groupMediaRevisions.clear();
    for (const key of this.#groupSentImages.keys()) this.#discardGroupSentImage(key);
    for (const read of [...this.groupImageReads,...this.groupVoiceReads]) read.controller.abort();
    clearInterval(this.heartbeat);
    this.removeSignal?.();
    this.removeSignal = null;
    for (const pending of [...this.pending.values()]) pending.reject(error);
    this.waiter?.();
    try { socket?.terminate(); } catch { /* already closed */ }
  }

  _frame(raw, binary) {
    if (binary || !(typeof raw === 'string' || Buffer.isBuffer(raw)) || Buffer.byteLength(raw) > MAX_FRAME) {
      this._drop(new QQError('invalid_frame')); return;
    }
    let frame;
    try { frame = JSON.parse(String(raw)); } catch { this._drop(new QQError('invalid_frame')); return; }
    if (!frame || typeof frame !== 'object' || Array.isArray(frame)) { this._drop(new QQError('invalid_frame')); return; }
    this.lastActivity = this.now();
    if (typeof frame.echo === 'string') {
      // Action responses cannot also be events. Never let a forged echo bypass
      // the account binding check below or resolve an unrelated send receipt.
      if (frame.post_type !== undefined) { this._drop(new QQError('invalid_frame')); return; }
      const pending = this.pending.get(frame.echo);
      if (!pending) return;
      if (frame.status !== 'ok' || frame.retcode !== 0) {
        const error = new QQError('action_failed');
        // The pinned LLBot WebSocket server returns these before dispatch.
        // Its general 1200 error can arise after the native message was sent.
        if (frame.status === 'failed' && frame.data === null && [1400, 1404].includes(frame.retcode)) {
          error.rejectedBeforeAction = true;
        }
        pending.reject(error);
      } else pending.resolve(frame.data);
      return;
    }
    // Some bridges can switch the signed-in QQ account without closing the WS.
    // Retaining the old reply context would then send from the wrong identity.
    if (this.accountId && frame.self_id !== undefined && !sameQQ(frame.self_id, this.accountId)) {
      this._drop(new QQError('account_changed')); return;
    }
    if (frame.post_type === 'notice' && frame.notice_type === 'bot_offline' &&
        this.accountId && sameQQ(frame.self_id, this.accountId)) {
      // NapCat 4.18.42 forwards QQ's title/description here. Recognize only the
      // observed exact system signature, never infer auth failure from arbitrary
      // text or relay that text to the UI. Other offline notices stay uncertain.
      const expired = frame.tag === '下线通知' &&
        ['你的账号当前登录已失效，请重新登录', '你的账号当前登录已失效，请重新登录。'].includes(frame.message);
      this._drop(new QQError(expired ? 'login_required' : 'account_offline')); return;
    }
    if (frame.post_type === 'notice' && frame.notice_type === 'group_recall') {
      this.#groupRecall(frame);
      return;
    }
    if (frame.post_type === 'notice' && ['group_decrease', 'group_increase'].includes(frame.notice_type) &&
        sameQQ(frame.self_id, this.accountId) && sameQQ(frame.user_id, this.accountId)) {
      const groupId = Number.isSafeInteger(frame.group_id) ? String(frame.group_id) : frame.group_id;
      if (this.groupVoiceRevision(groupId)) {
        this.groupMediaRevisions.set(groupId, randomUUID());
        this.clearGroupSentImages(groupId);
        for (const [key, speaker] of this.groupReferences) {
          if (ownMediaReference(speaker) && key.startsWith(groupId + ':')) this.groupReferences.delete(key);
        }
      }
      return;
    }
    if (frame.post_type === 'meta_event') {
      if (frame.meta_event_type === 'heartbeat') {
        if (frame.status?.online === false) this._drop(new QQError('account_offline'));
        else if (frame.status?.good === false) this._drop(new QQError('bridge_unhealthy'));
      }
      return;
    }
    if (frame.post_type === 'request') {
      if (this.ready && frame.request_type === 'friend' && frame.group_id === undefined && frame.echo === undefined &&
          sameQQ(frame.self_id, this.accountId)) {
        // Main owns freshness, one-use flags and the bounded inbox. Requests
        // never enter the owner-message queue, history or model input.
        const event = {post_type: 'request', request_type: 'friend', self_id: frame.self_id,
          user_id: frame.user_id, time: frame.time, comment: frame.comment, flag: frame.flag};
        try {
          const result = this.onFriendRequest(event, {client: this, generation: this.generation});
          if (result && typeof result.then === 'function') Promise.resolve(result).catch(() => {});
        } catch { /* An optional management consumer cannot break QQ messaging. */ }
      }
      return;
    }
    // A main-only management connection still processes identity/notices/requests,
    // but cannot create message contexts, deduplication entries or a queue.
    if (!this.receiveOwnerMessages) return;
    if (this.ready && frame.post_type === 'message' && frame.message_type === 'group') {
      this._groupMessage(frame);
      return;
    }
    if (!this.ready || frame.post_type !== 'message' || frame.message_type !== 'private' || frame.sub_type !== 'friend' ||
        !sameQQ(frame.self_id, this.accountId) || !sameQQ(frame.user_id, this.ownerId) || frame.group_id !== undefined) return;
    const id = eventId(frame.message_id), createdAt = frame.time * 1000;
    if (!id || !Number.isSafeInteger(frame.time) || !Number.isSafeInteger(createdAt) || createdAt < this.acceptAfter ||
        createdAt > this.now() + 60000 || this.seen.has(id)) return;
    if (this.seen.size >= MAX_SEEN || this.queue.length >= MAX_QUEUE) { this._drop(new QQError('message_limit')); return; }
    this.seen.add(id);
    let normalized = normalizeMessage(frame.message);
    if (this.allowOwnerVoice && Array.isArray(frame.message) && frame.message.length === 1 && frame.message[0]?.type === 'record') {
      try {
        // Main enables this only for an opted-in companion. The descriptor has
        // a validated cache key, never an upstream URL, path or audio payload.
        const voice = captureOwnerVoice(frame, {accountId: this.accountId, ownerId: this.ownerId,
          companion: true, acceptAfter: this.acceptAfter, now: this.now()});
        normalized = {text: '', voice};
      } catch { /* Preserve the ordinary unsupported-segment rejection. */ }
    }
    if (this.allowOwnerImage && Array.isArray(frame.message) && frame.message.some(part => part?.type === 'image')) {
      try {
        const image = captureOwnerImage(frame, {accountId: this.accountId, ownerId: this.ownerId,
          companion: true, acceptAfter: this.acceptAfter, now: this.now()});
        normalized = {text: image.caption, image};
      } catch { normalized = {text: '', unsupported: 'qq_image'}; }
    }
    if (this.allowOwnerImage && normalized.quote && !normalized.unsupported && !prepareQQInbound(normalized).rejection) {
      try {
        const image = captureOwnerQuote(frame, {accountId: this.accountId, ownerId: this.ownerId,
          companion: true, acceptAfter: this.acceptAfter, now: this.now()});
        normalized = {text: image.caption, quote: normalized.quote, image};
      } catch { /* Preserve the original bounded text-quote path. */ }
    }
    if (normalized.text.length > MAX_TEXT) { normalized.text = ''; normalized.unsupported = 'qq_oversize'; }
    this.contextToken ||= randomUUID();
    this.queue.push({id, from: this.ownerId, contextToken: this.contextToken, createdAt, ...normalized});
    this.waiter?.();
  }

  _groupMessage(frame) {
    // This opt-in route is distinct from the private-owner route. Never cast a
    // group sender to the owner, accept an anonymous event, or infer identity
    // from a nickname. Reply capabilities bind one event's complete tuple.
    let groupId, senderId;
    try { groupId = validateQQOwner(frame.group_id); senderId = validateQQOwner(frame.user_id); }
    catch { return; }
    if (frame.sub_type !== 'normal' || frame.anonymous ||
        !sameQQ(frame.self_id, this.accountId) || senderId === this.accountId ||
        frame.sender?.user_id !== undefined && !sameQQ(frame.sender.user_id, senderId)) return;
    const rawId = eventId(frame.message_id), createdAt = frame.time * 1000;
    const id = rawId && `group:${groupId}:${rawId}`;
    const now = this.now();
    if (!id || !Number.isSafeInteger(frame.time) || !Number.isSafeInteger(createdAt) || createdAt > now + 60000) return;
    const admission = this.#groupAdmissions.get(groupId);
    if (!admission) {
      const paused = this.#pausedGroupAdmissions.get(groupId);
      if (paused && createdAt >= now && createdAt > paused.overflowThrough) {
        // The second-resolution bridge clock may run ahead. Retain only native
        // IDs until reactivation, without inspecting the content of paused groups.
        if (paused.ids.size >= MAX_PAUSED_GROUP_IDS) {
          for (const [id, at] of paused.ids) if (at < now) paused.ids.delete(id);
        }
        if (paused.ids.has(rawId) || paused.ids.size < MAX_PAUSED_GROUP_IDS) paused.ids.set(rawId,createdAt);
        else paused.overflowThrough = createdAt;
      }
      return;
    }
    const acceptAfter = Math.max(this.acceptAfter, admission.since);
    if (createdAt < acceptAfter || admission.ignored?.ids.has(rawId) ||
        this.seen.has(id) || this.#groupMessageRecalled(groupId, rawId)) return;
    if (this.seen.size >= MAX_SEEN || this.queue.length >= MAX_QUEUE) { this._drop(new QQError('message_limit')); return; }
    this.seen.add(id);
    const mentions = new Set(), mentionMembers = [], commandTargets = new Set();
    // Object identity distinguishes the original speaker's turn even if the
    // same member speaks again after somebody interjects during generation.
    if (this.groupSpeakers.get(groupId)?.senderId !== senderId) {
      this.groupSpeakers.set(groupId, {senderId});
    }
    let blockedCommandAddress = false;
    const parts = Array.isArray(frame.message) && frame.message.length <= 40 ? frame.message.map(part => {
      if (part?.type !== 'at') return part;
      const target = part.data?.qq;
      let member = null;
      if (target === 'all') {
        mentions.add('everyone');
        blockedCommandAddress = true;
      } else {
        try {
          const memberId = validateQQOwner(target);
          commandTargets.add(memberId);
          mentions.add(memberId === this.accountId ? 'self' : 'other');
          if (memberId !== this.accountId && mentionMembers.length < MAX_NATIVE_MENTION_SLOTS) {
            member = groupMemberAlias('qq-onebot', this.accountId, groupId, memberId);
          }
        } catch {
          mentions.add('unknown');
          blockedCommandAddress = true;
        }
      }
      if (mentionMembers.length < MAX_NATIVE_MENTION_SLOTS) mentionMembers.push(member);
      return {type:'text',data:{text:''}};
    }) : frame.message;
    let normalized = normalizeMessage(parts, {groupFaces:true});
    if (normalized.hasNativeFace && !normalized.text.trim()) {
      // A face and optional addressing carry no chat body or media request.
      this.recordGroupReference(groupId, rawId, 'other');
      return;
    }
    const capture = {accountId:this.accountId,groupId,senderId,acceptAfter,now:this.now()};
    const contains = type => Array.isArray(frame.message) && frame.message.some(part => part?.type === type);
    const hasImage = contains('image'), hasVoice = contains('record');
    const marketSticker = contains('mface') || Array.isArray(frame.message) && frame.message.some(part =>
      part?.type === 'image' && Object.hasOwn(part.data || {}, 'emoji_id') && Object.hasOwn(part.data || {}, 'emoji_package_id'));
    const replyWithImage = hasImage && contains('reply');
    if (marketSticker) {
      normalized = {text:'', unsupported:'qq_group_image', imageIssue:'market_sticker'};
    } else if (replyWithImage && hasVoice) {
      normalized = {text:'', unsupported:'qq_group_image_reply', imageIssue:'unsupported_shape'};
    } else if (this.groupVoiceIds.has(groupId) && hasVoice) {
      try {
        const voice = captureGroupVoice(frame, capture);
        normalized = {text:voice.caption, voice};
      } catch { normalized = {text:'', unsupported:'qq_group_voice'}; }
    } else if (this.groupImageIds.has(groupId)) {
      if (hasImage) {
        try {
          const image = captureGroupImage(frame, capture);
          normalized = {text:image.caption, image,...(image.replyId?{
            quote:{id:image.replyId,title:'QQ 引用（原文未读取）',text:''},
          }:{})};
        } catch (error) {
          const imageIssue=error?.code==='source_too_large'?'too_large':
            ['image_source_unsupported','invalid_response'].includes(error?.code)?'source_metadata':'unsupported_shape';
          normalized = {text:'', unsupported:replyWithImage?'qq_group_image_reply':'qq_group_image', imageIssue};
        }
      } else if (normalized.quote && !normalized.unsupported) {
        const key = this.groupReferenceKey(groupId, normalized.quote.id);
        const referenceType = this.groupReferences.get(key);
        const source = referenceType === 'self_image' ? this.#currentGroupSentImage(key)?.source :
          referenceType === 'other' ? this.groupImageReferences.get(key) : undefined;
        if (source?.imageIssue) {
          if (this.now()-source.createdAt<=GROUP_IMAGE_AGE_MS) {
            normalized = {...normalized,imageIssue:source.imageIssue,imageIssueQuoted:true};
          }
        } else if (source) {
          try {
            const image = captureGroupImageQuote(frame, source, capture);
            normalized = {...normalized,text:image.caption,image};
          } catch { normalized = {...normalized,imageIssue:'source_unverified',imageIssueQuoted:true}; }
        }
      }
    }
    // An unparsed attachment can still identify the disabled group permission.
    // Keep its data and caption out of the rejected event.
    if (normalized.unsupported === 'qq_segments' && hasVoice !== hasImage) {
      if (hasVoice && !this.groupVoiceIds.has(groupId)) normalized.unsupported = 'group_voice_disabled';
      if (hasImage && !this.groupImageIds.has(groupId)) normalized.unsupported = 'group_image_disabled';
    }
    if (normalized.text.length > MAX_TEXT) { normalized.text = ''; normalized.unsupported = 'qq_oversize'; }
    const quotedId = normalized.quote?.id;
    const unsafeQuote = quotedId && (quotedId === rawId || this.#groupMessageRecalled(groupId, quotedId));
    const observed = unsafeQuote ? 'unknown' : quotedId && this.groupReferences.get(this.groupReferenceKey(groupId, quotedId));
    const observedAuthor = ownMediaReference(observed) ? 'self' : observed;
    const reference = quotedId ? observedAuthor || 'unknown' : 'none';
    // A reply segment provides an ID, never a trusted author. Resolve only a
    // current-generation observation in this group, including acknowledged sends.
    this.recordGroupReference(groupId, rawId, 'other');
    const {image,voice} = normalized;
    if (this.groupImageIds.has(groupId) && (image?.kind === 'qq-group-image' || normalized.imageIssue && !normalized.imageIssueQuoted) &&
        this.groupReferences.get(this.groupReferenceKey(groupId, rawId)) === 'other') {
      this.groupImageReferences.set(this.groupReferenceKey(groupId, rawId), image || {groupId,createdAt,imageIssue:normalized.imageIssue});
      while (this.groupImageReferences.size > MAX_GROUP_IMAGE_REFERENCES) this.groupImageReferences.delete(this.groupImageReferences.keys().next().value);
    }
    const addressing = {mentions:[...mentions], reference,
      ...(mentionMembers.some(Boolean) ? {mentionMembers} : {}),
      ...(observed === 'self_voice' && !image?.replyId ? {voiceReference:true} : {}),
      ...(observed === 'self_image' && !image?.replyId ? {imageReference:true} : {}),
      ...(observed === 'unknown' ? {quoteConflict:true} : {})};
    const mentioned = mentions.has('self');
    const contextToken = randomUUID();
    const plainText = !!normalized.text?.trim() && !normalized.quote && !normalized.unsupported &&
      !normalized.hasNativeFace && !normalized.attachments && !image && !voice;
    const context = {groupId, senderId, rawId, createdAt, generation:this.generation,
      sequence:++this.groupInputSequence, receivedAt:this.now(),
      questionForm:plainText && mentioned && mentions.size === 1 ? directedQuestionForm(normalized.text) : -1,
      speakerTurn:this.groupSpeakers.get(groupId),
      ...(voice||normalized.text?.trim()&&!normalized.quote&&!normalized.unsupported&&!normalized.attachments&&!image ? {pendingInput:true} : {}),
      ...(image ? {image} : {}), ...(voice ? {voice} : {})};
    this.groupContexts.set(contextToken, context);
    while (this.groupContexts.size > MAX_QUEUE) {
      const oldest=this.groupContexts.keys().next().value;
      this.finishGroupInput(oldest);
      this.groupContexts.delete(oldest);
    }
    // Exact native targets stay at the local command boundary. Model prompts
    // and retained public rows continue to use categorised, scoped aliases.
    const commandAddress = {targets:[...commandTargets], blocked:blockedCommandAddress};
    const drawingAddress = plainText && nativeDrawingAddress(frame.message, this.accountId);
    // Only the local route knows whether this sender is another managed companion.
    const confirmHumanQuoteAnchor = () => {
      if (!plainText || !this.#liveGroupQuote(contextToken, context)) return false;
      context.humanQuoteAnchor = true;
      return true;
    };
    this.queue.push({id, from:senderId, groupId, accountId:this.accountId, route:'group', mentioned, addressing, commandAddress, confirmHumanQuoteAnchor,
      contextToken, createdAt, postedAt:createdAt, groupEventKey:groupEventKey(senderId,createdAt,frame.message),
      ...(drawingAddress ? {nativeDrawingAddress:drawingAddress} : {}), ...normalized});
    this.waiter?.();
  }

  isCurrentGroupInput(message) {
    const context = this.groupContexts.get(message.contextToken);
    return !!context && context.groupId === message.groupId && this.groupIds.has(context.groupId) && context.generation === this.generation;
  }

  async waitForGroupReceiveSecond(groupId, routeSince) {
    const admission = this.#groupAdmissions.get(groupId), generation = this.generation;
    if (!admission || !Number.isSafeInteger(routeSince)) throw new QQError('changed');
    // The bridge reports whole seconds. A new ID can still be a delayed
    // message from before resume. Confirm readiness at the first safe second
    // for both the transport and the route, without changing either cutoff.
    const firstSecond = Math.ceil(Math.max(this.acceptAfter, admission.since, routeSince) / 1000) * 1000;
    const remaining = firstSecond - this.now();
    if (remaining > 0) {
      await delay(remaining + 1, undefined, {signal:admission.controller.signal});
    }
    if (!this.ready || generation !== this.generation || this.#groupAdmissions.get(groupId) !== admission ||
        this.now() < firstSecond) throw new QQError('changed');
  }

  setActiveGroupIds(values, {pausedGroupIds = []} = {}) {
    const next = activeGroupIds(values), previous = this.groupIds;
    const paused = activeGroupIds(pausedGroupIds);
    if ([...paused].some(id => next.has(id)) || next.size + paused.size > 5) throw new QQError('invalid_group');
    const since = this.now();
    if (!Number.isSafeInteger(since) || since < 0) throw new QQError('invalid_input');
    this.groupIds = next;
    for (const id of next) {
      if (!previous.has(id)) {
        const ignored = this.#pausedGroupAdmissions.get(id);
        this.#groupAdmissions.set(id, {since:Math.max(since, (ignored?.overflowThrough ?? -1) + 1),
          controller:new AbortController(), ignored});
      }
    }
    for (const id of this.#pausedGroupAdmissions.keys()) if (!paused.has(id)) this.#pausedGroupAdmissions.delete(id);
    for (const id of previous) {
      if (next.has(id)) continue;
      const admission = this.#groupAdmissions.get(id);
      this.#groupAdmissions.delete(id);
      if (paused.has(id)) this.#pausedGroupAdmissions.set(id, admission.ignored || {ids:new Map(), overflowThrough:-1});
      this.groupMediaRevisions.delete(id);
      this.groupImageIds.delete(id);
      this.groupVoiceIds.delete(id);
      this.groupSpeakers.delete(id);
      this.recentGroupReplies.delete(id);
      for (const key of this.groupReferences.keys()) {
        if (key.startsWith(id + ':')) this.groupReferences.delete(key);
      }
      this.invalidateGroupInputs(id);
      admission.controller.abort();
    }
    // A re-opened profile can already contain saved paused groups. Accept
    // only their native IDs for replay protection on this connection.
    for (const id of paused) {
      if (!this.#pausedGroupAdmissions.has(id)) this.#pausedGroupAdmissions.set(id, {ids:new Map(), overflowThrough:-1});
    }
  }

  invalidateGroupInputs(groupId) {
    this.queue = this.queue.filter(message => message.groupId !== groupId);
    for (const [token, context] of this.groupContexts) {
      if (context.groupId !== groupId) continue;
      this.finishGroupInput(token);
      this.groupContexts.delete(token);
    }
    for (const [key, context] of this.#activeGroupDrawingSources) {
      if (context.groupId === groupId) this.#activeGroupDrawingSources.delete(key);
    }
    this.clearGroupImageReferences(groupId);
    for (const read of this.groupVoiceReads) if (read.groupId === groupId) read.controller.abort();
  }

  finishGroupInput(token) {
    const row = this.groupContexts.get(token);
    if (!row?.pendingInput) return;
    delete row.pendingInput;
    row.routed?.resolve();
    delete row.routed;
  }

  settleGroupInputs(groupId, senderId, after, signal) {
    // Snapshot only already-arrived text or voice from this group member. A visual
    // request can finish while the follow-up is still waiting in the poll batch.
    const pending = [];
    for (const row of this.groupContexts.values()) {
      if (!row.pendingInput || row.groupId !== groupId || row.senderId !== senderId || row.createdAt < after) continue;
      row.routed ??= Promise.withResolvers();
      pending.push(row.routed.promise);
    }
    if (signal.aborted || !pending.length) return Promise.resolve(!signal.aborted);
    return new Promise(resolve => {
      const finish = ready => {
        clearTimeout(timer);
        signal.removeEventListener('abort', abort);
        resolve(ready);
      };
      const abort = () => finish(false);
      const timer = setTimeout(abort, 750);
      signal.addEventListener('abort', abort, {once:true});
      Promise.all(pending).then(() => finish(true));
    });
  }

  groupReferenceKey(groupId, rawId) {
    return groupId + ':' + rawId;
  }

  #groupMessageRecalled(groupId, messageId) {
    return this.#groupRecallAuthors.has(this.groupReferenceKey(groupId, messageId));
  }

  #notifyGroupRecall(event, generation) {
    try {
      const accepted = this.onGroupRecall(event, {client:this,generation});
      if (typeof accepted?.then === 'function') Promise.resolve(accepted).catch(() => {});
      return accepted === true;
    } catch { return false; }
  }

  #groupRecall(frame) {
    const {accountId, generation, socket} = this;
    const current = () => this.ready && !this.closed && !!accountId && this.socket === socket &&
      socket?.readyState === 1 && this.generation === generation && this.accountId === accountId;
    if (!current() || !sameQQ(frame.self_id, accountId)) return;
    let groupId, authorId, operatorId;
    try {
      groupId = validateQQOwner(frame.group_id);
      authorId = validateQQOwner(frame.user_id);
      operatorId = validateQQOwner(frame.operator_id);
    } catch { return; }
    const messageId = eventId(frame.message_id), now = this.now(), at = frame.time * 1000;
    const connectedSecond = Math.floor(Math.max(this.connectedAt, this.acceptAfter) / 1000) * 1000;
    if (!this.groupIds.has(groupId) || !messageId || !Number.isSafeInteger(frame.time) || !Number.isSafeInteger(at) ||
        !Number.isSafeInteger(now) || at < Math.max(connectedSecond,this.#groupAdmissions.get(groupId).since) || Math.abs(now - at) > GROUP_RECALL_CLOCK_SLOP_MS) return;

    const event = {accountId,groupId,authorId,operatorId,messageId,observed:false};
    const key = this.groupReferenceKey(groupId, messageId), recalledAuthor = this.#groupRecallAuthors.get(key);
    if (recalledAuthor !== undefined) {
      // A repeated exact notice can retry a pending durable write. Local
      // queue and capability invalidation has already happened once.
      if (recalledAuthor === authorId) this.#notifyGroupRecall(event, generation);
      return;
    }
    const drawingSource = this.#activeGroupDrawingSources.get(key);
    const reference = this.groupReferences.get(key) ?? (drawingSource ? 'other' : undefined);
    const ownReceipt = reference === 'self' || ownMediaReference(reference), selfRecall = authorId === accountId;
    if (reference === 'unknown' || ownReceipt && !selfRecall ||
        selfRecall && (reference === 'other' || this.seen.has(`group:${groupId}:${messageId}`))) return;
    const contexts = [...this.groupContexts.values()].filter(context =>
      context.generation === generation && context.groupId === groupId && context.rawId === messageId);
    if (drawingSource && !contexts.includes(drawingSource)) contexts.push(drawingSource);
    if (contexts.some(context => context.senderId !== authorId || context.createdAt > at)) return;
    const observed = ownReceipt || contexts.length > 0;
    if (this.seen.size >= MAX_SEEN) { if (observed) this._drop(new QQError('message_limit')); return; }

    // Locally proven recalls retire transport capabilities before any owner of
    // durable conversation state can start other work through the callback.
    if (observed) this.#applyGroupRecall(groupId, messageId, authorId);
    const accepted = this.#notifyGroupRecall({...event,observed}, generation);
    if (accepted && !observed && current()) this.#applyGroupRecall(groupId, messageId, authorId);
  }

  #applyGroupRecall(groupId, messageId, authorId) {
    const key = this.groupReferenceKey(groupId, messageId);
    this.seen.add(`recall:group:${groupId}:${messageId}`);
    this.#groupRecallAuthors.set(key, authorId);
    this.#activeGroupDrawingSources.delete(key);
    this.groupReferences.delete(key);
    this.groupImageReferences.delete(key);
    this.#discardGroupSentImage(key);
    for (const read of [...this.groupImageReads,...this.groupVoiceReads]) {
      if (read.groupId === groupId && (read.context.rawId === messageId ||
          read.context.image?.source?.id === messageId || read.context.image?.replyId === messageId)) {
        read.controller.abort();
      }
    }
    for (const [token, context] of this.groupContexts) {
      if (context.groupId !== groupId) continue;
      if (context.rawId === messageId) {
        this.finishGroupInput(token);
        this.groupContexts.delete(token);
      }
      else if (context.image?.source?.id === messageId || context.image?.replyId === messageId) delete context.image;
    }
    this.queue = this.queue.filter(message => !(message.groupId === groupId && message.id === `group:${groupId}:${messageId}`));
    for (const message of this.queue) {
      if (message.groupId !== groupId || message.quote?.id !== messageId) continue;
      if (message.image?.source?.id === messageId) delete message.image;
      const addressing = message.addressing;
      if (addressing) {
        delete addressing.imageReference;
        delete addressing.voiceReference;
        addressing.reference = 'unknown';
        addressing.quoteConflict = true;
      }
    }
  }

  recordGroupReference(groupId, rawId, speaker) {
    if (this.#groupMessageRecalled(groupId, rawId)) return;
    const key = this.groupReferenceKey(groupId, rawId);
    const previous = this.groupReferences.get(key) ?? (this.#activeGroupDrawingSources.has(key) ? 'other' : undefined);
    const conflict = previous && (previous !== speaker || ownMediaReference(speaker));
    if (conflict) this.#activeGroupDrawingSources.delete(key);
    this.groupReferences.set(key, conflict ? 'unknown' : speaker);
    if (this.groupReferences.get(key) !== 'other') this.groupImageReferences.delete(key);
    if (this.groupReferences.get(key) !== 'self_image') this.#discardGroupSentImage(key);
    while (this.groupReferences.size > MAX_GROUP_REFERENCES) {
      const expired = this.groupReferences.keys().next().value;
      this.groupReferences.delete(expired);
      this.#discardGroupSentImage(expired);
    }
  }

  #discardGroupSentImage(key) {
    const entry = this.#groupSentImages.get(key);
    if (!entry) return;
    this.#groupSentImages.delete(key);
    clearTimeout(entry.timer);
    entry.bytes.fill(0);
    for (const read of this.groupImageReads) if (read.source === entry.source) read.controller.abort();
  }

  #currentGroupSentImage(key) {
    const entry = this.#groupSentImages.get(key);
    if (!entry) return null;
    const {source, expiresAt, socket, generation, revision} = entry, now = this.now();
    if (!Number.isSafeInteger(now) || now < source.createdAt || now >= expiresAt || source.accountId !== this.accountId ||
        this.socket !== socket || this.generation !== generation || !this.groupImageIds.has(source.groupId) ||
        this.groupVoiceRevision(source.groupId) !== revision || this.groupReferences.get(key) !== 'self_image') {
      this.#discardGroupSentImage(key);
      return null;
    }
    return entry;
  }

  #rememberGroupSentImage(groupId, id, scopeId, file) {
    const key = this.groupReferenceKey(groupId, id), now = this.now();
    if (!mediaScopeId(scopeId) || !this.groupImageIds.has(groupId) || this.groupReferences.get(key) !== 'self_image' ||
        !Number.isSafeInteger(now) || now < 0 || now > Number.MAX_SAFE_INTEGER - GROUP_SENT_IMAGE_AGE_MS) return;
    const revision = this.groupVoiceRevision(groupId);
    if (!revision) return;
    // Decode only the accepted, already validated wire snapshot. A caller may
    // have changed or wiped its original input Buffer while awaiting the echo.
    const bytes = Buffer.from(file.slice('base64://'.length), 'base64');
    const source = Object.freeze({kind:'qq-group-sent-image',groupId,accountId:this.accountId,id,
      createdAt:Math.floor(now/1000)*1000});
    while (this.#groupSentImages.size >= MAX_GROUP_SENT_IMAGES) this.#discardGroupSentImage(this.#groupSentImages.keys().next().value);
    const entry = {source, bytes, scopeId, revision, socket:this.socket, generation:this.generation,
      expiresAt:now+GROUP_SENT_IMAGE_AGE_MS, timer:null};
    entry.timer = setTimeout(() => {
      if (this.#groupSentImages.get(key) === entry) this.#discardGroupSentImage(key);
    }, GROUP_SENT_IMAGE_AGE_MS);
    entry.timer.unref?.();
    this.#groupSentImages.set(key, entry);
  }

  hasCurrentGroupSentImage(source, scopeId) {
    if (source?.kind !== 'qq-group-sent-image' || !mediaScopeId(scopeId)) return false;
    const entry = this.#currentGroupSentImage(this.groupReferenceKey(source.groupId, source.id));
    return entry?.source === source && entry.scopeId === scopeId;
  }

  clearGroupSentImages(groupId) {
    for (const [key, entry] of this.#groupSentImages) {
      if (entry.source.groupId === groupId) this.#discardGroupSentImage(key);
    }
  }

  updateMediaPermissions(imageIds, voiceIds) {
    for (const [allowed, next] of [[this.groupImageIds,imageIds], [this.groupVoiceIds,voiceIds]]) {
      for (const group of allowed) if (!next.includes(group)) allowed.delete(group);
      for (const group of next) allowed.add(group);
    }
  }

  clearGroupImageReferences(groupId) {
    this.clearGroupSentImages(groupId);
    for (const [key, image] of this.groupImageReferences) if (image.groupId === groupId) this.groupImageReferences.delete(key);
    for (const context of this.groupContexts.values()) if (context.groupId === groupId) delete context.image;
    for (const read of this.groupImageReads) if (read.groupId === groupId) read.controller.abort();
  }

  bindGroupImageRead(message, signal, {sentScopeId} = {}) {
    return this._bindGroupMediaRead(message,signal,'image',this.groupImageIds,this.groupImageReads,MAX_GROUP_IMAGE_READS,sentScopeId);
  }

  bindGroupVoiceRead(message, signal) {
    return this._bindGroupMediaRead(message,signal,'voice',this.groupVoiceIds,this.groupVoiceReads,MAX_GROUP_VOICE_READS);
  }

  _bindGroupMediaRead(message, signal, kind, enabledGroups, reads, limit, sentScopeId) {
    const {groupId,contextToken} = message || {};
    const context = this.groupContexts.get(contextToken), media = message?.[kind];
    if (!context || !media || context[kind] !== media || context.groupId !== groupId || context.senderId !== message.from ||
        message.route !== 'group' || message.accountId !== this.accountId || message.id !== `group:${groupId}:${context.rawId}` ||
        message.text !== media.caption || media.source && message.quote?.id !== media.source.id ||
        media.replyId && (message.quote?.id !== media.replyId || this.#groupMessageRecalled(groupId,media.replyId)) ||
        !enabledGroups.has(groupId)) throw new QQError('wrong_scope');
    if (reads.size >= limit || [...reads].some(read => read.context === context)) throw new QQError('busy');
    const controller = new AbortController(), combined = signal ? AbortSignal.any([signal,controller.signal]) : controller.signal;
    const generation = this.generation, accountId = this.accountId;
    const source = media.source || media, key = this.groupReferenceKey(groupId,source.id);
    const sent = kind === 'image' && source.kind === 'qq-group-sent-image';
    let sentProof, copied = false;
    const read = {groupId,context,controller,...(sent ? {source} : {})};
    const assertCurrent = () => {
      if (combined.aborted || !enabledGroups.has(groupId)) throw new QQError('cancelled');
      if (!this.ready || this.closed || this.socket?.readyState !== 1 || this.generation !== generation ||
          this.accountId !== accountId || context.generation !== generation || this.groupContexts.get(contextToken) !== context ||
          context[kind] !== media) throw new QQError('stale_context');
      if (sent ? !this.hasCurrentGroupSentImage(source, sentScopeId) : this.groupReferences.get(key) !== 'other' ||
          media.source && (this.groupImageReferences.get(key) !== source || this.now()-source.createdAt > GROUP_IMAGE_AGE_MS)) {
        throw new QQError('stale_context');
      }
    };
    assertCurrent();
    reads.add(read);
    return {
      signal:combined,assertCurrent,
      verify:async () => {
        if (sent) {
          const proof = {membershipVerified:false, quote:null};
          sentProof = proof;
          await this._authenticateGroupMediaTarget(groupId, combined, assertCurrent);
          assertCurrent();
          if (sentProof !== proof) throw new QQError('stale_context');
          proof.membershipVerified = true;
          return;
        }
        assertCurrent();const verified = await this._socialAccount(combined);assertCurrent();
        await this._requireOnline(combined);verified.assertCurrent();assertCurrent();
      },
      ...(kind==='voice' ? {windowsPttAccount:async () => {
        assertCurrent();
        if (this.expectedAccountId!==accountId||validateQQUrl(this.url)!==this.url) throw new QQError('wrong_scope');
        const version=await this._request('get_version_info',{},combined);assertCurrent();
        if (version?.app_name!=='NapCat.Onebot'||version.protocol_version!=='v11'||version.app_version!=='4.18.42') return null;
        return accountId;
      }} : {}),
      getMessage:async id => {
        if (typeof id !== 'string' || id !== media.id && (sent || id !== media.source?.id)) throw new QQError('wrong_scope');
        const proof = sentProof, lookup = sent ? {verified:false} : null;
        if (sent) {
          if (!proof?.membershipVerified) throw new QQError('wrong_scope');
          proof.quote = lookup;
        }
        assertCurrent();const row = await this._request('get_msg',{message_id:id},combined);assertCurrent();
        if (sent) {
          if (sentProof !== proof || proof.quote !== lookup) throw new QQError('stale_context');
          if (row?.status !== undefined && row.status !== 'normal') throw new QQError('message_changed');
          verifyGroupMessage(row, media);
          lookup.verified = true;
        }
        return row;
      },
      ...(sent ? {readSentImage:() => {
        assertCurrent();
        if (!sentProof?.quote?.verified || copied) throw new QQError('wrong_scope');
        copied = true;
        return Buffer.from(this.#groupSentImages.get(key).bytes);
      }} : {}),
      release:() => {reads.delete(read);controller.abort();},
    };
  }

  #liveGroupQuote(token, context) {
    return this.groupContexts.get(token) === context && this.#currentGroupSource(context) &&
      this.groupReferences.get(this.groupReferenceKey(context.groupId, context.rawId)) === 'other';
  }

  #currentGroupSource(context) {
    const age = this.now() - context.receivedAt;
    return this.ready && context.generation === this.generation && this.groupIds.has(context.groupId) &&
      age >= 0 && age < GROUP_QUOTE_ANCHOR_AGE_MS;
  }

  #competingQuestion(token, context) {
    if (!context.humanQuoteAnchor || context.questionForm < 0 || !this.#liveGroupQuote(token, context)) return false;
    for (const [otherToken, other] of this.groupContexts) {
      if (other.sequence > context.sequence && other.groupId === context.groupId && other.senderId !== context.senderId &&
          other.humanQuoteAnchor && other.questionForm === context.questionForm && this.#liveGroupQuote(otherToken, other)) return true;
    }
    return false;
  }

  #groupReplySource({groupId, senderId, accountId}, contextToken) {
    const context = this.groupContexts.get(contextToken);
    if (!this.ready || !context || context.generation !== this.generation ||
        accountId !== undefined && accountId !== this.accountId ||
        context.groupId !== groupId || context.senderId !== senderId || !this.groupIds.has(groupId)) throw new QQError('stale_context');
    return context;
  }

  assertGroupReplyContext(source, contextToken) {
    const context = this.#groupReplySource(source, contextToken);
    if (!source.accountId || source.accountId !== this.expectedAccountId || this.closed ||
        this.socket?.readyState !== 1 || !this.#liveGroupQuote(contextToken, context)) throw new QQError('stale_context');
    return true;
  }

  retainGroupDrawingSource(source, contextToken) {
    this.assertGroupReplyContext(source, contextToken);
    const context = this.groupContexts.get(contextToken), socket = this.socket;
    const key = this.groupReferenceKey(context.groupId, context.rawId), active = this.#activeGroupDrawingSources;
    if (active.size >= MAX_ACTIVE_GROUP_DRAWING_SOURCES || active.has(key)) throw new QQError('stale_context');
    // Keep the originating member's proof for this admitted draw only.
    // Ordinary reply tokens and quoted-message caches remain bounded separately.
    active.set(key, context);
    const assertCurrent = () => {
      if (active.get(key) !== context || !this.#currentGroupSource(context) || this.closed ||
          this.socket !== socket || socket?.readyState !== 1 ||
          source.accountId !== this.accountId || source.accountId !== this.expectedAccountId) throw new QQError('stale_context');
    };
    return {
      assertCurrent,
      sendNotice: async (text, signal) => {
        if (typeof text !== 'string' || !text.trim() || text.length > MAX_TEXT) throw new QQError('invalid_input');
        const {groupId, rawId} = context;
        assertCurrent();
        const id = await this.#submitGroupText(groupId, [
          {type:'reply', data:{id:rawId}},
          {type:'text', data:{text}}
        ], signal);
        if (active.get(key) === context && context.generation === this.generation) this.recordGroupReference(groupId, id, 'self');
      },
      release: () => { if (active.get(key) === context) active.delete(key); }
    };
  }

  async sendGroupText({groupId, senderId, accountId}, text, contextToken, clientId = randomUUID(), signal, presentation) {
    const source = {groupId, senderId, accountId};
    const context = this.#groupReplySource(source, contextToken);
    if (typeof text !== 'string' || !text.trim() || text.length > MAX_TEXT || typeof clientId !== 'string' || clientId.length > 128) throw new QQError('invalid_input');
    const message = [];
    const started = this.now();
    let second = Math.floor(started / 1000);
    const mode = presentation?.quote;
    const plainTurn = mode === 'plain-turn';
    if (presentation !== undefined && ![false,'if-ambiguous','if-interleaved','earlier','plain-turn'].includes(mode)) throw new QQError('invalid_input');
    if (presentation?.quoteToken !== undefined && mode !== 'earlier' && !plainTurn) throw new QQError('invalid_input');
    let target = context;
    if (mode === 'earlier' || plainTurn && presentation.quoteToken !== undefined) {
      target = this.groupContexts.get(presentation.quoteToken);
      if (!target?.humanQuoteAnchor || target.groupId !== groupId || target.sequence >= context.sequence ||
          !this.#liveGroupQuote(presentation.quoteToken, target)) throw new QQError('stale_context');
    }
    const textKey = presentation && presentation.faceId === undefined ? createHash('sha256').update(text).digest('hex') : null;
    if (presentation?.faceId !== undefined) {
      if (presentation.quote !== false || groupFaceLabel(presentation.faceId) !== text) throw new QQError('invalid_input');
      message.push({type:'face', data:{id:presentation.faceId}});
    } else {
      // Other bridges may assign different message IDs. Identical replies to
      // distinct inputs in one second also need an anchor to distinguish them.
      const previousTargetAt = second => {
        const recent = this.recentGroupReplies.get(groupId);
        return recent?.second === second ? recent.targets.get(textKey) : undefined;
      };
      let previousTarget = previousTargetAt(second);
      if (plainTurn && previousTarget !== undefined && previousTarget !== context.rawId) {
        // Distinct unquoted replies share a cross-bridge identity within one
        // second. Wait once, before handing anything to the socket.
        const nextSecond = second + 1;
        try {
          await delay(nextSecond * 1000 - started, undefined, {signal});
          this.assertGroupReplyContext(source, contextToken);
          if (target !== context && !this.#liveGroupQuote(presentation.quoteToken, target)) throw new QQError('stale_context');
          second = Math.floor(this.now() / 1000);
          previousTarget = previousTargetAt(second);
          if (second < nextSecond || previousTarget !== undefined && previousTarget !== context.rawId) {
            throw new QQError('ambiguous_group_reply');
          }
        } catch (error) {
          throw Object.assign(new QQError(signal?.aborted ? 'aborted' : error.code), {deliveryNotSubmitted:true});
        }
      }
      const needsIdentity = previousTarget !== undefined && previousTarget !== target.rawId &&
        (mode === 'if-ambiguous' || mode === 'if-interleaved');
      const interrupted = mode === 'if-interleaved' && this.groupSpeakers.get(groupId) !== context.speakerTurn;
      const competing = mode === 'if-ambiguous' && this.#competingQuestion(contextToken, context);
      if (presentation === undefined || mode === 'earlier' || interrupted || needsIdentity || competing) {
        message.push({type:'reply', data:{id:target.rawId}});
      }
      message.push({type:'text', data:{text}});
    }
    const id = await this.#submitGroupText(groupId, message, signal);
    if (this.ready && this.groupContexts.get(contextToken) === context && context.generation === this.generation) {
      this.recordGroupReference(groupId, id, 'self');
      if (textKey) {
        let accepted = this.recentGroupReplies.get(groupId);
        if (!accepted || accepted.second < second) {
          accepted = {second, targets:new Map()};
          this.recentGroupReplies.set(groupId, accepted);
        }
        if (accepted.second === second) {
          accepted.targets.set(textKey, plainTurn ? context.rawId : target.rawId);
          if (accepted.targets.size > MAX_QUEUE) accepted.targets.delete(accepted.targets.keys().next().value);
        }
      }
    }
    return {id,clientId};
  }

  async #submitGroupText(groupId, message, signal) {
    if (signal?.aborted) throw Object.assign(new QQError('aborted'), {deliveryNotSubmitted:true});
    const data = await this._request('send_group_msg', {group_id:Number(groupId),message,auto_escape:true});
    const id = eventId(data?.message_id);
    if (!id) throw new QQError('invalid_send_receipt');
    return id;
  }

  async sendGroupProactive({groupId, senderId}, text, clientId = randomUUID(), signal) {
    let submitted = false;
    try {
      if (!this.groupIds.has(groupId) || validateQQOwner(senderId) !== senderId || senderId === this.accountId) throw new QQError('invalid_group');
      if (typeof text !== 'string' || !text.trim() || text.length > MAX_SOCIAL_TEXT || typeof clientId !== 'string' || clientId.length > 128) throw new QQError('invalid_input');
      const admission = this.#groupAdmissions.get(groupId);
      const active = signal ? AbortSignal.any([signal,admission.controller.signal]) : admission.controller.signal;
      const account = await this._socialAccount(active);
      const assertCurrent = () => {
        account.assertCurrent();
        if (active.aborted || this.#groupAdmissions.get(groupId) !== admission) throw new QQError('changed');
      };
      const params = {group_id:Number(groupId),
        message:[{type:'at',data:{qq:senderId}},{type:'text',data:{text:' '+text}}],auto_escape:true};
      assertCurrent();
      const data = await this._request('send_group_msg', params, undefined, () => {submitted = true;});
      const id = eventId(data?.message_id);
      if (!id) throw new QQError('invalid_send_receipt');
      try { assertCurrent(); this.recordGroupReference(groupId, id, 'self'); }
      catch { /* The correlated receipt still belongs to the submitted send. */ }
      return {id,clientId};
    } catch (error) {
      // After handing the request to the socket, a missing receipt is
      // inconclusive even when a local callback reports a transport error.
      if (submitted) throw error;
      throw Object.assign(new QQError(error?.code || 'send_failed'), {deliveryNotSubmitted:true});
    }
  }

  async sendGroupFeedNotice(groupId, text, clientId, signal, {assertCurrent, beforeSubmit} = {}) {
    let submitted = false;
    try {
      socialText(text);
      socialId(clientId);
      if (typeof beforeSubmit !== 'function') return {outcome: 'not_submitted'};
      const {check} = await this._authenticateGroupMediaTarget(groupId, signal, assertCurrent);
      const params = {group_id: Number(groupId), message: [{type: 'text', data: {text}}], auto_escape: true};
      check();
      const authorised = beforeSubmit();
      if (typeof authorised?.then === 'function') {
        Promise.resolve(authorised).catch(() => {});
        return {outcome: 'not_submitted'};
      }
      if (authorised !== undefined && authorised !== true) return {outcome: 'not_submitted'};
      check();
      const receipt = await this._request('send_group_msg', params, undefined, () => {submitted = true;});
      const messageId = eventId(receipt?.message_id);
      if (messageId) {
        try {
          check();
          this.recordGroupReference(groupId, messageId, 'self');
        } catch { /* A retired scope keeps its receipt without quote evidence. */ }
        return {outcome: 'accepted', messageId};
      }
    } catch { /* A bridge failure after submission cannot safely be replayed. */ }
    return {outcome: submitted ? 'unknown' : 'not_submitted'};
  }

  _request(action, params, signal, onSubmit) {
    if (signal?.aborted) return Promise.reject(new QQError('aborted'));
    const socket = this.socket;
    if (!socket || socket.readyState !== 1) return Promise.reject(new QQError('disconnected'));
    if (this.pending.size >= 20) return Promise.reject(new QQError('request_limit'));
    const echo = randomUUID();
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (error, data) => {
        if (settled) return;
        settled = true; clearTimeout(timer); signal?.removeEventListener('abort', abort); this.pending.delete(echo);
        error ? reject(error) : resolve(data);
      };
      const timer = setTimeout(() => finish(new QQError('action_timeout')), this.timeoutMs);
      const abort = () => finish(new QQError('aborted'));
      this.pending.set(echo, {resolve: data => finish(null, data), reject: error => finish(error)});
      signal?.addEventListener('abort', abort, {once: true});
      try {
        const request = JSON.stringify({action, params, echo});
        onSubmit?.();
        socket.send(request, error => { if (error) finish(new QQError('send_failed')); });
      }
      catch { finish(new QQError('send_failed')); }
    });
  }

  async getUpdates(cursor = '', signal) {
    if (!(cursor === '' || (typeof cursor === 'string' && /^\d{1,16}$/.test(cursor) && Number(cursor) === this.cursor))) throw new QQError('invalid_cursor');
    await this.connect(signal);
    if (!this.queue.length) {
      if (this.waiter) throw new QQError('concurrent_poll');
      await new Promise(resolve => {
        const done = () => { clearTimeout(timer); signal?.removeEventListener('abort', done); if (this.waiter === done) this.waiter = null; resolve(); };
        const timer = setTimeout(done, this.pollTimeoutMs);
        this.waiter = done;
        signal?.addEventListener('abort', done, {once: true});
        if (signal?.aborted || !this.ready) done();
      });
    }
    if (signal?.aborted) throw new QQError('aborted');
    if (!this.ready) throw this.lastError || new QQError('disconnected');
    const messages = this.queue.splice(0, MAX_QUEUE);
    this.cursor += messages.length;
    return {cursor: String(this.cursor), messages};
  }

  async sendText(to, text, contextToken, clientId = randomUUID(), signal) {
    if (to !== this.ownerId) throw new QQError('owner_required');
    if (typeof text !== 'string' || !text.trim() || text.length > MAX_TEXT || typeof clientId !== 'string' || clientId.length > 128) throw new QQError('invalid_input');
    // A disconnected send is ambiguous; never reconnect and replay it silently.
    if (!this.ready || !this.contextToken || contextToken !== this.contextToken) throw new QQError('stale_context');
    const data = await this._request('send_private_msg', {user_id: Number(this.ownerId),
      message: [{type: 'text', data: {text}}], auto_escape: true}, signal);
    const id = eventId(data?.message_id);
    if (!id) throw new QQError('invalid_send_receipt');
    return {id, clientId};
  }

  async _socialAccount(signal) {
    // Proactive actions are a distinct path, never a fabricated inbound reply.
    // The caller owns its persisted action policy. Recheck the signed-in QQ
    // before each action because the bridge can switch accounts without a WS
    // close/event. No reconnect or ambiguous-write retry occurs here.
    if (signal?.aborted) throw new QQError('aborted');
    if (!this.ready || !this.accountId || this.closed || this.socket?.readyState !== 1) throw new QQError('disconnected');
    const accountId = this.accountId, generation = this.generation;
    const login = await this._request('get_login_info', {}, signal);
    if (this.expectedAccountId && !sameQQ(login?.user_id, this.expectedAccountId)) {
      this._drop(new QQError('account_mismatch'));
      throw new QQError('account_mismatch');
    }
    if (!sameQQ(login?.user_id, accountId)) {
      this._drop(new QQError('account_changed'));
      throw new QQError('account_changed');
    }
    const assertCurrent = () => {
      if (signal?.aborted) throw new QQError('aborted');
      if (!this.ready || this.closed || this.generation !== generation || this.accountId !== accountId || this.socket?.readyState !== 1) {
        throw this.lastError || new QQError('disconnected');
      }
    };
    assertCurrent();
    return {accountId, assertCurrent};
  }

  async sendProactiveText(to, text, clientId = randomUUID(), signal) {
    let submitted = false;
    try {
      if (to !== this.ownerId) throw new QQError('owner_required');
      socialText(text); socialId(clientId);
      const {assertCurrent} = await this._socialAccount(signal);
      assertCurrent();
      // Once handed to OneBot, an aborted initiative cannot retract the send.
      // Keep listening for this echo on the same socket until receipt or timeout.
      const data = await this._request('send_private_msg', {user_id: Number(this.ownerId),
        message: [{type: 'text', data: {text}}], auto_escape: true}, undefined, () => {submitted = true;});
      const id = eventId(data?.message_id);
      if (!id) throw new QQError('invalid_send_receipt');
      return {id, clientId};
    } catch (error) {
      if (submitted) throw error;
      throw Object.assign(new QQError(error?.code || 'send_failed'), {deliveryNotSubmitted:true});
    }
  }

  readSelfProfile(signal, {assertCurrent = () => {}} = {}) {
    const {QQSelfProfileTransport}=require('./qq-self-profile-transport.cjs');
    const binding={client:this,accountId:this.accountId,socket:this.socket,clientGeneration:this.generation};
    return new QQSelfProfileTransport({now:this.now}).read(binding,{signal,assertCurrent});
  }

  setSelfSignature(value, signal, {expectedValue,assertCurrent = () => {}} = {}) {
    const {QQSelfProfileTransport}=require('./qq-self-profile-transport.cjs');
    const binding={client:this,accountId:this.accountId,socket:this.socket,clientGeneration:this.generation};
    return new QQSelfProfileTransport({now:this.now}).write(binding,{field:'signature',value,expectedValue},{signal,assertCurrent});
  }

  setSelfNickname(value, signal, {expectedValue,expectedSignature,assertCurrent = () => {}} = {}) {
    const {QQSelfProfileTransport}=require('./qq-self-profile-transport.cjs');
    const binding={client:this,accountId:this.accountId,socket:this.socket,clientGeneration:this.generation};
    return new QQSelfProfileTransport({now:this.now}).write(binding,{field:'nickname',value,expectedValue,expectedSignature},{signal,assertCurrent});
  }

  async readOwnerRemark(signal, {assertCurrent = () => {}} = {}) {
    if(typeof assertCurrent!=='function')throw new QQOwnerRemarkError('invalid_request');
    const deadline=AbortSignal.timeout(10000),combined=signal?AbortSignal.any([signal,deadline]):deadline,check=remarkGuard(this,combined,assertCurrent);
    try {
      check();let current=await this._socialAccount(combined);check();
      await this._requireOnline(combined);current.assertCurrent();check();
      const rows=await this._request('get_friend_list',{no_cache:false},combined);
      check();
      if(!Array.isArray(rows))throw new QQOwnerRemarkError('invalid_response');
      if(rows.length>MAX_FRIENDS)throw new QQOwnerRemarkError('response_too_large');
      let owner;
      for(const row of rows){
        let id;try{if(!row||typeof row!=='object'||Array.isArray(row))throw new Error();id=validateQQOwner(row.user_id);}catch{throw new QQOwnerRemarkError('invalid_response');}
        if(id===this.ownerId){if(owner)throw new QQOwnerRemarkError('invalid_response');owner=row;}
      }
      if(!owner)throw new QQOwnerRemarkError('owner_not_found');
      if(typeof owner.remark!=='string'||typeof owner.nickname!=='string')throw new QQOwnerRemarkError('invalid_response');
      const nickname=owner.nickname.replace(/[\p{Cc}\p{Cf}\u2028\u2029]/gu,'').slice(0,128).replace(/[\uD800-\uDBFF]$/u,'');
      let supported=true;try{validateRemark(owner.remark);}catch{supported=false;}
      current=await this._socialAccount(combined);check();await this._requireOnline(combined);current.assertCurrent();check();
      return {accountId:current.accountId,ownerId:this.ownerId,nickname,fetchedAt:new Date(this.now()).toISOString(),source:'bridge-cache',
        ...(supported?{remark:owner.remark,supported:true}:{supported:false,reason:'original_unsupported'})};
    }catch(error){throw new QQOwnerRemarkError(deadline.aborted&&!signal?.aborted?'timeout':remarkCode(error));}
  }

  async setOwnerRemark(remark, signal, {assertCurrent = () => {}, expectedRemark} = {}) {
    let submitted=false;
    const deadline=AbortSignal.timeout(20000),combined=signal?AbortSignal.any([signal,deadline]):deadline;
    try {
      if(typeof assertCurrent!=='function')throw new QQOwnerRemarkError('invalid_request');
      const check=remarkGuard(this,combined,assertCurrent);
      validateRemark(remark);validateRemark(expectedRemark);check();
      const baseline=await this.readOwnerRemark(combined,{assertCurrent:check});check();
      if(!baseline.supported)throw new QQOwnerRemarkError('original_unsupported');
      if(baseline.remark!==expectedRemark)throw new QQOwnerRemarkError('baseline_changed');
      const current=await this._socialAccount(combined);check();await this._requireOnline(combined);current.assertCurrent();check();
      // Fixed owner only. The read/compare is optimistic; NapCat has no CAS API.
      submitted=true;
      const receipt=await this._request('set_friend_remark',{user_id:this.ownerId,remark},combined);
      // NapCat 4.18.42 declares a null return schema, but its Promise<void>
      // handler also produces an omitted JSON data field. _request has already
      // checked the matching echo, status === 'ok' and numeric retcode === 0.
      if(receipt!==null&&receipt!==undefined)throw new QQOwnerRemarkError('change_unknown');
      return {outcome:'accepted'};
    }catch(error){return {outcome:submitted?'unknown':'not_submitted',code:submitted?'change_unknown':deadline.aborted&&!signal?.aborted?'timeout':remarkCode(error)};}
  }

  async decideFriendRequest(value, {signal, assertCurrent = () => {}} = {}) {
    let submitted = false;
    try {
      if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join() !== 'approve,flag' ||
          typeof value.approve !== 'boolean' || typeof value.flag !== 'string' || !value.flag || value.flag.length > 512 ||
          /[\p{Cc}\p{Cf}\p{Cs}]/u.test(value.flag) || typeof assertCurrent !== 'function') throw new QQError('invalid_request');
      const {flag, approve} = value, check = friendRequestGuard(this, signal, assertCurrent);
      check();
      const current = await this._socialAccount(signal); check();
      await this._requireOnline(signal); current.assertCurrent(); check();
      // Fixed action and explicit Boolean; no target, optional remark, implicit
      // approval, reconnect or retry. The caller has already consumed its flag.
      submitted = true;
      const receipt = await this._request('set_friend_add_request', {flag, approve}, signal);
      // The pinned void handler may omit data. The transport still requires a
      // matched echo, status === 'ok', and numeric retcode === 0.
      if (receipt !== null && receipt !== undefined) throw new QQError('invalid_response');
      // Preserve a genuine acceptance even if the panel changes afterwards.
      // This receipt is not independent confirmation of resulting friendship.
      return {outcome: 'accepted'};
    } catch (error) {
      return {outcome: submitted ? 'unknown' : 'not_submitted', code: submitted ? 'unknown' : friendRequestCode(error)};
    }
  }

  async sendOwnerImage(to, pngBytes, clientId = randomUUID(), signal, {assertCurrent = () => {}, receiptSignal = signal, caption} = {}) {
    let submitted = false, bytes;
    try {
      if (to !== this.ownerId || typeof clientId !== 'string' || !clientId || clientId.length > 128 ||
          /[\p{Cc}\p{Cf}]/u.test(clientId) || typeof assertCurrent !== 'function') throw new QQMediaError('invalid_request');
      validateImagePayload(pngBytes);const credit=photoCaption(caption);bytes = Buffer.from(pngBytes);
      // Explicit owner media has its own preflight. It cannot reconnect or
      // broaden a text reply into arbitrary segments, files, URLs or targets.
      assertCurrent();
      let current = await this._socialAccount(signal); assertCurrent();
      await this._requireOnline(signal); current.assertCurrent(); assertCurrent();
      current = await this._socialAccount(signal); current.assertCurrent(); assertCurrent();
      const params = {user_id: this.ownerId, message: [{type: 'image', data: {file: `base64://${bytes.toString('base64')}`}},...credit]};
      const receipt = await this._request('send_private_msg', params, receiptSignal, () => {submitted = true;});
      const messageId = eventId(receipt?.message_id);
      if (!messageId) throw new QQMediaError('send_unknown');
      // Matching bridge acceptance is not proof of display/read/delivery. A
      // context change after the receipt must not turn acceptance into failure.
      return {outcome: 'accepted', messageId};
    } catch (error) {
      const code = new QQMediaError(error?.code === 'aborted' ? 'cancelled' : error?.code).code;
      return {outcome: submitted ? 'unknown' : 'not_sent', code: submitted ? 'send_unknown' : code};
    } finally { bytes?.fill(0); }
  }

  async sendOwnerRecord(to, wavBytes, clientId = randomUUID(), signal, {assertCurrent = () => {}, receiptSignal = signal} = {}) {
    let submitted = false;
    try {
      if (to !== this.ownerId || typeof clientId !== 'string' || !clientId || clientId.length > 128 ||
          /[\p{Cc}\p{Cf}]/u.test(clientId) || typeof assertCurrent !== 'function') throw new QQVoiceError('invalid_request');
      // Validate before preflight; the renderer cannot supply paths, URLs,
      // segment types or recipients. NapCat owns its subsequent SILK conversion.
      const params = ownerRecordParams(this.ownerId, wavBytes);
      assertCurrent();
      let current = await this._socialAccount(signal); assertCurrent();
      await this._requireOnline(signal); current.assertCurrent(); assertCurrent();
      current = await this._socialAccount(signal); current.assertCurrent(); assertCurrent();
      const receipt = await this._request('send_private_msg', params, receiptSignal, () => {submitted = true;});
      const messageId = eventId(receipt?.message_id);
      if (!messageId) throw new QQVoiceError('send_unknown');
      // This is matched bridge acceptance, not proof of recipient playback.
      return {outcome: 'accepted', messageId};
    } catch (error) {
      const code = new QQVoiceError(error?.code === 'aborted' ? 'cancelled' : error?.code).code;
      return {outcome: submitted ? 'unknown' : 'not_sent', code: submitted ? 'send_unknown' : code};
    }
  }

  // Both media actions use the same authenticated group membership revision.
  groupVoiceRevision(groupId) {
    if (!this.ready || this.closed || this.socket?.readyState !== 1 || !this.expectedAccountId ||
        this.expectedAccountId !== this.accountId || !this.groupIds.has(groupId)) return null;
    if (!this.groupMediaRevisions.has(groupId)) this.groupMediaRevisions.set(groupId, randomUUID());
    return this.groupMediaRevisions.get(groupId);
  }

  async _authenticateGroupMediaTarget(groupId, signal, assertCurrent) {
    if (typeof assertCurrent !== 'function') throw new QQError('invalid_request');
    if (signal?.aborted) throw new QQError('aborted');
    if (!this.groupIds.has(groupId)) throw new QQError('group_unavailable');
    if (!this.ready || this.closed || this.socket?.readyState !== 1) throw new QQError('disconnected');
    const accountId = this.expectedAccountId;
    if (!accountId || accountId !== this.accountId) throw new QQError('account_mismatch');
    const revision = this.groupVoiceRevision(groupId), socket = this.socket, generation = this.generation;
    const admissionSignal = this.#groupAdmissions.get(groupId).controller.signal;
    signal = signal ? AbortSignal.any([signal,admissionSignal]) : admissionSignal;
    const check = () => {
      if (signal?.aborted) throw new QQError('aborted');
      const current = assertCurrent();
      if (typeof current?.then === 'function') {
        Promise.resolve(current).catch(() => {});
        throw new QQError('changed');
      }
      if (signal?.aborted) throw new QQError('aborted');
      if (current === false || this.generation !== generation || this.socket !== socket ||
          this.groupVoiceRevision(groupId) !== revision) throw new QQError('changed');
    };
    check();
    const current = await this._socialAccount(signal);
    check();
    await this._requireOnline(signal);
    current.assertCurrent();
    check();
    // LLBot 8.3.2 passes no_cache as forceUpdate to getGroupMemberByUin.
    // Require the uncached result to identify the bot in this exact group.
    let member;
    try {
      member = await this._request('get_group_member_info', {
        group_id: Number(groupId), user_id: Number(accountId), no_cache: true,
      }, signal);
    } catch (error) {
      if (['action_failed', 'action_timeout'].includes(error?.code)) throw new QQError('group_unavailable');
      throw error;
    }
    check();
    if (!member || typeof member !== 'object' || Array.isArray(member) ||
        !sameQQ(member.group_id, groupId) || !sameQQ(member.user_id, accountId)) {
      throw new QQError('group_unavailable');
    }
    const verified = await this._socialAccount(signal);
    verified.assertCurrent();
    check();
    return {accountId, groupId, revision, check, signal};
  }

  async verifyGroupVoiceTarget(groupId, signal, {assertCurrent = () => {}} = {}) {
    return this._verifyGroupMediaTarget(groupId, signal, assertCurrent, QQVoiceError);
  }

  async verifyGroupImageTarget(groupId, signal, {assertCurrent = () => {}} = {}) {
    return this._verifyGroupMediaTarget(groupId, signal, assertCurrent, QQMediaError);
  }

  async _verifyGroupMediaTarget(groupId, signal, assertCurrent, MediaError) {
    try {
      const {accountId, revision, check, signal:active} = await this._authenticateGroupMediaTarget(groupId, signal, assertCurrent);
      let info;
      try {
        info = await this._request('get_group_info', {group_id: Number(groupId), no_cache: true}, active);
      } catch (error) {
        // The exact group number remains available when a bridge has no name.
        if (!['action_failed', 'action_timeout'].includes(error?.code)) throw error;
      }
      check();
      const groupName = sameQQ(info?.group_id, groupId) && typeof info.group_name === 'string'
        ? info.group_name.replace(/[\p{Cc}\p{Cf}]/gu, '').trim().slice(0, 80).toWellFormed()
        : '';
      return {accountId, groupId, revision, ...(groupName ? {groupName} : {})};
    } catch (error) {
      throw new MediaError(error?.code === 'aborted' ? 'cancelled' : error?.code);
    }
  }

  async sendGroupRecord(groupId, wavBytes, ticketId, signal, {assertCurrent = () => {}} = {}) {
    return this.#sendGroupMedia(groupId, wavBytes, ticketId, signal, assertCurrent, 'record');
  }

  async sendGroupImage(groupId, pngBytes, ticketId, signal, {assertCurrent = () => {}, scopeId, caption} = {}) {
    return this.#sendGroupMedia(groupId, pngBytes, ticketId, signal, assertCurrent, 'image', scopeId, caption);
  }

  async #sendGroupMedia(groupId, bytes, ticketId, signal, assertCurrent, kind, scopeId, caption) {
    const record = kind === 'record', MediaError = record ? QQVoiceError : QQMediaError;
    let submitted = false;
    try {
      if (typeof ticketId !== 'string' || !ticketId.trim() || ticketId.length > 128 ||
          /[\p{Cc}\p{Cf}]/u.test(ticketId)) throw new MediaError('invalid_request');
      let params;
      if (record) params = groupRecordParams(groupId, bytes);
      else {
        if (!this.groupIds.has(groupId)) throw new MediaError('group_unavailable');
        validateImagePayload(bytes);
        params = {group_id:Number(groupId), message:[{type:'image', data:{file:`base64://${bytes.toString('base64')}`}},...photoCaption(caption)]};
      }
      const {check} = await this._authenticateGroupMediaTarget(groupId, signal, assertCurrent);
      check();
      // The caller has consumed the single-use ticket. Issue one native write.
      // A missing or invalid receipt never authorizes another bridge action.
      const receipt = await this._request('send_group_msg', params, undefined, () => {submitted = true;});
      const messageId = eventId(receipt?.message_id);
      if (!messageId) throw new MediaError('send_unknown');
      // A matched receipt remains accepted when the desktop context changed.
      // Only a still-current scope may leave an ephemeral quote marker.
      try {
        check();
        this.recordGroupReference(groupId, messageId, record ? 'self_voice' : 'self_image');
        if (!record) this.#rememberGroupSentImage(groupId, messageId, scopeId, params.message[0].data.file);
      } catch { /* No continuation evidence outside the original scope. */ }
      return {outcome: 'accepted', messageId};
    } catch (error) {
      if (submitted && error?.rejectedBeforeAction === true) return {outcome:'not_sent', code:'send_rejected'};
      const code = new MediaError(error?.code === 'aborted' ? 'cancelled' : error?.code).code;
      return {outcome: submitted ? 'unknown' : 'not_sent', code: submitted ? 'send_unknown' : code};
    }
  }

  async publishQzoneText(text, {audience = 'self', clientId = randomUUID()} = {}, signal) {
    socialText(text); socialId(clientId);
    if (!['owner', 'self'].includes(audience)) throw new QQError('invalid_social_audience');
    const {assertCurrent} = await this._socialAccount(signal);
    // NapCat 4.18.42 SendQzoneMsg: 16 = selected friends, 64 = self.
    // Never omit ugc_right: upstream defaults to 1 (public). Publishing is one
    // request; no downgrade/retry to a wider audience on bridge failure.
    const params = {content: text, ugc_right: audience === 'owner' ? 16 : 64,
      ...(audience === 'owner' ? {target_uins: [this.ownerId]} : {})};
    const data = await this._request('send_qzone_msg', params, signal);
    assertCurrent();
    let id;
    try { id = socialId(data?.tid); } catch { throw new QQError('invalid_send_receipt'); }
    if (!Number.isSafeInteger(data?.time) || data.time < 0) throw new QQError('invalid_send_receipt');
    // A write receipt confirms the bridge response, not recipient visibility.
    return {id, clientId, time: data.time, audience, visibilityVerified: false};
  }

  async getOwnQzonePost(id, signal) {
    socialId(id);
    const {accountId, assertCurrent} = await this._socialAccount(signal);
    const data = await this._request('get_qzone_msg_detail', {tid: id, target_uin: accountId, pos: 0, num: 1}, signal);
    assertCurrent();
    if (data?.tid !== id || typeof data.content !== 'string' || data.content.length > MAX_SOCIAL_TEXT) throw new QQError('invalid_post_receipt');
    // Keep social-feed comments and other people's data out of the app's result.
    return {id, text: data.content};
  }

  close() {
    this.closed = true;
    this._drop(new QQError('closed'));
  }
}

module.exports = {QQClient, QQError, DEFAULT_QQ_URL, validateQQUrl, validateQQOwner, prepareQQInbound};
