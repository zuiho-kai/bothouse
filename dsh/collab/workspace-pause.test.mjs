import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from './store.mjs';
import { Hub } from './hub.mjs';
import { Tasks } from './tasks.mjs';
import { TeamExit } from './team-exit.mjs';
function makeHub() {
  const store = new Store(':memory:');
  store.ensureRoom(1, 'general');
  const hub = new Hub(store, { warn() {}, info() {} });
  hub.setMember({ id: 'owner', name: 'Owner', kind: 'human', online: true });
  return hub;
}

test('a task idle past its 10-minute check pauses through the existing queue without pausing fresh work', () => {
  const hub = makeHub();
  const ws = hub.store.createWorkspace(1);
  hub.setMember({ id: 'ds', name: 'DeepSeek', kind: 'dsh', online: true });
  let now = 10000;
  const tasks = new Tasks(hub, { now: () => now, setTimer: () => ({}), clearTimer() {} });
  const old = tasks.assign({ roomId: ws.id, title: 'old', owner: 'ds', actor: 'owner' });
  now += 3500;
  const fresh = tasks.assign({ roomId: ws.id, title: 'fresh', owner: 'owner', actor: 'owner', force: true });
  now += 101;
  tasks.tick();
  assert.ok(tasks.task(old.id).paused_at);
  assert.equal(tasks.task(fresh.id).paused_at, null);
  assert.equal(tasks.countActive(ws.id), 1);
  assert.equal(hub.store.workspaceOwner(ws.id), 1);
  tasks.pauseTask(fresh.id);
  assert.equal(hub.store.workspaceOwner(ws.id), null);
  assert.equal(tasks.list(1).length, 2);
  tasks.close();
});

test('workspace role messages renew the 10-minute check, then idle parks', () => {
  const hub = makeHub();
  const ws = hub.store.createWorkspace(1);
  hub.setMember({ id: 'ds', name: 'DeepSeek', kind: 'dsh', online: true });
  let now = 10000;
  const tasks = new Tasks(hub, { now: () => now, setTimer: () => ({}), clearTimer() {} });
  const task = tasks.assign({ roomId: ws.id, title: 'active', owner: 'ds', actor: 'owner' });
  now += 3500;
  hub.store.append(ws.id, { authorKind: 'role', author: 'ds', name: 'DeepSeek', text: '进度' }, now);
  now += 101;
  tasks.tick();
  assert.equal(tasks.task(task.id).paused_at, null);
  now += 3600;
  tasks.tick();
  assert.ok(tasks.task(task.id).paused_at);
  tasks.close();
});

test('a bridge bot\'s [ask] pauses the bound owner task and leaves its row on the source board', async () => {
  const hub = makeHub();
  const ws = hub.store.createWorkspace(1);
  hub.setMember({ id: 'ds', name: 'DeepSeek', kind: 'bot', online: true });
  const tasks = new Tasks(hub, { setTimer: () => ({}), clearTimer() {} });
  hub.tasks = tasks;
  new TeamExit(hub);
  const task = tasks.assign({ roomId: ws.id, title: 'choose', owner: 'ds', actor: 'owner' });
  hub.post(ws.id, { authorKind: 'role', author: 'ds', name: 'DeepSeek', text: `[ask] #${task.id} PR #280 should merge?\n自验：无需\n类别：方向` });
  await new Promise(r => setImmediate(r));
  assert.ok(tasks.task(task.id).paused_at);
  assert.equal(hub.store.workspaceOwner(ws.id), null);
  assert.equal(tasks.list(1)[0].id, task.id);
  tasks.close();
});

test('[ask] headline #N pauses that task without repeating the ID in the body', async () => {
  const hub = makeHub();
  const ws = hub.store.createWorkspace(1);
  hub.setMember({ id: 'ds', name: 'DeepSeek', kind: 'bot', online: true });
  const tasks = new Tasks(hub, { setTimer: () => ({}), clearTimer() {} });
  hub.tasks = tasks;
  new TeamExit(hub);
  const first = tasks.assign({ roomId: ws.id, title: 'first', owner: 'ds', actor: 'owner' });
  hub.setMember({ id: 'ds2', name: 'DeepSeek2', kind: 'bot', online: true });
  const second = tasks.assign({ roomId: ws.id, title: 'second', owner: 'ds2', actor: 'owner' });
  // room fallback picks the most recently updated task; make that the other one
  tasks.db.prepare('UPDATE tasks SET updated_at = ? WHERE id = ?').run(1, first.id);
  hub.post(ws.id, { authorKind: 'role', author: 'ds', name: 'DeepSeek', text: `[ask] #${first.id} 选 A 还是 B\n自验：无需\n类别：方向` });
  await new Promise(r => setImmediate(r));
  assert.ok(tasks.task(first.id).paused_at);
  assert.ok(!tasks.task(second.id).paused_at);
  tasks.close();
});

test('an unnumbered [ask] only falls back to the room task after two correction attempts', async () => {
  const hub = makeHub();
  const ws = hub.store.createWorkspace(1);
  hub.setMember({ id: 'ds', name: 'DeepSeek', kind: 'bot', online: true });
  const tasks = new Tasks(hub, { setTimer: () => ({}), clearTimer() {} });
  hub.tasks = tasks;
  new TeamExit(hub);
  const task = tasks.assign({ roomId: ws.id, title: 'choose', owner: 'ds', actor: 'owner' });
  for (let attempt = 0; attempt < 3; attempt++) {
    hub.post(ws.id, { authorKind: 'role', author: 'ds', name: 'DeepSeek', text: '[ask] PR #280 要不要合\n自验：无需\n类别：方向' });
    await new Promise(r => setImmediate(r));
    if (attempt < 2) {
      assert.equal(tasks.task(task.id).paused_at, null, 'invalid headline does not park a task yet');
      assert.equal(hub.store.page(1).some(m => m.text.startsWith('📬')), false);
    }
  }
  assert.ok(tasks.task(task.id).paused_at);
  tasks.close();
});
