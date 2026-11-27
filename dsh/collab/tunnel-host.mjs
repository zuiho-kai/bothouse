// #2314 item 2.4: host-side community tunnel relay channel.
//
// Outbound WebSocket connection, challenge-response auth and exponential reconnect backoff
// (capped at 30 s, minute-level backoff on quota/block) follow Kooyu
// packages/host/src/devices/relay.ts#L330-L452 (commit e33137b, MIT License,
// Copyright (c) Kooyu contributors).
import { EventEmitter } from 'node:events';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { Readable } from 'node:stream';
import { savePrivateJSON } from './tunnel-identity.mjs';
import {
  ReplayGuard,
  TunnelCryptoError,
  createResponseSealer,
  openRequest,
} from './tunnel-crypto.mjs';
import { normalizeRelayUrl } from './tunnel-link.mjs';

const CHALLENGE_PREFIX = 'bothouse-tunnel-relay-v1:';
const MAX_IN_FLIGHT = 128;
const MAX_WS_BUFFER = 4 * 1024 * 1024;
const HANDSHAKE_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_RECONNECT_MS = 30_000;
const DEFAULT_LIMITED_BACKOFF_MS = 60_000;
const DEFAULT_BLOCKED_BACKOFF_MS = 5 * 60_000;

function loadWebSocket() {
  const mod = createRequire(import.meta.url)('ws');
  return mod.WebSocket ?? mod;
}

/**
 * In-memory IncomingMessage + ServerResponse bridge feeding one decrypted tunnel request
 * directly into pairing.mjs's dispatchHostRequest() and streaming encrypted records back over WS.
 */
function createVirtualExchange(decoded, { sendFrame, replyKey, aad, onFinish }) {
  const req = new Readable({ read() {} });
  req.method = decoded.method;
  req.url = decoded.path;
  req.headers = { ...decoded.headers };
  req.socket = { remoteAddress: 'tunnel' };
  if (decoded.body && decoded.body.length > 0) req.push(decoded.body);
  req.push(null);

  const sealer = createResponseSealer(replyKey, aad);
  const resHeaders = new Map();
  let headSent = false;
  let canceled = false;

  const res = new EventEmitter();
  res.statusCode = 200;
  res.headersSent = false;
  res.writableEnded = false;
  res.destroyed = false;

  res.setHeader = (name, value) => {
    resHeaders.set(String(name).toLowerCase(), value);
  };
  res.getHeader = (name) => resHeaders.get(String(name).toLowerCase());
  res.removeHeader = (name) => { resHeaders.delete(String(name).toLowerCase()); };
  res.getHeaders = () => Object.fromEntries(resHeaders.entries());

  const ensureHead = () => {
    if (headSent || res.destroyed || canceled) return;
    headSent = true;
    res.headersSent = true;
    const headersObj = {};
    for (const [k, v] of resHeaders) headersObj[k] = v;
    const okOuter = sendFrame({ type: 'head', status: 200 });
    const headRec = sealer.sealHead({ status: res.statusCode, headers: headersObj });
    const okRec = okOuter && sendFrame({ type: 'chunk', data: headRec.toString('base64') });
    if (!okRec) abortFromTransport();
  };

  res.writeHead = (status, reasonOrHeaders, maybeHeaders) => {
    if (headSent) return res;
    res.statusCode = status;
    const hdrs = typeof reasonOrHeaders === 'object' && reasonOrHeaders !== null
      ? reasonOrHeaders
      : (typeof maybeHeaders === 'object' && maybeHeaders !== null ? maybeHeaders : undefined);
    if (hdrs) {
      for (const [k, v] of Object.entries(hdrs)) {
        if (v !== undefined) resHeaders.set(String(k).toLowerCase(), v);
      }
    }
    ensureHead();
    return res;
  };

  res.flushHeaders = () => { ensureHead(); };

  res.write = (chunk, encoding) => {
    if (res.destroyed || res.writableEnded || canceled) return false;
    ensureHead();
    if (res.destroyed || canceled) return false;
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), typeof encoding === 'string' ? encoding : 'utf8');
    if (buf.length === 0) return true;
    const frames = sealer.sealData(buf);
    for (const f of frames) {
      if (!sendFrame({ type: 'chunk', data: f.toString('base64') })) {
        abortFromTransport();
        return false;
      }
    }
    return true;
  };

  res.end = (chunk, encoding, cb) => {
    const callback = typeof chunk === 'function' ? chunk : typeof encoding === 'function' ? encoding : cb;
    if (res.destroyed || res.writableEnded) {
      if (typeof callback === 'function') callback();
      return res;
    }
    if (chunk !== undefined && chunk !== null && typeof chunk !== 'function') {
      res.write(chunk, typeof encoding === 'string' ? encoding : 'utf8');
    } else {
      ensureHead();
    }
    if (!res.destroyed && !canceled) {
      const endRec = sealer.sealEnd();
      sendFrame({ type: 'chunk', data: endRec.toString('base64') });
      sendFrame({ type: 'end' });
    }
    res.writableEnded = true;
    onFinish();
    res.emit('finish');
    res.emit('close');
    req.emit('close');
    if (typeof callback === 'function') callback();
    return res;
  };

  // Called by PairHost.drop() when the host revokes a device mid-stream, or on internal error.
  res.destroy = () => {
    if (res.destroyed) return res;
    res.destroyed = true;
    if (!res.writableEnded && !canceled) {
      if (headSent) sendFrame({ type: 'end' }); // truncated without RECORD_END -> closes client SSE at once
      else sendFrame({ type: 'error' });
    }
    onFinish();
    res.emit('close');
    req.destroy();
    return res;
  };

  // Called when the relay sends { type: 'cancel', id } or WS drops: stop locally without extra frames.
  const abortFromTransport = () => {
    if (canceled) return;
    canceled = true;
    res.destroyed = true;
    onFinish();
    res.emit('close');
    req.destroy();
  };

  return { req, res, cancel: abortFromTransport };
}

