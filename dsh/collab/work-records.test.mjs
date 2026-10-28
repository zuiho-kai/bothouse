import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { Store, publicMessage } from './store.mjs';
import { Hub } from './hub.mjs';
import { Tasks } from './tasks.mjs';
import { TeamExit } from './team-exit.mjs';
import { DshMembers } from './dsh-member.mjs';
import { CloudWebGateway, roomOf } from './cloudweb.mjs';
import { workspacesRoute, workRecordsRoute } from './plugin.mjs';

function setup(t) {
  const store = new Store(':memory:');
  store.ensureRoom(1, 'one'); store.ensureRoom(2, 'two');
  const hub = new Hub(store, { warn() {}, info() {} });
  for (const id of ['lead', 'dev']) hub.setMember({ id, name: id, kind: 'dsh', online: true });
  hub.leadState = { selected: () => 'lead' };
  const tasks = new Tasks(hub, { start: false }); hub.tasks = tasks;
  t.after(() => { tasks.close(); store.close(); });
  const call = async (body, room = 1) => {
    const req = Readable.from([Buffer.from(JSON.stringify(body))]); req.method = 'POST'; req.headers = { 'x-later-ticket': 'test' };
    const res = { writeHead(status) { this.status = status; }, end(data) { this.body = JSON.parse(data); } };
    await workspacesRoute(req, res, new URL(`http://local/collab/api/rooms/${room}/workspaces`), {
      store, hub, tasks, owner: () => false, gateway: { authorized: () => false },
      later: { verify: () => ({ room, member: 'lead' }) }, dsh: { nudge: () => true },
    });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    return res.body;
  };
  const deliver = task => {
    const message = store.append(task.room_id, { authorKind: 'role', author: task.owner, name: task.owner, text: '[report]\ndone', recordId: task.record_id }).message;
    return tasks.handBack(task.id, { actor: task.owner, messageId: message.id });
  };
  return { store, hub, tasks, call, deliver };
}

test('round isolation: resumed record excludes previous context and archives late replies without routing', async t => {
  const { store, hub, tasks, call } = setup(t);
  const first = await call({ title: 'resume isolation', owner: 'dev' });
  const job = store.addJob('dev', first.workspace.id, first.task.assign_msg_id);
  tasks.pauseTask(first.task.id);
  tasks.stance(first.task.id, { actor: 'dev', stance: '接' });
  const current = store.currentRound(first.workspace.id);
  assert.notEqual(current.id, first.round.id);
  const fresh = store.append(first.workspace.id, { authorKind: 'user', author: 'owner', name: 'owner', text: 'new round' }).message;
  const late = store.append(first.workspace.id, { authorKind: 'role', author: 'dev', name: 'dev', text: '[report]\n@lead old round done', clientKey: `dsh-job-${job.id}` }).message;
  assert.equal(late.record_id, fresh.record_id);
  assert.equal(late.round_id, first.round.id);
  assert.equal(fresh.round_id, current.id);
  const context = store.contextPage(first.workspace.id, fresh.id, 200);
  assert.ok(context.some(m => m.id === fresh.id));
  assert.ok(context.every(m => m.round_id === current.id));
  assert.ok(store.workspaceMessages(1, first.workspace.id).every(m => m.round_id === current.id));
  assert.ok(store.recordMessages(1, first.record.id, undefined, 200, first.round.id).some(m => m.id === late.id));
  assert.throws(() => store.recordMessages(1, first.record.id, undefined, 200, 999), { code: 'record-missing' });
  const before = tasks.task(first.task.id).status;
  tasks.fromMessage(late);
  assert.equal(tasks.task(first.task.id).status, before);
  assert.equal(DshMembers.prototype.plan.call({ store, hub }, late), undefined);
  assert.equal(DshMembers.prototype.nudge.call({ store }, 'dev', late), false);
  const exits = new TeamExit(hub); exits.onMessage(late);
  assert.equal(store.page(1).some(m => m.client_key === `team-exit:${late.id}`), false);
});

