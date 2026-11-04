// #131: number pairing between two DSH instances (pairing.mjs). Both sides run on loopback here,
// the same way docs/INSTANCE_SETUP.md simulates two devices on one machine.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, statSync } from 'node:fs';
import { createServer, request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  MAX_ATTEMPTS, PairClient, PairError, PairHost, PairListener, REMOTE_OWNER, hostHandler, isTailnetAddress,
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

test('temporary devices end on time and are never written; remembered ones persist as a hash', () => {
  let now = 0;
  const file = join(dir(), 'd.json');
  const host = new PairHost({ file, now: () => now });
  const t = host.claim({ ...{ code: host.newCode().code }, mode: 'temp', name: 'A' });
  const r = host.claim({ ...{ code: host.newCode().code }, mode: 'remember', name: 'B' });
  const saved = readFileSync(file, 'utf8');
  assert.ok(!saved.includes(r.token) && !saved.includes(t.token), 'credential not stored in clear');
  assert.ok(!saved.includes('"A"'), 'temporary device not stored');
  assert.equal(statSync(file).mode & 0o777, 0o600);
  now += host.tempTtl;
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

  // Kick on the host: the controller learns it on its next request and forgets the link.
  const devId = (await get(hostApiPort, '/collab/api/pair/devices')).json.devices[0].id;
  assert.equal((await get(hostApiPort, `/collab/api/pair/devices/${devId}`, { method: 'DELETE' })).status, 200);
  // Nothing left to serve: the listener closed, so the controller just cannot reach it.
  assert.equal(listener.server, undefined);
  const gone = await get(ctlPort, `/collab/remote/${link.id}/api/state`);
  assert.equal(gone.status, 502);
  assert.match(gone.json.error, /踢掉/);
  // Once the host listens again (another number), the kicked credential is refused and forgotten.
  await get(hostApiPort, '/collab/api/pair/code', { method: 'POST' });
  const after = await get(ctlPort, `/collab/remote/${link.id}/api/state`);
  assert.equal(after.status, 401);
  assert.match(after.json.error, /重新配对/);
  assert.deepEqual((await get(ctlPort, '/collab/api/remote/links')).json.links, []);
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
  assert.equal(await client.disconnect(link.id), true);
  assert.equal(host.list().length, 0);
});

test('the host listener refuses addresses outside the tailnet', async t => {
  const host = new PairHost({ file: join(dir(), 'd.json') });
  const server = createServer(hostHandler({ host, name: 'h', route: () => {} }));
  const port = await listen(server);
  t.after(() => server.close());
  assert.equal((await get(port, '/collab/pair/hello')).status, 403);
});
