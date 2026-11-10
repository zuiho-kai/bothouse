// The bothouse management panel inside DSH (#105): the sidebar's "bothouse" entry frames
// /collab/panel/, and this owner-only route forwards it to the bridge management server.
//
// The panel API needs the management token. The browser must not hold it, so on each
// request the route reads [management] from the bridge config file and signs the upstream
// call itself. The panel page learns it is behind such a proxy from an injected
// <meta name="bothouse-auth" content="proxy">, and <base href> is rewritten to the mount
// path so its relative asset and API URLs land back here (bridge/web/src/lib/basePath.ts).
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';

export const PANEL_PREFIX = '/collab/panel';
// 来源：bothouse 管理接口默认端口（bridge config.example.toml [management] port）
const DEFAULT_PORT = 9820;
// Request headers the panel page may pass upstream; everything else (cookies, Authorization,
// Origin, Host) stays on this side.
const PASS_REQUEST = ['accept', 'accept-language', 'content-type', 'if-none-match', 'if-modified-since', 'range'];
// Response headers worth keeping; Set-Cookie and CORS headers from the panel are dropped.
const PASS_RESPONSE = ['content-type', 'cache-control', 'etag', 'last-modified', 'content-disposition', 'content-range', 'accept-ranges'];

/**
 * Default bridge config path: $BOTHOUSE_CONFIG, else <data dir>/config.toml.
 * @param {NodeJS.ProcessEnv} env
 * @returns {string}
 */
export function defaultBridgeConfig(env = process.env) {
  const explicit = String(env.BOTHOUSE_CONFIG ?? '').trim();
  if (explicit !== '') return explicit;
  const dataDir = String(env.BOTHOUSE_DATA_DIR ?? '').trim() || join(env.HOME || homedir(), '.bothouse');
  return join(dataDir, 'config.toml');
}

/** Value of one TOML scalar (quoted string, number or bare word); comments stripped. */
function scalar(raw) {
  const s = raw.trim();
  const quoted = /^"((?:[^"\\]|\\.)*)"|^'([^']*)'/.exec(s);
  if (quoted !== null) return quoted[1] !== undefined ? JSON.parse(`"${quoted[1]}"`) : quoted[2];
  return s.replace(/\s+#.*$/, '').trim();
}

/**
 * Read host/port/token/enabled from the [management] table of a bridge config.
 * Only flat `key = value` lines are needed, so a full TOML parser is not pulled in.
 * @param {string} text - config.toml contents.
 * @returns {{ enabled: boolean, host: string, port: number, token: string }}
 */
export function managementSettings(text) {
  const out = { enabled: false, host: '', port: DEFAULT_PORT, token: '' };
  let inside = false;
  for (const line of text.split(/\r?\n/)) {
    const header = /^\s*\[\s*([^\]]+?)\s*\]/.exec(line);
    if (header !== null) { inside = header[1] === 'management'; continue; }
    if (!inside) continue;
    const kv = /^\s*([A-Za-z_][A-Za-z0-9_-]*)\s*=\s*(.*)$/.exec(line);
    if (kv === null) continue;
    const value = scalar(kv[2]);
    if (kv[1] === 'enabled') out.enabled = value === 'true';
    else if (kv[1] === 'host') out.host = String(value);
    else if (kv[1] === 'port' && Number.isInteger(Number(value)) && Number(value) > 0) out.port = Number(value);
    else if (kv[1] === 'token') out.token = String(value);
  }
  return out;
}

/** Loopback address to dial for a configured listen host. */
function dialHost(host) {
  if (host === '' || host === '0.0.0.0' || host === '::' || host === '[::]') return '127.0.0.1';
  return host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
}

