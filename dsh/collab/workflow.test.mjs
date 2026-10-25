// #574 dispatch fields: an API dispatch needs `ref` (file:line, or 无（新建） for work with no
// existing implementation), a multi-editor task (共改文件/多人改) also needs `base`, and a
// rework verdict needs a reason. Same checks as contrib/lead/ws-handoff and board done.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from './store.mjs';
import { Hub } from './hub.mjs';
import { Tasks, MISSING_REF, hasRef } from './tasks.mjs';

function setup() {
  const store = new Store(':memory:');
  store.ensureRoom(1, 'general');
  const hub = new Hub(store, { warn() {}, info() {} });
  hub.setMember({ id: 'owner', name: 'Owner', kind: 'human', online: true });
  hub.setMember({ id: 'lead', name: '橘', kind: 'dsh', online: true });
  hub.setMember({ id: 'ds', name: 'DeepSeek', kind: 'dsh', online: true });
  const tasks = new Tasks(hub, { now: () => 1000, setTimer: () => ({}), clearTimer() {} });
  const assign = body => tasks.perform('assign', { roomId: 1, body: { owner: 'ds', force: true, ...body } }, { actor: 'lead', verified: true });
  return { hub, tasks, assign };
}

test('dispatch without ref is refused with an example', () => {
  const { tasks, assign } = setup();
  for (const ref of [undefined, '', '   ', '看着办', '14:30 前做完']) {
    assert.throws(() => assign({ title: '改派活校验', ref }), e => e.code === 'invalid' && e.message.startsWith(MISSING_REF) && e.message.includes('示例'), String(ref));
  }
  assert.equal(tasks.list(1).length, 0);
  tasks.close();
});

test('ref 无（新建） passes for work with no existing implementation', () => {
  const { tasks, assign } = setup();
  const t = assign({ title: '写发布文案', ref: '无（新建）' });
  assert.equal(t.ref, '无（新建）');
  assert.equal(t.base, null);
  assert.ok(hasRef('无(新建)'));
  tasks.close();
});

test('ref with file:line passes and shows in the record', () => {
  const { hub, tasks, assign } = setup();
  const t = assign({ title: '加 ref 校验', ref: '~/im-bridge/bin/ws-handoff:68（照它的判据）' });
  assert.equal(t.ref, '~/im-bridge/bin/ws-handoff:68（照它的判据）');
  assert.ok(hasRef('tasks.mjs:226'));
  const record = hub.store.message(t.assign_msg_id);
  assert.match(record.text, /参照：~\/im-bridge\/bin\/ws-handoff:68/);
  tasks.close();
});

test('multi-editor dispatch without base is refused; with base it passes', () => {
  const { tasks, assign } = setup();
  assert.throws(() => assign({ title: '多人改 tasks.mjs 的 tick', ref: 'dsh/collab/tasks.mjs:360' }), e => e.code === 'invalid' && /底分支/.test(e.message));
  assert.throws(() => assign({ title: '共改文件：store.mjs', ref: 'dsh/collab/store.mjs:183', base: '  ' }), e => e.code === 'invalid');
  const t = assign({ title: '多人改 tasks.mjs 的 tick', ref: 'dsh/collab/tasks.mjs:360', base: 'ws2/b1-dsh-assign-ref-1025' });
  assert.equal(t.base, 'ws2/b1-dsh-assign-ref-1025');
  // A single-editor task does not need base.
  assert.equal(assign({ title: '一个人改', ref: 'dsh/collab/tasks.mjs:360' }).base, null);
  tasks.close();
});

test('rework without a reason is refused; with one it goes back to the owner', () => {
  const { hub, tasks, assign } = setup();
  const t = assign({ title: '写文档', ref: '无（新建）' });
  const { message } = hub.post(1, { authorKind: 'role', author: 'ds', name: 'DeepSeek', text: 'done' });
  tasks.handBack(t.id, { actor: 'ds', messageId: message.id });
  for (const note of [undefined, '', '  ']) {
    assert.throws(() => tasks.perform('review', { id: t.id, body: { verdict: 'rework', note } }, { actor: 'lead', verified: true }), e => e.code === 'invalid' && /返工要写原因/.test(e.message));
  }
  assert.equal(tasks.task(t.id).status, 'returned');
  const back = tasks.perform('review', { id: t.id, body: { verdict: 'rework', note: '没先读现有实现' } }, { actor: 'lead', verified: true });
  assert.equal(back.status, 'rework');
  assert.equal(back.note, '没先读现有实现');
  tasks.close();
});

test('tasks opened from chat skip the ref check', () => {
  const { tasks } = setup();
  const t = tasks.assign({ roomId: 1, title: '频道里派的', owner: 'ds', actor: 'lead', force: true });
  assert.equal(t.ref, null);
  tasks.close();
});