/**
 * Host-side tunnel channel: maintains a single outbound WebSocket to the configured relay,
 * authenticates with the machine's Ed25519 identity + signed X25519 encryption key, and
 * dispatches decrypted /collab/* envelopes into the same handler Tailscale uses.
 */
export class TunnelHost {
  constructor({
    configFile,
    identity,
    dispatch,
    logger,
    now = Date.now,
    WebSocketImpl,
    allowLoopback = true,
    baseReconnectMs = 500,
    maxReconnectMs = DEFAULT_MAX_RECONNECT_MS,
    limitedBackoffMs = DEFAULT_LIMITED_BACKOFF_MS,
    blockedBackoffMs = DEFAULT_BLOCKED_BACKOFF_MS,
  }) {
    this.configFile = configFile;
    this.identity = identity;
    this.dispatch = dispatch;
    this.logger = logger;
    this.now = now;
    this.WebSocketImpl = WebSocketImpl ?? loadWebSocket();
    this.allowLoopback = allowLoopback;
    this.baseReconnectMs = baseReconnectMs;
    this.maxReconnectMs = maxReconnectMs;
    this.limitedBackoffMs = limitedBackoffMs;
    this.blockedBackoffMs = blockedBackoffMs;

    this.replayGuard = new ReplayGuard();
    this.inFlight = new Map();
    this.ws = undefined;
    this.retryTimer = undefined;
    this.handshakeTimer = undefined;
    this.stopped = false;
    this.attempts = 0;
    this.state = 'unconfigured';
    this.error = null;
    this.retryAt = null;
    this._waiters = new Set();

    this.relayUrl = '';
    this.admissionCode = '';
    this._loadConfig();
  }

