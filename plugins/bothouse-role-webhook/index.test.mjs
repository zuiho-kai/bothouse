import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bodyFor, lineFor } from './index.mjs';

const ev = { type: 'error', role_key: 'bridge:deep', role: { display_name: '龙娘' } };
test('line names the role and the status', () => assert.equal(lineFor(ev), '龙娘 出错了'));
test('each format puts the line where that webhook reads it', () => {
  assert.deepEqual(bodyFor('discord', ev), { content: '龙娘 出错了' });
  assert.deepEqual(bodyFor('slack', ev), { text: '龙娘 出错了' });
  assert.deepEqual(bodyFor('feishu', ev), { msg_type: 'text', content: { text: '龙娘 出错了' } });
  assert.equal(bodyFor('json', ev).event, ev);
});
