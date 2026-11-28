// #2314 item 2.3: end-to-end encrypted request envelopes and chunked streaming responses over
// an untrusted community tunnel relay.
//
// Envelope construction (ephemeral X25519 + HKDF-SHA256 + AES-256-GCM, separate request/reply
// key halves, 120 s expiry, replay guard, authenticated streaming records with explicit END)
// adapted from Kooyu packages/host/src/devices/secure-channel.ts (commit e33137b, MIT License,
// Copyright (c) Kooyu contributors).
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createPublicKey,
  diffieHellman,
  generateKeyPairSync,
  hkdfSync,
  randomBytes,
  sign,
  verify,
} from 'node:crypto';
import { computeHostId } from './tunnel-identity.mjs';

export const ENVELOPE_DOMAIN = 'bothouse-tunnel-v1';
export const ENVELOPE_TTL_MS = 120_000;
export const DEFAULT_SEAL_TTL_MS = 90_000;
export const MAX_RECORD_CHUNK = 48 * 1024;
export const MAX_RECORD_CIPHERTEXT = 256 * 1024;
export const RECORD_HEAD = 1;
export const RECORD_DATA = 2;
export const RECORD_END = 3;

const ALLOWED_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD']);

export class TunnelCryptoError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

/** Validate that an inner request path stays strictly inside /collab or /collab/*. */
export function validateTunnelPath(rawPath) {
  if (typeof rawPath !== 'string' || rawPath.length === 0 || rawPath.length > 8192) {
    throw new TunnelCryptoError('INVALID_PATH', '加密请求路径无效', 400);
  }
  if (!rawPath.startsWith('/')) {
    throw new TunnelCryptoError('INVALID_PATH', '加密请求路径无效', 400);
  }
  let target;
  try {
    target = new URL(rawPath, 'http://localhost');
  } catch {
    throw new TunnelCryptoError('INVALID_PATH', '加密请求路径无效', 400);
  }
  if (target.origin !== 'http://localhost' || (target.pathname !== '/collab' && !target.pathname.startsWith('/collab/'))) {
    throw new TunnelCryptoError('INVALID_PATH', '加密请求路径必须以 /collab/ 开头', 400);
  }
  return target.pathname + target.search;
}

/** In-memory anti-replay tracker keyed by sha256(aad), pruned by envelope expiry. */
export class ReplayGuard {
  constructor({ maxEntries = 20_000 } = {}) {
    this.seen = new Map();
    this.maxEntries = maxEntries;
  }

  /** Record `id` with `expires`; returns false if already seen (replay). */
  checkAndMark(id, expires, now = Date.now()) {
    for (const [k, exp] of this.seen) {
      if (exp < now) this.seen.delete(k);
    }
    if (this.seen.has(id)) return false;
    if (this.seen.size >= this.maxEntries) {
      const oldest = this.seen.keys().next().value;
      if (oldest !== undefined) this.seen.delete(oldest);
    }
    this.seen.set(id, expires);
    return true;
  }
}

function buildAAD(ephemeral, nonce, expires, clientId = '') {
  return Buffer.from(
    clientId
      ? `${ENVELOPE_DOMAIN}:${ephemeral}:${nonce}:${expires}:${clientId}`
      : `${ENVELOPE_DOMAIN}:${ephemeral}:${nonce}:${expires}`,
    'utf8',
  );
}

function deriveKeys(shared, nonceBuf, aad) {
  const material = Buffer.from(hkdfSync('sha256', shared, nonceBuf, aad, 64));
  return {
    reqKey: material.subarray(0, 32),
    replyKey: material.subarray(32, 64),
  };
}

function toX25519PublicKey(keyOrBase64) {
  const key = typeof keyOrBase64 === 'string'
    ? createPublicKey({ key: Buffer.from(keyOrBase64, 'base64'), format: 'der', type: 'spki' })
    : keyOrBase64;
  if (key.asymmetricKeyType !== 'x25519') {
    throw new TunnelCryptoError('ENVELOPE_INVALID', '对方加密公钥不是 X25519', 401);
  }
  return key;
}