  _loadConfig() {
    if (!this.configFile || !existsSync(this.configFile)) return;
    try {
      const saved = JSON.parse(readFileSync(this.configFile, 'utf8'));
      if (typeof saved?.relayUrl === 'string' && saved.relayUrl.trim()) {
        this.relayUrl = normalizeRelayUrl(saved.relayUrl, { allowLoopback: this.allowLoopback });
        this.admissionCode = typeof saved.admissionCode === 'string' ? saved.admissionCode : '';
        this.state = 'disconnected';
      }
    } catch (err) {
      this.logger?.warn?.('conest-collab: tunnel config ignored: %s', err?.message ?? err);
    }
  }

  _saveConfig() {
    if (!this.configFile) return;
    if (!this.relayUrl) {
      try { rmSync(this.configFile, { force: true }); } catch { /* ignore */ }
      return;
    }
    savePrivateJSON(this.configFile, {
      relayUrl: this.relayUrl,
      ...(this.admissionCode ? { admissionCode: this.admissionCode } : {}),
    });
  }

  get configured() { return Boolean(this.relayUrl); }
  get connected() { return this.state === 'connected'; }

  /** Update relay URL and optional admission code; immediately reconnects (or stops if cleared). */
  async configure({ relayUrl, admissionCode, clearAdmission = false } = {}) {
    const raw = String(relayUrl ?? '').trim();
    if (!raw) {
      this.relayUrl = '';
      this.admissionCode = '';
      this._saveConfig();
      this._disconnectSocket();
      this.state = 'unconfigured';
      this.error = null;
      this.retryAt = null;
      this.attempts = 0;
      this._notifyWaiters();
      return this.status();
    }
    const normalized = normalizeRelayUrl(raw, { allowLoopback: this.allowLoopback });
    const urlChanged = normalized !== this.relayUrl;
    this.relayUrl = normalized;
    if (clearAdmission) {
      this.admissionCode = '';
    } else if (typeof admissionCode === 'string') {
      const trimmed = admissionCode.trim();
      if (trimmed !== '') this.admissionCode = trimmed;
      else if (urlChanged) this.admissionCode = '';
    }
    this._saveConfig();
    this.stopped = false;
    this.attempts = 0;
    this.error = null;
    this.retryAt = null;
    this._disconnectSocket();
    this._connect();
    return this.status();
  }

  /** Wait until connected, blocked/limited/errored after handshake, or timeout. */
  waitForSettled(timeoutMs = 5000) {
    if (this.state === 'connected' || this.state === 'blocked' || this.state === 'limited' || this.state === 'unconfigured') {
      return Promise.resolve(this.status());
    }
    return new Promise(resolve => {
      const timer = setTimeout(() => {
        this._waiters.delete(done);
        resolve(this.status());
      }, timeoutMs);
      timer.unref?.();
      const done = () => {
        if (this.state === 'connecting') return;
        clearTimeout(timer);
        this._waiters.delete(done);
        resolve(this.status());
      };
      this._waiters.add(done);
    });
  }

  _notifyWaiters() {
    for (const fn of [...this._waiters]) fn();
  }

  start() {
    this.stopped = false;
    if (!this.relayUrl) {
      this.state = 'unconfigured';
      return;
    }
    if (!this.ws && !this.retryTimer) this._connect();
  }

  async stop() {
    this.stopped = true;
    this._disconnectSocket();
    if (this.relayUrl) this.state = 'disconnected';
    this._notifyWaiters();
  }

  status() {
    const id = this.configured ? this.identity.peek() ?? this.identity.ensure() : this.identity.peek();
    return {
      channel: 'tunnel',
      configured: this.configured,
      relay_url: this.relayUrl || null,
      has_admission_code: Boolean(this.admissionCode),
      host_id: id?.hostId ?? null,
      fingerprint: id ? this.identity.fingerprint : null,
      state: this.state,
      error: this.error,
      retry_at: this.retryAt,
    };
  }

  _disconnectSocket() {
    clearTimeout(this.retryTimer);
    clearTimeout(this.handshakeTimer);
    this.retryTimer = undefined;
    this.handshakeTimer = undefined;
    const ws = this.ws;
    this.ws = undefined;
    if (ws) {
      try { ws.close(1000, 'closing'); } catch { /* ignore */ }
    }
    for (const active of [...this.inFlight.values()]) active.cancel();
    this.inFlight.clear();
  }

