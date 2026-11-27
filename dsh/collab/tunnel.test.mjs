// #2314 items 2.1, 2.4, 2.5, 2.8: channel abstraction + three-process (relay + host + controller)
// end-to-end tests using the real tunnel-relay server on loopback.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createServer, request as httpRequest } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough, Readable } from 'node:stream';
import { EventEmitter } from 'node:events';
import { createRelay } from '../../tunnel-relay/src/server.mjs';
import { ChannelRegistry, createTailscaleChannel } from './channels.mjs';
import { TunnelIdentity } from './tunnel-identity.mjs';
import { TunnelHost } from './tunnel-host.mjs';
import { createTunnelChannel } from './tunnel-client.mjs';
import { encodeTunnelLink } from './tunnel-link.mjs';
import {
  ALIVE_EVERY_MS,
  PairClient,
  PairHost,
  PairListener,
  REMOTE_OWNER,
  UNTIL_GRACE_MS,
  dispatchHostRequest,
  hostHandler,
  pairApiRoute,
  remoteProxyRoute,
} from './pairing.mjs';

const dir = () => mkdtempSync(join(tmpdir(), 'collab-tunnel-e2e-'));
const listen = server => new Promise(r => server.listen(0, '127.0.0.1', () => r(server.address().port)));
const listenOn = (server, port) => new Promise(r => server.listen(port, '127.0.0.1', r));
async function freePort() { const s = createServer(); const p = await listen(s); await new Promise(r => s.close(r)); return p; }
const until = async (cond, ms = 5000) => {
  const end = Date.now() + ms;
  while (!cond() && Date.now() < end) await new Promise(r => setTimeout(r, 15));
  return cond();
};

function httpCall(port, path, { method = 'GET', body, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const req = httpRequest({
      host: '127.0.0.1', port, path, method,
      headers: payload ? { 'content-type': 'application/json', ...headers } : headers,
    }, res => {
      let text = '';
      res.on('data', c => { text += c; });
      res.on('end', () => resolve({
        status: res.statusCode,
        headers: res.headers,
        text,
        json: (() => { try { return JSON.parse(text); } catch { return undefined; } })(),
      }));
    });
    req.on('error', reject);
    req.end(payload);
  });
}

function openSSE(port, path) {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ host: '127.0.0.1', port, path }, res => {
      const s = { status: res.statusCode, chunks: [], text: '', closed: false, close: () => req.destroy() };
      res.on('data', c => {
        const str = c.toString('utf8');
        s.chunks.push({ at: Date.now(), str });
        s.text += str;
      });
      res.on('close', () => { s.closed = true; });
      res.on('end', () => { s.closed = true; });
      res.on('error', () => { s.closed = true; });
      resolve(s);
    });
    req.on('error', reject);
    req.end();
  });
}

