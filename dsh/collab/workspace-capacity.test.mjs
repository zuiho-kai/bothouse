import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';
import { Store } from './store.mjs';
import { Hub } from './hub.mjs';
import { Tasks } from './tasks.mjs';
import { Roster } from './roster.mjs';
import { DshMembers } from './dsh-member.mjs';
import { workspacesRoute, roomSettingsRoute, drainWorkspaceQueue } from './plugin.mjs';

function setup(t, path = ':memory:') {
  const store = new Store(path);
  store.ensureRoom(1, 'one'); store.ensureRoom(2, 'two');
  const hub = new Hub(store, { warn() {}, info() {} });
  for (const id of ['lead', 'dev']) hub.setMember({ id, name: id, kind: 'dsh', online: true });
  hub.leadState = { selected: () => 'lead' };
  const tasks = new Tasks(hub, { start: false }); hub.tasks = tasks;
  const wakes = [];
  const deps = { store, hub, tasks, owner: () => false, gateway: { authorized: () => false },
    later: { verify: token => token === 'synthetic' ? { room: 1, member: 'lead' } : null },
    dsh: { nudge: (owner, msg) => { wakes.push({ owner, msg }); return true; } } };
  hub.drainWorkspaceQueue = roomId => drainWorkspaceQueue(roomId, deps);
  tasks.onRelease(hub.drainWorkspaceQueue);
  t.after(() => { tasks.close(); store.close(); });
  const call = async (method, path, body = {}, human = false) => {
    const req = Readable.from([Buffer.from(JSON.stringify(body))]);
    req.method = method; req.headers = human ? {} : { 'x-later-ticket': 'synthetic' };
    const res = { writeHead(status) { this.status = status; }, end(data) { this.body = JSON.parse(data); } };
    const options = { ...deps, owner: () => human };
    const url = new URL(path, 'http://isolated');
    await (url.pathname.endsWith('/settings') ? roomSettingsRoute(req, res, url.pathname, options) : workspacesRoute(req, res, url, options));
    return res;
  };
  const post = title => call('POST', '/collab/api/rooms/1/workspaces', { title, owner: 'dev', requirement: `requirement:${title}` });
  return { ...deps, call, post, wakes };
}

test('capacity: default three, fourth queues with record and ordered visible reason', async t => {
  const { store, post, call, wakes } = setup(t);
  for (let i = 0; i < 3; i++) assert.equal((await post(`work${i}`)).status, 200);
  const fourth = await post('fourth'); const fifth = await post('fifth');
  assert.equal(fourth.status, 200); assert.equal(fourth.body.queued, true);
  assert.equal(fourth.body.message, '已排队'); assert.equal(fourth.body.queue.position, 1);
  assert.equal(fifth.body.queue.position, 2); assert.match(fourth.body.queue.reason, /上限 3/);
  assert.equal(fourth.body.record.requirement, 'requirement:fourth');
  assert.equal(store.workRounds(1, fourth.body.record.id).length, 0);
  assert.equal(wakes.length, 3);
  const state = await call('GET', '/collab/api/rooms/1/workspaces');
  assert.equal(state.body.workspaces.length, 3); assert.equal(state.body.workspaces_max, 3);
  assert.deepEqual(state.body.queue.map(q => q.position), [1, 2]);
  assert.equal(store.roomsView().find(r => r.id === 1).workspace_queue.length, 2);
});

test('capacity: releasing a workspace dispatches the oldest persisted handoff exactly once', async t => {
  const { store, tasks, post, wakes } = setup(t);
  store.setWorkspacesMax(1, 1);
  const first = (await post('first')).body;
  const queued = (await post('queued')).body;
  await post('last');
  const result = store.append(first.workspace.id, { authorKind: 'role', author: 'dev', name: 'dev', text: 'finished' }).message;
  tasks.handBack(first.task.id, { actor: 'dev', messageId: result.id });
  const current = store.currentRound(first.workspace.id);
  assert.equal(current.record_id, queued.record.id);
  assert.equal(store.workspaceQueue(1).length, 1);
  assert.equal(store.workspaceQueue(1)[0].position, 1);
  assert.equal(wakes.length, 2);
  assert.equal(wakes[1].msg.record_id, queued.record.id);
  assert.match(wakes[1].msg.text, /requirement:queued/);
  assert.equal(tasks.list(1).filter(task => task.record_id === queued.record.id).length, 1);
  assert.equal(store.dequeueWorkspace(1), null);
});