test('cleanup: failure stays occupied with reason; wrapping refuses claims; retry releases', t => {
  const { store } = setup(t);
  const first = store.createWorkspace(1, { record: { title: 'cleanup', owner: 'dev' } });
  let fail = true;
  store.onSessionsReset(id => {
    assert.equal(store.workspaceState(id).clearing_state, 'wrapping');
    assert.throws(() => store.claimWorkspace(1, id), { code: 'busy' });
    if (fail) throw new Error('synthetic cleanup failure');
  });
  assert.throws(() => store.releaseWorkspace(first.workspace.id), /synthetic cleanup failure/);
  assert.equal(store.workspaceOwner(first.workspace.id), 1);
  assert.equal(store.workspaceState(first.workspace.id).clearing_state, 'review');
  assert.match(store.roomsView().find(r => r.id === first.workspace.id).clearing_reason, /synthetic cleanup failure/);
  assert.equal(store.currentRound(first.workspace.id).status, 'wrapping');
  assert.throws(() => store.claimWorkspace(1, first.workspace.id), { code: 'busy' });
  fail = false;
  assert.equal(store.releaseWorkspace(first.workspace.id), true);
  assert.equal(store.workspaceState(first.workspace.id).clearing_state, 'free');
  assert.equal(store.workspaceOwner(first.workspace.id), null);
  assert.equal(store.currentRound(first.workspace.id), undefined);
});

test('records: invalid record creation rolls back workspace allocation', t => {
  const { store } = setup(t);
  assert.throws(() => store.createWorkspace(1, { record: { title: '', owner: 'dev' } }), { code: 'invalid' });
  assert.equal(store.rooms().filter(room => room.kind === 'workspace').length, 0);
  assert.equal(store.workRecords(1).length, 0);
});

test('records: dispatch persists requirement, round, handoff, task and evidence attribution', async t => {
  const { store, hub, tasks, call, deliver } = setup(t);
  const { record, round, workspace, task } = await call({ title: 'build', requirement: 'original request', owner: 'dev' });
  assert.equal(record.room_id, 1); assert.equal(record.requirement, 'original request');
  assert.equal(record.owner, 'dev'); assert.equal(record.status, 'active');
  assert.equal(round.record_id, record.id); assert.equal(round.workspace_id, workspace.id);
  assert.equal(round.status, 'running'); assert.equal(task.record_id, record.id);
  assert.equal(store.message(task.assign_msg_id).record_id, record.id);
  assert.equal(tasks.view(tasks.task(task.id)).record_id, record.id);
  const evidence = hub.post(workspace.id, { authorKind: 'role', author: 'dev', name: 'dev', text: 'verified', attachments: [{ id: 'synthetic-evidence', name: 'test.txt' }] }).message;
  assert.equal(evidence.record_id, record.id);
  assert.ok(store.recordMessages(1, record.id).some(m => m.id === evidence.id));
  assert.ok(store.page(1).filter(m => m.card).every(m => m.record_id === record.id));
});

test('records: channel scoped reads and immutable ownership survive workspace reuse', async t => {
  const { store, tasks, call, deliver } = setup(t);
  const first = await call({ title: 'first', owner: 'dev' });
  assert.equal(store.workRecords(2).length, 0);
  assert.equal(store.workRecord(2, first.record.id), undefined);
  assert.throws(() => store.workRounds(2, first.record.id), { code: 'record-missing' });
  assert.throws(() => store.recordMessages(2, first.record.id), { code: 'record-missing' });
  assert.throws(() => store.db.prepare('UPDATE work_records SET room_id = 2 WHERE id = ?').run(first.record.id), /immutable/);
  deliver(first.task);
  const second = await call({ title: 'second', owner: 'dev' }, 2);
  assert.notEqual(first.workspace.id, second.workspace.id);
  assert.equal(store.workRecord(1, first.record.id).room_id, 1);
  assert.equal(store.workRecord(2, first.record.id), undefined);
  assert.equal(store.workRounds(1, first.record.id)[0].status, 'ended');
  assert.ok(tasks.list(2).every(task => task.record_id !== first.record.id));
  assert.ok(tasks.list(1).some(task => task.id === first.task.id));
  for (const suffix of ['', '/rounds', '/messages']) {
    const res = { writeHead(status) { this.status = status; }, end(data) { this.body = JSON.parse(data); } };
    await workRecordsRoute({ method: 'GET' }, res, new URL(`http://local/collab/api/rooms/2/records/${first.record.id}${suffix}`), { store });
    assert.equal(res.status, 404);
    assert.equal(res.body.code, 'record-missing');
  }
});