/**
 * Controller side: seal an inner HTTP request into an end-to-end encrypted envelope.
 * When `clientIdentity` ({ publicKey, privateKey|signChallenge }) is supplied, binds the
 * controller's Ed25519 identity into AAD and signs the outer envelope so the host can verify
 * paired keys and drop unpaired requests BEFORE decryption.
 */
export function sealRequest({
  encKey,
  clientIdentity,
  method = 'GET',
  path,
  headers = {},
  body,
  now = Date.now,
  ttlMs = DEFAULT_SEAL_TTL_MS,
  ephemeralKeyPair,
  nonce,
}) {
  const normalizedMethod = String(method).toUpperCase();
  if (!ALLOWED_METHODS.has(normalizedMethod)) {
    throw new TunnelCryptoError('INVALID_METHOD', '不支持的请求方法', 400);
  }
  const normalizedPath = validateTunnelPath(path);
  const hostPub = toX25519PublicKey(encKey);
  const eph = ephemeralKeyPair ?? generateKeyPairSync('x25519');
  const ephemeral = eph.publicKey.export({ format: 'der', type: 'spki' }).toString('base64');
  const nonceBuf = nonce ? Buffer.from(nonce) : randomBytes(12);
  if (nonceBuf.length !== 12) throw new TunnelCryptoError('ENVELOPE_INVALID', 'nonce 必须是 12 字节', 400);
  const nonceB64 = nonceBuf.toString('base64');
  const expires = Math.trunc((typeof now === 'function' ? now() : now) + ttlMs);

  let clientKey;
  let clientId = '';
  if (clientIdentity) {
    clientKey = clientIdentity.publicKey;
    clientId = clientIdentity.hostId ?? computeHostId(clientKey);
  }
  const aad = buildAAD(ephemeral, nonceB64, expires, clientId);
  let clientSig;
  if (clientIdentity) {
    clientSig = typeof clientIdentity.signChallenge === 'function'
      ? clientIdentity.signChallenge(aad.toString('utf8'))
      : sign(null, aad, clientIdentity.privateKey).toString('base64');
  }

  const shared = diffieHellman({ privateKey: eph.privateKey, publicKey: hostPub });
  const { reqKey, replyKey } = deriveKeys(shared, nonceBuf, aad);

  const cleanHeaders = {};
  for (const [k, v] of Object.entries(headers ?? {})) {
    if (v === undefined || v === null) continue;
    cleanHeaders[String(k).toLowerCase()] = Array.isArray(v) ? v.join(', ') : String(v);
  }
  const bodyBuf = body === undefined || body === null ? Buffer.alloc(0)
    : Buffer.isBuffer(body) ? body
    : typeof body === 'string' ? Buffer.from(body, 'utf8')
    : Buffer.from(body);

  const inner = {
    method: normalizedMethod,
    path: normalizedPath,
    headers: cleanHeaders,
    ...(bodyBuf.length > 0 ? { body: bodyBuf.toString('base64') } : {}),
  };
  const enc = createCipheriv('aes-256-gcm', reqKey, nonceBuf);
  enc.setAAD(aad);
  const ciphertext = Buffer.concat([
    enc.update(JSON.stringify(inner), 'utf8'),
    enc.final(),
    enc.getAuthTag(),
  ]).toString('base64');

  return {
    envelope: {
      v: 1,
      ephemeral,
      nonce: nonceB64,
      expires,
      ...(clientKey ? { clientKey, clientSig } : {}),
      ciphertext,
    },
    aad,
    replyKey,
    clientId,
  };
}

/**
 * Host pre-decryption gate: verify outer envelope fields, expiry, and the controller's Ed25519
 * public key + signature over AAD BEFORE performing X25519 DH or AES-256-GCM decryption.
 * Returns `{ clientId, clientPublicKey, aad }` so the host can check its paired-key whitelist
 * and immediately drop unpaired callers.
 */
