// #2314 item 2.6: 128-bit relay pairing codes and single-line versioned connection strings.
//
// Long code entropy (128 bits) follows Kooyu packages/host/src/devices/pairing.ts#L22-L27
// (commit e33137b, MIT License, Copyright (c) Kooyu contributors).
import { randomBytes } from 'node:crypto';
import { HOST_ID_RE, formatFingerprint } from './tunnel-identity.mjs';

export const TUNNEL_LINK_PREFIX = 'bhrelay1:';
export const LONG_CODE_BYTES = 16; // 128-bit random pairing secret

export class TunnelLinkError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function isLoopbackHost(hostname) {
  const h = String(hostname ?? '').toLowerCase();
  return h === '127.0.0.1' || h === 'localhost' || h === '::1' || h === '[::1]';
}

/**
 * Validate and normalize a community relay URL to its origin (`https://host[:port]`).
 * Plain `http://` is rejected except on loopback addresses (for local testing).
 */
export function normalizeRelayUrl(raw, { allowLoopback = true } = {}) {
  const trimmed = String(raw ?? '').trim();
  if (!trimmed) throw new TunnelLinkError('mode', '请填写中继服务器地址');
  let url;
  try {
    url = new URL(trimmed);
  } catch {
    throw new TunnelLinkError('mode', '中继地址格式不对，请填写完整的 https:// 地址');
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new TunnelLinkError('mode', '中继地址不要带账号密码、查询参数或锚点');
  }
  if (url.pathname !== '/' && url.pathname !== '') {
    throw new TunnelLinkError('mode', '中继地址只需填写域名根地址（不要带子路径）');
  }
  if (url.protocol !== 'https:') {
    const okLoopback = allowLoopback && url.protocol === 'http:' && isLoopbackHost(url.hostname);
    if (!okLoopback) {
      throw new TunnelLinkError('mode', '中继地址必须使用 https://（本机回环测试除外）');
    }
  }
  return url.origin;
}

/** Generate a fresh 128-bit URL-safe long pairing code. */
export function generateLongCode() {
  return randomBytes(LONG_CODE_BYTES).toString('base64url');
}

/**
 * Encode { relayUrl, hostId, code, expiresAt, name? } into a single-line versioned connection string.
 */
export function encodeTunnelLink({ relayUrl, hostId, code, expiresAt, name }, { allowLoopback = true } = {}) {
  const r = normalizeRelayUrl(relayUrl, { allowLoopback });
  if (typeof hostId !== 'string' || !HOST_ID_RE.test(hostId)) {
    throw new TunnelLinkError('mode', '宿主身份指纹格式不对');
  }
  if (typeof code !== 'string' || code.length < 16 || code.length > 128) {
    throw new TunnelLinkError('mode', '中继配对长码无效');
  }
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= 0) {
    throw new TunnelLinkError('mode', '连接串过期时间无效');
  }
  const payload = { r, h: hostId, c: code, e: expiresAt };
  const cleanName = typeof name === 'string' ? name.trim().slice(0, 64) : '';
  if (cleanName) payload.n = cleanName;
  return TUNNEL_LINK_PREFIX + Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

/**
 * Parse and validate a single-line connection string.
 * Rejects malformed strings, unknown versions, non-https relay URLs, and expired strings.
 */
export function parseTunnelLink(raw, { now = Date.now, allowLoopback = true, checkExpiry = true } = {}) {
  const text = String(raw ?? '').trim();
  if (!text) {
    throw new TunnelLinkError('mode', '请先粘贴另一台电脑生成的连接串');
  }
  const colon = text.indexOf(':');
  if (colon <= 0) {
    throw new TunnelLinkError('mode', '连接串格式不对，请完整复制另一台电脑生成的连接串');
  }
  const prefix = text.slice(0, colon + 1);
  if (prefix !== TUNNEL_LINK_PREFIX) {
    if (/^bhrelay\d+:$/i.test(prefix)) {
      throw new TunnelLinkError('mode', '连接串版本不支持，请更新两台电脑的 DSH 后再试');
    }
    throw new TunnelLinkError('mode', '连接串格式不对，请完整复制另一台电脑生成的连接串');
  }
  const encoded = text.slice(prefix.length);
  if (!encoded || !/^[A-Za-z0-9_-]+$/.test(encoded)) {
    throw new TunnelLinkError('mode', '连接串内容不完整或有非法字符，请重新复制');
  }
  let data;
  try {
    data = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
  } catch {
    throw new TunnelLinkError('mode', '连接串解析失败，请确认复制完整');
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new TunnelLinkError('mode', '连接串格式不对');
  }
  const relayUrl = normalizeRelayUrl(data.r, { allowLoopback });
  const hostId = String(data.h ?? '').toLowerCase();
  if (!HOST_ID_RE.test(hostId)) {
    throw new TunnelLinkError('mode', '连接串里的对方身份指纹格式不对');
  }
  const code = String(data.c ?? '');
  if (code.length < 16 || code.length > 128 || !/^[A-Za-z0-9_-]+$/.test(code)) {
    throw new TunnelLinkError('mode', '连接串里的配对长码无效');
  }
  const expiresAt = data.e;
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= 0) {
    throw new TunnelLinkError('mode', '连接串里的过期时间无效');
  }
  const current = typeof now === 'function' ? now() : now;
  if (checkExpiry && expiresAt <= current) {
    throw new TunnelLinkError('expired', '这条连接串已过期，请在另一台电脑上重新生成');
  }
  const name = typeof data.n === 'string' ? data.n.trim().slice(0, 64) : '';
  return {
    relayUrl,
    hostId,
    fingerprint: formatFingerprint(hostId),
    code,
    expiresAt,
    name,
  };
}
