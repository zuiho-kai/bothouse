// Explicit opt-in: PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs node --test this-file.
// Real browser contexts, shipped page/package, HTTP pairing routes and PairClient.sweep.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { PairClient, PairHost, hostHandler, pairApiRoute, ALIVE_EVERY_MS, UNTIL_GRACE_MS } from './pairing.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const source = path => process.env.HEARTBEAT_REV
  ? execFileSync('git', ['show', process.env.HEARTBEAT_REV + ':' + path], { cwd: root, encoding: 'utf8' })
  : readFileSync(join(root, path), 'utf8');
const browserModule = process.env.PLAYWRIGHT_MODULE;
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const listen = async server => { await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); return server.address().port; };
const close = async server => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); };

for (const noLocks of [false, true]) test('heartbeat real browser, Web Locks ' + (noLocks ? 'absent' : 'available'), { skip: !browserModule, timeout: 180_000 }, async t => {
  const { chromium } = await import(pathToFileURL(browserModule));
  const artifacts = process.env.HEARTBEAT_ARTIFACTS ?? join(root, 'output/playwright/heartbeat');
  mkdirSync(artifacts, { recursive: true });
  const data = mkdtempSync(join(artifacts, noLocks ? 'no-locks-' : 'locks-'));
  const host = new PairHost({ file: join(data, 'host.json') });
  const hostServer = createServer(hostHandler({ host, name: 'isolated host', allowLoopback: true, route: (_req, res) => res.end('paired') }));
  const port = await listen(hostServer);
  const client = new PairClient({ file: join(data, 'client.json'), port });
  const events = [], sweeps = [], errors = [];
  const html = source('dsh/collab/devices.html');
  const bundle = source('dsh/packages/bothouse-dsh-devices/client.js');
  const shell = '<!doctype html><title>Heartbeat isolated shell</title><button id=devices>其他电脑</button><button id=other>另一个面板</button><main></main><script>' +
    'const cleanups = []; window.__ModuleLoader__ = { load(m) { const mod = m.factory(name => name === "react/jsx-runtime" ? { jsx: (type, props) => ({type, props}) } : {});' +
    'mod.apply({ effect(fn) { cleanups.push(fn()); }, locale: { register() {}, bind: () => x => x }, slots: { inject() {} }, layout: {selectPanel() {}} }); } };' +
    'document.querySelector("#devices").onclick = () => { const frame = document.createElement("iframe"); frame.src="collab/devices"; document.querySelector("main").replaceChildren(frame); };' +
    'document.querySelector("#other").onclick = () => document.querySelector("main").replaceChildren();' +
    'window.stopHeartbeat = () => cleanups.forEach(fn => typeof fn === "function" && fn());' +
    '</script><script src="/client.js"></script>';
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://isolated');
    if (url.pathname === '/collab/api/remote/alive') events.push({ at: Date.now(), referer: req.headers.referer });
    if (url.pathname === '/client.js') { res.setHeader('content-type', 'text/javascript'); return res.end(bundle); }
    if (url.pathname === '/collab/devices') { res.setHeader('content-type', 'text/html'); return res.end(html); }
    const routed = pairApiRoute(req, res, url, { host, client, peers: async () => [] });
    if (routed !== undefined) return routed;
    res.setHeader('content-type', 'text/html'); res.end(shell);
  });
  const origin = 'http://127.0.0.1:' + await listen(server);
  const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH });
  const context = await browser.newContext();
  if (noLocks) await context.addInitScript(() => Object.defineProperty(navigator, 'locks', { value: undefined }));
  context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
  await context.tracing.start({ screenshots: true, snapshots: true });
  // Real sweep at existing heartbeat cadence; no fake clock, unchanged 10 s grace.
  const sweep = setInterval(() => client.sweep().then(ids => sweeps.push(...ids)), ALIVE_EVERY_MS);
  t.after(async () => {
    clearInterval(sweep);
    await context.tracing.stop({ path: join(data, 'trace.zip') });
    await browser.close(); await close(server); await close(hostServer);
    console.log(JSON.stringify({ noLocks, data, events, sweeps, errors }));
  });
  const first = await context.newPage(); await first.goto(origin);
  const second = await context.newPage(); await second.goto(origin);
  console.log(JSON.stringify({ tabs: ['first', 'second'], origin, noLocks }));
  await wait(ALIVE_EVERY_MS + ALIVE_EVERY_MS);
  assert.equal(events.length, 0, 'no paired computer: zero heartbeats');
  const pair = async mode => client.connect({ host: '127.0.0.1', code: host.newCode().code, mode, name: 'isolated host' });
  const remembered = await pair('remember');
  await first.locator('#devices').click();
  await wait(ALIVE_EVERY_MS + ALIVE_EVERY_MS);
  assert.equal(events.length, 0, 'remember only: zero heartbeats');
  await client.disconnect(remembered.id);
  const until = await pair('temp');
  await first.locator('#other').click(); await first.locator('#devices').click();
  await first.frameLocator('iframe').locator('#links li').first().waitFor();
  await wait(ALIVE_EVERY_MS);
  await first.locator('#other').click();
  const start = Date.now(), before = events.length;
  await wait(UNTIL_GRACE_MS + ALIVE_EVERY_MS);
  assert.ok(client.get(until.id), 'switching panels beyond UNTIL_GRACE_MS must not drop the real link');
  const beats = events.slice(before);
  assert.ok(beats.length >= Math.floor(UNTIL_GRACE_MS / ALIVE_EVERY_MS), 'kept alive across real sweeps');
  assert.ok(beats.length <= Math.ceil((Date.now() - start) / ALIVE_EVERY_MS), 'two windows send just one heartbeat stream');
  for (let i = 1; i < beats.length; i++) assert.ok(beats[i].at - beats[i - 1].at > ALIVE_EVERY_MS / 2, 'no duplicated per-window or page heartbeat');
  await first.close();
  const atClose = events.length;
  await wait(UNTIL_GRACE_MS + ALIVE_EVERY_MS);
  assert.ok(client.get(until.id), 'survivor takes over after a real tab close');
  assert.ok(events.length > atClose, 'surviving tab continues sending');
  // Host revokes with device panel absent: no localStorage publication.
  host.revoke(host.list()[0].id);
  await wait(ALIVE_EVERY_MS + ALIVE_EVERY_MS);
  assert.equal(client.get(until.id), undefined, 'server list learns remote revocation');
  const atDrop = events.length;
  await wait(ALIVE_EVERY_MS + ALIVE_EVERY_MS);
  assert.equal(events.length, atDrop, 'last temp disappeared: no more heartbeats');
  assert.deepEqual(errors, []);
  const final = await pair('temp');
  await second.reload(); await wait(ALIVE_EVERY_MS); await second.close();
  await wait(UNTIL_GRACE_MS + ALIVE_EVERY_MS);
  assert.equal(client.get(final.id), undefined, 'all tabs closed: real sweep removes link');
});