export function verifyEnvelopeClient(envelope, { now = Date.now, maxTtlMs = ENVELOPE_TTL_MS } = {}) {
  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) {
    throw new TunnelCryptoError('ENVELOPE_INVALID', '加密信封格式无效', 401);
  }
  const { v, ephemeral, nonce, expires, ciphertext, clientKey, clientSig } = envelope;
  if (
    v !== 1 ||
    typeof ephemeral !== 'string' || ephemeral.length === 0 || ephemeral.length > 128 ||
    typeof nonce !== 'string' || nonce.length === 0 || nonce.length > 32 ||
    !Number.isSafeInteger(expires) ||
    typeof ciphertext !== 'string' || ciphertext.length === 0 || ciphertext.length > 1_400_000
  ) {
    throw new TunnelCryptoError('ENVELOPE_INVALID', '加密信封字段无效', 401);
  }
  const current = typeof now === 'function' ? now() : now;
  if (expires < current || expires > current + maxTtlMs) {
    throw new TunnelCryptoError('ENVELOPE_EXPIRED', '加密请求已过期', 409);
  }
  if (typeof clientKey !== 'string' || clientKey.length === 0 || clientKey.length > 256 ||
      typeof clientSig !== 'string' || clientSig.length === 0 || clientSig.length > 128) {
    throw new TunnelCryptoError('CLIENT_SIG_INVALID', '缺少来访设备公钥或签名，已拒绝', 401);
  }
  let clientId;
  let edPub;
  try {
    clientId = computeHostId(clientKey);
    edPub = createPublicKey({ key: Buffer.from(clientKey, 'base64'), format: 'der', type: 'spki' });
  } catch {
    throw new TunnelCryptoError('CLIENT_SIG_INVALID', '来访设备公钥格式无效', 401);
  }
  const aad = buildAAD(ephemeral, nonce, expires, clientId);
  let sigOk = false;
  try {
    sigOk = verify(null, aad, edPub, Buffer.from(clientSig, 'base64'));
  } catch {
    sigOk = false;
  }
  if (!sigOk) {
    throw new TunnelCryptoError('CLIENT_SIG_INVALID', '来访设备签名校验失败，已拒绝', 401);
  }
  return { clientId, clientPublicKey: clientKey, aad };
}

/**
 * Host side: decrypt, authenticate, validate expiry & path, and check replay for one envelope.
 * If `requireClientAuth` is true (default when `clientKey` is present, or forced by TunnelHost),
 * verifies the controller's Ed25519 signature over AAD first.
 */
