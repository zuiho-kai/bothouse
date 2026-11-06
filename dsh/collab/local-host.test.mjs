import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtempSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { InstanceLock, writeLockOwner, lockStatus } from './instance-lock.mjs';
import { localConnection, isLocalOwner, forwardLocal } from './local-host.mjs';

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
  const second = await listen(t, (req, res) => forwardLocal(req, res, path, () => undefined));
  assert.equal((await fetch(second + '/collab/api/state')).status, 404);
  assert.equal(lockStatus(path).busy, true);
  assert.equal(InstanceLock.acquire(path), undefined);
});
