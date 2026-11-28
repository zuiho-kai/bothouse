// #131 / issue #981: two DSH computers pair with a short number, so one DSH drives the other's
// channels, team desk and bothouse panel without a terminal or a hand-copied token.
//
// The machine being driven ("host", PairHost) shows a one-time number and, only while it has a
// live number or a paired device, listens on its own Tailscale address. The driving machine
// ("controller", PairClient) lists the tailnet's online machines, sends the number once and gets
// back a device credential. From then on the controller's DSH forwards /collab/remote/<link>/* to
// the host's /collab/* with that credential, so the browser keeps talking to its own DSH and never
// holds the credential. Tailscale (WireGuard) already encrypts and authenticates every peer, so
// the number only has to prove "the person at both screens"; a PAKE (SPAKE2, magic-wormhole) is
// not needed on top. The host listener refuses addresses outside the tailnet ranges.
import { createHash, randomBytes, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import { execFile } from 'node:child_process';
import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { createServer, request as httpRequest } from 'node:http';
import { hostname } from 'node:os';
import { dirname } from 'node:path';
import { ChannelRegistry, createTailscaleChannel, httpRequestJSON } from './channels.mjs';
import { computeHostId, formatFingerprint } from './tunnel-identity.mjs';
import { TunnelLinkError, encodeTunnelLink, generateLongCode, parseTunnelLink } from './tunnel-link.mjs';
import { TunnelClientError } from './tunnel-client.mjs';
import { renderQRSvg } from './qr-svg.mjs';

// 来源：用户 11-04 16:4x 认可的 C酱 方案，示例码「482 913」为 6 位数字、只能用一次。
export const CODE_DIGITS = 6;
// 来源：用户 11-04 16:58 定「数字码 5 分钟有效」。
export const CODE_TTL_MS = 5 * 60_000;
// 来源：用户 11-04 16:58 定「输错 5 次作废」。
export const MAX_ATTEMPTS = 5;
// 踢掉一台电脑后，宿主还留这么久让指挥端能问一句「我还在吗」：沿用上面用户定的 5 分钟码有效期
// （PairHost.kickGrace 用当次的 codeTtl，不另造数字）。过了这段，空转的监听照旧收掉；更晚才打开
// 列表的连接与「那台电脑关机」已无从区分。
// Temporary links: 用户 11-04 16:58 定——默认「直到我断开」（不设时长），或连接时填「自定义时长」，
// 到时自动断；不设固定上限。
// 沿用：DSH web 常用端口 3081（docs/INSTANCE_SETUP.md）的下一个；两端同一常量，发现才对得上。
export const PAIR_PORT = 3082;
export const MODES = ['temp', 'remember'];
// 「直到我断开」的临时连接靠指挥端页面心跳保活：刷新页面不断，心跳停了才断。
// 来源：用户 11-04 17:34「给几秒心跳宽限自动接回，只有关窗/点断开/踢掉才断」；每 3 秒一跳，
// 连丢三跳多一点（10 秒）算关窗，沿用 bridge/core/team.go:28 teamStaleAfter「三跳没来算掉线」的做法。
export const ALIVE_EVERY_MS = 3000;
export const UNTIL_GRACE_MS = 10_000;
export const REMOTE_PREFIX = '/collab/remote';
// Marks a request the host listener authenticated with a device credential (plugin.mjs owner()).
export const REMOTE_OWNER = Symbol('collab.remoteOwner');
// #1327: a phone in the tailnet opens this machine's pairing port in a browser, types the same
// number and keeps the device credential in this cookie (no DSH on the phone to forward for it).
export const PAIR_COOKIE = 'dsh_pair';
// 「记住这台手机」的 cookie 存活：浏览器允许的上限 400 天（RFC 6265bis Max-Age 上限）；踢掉即失效。
const REMEMBER_COOKIE_S = 400 * 24 * 3600;

const TAILSCALE_BINS = ['tailscale', '/opt/homebrew/bin/tailscale', '/usr/local/bin/tailscale', '/Applications/Tailscale.app/Contents/MacOS/Tailscale', 'C:\\Program Files\\Tailscale\\tailscale.exe'];
// 沿用 plugin.mjs MAX_BODY（256 KiB）。
const MAX_PAIR_BODY = 256 * 1024;

/** Error with a code the routes turn into an HTTP status and a plain-language message. */
export class PairError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}
// 来源：HTTP 状态码语义（RFC 9110 / RFC 6585 429）。
export const PAIR_STATUS = {
  'no-code': 410, expired: 410, wrong: 403, locked: 429, mode: 400, unreachable: 502, refused: 403, missing: 404, tailnet: 503,
  'relay-unreachable': 502, 'host-offline': 503, 'relay-busy': 429, 'relay-timeout': 504,
  'identity-changed': 409, 'identity-mismatch': 409, 'too-large': 413,
  'relay-unconfigured': 400, 'relay-offline': 503, 'host-error': 502,
  'unpaired-client': 403, 'client-sig-invalid': 401,
};

const sha256 = s => createHash('sha256').update(String(s)).digest();
function sameHash(a, b) { return a.length === b.length && timingSafeEqual(a, b); }

/** Write JSON atomically with owner-only permissions (credentials live here). */
function saveJSON(file, value) {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(value, null, 2), { mode: 0o600 });
  renameSync(tmp, file);
  try { chmodSync(file, 0o600); } catch { /* best effort */ }
}
function loadJSON(file) {
  try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return undefined; }
}

/** True for Tailscale's IPv4 CGNAT range 100.64.0.0/10 and its IPv6 ULA fd7a:115c:a1e0::/48. */
export function isTailnetAddress(addr) {
  const a = String(addr ?? '').replace(/^::ffff:/, '');
  const v4 = /^(\d+)\.(\d+)\.\d+\.\d+$/.exec(a);
  // 来源：Tailscale 文档，tailnet IPv4 取自 100.64.0.0/10（第二段 64–127）。
  if (v4) return Number(v4[1]) === 100 && Number(v4[2]) >= 64 && Number(v4[2]) <= 127;
  return a.toLowerCase().startsWith('fd7a:115c:a1e0:');
}
export function isLoopback(addr) {
  const a = String(addr ?? '').replace(/^::ffff:/, '');
  return a === '::1' || a.startsWith('127.');
}

/**
 * A temporary link's length: null = until someone disconnects, else a whole number of
 * milliseconds chosen when connecting. Remembered links never time out.
 */
export function tempDuration(mode, durationMs) {
  if (mode !== 'temp' || durationMs === undefined || durationMs === null || durationMs === '') return null;
  const ms = Number(durationMs);
  if (!Number.isSafeInteger(ms) || ms <= 0) throw new PairError('mode', '自定义时长要填大于 0 的整数分钟或小时');
  return ms;
}

