// #2314 item 2.5: controller-side community tunnel relay channel.
//
// Seals each outgoing HTTP request with a per-request ephemeral X25519 key (tunnel-crypto.mjs),
// forwards ciphertext through POST /h/<hostId>/t on the relay, and progressively decrypts the
// chunked AES-256-GCM response stream (including SSE event streams). Verifies hostId = sha256(key)
// and pins the host's Ed25519 + X25519 public keys so a relay cannot impersonate the host.
import { PassThrough } from 'node:stream';
import { verifyEncryptionBundle } from './tunnel-identity.mjs';
import { TunnelCryptoError, createResponseOpener, sealRequest } from './tunnel-crypto.mjs';

// Raw inner request body cap so base64 + JSON envelope stays comfortably within relay's 1 MiB limit.
export const MAX_TUNNEL_REQUEST_BODY = 700 * 1024;
const DEFAULT_KEY_VERIFY_TTL_MS = 30_000;

export class TunnelClientError extends Error {
  constructor(code, message, status = 502) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

async function readStreamLimited(stream, limit) {
  const chunks = [];
  let total = 0;
  for await (const chunk of stream) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buf.length;
    if (total > limit) {
      throw new TunnelClientError('too-large', '请求太大，超过了中继单次转发上限（1 MB）', 413);
    }
    chunks.push(buf);
  }
  return Buffer.concat(chunks);
}

/**
 * Fetch GET /h/<hostId>/key from the relay, verify hostId = sha256(publicKey) and encKeySig,
 * and if `pinned` is supplied verify neither public key has changed.
 */
export async function fetchAndVerifyHostKey({
  relayUrl,
  hostId,
  pinned,
  fetchImpl = globalThis.fetch,
  timeout = 5000,
}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  timer.unref?.();
  let res;
  try {
    res = await fetchImpl(new URL(`/h/${hostId}/key`, relayUrl), {
      method: 'GET',
      headers: { accept: 'application/json' },
      signal: controller.signal,
    });
  } catch {
    throw new TunnelClientError('relay-unreachable', '连不上中继服务器，请检查中继地址或网络', 502);
  } finally {
    clearTimeout(timer);
  }

  let body;
  try { body = await res.json(); } catch { body = undefined; }

  if (res.status === 503 || body?.error === 'HOST_OFFLINE') {
    throw new TunnelClientError('host-offline', '对方电脑现在不在线（可能关机、DSH 没开，或还没连上中继）', 503);
  }
  if (res.status === 429) {
    throw new TunnelClientError('relay-busy', '中继繁忙或触发限流，请稍后再试', 429);
  }
  if (!res.ok || !body || typeof body !== 'object') {
    throw new TunnelClientError('relay-unreachable', `中继返回异常（${res.status}）`, 502);
  }

  let verified;
  try {
    verified = verifyEncryptionBundle({
      hostId,
      publicKey: body.publicKey,
      encKey: body.encKey,
      encKeySig: body.encKeySig,
    });
  } catch (err) {
    const msg = pinned ? '对方身份变了，请重新配对' : (err?.message || '对方公钥校验失败，已拒绝连接');
    throw new TunnelClientError(pinned ? 'identity-changed' : 'identity-mismatch', msg, 409);
  }

  if (pinned && (pinned.publicKey !== verified.publicKey || pinned.encKey !== verified.encKey)) {
    throw new TunnelClientError('identity-changed', '对方身份变了，请重新配对', 409);
  }
  return verified;
}

