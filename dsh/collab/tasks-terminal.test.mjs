import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { Store } from './store.mjs';
import { Hub } from './hub.mjs';
import { Tasks, CHECK_AFTER_S } from './tasks.mjs';
import { tasksRoute } from './plugin.mjs';

function setup(t, path = ':memory:') {
  const store = new Store(path);
  store.ensureRoom(1, 'chat');
  const hub = new Hub(store, { warn() {}, info() {} });
  for (const id of ['lead', 'writer', 'other']) hub.setMember({ id, name: id, kind: 'bot', online: true });
  const clock = { now: 1000, timer: undefined };
  const tasks = new Tasks(hub, { now: () => clock.now, setTimer: fn => (clock.timer = fn), clearTimer: () => { clock.timer = undefined; } });
  t.after(() => { tasks.close(); store.close(); });
  const assign = (roomId = 1, extra = {}) => tasks.assign({ roomId, title: 'work', actor: 'lead', owner: 'writer', force: true, ...extra });
  const end = (id, action = 'cancel', body = {}, actor = 'lead', verified = true) => tasks.perform(action, { id, body: { reason: 'scope ended', ...body } }, { actor, verified });
  return { store, hub, tasks, clock, assign, end };
}

test('#1613 normal hand-back and review remain a separate successful outcome', t => {
  const { store, tasks, assign } = setup(t);
  const ws = store.createWorkspace(1);
  const task = assign(ws.id);
  const { message: report } = store.append(ws.id, { authorKind: 'role', author: 'writer', name: 'writer', text: 'result' });
  tasks.handBack(task.id, { actor: 'writer', messageId: report.id });
  assert.equal(tasks.review(task.id, { actor: 'lead', verdict: 'done' }).status, 'done');
  assert.equal(store.workspaceOwner(ws.id), null);
});

for (const [action, status] of [['cancel', 'cancelled'], ['supersede', 'superseded']]) {
  test(`#1613 ${action} stops work, retains history and releases only the last task`, t => {
    const { store, tasks, clock, assign, end } = setup(t);
    const ws = store.createWorkspace(1);
    const a = assign(ws.id, { reason: 'why this writer' });
    const b = assign(ws.id);
    tasks.stance(a.id, { actor: 'writer', stance: '接', note: 'progress' });
    const body = action === 'supersede' ? { superseded_by: b.id } : {};
    const result = end(a.id, action, body);
    assert.equal(result.status, status);
    assert.equal(result.termination_reason, 'scope ended');
    assert.equal(result.reason, 'why this writer');
    assert.equal(result.note, 'progress');
    assert.equal(result.superseded_by, body.superseded_by ?? null);
    assert.equal(result.next_check_at, null);
    assert.equal(tasks.task(a.id).remind_msg_id, null);
    assert.equal(tasks.countActive(ws.id), 1);
    assert.equal(store.workspaceOwner(ws.id), 1);
    end(b.id, action);
    assert.equal(tasks.countActive(ws.id), 0);
    assert.equal(tasks.busyInfo('writer').busy, false);
    assert.equal(store.workspaceOwner(ws.id), null);
    assert.equal(clock.timer, undefined);
    clock.now += CHECK_AFTER_S * 3;
    tasks.tick();
    assert.equal(tasks.task(a.id).status, status);
    assert.equal(tasks.q.undelivered.all('assigned', 'accepted', 'asked', 'rework').length, 0);
  });

  test(`#1613 ${action} drops an offline owner's pending reminder and is idempotent after restart`, t => {
    const path = join(mkdtempSync(join(tmpdir(), 'tasks-terminal-')), 'state.sqlite3');
    const first = setup(t, path);
    const a = first.assign();
    first.clock.now += CHECK_AFTER_S + 1;
    first.tasks.tick();
    assert.notEqual(first.tasks.task(a.id).remind_msg_id, null);
    first.end(a.id, action);
    const count = first.store.db.prepare('SELECT COUNT(*) AS n FROM messages').get().n;
    first.clock.now += 1;
    const retry = first.end(a.id, action);
    assert.equal(retry.updated_at, 1000 + CHECK_AFTER_S + 1);
    assert.equal(first.store.db.prepare('SELECT COUNT(*) AS n FROM messages').get().n, count);
    first.tasks.close(); first.store.close();
    const after = setup(t, path);
    const wakes = [];
    after.tasks.onWake((...args) => { wakes.push(args); return true; });
    after.hub.setMember({ id: 'writer', name: 'writer', kind: 'bot', online: true });
    after.clock.now += CHECK_AFTER_S * 10;
    after.tasks.tick(); after.tasks.deliverPending();
    assert.equal(after.end(a.id, action).status, status);
    assert.equal(after.tasks.task(a.id).remind_msg_id, null);
    assert.deepEqual(wakes, []);
    assert.throws(() => after.end(a.id, action, { reason: 'different request' }), /conflict|already|different/i);
    assert.throws(() => after.tasks.stance(a.id, { actor: 'writer', stance: '接' }), /not waiting/);
  });
}

