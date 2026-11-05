// #131: number pairing between two DSH instances (pairing.mjs). Both sides run on loopback here,
// the same way docs/INSTANCE_SETUP.md simulates two devices on one machine.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, statSync } from 'node:fs';
import { createServer, request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ALIVE_EVERY_MS, CODE_TTL_MS, MAX_ATTEMPTS, UNTIL_GRACE_MS, tempDuration, PairClient, PairError, PairHost, PairListener, REMOTE_OWNER, hostHandler, isTailnetAddress,
  pairApiRoute, remoteProxyRoute, rewriteRemoteHTML, tailnetPeers,
} from './pairing.mjs';

const dir = () => mkdtempSync(join(tmpdir(), 'collab-pair-'));

test('tailnet address ranges', () => {
  assert.equal(isTailnetAddress('100.78.136.32'), true);
  assert.equal(isTailnetAddress('::ffff:100.95.83.14'), true);
  assert.equal(isTailnetAddress('fd7a:115c:a1e0::7f2c:8821'), true);
  assert.equal(isTailnetAddress('100.128.0.1'), false);
  assert.equal(isTailnetAddress('192.168.1.2'), false);
  assert.equal(isTailnetAddress('8.8.8.8'), false);
});

test('a number works once, and only before it expires', () => {
  let now = 1_000;
  const host = new PairHost({ file: join(dir(), 'd.json'), now: () => now });
  const { code } = host.newCode();
  assert.match(code, /^\d{6}$/);
  const { token, device } = host.claim({ code: code.slice(0, 3) + ' ' + code.slice(3), mode: 'temp', name: 'MacBook' });
  assert.equal(device.name, 'MacBook');
  assert.equal(host.verify(token).id, device.id);
  assert.throws(() => host.claim({ code, mode: 'temp', name: 'x' }), e => e instanceof PairError && e.code === 'no-code');

  const second = host.newCode();
  now += host.codeTtl;
  assert.throws(() => host.claim({ code: second.code, mode: 'temp', name: 'x' }), e => e.code === 'expired');
});

test('too many wrong numbers void the number', () => {
  const host = new PairHost({ file: join(dir(), 'd.json') });
  const { code } = host.newCode();
  const wrong = String((Number(code) + 1) % 1_000_000).padStart(6, '0');
  for (let i = 1; i < MAX_ATTEMPTS; i++) assert.throws(() => host.claim({ code: wrong, mode: 'temp' }), e => e.code === 'wrong');
  assert.throws(() => host.claim({ code: wrong, mode: 'temp' }), e => e.code === 'locked');
  assert.throws(() => host.claim({ code, mode: 'temp' }), e => e.code === 'no-code');
});

test('codes last 5 minutes and allow 5 tries (user 11-04 16:58)', () => {
  assert.equal(CODE_TTL_MS, 5 * 60_000);
  assert.equal(MAX_ATTEMPTS, 5);
});

test('a temporary link lasts until someone disconnects unless a custom length is chosen', () => {
  let now = 0;
  const host = new PairHost({ file: join(dir(), 'd.json'), now: () => now });
  const until = host.claim({ code: host.newCode().code, mode: 'temp', name: 'U' });
  assert.equal(until.device.expires_at, null);
  // 3 days: no fixed upper limit any more.
  const long = host.claim({ code: host.newCode().code, mode: 'temp', name: 'L', duration_ms: 3 * 24 * 3600_000 });
  assert.equal(long.device.expires_at, 3 * 24 * 3600_000);
  const short = host.claim({ code: host.newCode().code, mode: 'temp', name: 'S', duration_ms: 30 * 60_000 });
  now += 30 * 60_000;
  assert.equal(host.verify(short.token), undefined);
  now += 365 * 24 * 3600_000;
  assert.equal(host.verify(until.token)?.name, 'U', 'untimed link never expires on its own');
  assert.equal(host.verify(long.token), undefined);
  assert.equal(host.revoke(until.device.id), true);
  assert.equal(host.verify(until.token), undefined);
  // A remembered link ignores any length.
  assert.equal(host.claim({ code: host.newCode().code, mode: 'remember', name: 'R', duration_ms: 60_000 }).device.expires_at, null);
  for (const bad of [0, -1, 1.5, 'abc', Number.MAX_VALUE]) {
    const { code } = host.newCode();
    assert.throws(() => host.claim({ code, mode: 'temp', duration_ms: bad }), e => e.code === 'mode', String(bad));
  }
  assert.equal(tempDuration('temp', '60000'), 60_000);
  assert.equal(tempDuration('temp', ''), null);
});

