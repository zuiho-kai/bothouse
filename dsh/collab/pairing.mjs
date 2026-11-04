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

// 来源：用户 11-04 16:4x 认可的 C酱 方案，示例码「482 913」为 6 位数字、只能用一次。
export const CODE_DIGITS = 6;
// 来源：用户 11-04 16:58 定「数字码 5 分钟有效」。
export const CODE_TTL_MS = 5 * 60_000;
// 来源：用户 11-04 16:58 定「输错 5 次作废」。
export const MAX_ATTEMPTS = 5;
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

const TAILSCALE_BINS = ['tailscale', '/opt/homebrew/bin/tailscale', '/usr/local/bin/tailscale', '/Applications/Tailscale.app/Contents/MacOS/Tailscale'];
// 沿用 plugin.mjs MAX_BODY（256 KiB）。
const MAX_PAIR_BODY = 256 * 1024;

/** Error with a code the routes turn into an HTTP status and a plain-language message. */
export class PairError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}
// 来源：HTTP 状态码语义（RFC 9110 / RFC 6585 429）。
export const PAIR_STATUS = { 'no-code': 410, expired: 410, wrong: 403, locked: 429, mode: 400, unreachable: 502, refused: 403, missing: 404, tailnet: 503 };

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
    this.devices = new Map();
    // Responses still open per device (event streams, proxied requests): cut when it is dropped,
    // so kicking a device ends what it already holds, not only its next request.
    this.open = new Map();
    const saved = loadJSON(file);
    for (const d of Array.isArray(saved?.devices) ? saved.devices : []) {
      if (typeof d?.id === 'string' && typeof d.token_hash === 'string') this.devices.set(d.id, { ...d, mode: 'remember', expires_at: null });
    }
  }

  /** A fresh number; any earlier one stops working. */
  newCode() {
    // 10^CODE_DIGITS numbers, leading zeros kept.
    const code = String(randomInt(0, 10 ** CODE_DIGITS)).padStart(CODE_DIGITS, '0');
    this.code = { hash: sha256(code), expires_at: this.now() + this.codeTtl, attempts: 0 };
    return { code, expires_at: this.code.expires_at, ttl_ms: this.codeTtl, max_attempts: MAX_ATTEMPTS };
  }

  cancelCode() { this.code = undefined; }

  /** Whether a number is waiting to be typed in. */
  codeLive() {
    if (this.code !== undefined && this.code.expires_at <= this.now()) this.code = undefined;
    return this.code !== undefined;
  }

  /**
   * Check a typed number and, if right, let the device in.
   * @param {{ code: string, mode: string, name: string, address?: string, duration_ms?: number|null }} claim
   * @returns {{ token: string, device: object }}
   */
  claim({ code, mode, name, address, duration_ms }) {
    if (!MODES.includes(mode)) throw new PairError('mode', '连接方式只能是「临时」或「记住这台电脑」');
    const duration = tempDuration(mode, duration_ms);
    if (this.code === undefined) throw new PairError('no-code', '那台电脑现在没有在等配对，请在那台电脑上点「让别的电脑连我」');
    if (this.code.expires_at <= this.now()) { this.code = undefined; throw new PairError('expired', '这串数字已过期，请在那台电脑上重新生成'); }
    const typed = String(code ?? '').replace(/\D/g, '');
    if (!sameHash(sha256(typed), this.code.hash)) {
      this.code.attempts += 1;
      const left = MAX_ATTEMPTS - this.code.attempts;
      if (left <= 0) { this.code = undefined; throw new PairError('locked', '输错次数太多，这串数字已作废，请在那台电脑上重新生成'); }
      throw new PairError('wrong', `数字不对，还能再试 ${left} 次`);
    }
    this.code = undefined;
    const token = randomBytes(32).toString('base64url');
    const now = this.now();
    const device = {
      id: randomUUID(), name: String(name ?? '').trim().slice(0, 80) || '另一台电脑', address: String(address ?? ''),
      mode, token_hash: sha256(token).toString('hex'), created_at: now, last_seen: now,
      expires_at: duration === null ? null : now + duration,
    };
    this.devices.set(device.id, device);
    if (mode === 'remember') this.save();
    return { token, device: this.view(device) };
  }

  /** The device a credential belongs to, or undefined (unknown, revoked or expired). */
  verify(token) {
    if (typeof token !== 'string' || token === '') return undefined;
    const hash = sha256(token);
    for (const d of this.devices.values()) {
      if (!sameHash(Buffer.from(d.token_hash, 'hex'), hash)) continue;
      if (d.expires_at !== null && d.expires_at <= this.now()) { this.drop(d.id); return undefined; }
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

  view(d) { return { id: d.id, name: d.name, address: d.address, mode: d.mode, created_at: d.created_at, last_seen: d.last_seen, expires_at: d.expires_at }; }

  save() {
    saveJSON(this.file, { devices: [...this.devices.values()].filter(d => d.mode === 'remember')
      .map(({ id, name, address, token_hash, created_at, last_seen }) => ({ id, name, address, token_hash, created_at, last_seen })) });
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

/** Other machines in the tailnet: [{ name, ip, online, os }]. */
export async function tailnetPeers(run = tailscale) {
  const status = JSON.parse(await run(['status', '--json']));
  return Object.values(status?.Peer ?? {}).map(p => ({
    name: String(p.HostName || p.DNSName || '').trim() || '未命名电脑',
    ip: (p.TailscaleIPs ?? []).find(isTailnetAddress) ?? p.TailscaleIPs?.[0],
    online: p.Online === true, os: String(p.OS ?? ''),
  })).filter(p => p.ip);
}

/** Small JSON request to another machine. */
export function requestJSON({ host, port, path, method = 'GET', body, headers = {}, timeout = 4000 }) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const req = httpRequest({ host, port, path, method, timeout,
      headers: { accept: 'application/json', ...(payload ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) } : {}), ...headers } }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        let value;
        try { value = JSON.parse(Buffer.concat(chunks).toString('utf8') || 'null'); } catch { value = undefined; }
        resolve({ status: res.statusCode ?? 0, body: value });
      });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    req.end(payload);
  });
}