test('#1613 terminal operations require verified dispatcher or human, and valid reasons/references', t => {
  const { tasks, assign, end } = setup(t);
  const task = assign();
  for (const action of ['cancel', 'supersede']) {
    for (const actor of ['writer', 'other']) assert.throws(() => end(task.id, action, {}, actor), e => e.code === 'forbidden');
    assert.throws(() => end(task.id, action, {}, 'lead', false), e => e.code === 'forbidden');
    for (const reason of ['', '  ', {}, 'x'.repeat(128 * 1024 + 1)]) assert.throws(() => end(task.id, action, { reason }), e => e.code === 'invalid');
  }
  for (const superseded_by of [0, -1, 1.5, 'oops', task.id, 999]) assert.throws(() => end(task.id, 'supersede', { superseded_by }));
  assert.equal(tasks.task(task.id).status, 'assigned');
  assert.equal(end(task.id, 'cancel', {}, 'owner').status, 'cancelled');
  assert.throws(() => end(task.id, 'supersede'), e => e.code === 'conflict');
});

test('#1613 API locates tasks by ID across rooms and refuses spoofed actors', async t => {
  const { store, tasks, assign } = setup(t);
  const ws = store.createWorkspace(1);
  const a = assign(ws.id);
  const b = assign(1);
  const call = async (action, body, human) => {
    const req = Readable.from([Buffer.from(JSON.stringify(body))]);
    req.method = 'POST'; req.headers = {};
    let status, result;
    const res = { writeHead(value) { status = value; }, end(value) { result = JSON.parse(value); } };
    const handled = tasksRoute(req, res, new URL(`http://test/collab/api/tasks/${a.id}/${action}`), { tasks, gateway: { authorized: () => true }, owner: () => human });
    assert.notEqual(handled, undefined);
    await handled;
    return { status, result };
  };
  assert.equal((await call('cancel', { actor: 'lead', reason: 'ended' }, false)).status, 403);
  const reply = await call('supersede', { reason: 'moved to B', superseded_by: b.id }, true);
  assert.equal(reply.status, 200);
  assert.equal(reply.result.task.status, 'superseded');
  assert.equal(reply.result.task.superseded_by, b.id);
  assert.equal(tasks.task(b.id).status, 'assigned');
  assert.equal(store.workspaceOwner(ws.id), null);
});

test('#1613 old CHECK constraint migrates without losing hierarchy, reports or sequence', t => {
  const path = join(mkdtempSync(join(tmpdir(), 'tasks-terminal-upgrade-')), 'state.sqlite3');
  const old = new Store(path);
  old.ensureRoom(1, 'chat');
  old.db.exec(`DROP TABLE tasks;
    CREATE TABLE tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT, room_id INTEGER NOT NULL REFERENCES rooms(id),
      parent_task INTEGER REFERENCES tasks(id), title TEXT NOT NULL, owner TEXT NOT NULL, created_by TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('assigned', 'accepted', 'asked', 'declined', 'escalated', 'returned', 'done', 'rework')),
      result_msg_id INTEGER, created_at REAL NOT NULL, updated_at REAL NOT NULL);
    CREATE INDEX tasks_room ON tasks(room_id, id);
    INSERT INTO tasks VALUES (1, 1, NULL, 'parent', 'writer', 'lead', 'returned', 42, 1, 2);
    INSERT INTO tasks VALUES (2, 1, 1, 'child', 'writer', 'lead', 'accepted', NULL, 1, 2);
    INSERT INTO tasks VALUES (10, 1, NULL, 'deleted', 'writer', 'lead', 'done', NULL, 1, 2);
    DELETE FROM tasks WHERE id = 10;`);
  old.close();
  const { store, tasks, assign, end } = setup(t, path);
  assert.equal(tasks.task(2).parent_task, 1);
  assert.equal(end(1).result_msg_id, 42);
  assert.equal(end(2, 'supersede', { superseded_by: 1 }).status, 'superseded');
  assert.equal(assign().id, 11, 'AUTOINCREMENT does not reuse previously issued IDs');
  assert.equal(store.db.prepare('PRAGMA foreign_keys').get().foreign_keys, 1);
  assert.deepEqual(store.db.prepare('PRAGMA foreign_key_check').all(), []);
  assert.throws(() => store.db.exec("UPDATE tasks SET status = 'unknown' WHERE id = 1"), /CHECK/);
  const again = new Store(path);
  assert.equal(again.db.prepare('SELECT superseded_by FROM tasks WHERE id = 2').get().superseded_by, 1);
  again.close();
});