function mapOuterRelayFailure(status, body) {
  const code = body?.error ?? body?.code;
  if (status === 503 || code === 'HOST_OFFLINE') {
    return new TunnelClientError('host-offline', '对方电脑现在不在线（可能关机、DSH 没开，或还没连上中继）', 503);
  }
  if (status === 429 || code === 'RELAY_BUSY' || code === 'RATE_LIMITED') {
    return new TunnelClientError('relay-busy', '中继繁忙或触发限流，请稍后再试', 429);
  }
  if (status === 413 || code === 'TOO_LARGE') {
    return new TunnelClientError('too-large', '请求太大，超过了中继单次转发上限（1 MB）', 413);
  }
  if (status === 504 || code === 'RELAY_TIMEOUT') {
    return new TunnelClientError('relay-timeout', '等待对方电脑响应超时', 504);
  }
  if (status === 409 && (code === 'ENVELOPE_EXPIRED' || code === 'ENVELOPE_REPLAY')) {
    return new TunnelClientError('envelope-rejected', body?.error || '加密请求被对方拒绝，请检查两台电脑的系统时间', 409);
  }
  if (status === 401 && code === 'ENVELOPE_INVALID') {
    return new TunnelClientError('envelope-invalid', '加密请求校验失败，对方身份可能已变更', 401);
  }
  if (status === 502 || code === 'HOST_REQUEST_FAILED') {
    return new TunnelClientError('host-error', '对方电脑处理请求时出错', 502);
  }
  return new TunnelClientError('relay-unreachable', `经中继转发失败（${status}）`, 502);
}

/**
 * Create the controller-side (and optionally host-side) tunnel channel object for ChannelRegistry.
 */