test('temporary devices end on time and are never written; remembered ones persist as a hash', () => {
  let now = 0;
  const file = join(dir(), 'd.json');
  const host = new PairHost({ file, now: () => now });
  const t = host.claim({ ...{ code: host.newCode().code }, mode: 'temp', name: 'A', duration_ms: 60_000 });
  const r = host.claim({ ...{ code: host.newCode().code }, mode: 'remember', name: 'B' });
  const saved = readFileSync(file, 'utf8');
  assert.ok(!saved.includes(r.token) && !saved.includes(t.token), 'credential not stored in clear');
  assert.ok(!saved.includes('"A"'), 'temporary device not stored');
  if (process.platform !== 'win32') assert.equal(statSync(file).mode & 0o777, 0o600); // no POSIX modes on Windows
  now += 60_000;
  assert.equal(host.verify(t.token), undefined);
  assert.equal(host.verify(r.token)?.name, 'B');
  const reloaded = new PairHost({ file, now: () => now });
  assert.deepEqual(reloaded.list().map(d => d.name), ['B']);
  assert.equal(reloaded.verify(r.token)?.name, 'B');
  assert.equal(reloaded.revoke(reloaded.list()[0].id), true);
  assert.equal(new PairHost({ file }).list().length, 0);
});

test('peers come from tailscale status', async () => {
  const status = { Peer: { a: { HostName: 'MacBook', TailscaleIPs: ['100.95.83.14', 'fd7a::1'], Online: true, OS: 'macOS' }, b: { HostName: 'phone', TailscaleIPs: ['100.91.6.91'], Online: false } } };
  const peers = await tailnetPeers(async () => JSON.stringify(status));
  assert.deepEqual(peers, [{ name: 'MacBook', ip: '100.95.83.14', online: true, os: 'macOS' }, { name: 'phone', ip: '100.91.6.91', online: false, os: '' }]);
});

test('HTML rewrite sends absolute /collab/ URLs back through the proxy', () => {
  const mount = '/collab/remote/x';
  assert.equal(rewriteRemoteHTML(`<base href="/collab/panel/"><script>fetch('/collab/api/state');new EventSource(\`/collab/api/events\`)</script>`, mount),
    `<base href="/collab/remote/x/panel/"><script>fetch('/collab/remote/x/api/state');new EventSource(\`/collab/remote/x/api/events\`)</script>`);
  // page.html, desk and wiki galaxy build URLs as `${ROOT}/collab/...`; ROOT is '' under the proxy.
  assert.equal(rewriteRemoteHTML('api(`${ROOT}/collab/api/rooms/${id}/messages`)', mount), 'api(`${ROOT}/collab/remote/x/api/rooms/${id}/messages`)');
});

async function freePort() { const s = createServer(); const p = await listen(s); await new Promise(r => s.close(r)); return p; }
function listen(server) { return new Promise(r => server.listen(0, '127.0.0.1', () => r(server.address().port))); }
function get(port, path, { method = 'GET', body, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const req = request({ host: '127.0.0.1', port, path, method, headers: payload ? { 'content-type': 'application/json', ...headers } : headers }, res => {
      let text = '';
      res.on('data', c => { text += c; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text, json: (() => { try { return JSON.parse(text); } catch { return undefined; } })() }));
    });
    req.on('error', reject);
    req.end(payload);
  });
}

