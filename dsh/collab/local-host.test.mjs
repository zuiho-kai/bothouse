import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtempSync, statSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { InstanceLock, writeLockOwner, lockStatus } from './instance-lock.mjs';
import { localConnection, isLocalOwner, forwardLocal, mountSharedHost, BUSY_PATH, refuse } from './local-host.mjs';
import { Store } from './store.mjs';

async function listen(t, handler) {
  const server = createServer(handler);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  return 'http://127.0.0.1:' + server.address().port;
}

function holder(t, local) {
  const path = join(mkdtempSync(join(tmpdir(), 'collab-local-')), 'collab.lock');
  const lock = InstanceLock.acquire(path);
  t.after(() => lock.release());
  writeLockOwner(path, { pid: process.pid, local });
  return path;
}

test('automatic sharing stays on loopback and keeps discovery private', t => {
  const local = localConnection({ getOrigin: () => 'http://127.0.0.1:1234' });
  assert.ok(local.token);
  assert.equal(localConnection({ getOrigin: () => 'http://192.168.1.2:1234' }), undefined);
  assert.equal(localConnection({ getOrigin: () => 'https://127.0.0.1:1234' }), undefined);
  const path = holder(t, local);
  assert.equal(lockStatus(path).owner.local, undefined);
  assert.equal(statSync(join(path, '../collab.owner.json')).mode & 0o777, 0o600);
  assert.equal(isLocalOwner({ socket: { remoteAddress: '127.0.0.1' }, headers: { 'x-collab-local': local.token } }, local), true);
  assert.equal(isLocalOwner({ socket: { remoteAddress: '192.168.1.2' }, headers: { 'x-collab-local': local.token } }, local), false);
});

test('later host forwards body and query, preserves sign-in, and does not forward browser credentials', async t => {
  let observed;
  const upstream = await listen(t, async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    observed = { body, url: req.url, headers: req.headers };
    res.writeHead(201, { 'content-type': 'application/json', 'set-cookie': 'upstream-secret=hidden' });
    res.end(JSON.stringify({ id: 1 }));
  });
  const local = localConnection({ getOrigin: () => upstream });
  const path = holder(t, local);
  const second = await listen(t, (req, res) => forwardLocal(req, res, path, req => req.headers.cookie === 'signed=second' ? undefined : 401));
  assert.equal((await fetch(second + '/collab/api/state')).status, 401);
  assert.equal(observed, undefined);
  const response = await fetch(second + '/collab/api/rooms/1/messages?x=y', {
    method: 'POST', headers: { cookie: 'signed=second', authorization: 'secret-browser-token', 'content-type': 'application/json' }, body: '{"text":"hello"}',
  });
  assert.equal(response.status, 201);
  assert.equal(response.headers.get('set-cookie'), null);
  assert.deepEqual(await response.json(), { id: 1 });
  assert.equal(observed.url, '/collab/api/rooms/1/messages?x=y');
  assert.equal(observed.body, '{"text":"hello"}');
  assert.equal(observed.headers.cookie, undefined);
  assert.equal(observed.headers.authorization, undefined);
  assert.equal(observed.headers['x-collab-local'], local.token);
});

test('a live event reaches the second host and closing the page closes its upstream stream', async t => {
  let closed;
  const ended = new Promise(resolve => { closed = resolve; });
  const upstream = await listen(t, (req, res) => {
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.write('event: message\ndata: {"id":1}\n\n');
    res.on('close', closed);
  });
  const path = holder(t, localConnection({ getOrigin: () => upstream }));
  const second = await listen(t, (req, res) => forwardLocal(req, res, path, () => undefined));
  const controller = new AbortController();
  const response = await fetch(second + '/collab/api/events', { signal: controller.signal });
  assert.equal(response.headers.get('content-type'), 'text/event-stream');
  const reader = response.body.getReader();
  assert.match(new TextDecoder().decode((await reader.read()).value), /data: {"id":1}/);
  controller.abort();
  await ended;
});