/**
 * Host side: the one live number, and the devices it let in.
 * Remembered devices persist (credential hash only); temporary ones live in memory and end when
 * either side disconnects, at the custom length chosen when connecting (if any), or when this
 * DSH restarts.
 */
export class PairHost {
  /**
   * @param {{ file: string, now?: () => number, codeTtl?: number }} opts
   */
  constructor({ file, now = Date.now, codeTtl = CODE_TTL_MS }) {
    this.file = file;
    this.now = now;
    this.codeTtl = codeTtl;
    this.code = undefined;
    this.tunnelCode = undefined;
    this.lastRevokeAt = undefined;
    this.devices = new Map();
    // Responses still open per device (event streams, proxied requests): cut when it is dropped,
    // so kicking a device ends what it already holds, not only its next request.
    this.open = new Map();
    const saved = loadJSON(file);
    for (const d of Array.isArray(saved?.devices) ? saved.devices : []) {
      if (typeof d?.id === 'string' && typeof d.token_hash === 'string') {
        this.devices.set(d.id, { ...d, channel: d.channel || 'tailscale', mode: 'remember', expires_at: null });
      }
    }
  }

  /** A fresh 6-digit Tailscale number; any earlier Tailscale number stops working. */
  newCode() {
    // 10^CODE_DIGITS numbers, leading zeros kept.
    const code = String(randomInt(0, 10 ** CODE_DIGITS)).padStart(CODE_DIGITS, '0');
    this.code = { hash: sha256(code), expires_at: this.now() + this.codeTtl, attempts: 0 };
    return { code, expires_at: this.code.expires_at, ttl_ms: this.codeTtl, max_attempts: MAX_ATTEMPTS };
  }

  cancelCode() { this.code = undefined; }

  /** Whether a Tailscale 6-digit number is waiting to be typed in. */
  codeLive() {
    if (this.code !== undefined && this.code.expires_at <= this.now()) this.code = undefined;
    return this.code !== undefined;
  }

  /** A fresh 128-bit relay pairing secret (#2314 item 2.6); separate from the Tailscale 6-digit slot. */
  newTunnelCode() {
    const code = generateLongCode();
    this.tunnelCode = { hash: sha256(code), expires_at: this.now() + this.codeTtl, attempts: 0 };
    return { code, expires_at: this.tunnelCode.expires_at, ttl_ms: this.codeTtl, max_attempts: MAX_ATTEMPTS };
  }

  cancelTunnelCode() { this.tunnelCode = undefined; }

  /** Whether a relay long code is currently live. */
  tunnelCodeLive() {
    if (this.tunnelCode !== undefined && this.tunnelCode.expires_at <= this.now()) this.tunnelCode = undefined;
    return this.tunnelCode !== undefined;
  }

  /**
   * Check a pairing code (6-digit for Tailscale, 128-bit long code for tunnel) and, if right, let the device in.
   * @param {{ code: string, mode: string, name: string, address?: string, duration_ms?: number|null, kind?: string, channel?: string }} claim
   * @returns {{ token: string, device: object }}
   */
  claim({ code, mode, name, address, duration_ms, kind, channel = 'tailscale', clientPublicKey, clientId }) {
    if (!MODES.includes(mode)) throw new PairError('mode', '连接方式只能是「临时」或「记住这台电脑」');
    const duration = tempDuration(mode, duration_ms);
    const isTunnel = channel === 'tunnel';
    const slot = isTunnel ? this.tunnelCode : this.code;
    const clearSlot = () => { if (isTunnel) this.tunnelCode = undefined; else this.code = undefined; };
    if (slot === undefined) {
      throw new PairError('no-code', isTunnel
        ? '那台电脑现在没有在等中继配对，请在那台电脑上重新「生成连接串」'
        : '那台电脑现在没有在等配对，请在那台电脑上点「让别的电脑连我」');
    }
    if (slot.expires_at <= this.now()) {
      clearSlot();
      throw new PairError('expired', isTunnel ? '这条连接串已过期，请在那台电脑上重新生成' : '这串数字已过期，请在那台电脑上重新生成');
    }
    const candidate = isTunnel ? String(code ?? '').trim() : String(code ?? '').replace(/\D/g, '');
    if (!candidate || !sameHash(sha256(candidate), slot.hash)) {
      slot.attempts += 1;
      const left = MAX_ATTEMPTS - slot.attempts;
      if (left <= 0) {
        clearSlot();
        throw new PairError('locked', isTunnel ? '配对失败次数太多，这条连接串已作废，请在那台电脑上重新生成' : '输错次数太多，这串数字已作废，请在那台电脑上重新生成');
      }
      throw new PairError('wrong', isTunnel ? `连接串里的配对码不对，还能再试 ${left} 次` : `数字不对，还能再试 ${left} 次`);
    }
    clearSlot();
    const token = randomBytes(32).toString('base64url');
    const now = this.now();
    const pinnedClientId = isTunnel && clientPublicKey ? (clientId || computeHostId(clientPublicKey)) : undefined;
    const device = {
      id: randomUUID(), name: String(name ?? '').trim().slice(0, 80) || (kind === 'browser' ? '手机浏览器' : '另一台电脑'), address: String(address ?? ''),
      kind: !isTunnel && kind === 'browser' ? 'browser' : 'dsh', channel, mode, token_hash: sha256(token).toString('hex'), created_at: now, last_seen: now,
      expires_at: duration === null ? null : now + duration,
      ...(pinnedClientId ? { client_public_key: clientPublicKey, client_id: pinnedClientId } : {}),
    };
    this.devices.set(device.id, device);
    if (mode === 'remember') this.save();
    return { token, device: this.view(device) };
  }

  /** True if a live paired tunnel device has pinned this Ed25519 client public-key fingerprint. */
  hasPairedClientKey(clientId) {
    if (typeof clientId !== 'string' || !clientId) return false;
    const now = this.now();
    for (const d of [...this.devices.values()]) {
      if (d.expires_at !== null && d.expires_at <= now) { this.drop(d.id); continue; }
      if (d.channel === 'tunnel' && d.client_id === clientId) return true;
    }
    return false;
  }

  /** The device a credential belongs to, or undefined (unknown, revoked, expired, or key mismatch). */
  verify(token, { clientId } = {}) {
    if (typeof token !== 'string' || token === '') return undefined;
    const hash = sha256(token);
    for (const d of this.devices.values()) {
      if (!sameHash(Buffer.from(d.token_hash, 'hex'), hash)) continue;
      if (d.expires_at !== null && d.expires_at <= this.now()) { this.drop(d.id); return undefined; }
      if (clientId !== undefined && d.client_id && d.client_id !== clientId) return undefined;
      d.last_seen = this.now();
      return d;
    }
    return undefined;
  }

