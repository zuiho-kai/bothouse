// CoNest collab: Discord-style channels inside a DSH Web host. Load it by
// absolute path from a --patch overlay (see dsh/README.md):
//   - insert:
//       - id: conest-collab
//         name: /abs/path/dsh/collab/plugin.mjs
//         config: { dataDir, workspacePath, botTokenEnv?, ownerName?, rooms?, dshMembers?, maxRelay? }
import { createRequire } from 'node:module';
import { readFileSync, realpathSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Store, CollabError, publicMessage } from './store.mjs';
import { Hub } from './hub.mjs';
import { CloudWebGateway, WS_PATH } from './cloudweb.mjs';
import { DshMembers } from './dsh-member.mjs';
import { Roster } from './roster.mjs';

export const name = 'conest-collab';
export const inject = [
  'webServer', 'connection', 'llm', 'agents', 'agentDefaultModel', 'agentPresets', 'permissionPresets', 'sessionTitle', 'workspaceRegistry',
];

const PAGE = readFileSync(new URL('./page.html', import.meta.url), 'utf8');
const MAX_BODY = 256 * 1024;
const OWNER = 'owner';

/** Validate the overlay config; misconfiguration fails at load. */
export function resolveConfig(config, env = process.env) {
  const c = config ?? {};
  for (const field of ['dataDir', 'workspacePath']) {
    if (typeof c[field] !== 'string' || !isAbsolute(c[field])) throw Error(`conest-collab: ${field} must be an absolute path`);
  }
  const rooms = c.rooms ?? [{ id: 1, name: 'general' }];
  if (!Array.isArray(rooms) || rooms.length === 0 || rooms.some(r => !Number.isSafeInteger(r?.id) || r.id <= 0 || typeof r.name !== 'string' || !r.name.trim())) {
    throw Error('conest-collab: rooms must be [{ id: positive integer, name }]');
  }
  const members = c.dshMembers ?? [];
  const ids = new Set();
  for (const m of members) {
    if (typeof m?.id !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,31}$/.test(m.id) || ['user', 'system', OWNER].includes(m.id) || ids.has(m.id)) {
      throw Error(`conest-collab: dshMembers id ${JSON.stringify(m?.id)} must be unique lowercase [a-z0-9_-]`);
    }
    if (typeof m.name !== 'string' || !m.name.trim()) throw Error(`conest-collab: dshMembers ${m.id} needs a name`);
    if (m.model !== undefined && (typeof m.model?.provider !== 'string' || typeof m.model?.model !== 'string')) {
      throw Error(`conest-collab: dshMembers ${m.id} model must be { provider, model }`);
    }
    if (m.persona !== undefined && typeof m.persona !== 'string') throw Error(`conest-collab: dshMembers ${m.id} persona must be text`);
    ids.add(m.id);
  }
  const maxRelay = c.maxRelay ?? 6;
  if (!Number.isSafeInteger(maxRelay) || maxRelay < 0) throw Error('conest-collab: maxRelay must be a non-negative integer');
  const botTokenEnv = c.botTokenEnv ?? 'CONEST_COLLAB_BOT_TOKEN';
  const botToken = env[botTokenEnv] ?? '';
  // Per-bot credentials: "id:secret,id:secret" in env, or a { id: secret } map in config.
  // Env wins, so a deployment can hand each bot its own secret without editing the overlay.
  const tokensEnv = c.botTokensEnv ?? 'CONEST_COLLAB_BOT_TOKENS';
  const botTokens = new Map();
  for (const [id, secret] of Object.entries(c.botTokens ?? {})) {
    if (typeof secret !== 'string' || secret === '') throw Error(`conest-collab: botTokens.${id} must be a non-empty string`);
    botTokens.set(secret, id);
  }
  for (const pair of String(env[tokensEnv] ?? '').split(',')) {
    const at = pair.indexOf(':');
    if (at < 1) continue;
    const id = pair.slice(0, at).trim();
    const secret = pair.slice(at + 1).trim();
    if (id === '' || secret === '') throw Error(`conest-collab: ${tokensEnv} entries must be "id:secret"`);
    botTokens.set(secret, id);
  }
  // No credential at all is allowed: the gateway simply stays closed. The plugin warns at
  // startup instead of failing, so a misconfigured env cannot take the whole host down.
  return {
    dataDir: c.dataDir, workspacePath: c.workspacePath, rooms, dshMembers: members, maxRelay,
    botTokenEnv, botToken, botTokens, ownerName: c.ownerName ?? '我',
  };
}

/** Resolve a package from the running DSH installation, never a second copy. */
function dshRequire() {
  return createRequire(realpathSync(process.argv[1]));
}

