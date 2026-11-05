import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { test } from 'node:test';
import { defaultBridgeConfig, managementSettings, panelRoute, rewritePanelHTML } from './panel.mjs';
import { resolveConfig } from './plugin.mjs';

function fakeRes() {
  const res = new PassThrough();
  res.status = 0; res.headers = {}; res.body = '';
  res.writeHead = (status, headers = {}) => { res.status = status; res.headers = headers; return res; };
  res.on('data', c => { res.body += c; });
  const done = new Promise(resolve => res.on('finish', resolve));
  res.done = done;
  return res;
}

function fakeReq(method, headers = {}, body = '') {
  const req = new PassThrough();
  req.method = method; req.headers = headers;
  req.end(body);
  return req;
}

function config(text) {
  const dir = mkdtempSync(join(tmpdir(), 'collab-panel-'));
  const file = join(dir, 'config.toml');
  writeFileSync(file, text);
  return file;
}

const CONFIG = `
[projects.x]
token = "not-this-one"

[management]
enabled = true
host = "0.0.0.0" # all interfaces
port = 9821 # 来源：测试
token = "s3cret#1"

[other]
port = 1
`;

test('reads only the [management] table, with quoted values and comments', () => {
  assert.deepEqual(managementSettings(CONFIG), { enabled: true, host: '0.0.0.0', port: 9821, token: 's3cret#1' });
  assert.deepEqual(managementSettings('[management]\nenabled = false\n'), { enabled: false, host: '', port: 9820, token: '' });
});

test('default bridge config follows BOTHOUSE_CONFIG, then the data dir', () => {
  assert.equal(defaultBridgeConfig({ BOTHOUSE_CONFIG: '/a/b.toml', HOME: '/h' }), '/a/b.toml');
  assert.equal(defaultBridgeConfig({ BOTHOUSE_DATA_DIR: '/d', HOME: '/h' }), '/d/config.toml');
  assert.equal(defaultBridgeConfig({ HOME: '/h' }), '/h/.bothouse/config.toml');
  assert.equal(resolveConfig({ dataDir: '/x', workspacePath: '/w', bridgeConfig: '/c/config.toml' }, { HOME: '/h' }).bridgeConfig, '/c/config.toml');
  assert.throws(() => resolveConfig({ dataDir: '/x', workspacePath: '/w', bridgeConfig: 'rel.toml' }, { HOME: '/h' }), /absolute/);
});

test('rewrites <base href> to the mount path and marks the page proxy-signed', () => {
  const html = '<html><head>\n<meta charset="UTF-8" />\n<base href="/" />\n<script src="./assets/a.js"></script></head></html>';
  const out = rewritePanelHTML(html);
  assert.match(out, /<base href="\/collab\/panel\/" \/>/);
  assert.match(out, /<meta name="bothouse-auth" content="proxy" \/>/);
  assert.equal((out.match(/<base /g) ?? []).length, 1);
  // An older panel build without <base> still gets one.
  assert.match(rewritePanelHTML('<html><head><title>x</title></head></html>'), /<head>\n {4}<base href="\/collab\/panel\/" \/>/);
});

test('moves <base> under an outer proxy prefix such as the panel\'s /dsh/ mount', () => {
  // Windows report 11-05: opened through the management server's /dsh/ proxy, the frame is at
  // /dsh/collab/panel/, but a fixed <base href="/collab/panel/"> sent ./assets/*.js to the
  // management server's own /collab/panel/..., which answers with HTML: blank page.
  const out = rewritePanelHTML('<head><base href="/" /><script type="module" src="./assets/i.js"></script></head>');
  const inline = /<script>(.*?)<\/script>/.exec(out)[1];
  const run = pathname => {
    let href = /<base href="([^"]+)"/.exec(out)[1];
    const base = { setAttribute: (k, v) => { assert.equal(k, 'href'); href = v; } };
    new Function('location', 'document', inline)({ pathname }, { querySelector: () => base });
    return new URL('./assets/i.js', new URL(href, `http://panel.local${pathname}`)).pathname;
  };
  assert.equal(run('/dsh/collab/panel/'), '/dsh/collab/panel/assets/i.js');
  assert.equal(run('/dsh/collab/panel/roles'), '/dsh/collab/panel/assets/i.js');
  assert.equal(run('/collab/panel/'), '/collab/panel/assets/i.js');
  assert.equal(run('/collab/panel/roles/x'), '/collab/panel/assets/i.js');
  // The fix runs before the panel's own scripts resolve their URLs.
  assert.ok(out.indexOf('<script>') < out.indexOf('./assets/i.js'));
});

