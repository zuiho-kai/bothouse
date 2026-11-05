import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, readFileSync } from 'node:fs';
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
const rowsWith = (channelsOn) => [
  { patchId: 'conest-collab', entryId: 'e0', enabled: true },
  { patchId: 'conest-channels-ui', entryId: 'e1', enabled: channelsOn },
  ...PAGE_ROWS.map((id, i) => ({ patchId: id, entryId: `p${i}`, enabled: false })),
];
const marker = () => join(mkdtempSync(join(tmpdir(), 'pages-')), 'pages-migrated');

test('a new install leaves the pages off and only marks', async () => {
  const m = fakeManager(rowsWith(true)), file = marker();
  assert.equal(await migratePageRows(m, { markerFile: file, existed: false }), 'fresh');
  assert.deepEqual(m.calls, []);
  assert.ok(existsSync(file));
});

test('an install from before switches the three pages on once', async () => {
  const m = fakeManager(rowsWith(true)), file = marker();
  assert.equal(await migratePageRows(m, { markerFile: file, existed: true }), 'enabled');
  assert.deepEqual(m.calls, [['p0', true], ['p1', true], ['p2', true]]);
  assert.match(readFileSync(file, 'utf8'), /^enabled /);
  assert.equal(await migratePageRows(m, { markerFile: file, existed: true }), 'done-before');
  assert.equal(m.calls.length, 3);
});

test('channels off before means no page showed before: nothing switched on', async () => {
  const m = fakeManager(rowsWith(false)), file = marker();
  assert.equal(await migratePageRows(m, { markerFile: file, existed: true }), 'channels-off');
  assert.deepEqual(m.calls, []);
});

test('no plugin manager: no mark, retried next start', async () => {
  const file = marker();
  assert.equal(await migratePageRows(undefined, { markerFile: file, existed: true }), 'no-manager');
  assert.equal(existsSync(file), false);
});