test('two instances: number → link → proxied pages and API → kick', async t => {
  // Host machine: its plugin route sees only owner requests from paired devices.
  const host = new PairHost({ file: join(dir(), 'd.json') });
  const seen = [];
  const route = (req, res) => {
    seen.push({ path: req.url, owner: req[REMOTE_OWNER] === true, auth: req.headers.authorization !== undefined });
    if (req.url === '/collab') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); return res.end(`<script>fetch('/collab/api/state')</script>`); }
    if (req.url === '/collab/api/state') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end('{"rooms":[1]}'); }
    if (req.url === '/collab/api/events') { res.writeHead(200, { 'content-type': 'text/event-stream' }); return res.end('data: hi\n\n'); }
    res.writeHead(404); res.end();
  };
  const listener = new PairListener({ host, address: async () => '127.0.0.1', port: await freePort(),
    handler: hostHandler({ host, name: 'mac-mini', route, allowLoopback: true, whois: async () => undefined }) });
  t.after(() => listener.close());

  // Controller machine: its own DSH routes (owner already signed in).
  const client = new PairClient({ file: join(dir(), 'l.json'), port: listener.port, name: 'macbook' });
  const ctl = createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    return pairApiRoute(req, res, url, { host: new PairHost({ file: join(dir(), 'h2.json') }), client, listener: { ensure: async () => '', settle: async () => {}, bound: null },
      peers: async () => [{ name: 'mac-mini', ip: '127.0.0.1', online: true, os: 'macOS' }] })
      ?? remoteProxyRoute(req, res, url, { client })
      ?? (res.writeHead(404), res.end());
  });
  const ctlPort = await listen(ctl);
  t.after(() => ctl.close());

  // The host listens only after a number is asked for.
  assert.equal((await get(listener.port, '/collab/pair/hello').catch(() => ({ status: 0 }))).status, 0);
  const hostApi = createServer((req, res) => pairApiRoute(req, res, new URL(req.url, 'http://x'), { host, client: new PairClient({ file: join(dir(), 'l2.json') }), listener }));
  const hostApiPort = await listen(hostApi);
  t.after(() => hostApi.close());
  const issued = (await get(hostApiPort, '/collab/api/pair/code', { method: 'POST' })).json;
  assert.match(issued.code, /^\d{6}$/);

  const peers = (await get(ctlPort, '/collab/api/remote/peers')).json.peers;
  assert.equal(peers[0].waiting, true);

  const bad = await get(ctlPort, '/collab/api/remote/links', { method: 'POST', body: { host: '127.0.0.1', code: '000000' === issued.code ? '111111' : '000000', mode: 'remember' } });
  assert.equal(bad.status, 403);
  assert.match(bad.json.error, /还能再试/);

  const ok = await get(ctlPort, '/collab/api/remote/links', { method: 'POST', body: { host: '127.0.0.1', code: issued.code, mode: 'remember' } });
  assert.equal(ok.status, 200, ok.text);
  const link = ok.json.link;
  assert.equal(link.mode, 'remember');
  assert.equal('token' in link, false, 'credential never reaches the browser');
  assert.equal((await get(hostApiPort, '/collab/api/pair/devices')).json.devices[0].name, 'macbook');

  const page = await get(ctlPort, `/collab/remote/${link.id}/`);
  assert.equal(page.status, 200);
  assert.ok(page.text.includes(`/collab/remote/${link.id}/api/state`));
  const state = await get(ctlPort, `/collab/remote/${link.id}/api/state`);
  assert.deepEqual(state.json, { rooms: [1] });
  const events = await get(ctlPort, `/collab/remote/${link.id}/api/events`);
  assert.equal(events.text, 'data: hi\n\n');
  assert.ok(seen.every(s => s.owner && s.auth));

  // Pairing management cannot be driven from the other machine.
  const token = JSON.parse(readFileSync(client.file, 'utf8')).links[0].token;
  assert.equal((await get(listener.port, '/collab/api/pair/devices', { headers: { authorization: `Bearer ${token}` } })).status, 403);
  // No credential, no access.
  assert.equal((await get(listener.port, '/collab/api/state')).status, 401);

  // Kick on the host: the listener stays up for one question so the controller can tell a kick
  // from a host that is merely off (an idle listener is closed by the 60 s sweep, not here).
  const devId = (await get(hostApiPort, '/collab/api/pair/devices')).json.devices[0].id;
  assert.equal((await get(hostApiPort, `/collab/api/pair/devices/${devId}`, { method: 'DELETE' })).status, 200);
  assert.notEqual(listener.server, undefined, 'still serving the whoami that says "revoked"');
  const gone = await get(ctlPort, `/collab/remote/${link.id}/api/state`);
  assert.equal(gone.status, 401);
  assert.match(gone.json.error, /重新配对/);
  assert.deepEqual((await get(ctlPort, '/collab/api/remote/links')).json.links, []);
  // The sweep right after the kick must not close the port: a late look at the list still needs
  // the whoami answer, or the link comes back as a 502 that never clears.
  await listener.settle();
  assert.notEqual(listener.server, undefined, 'a fresh kick keeps the listener for its grace');
  assert.deepEqual((await get(ctlPort, '/collab/api/remote/links')).json.links, []);
});