test('signs API calls server-side, drops client credentials, and returns the upstream body', async () => {
  const calls = [];
  const fetchImpl = async (u, init) => {
    calls.push({ url: String(u), init });
    return new Response('{"ok":true,"data":{"items":[]}}', { status: 200, headers: { 'content-type': 'application/json', 'set-cookie': 'x=1' } });
  };
  const res = fakeRes();
  const req = fakeReq('GET', { authorization: 'Bearer from-browser', cookie: 'dsh=1', accept: 'application/json' });
  await panelRoute(req, res, new URL('http://h/collab/panel/api/v1/usage/roles?from=2026-11-01'), { bridgeConfig: config(CONFIG), fetchImpl });
  await res.done;
  assert.equal(res.status, 200);
  assert.equal(res.body, '{"ok":true,"data":{"items":[]}}');
  assert.equal(res.headers['set-cookie'], undefined);
  assert.equal(calls[0].url, 'http://127.0.0.1:9821/api/v1/usage/roles?from=2026-11-01');
  assert.deepEqual(calls[0].init.headers, { accept: 'application/json', authorization: 'Bearer s3cret#1' });
});

test('forwards request bodies for writes', async () => {
  let seen;
  const fetchImpl = async (_u, init) => { seen = { method: init.method, body: await new Response(init.body).text() }; return new Response('{"ok":true}', { headers: { 'content-type': 'application/json' } }); };
  const res = fakeRes();
  await panelRoute(fakeReq('PATCH', { 'content-type': 'application/json' }, '{"a":1}'), res, new URL('http://h/collab/panel/api/v1/projects/x'), { bridgeConfig: config(CONFIG), fetchImpl });
  await res.done;
  assert.deepEqual(seen, { method: 'PATCH', body: '{"a":1}' });
});

test('serves the panel page with the rewritten base and redirects the bare prefix', async () => {
  const fetchImpl = async () => new Response('<html><head><base href="/" /></head></html>', { headers: { 'content-type': 'text/html; charset=utf-8' } });
  const res = fakeRes();
  await panelRoute(fakeReq('GET'), res, new URL('http://h/collab/panel/roles'), { bridgeConfig: config(CONFIG), fetchImpl });
  assert.match(res.body, /<base href="\/collab\/panel\/" \/>/);
  const bare = fakeRes();
  await panelRoute(fakeReq('GET'), bare, new URL('http://h/collab/panel?x=1'), { bridgeConfig: '/nope' });
  assert.equal(bare.status, 308);
  assert.equal(bare.headers.location, '/collab/panel/?x=1');
});

test('ignores other paths', () => {
  assert.equal(panelRoute(fakeReq('GET'), fakeRes(), new URL('http://h/collab/api/state'), { bridgeConfig: '/nope' }), undefined);
  assert.equal(panelRoute(fakeReq('GET'), fakeRes(), new URL('http://h/collab/panelx'), { bridgeConfig: '/nope' }), undefined);
});

test('missing config, disabled API or unreachable bridge never leak the token', async () => {
  const cases = [
    [{ bridgeConfig: '/definitely/missing.toml' }, 503],
    [{ bridgeConfig: config('[management]\nenabled = false\ntoken = "s3cret#1"\n') }, 503],
    [{ bridgeConfig: config(CONFIG), fetchImpl: async () => { throw new Error('ECONNREFUSED s3cret#1'); } }, 502],
  ];
  for (const [opts, status] of cases) {
    for (const path of ['/collab/panel/api/v1/status', '/collab/panel/']) {
      const res = fakeRes();
      await panelRoute(fakeReq('GET'), res, new URL(`http://h${path}`), opts);
      assert.equal(res.status, status);
      assert.doesNotMatch(res.body, /s3cret/);
    }
  }
});