test('older holders without discovery keep the busy diagnostic and do not start a second writer', async t => {
  const path = holder(t, undefined);
  // #227 review F1: the title above claims no second writer, so the test has to look at the
  // store itself. The previous version only asserted that the lock probe fails, and stayed green
  // with a forwarder that opened `collab.sqlite3` and inserted a row (审稿 2026-11-06 22:0x).
  const db = join(dirname(path), 'collab.sqlite3');
  const owner = new Store(db);
  t.after(() => owner.close());
  owner.createRoom('holder-room');
  // 指纹用内容而非写计数：PRAGMA data_version 会被 checkpoint(TRUNCATE)/VACUUM/真写迁移抬高，
  // 持库方空闲与否也会影响它（审稿 2026-11-07 第五节），假红会掩盖真红。
  // 用持库方自己的连接读，不另开一个（另开会碰到 open 时的迁移）。
  // 内容指纹要盖住「只改内容、不动行数」的写法和别的表，否则第二次写入能藏在同名 UPDATE 或
  // room_settings 里（审稿 2026-11-07 第三轮第四节）。
  // 显式假设：窗口内持库方自己空闲（本用例不写库）。持库方若在窗口内正常发消息，指纹同样会变，
  // 那时这条断言分不清「它在服务」和「有第二个写者」——真正的守卫是上面那条抢锁断言。
  const fingerprint = () => ({
    rooms: owner.db.prepare('SELECT name FROM rooms ORDER BY id').all().map(row => row.name),
    messages: owner.db.prepare('SELECT id, room_id, author, text, changed_at FROM messages ORDER BY id').all(),
    settings: owner.db.prepare('SELECT * FROM room_settings ORDER BY room_id').all(),
    resets: owner.db.prepare('SELECT * FROM room_resets ORDER BY room_id').all(),
  });
  const before = fingerprint();

  const second = await listen(t, (req, res) => forwardLocal(req, res, path, () => undefined));
  assert.equal((await fetch(second + '/collab/api/state')).status, 404);
  assert.equal(lockStatus(path).busy, true);
  assert.equal(InstanceLock.acquire(path), undefined);

  // A second writer would have added a room here, or left its own rows behind. Comparing content
  // catches both; the room list alone missed a writer that only appends a message (审稿 2026-11-07).
  assert.deepEqual(fingerprint(), before, 'the forwarder wrote to the holder database');
});

test('a refused instance serves holder status and forwards to the holder, never past auth', async t => {
  // #227 review F2: nothing ever called the refused-instance branch. It is `mountSharedHost` now, so
  // a stub context can drive both routes — and drive them far enough to catch the holes the first
  // round of tests left: a handler that never really forwards, a forward that skips the sign-in
  // check, and a status path that drifted from the one the page asks for.
  let upstreamHits = 0;
  const upstream = await listen(t, (req, res) => {
    upstreamHits += 1;
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ forwarded: req.url }));
  });
  const path = holder(t, localConnection({ getOrigin: () => upstream }));
  const routes = [];
  const ctx = {
    webServer: { register(route) { routes.push(route); return route; } },
    effect(fn) { fn(); },
    // 真实契约：不是 undefined 就是拒绝；desk-e2e 的桩同样返回 undefined 或状态码。
    connection: { requestRejection: req => (req.headers['x-owner'] === 'yes' ? undefined : 401) },
  };
  mountSharedHost(ctx, path);
  assert.deepEqual(routes.map(r => [r.kind, r.path]), [['exact', BUSY_PATH], ['prefix', '/collab']]);
  // 页面问的是这个字面量（client-ui-discord/lib/client.js 硬编码），漂移了页面就永远读不到状态。
  assert.equal(BUSY_PATH, '/collab/api/lock');

  const status = await listen(t, routes[0].handler);
  assert.equal((await fetch(status + BUSY_PATH)).status, 401);
  assert.equal((await fetch(status + BUSY_PATH, { headers: { 'x-later-ticket': 't' } })).status, 403);
  const allowed = await fetch(status + BUSY_PATH, { headers: { 'x-owner': 'yes' } });
  assert.equal(allowed.status, 200);
  assert.equal((await allowed.json()).busy, true);

  const shared = await listen(t, routes[1].handler);
  // 未登录：401，且一个字节都不许到宿主那里去。
  assert.equal((await fetch(shared + '/collab/api/state')).status, 401);
  assert.equal(upstreamHits, 0, 'an unauthenticated request reached the holder');
  // 已登录：必须真的转过去，返回宿主自己的内容。
  const forwarded = await fetch(shared + '/collab/api/state', { headers: { 'x-owner': 'yes' } });
  assert.equal(forwarded.status, 200);
  assert.deepEqual(await forwarded.json(), { forwarded: '/collab/api/state' });
  assert.equal(upstreamHits, 1);
});