  _send(ws, msg) {
    if (ws !== this.ws || ws.readyState !== 1 /* OPEN */) return false;
    if (msg.type !== 'end' && msg.type !== 'error' && ws.bufferedAmount > MAX_WS_BUFFER) return false;
    try {
      ws.send(JSON.stringify(msg));
      return true;
    } catch {
      return false;
    }
  }

  _connect() {
    if (this.stopped || !this.relayUrl || this.ws) return;
    this.state = 'connecting';
    this.retryAt = null;
    const bundle = this.identity.encryptionBundle();
    const wsUrl = new URL('/v1/host', this.relayUrl);
    wsUrl.protocol = wsUrl.protocol === 'https:' ? 'wss:' : 'ws:';

    let ws;
    try {
      // Do NOT send an Origin header: tunnel-relay refuses upgrades carrying Origin (#2314 1.2).
      ws = new this.WebSocketImpl(wsUrl.toString());
    } catch (err) {
      this.state = 'error';
      this.error = `连不上中继：${err?.message ?? err}`;
      this._scheduleRetry(false);
      this._notifyWaiters();
      return;
    }
    this.ws = ws;
    let authed = false;
    let lastErrorMessage = null;

    this.handshakeTimer = setTimeout(() => {
      if (this.ws === ws && !authed) {
        lastErrorMessage = '连接中继握手超时';
        try { ws.close(4008, 'Handshake timeout'); } catch { /* ignore */ }
      }
    }, HANDSHAKE_TIMEOUT_MS);
    this.handshakeTimer.unref?.();

    ws.on('error', (err) => {
      if (this.ws !== ws) return;
      lastErrorMessage = `连不上中继：${err?.message || '网络不可达'}`;
    });

    ws.on('message', (raw, isBinary) => {
      if (this.ws !== ws) return;
      try {
        if (isBinary) throw new Error('binary frame not supported');
        const m = JSON.parse(raw.toString());
        if (m.type === 'challenge' && !authed) {
          if (typeof m.challenge !== 'string' || !m.challenge.startsWith(CHALLENGE_PREFIX) || m.challenge.length > 160) {
            throw new Error('invalid challenge');
          }
          const signature = this.identity.signChallenge(m.challenge);
          const payload = {
            type: 'authenticate',
            publicKey: bundle.publicKey,
            signature,
            encKey: bundle.encKey,
            encKeySig: bundle.encKeySig,
            ...(this.admissionCode ? { admission: this.admissionCode } : {}),
          };
          this._send(ws, payload);
        } else if (m.type === 'ready' && !authed) {
          if (m.hostId !== bundle.hostId) throw new Error('hostId mismatch');
          clearTimeout(this.handshakeTimer);
          this.handshakeTimer = undefined;
          authed = true;
          this.attempts = 0;
          this.state = 'connected';
          this.error = null;
          this.retryAt = null;
          this.logger?.info?.('conest-collab: tunnel relay connected (%s)', this.relayUrl);
          this._notifyWaiters();
        } else if (m.type === 'relay.error') {
          lastErrorMessage = typeof m.message === 'string' ? m.message.slice(0, 300) : '中继返回错误';
          if (m.code === 'RELAY_QUOTA_EXCEEDED' || m.code === 'RATE_LIMITED') {
            this.state = 'limited';
            this.error = lastErrorMessage;
          } else if (m.code === 'IDENTITY_REVOKED' || m.code === 'BLOCKED') {
            this.state = 'blocked';
            this.error = lastErrorMessage;
          }
        } else if (authed && m.type === 'request') {
          this._handleRequest(ws, m);
        } else if (authed && m.type === 'cancel') {
          this.inFlight.get(m.id)?.cancel();
        }
      } catch (err) {
        lastErrorMessage = `中继协议异常：${err?.message ?? err}`;
        try { ws.close(4008, 'Invalid protocol'); } catch { /* ignore */ }
      }
    });

    ws.on('close', (code, reasonBuf) => {
      if (this.ws !== ws) return;
      clearTimeout(this.handshakeTimer);
      this.handshakeTimer = undefined;
      this.ws = undefined;
      for (const active of [...this.inFlight.values()]) active.cancel();
      this.inFlight.clear();
      if (this.stopped || !this.relayUrl) return;

      const reason = Buffer.isBuffer(reasonBuf) ? reasonBuf.toString('utf8') : String(reasonBuf ?? '');
      if (code === 4403 || this.state === 'blocked') {
        this.state = 'blocked';
        this.error = reason && /admission/i.test(reason)
          ? '中继需要准入码，或填写的准入码不对'
          : (this.error || '此电脑被中继拒绝接入（准入码不对或已被封禁）');
        this._scheduleRetry('blocked');
      } else if (code === 4429 || this.state === 'limited') {
        this.state = 'limited';
        this.error = this.error || '中继配额已满或触发限流，稍后自动重试';
        this._scheduleRetry('limited');
      } else if (code === 1013) {
        this.state = 'error';
        this.error = '中继已满员或同一身份已在线，稍后自动重试';
        this._scheduleRetry('normal');
      } else {
        this.state = 'error';
        this.error = lastErrorMessage || (reason ? `与中继断开：${reason}` : '与中继断开，正在重试');
        this._scheduleRetry('normal');
      }
      this._notifyWaiters();
    });
  }

