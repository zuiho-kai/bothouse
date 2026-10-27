import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from './store.mjs';
import { Hub } from './hub.mjs';
import { Tasks } from './tasks.mjs';
import { workspaceArchiveRoute } from './plugin.mjs';
import { DshMembers } from './dsh-member.mjs';

function setup(t) {
  const store = new Store(':memory:');
  t.after(() => store.close());
  store.ensureRoom(1, '原频道');
  store.ensureRoom(2, '其他频道');
  const hub = new Hub(store, { info() {}, warn() {} });
  const tasks = new Tasks(hub, { start: false });
  t.after(() => tasks.close());
  return { store, hub, tasks, workspace: store.createWorkspace(1) };
}
function task(store, room, status, paused = null) {
  store.db.prepare(`INSERT INTO tasks (room_id, title, owner, created_by, status, created_at, updated_at, paused_at)
    VALUES (?, '任务', 'dev', 'owner', ?, 10, 20, ?)`).run(room, status, paused);
}

test('archive refuses every unfinished status, including returned and paused tasks', t => {
  const { store, workspace } = setup(t);
  for (const status of ['assigned', 'accepted', 'asked', 'declined', 'escalated', 'returned', 'rework']) {
    task(store, workspace.id, status, 1);
    assert.throws(() => store.archiveWorkspace(workspace.id), /这个工作区还有未完成的任务，不能归档/);
    store.db.prepare("UPDATE tasks SET status = 'done' WHERE room_id = ?").run(workspace.id);
  }
  store.archiveWorkspace(workspace.id);
  assert.equal(store.roomsView().some(r => r.id === workspace.id), false);
});

test('archive keeps messages/tasks, clears bindings and excludes sidebar, board and pool; restore keeps parent', t => {
  const { store, workspace, tasks } = setup(t);
  task(store, workspace.id, 'done');
  store.append(workspace.id, { authorKind: 'user', author: 'owner', name: '我', text: '保留历史' }, 30);
  store.bind('dev', workspace.id, 'old-session');
  store.releaseWorkspace(workspace.id);
  let resets = 0;
  store.onSessionsReset(() => resets++);
  store.archiveWorkspace(workspace.id, 50);
  assert.equal(resets, 1);
  assert.equal(store.binding('dev', workspace.id), undefined);
  assert.equal(store.page(workspace.id)[0].text, '保留历史');
  assert.equal(tasks.list(1).length, 0);
  assert.notEqual(store.createWorkspace(2).id, workspace.id);
  assert.throws(() => store.claimWorkspace(2, workspace.id), /已归档/);
  store.unarchiveWorkspace(workspace.id);
  assert.equal(store.room(workspace.id).parent_id, 1);
  assert.equal(store.workspaceOwner(workspace.id), 1);
  assert.equal(store.roomsView().some(r => r.id === workspace.id), true);
  assert.equal(tasks.list(1).length, 1);
  assert.notEqual(store.createWorkspace(2).id, workspace.id);
});

test('history has required fields, newest archive first and an empty list', t => {
  const { store, workspace } = setup(t);
  assert.deepEqual(store.archivedWorkspaces(), []);
  task(store, workspace.id, 'done');
  store.append(workspace.id, { authorKind: 'user', author: 'owner', name: '我', text: 'last' }, 30);
  const second = store.createWorkspace(2);
  store.archiveWorkspace(workspace.id, 50);
  store.archiveWorkspace(second.id, 60);
  assert.deepEqual(store.archivedWorkspaces().map(r => ({ ...r })), [
    { id: second.id, name: second.name, parent_id: 2, parent_name: '其他频道', archived_at: 60, task_count: 0, last_activity_at: 0 },
    { id: workspace.id, name: workspace.name, parent_id: 1, parent_name: '原频道', archived_at: 50, task_count: 1, last_activity_at: 30 },
  ]);
});

test('archive HTTP owner checks, Chinese errors, session release before archive and restore', async t => {
  const { store, hub, workspace } = setup(t);
  let releases = 0;
  const call = async (path, human = true, method = 'POST') => {
    let status, body;
    await workspaceArchiveRoute({ method }, { writeHead(s) { status = s; }, end(s) { body = JSON.parse(s); } }, path,
      { store, hub, owner: () => human, dsh: { async releaseRoom(id) { assert.equal(store.isArchived(id), false); releases++; } } });
    return { status, body };
  };
  const path = `/collab/api/rooms/${workspace.id}`;
  assert.equal((await call(`${path}/archive`, false)).status, 401);
  assert.equal((await call('/collab/api/rooms/1/archive')).status, 400);
  task(store, workspace.id, 'returned');
  assert.equal((await call(`${path}/archive`)).body.error, '这个工作区还有未完成的任务，不能归档');
  assert.equal(releases, 0);
  store.db.exec("UPDATE tasks SET status = 'done'");
  assert.equal((await call(`${path}/archive`)).status, 200);
  assert.equal(releases, 1);
  assert.equal((await call('/collab/api/workspaces/archived', false, 'GET')).status, 401);
  assert.equal((await call('/collab/api/workspaces/archived', true, 'GET')).body.workspaces.length, 1);
  assert.equal((await call(`${path}/unarchive`, false)).status, 401);
  assert.equal((await call(`${path}/unarchive`)).body.workspace.parent_id, 1);
});

test('session release interrupts pending and active jobs, cancels native and CLI work, and drains queues', async t => {
  const { store, hub, workspace } = setup(t);
  const messages = [1, 2].map(n => store.append(workspace.id, { authorKind: 'user', author: 'owner', name: '我', text: String(n) }).message);
  const pending = store.addJob('dev', workspace.id, messages[0].id);
  const running = store.addJob('cli', workspace.id, messages[1].id);
  store.markSent(running.id, 'session', 0, 'input');
  let cancelled = 0, resolved = 0, drained = false;
  const expirations = [];
  const fake = {
    store, hub,
    watching: new Map([['session', { jobId: running.id, resolve() { resolved++; } }]]),
    approvals: { expireWhere(predicate) { expirations.push(predicate({ meta: { jobId: running.id } })); } },
    rt: { ctx: { agents: { get(id) { return id === 'session' ? { cancel() { cancelled++; } } : undefined; } } } },
    cliAgents: new Map([['cli', { agent: { sessions: new Map([[String(workspace.id), { sessionId: 'acp' }]]), conn: { async cancel({ sessionId }) { assert.equal(sessionId, 'acp'); cancelled++; } } } }]]),
    queues: new Map([[`dev\u0000${workspace.id}`, Promise.resolve().then(() => { drained = true; })]]),
  };
  await DshMembers.prototype.releaseRoom.call(fake, workspace.id);
  assert.equal(store.job(pending.id).state, 'interrupted');
  assert.equal(store.job(running.id).state, 'interrupted');
  assert.equal(cancelled, 2);
  assert.equal(resolved, 1);
  assert.equal(drained, true);
  assert.equal(expirations.some(Boolean), true);
});

test('archived workspaces reject new messages and task dispatch until restored', t => {
  const { store, tasks, workspace } = setup(t);
  store.archiveWorkspace(workspace.id);
  assert.throws(() => store.append(workspace.id, { text: 'new' }), /已归档/);
  assert.throws(() => tasks.assign({ roomId: workspace.id, title: 'new', owner: 'dev', actor: 'owner' }), /已归档/);
});