/**
 * Controller side: machines this DSH paired with. Remembered links persist (the credential has
 * to, file mode 0600); temporary ones live in memory only.
 */
export class PairClient {
  constructor({ file, now = Date.now, port = PAIR_PORT, request = requestJSON, name = hostname(), grace = UNTIL_GRACE_MS }) {
    this.grace = grace;
    this.file = file;
    this.now = now;
    this.port = port;
    this.request = request;
    this.name = name;
    this.links = new Map();
    this.refreshing = undefined;
    const saved = loadJSON(file);
    for (const l of Array.isArray(saved?.links) ? saved.links : []) {
      if (typeof l?.id === 'string' && typeof l.token === 'string' && typeof l.host === 'string') this.links.set(l.id, { ...l, mode: 'remember', expires_at: null });
    }
  }

  /** Ask a host whether it runs DSH pairing and is waiting for a number. */
  async hello(host, port = this.port) {
    try {
      const r = await this.request({ host, port, path: '/collab/pair/hello', timeout: 1500 });
      return r.status === 200 && r.body?.app === 'dsh-collab' ? r.body : undefined;
    } catch { return undefined; }
  }

  /** Send the number once; on success keep the credential. */
  async connect({ host, port = this.port, code, mode, name, duration_ms }) {
    if (!MODES.includes(mode)) throw new PairError('mode', '连接方式只能是「临时」或「记住这台电脑」');
    const duration = tempDuration(mode, duration_ms);
    let r;
    try {
      r = await this.request({ host, port, path: '/collab/pair/claim', method: 'POST', body: { code: String(code ?? ''), mode, name: this.name, duration_ms: duration } });
    } catch {
      throw new PairError('unreachable', '连不上那台电脑：确认它开着 DSH、连着 Tailscale，并且点了「让别的电脑连我」');
    }
    if (r.status !== 200 || typeof r.body?.token !== 'string') {
      throw new PairError(r.body?.code ?? 'refused', r.body?.error ?? '那台电脑拒绝了配对');
    }
    const link = { id: randomUUID(), name: String(name || r.body.host_name || host), host, port, token: r.body.token,
      mode, created_at: this.now(), expires_at: r.body.device?.expires_at ?? null, alive_at: this.now() };
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
          const r = await this.request({ host: l.host, port: l.port, path: '/collab/pair/whoami', headers: { authorization: `Bearer ${l.token}` }, timeout: 1500 })
            .catch(() => undefined);
          if (r?.status === 401 && r.body?.code === 'revoked') { this.drop(l.id); dropped.push(l.id); }
        }));
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
    try { await this.request({ host: l.host, port: l.port, path: '/collab/pair/forget', method: 'POST', headers: { authorization: `Bearer ${l.token}` }, timeout: 2000 }); } catch { /* host off: it expires or is kicked there */ }
    return true;
  }

  /** The host dropped this device: forget it here too. */
  drop(id) {
    const l = this.links.get(id);
    if (l === undefined) return;
    this.links.delete(id);
    if (l.mode === 'remember') this.save();
  }

  view(l) { return { id: l.id, name: l.name, host: l.host, mode: l.mode, created_at: l.created_at, expires_at: l.expires_at }; }

  save() {
    saveJSON(this.file, { links: [...this.links.values()].filter(l => l.mode === 'remember')
      .map(({ id, name, host, port, token, created_at }) => ({ id, name, host, port, token, created_at })) });
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
 * Forward one controller request under /collab/remote/<id>/ to the paired host.
 * @returns {Promise<void>|undefined} undefined when the path is not a remote path.
 */
export function remoteProxyRoute(req, res, url, { client, request = httpRequest }) {
  if (url.pathname !== REMOTE_PREFIX && !url.pathname.startsWith(`${REMOTE_PREFIX}/`)) return undefined;
  const m = /^\/collab\/remote\/([0-9a-f-]{36})(\/.*)?$/.exec(url.pathname);
  const link = m === null ? undefined : client.get(m[1]);
  if (link === undefined) return Promise.resolve(sendError(req, res, 404, { error: '没有这个连接，可能已断开，请重新连接', code: 'missing' }));
  const mount = `${REMOTE_PREFIX}/${link.id}`;
  if (m[2] === undefined) { res.writeHead(308, { location: `${mount}/${url.search}` }); res.end(); return Promise.resolve(); }
  const rest = m[2] === '/' ? '' : m[2];
  const headers = { authorization: `Bearer ${link.token}` };
  for (const h of PASS_REQUEST) if (req.headers[h] !== undefined) headers[h] = req.headers[h];
  return new Promise(resolve => {
    const up = request({ host: link.host, port: link.port, method: req.method, path: `/collab${rest}${url.search}`, headers }, upRes => {
      const status = upRes.statusCode ?? 502;
      if (status === 401 && upRes.headers['x-collab-pair'] === 'revoked') {
        client.drop(link.id);
        upRes.resume();
        sendError(req, res, 401, { error: '连接已断开（那台电脑点了断开、把这台移出，或临时连接到时间了），请重新配对', code: 'revoked' });
        return resolve();
      }
      const out = {};
      for (const h of PASS_RESPONSE) if (upRes.headers[h] !== undefined) out[h] = upRes.headers[h];
      if (status >= 300 && status < 400 && typeof upRes.headers.location === 'string') {
        out.location = upRes.headers.location.replace(/^\/collab(?=\/|$)/, mount);
      }
      if (String(upRes.headers['content-type'] ?? '').startsWith('text/html')) {
        const chunks = [];
        upRes.on('data', c => chunks.push(c));
        upRes.on('end', () => {
          const body = Buffer.from(rewriteRemoteHTML(Buffer.concat(chunks).toString('utf8'), mount));
          res.writeHead(status, { ...out, 'content-length': body.length });
          res.end(body);
          resolve();
        });
        upRes.on('error', () => { res.destroy(); resolve(); });
        return;
      }
      res.writeHead(status, out);
      res.flushHeaders?.();
      upRes.pipe(res);
      upRes.on('end', resolve);
      upRes.on('error', () => { res.destroy(); resolve(); });
    });
    up.on('error', () => {
      if (!res.headersSent) sendError(req, res, 502, { error: '连不上那台电脑：它可能关机、DSH 没开、Tailscale 断了，或已经把这台踢掉', code: 'unreachable' });
      else res.destroy();
      resolve();
    });
    // Stop the upstream stream (SSE) when the page goes away.
    res.on('close', () => { if (!res.writableEnded) up.destroy(); });
    req.pipe(up);
  });
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

/**
 * Host listener request handler: pairing endpoints for anyone in the tailnet, everything else
 * under /collab only with a device credential, handed to the plugin's own route as the owner.
 * @param {{ host: PairHost, name: string, route: (req, res) => any, whois?: (ip: string) => Promise<string|undefined>, allowLoopback?: boolean }} deps
 */
export function hostHandler({ host, name, route, whois = whoisName, allowLoopback = false }) {
  return async (req, res) => {
    const peer = req.socket.remoteAddress;
    if (!isTailnetAddress(peer) && !(allowLoopback && isLoopback(peer))) return sendJSON(res, 403, { error: 'tailnet only' });
    const url = new URL(req.url ?? '/', 'http://pair.invalid');
    try {
      if (url.pathname === '/collab/pair/hello' && req.method === 'GET') {
        return sendJSON(res, 200, { app: 'dsh-collab', name, waiting: host.codeLive() });
      }
      if (url.pathname === '/collab/pair/claim' && req.method === 'POST') {
        const body = await readBody(req);
        const named = isTailnetAddress(peer) ? await whois(String(peer).replace(/^::ffff:/, '')) : undefined;
        const { token, device } = host.claim({ code: body?.code, mode: body?.mode, name: named || body?.name, address: peer, duration_ms: body?.duration_ms });
        return sendJSON(res, 200, { token, device, host_name: name });
      }
      const device = host.verify(bearer(req));
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
        if (device !== undefined) host.revoke(device.id);
        return sendJSON(res, 200, { ok: true });
      }
      if (device === undefined) {
        res.writeHead(401, { 'content-type': 'application/json; charset=utf-8', 'x-collab-pair': 'revoked' });
        return res.end(JSON.stringify({ error: 'device not paired', code: 'revoked' }));
      }
      // Pairing management stays with the person at this machine.
      if (url.pathname.startsWith('/collab/api/pair') || url.pathname.startsWith('/collab/api/remote') || url.pathname.startsWith(`${REMOTE_PREFIX}/`) || url.pathname === '/collab/devices') {
        return sendJSON(res, 403, { error: '配对和设备管理只能在这台电脑上操作' });
      }
      if (url.pathname !== '/collab' && !url.pathname.startsWith('/collab/')) return sendJSON(res, 404, { error: 'not found' });
      req[REMOTE_OWNER] = true;
      host.hold(device.id, res);
      return await route(req, res);
    } catch (err) {
      if (err instanceof PairError) return sendJSON(res, PAIR_STATUS[err.code] ?? 400, { error: err.message, code: err.code });
      if (!res.headersSent) sendJSON(res, 500, { error: 'internal error' });
    }
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
    if (this.server === undefined || this.host.active()) return;
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
export function pairApiRoute(req, res, url, { host, client, listener, peers = tailnetPeers, readJSON = readBody }) {
  const p = url.pathname.replace(/\/+$/, '');
  if (!p.startsWith('/collab/api/pair') && !p.startsWith('/collab/api/remote')) return undefined;
  const run = async () => {
    try {
      if (p === '/collab/api/pair/code' && req.method === 'POST') {
        const bound = await listener.ensure();
        return sendJSON(res, 200, { ...host.newCode(), listening: bound });
      }
      if (p === '/collab/api/pair/code' && req.method === 'DELETE') {
        host.cancelCode();
        await listener.settle();
        return sendJSON(res, 200, { ok: true });
      }
      if (p === '/collab/api/pair/code' && req.method === 'GET') {
        return sendJSON(res, 200, { waiting: host.codeLive(), expires_at: host.code?.expires_at ?? null, listening: listener.bound ?? null });
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
      if (p === '/collab/api/remote/links' && req.method === 'GET') {
        // Reading the list is the moment a kicked machine must disappear from it, before the
        // person opens that link (remoteProxyRoute drops it then, too).
        await client.refresh();
        return sendJSON(res, 200, { links: client.list() });
      }
      if (p === '/collab/api/remote/links' && req.method === 'POST') {
        const body = await readJSON(req);
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
      return sendJSON(res, 500, { error: String(err?.message ?? err) });
    }
  };
  return run();
}