test('a real apply() under a held lock mounts the shared host and writes nothing', async t => {
  // #227 review F2, third round: the lock-busy branch was checked by reading plugin.mjs, and a
  // whole-branch `if (false)` passed it while the real apply() registered two routes and created
  // collab.sqlite3 — the second writer this PR exists to prevent. So import the plugin for real.
  //
  // It needs the DSH runtime: `@deepseek-ai/dsh-llm` (resolved from process.argv[1]) and `ws`
  // (from collab/node_modules, installed by CI). Only the first is missing here, so a two-line
  // stub stands in — the same trick desk-e2e/host.mjs uses.
  // ws comes from collab/node_modules (pnpm install). Without it the plugin cannot load, so skip
  // loudly instead of faking a red — the repo already skips on missing optional deps.
  let haveWs = true;
  try { createRequire(import.meta.url).resolve('ws'); } catch { haveWs = false; }
  if (!haveWs) return t.skip('dsh/collab/node_modules is not installed (pnpm install)');
  const root = mkdtempSync(join(tmpdir(), 'collab-apply-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const stub = join(root, 'node_modules', '@deepseek-ai', 'dsh-llm');
  mkdirSync(stub, { recursive: true });
  writeFileSync(join(stub, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh-llm', type: 'module', main: 'index.mjs' }));
  writeFileSync(join(stub, 'index.mjs'), 'export function createUserMessage() { return {}; }\n');
  const base = join(root, 'stub-base.mjs');
  writeFileSync(base, '// createRequire 的基准\n');
  const argv1 = process.argv[1];
  process.argv[1] = base;
  t.after(() => { process.argv[1] = argv1; });

  const dataDir = join(root, 'data');
  mkdirSync(dataDir, { recursive: true });
  // 另一台 DSH 正拿着这个数据目录。
  const lockPath = join(dataDir, 'collab.lock');
  const holderLock = InstanceLock.acquire(lockPath);
  t.after(() => holderLock.release());

  const routes = [];
  const ctx = {
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    webServer: {
      register(route) { routes.push(route); return () => {}; },
      registerUpgrade() { return () => {}; },
      getOrigin() { return 'http://127.0.0.1:0'; },
    },
    on() { return () => {}; },
    effect(fn) { fn(); return () => {}; },
    connection: { requestRejection: () => undefined },
    llm: { listProviders: () => [], listModels: async () => [] },
  };
  const plugin = await import(pathToFileURL(new URL('./plugin.mjs', import.meta.url).pathname).href);
  await plugin.apply(ctx, { dataDir, workspacePath: dataDir, rooms: [{ id: 1, name: 'general' }] });

  assert.deepEqual(routes.map(route => [route.kind, route.path]), [['exact', BUSY_PATH], ['prefix', '/collab']]);
  assert.equal(existsSync(join(dataDir, 'collab.sqlite3')), false, 'a refused instance opened the holder database');
  assert.equal(InstanceLock.acquire(lockPath), undefined, 'a refused instance took the lock');
});

test('an unauthenticated ticket request gets the 403 hint, everyone else 401', () => {
  // #597 G26: the hint is the difference between "sign in" and "this route does not take tickets".
  const send = headers => {
    const out = { status: undefined, body: undefined };
    refuse({ headers }, { writeHead(status) { out.status = status; }, end(body) { out.body = JSON.parse(body); } });
    return out;
  };
  assert.equal(send({}).status, 401);
  assert.deepEqual(send({}).body, { error: 'unauthorized' });
  assert.equal(send({ 'x-later-ticket': 't' }).status, 403);
  assert.match(send({ 'x-later-ticket': 't' }).body.error, /X-Later-Ticket/);
});