  list() {
    const now = this.now();
    for (const d of [...this.devices.values()]) if (d.expires_at !== null && d.expires_at <= now) this.drop(d.id);
    return [...this.devices.values()].sort((a, b) => b.created_at - a.created_at).map(d => this.view(d));
  }

  revoke(id) {
    const d = this.devices.get(id);
    if (d === undefined) return false;
    this.lastRevokeAt = this.now();
    this.drop(id);
    if (d.mode === 'remember') this.save();
    return true;
  }

  /** Remember a response a device has open, until it closes. */
  hold(id, res) {
    let set = this.open.get(id);
    if (set === undefined) this.open.set(id, set = new Set());
    set.add(res);
    res.on('close', () => { set.delete(res); if (set.size === 0 && this.open.get(id) === set) this.open.delete(id); });
  }

  /** Forget a device and end every response it still has open. */
  drop(id) {
    this.devices.delete(id);
    const set = this.open.get(id);
    this.open.delete(id);
    for (const res of set ?? []) res.destroy();
  }

  /** Whether the tailnet listener has anything to serve. */
  active() { return this.codeLive() || this.list().length > 0; }

  /** Whether any Tailscale pairing code or Tailscale-paired device needs the tailnet TCP listener. */
  activeTailscale() { return this.codeLive() || this.list().some(d => d.channel === 'tailscale'); }

  /** Just kicked something: stay up a little so this machine can answer "was I kicked?". */
  // Same clock and length the number itself uses (a constructor may override codeTtl in tests).
  kickGrace() { return this.lastRevokeAt !== undefined && this.now() - this.lastRevokeAt < this.codeTtl; }

  view(d) {
    return {
      id: d.id, name: d.name, address: d.address, kind: d.kind ?? 'dsh', channel: d.channel ?? 'tailscale',
      mode: d.mode, created_at: d.created_at, last_seen: d.last_seen, expires_at: d.expires_at,
      ...(d.client_id ? { client_id: d.client_id, client_fingerprint: formatFingerprint(d.client_id) } : {}),
    };
  }

  save() {
    saveJSON(this.file, { devices: [...this.devices.values()].filter(d => d.mode === 'remember')
      .map(({ id, name, address, kind, channel, token_hash, created_at, last_seen, client_public_key, client_id }) => ({
        id, name, address, kind, channel: channel ?? 'tailscale', token_hash, created_at, last_seen,
        ...(client_id ? { client_public_key, client_id } : {}),
      })) });
  }
}