export async function apply(ctx, rawConfig) {
  const config = resolveConfig(rawConfig);
  const require = dshRequire();
  const { createUserMessage } = await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-llm')).href);
  // ws is CommonJS; its WebSocketServer is not a statically detectable named export.
  const { WebSocketServer } = require('ws');
  if (typeof createUserMessage !== 'function' || typeof WebSocketServer !== 'function') throw Error('conest-collab: unsupported DSH runtime');

  const store = new Store(join(config.dataDir, 'collab.sqlite3'));
  for (const room of config.rooms) store.ensureRoom(room.id, room.name.trim());
  const hub = new Hub(store, ctx.logger);
  hub.setMember({ id: OWNER, name: config.ownerName, kind: 'human', online: true });
  const gateway = new CloudWebGateway(hub, { token: config.botToken, tokens: config.botTokens, logger: ctx.logger });
  const dsh = new DshMembers(hub, { ctx, createUserMessage, workspacePath: config.workspacePath, logger: ctx.logger }, [], { maxRelay: config.maxRelay });
  const roster = new Roster(hub, dsh, ctx.llm);
  // Config members are seeds; UI-created members persist in the store. Both must be routable before recovery.
  roster.load(config.dshMembers);
  ctx.on('session/event', (session, event) => dsh.onSessionEvent(session, event));
  ctx.on('agent/inbox/claimed', ({ agent, message, turn }) => dsh.onClaimed(agent.session.id, message.id, turn));
  ctx.on('agent/inbox/discarded', ({ agent, message }) => dsh.onDiscarded(agent.session.id, message.id));
  // Queue leftover jobs before any route can add new ones, so both share one order.
  dsh.recover();
  if (!config.botToken) ctx.logger.warn(`conest-collab: ${config.botTokenEnv} is unset; cc-connect bots cannot connect`);

  const owner = req => ctx.connection.requestRejection(req) === undefined;
  const wss = new WebSocketServer({ noServer: true, maxPayload: 8 * 1024 * 1024 });
  const streams = new Set();

  ctx.effect(() => ctx.webServer.register({ kind: 'prefix', path: '/collab', handler: (req, res) => browserRoute(req, res) }), 'conest-collab: /collab');
  ctx.effect(() => ctx.webServer.register({ kind: 'prefix', path: '/api/rooms', handler: (req, res) => historyRoute(req, res) }), 'conest-collab: /api/rooms');
  ctx.effect(() => ctx.webServer.registerUpgrade({
    path: WS_PATH,
    handler: (req, socket, head) => {
      const url = new URL(req.url ?? '/', 'http://collab.invalid');
      if (!gateway.authorized(req)) {
        socket.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
        return;
      }
      wss.handleUpgrade(req, socket, head, ws => gateway.accept(ws, url, req.headers));
    },
  }), 'conest-collab: cloud-web upgrade');
  ctx.effect(() => async () => {
    gateway.closeAll();
    for (const end of streams) end();
    wss.close();
    // Drain DSH jobs first: a job still awaiting its Agent must not touch a closed store.
    await dsh.close();
    store.close();
  }, 'conest-collab: teardown');

  ctx.logger.info('conest-collab: %d room(s), %d DSH member(s), cloud-web %s', config.rooms.length, config.dshMembers.length, config.botToken ? 'on' : 'off');

  /** cc-connect ChannelHistory: GET /api/rooms/{id}/messages?before=&limit= (bot token or owner). */
  function historyRoute(req, res) {
    const url = new URL(req.url ?? '/', 'http://collab.invalid');
    const m = /^\/api\/rooms\/(\d+)\/messages$/.exec(url.pathname);
    if (req.method !== 'GET' || m === null) return json(res, 404, { error: 'not found' });
    if (!gateway.authorized(req) && !owner(req)) return json(res, 401, { error: 'unauthorized' });
    if (store.room(Number(m[1])) === undefined) return json(res, 404, { error: 'room not found' });
    // History is as private as the room. 403 (not 404, not an empty list) so a bug looks
    // like a bug instead of a quietly empty thread. Owner sessions go through their cookie.
    if (!owner(req)) {
      const who = gateway.identify(req.headers);
      const allowed = who !== undefined && (who.shared
        ? store.visibility(Number(m[1])) === 'public'
        : store.canAccess(who.memberId, Number(m[1])));
      if (!allowed) return json(res, 403, { error: 'not a member of this room' });
    }
    const before = url.searchParams.get('before');
    const rows = store.page(Number(m[1]), before === null ? undefined : Number(before), url.searchParams.get('limit'));
    return json(res, 200, { messages: rows.map(publicMessage) });
  }

  async function browserRoute(req, res) {
    if (await roomActionRoute(req, res, { owner, dsh, gateway })) return;
    const url = new URL(req.url ?? '/', 'http://collab.invalid');
    const path = url.pathname.replace(/\/+$/, '');
    if (!owner(req)) {
      if (path === '/collab' && req.method === 'GET') return text(res, 401, 'text/plain; charset=utf-8', '请先在同一个浏览器打开 DSH 网页登录，再回到 /collab。');
      return json(res, 401, { error: 'unauthorized' });
    }
    if (path === '/collab' && req.method === 'GET') return text(res, 200, 'text/html; charset=utf-8', PAGE);
    if (path === '/collab/api/state' && req.method === 'GET') {
      return json(res, 200, { me: OWNER, rooms: store.rooms(), members: hub.memberView(), thinking: Object.fromEntries([...hub.thinking].map(([k, v]) => [k, [...v]])), room_controls: store.rooms().map(r => store.control(r.id)) });
    }
    if (path === '/collab/api/events' && req.method === 'GET') return events(req, res);
    const m = /^\/collab\/api\/rooms\/(\d+)\/messages$/.exec(path);
    if (m !== null && req.method === 'GET') {
      const roomId = Number(m[1]);
      if (store.room(roomId) === undefined) return json(res, 404, { error: 'room not found' });
      const after = url.searchParams.get('after');
      const before = url.searchParams.get('before');
      const rows = after !== null ? store.since(roomId, Number(after), url.searchParams.get('limit'))
        : store.page(roomId, before === null ? undefined : Number(before), url.searchParams.get('limit'));
      return json(res, 200, { messages: rows.map(publicMessage) });
    }
    if (m !== null && req.method === 'POST') {
      return withBody(req, res, (body) => {
        const clientKey = typeof body?.client_key === 'string' && body.client_key ? `web:${body.client_key.slice(0, 64)}` : undefined;
        const { message } = hub.post(Number(m[1]), { authorKind: 'user', author: OWNER, name: config.ownerName, text: String(body?.text ?? ''), clientKey });
        return { message: publicMessage(message) };
      });
    }
    if (path === '/collab/api/models' && req.method === 'GET') return json(res, 200, { routes: await roster.models() });
    if (path === '/collab/api/rooms' && req.method === 'POST') {
      return withBody(req, res, (body) => {
        const name = String(body?.name ?? '').trim().replace(/^#/, '');
        if (!name || name.length > 32 || /\s/.test(name)) throw new CollabError('invalid', 'room name must be 1-32 characters without spaces');
        const room = store.createRoom(name);
        hub.emit({ type: 'rooms', rooms: store.rooms() });
        return { room };
      });
    }
    if (path === '/collab/api/members' && req.method === 'POST') {
      return withBody(req, res, async body => ({ member: await roster.create(body) }));
    }
    const mm = /^\/collab\/api\/members\/([^/]+)$/.exec(path);
    if (mm !== null && req.method === 'PATCH') {
      return withBody(req, res, async body => ({ member: await roster.update(decodeURIComponent(mm[1]), body) }));
    }
    if (mm !== null && req.method === 'DELETE') {
      return withBody(req, res, () => { roster.remove(decodeURIComponent(mm[1])); return { ok: true }; }, false);
    }
    return json(res, 404, { error: 'not found' });
  }

  function events(req, res) {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
    res.write(': connected\n\n');
    const unsubscribe = hub.subscribe(event => res.write(`data: ${JSON.stringify(event)}\n\n`));
    const ping = setInterval(() => res.write(': ping\n\n'), 25_000);
    const end = () => { clearInterval(ping); unsubscribe(); streams.delete(end); res.end(); };
    streams.add(end);
    req.on('close', end);
  }
}

const ERROR_STATUS = { 'room-missing': 404, 'member-missing': 404, conflict: 409, 'read-only': 403 };

/** Owner-only actions, shared by the HTTP host and isolated integration tests. */
export async function roomActionRoute(req, res, { owner, dsh, gateway }) {
  const path = new URL(req.url ?? '/', 'http://collab.invalid').pathname.replace(/[/]+$/, '');
  const match = /^[/]collab[/]api[/]rooms[/]([0-9]+)[/](stop|continue)$/.exec(path);
  if (match === null) return false;
  if (!owner(req)) { json(res, 401, { error: 'unauthorized' }); return true; }
  if (req.method !== 'POST') { json(res, 405, { error: 'method not allowed' }); return true; }
  await withBody(req, res, async () => {
    const roomId = Number(match[1]);
    dsh.requireRoom(roomId);
    if (match[2] === 'continue') return dsh.continueRoom(roomId);
    // Ask the gateway first: it knows which non-DSH members are streaming output right now.
    const outputOnly = gateway.stopRoom(roomId) ?? [];
    const stopping = dsh.stopRoom(roomId, { outputOnly });
    return { ...await stopping, output_only: outputOnly };
  }, false);
  return true;
}

/** Parse a JSON body (unless `parse` is false), run fn, and map CollabError codes to HTTP statuses. */
async function withBody(req, res, fn, parse = true) {
  let body;
  if (parse) {
    try { body = JSON.parse((await readBody(req)) || '{}'); } catch { return json(res, 400, { error: 'invalid JSON body' }); }
  }
  try {
    return json(res, 200, await fn(body));
  } catch (error) {
    if (error instanceof CollabError) return json(res, ERROR_STATUS[error.code] ?? 400, { error: error.message, code: error.code });
    throw error;
  }
}

function json(res, status, value) { text(res, status, 'application/json; charset=utf-8', JSON.stringify(value)); }

function text(res, status, type, body) {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) { reject(Error('body too large')); req.destroy(); return; }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}
