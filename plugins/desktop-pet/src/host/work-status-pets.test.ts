/**
 * bothouse fork：按宠物的工作状态槽（POST /work-status?pet=<id>，一个角色一只桌宠）。
 * 钉住：各宠物各存一份、回空闲保留条目；全局快照不受影响；客户端解析能读回 pets。
 *
 * 跑法：node --experimental-strip-types --test src/host/work-status-pets.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WorkStatusStore } from './work-status.ts';
import { toWorkStatus } from '../shared/work-status.ts';

test('各宠物各存一份，回空闲保留条目，不动全局快照', () => {
  const s = new WorkStatusStore();
  s.setPet('bh-a', 'working', '写代码');
  s.setPet('bh-b', 'thinking');
  s.setPet('bh-a', null);
  assert.deepEqual(s.pets(), {
    'bh-a': { state: null, task: null },
    'bh-b': { state: 'thinking', task: null },
  });
  assert.equal(s.snapshot().state, null);
});

test('同一只宠物只换档位时保留任务文案', () => {
  const s = new WorkStatusStore();
  s.setPet('p', 'working', '修 bug');
  assert.deepEqual(s.setPet('p', 'result'), { state: 'result', task: '修 bug' });
});

test('客户端解析读回 pets，不认识的档位归空闲', () => {
  const snap = toWorkStatus({ state: null, task: null, pets: { a: { state: 'working', task: 'x' }, b: { state: 'bogus' } } });
  assert.deepEqual(snap?.pets, { a: { state: 'working', task: 'x' }, b: { state: null, task: null } });
});