/** Run the tailscale CLI; resolves stdout or rejects. */
export function tailscale(args, { bins = TAILSCALE_BINS, timeout = 5000 } = {}) {
  return new Promise((resolve, reject) => {
    const tryAt = i => {
      if (i >= bins.length) return reject(new PairError('tailnet', '这台电脑找不到 Tailscale，请先安装并登录 Tailscale'));
      execFile(bins[i], args, { timeout, maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => {
        if (err?.code === 'ENOENT') return tryAt(i + 1);
        if (err) return reject(new PairError('tailnet', 'Tailscale 没在运行或没登录，请先打开 Tailscale'));
        resolve(stdout);
      });
    };
    tryAt(0);
  });
}

/** This machine's tailnet IPv4 address. */
export async function tailnetAddress(run = tailscale) {
  const ip = String(await run(['ip', '-4'])).trim().split(/\s+/)[0];
  if (!isTailnetAddress(ip)) throw new PairError('tailnet', '这台电脑还没连上 Tailscale');
  return ip;
}

/** Tailnet name of the machine at `ip` (tailscale whois), or undefined. */
export async function whoisName(ip, run = tailscale) {
  try {
    const w = JSON.parse(await run(['whois', '--json', ip]));
    return w?.Node?.ComputedName || w?.Node?.Hostinfo?.Hostname || undefined;
  } catch { return undefined; }
}

/**
 * Parse tailscale's --json output. The macOS app's CLI prints a plain sentence instead
 * ("The Tailscale GUI failed to start: …") and still exits 0 when the app is not running,
 * so a bare JSON.parse would put "Unexpected token 'T'…" on the devices page.
 */
export function tailscaleJSON(out) {
  try { return JSON.parse(out); } catch {
    throw new PairError('tailnet', 'Tailscale 没在运行或没登录，请先打开 Tailscale');
  }
}

/** Other machines in the tailnet: [{ name, ip, online, os }]. */
export async function tailnetPeers(run = tailscale) {
  const status = tailscaleJSON(await run(['status', '--json']));
  return Object.values(status?.Peer ?? {}).map(p => ({
    name: String(p.HostName || p.DNSName || '').trim() || '未命名电脑',
    ip: (p.TailscaleIPs ?? []).find(isTailnetAddress) ?? p.TailscaleIPs?.[0],
    online: p.Online === true, os: String(p.OS ?? ''),
  })).filter(p => p.ip);
}

/** Small JSON request to another machine (re-exported from channels.mjs for callers and tests). */
export const requestJSON = httpRequestJSON;

/**
 * Controller side: machines this DSH paired with. Remembered links persist (the credential has
 * to, file mode 0600); temporary ones live in memory only.
 */
export class PairClient {
  constructor({ file, now = Date.now, port = PAIR_PORT, request = requestJSON, channels, name = hostname(), grace = UNTIL_GRACE_MS }) {
    this.grace = grace;
    this.file = file;
    this.now = now;
    this.port = port;
    this.request = request;
    this.channels = channels instanceof ChannelRegistry ? channels : new ChannelRegistry();
    if (!this.channels.has('tailscale')) {
      this.channels.register(createTailscaleChannel({ requestJSON: request, defaultPort: port }));
    }
    this.name = name;
    this.links = new Map();
    this.refreshing = undefined;
    const saved = loadJSON(file);
    for (const l of Array.isArray(saved?.links) ? saved.links : []) {
      if (typeof l?.id !== 'string' || typeof l.token !== 'string') continue;
      const ch = l.channel || 'tailscale';
      if (ch === 'tunnel') {
        if (typeof l.relay_url === 'string' && typeof l.host_id === 'string' && typeof l.public_key === 'string' && typeof l.enc_key === 'string') {
          this.links.set(l.id, { ...l, channel: 'tunnel', mode: 'remember', expires_at: null });
        }
      } else if (typeof l.host === 'string') {
        this.links.set(l.id, { ...l, channel: ch, mode: 'remember', expires_at: null });
      }
    }
  }

  _channelFor(name = 'tailscale') {
    const ch = this.channels.get(name || 'tailscale');
    if (!ch) throw new PairError('mode', `不支持的连接通道：${name}`);
    return ch;
  }

  /** Ask a host whether it runs DSH pairing and is waiting for a number. */
  async hello(host, port = this.port) {
    try {
      const r = await this._channelFor('tailscale').requestJSON({ host, port }, { path: '/collab/pair/hello', timeout: 1500 });
      return r.status === 200 && r.body?.app === 'dsh-collab' ? r.body : undefined;
    } catch { return undefined; }
  }

  /** Send a Tailscale (or injected channel) pairing code once; on success keep the credential. */
  async connect({ host, port = this.port, code, mode, name, duration_ms, channel = 'tailscale' }) {
    if (!MODES.includes(mode)) throw new PairError('mode', '连接方式只能是「临时」或「记住这台电脑」');
    const duration = tempDuration(mode, duration_ms);
    const ch = this._channelFor(channel);
    let r;
    try {
      r = await ch.requestJSON({ host, port }, { path: '/collab/pair/claim', method: 'POST', body: { code: String(code ?? ''), mode, name: this.name, duration_ms: duration } });
    } catch {
      throw new PairError('unreachable', '连不上那台电脑：确认它开着 DSH、连着 Tailscale，并且点了「让别的电脑连我」');
    }
    if (r.status !== 200 || typeof r.body?.token !== 'string') {
      throw new PairError(r.body?.code ?? 'refused', r.body?.error ?? '那台电脑拒绝了配对');
    }
    const link = {
      id: randomUUID(), channel, name: String(name || r.body.host_name || host), host, port, token: r.body.token,
      mode, created_at: this.now(), expires_at: r.body.device?.expires_at ?? null, alive_at: this.now(),
    };
    this.links.set(link.id, link);
    if (mode === 'remember') this.save();
    return this.view(link);
  }

  /** Connect to another computer via a community relay connection string (#2314 items 2.5 + 2.6). */
  async connectTunnel({ link: rawLink, mode, name, duration_ms, allowLoopback = true }) {
    if (!MODES.includes(mode)) throw new PairError('mode', '连接方式只能是「临时」或「记住这台电脑」');
    const duration = tempDuration(mode, duration_ms);
    const parsed = parseTunnelLink(rawLink, { now: this.now, allowLoopback });
    const ch = this._channelFor('tunnel');
    const key = await ch.fetchHostKey({ relayUrl: parsed.relayUrl, hostId: parsed.hostId });
    const target = {
      relay_url: parsed.relayUrl,
      host_id: parsed.hostId,
      public_key: key.publicKey,
      enc_key: key.encKey,
      skipKeyCheck: true,
    };
    const r = await ch.requestJSON(target, {
      path: '/collab/pair/claim',
      method: 'POST',
      body: { code: parsed.code, mode, name: this.name, duration_ms: duration },
      timeout: 10_000,
    });
    if (r.status !== 200 || typeof r.body?.token !== 'string') {
      throw new PairError(r.body?.code ?? 'refused', r.body?.error ?? '那台电脑拒绝了配对');
    }
    const link = {
      id: randomUUID(),
      channel: 'tunnel',
      name: String(name || r.body.host_name || parsed.name || formatFingerprint(parsed.hostId)),
      relay_url: parsed.relayUrl,
      host_id: parsed.hostId,
      public_key: key.publicKey,
      enc_key: key.encKey,
      token: r.body.token,
      mode,
      created_at: this.now(),
      expires_at: r.body.device?.expires_at ?? null,
      alive_at: this.now(),
    };
    this.links.set(link.id, link);
    if (mode === 'remember') this.save();
    return this.view(link);
  }

  get(id) {
    const l = this.links.get(id);
    if (l !== undefined && l.expires_at !== null && l.expires_at <= this.now()) { this.links.delete(id); return undefined; }
    return l;
  }

  list() {
    for (const id of [...this.links.keys()]) this.get(id);
    return [...this.links.values()].sort((a, b) => b.created_at - a.created_at).map(l => this.view(l));
  }

  /** A DSH window on this machine is still open: keep its 「直到我断开」 links. */
  alive() {
    const now = this.now();
    for (const l of this.links.values()) l.alive_at = now;
  }

  /** End 「直到我断开」 links whose window stopped beating (closed, not just refreshed). */
  async sweep() {
    const stale = [...this.links.values()].filter(l => l.mode === 'temp' && l.expires_at === null && (l.alive_at ?? l.created_at) + this.grace <= this.now());
    for (const l of stale) await this.disconnect(l.id);
    return stale.map(l => l.id);
  }

  /**
   * Ask each host whether this machine is still paired, and forget the ones it revoked, so the
   * 「我连着的电脑」 list clears after a kick even if that link is never opened again. A host that
   * cannot be reached is kept: it may only be off, which is not the same as being kicked.
   */
  async refresh() {
    // One round for every caller, so the open/connect/disconnect refreshes of devices.html share it
    // instead of each paying the slowest host's timeout. No time-based cache: a kick must show at
    // once, not after a grace period.
    if (this.refreshing !== undefined) return this.refreshing;
    this.refreshing = (async () => {
      const dropped = [];
      try {
        await Promise.all([...this.links.values()].map(async l => {
          const ch = this.channels.get(l.channel ?? 'tailscale');
          if (!ch) return;
          const r = await ch.requestJSON(l, {
            path: '/collab/pair/whoami',
            headers: { authorization: `Bearer ${l.token}` },
            timeout: l.channel === 'tunnel' ? 4000 : 1500,
          }).catch(() => undefined);
          if (r?.status === 401 && r.body?.code === 'revoked') { this.drop(l.id); dropped.push(l.id); }
        })).catch(() => {}); // best effort: a broken host must not turn the list into an error
      } finally {
        this.refreshing = undefined;
      }
      return dropped;
    })();
    return this.refreshing;
  }

  /** Forget a link here and tell the host to drop its device (best effort). */
  async disconnect(id) {
    const l = this.links.get(id);
    if (l === undefined) return false;
    this.links.delete(id);
    if (l.mode === 'remember') this.save();
    try {
      const ch = this.channels.get(l.channel ?? 'tailscale');
      if (ch) {
        await ch.requestJSON(l, {
          path: '/collab/pair/forget',
          method: 'POST',
          headers: { authorization: `Bearer ${l.token}` },
          timeout: l.channel === 'tunnel' ? 4000 : 2000,
        });
      }
    } catch { /* host off: it expires or is kicked there */ }
    return true;
  }

  /** The host dropped this device: forget it here too. */
  drop(id) {
    const l = this.links.get(id);
    if (l === undefined) return;
    this.links.delete(id);
    if (l.mode === 'remember') this.save();
  }

  view(l) {
    const channel = l.channel ?? 'tailscale';
    return {
      id: l.id,
      channel,
      name: l.name,
      ...(channel === 'tunnel'
        ? { relay_url: l.relay_url, host_id: l.host_id, fingerprint: formatFingerprint(l.host_id) }
        : { host: l.host }),
      mode: l.mode,
      created_at: l.created_at,
      expires_at: l.expires_at,
    };
  }

  save() {
    saveJSON(this.file, {
      links: [...this.links.values()].filter(l => l.mode === 'remember').map(l => {
        const channel = l.channel ?? 'tailscale';
        if (channel === 'tunnel') {
          return {
            id: l.id, channel, name: l.name, relay_url: l.relay_url, host_id: l.host_id,
            public_key: l.public_key, enc_key: l.enc_key, token: l.token, created_at: l.created_at,
          };
        }
        return { id: l.id, channel, name: l.name, host: l.host, port: l.port, token: l.token, created_at: l.created_at };
      }),
    });
  }
}

// Request headers the controller passes to the host; cookies, Origin, Host and Authorization
// stay on this side (same idea as panel.mjs PASS_REQUEST).
const PASS_REQUEST = ['accept', 'accept-language', 'content-type', 'content-length', 'if-none-match', 'if-modified-since', 'range', 'last-event-id', 'cache-control'];
const PASS_RESPONSE = ['content-type', 'cache-control', 'etag', 'last-modified', 'content-disposition', 'content-range', 'accept-ranges'];

/**
 * Point the host's absolute /collab/ URLs in an HTML page back through this proxy, so the
 * channel page, desk, wiki galaxy and panel (<base href="/collab/panel/">) keep working.
 */
export function rewriteRemoteHTML(html, mount) {
  // `}` covers template literals such as `${ROOT}/collab/api/...` (page.html, desk, wiki galaxy).
  return html.replace(/(["'`(=}]\s*)\/collab\//g, `$1${mount}/`);
}

/**
 * Forward one controller request under /collab/remote/<id>/ to the paired host via its channel.
 * @returns {Promise<void>|undefined} undefined when the path is not a remote path.
 */
export function remoteProxyRoute(req, res, url, { client, request = httpRequest, channels }) {
  if (url.pathname !== REMOTE_PREFIX && !url.pathname.startsWith(`${REMOTE_PREFIX}/`)) return undefined;
  const m = /^\/collab\/remote\/([0-9a-f-]{36})(\/.*)?$/.exec(url.pathname);
  const link = m === null ? undefined : client.get(m[1]);
  if (link === undefined) return Promise.resolve(sendError(req, res, 404, { error: '没有这个连接，可能已断开，请重新连接', code: 'missing' }));
  const mount = `${REMOTE_PREFIX}/${link.id}`;
  if (m[2] === undefined) { res.writeHead(308, { location: `${mount}/${url.search}` }); res.end(); return Promise.resolve(); }
  const rest = m[2] === '/' ? '' : m[2];
  const headers = { authorization: `Bearer ${link.token}` };
  for (const h of PASS_REQUEST) if (req.headers[h] !== undefined) headers[h] = req.headers[h];
  const channelName = link.channel ?? 'tailscale';
  const reg = channels ?? client.channels;
  const ch = (channelName === 'tailscale' && request !== httpRequest)
    ? createTailscaleChannel({ requestStream: request })
    : reg?.get(channelName) ?? createTailscaleChannel({ requestStream: request });

  return (async () => {
    let up;
    try {
      up = await ch.proxyStream(link, { method: req.method, path: `/collab${rest}${url.search}`, headers, req });
    } catch (err) {
      if (!res.headersSent) {
        const formatted = typeof ch.formatProxyError === 'function'
          ? ch.formatProxyError(err)
          : { status: 502, code: 'unreachable', error: '连不上那台电脑：它可能关机、DSH 没开、Tailscale 断了，或已经把这台踢掉' };
        sendError(req, res, formatted.status ?? 502, { error: formatted.error, code: formatted.code });
      } else {
        res.destroy();
      }
      return;
    }

    const status = up.status ?? 502;
    const upHeaders = up.headers ?? {};
    if (status === 401 && upHeaders['x-collab-pair'] === 'revoked') {
      client.drop(link.id);
      up.stream.resume?.();
      sendError(req, res, 401, { error: '连接已断开（那台电脑点了断开、把这台移出，或临时连接到时间了），请重新配对', code: 'revoked' });
      return;
    }
    const out = {};
    for (const h of PASS_RESPONSE) if (upHeaders[h] !== undefined) out[h] = upHeaders[h];
    if (status >= 300 && status < 400 && typeof upHeaders.location === 'string') {
      out.location = upHeaders.location.replace(/^\/collab(?=\/|$)/, mount);
    }

    await new Promise(resolve => {
      res.on('close', () => { if (!res.writableEnded) up.abort?.(); });
      if (String(upHeaders['content-type'] ?? '').startsWith('text/html')) {
        const chunks = [];
        up.stream.on('data', c => chunks.push(c));
        up.stream.on('end', () => {
          const body = Buffer.from(rewriteRemoteHTML(Buffer.concat(chunks).toString('utf8'), mount));
          res.writeHead(status, { ...out, 'content-length': body.length });
          res.end(body);
          resolve();
        });
        up.stream.on('error', () => { res.destroy(); resolve(); });
        return;
      }
      res.writeHead(status, out);
      res.flushHeaders?.();
      up.stream.pipe(res);
      up.stream.on('end', resolve);
      up.stream.on('error', () => { res.destroy(); resolve(); });
    });
  })();
}

/** A page navigation gets a readable page; fetch() callers get JSON. */
function sendError(req, res, status, value) {
  if (!String(req.headers.accept ?? '').includes('text/html')) return sendJSON(res, status, value);
  const esc = String(value.error).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  res.writeHead(status, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
  res.end(`<!doctype html><meta charset="utf-8"><title>连不上</title><style>:root{color-scheme:light dark}body{font:15px/1.6 -apple-system,"PingFang SC",sans-serif;display:grid;place-items:center;min-height:90vh;margin:0;padding:16px}</style><p>${esc}</p>`);
}

function sendJSON(res, status, value) {
  const body = JSON.stringify(value);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(body);
}

function readBody(req, limit = MAX_PAIR_BODY) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', c => { size += c.length; if (size > limit) { reject(new PairError('mode', 'too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch { reject(new PairError('mode', 'bad json')); } });
    req.on('error', reject);
  });
}