  _scheduleRetry(kind) {
    if (this.stopped || !this.relayUrl || this.retryTimer) return;
    let delay;
    if (kind === 'blocked') {
      delay = this.blockedBackoffMs;
    } else if (kind === 'limited') {
      delay = this.limitedBackoffMs;
    } else {
      const exp = Math.min(this.maxReconnectMs, this.baseReconnectMs * (2 ** Math.min(this.attempts++, 6)));
      const jitter = Math.floor(Math.random() * Math.min(300, exp * 0.2));
      delay = Math.min(this.maxReconnectMs, exp + jitter);
    }
    this.retryAt = this.now() + delay;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = undefined;
      this._connect();
    }, delay);
    this.retryTimer.unref?.();
  }

  async _handleRequest(ws, frame) {
    const id = frame?.id;
    if (typeof id !== 'string' || !id || id.length > 64 || typeof frame?.body !== 'string') return;
    if (this.inFlight.has(id) || this.inFlight.size >= MAX_IN_FLIGHT) {
      this._send(ws, { type: 'error', id });
      return;
    }

    let opened;
    try {
      const envelope = JSON.parse(Buffer.from(frame.body, 'base64').toString('utf8'));
      opened = openRequest(envelope, {
        privateKey: this.identity.x25519PrivateKey,
        replayGuard: this.replayGuard,
        now: this.now,
      });
    } catch (err) {
      const status = err instanceof TunnelCryptoError ? err.status : 401;
      const code = err instanceof TunnelCryptoError ? err.code : 'ENVELOPE_INVALID';
      const message = err instanceof TunnelCryptoError ? err.message : '加密请求无效';
      const payload = Buffer.from(JSON.stringify({ error: message, code }), 'utf8');
      this._send(ws, { type: 'head', id, status });
      this._send(ws, { type: 'chunk', id, data: payload.toString('base64') });
      this._send(ws, { type: 'end', id });
      return;
    }

    const sendFrame = (msg) => this._send(ws, { ...msg, id });
    const active = createVirtualExchange(opened.request, {
      sendFrame,
      replyKey: opened.replyKey,
      aad: opened.aad,
      onFinish: () => { this.inFlight.delete(id); },
    });
    this.inFlight.set(id, active);

    try {
      await this.dispatch(active.req, active.res, { channel: 'tunnel', peer: 'tunnel', allowBrowser: false });
    } catch {
      if (!active.res.headersSent && !active.res.destroyed) {
        active.res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' });
        active.res.end(JSON.stringify({ error: 'internal error' }));
      } else {
        active.res.destroy();
      }
    }
  }
}