// #2314 item 2.1: fake in-memory channel drives code -> connect -> proxy page -> kick.
test('2.1 channel abstraction: fake in-memory channel runs full pairing and proxy lifecycle', async t => {
  const host = new PairHost({ file: join(dir(), 'hd.json') });
  const dispatch = dispatchHostRequest({
    host,
    name: 'mem-host',
    route: (req, res) => {
      if (req.url === '/collab') { res.writeHead(200, { 'content-type': 'text/html' }); return res.end(`<script>fetch('/collab/api/state')</script>`); }
      if (req.url === '/collab/api/state') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end('{"via":"fake"}'); }
      res.writeHead(404); res.end();
    },
  });

  const invokeInMemory = ({ method, path, headers, bodyBuf }) => new Promise(resolve => {
    const req = new Readable({ read() {} });
    req.method = method;
    req.url = path;
    req.headers = Object.fromEntries(Object.entries(headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
    req.socket = { remoteAddress: '127.0.0.1' };
    if (bodyBuf?.length) req.push(bodyBuf);
    req.push(null);

    const outHeaders = {};
    const stream = new PassThrough();
    const res = new EventEmitter();
    res.statusCode = 200;
    res.headersSent = false;
    res.setHeader = (k, v) => { outHeaders[k.toLowerCase()] = v; };
    res.getHeader = k => outHeaders[k.toLowerCase()];
    let resolved = false;
    const resolveHead = () => {
      if (resolved) return;
      resolved = true;
      res.headersSent = true;
      resolve({ status: res.statusCode, headers: outHeaders, stream, abort: () => stream.destroy() });
    };
    res.writeHead = (s, h = {}) => { res.statusCode = s; for (const [k, v] of Object.entries(h)) outHeaders[k.toLowerCase()] = v; resolveHead(); };
    res.write = c => { resolveHead(); stream.write(c); return true; };
    res.end = c => { resolveHead(); if (c) stream.write(c); stream.end(); res.emit('close'); };
    res.destroy = () => { stream.destroy(); res.emit('close'); };
    dispatch(req, res, { channel: 'fake', peer: '127.0.0.1', allowBrowser: false });
  });

  const fakeChannel = {
    name: 'fake',
    async requestJSON(_target, { path, method = 'GET', body, headers = {} }) {
      const bodyBuf = body === undefined ? Buffer.alloc(0) : Buffer.from(JSON.stringify(body));
      const { status, stream } = await invokeInMemory({ method, path, headers, bodyBuf });
      const chunks = [];
      for await (const c of stream) chunks.push(c);
      return { status, body: JSON.parse(Buffer.concat(chunks).toString('utf8') || 'null') };
    },
    async proxyStream(_target, { method, path, headers, req }) {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      return invokeInMemory({ method, path, headers, bodyBuf: Buffer.concat(chunks) });
    },
  };

  const channels = new ChannelRegistry([fakeChannel]);
  const client = new PairClient({ file: join(dir(), 'cl.json'), channels, name: 'mem-ctl' });
  const ctl = createServer((req, res) => remoteProxyRoute(req, res, new URL(req.url, 'http://x'), { client, channels }) ?? (res.writeHead(404), res.end()));
  const ctlPort = await listen(ctl);
  t.after(() => ctl.close());

  const { code } = host.newCode();
  const link = await client.connect({ host: 'fake-host', code, mode: 'remember', channel: 'fake' });
  assert.equal(link.channel, 'fake');
  const page = await httpCall(ctlPort, `/collab/remote/${link.id}/`);
  assert.equal(page.status, 200);
  assert.ok(page.text.includes(`/collab/remote/${link.id}/api/state`));
  const state = await httpCall(ctlPort, `/collab/remote/${link.id}/api/state`);
  assert.deepEqual(state.json, { via: 'fake' });

  // Kick drops link cleanly.
  assert.equal(host.revoke(host.list()[0].id), true);
  assert.equal((await httpCall(ctlPort, `/collab/remote/${link.id}/api/state`)).status, 401);
  assert.deepEqual(client.list(), []);
});

// #2314 items 2.4, 2.5, 2.8: real relay + host + controller end-to-end.
test('2.8 three-process E2E: enrol -> link -> proxied page + POST + progressive SSE -> security guards -> kick', async t => {
  const relayLogs = [];
  const relay = createRelay({ admissionCode: 'club-pass-42', log: (e, f) => relayLogs.push(JSON.stringify({ e, ...f })) });
  const relayPort = await listen(relay.server);
  const relayUrl = `http://127.0.0.1:${relayPort}`;
  t.after(() => relay.close());

  // Host instance.
  const hostDir = dir();
  const pairHost = new PairHost({ file: join(hostDir, 'pair-devices.json') });
  const ssePushers = new Set();
  const posted = [];
  const hostRoute = async (req, res) => {
    if (req.url === '/collab') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end(`<html><body><base href="/collab/panel/"><script>fetch('/collab/api/state')</script></body></html>`);
    }
    if (req.url === '/collab/api/state' && req.method === 'GET') {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ owner: req[REMOTE_OWNER] === true, rooms: [1] }));
    }
    if (req.url === '/collab/api/rooms/1/messages' && req.method === 'POST') {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      posted.push(body);
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ ok: true, text: body.text }));
    }
    if (req.url === '/collab/api/events') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store' });
      res.write(': connected\n\n');
      const push = msg => res.write(`data: ${msg}\n\n`);
      ssePushers.add(push);
      res.on('close', () => ssePushers.delete(push));
      return;
    }
    res.writeHead(404); res.end();
  };
  const hostDispatch = dispatchHostRequest({ host: pairHost, name: 'studio-host', route: hostRoute });
  const tunnelIdentity = new TunnelIdentity({ file: join(hostDir, 'tunnel-identity.json') });
  const tunnelHost = new TunnelHost({
    configFile: join(hostDir, 'tunnel-config.json'),
    identity: tunnelIdentity,
    dispatch: hostDispatch,
    baseReconnectMs: 50,
    maxReconnectMs: 200,
  });
  t.after(() => tunnelHost.stop());

  const hostApi = createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    return pairApiRoute(req, res, url, {
      host: pairHost,
      client: new PairClient({ file: join(hostDir, 'pair-links.json') }),
      listener: { ensure: async () => '', settle: async () => {}, bound: null },
      tunnelHost,
      hostName: 'studio-host',
    }) ?? (res.writeHead(404), res.end());
  });
  const hostApiPort = await listen(hostApi);
  t.after(() => hostApi.close());

  // Wrong admission code gets blocked status; correct admission code connects cleanly.
  const badCfg = await httpCall(hostApiPort, '/collab/api/pair/relay', {
    method: 'PUT',
    body: { relay_url: relayUrl, admission_code: 'wrong-pass' },
  });
  assert.equal(badCfg.status, 200);
  assert.equal(badCfg.json.state, 'blocked');
  assert.match(badCfg.json.error, /准入码/);

  const goodCfg = await httpCall(hostApiPort, '/collab/api/pair/relay', {
    method: 'PUT',
    body: { relay_url: relayUrl, admission_code: 'club-pass-42' },
  });
  assert.equal(goodCfg.status, 200);
  assert.equal(goodCfg.json.state, 'connected');
  assert.equal(goodCfg.json.has_admission_code, true);
  assert.equal('admission_code' in goodCfg.json, false, 'admission code never echoed back');

  // Generate connection string + QR SVG.
  const issued = await httpCall(hostApiPort, '/collab/api/pair/code', { method: 'POST', body: { channel: 'tunnel' } });
  assert.equal(issued.status, 200, issued.text);
  assert.equal(issued.json.channel, 'tunnel');
  assert.ok(issued.json.link.startsWith('bhrelay1:'));
  assert.ok(issued.json.qr_svg.includes('<svg '));

  // Controller instance (separate data dir).
  const ctlDir = dir();
  const tunnelChannel = createTunnelChannel({ keyVerifyTtlMs: 0 });
  const ctlChannels = new ChannelRegistry([createTailscaleChannel(), tunnelChannel]);
  const pairClient = new PairClient({ file: join(ctlDir, 'pair-links.json'), channels: ctlChannels, name: 'travel-laptop' });
  const ctlServer = createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    return pairApiRoute(req, res, url, {
      host: new PairHost({ file: join(ctlDir, 'pair-devices.json') }),
      client: pairClient,
      listener: { ensure: async () => '', settle: async () => {}, bound: null },
      peers: async () => [],
    }) ?? remoteProxyRoute(req, res, url, { client: pairClient, channels: ctlChannels }) ?? (res.writeHead(404), res.end());
  });
  const ctlPort = await listen(ctlServer);
  t.after(() => ctlServer.close());

  // Inspect connection string before confirming.
  const inspected = await httpCall(ctlPort, '/collab/api/remote/links/inspect', {
    method: 'POST',
    body: { link: issued.json.link },
  });
  assert.equal(inspected.status, 200);
  assert.equal(inspected.json.relay_url, relayUrl);
  assert.equal(inspected.json.host_id, tunnelIdentity.hostId);
  assert.equal(inspected.json.name, 'studio-host');

  // Connect via connection string.
  const connected = await httpCall(ctlPort, '/collab/api/remote/links', {
    method: 'POST',
    body: { channel: 'tunnel', tunnel_link: issued.json.link, mode: 'remember' },
  });
  assert.equal(connected.status, 200, connected.text);
  const link = connected.json.link;
  assert.equal(link.channel, 'tunnel');
  assert.equal(link.name, 'studio-host');
  assert.equal('token' in link, false, 'credential must never reach browser');

  // Proxied HTML page rewrites /collab/ paths; JSON GET + POST work end-to-end.
  const page = await httpCall(ctlPort, `/collab/remote/${link.id}/`);
  assert.equal(page.status, 200);
  assert.ok(page.text.includes(`/collab/remote/${link.id}/panel/`));
  assert.ok(page.text.includes(`/collab/remote/${link.id}/api/state`));

  const state = await httpCall(ctlPort, `/collab/remote/${link.id}/api/state`);
  assert.equal(state.status, 200);
  assert.deepEqual(state.json, { owner: true, rooms: [1] });

  const msg = await httpCall(ctlPort, `/collab/remote/${link.id}/api/rooms/1/messages`, {
    method: 'POST',
    body: { text: 'SECRET_CROSS_MACHINE_HELLO' },
  });
  assert.equal(msg.status, 200);
  assert.equal(msg.json.text, 'SECRET_CROSS_MACHINE_HELLO');
  assert.equal(posted[0].text, 'SECRET_CROSS_MACHINE_HELLO');
  assert.ok(!relayLogs.join('\n').includes('SECRET_CROSS_MACHINE_HELLO'), 'relay never sees plaintext');

  // Security guards (#2314 item 2.4):
  // 1) Local-only pairing endpoints are refused over tunnel even with valid device credential.
  const savedLinks = JSON.parse(readFileSync(pairClient.file, 'utf8')).links;
  assert.equal(savedLinks.length, 1);
  if (process.platform !== 'win32') assert.equal(statSync(pairClient.file).mode & 0o777, 0o600);
  const target = {
    relay_url: relayUrl,
    host_id: tunnelIdentity.hostId,
    public_key: savedLinks[0].public_key,
    enc_key: savedLinks[0].enc_key,
  };
  const pairCodeViaTunnel = await tunnelChannel.requestJSON(target, {
    path: '/collab/api/pair/code',
    method: 'POST',
    headers: { authorization: `Bearer ${savedLinks[0].token}` },
  });
  assert.equal(pairCodeViaTunnel.status, 403);
  const devicesViaTunnel = await tunnelChannel.requestJSON(target, {
    path: '/collab/api/pair/devices',
    method: 'GET',
    headers: { authorization: `Bearer ${savedLinks[0].token}` },
  });
  assert.equal(devicesViaTunnel.status, 403);

  // 2) Requests without valid device credential are refused (even /collab/pair/hello).
  const noCred = await tunnelChannel.requestJSON(target, { path: '/collab/api/state', method: 'GET' });
  assert.equal(noCred.status, 401);
  const helloNoCred = await tunnelChannel.requestJSON(target, { path: '/collab/pair/hello', method: 'GET' });
  assert.equal(helloNoCred.status, 401);

  // SSE event stream arrives progressively chunk by chunk, and kicking device cuts it immediately.
  const sse = await openSSE(ctlPort, `/collab/remote/${link.id}/api/events`);
  assert.equal(sse.status, 200);
  assert.equal(await until(() => ssePushers.size === 1), true);
  for (const push of ssePushers) push('event-1');
  assert.equal(await until(() => sse.text.includes('data: event-1')), true);
  await new Promise(r => setTimeout(r, 40));
  for (const push of ssePushers) push('event-2');
  assert.equal(await until(() => sse.text.includes('data: event-2')), true);
  assert.ok(sse.chunks.length >= 2, 'SSE chunks arrive progressively rather than buffered');

  // Kick the device on host -> active SSE closes immediately, next request returns 401 and clears list.
  const devId = (await httpCall(hostApiPort, '/collab/api/pair/devices')).json.devices[0].id;
  assert.equal((await httpCall(hostApiPort, `/collab/api/pair/devices/${devId}`, { method: 'DELETE' })).status, 200);
  assert.equal(await until(() => sse.closed), true, 'kicked device SSE stream must close immediately');
  const kicked = await httpCall(ctlPort, `/collab/remote/${link.id}/api/state`);
  assert.equal(kicked.status, 401);
  assert.match(kicked.json.error, /重新配对/);
  assert.deepEqual((await httpCall(ctlPort, '/collab/api/remote/links')).json.links, []);
});

