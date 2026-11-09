import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileFor, recordFor } from './index.mjs';

test('one file per UTC day of the event', () => {
  assert.equal(fileFor('/d', { time: '2026-11-09T10:00:00Z' }), '/d/journal-2026-11-09.jsonl');
});
test('record drops the role snapshot but keeps the name', () => {
  assert.deepEqual(recordFor({ type: 'idle', role_key: 'bridge:a', role: { display_name: 'A', sessions: [] } }),
    { type: 'idle', role_key: 'bridge:a', name: 'A' });
});
