import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { migratePageRows, PAGE_ROWS } from './pages-migrate.mjs';

function fakeManager(rows) {
  const calls = [];
  return {
    calls,
    async listPlugins() { return rows; },
    async setPluginEnabled(id, enabled) { calls.push([id, enabled]); },
  };
}
const rowsWith = (channelsOn, channelsRow = 'conest-channels-ui') => [
  { patchId: 'conest-collab', entryId: 'e0', enabled: true },
  { patchId: channelsRow, entryId: 'e1', enabled: channelsOn },
  ...PAGE_ROWS.map((id, i) => ({ patchId: id, entryId: `p${i}`, enabled: false })),
];
function files(before) {
  const dir = mkdtempSync(join(tmpdir(), 'pages-'));
  const beforeFile = join(dir, 'pages-before-1044.json');
  if (before) writeFileSync(beforeFile, JSON.stringify({ rows: before }));
  return { markerFile: join(dir, 'pages-migrated-1044'), beforeFile };
}

test('a new install leaves the pages off and only marks', async () => {
  const m = fakeManager(rowsWith(true)), f = files(PAGE_ROWS);
  assert.equal(await migratePageRows(m, { ...f, existed: false }), 'fresh');
  assert.deepEqual(m.calls, []);
  assert.ok(existsSync(f.markerFile));
});

test('bridge upgrade switches on exactly the pages the old UI showed, once', async () => {
  const m = fakeManager(rowsWith(true)), f = files(['bothouse-desk', 'bothouse-devices']);
  assert.equal(await migratePageRows(m, { ...f, existed: true }), 'enabled');
  assert.deepEqual(m.calls, [['p0', true], ['p2', true]]);
  assert.match(readFileSync(f.markerFile, 'utf8'), /^enabled /);
  assert.equal(await migratePageRows(m, { ...f, existed: true }), 'done-before');
  assert.equal(m.calls.length, 2);
});

test('bridge upgrade without the bridge note switches nothing on', async () => {
  const m = fakeManager(rowsWith(true)), f = files();
  assert.equal(await migratePageRows(m, { ...f, existed: true }), 'enabled');
  assert.deepEqual(m.calls, []);
});

test('npm upgrade keeps desk and panel (what 0.1.47/0.1.48 showed), not other computers', async () => {
  const m = fakeManager(rowsWith(true, 'bothouse-channels')), f = files();
  assert.equal(await migratePageRows(m, { ...f, existed: true }), 'enabled');
  assert.deepEqual(m.calls, [['p0', true], ['p1', true]]);
});

test('channels off before means no page showed before: nothing switched on', async () => {
  const m = fakeManager(rowsWith(false)), f = files(PAGE_ROWS);
  assert.equal(await migratePageRows(m, { ...f, existed: true }), 'channels-off');
  assert.deepEqual(m.calls, []);
});

test('no plugin manager: no mark, retried next start', async () => {
  const f = files(PAGE_ROWS);
  assert.equal(await migratePageRows(undefined, { ...f, existed: true }), 'no-manager');
  assert.equal(existsSync(f.markerFile), false);
});