test('capacity: queued creation exposes its eventual workspace without losing FIFO positions', async t => {
  const { store, call } = setup(t);
  store.setWorkspacesMax(1, 1);
  const first = store.createWorkspace(1);
  const queued = store.createWorkspace(1);
  const next = store.createWorkspace(1);
  store.releaseWorkspace(first.id);
  store.dequeueWorkspace(1);
  const response = await call('GET', '/collab/api/rooms/1/workspaces/queue?history=true');
  assert.equal(response.status, 200);
  assert.deepEqual(response.body.queue.map(q => [q.id, q.status, q.workspace_id, q.position]), [
    [queued.queue.id, 'allocated', first.id, null], [next.queue.id, 'waiting', null, 1],
  ]);
  const forbidden = await call('GET', '/collab/api/rooms/2/workspaces/queue?history=true');
  assert.equal(forbidden.status, 403);
});

test('capacity: removed queue owner blocks dispatch without losing the request', async t => {
  const { store, hub, tasks, post, wakes } = setup(t);
  store.setWorkspacesMax(1, 1);
  const first = (await post('first')).body;
  const queued = (await post('waiting')).body;
  const member = hub.members.get('dev');
  hub.removeMember('dev');
  const result = store.append(first.workspace.id, { authorKind: 'user', author: 'owner', name: 'owner', text: 'finished' }).message;
  tasks.handBack(first.task.id, { actor: 'dev', messageId: result.id });
  assert.equal(store.workspaceQueue(1)[0].record_id, queued.record.id);
  assert.match(store.workspaceQueue(1)[0].reason, /成员资格/);
  assert.equal(store.currentRound(first.workspace.id), undefined);
  assert.equal(wakes.length, 1);
  hub.setMember(member);
  assert.equal(store.workspaceQueue(1).length, 0);
  assert.equal(wakes.length, 2);
  assert.equal(wakes[1].msg.record_id, queued.record.id);
  hub.setMember(member);
  assert.equal(wakes.length, 2);
});

for (const restored of ['dev', 'lead']) {
  test(`capacity: roster restores ${restored} channel eligibility and automatically dispatches once`, async t => {
    const { store, hub, tasks, post, wakes } = setup(t);
    const members = new DshMembers(hub, { logger: hub.logger }, []);
    const roster = new Roster(hub, members);
    store.addMember({ id: restored, name: restored, rooms: [1] });
    await roster.update(restored, { name: restored, rooms: [1] });
    store.setWorkspacesMax(1, 1);
    const first = (await post('first')).body;
    const queued = (await post('waiting')).body;
    await roster.update(restored, { name: restored, rooms: [2] });
    const result = store.append(first.workspace.id, { authorKind: 'user', author: 'owner', name: 'owner', text: 'finished' }).message;
    tasks.handBack(first.task.id, { actor: 'dev', messageId: result.id });
    assert.match(store.workspaceQueue(1)[0].reason, /成员资格/);
    assert.equal(wakes.length, 1);
    await roster.update(restored, { name: restored, rooms: [1] });
    assert.equal(store.workspaceQueue(1).length, 0);
    assert.equal(store.currentRound(first.workspace.id).record_id, queued.record.id);
    assert.equal(wakes.length, 2);
    assert.equal(wakes[1].msg.record_id, queued.record.id);
    await roster.update(restored, { name: restored, rooms: [1] });
    assert.equal(wakes.length, 2);
    assert.equal(tasks.list(1).filter(task => task.record_id === queued.record.id).length, 1);
  });
}

test('capacity: settings validate integers, lowering leaves running work and raising drains queue', async t => {
  const { store, call, post } = setup(t);
  const first = (await post('first')).body;
  await post('second'); await post('third'); await post('fourth');
  for (const value of [0, 11, 1.5, '4', null]) {
    assert.equal((await call('PATCH', '/collab/api/rooms/1/settings', { workspaces_max: value }, true)).status, 400);
  }
  const lowered = await call('PATCH', '/collab/api/rooms/1/settings', { workspaces_max: 1 }, true);
  assert.equal(lowered.body.workspaces_max, 1);
  assert.equal(store.currentRound(first.workspace.id).id, first.round.id);
  assert.equal(store.rooms().filter(r => r.kind === 'workspace').length, 3);
  assert.equal(store.workspaceQueue(1).length, 1);
  const raised = await call('PATCH', '/collab/api/rooms/1/settings', { workspaces_max: 4 }, true);
  assert.equal(raised.status, 200); assert.equal(store.workspaceQueue(1).length, 0);
  assert.equal(store.rooms().filter(r => r.kind === 'workspace').length, 4);
});

