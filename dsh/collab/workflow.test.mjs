// #574 dispatch fields: an API dispatch needs `ref` (file:line, or 无（新建） for work with no
// existing implementation), a multi-editor task (共改文件/多人改) also needs `base`, and a
// rework verdict needs a reason. Same checks as contrib/lead/ws-handoff and board done.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from './store.mjs';
import { Hub } from './hub.mjs';
import { Tasks, MISSING_REF, hasRef, CHECK_AFTER_S, MAX_RENEWALS } from './tasks.mjs';

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

// #574 B2: a workspace task at its 10-minute check is renewed when the workspace has new role
// messages (at most MAX_RENEWALS times), otherwise parked. Same rule as contrib/lead/d10-fire.
function watchSetup() {
  const { hub } = setup();
  const ws = hub.store.createWorkspace(1);
  let now = 10000;
  const tasks = new Tasks(hub, { now: () => now, setTimer: () => ({}), clearTimer() {} });
  const t = tasks.assign({ roomId: ws.id, title: '看门', owner: 'ds', actor: 'lead' });
  return {
    hub, ws, tasks, t,
    at: s => { now = 10000 + s; tasks.tick(); return tasks.task(t.id); },
    say: s => hub.store.append(ws.id, { authorKind: 'role', author: 'ds', name: 'DeepSeek', text: '进度' }, 10000 + s),
    records: () => hub.store.page(ws.id, undefined, 200).filter(m => m.name === '任务' && /已暂停/.test(m.text)),
  };
}

test('watch: no activity in 10 minutes parks the workspace task', () => {
  const { tasks, ws, hub, at, records } = watchSetup();
  assert.equal(at(CHECK_AFTER_S - 1).paused_at, null, 'not before the check time');
  const t = at(CHECK_AFTER_S);
  assert.ok(t.paused_at, 'parked at 10 minutes, not after an hour');
  assert.equal(t.renewals, 0);
  assert.equal(hub.store.workspaceOwner(ws.id), null, 'workspace back to the pool');
  assert.match(records()[0].text, /10 分钟内没有新进展，已暂停/);
  assert.equal(hub.store.page(ws.id, undefined, 200).filter(m => m.name === '任务提醒').length, 0, 'no reminder instead');
  tasks.close();
});

test('watch: a message in the window renews 10 minutes', () => {
  const { tasks, say, at } = watchSetup();
  say(300);
  const t = at(CHECK_AFTER_S);
  assert.equal(t.paused_at, null);
  assert.equal(t.renewals, 1);
  assert.equal(t.next_check_at, 10000 + 2 * CHECK_AFTER_S);
  // The next window has no new message: parked.
  assert.ok(at(2 * CHECK_AFTER_S).paused_at);
  tasks.close();
});

test(`watch: after ${MAX_RENEWALS} renewals it parks even with new messages`, () => {
  const { tasks, say, at, records } = watchSetup();
  say(300); assert.equal(at(CHECK_AFTER_S).renewals, 1);
  say(900); assert.equal(at(2 * CHECK_AFTER_S).renewals, 2);
  say(1500);
  const t = at(3 * CHECK_AFTER_S);
  assert.ok(t.paused_at, 'third check parks');
  assert.equal(t.renewals, MAX_RENEWALS);
  assert.match(records()[0].text, /已续期 2 次，已暂停/);
  tasks.close();
});

test('watch: a parked task answered again gets a fresh 10 minutes and renewals', () => {
  const { tasks, t, say, at } = watchSetup();
  say(300); at(CHECK_AFTER_S); say(900); at(2 * CHECK_AFTER_S);
  assert.ok(at(3 * CHECK_AFTER_S).paused_at);
  const back = tasks.stance(t.id, { actor: 'ds', stance: '接' });
  assert.equal(back.paused_at, null);
  assert.equal(back.next_check_at, 10000 + 4 * CHECK_AFTER_S);
  assert.equal(tasks.task(t.id).renewals, 0);
  tasks.close();
});

test('watch: tasks in a bridge-claimed workspace are left to the bridge watchdog', () => {
  const { hub } = setup();
  const ws = hub.store.createWorkspace(1, { bridge: true });
  let now = 10000;
  const timers = [];
  const tasks = new Tasks(hub, { now: () => now, setTimer: (_f, ms) => { timers.push(ms); return {}; }, clearTimer() {} });
  const ids = ['mention', 'card'].map(source => {
    const t = tasks.assign({ roomId: ws.id, title: `桥派的 ${source}`, owner: 'ds', actor: 'lead', force: true });
    tasks.q.setSource.run(source, t.id);
    return t.id;
  });
  timers.length = 0;
  tasks.arm();
  assert.deepEqual(timers, [], 'no check timer for bridge-claimed tasks');
  now += 3 * CHECK_AFTER_S + 1;
  tasks.tick();
  for (const id of ids) {
    const t = tasks.task(id);
    assert.equal(t.paused_at, null, 'not parked');
    assert.equal(t.remind_msg_id, null, 'not reminded');
    assert.equal(t.renewals, 0);
  }
  const page = hub.store.page(ws.id, undefined, 200);
  assert.equal(page.filter(m => m.name === '任务提醒' || /已暂停/.test(m.text)).length, 0);
  assert.equal(hub.store.workspaceOwner(ws.id), 1, 'workspace stays claimed');
  tasks.close();
});