test('the listener closes once the kick is old enough to be indistinguishable from off', async t => {
  let now = 1_000;
  const host = new PairHost({ file: join(dir(), 'd.json'), now: () => now });
  const port = await freePort();
  const listener = new PairListener({ host, address: async () => '127.0.0.1', port,
    handler: hostHandler({ host, name: 'h', route: (q, s) => { s.writeHead(200); s.end(); }, allowLoopback: true }) });
  t.after(() => listener.close());
  const { device } = host.claim({ code: host.newCode().code, mode: 'remember', name: 'old' });
  await listener.ensure();
  host.revoke(device.id);
  await listener.settle();
  assert.notEqual(listener.server, undefined, 'still inside the grace');
  now += host.codeTtl;
  await listener.settle();
  assert.equal(listener.server, undefined, 'grace over: nothing left to serve');
});

test('disconnect from the controller drops the device on the host too', async t => {
  const host = new PairHost({ file: join(dir(), 'd.json') });
  const port = await freePort();
  const listener = new PairListener({ host, address: async () => '127.0.0.1', port,
    handler: hostHandler({ host, name: 'h', route: (q, s) => { s.writeHead(200); s.end(); }, allowLoopback: true }) });
  t.after(() => listener.close());
  await listener.ensure();
  const client = new PairClient({ file: join(dir(), 'l.json'), port, name: 'c' });
  const link = await client.connect({ host: '127.0.0.1', code: host.newCode().code, mode: 'temp' });
  assert.equal(host.list().length, 1);
  assert.equal(link.expires_at, null, 'default temporary link: until disconnected');
  assert.equal(host.list()[0].expires_at, null);
  assert.equal(await client.disconnect(link.id), true);
  assert.equal(host.list().length, 0);
  // A custom length chosen on the controller reaches the host.
  const before = Date.now();
  const timed = await client.connect({ host: '127.0.0.1', code: host.newCode().code, mode: 'temp', duration_ms: 2 * 3600_000 });
  const exp = host.list()[0].expires_at;
  assert.ok(exp >= before + 2 * 3600_000 && exp <= Date.now() + 2 * 3600_000);
  assert.equal(timed.expires_at, exp);
});

test('「直到我断开」: a refresh within the heartbeat grace keeps the link; a closed window ends it (user 11-04 17:34)', async t => {
  assert.ok(UNTIL_GRACE_MS > 2 * ALIVE_EVERY_MS, 'grace outlasts more than one missed beat');
  const host = new PairHost({ file: join(dir(), 'd.json') });
  const port = await freePort();
  const listener = new PairListener({ host, address: async () => '127.0.0.1', port,
    handler: hostHandler({ host, name: 'h', route: (q, s) => { s.writeHead(200); s.end(); }, allowLoopback: true }) });
  t.after(() => listener.close());
  await listener.ensure();
  let now = Date.now();
  const client = new PairClient({ file: join(dir(), 'l.json'), port, name: 'c', now: () => now });
  const until = await client.connect({ host: '127.0.0.1', code: host.newCode().code, mode: 'temp' });
  const timed = await client.connect({ host: '127.0.0.1', code: host.newCode().code, mode: 'temp', duration_ms: 3600_000 });
  const kept = await client.connect({ host: '127.0.0.1', code: host.newCode().code, mode: 'remember' });
  assert.equal(host.list().length, 3);
  // Refresh: the page is gone for a few seconds, then beats again.
  now += UNTIL_GRACE_MS - 1;
  assert.deepEqual(await client.sweep(), []);
  client.alive();
  now += UNTIL_GRACE_MS - 1;
  assert.deepEqual(await client.sweep(), [], 'beat came back: still connected');
  assert.equal(client.list().length, 3);
  // Window closed: no beat for the whole grace → only the until-disconnect link ends, on both sides.
  now += 1;
  assert.deepEqual(await client.sweep(), [until.id]);
  assert.deepEqual(client.list().map(l => l.id).sort(), [timed.id, kept.id].sort());
  assert.equal(host.list().length, 2);
  assert.ok(!host.list().some(d => d.mode === 'temp' && d.expires_at === null));
});