export function openRequest(envelope, {
  privateKey,
  replayGuard,
  now = Date.now,
  maxTtlMs = ENVELOPE_TTL_MS,
  requireClientAuth = false,
}) {
  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) {
    throw new TunnelCryptoError('ENVELOPE_INVALID', '加密信封格式无效', 401);
  }
  const { v, ephemeral, nonce, expires, ciphertext, clientKey } = envelope;
  if (
    v !== 1 ||
    typeof ephemeral !== 'string' || ephemeral.length === 0 || ephemeral.length > 128 ||
    typeof nonce !== 'string' || nonce.length === 0 || nonce.length > 32 ||
    !Number.isSafeInteger(expires) ||
    typeof ciphertext !== 'string' || ciphertext.length === 0 || ciphertext.length > 1_400_000
  ) {
    throw new TunnelCryptoError('ENVELOPE_INVALID', '加密信封字段无效', 401);
  }

  const current = typeof now === 'function' ? now() : now;
  if (expires < current || expires > current + maxTtlMs) {
    throw new TunnelCryptoError('ENVELOPE_EXPIRED', '加密请求已过期', 409);
  }

  let clientId = '';
  let clientPublicKey;
  if (requireClientAuth || clientKey !== undefined) {
    const verified = verifyEnvelopeClient(envelope, { now: current, maxTtlMs });
    clientId = verified.clientId;
    clientPublicKey = verified.clientPublicKey;
  }

  const nonceBuf = Buffer.from(nonce, 'base64');
  const cipherBuf = Buffer.from(ciphertext, 'base64');
  if (nonceBuf.length !== 12 || cipherBuf.length < 17) {
    throw new TunnelCryptoError('ENVELOPE_INVALID', '加密信封校验失败', 401);
  }

  const aad = buildAAD(ephemeral, nonce, expires, clientId);
  let inner;
  let replyKey;
  try {
    const peerPub = createPublicKey({ key: Buffer.from(ephemeral, 'base64'), format: 'der', type: 'spki' });
    if (peerPub.asymmetricKeyType !== 'x25519') throw new Error('bad peer key');
    const shared = diffieHellman({ privateKey, publicKey: peerPub });
    const derived = deriveKeys(shared, nonceBuf, aad);
    replyKey = derived.replyKey;
    const dec = createDecipheriv('aes-256-gcm', derived.reqKey, nonceBuf);
    dec.setAAD(aad);
    dec.setAuthTag(cipherBuf.subarray(-16));
    const plain = Buffer.concat([dec.update(cipherBuf.subarray(0, -16)), dec.final()]).toString('utf8');
    inner = JSON.parse(plain);
  } catch {
    throw new TunnelCryptoError('ENVELOPE_INVALID', '加密请求解密校验失败', 401);
  }

  if (!inner || typeof inner !== 'object' || Array.isArray(inner)) {
    throw new TunnelCryptoError('ENVELOPE_INVALID', '加密请求内容无效', 401);
  }
  const method = String(inner.method ?? '').toUpperCase();
  if (!ALLOWED_METHODS.has(method)) {
    throw new TunnelCryptoError('ENVELOPE_INVALID', '加密请求方法无效', 400);
  }
  const path = validateTunnelPath(inner.path);
  const headers = {};
  if (inner.headers !== undefined) {
    if (typeof inner.headers !== 'object' || inner.headers === null || Array.isArray(inner.headers)) {
      throw new TunnelCryptoError('ENVELOPE_INVALID', '加密请求头无效', 400);
    }
    for (const [k, val] of Object.entries(inner.headers)) {
      if (typeof val === 'string' && val.length <= 16384) headers[k.toLowerCase()] = val;
    }
  }
  if (inner.body !== undefined && typeof inner.body !== 'string') {
    throw new TunnelCryptoError('ENVELOPE_INVALID', '加密请求正文无效', 400);
  }
  const body = inner.body ? Buffer.from(inner.body, 'base64') : Buffer.alloc(0);

  if (replayGuard) {
    const replayId = createHash('sha256').update(aad).digest('hex');
    if (!replayGuard.checkAndMark(replayId, expires, current)) {
      throw new TunnelCryptoError('ENVELOPE_REPLAY', '加密请求重复提交，已拒绝', 409);
    }
  }

  return { request: { method, path, headers, body }, aad, replyKey, clientId, clientPublicKey };
}

function recordIV(seq) {
  const iv = Buffer.alloc(12);
  iv.writeBigUInt64BE(BigInt(seq), 4);
  return iv;
}

/**
 * Host side: encrypt a streaming HTTP response into authenticated sequential records.
 * Record format: [1 byte type][4 byte uint32BE len(ct+tag)][ct][16 byte GCM tag]
 * AAD for each record: concat(requestAAD, 5-byte header); IV = 4 zero bytes || uint64BE(seq).
 */
export function createResponseSealer(replyKey, aad) {
  let seq = 0;
  let ended = false;

  const sealRecord = (type, payloadBuf) => {
    if (ended) throw new TunnelCryptoError('STREAM_ENDED', '应答流已结束', 500);
    const data = Buffer.isBuffer(payloadBuf) ? payloadBuf : Buffer.from(payloadBuf);
    const header = Buffer.alloc(5);
    header[0] = type;
    header.writeUInt32BE(data.length + 16, 1);
    const enc = createCipheriv('aes-256-gcm', replyKey, recordIV(seq++));
    enc.setAAD(Buffer.concat([aad, header]));
    const frame = Buffer.concat([header, enc.update(data), enc.final(), enc.getAuthTag()]);
    if (type === RECORD_END) ended = true;
    return frame;
  };

  return {
    sealHead({ status, headers = {} }) {
      const clean = {};
      for (const [k, v] of Object.entries(headers ?? {})) {
        if (v === undefined || v === null) continue;
        clean[String(k).toLowerCase()] = Array.isArray(v) ? v.join(', ') : String(v);
      }
      return sealRecord(RECORD_HEAD, Buffer.from(JSON.stringify({ status, headers: clean }), 'utf8'));
    },
    sealData(chunk) {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      if (buf.length === 0) return [];
      const frames = [];
      for (let off = 0; off < buf.length; off += MAX_RECORD_CHUNK) {
        frames.push(sealRecord(RECORD_DATA, buf.subarray(off, off + MAX_RECORD_CHUNK)));
      }
      return frames;
    },
    sealEnd() {
      return sealRecord(RECORD_END, Buffer.alloc(0));
    },
  };
}