test('#1613 cancelling a parked old task cannot reclaim or release the workspace its next task claimed', t => {
  const { store, hub, tasks, assign, end } = setup(t);
  const ws = store.createWorkspace(1);
  const a = assign(ws.id);
  tasks.pauseTask(a.id);
  store.ensureRoom(2, 'other-chat');
  assert.throws(() => store.claimWorkspace(2, ws.id), e => e.code === 'workspace-owned', 'another chat never takes it (#762)');
  store.claimWorkspace(1, ws.id);
  const b = assign(ws.id, { owner: 'other' });
  const events = [];
  hub.subscribe(event => { if (event.type === 'task') events.push(event); });
  end(a.id);
  assert.equal(store.workspaceOwner(ws.id), 1);
  assert.equal(tasks.task(b.id).status, 'assigned');
  assert.equal(events.at(-1).chat_id, 1);
  assert.equal(tasks.list(1).find(row => row.id === a.id)?.status, 'cancelled');
  assert.equal(tasks.list(2).some(row => row.id === a.id), false);
});

test('#1613 cancelling returned work stops delegated review and leaves the original report intact', t => {
  const { store, tasks, clock, assign, end } = setup(t);
  const ws = store.createWorkspace(1);
  const task = assign(ws.id);
  const { message: report } = store.append(ws.id, { authorKind: 'role', author: 'writer', name: 'writer', text: 'result' });
  tasks.handBack(task.id, { actor: 'writer', messageId: report.id });
  const review = assign(1, { owner: 'other', reviewOf: task.id });
  end(task.id);
  assert.equal(tasks.task(task.id).result_msg_id, report.id);
  assert.equal(tasks.task(task.id).returned_at, 1000);
  assert.equal(tasks.task(review.id).status, 'cancelled');
  const wakes = [];
  tasks.onWake((...args) => wakes.push(args));
  clock.now += CHECK_AFTER_S * 3;
  tasks.tick();
  assert.deepEqual(wakes, []);
});

test('#1613 late progress and quota reassignment cannot reopen a terminal card', t => {
  const { store, tasks, end } = setup(t);
  const { message } = store.append(1, { authorKind: 'role', author: 'lead', name: 'lead', text: 'dispatch', card: '{}' });
  const members = [{ id: 'member-1', name: 'writer', title: 'work', status: 'running' }];
  tasks.fromCard(1, 'lead', message.id, members);
  const task = tasks.list(1)[0];
  end(task.id);
  tasks.fromCard(1, 'lead', message.id, members);
  tasks.fromCard(1, 'lead', message.id, [{ ...members[0], status: 'completed' }]);
  assert.equal(tasks.reassignForQuota(task, 'other'), undefined);
  assert.equal(tasks.list(1).length, 1);
  assert.equal(tasks.task(task.id).status, 'cancelled');
});

test('#1613 cancellation during reminder delivery cannot restore the pending reminder', t => {
  const { tasks, clock, assign, end } = setup(t);
  const task = assign();
  tasks.onWake(() => { end(task.id); return false; });
  clock.now += CHECK_AFTER_S + 1;
  tasks.tick();
  assert.equal(tasks.task(task.id).remind_msg_id, null);
  assert.equal(tasks.task(task.id).status, 'cancelled');
});

test('#1613 a legacy progress card without member IDs cannot recreate cancelled work', t => {
  const { store, tasks, end } = setup(t);
  const { message } = store.append(1, { authorKind: 'role', author: 'lead', name: 'lead', text: 'dispatch', card: '{}' });
  const members = [{ name: 'writer', title: 'legacy work', status: 'running' }];
  tasks.fromCard(1, 'lead', message.id, members);
  const task = tasks.list(1)[0];
  end(task.id);
  tasks.fromCard(1, 'lead', message.id, members);
  assert.equal(tasks.list(1).length, 1);
  assert.equal(tasks.task(task.id).status, 'cancelled');
});

test('#1613 a maximum-length reason is retained without breaking release or idempotent retry', t => {
  const { store, tasks, assign, end } = setup(t);
  const ws = store.createWorkspace(1);
  const task = assign(ws.id);
  const reason = 'x'.repeat(128 * 1024);
  assert.equal(end(task.id, 'cancel', { reason }).termination_reason, reason);
  assert.equal(store.workspaceOwner(ws.id), null);
  assert.equal(end(task.id, 'cancel', { reason }).status, 'cancelled');
  assert.equal(tasks.countActive(ws.id), 0);
});

test('#1613 a self-dispatch is still not permission to accept the author own work', t => {
  const { store, tasks, assign } = setup(t);
  const task = assign(1, { owner: 'lead' });
  const { message } = store.append(1, { authorKind: 'role', author: 'lead', name: 'lead', text: 'result' });
  tasks.handBack(task.id, { actor: 'lead', messageId: message.id });
  assert.throws(() => tasks.review(task.id, { actor: 'lead', verdict: 'done' }), e => e.code === 'forbidden');
  assert.equal(tasks.review(task.id, { actor: 'owner', verdict: 'done' }).status, 'done');
});