function bearer(req) {
  const m = /^Bearer\s+(\S+)$/i.exec(String(req.headers.authorization ?? ''));
  return m === null ? undefined : m[1];
}

/** The phone's device credential from its cookie, if it sent one. */
export function cookieToken(req) {
  for (const part of String(req.headers.cookie ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === PAIR_COOKIE) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return undefined;
}

/**
 * HttpOnly + SameSite=Strict; no Secure because the tailnet carries plain http (WireGuard already
 * encrypts it). Remembered phones keep it across browser restarts, temporary ones only for the
 * browser session (or the custom length).
 */
export function pairCookie(token, device) {
  const base = `${PAIR_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict`;
  if (device.mode === 'remember') return `${base}; Max-Age=${REMEMBER_COOKIE_S}`;
  if (device.expires_at !== null) return `${base}; Max-Age=${Math.max(1, Math.round((device.expires_at - device.created_at) / 1000))}`;
  return base;
}
const CLEAR_COOKIE = `${PAIR_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`;

const wantsHTML = req => req.method === 'GET' && String(req.headers.accept ?? '').includes('text/html');

/** The number page a phone sees at http://<tailnet address>:3082/. Plain on purpose (#1327 范围收窄). */
export function phonePairPage({ name, kicked = false }) {
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const note = kicked ? '<p id="note">这台手机已被那台电脑断开。要再看，请在那台电脑上重新生成数字，在这里输入。</p>' : '';
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>连到 ${esc(name)}</title>
<style>:root{color-scheme:light dark}body{font:16px/1.6 -apple-system,"PingFang SC",sans-serif;margin:0;padding:24px 16px;max-width:420px;margin-inline:auto}input[type=text]{box-sizing:border-box;width:100%;font-size:28px;letter-spacing:6px;text-align:center;padding:10px}button{width:100%;font-size:18px;padding:12px;margin-top:12px}#msg{min-height:1.6em;color:#c0392b}label{display:block;margin-top:12px}</style>
<body><h1 style="font-size:20px">连到 ${esc(name)}</h1>${note}
<p>在那台电脑的「已连接的设备」里点「让别的电脑连我」，把显示的 6 位数字输到这里。</p>
<form id="f"><input id="code" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="7" placeholder="000000" required>
<label><input id="remember" type="checkbox"> 记住这台手机（不勾就是临时，关掉浏览器就断）</label>
<button type="submit">连接</button><p id="msg" role="alert"></p></form>
<script>
document.getElementById('f').addEventListener('submit', async e => {
  e.preventDefault();
  const msg = document.getElementById('msg');
  msg.textContent = '';
  try {
    const r = await fetch('/collab/pair/browser', { method: 'POST', headers: { 'content-type': 'application/json' }, credentials: 'same-origin',
      body: JSON.stringify({ code: document.getElementById('code').value, remember: document.getElementById('remember').checked }) });
    const j = await r.json().catch(() => ({}));
    if (r.ok) { location.href = '/collab'; return; }
    msg.textContent = j.error || ('连接失败（' + r.status + '）');
  } catch { msg.textContent = '连不上那台电脑，请确认手机的 Tailscale 开着'; }
});
</script></body></html>`;
}

// Added to pages a phone opens: when the host kicks it, say so in words instead of a page that
// quietly stops updating. Asks the same whoami the controller DSH asks, at its heartbeat pace.
const KICK_WATCH = `<script>(()=>{const t=setInterval(async()=>{let r;try{r=await fetch('/collab/pair/whoami',{credentials:'same-origin',cache:'no-store'})}catch{return}if(r.status!==401)return;clearInterval(t);document.body.innerHTML='<div style="font:16px/1.6 -apple-system,sans-serif;padding:24px 16px"><p>这台手机已被那台电脑断开。</p><p><a href="/">重新输数字连接</a></p></div>'},${ALIVE_EVERY_MS})})();</script>`;

/** Append a snippet to an HTML response the route writes (only HTML; streams and JSON pass). */
function withHTMLTail(res, tail) {
  const { writeHead, write, end } = res;
  let html = false;
  const chunks = [];
  res.writeHead = function (status, ...args) {
    const headers = args.find(a => a !== null && typeof a === 'object' && !Array.isArray(a));
    const type = String(headers?.['content-type'] ?? headers?.['Content-Type'] ?? res.getHeader('content-type') ?? '');
    html = type.includes('text/html');
    if (html) { if (headers) { delete headers['content-length']; delete headers['Content-Length']; } res.removeHeader('content-length'); }
    return writeHead.call(this, status, ...args);
  };
  res.write = function (chunk, ...rest) {
    if (!html) return write.call(this, chunk, ...rest);
    chunks.push(Buffer.from(chunk));
    return true;
  };
  res.end = function (chunk, ...rest) {
    if (!html) return end.call(this, chunk, ...rest);
    if (chunk !== undefined && chunk !== null && typeof chunk !== 'function') chunks.push(Buffer.from(chunk));
    const body = Buffer.concat(chunks).toString('utf8');
    const i = body.lastIndexOf('</body>');
    return end.call(this, i < 0 ? body + tail : body.slice(0, i) + tail + body.slice(i));
  };
}

/**
 * Channel-agnostic host request dispatcher (#2314 item 2.1): handles pairing claim, credential
 * verification, local-only endpoint guards, and routing into the plugin's own route as owner.
 * Tailscale calls this after verifying the tailnet source address; tunnel calls this after
 * decrypting and authenticating the end-to-end encrypted envelope.
 */
export function dispatchHostRequest({ host, name, route, whois = whoisName }) {
  return async (req, res, { channel = 'tailscale', peer = req.socket?.remoteAddress, allowBrowser = channel === 'tailscale', clientPublicKey, clientId } = {}) => {
    const isTunnel = channel === 'tunnel';
    const url = new URL(req.url ?? '/', 'http://pair.invalid');
    try {
      if (!isTunnel && url.pathname === '/collab/pair/hello' && req.method === 'GET') {
        return sendJSON(res, 200, { app: 'dsh-collab', name, waiting: host.codeLive() });
      }
      // #1327: a phone browser pairs over Tailscale directly and keeps the credential as a cookie.
      if (allowBrowser && !isTunnel && url.pathname === '/collab/pair/browser' && req.method === 'POST') {
        const body = await readBody(req);
        const named = isTailnetAddress(peer) ? await whois(String(peer).replace(/^::ffff:/, '')) : undefined;
        const { token, device } = host.claim({ code: body?.code, mode: body?.remember === true ? 'remember' : 'temp', name: named, address: peer, kind: 'browser', channel });
        res.setHeader('set-cookie', pairCookie(token, device));
        return sendJSON(res, 200, { ok: true, device, host_name: name, to: '/collab' });
      }
      if (url.pathname === '/collab/pair/claim' && req.method === 'POST') {
        if (isTunnel && (!clientPublicKey || !clientId)) {
          return sendJSON(res, 401, { error: '中继配对必须交换设备公钥', code: 'client-sig-invalid' });
        }
        const body = await readBody(req);
        const named = !isTunnel && isTailnetAddress(peer) ? await whois(String(peer).replace(/^::ffff:/, '')) : undefined;
        const { token, device } = host.claim({
          code: body?.code, mode: body?.mode, name: named || body?.name, address: peer,
          duration_ms: body?.duration_ms, channel, clientPublicKey, clientId,
        });
        return sendJSON(res, 200, { token, device, host_name: name });
      }
      const fromCookie = (allowBrowser && !isTunnel && bearer(req) === undefined) ? cookieToken(req) : undefined;
      const device = host.verify(bearer(req) ?? fromCookie, isTunnel ? { clientId } : undefined);
      if (allowBrowser && !isTunnel && url.pathname === '/' && req.method === 'GET') {
        if (device !== undefined) { res.writeHead(302, { location: '/collab', 'cache-control': 'no-store' }); return res.end(); }
        // A cookie this machine no longer knows: the phone was kicked (or its time ran out).
        const headers = { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' };
        if (fromCookie !== undefined) headers['set-cookie'] = CLEAR_COOKIE;
        res.writeHead(200, headers);
        return res.end(phonePairPage({ name, kicked: fromCookie !== undefined }));
      }
      if (url.pathname === '/collab/pair/whoami' && req.method === 'GET') {
        // Answers with the device's own view, so a controller whose link was kicked can tell
        // "revoked" from "that machine is off". Same 401 shape as every other refused request.
        if (device === undefined) {
          res.writeHead(401, { 'content-type': 'application/json; charset=utf-8', 'x-collab-pair': 'revoked' });
          return res.end(JSON.stringify({ error: 'device not paired', code: 'revoked' }));
        }
        return sendJSON(res, 200, { ok: true, device: host.view(device), host_name: name });
      }
      if (url.pathname === '/collab/pair/forget' && req.method === 'POST') {
        if (isTunnel && device === undefined) {
          res.writeHead(401, { 'content-type': 'application/json; charset=utf-8', 'x-collab-pair': 'revoked' });
          return res.end(JSON.stringify({ error: 'device not paired', code: 'revoked' }));
        }
        if (device !== undefined) host.revoke(device.id);
        return sendJSON(res, 200, { ok: true });
      }
      if (device === undefined) {
        // A phone opening a page without (or with a dead) credential goes to the number page.
        if (allowBrowser && !isTunnel && wantsHTML(req) && bearer(req) === undefined) { res.writeHead(302, { location: '/', 'cache-control': 'no-store' }); return res.end(); }
        res.writeHead(401, { 'content-type': 'application/json; charset=utf-8', 'x-collab-pair': 'revoked' });
        return res.end(JSON.stringify({ error: 'device not paired', code: 'revoked' }));
      }
      // The cookie rides along on any same-site request; writes must come from this origin's pages.
      if (fromCookie !== undefined && req.method !== 'GET' && req.method !== 'HEAD' && req.headers.origin !== undefined && req.headers.origin !== `http://${req.headers.host}`) {
        return sendJSON(res, 403, { error: 'cross-origin request refused' });
      }
      // Pairing management stays with the person at this machine.
      if (url.pathname.startsWith('/collab/api/pair') || url.pathname.startsWith('/collab/api/remote') || url.pathname.startsWith(`${REMOTE_PREFIX}/`) || url.pathname === '/collab/devices') {
        return sendJSON(res, 403, { error: '配对和设备管理只能在这台电脑上操作' });
      }
      if (url.pathname !== '/collab' && !url.pathname.startsWith('/collab/')) return sendJSON(res, 404, { error: 'not found' });
      req[REMOTE_OWNER] = true;
      host.hold(device.id, res);
      if (fromCookie !== undefined && req.method === 'GET') withHTMLTail(res, KICK_WATCH);
      return await route(req, res);
    } catch (err) {
      if (err instanceof PairError) return sendJSON(res, PAIR_STATUS[err.code] ?? 400, { error: err.message, code: err.code });
      if (!res.headersSent) sendJSON(res, 500, { error: 'internal error' });
    }
  };
}