test('records: old messages stay legacy and outside a new record context', async t => {
  const { store, call } = setup(t);
  const ws = store.createWorkspace(1);
  const old = store.append(ws.id, { authorKind: 'user', author: 'owner', name: 'owner', text: 'old history' }).message;
  store.releaseWorkspace(ws.id);
  const next = await call({ title: 'new', owner: 'dev' });
  assert.equal(next.workspace.id, ws.id);
  assert.equal(publicMessage(store.message(old.id), store).legacy, true);
  assert.equal(publicMessage(store.message(next.task.assign_msg_id), store).legacy, false);
  assert.ok(store.page(ws.id).some(m => m.id === old.id));
  assert.throws(() => store.editUser(old.id, 'owner', 'changed'), { code: 'read-only' });
  assert.deepEqual(store.contextPage(ws.id, old.id, 200), []);
  assert.ok(store.contextPage(ws.id, next.task.assign_msg_id, 200).every(m => m.record_id === next.record.id));
});

test('records: pause and resume keep the record and create a new round', async t => {
  const { store, tasks, call, deliver } = setup(t);
  const first = await call({ title: 'resume me', owner: 'dev' });
  tasks.pauseTask(first.task.id);
  assert.equal(store.workRecord(1, first.record.id).status, 'paused');
  assert.equal(store.workRounds(1, first.record.id)[0].status, 'ended');
  tasks.stance(first.task.id, { actor: 'dev', stance: '接' });
  const rounds = store.workRounds(1, first.record.id);
  assert.equal(rounds.length, 2); assert.equal(rounds[1].status, 'running');
  assert.equal(tasks.task(first.task.id).record_id, first.record.id);
  deliver(first.task);
  assert.equal(store.workRecord(1, first.record.id).status, 'done');
});

test('records: late job replies and forwarded reports stay with the original record and channel', async t => {
  const { store, hub, tasks, call, deliver } = setup(t);
  const first = await call({ title: 'old work', owner: 'dev' });
  const job = store.addJob('dev', first.workspace.id, first.task.assign_msg_id);
  deliver(first.task);
  const next = await call({ title: 'new work', owner: 'dev' }, 2);
  const late = store.append(first.workspace.id, { authorKind: 'role', author: 'dev', name: 'dev', text: '[report]\nold delivery', clientKey: `dsh-job-${job.id}` }).message;
  assert.equal(late.record_id, first.record.id);
  const exits = new TeamExit(hub);
  exits.onMessage(late);
  const copy = store.page(1).find(m => m.client_key === `team-exit:${late.id}`);
  assert.equal(copy, undefined, 'late replies remain archived without forwarding');
  assert.ok(!store.page(2).some(m => m.client_key === `team-exit:${late.id}`));
  tasks.fromMessage(late);
  assert.equal(tasks.task(next.task.id).status, 'assigned');
  assert.ok(!store.contextPage(next.workspace.id, late.id, 200).some(m => m.record_id === next.record.id));
  const gateway = new CloudWebGateway(hub, { token: 'synthetic-test-token', logger: { warn() {} } });
  const replyCtx = `room-${first.workspace.id}~record-${first.record.id}`;
  assert.equal(roomOf({ reply_ctx: replyCtx }, store), first.workspace.id);
  await gateway.fromBot({ member: { id: 'dev', name: 'dev' } }, { type: 'reply', reply_ctx: replyCtx, content: 'late bridge reply' });
  assert.equal(store.page(first.workspace.id).at(-1).record_id, first.record.id);
});