test('POST /collab/api/remote/alive keeps until-disconnect links', async () => {
  let now = 0;
  const client = new PairClient({ file: join(dir(), 'l.json'), now: () => now });
  client.links.set('x', { id: 'x', name: 'n', host: '127.0.0.1', port: 1, token: 't', mode: 'temp', created_at: 0, expires_at: null, alive_at: 0 });
  now = UNTIL_GRACE_MS + 5;
  const res = { status: 0, writeHead(c) { this.status = c; }, setHeader() {}, end() {} };
  await pairApiRoute({ method: 'POST', headers: {} }, res, new URL('http://x/collab/api/remote/alive'), { host: new PairHost({ file: join(dir(), 'd.json') }), client, listener: {} });
  assert.equal(res.status, 200);
  assert.deepEqual(await client.sweep(), []);
});

test('the host listener refuses addresses outside the tailnet', async t => {
  const host = new PairHost({ file: join(dir(), 'd.json') });
  const server = createServer(hostHandler({ host, name: 'h', route: () => {} }));
  const port = await listen(server);
  t.after(() => server.close());
  assert.equal((await get(port, '/collab/pair/hello')).status, 403);
});

test('kicking a device ends the event stream it already holds; other devices keep theirs (review 6628171209)', async t => {
  const host = new PairHost({ file: join(dir(), 'd.json') });
  // Like plugin.mjs events(): an open text/event-stream that pushes until the response closes.
  const pushers = new Set();
  const route = (req, res) => {
    if (req.url !== '/collab/api/events') { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.write(': connected\n\n');
    const push = data => res.write(`data: ${data}\n\n`);
    pushers.add(push);
    res.on('close', () => pushers.delete(push));
  };
  const listener = new PairListener({ host, address: async () => '127.0.0.1', port: await freePort(),
    handler: hostHandler({ host, name: 'mac-mini', route, allowLoopback: true, whois: async () => undefined }) });
  t.after(() => listener.close());
  const pair = name => host.claim({ code: host.newCode().code, mode: 'remember', name });
  const a = pair('A');
  const b = pair('B');
  await listener.ensure();

  const open = token => new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port: listener.port, path: '/collab/api/events', headers: { authorization: `Bearer ${token}` } }, res => {
      const s = { status: res.statusCode, text: '', closed: false };
      res.on('data', c => { s.text += c; });
      res.on('close', () => { s.closed = true; });
      res.on('error', () => { s.closed = true; });
      resolve(s);
    });
    req.on('error', reject);
    req.end();
  });
  const until = async (cond, ms = 2000) => { const end = Date.now() + ms; while (!cond() && Date.now() < end) await new Promise(r => setTimeout(r, 10)); };

  const sa = await open(a.token);
  const sb = await open(b.token);
  assert.equal(sa.status, 200);
  assert.equal(sb.status, 200);
  await until(() => pushers.size === 2);
  for (const p of pushers) p('before');
  await until(() => sa.text.includes('before') && sb.text.includes('before'));
  assert.ok(sa.text.includes('data: before'));

  assert.equal(host.revoke(a.device.id), true);
  await until(() => sa.closed);
  assert.equal(sa.closed, true, 'kicked device stream must close at once');
  for (const p of pushers) p('after');
  await until(() => sb.text.includes('after'));
  assert.ok(!sa.text.includes('after'), 'kicked device must not get later events');
  assert.ok(sb.text.includes('data: after'), 'the other device keeps its stream');
  assert.equal(sb.closed, false);
  // And its next request is refused.
  const again = await get(listener.port, '/collab/api/events', { headers: { authorization: `Bearer ${a.token}` } });
  assert.equal(again.status, 401);
  assert.equal(again.headers['x-collab-pair'], 'revoked');
});

