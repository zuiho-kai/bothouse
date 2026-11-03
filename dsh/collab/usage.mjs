// Token usage for the DSH sidebar "Usage" panel (#105).
//
// The numbers live in the bridge's usage ledger behind the management API
// (bridge/core/management_usage.go, GET /api/v1/usage/{daily|hourly|roles|models}),
// which needs the management token. The browser must not hold that token, so this
// owner-only route reads [management] from the bridge config file on each request
// and forwards the query server-side; only the JSON body goes back to the page.
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const GROUPS = new Set(['daily', 'hourly', 'roles', 'models']);
const PARAMS = ['from', 'to', 'role', 'model'];
// 来源：bothouse 管理接口默认端口（bridge config.example.toml [management] port）
const DEFAULT_PORT = 9820;

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

function send(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}

/**
 * GET /collab/api/usage/{group}: forward to the bridge management usage API.
 * Callers must have checked the owner already.
 * @returns {Promise<true> | undefined} undefined when the path is not ours.
 */
export function usageRoute(req, res, url, { bridgeConfig, fetchImpl = fetch }) {
  const m = /^\/collab\/api\/usage\/([a-z]+)\/?$/.exec(url.pathname);
  if (m === null || req.method !== 'GET') return undefined;
  return (async () => {
    if (!GROUPS.has(m[1])) return send(res, 404, { error: 'not found' }), true;
    let settings;
    try {
      settings = managementSettings(readFileSync(bridgeConfig, 'utf8'));
    } catch {
      return send(res, 503, { error: 'usage-unavailable', reason: 'bridge config not readable' }), true;
    }
    if (!settings.enabled) return send(res, 503, { error: 'usage-unavailable', reason: 'management API is disabled in the bridge config' }), true;
    const upstream = new URL(`http://${dialHost(settings.host)}:${settings.port}/api/v1/usage/${m[1]}`);
    for (const key of PARAMS) {
      const v = url.searchParams.get(key);
      if (v !== null && v !== '') upstream.searchParams.set(key, v);
    }
    const headers = settings.token === '' ? {} : { authorization: `Bearer ${settings.token}` };
    try {
      const reply = await fetchImpl(upstream, { headers, signal: AbortSignal.timeout(15_000) });
      const body = await reply.text();
      if (reply.ok) {
        // mgmtJSON wraps answers as { ok, data } (bridge/core/management.go); the page wants data.
        let parsed;
        try { parsed = JSON.parse(body); } catch { return send(res, 502, { error: 'usage-upstream', reason: 'bridge answered non-JSON' }), true; }
        return send(res, 200, parsed !== null && typeof parsed === 'object' && 'data' in parsed ? parsed.data : parsed), true;
      }
      // Upstream errors are short plain text (bad date range etc.); never echo request headers.
      return send(res, reply.status === 401 ? 502 : reply.status, { error: 'usage-upstream', status: reply.status, reason: body.slice(0, 200).trim() }), true;
    } catch {
      return send(res, 502, { error: 'usage-unavailable', reason: 'bridge management API not reachable' }), true;
    }
  })();
}