/**
 * Tailscale host listener request handler: verifies the source address is in the tailnet (or
 * loopback in tests), then delegates to dispatchHostRequest().
 * @param {{ host: PairHost, name: string, route: (req, res) => any, whois?: (ip: string) => Promise<string|undefined>, allowLoopback?: boolean }} deps
 */
export function hostHandler({ host, name, route, whois = whoisName, allowLoopback = false }) {
  const dispatch = dispatchHostRequest({ host, name, route, whois });
  return async (req, res) => {
    const peer = req.socket.remoteAddress;
    if (!isTailnetAddress(peer) && !(allowLoopback && isLoopback(peer))) return sendJSON(res, 403, { error: 'tailnet only' });
    return dispatch(req, res, { channel: 'tailscale', peer, allowBrowser: true });
  };
}

/**
 * Starts and stops the host listener on demand: on while a number is live or a device is
 * paired, off otherwise, so an idle DSH opens no port.
 */
export class PairListener {
  constructor({ host, handler, address = () => tailnetAddress(), port = PAIR_PORT, logger }) {
    this.host = host;
    this.handler = handler;
    this.address = address;
    this.port = port;
    this.logger = logger;
    this.server = undefined;
    this.bound = undefined;
  }

  /** Make sure the listener runs; returns the address it is bound to. */
  async ensure() {
    if (this.server !== undefined) return this.bound;
    const ip = await this.address();
    const server = createServer(this.handler);
    await new Promise((resolve, reject) => {
      server.once('error', err => reject(err.code === 'EADDRINUSE'
        ? new PairError('tailnet', `端口 ${this.port} 被别的程序占着，配对用不了`) : err));
      server.listen(this.port, ip, resolve);
    });
    this.server = server;
    this.bound = `${ip}:${this.port}`;
    this.logger?.info?.('conest-collab: pairing listener on %s', this.bound);
    return this.bound;
  }