test('a kicked device leaves 「我连着的电脑」 without that link being opened first', async t => {
  // Host side, listening on loopback: one live number, two devices paired.
  const host = new PairHost({ file: join(dir(), 'd.json') });
  const port = await freePort();
  const listener = new PairListener({ host, address: async () => '127.0.0.1', port,
    handler: hostHandler({ host, name: 'mac-mini', route: (q, s) => { s.writeHead(200); s.end(); }, allowLoopback: true, whois: async () => undefined }) });
  t.after(() => listener.close());
  const client = new PairClient({ file: join(dir(), 'l.json'), port, name: 'macbook' });
  const ctl = createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    return pairApiRoute(req, res, url, { host: new PairHost({ file: join(dir(), 'h2.json') }), client,
      listener: { ensure: async () => '', settle: async () => {}, bound: null }, peers: async () => [] })
      ?? (res.writeHead(404), res.end());
  });
  const ctlPort = await listen(ctl);
  t.after(() => ctl.close());

  await listener.ensure();
  const kicked = await client.connect({ host: '127.0.0.1', code: host.newCode().code, mode: 'remember', name: 'old' });
  const oldId = host.list()[0].id;
  const kept = await client.connect({ host: '127.0.0.1', code: host.newCode().code, mode: 'remember', name: 'kept' });
  assert.deepEqual((await get(ctlPort, '/collab/api/remote/links')).json.links.map(l => l.name).sort(), ['kept', 'old']);

  // Kicked on the host while the listener keeps running for the other device: no page of the
  // kicked one is opened from now on.
  assert.equal(host.revoke(oldId), true); // what 「踢掉」 on the host does
  const listed = (await get(ctlPort, '/collab/api/remote/links')).json.links;
  assert.deepEqual(listed.map(l => l.name), ['kept'], 'kicked machine is gone from the list');
  assert.ok(listed.every(l => l.id !== kicked.id));
  assert.equal(JSON.parse(readFileSync(client.file, 'utf8')).links.some(l => l.id === kicked.id), false, 'and not written back');

  // A host that is simply off is not a kick: its link stays.
  await listener.close();
  assert.deepEqual((await get(ctlPort, '/collab/api/remote/links')).json.links.map(l => l.name), ['kept']);
  assert.equal(kept.id, listed[0].id);
});

test('opening a link to a host that is off says so instead of hanging', async t => {
  // The one case a controller cannot tell apart from a kick: no answer at all. The page must say the
  // machine is unreachable (502) rather than spin or pretend the page loaded.
  const file = join(dir(), 'l.json');
  const client = new PairClient({ file, port: await freePort(), request: async () => ({ status: 200, body: { token: 't', host_name: 'own' } }) });
  const link = await client.connect({ host: '127.0.0.1', code: '123456', mode: 'remember', name: 'off' });
  const ctl = createServer((req, res) => remoteProxyRoute(req, res, new URL(req.url, 'http://x'), { client }) ?? (res.writeHead(404), res.end()));
  const ctlPort = await listen(ctl);
  t.after(() => ctl.close());
  const gone = await get(ctlPort, `/collab/remote/${link.id}/api/state`);
  assert.equal(gone.status, 502);
  assert.match(gone.json.error, /连不上/);
  assert.equal(client.list().length, 1, 'unreachable is not the same as revoked');
});

