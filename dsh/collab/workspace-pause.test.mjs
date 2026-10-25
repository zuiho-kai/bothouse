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

test('stale task pauses through existing queue without pausing fresh work', () => {
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

test('workspace role messages refresh stale activity', () => {
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

test('[ask] pauses the bound owner task and leaves its row on the source board', async () => {
  const hub = makeHub();
  const ws = hub.store.createWorkspace(1);
  hub.setMember({ id: 'ds', name: 'DeepSeek', kind: 'dsh', online: true });
  const tasks = new Tasks(hub, { setTimer: () => ({}), clearTimer() {} });
  hub.tasks = tasks;
  new TeamExit(hub);
  const task = tasks.assign({ roomId: ws.id, title: 'choose', owner: 'ds', actor: 'owner' });
  hub.post(ws.id, { authorKind: 'role', author: 'ds', name: 'DeepSeek', text: '[ask]\nPR #280 should merge?' });
  await new Promise(r => setImmediate(r));
  assert.ok(tasks.task(task.id).paused_at);
  assert.equal(hub.store.workspaceOwner(ws.id), null);
  assert.equal(tasks.list(1)[0].id, task.id);
  tasks.close();
});