function sendJSON(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

const escapeHTML = v => String(v).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

/**
 * Page shown inside the frame when the panel cannot be reached: what is wrong, what to do,
 * and a retry button, so a DSH-only user who switched the panel on is not left at a dead end.
 */
function sendNotice(res, status, reason, help) {
  res.writeHead(status, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
  // #579: same look as the panel itself (bridge/web/src/index.css --ui-*): white canvas, 12px card
  // with a 1px hairline, ink ramp, and the same values again for dark mode.
  res.end(`<!doctype html><meta charset="utf-8"><title>bothouse</title><meta name="color-scheme" content="light dark">`
    + `<style>:root{--c:#fff;--s:#fff;--l:#e6e9ef;--i:#17181b;--m:#5a5a55;--a:#16a34a}`
    + `@media (prefers-color-scheme:dark){:root{--c:#0d0d0f;--s:#16171a;--l:#2c2e34;--i:#eceef2;--m:#a5aab4;--a:#3dd68c}}`
    + `body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--c);color:var(--m);font:14px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif}`
    + `main{box-sizing:border-box;width:min(520px,calc(100% - 32px));padding:24px;border:1px solid var(--l);border-radius:12px;background:var(--s)}`
    + `h3{margin:0 0 8px;font-size:16px;font-weight:600;color:var(--i)}p{margin:0 0 8px}`
    + `button{margin-top:8px;font:inherit;font-weight:500;height:36px;padding:0 14px;border-radius:8px;border:1px solid var(--l);background:var(--s);color:var(--i);cursor:pointer}`
    + `button:hover{border-color:var(--m)}button:focus-visible{outline:2px solid var(--a);outline-offset:2px}</style>`
    + `<main>`
    + `<h3>打不开 bothouse 面板</h3>`
    + `<p>${escapeHTML(reason)}</p>`
    + (help ? `<p>${escapeHTML(help)}</p>` : '')
    + `<button type="button" onclick="location.reload()">重试</button>`
    + `</main>`);
}

/**
 * Point the panel page at the mount path and mark it as proxy-signed.
 * @param {string} html - the panel's index.html.
 * @param {string} prefix - mount path, e.g. /collab/panel.
 * @returns {string}
 */
export function rewritePanelHTML(html, prefix = PANEL_PREFIX) {
  // The page may itself sit under another proxy's prefix: the bridge management server mounts
  // the whole DSH site at /dsh/ (core/management_dsh_proxy.go) and strips it before DSH sees the
  // request, so this route cannot know it. A fixed <base href="/collab/panel/"> then sends the
  // panel's scripts to the management server's own /collab/panel/..., which answers with its
  // index.html, and the frame stays blank. The inline script moves <base> to wherever the page
  // was actually loaded from, before any asset URL is resolved (it runs ahead of the panel's
  // module scripts, and basePath.ts reads document.baseURI only when they run).
  const mount = JSON.stringify(`${prefix}/`).replace(/</g, '\\u003c');
  const fix = `<script>(()=>{const m=${mount},p=location.pathname,i=p.indexOf(m);if(i>0)document.querySelector("base").setAttribute("href",p.slice(0,i)+m)})()</script>`;
  const head = `<base href="${prefix}/" />${fix}\n    <meta name="bothouse-auth" content="proxy" />`;
  if (/<base\s[^>]*>/i.test(html)) return html.replace(/<base\s[^>]*>/i, head);
  return html.replace(/<head(\s[^>]*)?>/i, m => `${m}\n    ${head}`);
}

/**
 * Forward /collab/panel/* to the bridge management server. Callers must have checked the owner.
 * @returns {Promise<true> | undefined} undefined when the path is not ours.
 */
export function panelRoute(req, res, url, { bridgeConfig, fetchImpl = fetch }) {
  if (url.pathname !== PANEL_PREFIX && !url.pathname.startsWith(`${PANEL_PREFIX}/`)) return undefined;
  if (url.pathname === PANEL_PREFIX) {
    res.writeHead(308, { location: `${PANEL_PREFIX}/${url.search}` });
    res.end();
    return Promise.resolve(true);
  }
  return (async () => {
    const rest = url.pathname.slice(PANEL_PREFIX.length) || '/';
    const isAPI = rest.startsWith('/api/');
    const fail = (status, reason, help) => (isAPI ? sendJSON(res, status, { ok: false, error: reason }) : sendNotice(res, status, reason, help), true);
    let settings;
    try {
      settings = managementSettings(readFileSync(bridgeConfig, 'utf8'));
    } catch {
      return fail(503, `这台电脑没找到 bothouse：读不到 ${bridgeConfig}`,
        '这个面板管理完整版 bothouse 的角色、用量和设置。装好 bothouse 并启动一次后点「重试」；只用频道的话，可以在「插件 → bothouse」里关掉「bothouse 面板」这一项。');
    }
    if (!settings.enabled) return fail(503, `bothouse 的管理接口没打开：${bridgeConfig} 里 [management] 没有 enabled = true`,
      '在那一节写上 enabled = true，重启 bothouse 后点「重试」。');
    const upstream = `http://${dialHost(settings.host)}:${settings.port}${rest}${url.search}`;
    const headers = {};
    for (const name of PASS_REQUEST) {
      const v = req.headers[name];
      if (typeof v === 'string') headers[name] = v;
    }
    if (settings.token !== '') headers.authorization = `Bearer ${settings.token}`;
    const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
    let reply;
    try {
      reply = await fetchImpl(upstream, {
        method: req.method,
        headers,
        body: hasBody ? Readable.toWeb(req) : undefined,
        duplex: hasBody ? 'half' : undefined,
        redirect: 'manual',
      });
    } catch {
      return fail(502, `bothouse 没在运行：连不上 ${dialHost(settings.host)}:${settings.port}`, '启动 bothouse 后点「重试」。');
    }
    const out = {};
    for (const name of PASS_RESPONSE) {
      const v = reply.headers.get(name);
      if (v !== null) out[name] = v;
    }
    const type = reply.headers.get('content-type') ?? '';
    if (!isAPI && type.startsWith('text/html')) {
      const html = rewritePanelHTML(await reply.text());
      res.writeHead(reply.status, { ...out, 'cache-control': 'no-store' });
      res.end(html);
      return true;
    }
    res.writeHead(reply.status, out);
    if (reply.body === null || req.method === 'HEAD') { res.end(); return true; }
    // Stream so NDJSON/SSE answers (plugin install, logs) arrive as they are produced.
    const body = Readable.fromWeb(reply.body);
    body.on('error', () => res.destroy());
    req.on('close', () => body.destroy());
    body.pipe(res);
    return true;
  })();
}
