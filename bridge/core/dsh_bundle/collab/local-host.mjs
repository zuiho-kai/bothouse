// #216: later DSH windows use the existing channel host; only that host opens the store.
import { request as httpRequest } from 'node:http';
import { randomUUID } from 'node:crypto';
import { readLockOwner, lockStatus } from './instance-lock.mjs';
import { isLoopback } from './pairing.mjs';

/** Private discovery material, kept beside the lock and omitted from the diagnostic API. */
export function localConnection(webServer) {
  const url = new URL(webServer.getOrigin());
  if (url.protocol !== 'http:' || !isLoopback(url.hostname.replace(/^\[|\]$/g, ''))) return undefined;
  return { origin: url.origin, token: randomUUID() };
}

/** A forwarder proves it can read the holder's private discovery file. */
export function isLocalOwner(req, connection) {
  return connection !== undefined && isLoopback(req.socket.remoteAddress)
    && req.headers['x-collab-local'] === connection.token;
}

/** Same-origin HTTP/SSE bridge, using pairing.mjs remoteProxyRoute's streaming lifecycle. */
export function forwardLocal(req, res, lockPath, reject) {
  const denied = reject(req);
  if (denied !== undefined) return reply(res, denied, { error: '请先登录本页 DSH' });
  const status = lockStatus(lockPath);
  const record = readLockOwner(lockPath);
  const connection = status.busy && status.owner?.pid !== undefined && status.owner.pid === record?.pid ? record?.local : undefined;
  if (connection === undefined) return reply(res, 404, { error: '频道宿主无法自动连接，请查看占用提示' });
  let url;
  try {
    url = new URL(connection.origin);
    if (url.protocol !== 'http:' || !isLoopback(url.hostname.replace(/^\[|\]$/g, '')) || typeof connection.token !== 'string') throw Error('invalid local host');
  } catch {
    return reply(res, 404, { error: '频道宿主没有留下可用的本机连接信息' });
  }
  const headers = { 'x-collab-local': connection.token };
  // 来源：沿用 pairing.mjs PASS_REQUEST; neither host's browser credentials cross this bridge.
  for (const h of ['accept', 'content-type', 'content-length', 'last-event-id', 'range', 'if-none-match', 'if-modified-since']) {
    if (req.headers[h] !== undefined) headers[h] = req.headers[h];
  }
  return new Promise(resolve => {
    const up = httpRequest(url, { path: req.url, method: req.method, headers }, incoming => {
      const out = {};
      // 来源：沿用 pairing.mjs PASS_RESPONSE; no upstream cookie reaches the browser.
      for (const h of ['content-type', 'cache-control', 'etag', 'last-modified', 'content-disposition', 'content-range', 'accept-ranges', 'location']) {
        if (incoming.headers[h] !== undefined) out[h] = incoming.headers[h];
      }
      res.writeHead(incoming.statusCode, out);
      res.flushHeaders?.();
      incoming.pipe(res);
      incoming.on('end', resolve);
      incoming.on('error', () => { res.destroy(); resolve(); });
    });
    up.on('error', () => {
      if (!res.headersSent) reply(res, 404, { error: '频道宿主已断开，请查看占用提示' });
      else res.destroy();
      resolve();
    });
    req.on('aborted', () => up.destroy());
    req.on('error', () => up.destroy());
    res.on('close', () => { if (!res.writableEnded) up.destroy(); });
    req.pipe(up);
  });
}

function reply(res, status, value) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(value));
}

/** #227: where a later DSH reports which process holds the channel data. */
export const BUSY_PATH = '/collab/api/lock';

/**
 * #597 G26: a later ticket only opens workspaces (and later). Sent anywhere else, say where to go
 * instead of a bare 401, so a member does not give up; the route's own auth is unchanged.
 */
export const TICKET_WRONG_ROUTE = '这个接口不认 X-Later-Ticket 票据。建工作区请用 POST /collab/api/rooms/{id}/workspaces（同一个票据头，JSON: title, owner, reason），任务和十分钟看门会自动开，不用再调 /tasks。';

/** The 401/403 split every scoped route uses when the caller is not the owner. */
export function refuse(req, res) {
  if (req.headers?.['x-later-ticket'] !== undefined) return reply(res, 403, { error: TICKET_WRONG_ROUTE });
  return reply(res, 401, { error: 'unauthorized' });
}

/**
 * #227: the two routes a second DSH serves when another process holds the channel data.
 * It is a client of that host, never a second writer, so it publishes the holder's status and
 * forwards the channel API instead of opening the store.
 *
 * Extracted from `apply` so this branch can be tested without loading the plugin (审稿 F2:
 * `plugin.mjs` needs the DSH runtime to import, and this branch had no unit test at all).
 *
 * @param ctx - the plugin context: `webServer.register`, `effect`, `connection.requestRejection`.
 * @param lockPath - the lock file the holder took; both routes answer from it.
 */
export function mountSharedHost(ctx, lockPath) {
  ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: BUSY_PATH,
    handler: (req, res) => {
      if (ctx.connection.requestRejection(req) !== undefined) return refuse(req, res);
      return reply(res, 200, lockStatus(lockPath));
    },
  }), 'conest-collab: holder status');
  ctx.effect(() => ctx.webServer.register({ kind: 'prefix', path: '/collab',
    handler: (req, res) => forwardLocal(req, res, lockPath, req => ctx.connection.requestRejection(req)),
  }), 'conest-collab: shared local host');
}