test('capacity: fixed channel governs allocation, query and message reads after release', async t => {
  const { store, call } = setup(t);
  const ws = store.createWorkspace(1);
  store.append(ws.id, { authorKind: 'user', author: 'owner', name: 'owner', text: 'synthetic channel message' });
  store.releaseWorkspace(ws.id);
  assert.throws(() => store.claimWorkspace(2, ws.id), { code: 'workspace-owned' });
  for (const suffix of ['', '/messages']) {
    const response = await call('GET', `/collab/api/rooms/2/workspaces/${ws.id}${suffix}`, {}, true);
    assert.equal(response.status, 403); assert.match(response.body.error, /属于其他频道/);
  }
  assert.notEqual(store.createWorkspace(2).id, ws.id);
  const response = await call('GET', `/collab/api/rooms/1/workspaces/${ws.id}/messages`);
  assert.equal(response.status, 200); assert.equal(response.body.messages.length, 1);
  assert.equal(store.room(ws.id).parent_id, 1);
});

test('capacity: reuse selects the smallest free number within the channel', t => {
  const { store } = setup(t);
  const first = store.createWorkspace(1), second = store.createWorkspace(1);
  const other = store.createWorkspace(2);
  store.releaseWorkspace(second.id); store.releaseWorkspace(first.id); store.releaseWorkspace(other.id);
  assert.equal(store.createWorkspace(1).id, first.id);
  assert.equal(store.createWorkspace(1).id, second.id);
  assert.equal(store.workspaceOwner(other.id), null);
});

test('capacity: queue and fixed ownership persist across reopen', t => {
  const path = join(mkdtempSync(join(tmpdir(), 'p2a-persist-')), 'store.sqlite');
  const { store, hub } = setup(t, path);
  store.setWorkspacesMax(1, 1);
  const ws = store.createWorkspace(1);
  const waiting = store.createWorkspace(1, { record: { title: 'synthetic queued task', requirement: 'keep', owner: 'dev' } });
  store.close();
  const next = new Store(path); t.after(() => next.close());
  assert.equal(next.workspacesMax(1), 1);
  assert.equal(next.workspaceQueue(1)[0].record_id, waiting.record.id);
  next.releaseWorkspace(ws.id);
  assert.equal(next.room(ws.id).parent_id, 1);
  assert.equal(next.dequeueWorkspace(1).record.requirement, 'keep');
  assert.equal(next.workspaceQueue(1).length, 0);
});

test('capacity: two independent database connections cannot exceed capacity or claim one slot twice', async t => {
  const path = join(mkdtempSync(join(tmpdir(), 'p2a-concurrent-')), 'store.sqlite');
  const { store } = setup(t, path);
  store.setWorkspacesMax(1, 1);
  const run = async () => {
    const gate = new SharedArrayBuffer(4);
    const workers = Array.from({ length: 2 }, () => new Worker(`
      const { parentPort, workerData } = require('node:worker_threads');
      (async () => {
        const { Store } = await import(workerData.module);
        const store = new Store(workerData.path);
        parentPort.postMessage({ ready: true });
        Atomics.wait(new Int32Array(workerData.gate), 0, 0);
        const result = store.createWorkspace(1);
        store.close(); parentPort.postMessage({ result });
      })().catch(error => { throw error; });
    `, { eval: true, workerData: { path, gate, module: new URL('./store.mjs', import.meta.url).href } }));
    const results = workers.map(worker => new Promise((resolve, reject) => {
      worker.on('message', msg => { if ('result' in msg) resolve(msg.result); });
      worker.on('error', reject);
    }));
    await Promise.all(workers.map(worker => new Promise((resolve, reject) => {
      worker.on('message', msg => { if (msg.ready) resolve(); }); worker.on('error', reject);
    })));
    Atomics.store(new Int32Array(gate), 0, 1); Atomics.notify(new Int32Array(gate), 0);
    return Promise.all(results);
  };
  const first = await run();
  assert.equal(first.filter(x => x.queued).length, 1);
  const ws = first.find(x => !x.queued);
  assert.equal(store.rooms().filter(r => r.kind === 'workspace').length, 1);
  store.releaseWorkspace(ws.id);
  const dequeued = store.dequeueWorkspace(1);
  assert.equal(dequeued.workspace.id, ws.id);
  store.releaseWorkspace(ws.id);
  const second = await run();
  assert.equal(second.filter(x => x.queued).length, 1);
  assert.equal(second.find(x => !x.queued).id, ws.id);
  assert.equal(store.rooms().filter(r => r.kind === 'workspace').length, 1);
});