test('2.5 error distinction, key substitution rejection, and relay restart auto-recovery', async t => {
  const relayPort = await freePort();
  let relay = createRelay();
  await listenOn(relay.server, relayPort);
  const relayUrl = `http://127.0.0.1:${relayPort}`;
  t.after(async () => { await relay?.close?.(); });

  const hostDir = dir();
  const pairHost = new PairHost({ file: join(hostDir, 'hd.json') });
  const hostDispatch = dispatchHostRequest({
    host: pairHost,
    name: 'mini-host',
    route: (req, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"alive":true}'); },
  });
  const tunnelIdentity = new TunnelIdentity({ file: join(hostDir, 'id.json') });
  const tunnelHost = new TunnelHost({
    configFile: join(hostDir, 'cfg.json'),
    identity: tunnelIdentity,
    dispatch: hostDispatch,
    baseReconnectMs: 50,
    maxReconnectMs: 150,
  });
  t.after(() => tunnelHost.stop());
  await tunnelHost.configure({ relayUrl });
  assert.equal((await tunnelHost.waitForSettled(3000)).state, 'connected');

  const ctlDir = dir();
  const tunnelChannel = createTunnelChannel({ keyVerifyTtlMs: 0 });
  const channels = new ChannelRegistry([createTailscaleChannel(), tunnelChannel]);
  let now = Date.now();
  const client = new PairClient({ file: join(ctlDir, 'cl.json'), channels, name: 'ctl', now: () => now });
  const ctlServer = createServer((req, res) => remoteProxyRoute(req, res, new URL(req.url, 'http://x'), { client, channels }) ?? (res.writeHead(404), res.end()));
  const ctlPort = await listen(ctlServer);
  t.after(() => ctlServer.close());

  const tc = pairHost.newTunnelCode();
  const linkStr = encodeTunnelLink({ relayUrl, hostId: tunnelIdentity.hostId, code: tc.code, expiresAt: tc.expires_at, name: 'mini-host' });
  const link = await client.connectTunnel({ link: linkStr, mode: 'remember' });
  assert.equal((await httpCall(ctlPort, `/collab/remote/${link.id}/api/state`)).status, 200);

  // Remembered tunnel link reloads cleanly after controller restart, and legacy links default to tailscale.
  const reloaded = new PairClient({ file: client.file, channels, name: 'ctl' });
  assert.equal(reloaded.list()[0].channel, 'tunnel');
  assert.equal(reloaded.list()[0].host_id, tunnelIdentity.hostId);
  const legacyFile = join(dir(), 'legacy.json');
  writeFileSync(legacyFile, JSON.stringify({ links: [{ id: '11111111-1111-4111-8111-111111111111', name: 'old', host: '100.64.0.1', port: 3082, token: 'tok', created_at: 1 }] }));
  assert.equal(new PairClient({ file: legacyFile }).list()[0].channel, 'tailscale');

  // Relay substitutes host's public key -> controller rejects!
  const entry = relay.hosts.get(tunnelIdentity.hostId);
  const origPub = entry.publicKey;
  const tamperedPub = Buffer.from(origPub, 'base64');
  tamperedPub[tamperedPub.length - 1] ^= 0xff;
  entry.publicKey = tamperedPub.toString('base64');
  const swapped = await httpCall(ctlPort, `/collab/remote/${link.id}/api/state`);
  assert.equal(swapped.status, 409);
  assert.match(swapped.json.error, /对方身份变了/);
  entry.publicKey = origPub;

  // Error 1: Host offline -> 503 with clear message.
  await tunnelHost.stop();
  assert.equal(await until(() => !relay.hosts.has(tunnelIdentity.hostId)), true);
  const offline = await httpCall(ctlPort, `/collab/remote/${link.id}/api/state`);
  assert.equal(offline.status, 503);
  assert.match(offline.json.error, /不在线/);

  // Reconnect host, then restart relay mid-session -> host recovers automatically!
  tunnelHost.start();
  assert.equal((await tunnelHost.waitForSettled(3000)).state, 'connected');
  await relay.close();
  relay = undefined;

  // Error 2: Relay unreachable -> 502 with clear message.
  const relayDown = await httpCall(ctlPort, `/collab/remote/${link.id}/api/state`);
  assert.equal(relayDown.status, 502);
  assert.match(relayDown.json.error, /连不上中继/);

  // Bring relay back on same port -> host auto-reconnects and requests succeed again!
  relay = createRelay();
  await listenOn(relay.server, relayPort);
  assert.equal(await until(() => tunnelHost.connected, 5000), true, 'host should reconnect automatically after relay restart');
  const back = await httpCall(ctlPort, `/collab/remote/${link.id}/api/state`);
  assert.equal(back.status, 200);
  assert.deepEqual(back.json, { alive: true });

  // Temporary until-disconnect tunnel link honors alive() + sweep() heartbeat (#2314 2.5).
  const tcTemp = pairHost.newTunnelCode();
  const tempStr = encodeTunnelLink({ relayUrl, hostId: tunnelIdentity.hostId, code: tcTemp.code, expiresAt: tcTemp.expires_at });
  const tempLink = await client.connectTunnel({ link: tempStr, mode: 'temp' });
  now += UNTIL_GRACE_MS - 1;
  assert.deepEqual(await client.sweep(), []);
  client.alive();
  now += ALIVE_EVERY_MS;
  assert.deepEqual(await client.sweep(), []);
  now += UNTIL_GRACE_MS;
  assert.deepEqual(await client.sweep(), [tempLink.id]);
});