/**
 * Controller side: incrementally decrypt authenticated response records.
 * Rejects tampered records, out-of-order records, and truncated streams missing RECORD_END.
 */
export function createResponseOpener(replyKey, aad) {
  let seq = 0;
  let sawHead = false;
  let finished = false;
  let buffer = Buffer.alloc(0);

  const decryptRecord = (header, bodyAndTag) => {
    const type = header[0];
    if (bodyAndTag.length < 16) throw new TunnelCryptoError('STREAM_CORRUPT', '加密应答分块损坏', 502);
    let plain;
    try {
      const dec = createDecipheriv('aes-256-gcm', replyKey, recordIV(seq++));
      dec.setAAD(Buffer.concat([aad, header]));
      dec.setAuthTag(bodyAndTag.subarray(-16));
      plain = Buffer.concat([dec.update(bodyAndTag.subarray(0, -16)), dec.final()]);
    } catch {
      throw new TunnelCryptoError('STREAM_CORRUPT', '加密应答校验失败', 502);
    }

    if (finished) {
      throw new TunnelCryptoError('STREAM_CORRUPT', '加密应答在结束标记后仍有数据', 502);
    }
    if (!sawHead) {
      if (type !== RECORD_HEAD) throw new TunnelCryptoError('STREAM_CORRUPT', '加密应答缺少头部帧', 502);
      sawHead = true;
      let parsed;
      try { parsed = JSON.parse(plain.toString('utf8')); } catch {
        throw new TunnelCryptoError('STREAM_CORRUPT', '加密应答头部无效', 502);
      }
      if (!Number.isInteger(parsed?.status) || parsed.status < 100 || parsed.status > 599) {
        throw new TunnelCryptoError('STREAM_CORRUPT', '加密应答状态码无效', 502);
      }
      return { type: 'head', status: parsed.status, headers: parsed.headers ?? {} };
    }
    if (type === RECORD_DATA) {
      return { type: 'data', data: plain };
    }
    if (type === RECORD_END) {
      if (plain.length !== 0) throw new TunnelCryptoError('STREAM_CORRUPT', '加密应答结束帧异常', 502);
      finished = true;
      return { type: 'end' };
    }
    throw new TunnelCryptoError('STREAM_CORRUPT', '未知加密应答帧类型', 502);
  };

  return {
    /** Push an arbitrary encrypted transport chunk; returns decoded events ready immediately. */
    push(chunk) {
      if (!chunk || chunk.length === 0) return [];
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      buffer = buffer.length === 0 ? buf : Buffer.concat([buffer, buf]);
      const events = [];
      while (buffer.length >= 5) {
        const header = buffer.subarray(0, 5);
        const encLen = header.readUInt32BE(1);
        if (encLen < 16 || encLen > MAX_RECORD_CIPHERTEXT) {
          throw new TunnelCryptoError('STREAM_CORRUPT', '加密应答分块长度异常', 502);
        }
        if (buffer.length < 5 + encLen) break;
        const bodyAndTag = buffer.subarray(5, 5 + encLen);
        buffer = buffer.subarray(5 + encLen);
        events.push(decryptRecord(header, bodyAndTag));
      }
      return events;
    },
    /** Must be called when the transport stream ends; throws if truncated before RECORD_END. */
    finish() {
      if (!finished || buffer.length > 0) {
        throw new TunnelCryptoError('STREAM_TRUNCATED', '加密应答流被截断', 502);
      }
    },
    get finished() { return finished; },
  };
}