  /** Stop when nothing is left to serve. */
  async settle() {
    const busy = typeof this.host.activeTailscale === 'function' ? this.host.activeTailscale() : this.host.active();
    if (this.server === undefined || busy || this.host.kickGrace?.() === true) return;
    await this.close();
    this.logger?.info?.('conest-collab: pairing listener stopped');
  }

  async close() {
    const s = this.server;
    this.server = undefined;
    this.bound = undefined;
    if (s === undefined) return;
    s.closeAllConnections?.();
    await new Promise(resolve => s.close(() => resolve()));
  }
}

/**
 * Owner routes on this machine's own DSH (/collab/api/pair/* host side, /collab/api/remote/*
 * controller side). The caller checks the owner first.
 */
export function pairApiRoute(req, res, url, { host, client, listener, tunnelHost, hostName = hostname(), peers = tailnetPeers, readJSON = readBody }) {
  const p = url.pathname.replace(/\/+$/, '');
  if (!p.startsWith('/collab/api/pair') && !p.startsWith('/collab/api/remote')) return undefined;
  const run = async () => {
    try {
      if (p === '/collab/api/pair/relay' && req.method === 'GET') {
        return sendJSON(res, 200, tunnelHost ? tunnelHost.status() : {
          channel: 'tunnel', configured: false, relay_url: null, has_admission_code: false,
          host_id: null, fingerprint: null, state: 'unconfigured', error: null, retry_at: null,
        });
      }
      if (p === '/collab/api/pair/relay' && (req.method === 'PUT' || req.method === 'POST')) {
        if (!tunnelHost) throw new PairError('mode', '当前实例未启用中继功能');
        const body = await readJSON(req);
        await tunnelHost.configure({
          relayUrl: body?.relay_url,
          admissionCode: body?.admission_code,
          clearAdmission: body?.clear_admission === true,
        });
        const settled = tunnelHost.configured ? await tunnelHost.waitForSettled(4000) : tunnelHost.status();
        return sendJSON(res, 200, settled);
      }
      if (p === '/collab/api/pair/code' && req.method === 'POST') {
        const body = req.on ? await readJSON(req).catch(() => ({})) : {};
        if (body?.channel === 'tunnel') {
          if (!tunnelHost || !tunnelHost.configured) {
            throw new PairError('relay-unconfigured', '请先在下面填写并保存中继地址');
          }
          if (!tunnelHost.connected) {
            await tunnelHost.waitForSettled(3000);
          }
          if (!tunnelHost.connected) {
            throw new PairError('relay-offline', tunnelHost.error || '还没连上中继服务器，请确认中继地址和准入码');
          }
          const issued = host.newTunnelCode();
          const link = encodeTunnelLink({
            relayUrl: tunnelHost.relayUrl,
            hostId: tunnelHost.identity.hostId,
            code: issued.code,
            expiresAt: issued.expires_at,
            name: hostName,
          }, { allowLoopback: tunnelHost.allowLoopback });
          return sendJSON(res, 200, {
            channel: 'tunnel',
            link,
            qr_svg: renderQRSvg(link),
            relay_url: tunnelHost.relayUrl,
            host_id: tunnelHost.identity.hostId,
            fingerprint: tunnelHost.identity.fingerprint,
            expires_at: issued.expires_at,
            ttl_ms: issued.ttl_ms,
            max_attempts: issued.max_attempts,
          });
        }
        const bound = await listener.ensure();
        return sendJSON(res, 200, { ...host.newCode(), listening: bound });
      }
      if (p === '/collab/api/pair/code' && req.method === 'DELETE') {
        if (url.searchParams.get('channel') === 'tunnel') {
          host.cancelTunnelCode();
          return sendJSON(res, 200, { ok: true });
        }
        host.cancelCode();
        await listener.settle();
        return sendJSON(res, 200, { ok: true });
      }
      if (p === '/collab/api/pair/code' && req.method === 'GET') {
        return sendJSON(res, 200, {
          waiting: host.codeLive(),
          expires_at: host.code?.expires_at ?? null,
          listening: listener?.bound ?? null,
          tunnel_waiting: host.tunnelCodeLive(),
          tunnel_expires_at: host.tunnelCode?.expires_at ?? null,
        });
      }
      if (p === '/collab/api/pair/devices' && req.method === 'GET') return sendJSON(res, 200, { devices: host.list() });
      const dev = /^\/collab\/api\/pair\/devices\/([0-9a-f-]{36})$/.exec(p);
      if (dev !== null && req.method === 'DELETE') {
        // No settle() here: the other machine finds out it was kicked by asking /collab/pair/whoami,
        // and closing the port in the same breath would make that look like "host is off" — the link
        // would then stay in 「我连着的电脑」 and only fail with 502 when opened. The 60 s sweep in
        // plugin.mjs closes an idle listener instead, which leaves room for that one question.
        const ok = host.revoke(dev[1]);
        return sendJSON(res, ok ? 200 : 404, ok ? { ok: true } : { error: '没有这台设备', code: 'missing' });
      }
      if (p === '/collab/api/remote/peers' && req.method === 'GET') {
        const list = await peers();
        const probed = await Promise.all(list.map(async peer => {
          const hello = peer.online ? await client.hello(peer.ip) : undefined;
          return { ...peer, dsh: hello !== undefined, waiting: hello?.waiting === true, dsh_name: hello?.name ?? null };
        }));
        probed.sort((a, b) => Number(b.waiting) - Number(a.waiting) || Number(b.dsh) - Number(a.dsh) || Number(b.online) - Number(a.online) || a.name.localeCompare(b.name));
        return sendJSON(res, 200, { peers: probed });
      }
      if (p === '/collab/api/remote/alive' && req.method === 'POST') { client.alive(); return sendJSON(res, 200, { ok: true }); }
      if (p === '/collab/api/remote/links/inspect' && req.method === 'POST') {
        const body = await readJSON(req);
        const parsed = parseTunnelLink(body?.link, { allowLoopback: true });
        return sendJSON(res, 200, {
          relay_url: parsed.relayUrl,
          host_id: parsed.hostId,
          fingerprint: parsed.fingerprint,
          expires_at: parsed.expiresAt,
          name: parsed.name || null,
        });
      }
      if (p === '/collab/api/remote/links' && req.method === 'GET') {
        // Reading the list is the moment a kicked machine must disappear from it, before the
        // person opens that link (remoteProxyRoute drops it then, too).
        await client.refresh();
        return sendJSON(res, 200, { links: client.list() });
      }
      if (p === '/collab/api/remote/links' && req.method === 'POST') {
        const body = await readJSON(req);
        if (typeof body?.tunnel_link === 'string' || body?.channel === 'tunnel') {
          const link = await client.connectTunnel({
            link: body?.tunnel_link ?? body?.link,
            mode: body?.mode,
            name: body?.name,
            duration_ms: body?.duration_ms,
          });
          return sendJSON(res, 200, { link });
        }
        const ip = String(body?.host ?? '').trim();
        if (!isTailnetAddress(ip) && !isLoopback(ip)) throw new PairError('mode', '只能连同一个 Tailscale 网络里的电脑');
        const link = await client.connect({ host: ip, port: Number.isInteger(body?.port) ? body.port : undefined, code: body?.code, mode: body?.mode, name: body?.name, duration_ms: body?.duration_ms });
        return sendJSON(res, 200, { link });
      }
      const link = /^\/collab\/api\/remote\/links\/([0-9a-f-]{36})$/.exec(p);
      if (link !== null && req.method === 'DELETE') {
        const ok = await client.disconnect(link[1]);
        return sendJSON(res, ok ? 200 : 404, ok ? { ok: true } : { error: '没有这个连接', code: 'missing' });
      }
      return sendJSON(res, 404, { error: 'not found' });
    } catch (err) {
      if (err instanceof PairError) return sendJSON(res, PAIR_STATUS[err.code] ?? 400, { error: err.message, code: err.code });
      if (err instanceof TunnelLinkError) return sendJSON(res, PAIR_STATUS[err.code] ?? 400, { error: err.message, code: err.code });
      if (err instanceof TunnelClientError) return sendJSON(res, err.status ?? PAIR_STATUS[err.code] ?? 502, { error: err.message, code: err.code });
      return sendJSON(res, 500, { error: String(err?.message ?? err) });
    }
  };
  return run();
}