test('the last device kicked on the host clears 「我连着的电脑」 at once', async t => {
  // The common case: one machine has ever paired. Kicking it must not close the listener before the
  // controller can ask, or the kick reads as "host is off" and the link stays forever.
  const host = new PairHost({ file: join(dir(), 'd.json') });
  const port = await freePort();
  const listener = new PairListener({ host, address: async () => '127.0.0.1', port,
    handler: hostHandler({ host, name: 'mac-mini', route: (q, s) => { s.writeHead(200); s.end(); }, allowLoopback: true, whois: async () => undefined }) });
  t.after(() => listener.close());
  const client = new PairClient({ file: join(dir(), 'l.json'), port, name: 'macbook' });
  const ctl = createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    return pairApiRoute(req, res, url, { host, client, listener, peers: async () => [] })
      ?? (res.writeHead(404), res.end());
  });
  const ctlPort = await listen(ctl);
  t.after(() => ctl.close());

  await listener.ensure();
  const link = await client.connect({ host: '127.0.0.1', code: host.newCode().code, mode: 'remember', name: 'old' });
  assert.deepEqual((await get(ctlPort, '/collab/api/remote/links')).json.links.map(l => l.name), ['old']);

  // 「踢掉」 through the real owner route, which must not stop serving before the controller asks.
  const dev = host.list()[0].id;
  assert.equal((await get(ctlPort, `/collab/api/pair/devices/${dev}`, { method: 'DELETE' })).status, 200);
  assert.deepEqual((await get(ctlPort, '/collab/api/remote/links')).json.links, [], 'kicked machine is gone from the list');
  assert.equal(JSON.parse(readFileSync(client.file, 'utf8')).links.some(l => l.id === link.id), false, 'and not written back');
});

test('a host that cannot be asked keeps its link (off is not kicked)', async t => {
  const file = join(dir(), 'l.json');
  let claim = 0;
  const client = new PairClient({ file, now: () => 0, request: async ({ path }) => {
    if (path === '/collab/pair/claim') { claim += 1; return { status: 200, body: { token: `t${claim}`, host_name: 'mini' } }; }
    throw new Error('timeout'); // the host is off or its port is closed
  } });
  const link = await client.connect({ host: '127.0.0.1', code: '123456', mode: 'remember', name: 'off' });
  assert.deepEqual(await client.refresh(), []);
  assert.deepEqual(client.list().map(l => l.name), ['off'], 'an unreachable host is not treated as a kick');
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).links.some(l => l.id === link.id), true);
});

test('refreshes that overlap share one round of questions', async t => {
  // devices.html asks on open, after connecting and after disconnecting; one round is enough, and a
  // machine that is off must not be waited on twice for the same page action.
  const file = join(dir(), 'l.json');
  let asked = 0;
  const client = new PairClient({ file, now: () => 0, request: async ({ path }) => {
    if (path === '/collab/pair/claim') return { status: 200, body: { token: 't', host_name: 'mini' } };
    asked += 1;
    await new Promise(r => setTimeout(r, 30));
    return { status: 200, body: { ok: true } };
  } });
  await client.connect({ host: '127.0.0.1', code: '123456', mode: 'remember', name: 'mini' });
  const [a, b] = await Promise.all([client.refresh(), client.refresh()]);
  assert.deepEqual(a, []);
  assert.deepEqual(b, []);
  assert.equal(asked, 1, 'the two calls shared one whoami');
});

test('pair/whoami answers the device itself and refuses a revoked credential', async t => {
  const host = new PairHost({ file: join(dir(), 'd.json') });
  const port = await freePort();
  const listener = new PairListener({ host, address: async () => '127.0.0.1', port,
    handler: hostHandler({ host, name: 'mac-mini', route: (q, s) => { s.writeHead(200); s.end(); }, allowLoopback: true, whois: async () => undefined }) });
  t.after(() => listener.close());
  await listener.ensure();
  const { token, device } = host.claim({ code: host.newCode().code, mode: 'remember', name: 'macbook' });
  const ok = await get(port, '/collab/pair/whoami', { headers: { authorization: `Bearer ${token}` } });
  assert.equal(ok.status, 200);
  assert.equal(ok.json.device.id, device.id);
  assert.equal(ok.json.host_name, 'mac-mini');
  host.revoke(device.id);
  const gone = await get(port, '/collab/pair/whoami', { headers: { authorization: `Bearer ${token}` } });
  assert.equal(gone.status, 401);
  assert.equal(gone.json.code, 'revoked');
  assert.equal(gone.headers['x-collab-pair'], 'revoked');
});
