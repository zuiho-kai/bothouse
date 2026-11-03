import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { defaultBridgeConfig, managementSettings, usageRoute } from './usage.mjs';
import { resolveConfig } from './plugin.mjs';

function fakeRes() {
  const res = { status: 0, headers: {}, body: '' };
  res.writeHead = (status, headers) => { res.status = status; res.headers = headers; return res; };
  res.end = body => { res.body = String(body ?? ''); };
  return res;
}

function config(text) {
  const dir = mkdtempSync(join(tmpdir(), 'collab-usage-'));
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

test('forwards the query with the token server-side and returns only the body', async () => {
  const calls = [];
  const fetchImpl = async (u, init) => { calls.push({ url: String(u), init }); return new Response('{"ok":true,"data":{"items":[{"total_tokens":5}]}}', { status: 200 }); };
  const res = fakeRes();
  const url = new URL('http://h/collab/api/usage/daily?from=2026-11-01&to=2026-11-03&role=cjiang&token=leak&x=1');
  const handled = usageRoute({ method: 'GET' }, res, url, { bridgeConfig: config(CONFIG), fetchImpl });
  assert.ok(handled instanceof Promise);
  await handled;
  assert.equal(res.status, 200);
  assert.deepEqual(JSON.parse(res.body), { items: [{ total_tokens: 5 }] });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'http://127.0.0.1:9821/api/v1/usage/daily?from=2026-11-01&to=2026-11-03&role=cjiang');
  assert.equal(calls[0].init.headers.authorization, 'Bearer s3cret#1');
});

test('ignores other paths and methods; rejects unknown groups', async () => {
  const opts = { bridgeConfig: '/nope', fetchImpl: () => assert.fail('no fetch') };
  assert.equal(usageRoute({ method: 'GET' }, fakeRes(), new URL('http://h/collab/api/state'), opts), undefined);
  assert.equal(usageRoute({ method: 'POST' }, fakeRes(), new URL('http://h/collab/api/usage/daily'), opts), undefined);
  const res = fakeRes();
  await usageRoute({ method: 'GET' }, res, new URL('http://h/collab/api/usage/secrets'), opts);
  assert.equal(res.status, 404);
});

test('missing config, disabled API, unreachable or rejecting bridge never leak the token', async () => {
  const cases = [
    [{ bridgeConfig: '/definitely/missing.toml' }, 503],
    [{ bridgeConfig: config('[management]\nenabled = false\ntoken = "s3cret#1"\n') }, 503],
    [{ bridgeConfig: config(CONFIG), fetchImpl: async () => { throw new Error('ECONNREFUSED s3cret#1'); } }, 502],
    [{ bridgeConfig: config(CONFIG), fetchImpl: async () => new Response('unauthorized', { status: 401 }) }, 502],
    [{ bridgeConfig: config(CONFIG), fetchImpl: async () => new Response('invalid from date', { status: 400 }) }, 400],
  ];
  for (const [opts, status] of cases) {
    const res = fakeRes();
    await usageRoute({ method: 'GET' }, res, new URL('http://h/collab/api/usage/roles'), opts);
    assert.equal(res.status, status);
    assert.doesNotMatch(res.body, /s3cret/);
    assert.equal(JSON.parse(res.body).error.startsWith('usage-'), true);
  }
});
