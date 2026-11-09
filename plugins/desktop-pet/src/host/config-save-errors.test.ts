import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { apply } from './index.ts';
import { createStandaloneContext, type StandaloneLogger } from '../standalone/context.ts';
import { listenStandaloneServer, type StandaloneServer } from '../standalone/server.ts';

// 用隔离存储在 HTTP 上跑真实路由；不需要素材，也不触发模型调用。
const pet = {
  id: 'main',
  name: 'Blue',
  size: 240,
  balanceEnabled: false,
  display: 'web',
  position: { corner: 'top-right', marginX: 20, marginY: 20 },
};
const warnings: string[] = [];
const logger: StandaloneLogger = { info: () => {}, debug: () => {}, error: () => {}, warn: (m) => warnings.push(m) };
let home = '';
let file = '';
let server: StandaloneServer;
let context: ReturnType<typeof createStandaloneContext>;
let previousHome: string | undefined;

before(async () => {
  previousHome = process.env.DSH_HOME;
  home = mkdtempSync(join(tmpdir(), 'dsh-pet-save-errors-'));
  process.env.DSH_HOME = home;
  file = join(home, 'dsh-pet', 'main-config.jsonc');
  mkdirSync(join(home, 'dsh-pet'), { recursive: true });
  const routes: ReturnType<typeof createStandaloneContext>['routes'] = [];
  context = createStandaloneContext({ port: 0, routes, logger });
  apply(context.ctx);
  server = await listenStandaloneServer({ port: 0, routes, logger });
});

after(async () => {
  await context?.dispose();
  await server?.close();
  if (previousHome === undefined) delete process.env.DSH_HOME;
  else process.env.DSH_HOME = previousHome;
  rmSync(home, { recursive: true, force: true });
});

async function put(body: string, query = '') {
  const response = await fetch(`http://127.0.0.1:${server.port}/dsh-pet-7340/config${query}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body,
  });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

test('config save errors: malformed JSON is 400 + invalid-json and never writes a file', async () => {
  const result = await put('{');
  assert.equal(result.status, 400);
  assert.equal(result.body.reason, 'invalid-json');
  assert.equal(existsSync(file), false);
});

test('config save errors: invalid fields are 200 + bad-request and leave storage unchanged', async () => {
  const result = await put(JSON.stringify({ pets: [{ ...pet, size: -1 }] }));
  assert.equal(result.status, 200);
  assert.equal(result.body.reason, 'bad-request');
  assert.match(String(result.body.message), /^invalid pet config:/);
  assert.equal(existsSync(file), false);
});

test('config save errors: corrupt-file confirmation still prevents an overwrite', async (t) => {
  writeFileSync(file, '{');
  t.after(() => rmSync(file, { force: true }));
  const result = await put(JSON.stringify({ pets: [pet] }));
  assert.equal(result.status, 200);
  assert.equal(result.body.reason, 'user-config-unparsable');
  assert.equal(result.body.needConfirm, true);
  assert.equal(readFileSync(file, 'utf8'), '{');
});

test('config save errors: an I/O failure is 200 + generate-error with details only in the server log', async (t) => {
  mkdirSync(file);
  t.after(() => rmSync(file, { recursive: true, force: true }));
  const result = await put(JSON.stringify({ pets: [pet] }), '?force=1');
  assert.equal(result.status, 200);
  assert.equal(result.body.reason, 'generate-error');
  assert.equal(result.body.message, 'failed to save config');
  assert.ok(warnings.some((m) => m.includes('config save failed:') && m.includes('main-config.jsonc')));
  assert.equal(JSON.stringify(result.body).includes(home), false);
});