test('2.8 coexistence: Tailscale and tunnel links between the same two instances work independently', async t => {
  const relay = createRelay();
  const relayPort = await listen(relay.server);
  const relayUrl = `http://127.0.0.1:${relayPort}`;
  t.after(() => relay.close());

  const hostDir = dir();
  const pairHost = new PairHost({ file: join(hostDir, 'hd.json') });
  const route = (req, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"ok":true}'); };
  const tsPort = await freePort();
  const listener = new PairListener({
    host: pairHost,
    address: async () => '127.0.0.1',
    port: tsPort,
    handler: hostHandler({ host: pairHost, name: 'dual-host', route, allowLoopback: true, whois: async () => undefined }),
  });
  t.after(() => listener.close());
  await listener.ensure();

  const tunnelIdentity = new TunnelIdentity({ file: join(hostDir, 'tid.json') });
  const tunnelHost = new TunnelHost({
    configFile: join(hostDir, 'tcfg.json'),
    identity: tunnelIdentity,
    dispatch: dispatchHostRequest({ host: pairHost, name: 'dual-host', route }),
  });
  t.after(() => tunnelHost.stop());
  await tunnelHost.configure({ relayUrl });
  assert.equal((await tunnelHost.waitForSettled(3000)).state, 'connected');

  const ctlDir = dir();
  const channels = new ChannelRegistry([
    createTailscaleChannel({ defaultPort: tsPort }),
    createTunnelChannel(),
  ]);
  const client = new PairClient({ file: join(ctlDir, 'cl.json'), port: tsPort, channels, name: 'dual-ctl' });
  const ctlServer = createServer((req, res) => remoteProxyRoute(req, res, new URL(req.url, 'http://x'), { client, channels }) ?? (res.writeHead(404), res.end()));
  const ctlPort = await listen(ctlServer);
  t.after(() => ctlServer.close());

  const tsLink = await client.connect({ host: '127.0.0.1', code: pairHost.newCode().code, mode: 'remember', name: 'via-ts' });
  const tc = pairHost.newTunnelCode();
  const tunnelLink = await client.connectTunnel({
    link: encodeTunnelLink({ relayUrl, hostId: tunnelIdentity.hostId, code: tc.code, expiresAt: tc.expires_at, name: 'via-relay' }),
    mode: 'remember',
  });

  assert.equal(tsLink.channel, 'tailscale');
  assert.equal(tunnelLink.channel, 'tunnel');
  assert.equal((await httpCall(ctlPort, `/collab/remote/${tsLink.id}/api/state`)).status, 200);
  assert.equal((await httpCall(ctlPort, `/collab/remote/${tunnelLink.id}/api/state`)).status, 200);

  // Kicking only the tunnel device leaves the Tailscale link working!
  const tunnelDev = pairHost.list().find(d => d.channel === 'tunnel');
  assert.ok(tunnelDev);
  pairHost.revoke(tunnelDev.id);
  assert.equal((await httpCall(ctlPort, `/collab/remote/${tunnelLink.id}/api/state`)).status, 401);
  assert.equal((await httpCall(ctlPort, `/collab/remote/${tsLink.id}/api/state`)).status, 200);
});