export function createTunnelChannel({
  tunnelHost,
  fetchImpl = globalThis.fetch,
  now = Date.now,
  keyVerifyTtlMs = DEFAULT_KEY_VERIFY_TTL_MS,
} = {}) {
  const verifiedAt = new Map();

  async function ensurePinnedKey(target, { force = false, timeout = 5000 } = {}) {
    const cacheKey = `${target.relay_url}|${target.host_id}|${target.public_key}|${target.enc_key}`;
    const last = verifiedAt.get(cacheKey) ?? 0;
    const current = typeof now === 'function' ? now() : now;
    if (!force && keyVerifyTtlMs > 0 && current - last < keyVerifyTtlMs) {
      return;
    }
    await fetchAndVerifyHostKey({
      relayUrl: target.relay_url,
      hostId: target.host_id,
      pinned: { publicKey: target.public_key, encKey: target.enc_key },
      fetchImpl,
      timeout,
    });
    verifiedAt.set(cacheKey, current);
  }

  /** Send one encrypted request and return `{ status, headers, stream, abort }` as soon as inner HEAD arrives. */
  async function openTunnelStream(target, { method = 'GET', path, headers = {}, body, timeout }) {
    const relayUrl = target.relay_url;
    const hostId = target.host_id;
    const encKey = target.enc_key;
    if (!relayUrl || !hostId || !encKey) {
      throw new TunnelClientError('mode', '中继连接缺少必要的地址或对方公钥', 400);
    }

    if (target.public_key && target.skipKeyCheck !== true) {
      await ensurePinnedKey(target, { timeout: Math.min(timeout ?? 5000, 5000) });
    }

    const { envelope, aad, replyKey } = sealRequest({ encKey, method, path, headers, body, now });
    const payload = Buffer.from(JSON.stringify(envelope), 'utf8');
    if (payload.length > 1024 * 1024) {
      throw new TunnelClientError('too-large', '请求太大，超过了中继单次转发上限（1 MB）', 413);
    }

    const controller = new AbortController();
    let timer;
    if (timeout) {
      timer = setTimeout(() => controller.abort(), timeout);
      timer.unref?.();
    }

    let res;
    try {
      res = await fetchImpl(new URL(`/h/${hostId}/t`, relayUrl), {
        method: 'POST',
        headers: { 'content-type': 'application/octet-stream' },
        body: payload,
        signal: controller.signal,
      });
    } catch {
      clearTimeout(timer);
      throw new TunnelClientError('relay-unreachable', '连不上中继服务器，请检查中继地址或网络', 502);
    }

    if (res.status !== 200) {
      clearTimeout(timer);
      let errBody;
      try { errBody = await res.json(); } catch { errBody = undefined; }
      const mapped = mapOuterRelayFailure(res.status, errBody);
      // If the host could not decrypt our envelope, re-check its key to surface identity changes clearly.
      if (mapped.code === 'envelope-invalid' && target.public_key) {
        verifiedAt.delete(`${relayUrl}|${hostId}|${target.public_key}|${encKey}`);
        await ensurePinnedKey(target, { force: true });
      }
      throw mapped;
    }

    const opener = createResponseOpener(replyKey, aad);
    const stream = new PassThrough();
    const reader = res.body?.getReader?.();
    if (!reader) {
      clearTimeout(timer);
      throw new TunnelClientError('relay-unreachable', '中继响应流不可读', 502);
    }

    let aborted = false;
    const abort = () => {
      if (aborted) return;
      aborted = true;
      clearTimeout(timer);
      controller.abort();
      reader.cancel().catch(() => {});
      stream.destroy();
    };

    // Read until RECORD_HEAD arrives, then resolve and keep pumping chunks progressively in background.
    let head;
    try {
      while (!head) {
        const { done, value } = await reader.read();
        if (done) {
          opener.finish();
          throw new TunnelCryptoError('STREAM_TRUNCATED', '加密应答在返回头部前就断开了', 502);
        }
        for (const ev of opener.push(Buffer.from(value))) {
          if (ev.type === 'head') head = ev;
          else if (ev.type === 'data') stream.write(ev.data);
          else if (ev.type === 'end') stream.end();
        }
      }
    } catch (err) {
      clearTimeout(timer);
      controller.abort();
      reader.cancel().catch(() => {});
      stream.destroy();
      if (err instanceof TunnelCryptoError) {
        throw new TunnelClientError('stream-corrupt', err.message, 502);
      }
      throw new TunnelClientError('relay-unreachable', '读取中继响应失败', 502);
    }

    if (!opener.finished) {
      (async () => {
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) {
              opener.finish();
              if (!stream.writableEnded) stream.end();
              break;
            }
            for (const ev of opener.push(Buffer.from(value))) {
              if (ev.type === 'data') stream.write(ev.data);
              else if (ev.type === 'end') {
                stream.end();
                break;
              }
            }
          }
        } catch (err) {
          if (!aborted && !stream.destroyed) {
            stream.destroy(err instanceof Error ? err : new Error(String(err)));
          }
        } finally {
          clearTimeout(timer);
        }
      })();
    } else {
      clearTimeout(timer);
    }

    return {
      status: head.status,
      headers: head.headers,
      stream,
      abort,
    };
  }

  return {
    name: 'tunnel',
    fetchHostKey: ({ relayUrl, hostId, pinned, timeout }) =>
      fetchAndVerifyHostKey({ relayUrl, hostId, pinned, fetchImpl, timeout }),
    verifyHostKey: (target, opts) => ensurePinnedKey(target, { force: true, ...opts }),

    async requestJSON(target, { path, method = 'GET', body, headers = {}, timeout = 8000 }) {
      const payload = body === undefined ? undefined : Buffer.from(JSON.stringify(body), 'utf8');
      const reqHeaders = {
        accept: 'application/json',
        ...(payload ? { 'content-type': 'application/json', 'content-length': String(payload.length) } : {}),
        ...headers,
      };
      const { status, headers: resHeaders, stream } = await openTunnelStream(target, {
        method,
        path,
        headers: reqHeaders,
        body: payload,
        timeout,
      });
      const chunks = [];
      for await (const chunk of stream) chunks.push(chunk);
      let value;
      try { value = JSON.parse(Buffer.concat(chunks).toString('utf8') || 'null'); } catch { value = undefined; }
      return { status, body: value, headers: resHeaders };
    },

    async proxyStream(target, { method, path, headers, req }) {
      const hasBody = method !== 'GET' && method !== 'HEAD';
      const body = hasBody ? await readStreamLimited(req, MAX_TUNNEL_REQUEST_BODY) : Buffer.alloc(0);
      const fwdHeaders = { ...headers };
      if (body.length > 0) fwdHeaders['content-length'] = String(body.length);
      else delete fwdHeaders['content-length'];
      return openTunnelStream(target, { method, path, headers: fwdHeaders, body });
    },

    formatProxyError(err) {
      if (err instanceof TunnelClientError) {
        return { status: err.status, code: err.code, error: err.message };
      }
      if (err instanceof TunnelCryptoError) {
        return { status: err.status, code: err.code, error: err.message };
      }
      return {
        status: 502,
        code: 'relay-unreachable',
        error: '连不上中继服务器，请检查中继地址或网络',
      };
    },

    start() { return tunnelHost?.start?.(); },
    stop() { return tunnelHost?.stop?.(); },
    status() { return tunnelHost?.status?.() ?? { channel: 'tunnel', configured: false, state: 'unconfigured' }; },
  };
}
