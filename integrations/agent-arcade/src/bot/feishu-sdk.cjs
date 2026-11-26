'use strict';

// Official SDK transport, deliberately below its high-level Channel policy and
// outbound retry layer. Only these fixed enterprise-bot operations are exposed.
const ORIGIN = 'https://open.feishu.cn';
const PATHS = new Set(['/open-apis/auth/v3/tenant_access_token/internal',
  '/callback/ws/endpoint', '/open-apis/bot/v3/info', '/open-apis/im/v1/messages']);
const silentLogger = Object.freeze(Object.fromEntries(['trace','debug','info','warn','error'].map(k => [k, () => {}])));

function sdkError(code, submitted = false) {
  return Object.assign(new Error(`Feishu transport failed (${code}).`), {code, submitted});
}

function createFeishuSDKTransport({appId, appSecret, onEvent, onState, timeoutMs = 15000,
  sdk = require('@larksuiteoapi/node-sdk')} = {}) {
  const lifetime = new AbortController();
  let closed = false, ws, started = false, settleStart;
  // The SDK asks this instance for token and endpoint discovery too. Bound all
  // HTTP work, suppress raw SDK logs, and never follow an HTTP redirect carrying
  // application credentials. No renderer-supplied URL enters this transport.
  const request = config => {
    if (closed) return Promise.reject(sdkError('closed'));
    let url;
    try { url = new URL(config.url); } catch { return Promise.reject(sdkError('invalid_response')); }
    if (url.origin !== ORIGIN || !PATHS.has(url.pathname) || url.username || url.password || url.hash || url.search) {
      return Promise.reject(sdkError('invalid_response'));
    }
    const {arcadeGuard, ...safe} = config;
    try { arcadeGuard?.(); } catch (error) { return Promise.reject(error); }
    const signal = config.signal ? AbortSignal.any([lifetime.signal, config.signal]) : lifetime.signal;
    if (signal.aborted) return Promise.reject(sdkError('aborted'));
    return sdk.defaultHttpInstance.request({...safe, signal, timeout: timeoutMs,
      maxRedirects: 0, maxContentLength: 1024 * 1024, maxBodyLength: 65536});
  };
  const http = {request, get: (url, options = {}) => request({...options, url, method: 'GET'}),
    post: (url, data, options = {}) => request({...options, url, data, method: 'POST'})};
  // Avoid the SDK's process-global default token cache across companion services.
  const cache = new sdk.DefaultCache();
  const base = {appId, appSecret, appType: sdk.AppType.SelfBuild, domain: sdk.Domain.Feishu, cache,
    logger: silentLogger, loggerLevel: sdk.LoggerLevel.error, httpInstance: http};
  const client = new sdk.Client(base);
  const dispatcher = new sdk.EventDispatcher({cache, logger: silentLogger, loggerLevel: sdk.LoggerLevel.error})
    .register({'im.message.receive_v1': event => { if (!closed) onEvent(event); }});
  ws = new sdk.WSClient({...base, autoReconnect: true, handshakeTimeoutMs: timeoutMs,
    onReady: () => { if (!closed) { settleStart?.(); onState('connected'); } },
    onReconnected: () => { if (!closed) onState('connected'); },
    onReconnecting: () => { if (!closed) onState('reconnecting'); },
    onError: () => { if (!closed) { settleStart?.(sdkError('connection_failed')); onState('failed'); } }});
  return {
    async botInfo(signal) {
      return client.request({url: '/open-apis/bot/v3/info', method: 'GET', signal});
    },
    start(signal) {
      if (closed) return Promise.reject(sdkError('closed'));
      if (started) return Promise.reject(sdkError('operation_in_progress'));
      started = true;
      return new Promise((resolve, reject) => {
        const abort = () => finish(sdkError('aborted'));
        const timer = setTimeout(() => finish(sdkError('timeout')), timeoutMs);
        const finish = error => {
          if (settleStart !== finish) return;
          clearTimeout(timer); signal?.removeEventListener('abort', abort); settleStart = null;
          if (error) reject(error); else resolve();
        };
        settleStart = finish;
        signal?.addEventListener('abort', abort, {once: true});
        if (signal?.aborted) return abort();
        // start() itself returns before handshake: only onReady proves it.
        Promise.resolve(ws.start({eventDispatcher: dispatcher})).catch(() => finish(sdkError('connection_failed')));
      });
    },
    state() { return closed ? 'closed' : ws.getConnectionStatus().state; },
    async sendText({ownerId, text, uuid, assertCurrent, signal}) {
      let submitted = false;
      try {
        return await client.request({url: '/open-apis/im/v1/messages', method: 'POST',
          params: {receive_id_type: 'open_id'},
          data: {receive_id: ownerId, msg_type: 'text', content: JSON.stringify({text}), uuid}, signal,
          // Client.request may first await a token. Check the original binding
          // again at the last synchronous point before the actual message POST.
          arcadeGuard: () => { assertCurrent(); submitted = true; }});
      } catch (error) {
        throw sdkError(submitted ? 'send_unknown' : signal?.aborted ? 'aborted' :
          ['closed','stale_context','disconnected'].includes(error?.code) ? error.code : 'send_not_submitted', submitted);
      }
    },
    close() {
      if (closed) return;
      closed = true; lifetime.abort(); settleStart?.(sdkError('closed'));
      // Official SDK close invalidates reconnect generations and clears its
      // timers/cache; force also terminates an in-flight WebSocket handshake.
      ws.close({force: true});
    }
  };
}

module.exports = {createFeishuSDKTransport};
