import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { fileURLToPath } from 'node:url';
import { Store, publicMessage, MAX_TEXT } from './store.mjs';
import { Hub } from './hub.mjs';
import { forDisplay, forMember, mentions, nameCalled } from './mentions.mjs';
import { CloudWebGateway, CAPABILITIES, progressCard, PROGRESS_PREFIX, roomKey } from './cloudweb.mjs';
import { resolveConfig } from './plugin.mjs';
import { LeadState } from './lead-state.mjs';
import { Roster } from './roster.mjs';
import { ownMessageRoute, renameRoomRoute, roomSettingsRoute, withBody } from './plugin.mjs';
import { ChannelApprovals } from './approvals.mjs';
import { Attachments, attachmentBlocks, nativeAttachmentBlocks, MAX_IMAGE_BYTES } from './attachments.mjs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { statSync } from 'node:fs';
import { writeFileSync as writeKeyFile, readFileSync as readKeyFile } from 'node:fs';
import { createHmac as createHmacTest } from 'node:crypto';

// #149: without GATE_PORT the gate context reads the install's config.toml. A test that is not about
// that must not reach the live gate because the shell running it has BOTHOUSE_DATA_DIR/CC_DATA_DIR set
// (a bridge-started shell does). The #149 test below points this at its own temp config.
// #1730: a bridge-started shell also exports GATE_PORT; clear it so tests before the #149 block do
// not resolve the live gate port and hit the running instance.
process.env.BOTHOUSE_CONFIG = `${(process.env.TMPDIR ?? '/tmp').replace(/\/+$/, '')}/collab-no-bridge-config.toml`;
delete process.env.GATE_PORT;
// #1643: a member's MEMORY.md is made on its first turn under the data dir (~/.bothouse by default): keep the
// tests' members out of the live one. Tests that set their own put this back.
const NO_LIVE_DATA = mkdtempSync(join(tmpdir(), 'collab-data-'));
process.env.BOTHOUSE_DATA_DIR = NO_LIVE_DATA;
// #1643: with no gate the room gets one notice; it is not a failure card.
const failureCard = m => m.author_kind === 'system' && !/^(gate-missing-room-|dsh-session-replaced-)/.test(String(m.client_key ?? ''));

test('workspace approval shares one decision with its parent channel', async () => {
  const store = new Store(':memory:');
  try {
    store.ensureRoom(1, 'chat');
    const hub = new Hub(store, { warn() {}, info() {} });
    hub.setMember({ id: 'ds', name: 'Astra', kind: 'dsh', online: true });
    const ws = store.createWorkspace(1);
    const approvals = ChannelApprovals.of(hub);
    let executions = 0;
    for (const [choice, expected] of [['allow', 'allowed'], ['deny', 'denied'], ['allow_all', 'allowed_all']]) {
      const { messageId, decision } = approvals.open({ room: ws.id, author: { id: 'ds', name: 'Astra' }, text: 'run tests', onDecide() { executions++; } });
      const copy = store.page(1).find(m => JSON.parse(m.card ?? 'null')?.request_id === messageId);
      assert.ok(copy);
      approvals.decide(copy.id, choice);
      assert.equal(await decision, choice);
      assert.equal(JSON.parse(store.message(messageId).card).state, expected);
      assert.equal(JSON.parse(store.message(copy.id).card).state, expected);
      assert.throws(() => approvals.decide(messageId, choice), /已经处理/);
      assert.throws(() => approvals.decide(copy.id, choice), /已经处理/);
    }
    assert.equal(executions, 3);
    const open = approvals.open({ room: ws.id, author: { id: 'ds', name: 'Astra' }, text: 'text response' });
    const response = hub.post(1, { authorKind: 'user', author: 'owner', name: 'Owner', text: '拒绝' }).message;
    approvals.answerByText(response);
    assert.equal(await open.decision, 'deny');
    const expired = approvals.open({ room: ws.id, author: { id: 'ds', name: 'Astra' }, text: 'cancelled' });
    const expiredCopy = store.page(1).find(m => JSON.parse(m.card ?? 'null')?.request_id === expired.messageId);
    approvals.expire(expired.messageId);
    assert.equal(await expired.decision, 'expired');
    assert.equal(JSON.parse(store.message(expiredCopy.id).card).state, 'expired');
  } finally { store.close(); }
});

const quiet = { warn() {}, info() {} };
const tick = () => new Promise(r => setImmediate(r));

function makeHub() {
  const store = new Store(':memory:');
  store.ensureRoom(1, 'general');
  const hub = new Hub(store, quiet);
  hub.setMember({ id: 'owner', name: '我', kind: 'human', online: true });
  return hub;
}

class FakeWs extends EventEmitter {
  constructor() { super(); this.sent = []; this.closed = undefined; }
  send(s) { this.sent.push(JSON.parse(s)); }
  close(code, reason) { this.closed = { code, reason }; this.emit('close'); }
  frame(obj) { this.emit('message', Buffer.from(JSON.stringify(obj)), false); }
  of(type) { return this.sent.filter(f => f.type === type); }
}

function connect(gateway, query) {
  const ws = new FakeWs();
  gateway.accept(ws, new URL(`http://x/cloud-web/ws?${query}`));
  ws.frame({ type: 'register', platform: 'cloud_web', client: 'cc-connect', project: 'p', transport: 'ws' });
  return ws;
}

test('store: client keys dedupe, pages are oldest-first, jobs are created and finished once', () => {
  const s = new Store(':memory:');
  s.ensureRoom(1, 'general');
  const a = s.append(1, { authorKind: 'user', author: 'owner', name: '我', text: 'hi', clientKey: 'k1' });
  const again = s.append(1, { authorKind: 'user', author: 'owner', name: '我', text: 'hi', clientKey: 'k1' });
  assert.equal(a.created, true);
  assert.equal(again.created, false);
  assert.equal(again.message.id, a.message.id);
  for (const t of ['b', 'c', 'd']) s.append(1, { authorKind: 'user', author: 'owner', name: '我', text: t });
  assert.deepEqual(s.page(1, undefined, 2).map(m => m.text), ['c', 'd']);
  assert.deepEqual(s.page(1, 3, 10).map(m => m.text), ['hi', 'b']);
  assert.deepEqual(s.since(1, 2, 10).map(m => m.text), ['c', 'd']);
  assert.throws(() => s.append(1, { authorKind: 'user', author: 'owner', name: '我', text: '  ' }), /empty/);
  assert.throws(() => s.append(9, { authorKind: 'user', author: 'owner', name: '我', text: 'x' }), /room 9/);

  const job = s.addJob('ds', 1, a.message.id);
  assert.equal(s.addJob('ds', 1, a.message.id), undefined);
  assert.equal(s.markSent(job.id, 'sess', 5), true);
  assert.equal(s.markSent(job.id, 'sess', 5), false);
  assert.equal(s.finishJob(job.id, 'done', 1), true);
  assert.equal(s.finishJob(job.id, 'failed'), false);
  assert.deepEqual(s.openJobs(), []);
  assert.equal(s.dispatchMode(1), 'mixed');
  assert.equal(s.setDispatchMode(1, 'team'), 'team');
  assert.equal(s.dispatchMode(1), 'team');
  assert.throws(() => s.setDispatchMode(1, 'bad'), /dispatch mode/);
});

test('channel rename API: emits fresh rooms and returns HTTP 400 for invalid names and workspaces', async () => {
  const { Readable } = await import('node:stream');
  const hub = makeHub();
  const ws = hub.store.createWorkspace(1);
  const events = [];
  hub.subscribe(event => events.push(event));
  const call = async (id, name) => {
    const req = Readable.from([Buffer.from(JSON.stringify({ name }))]);
    req.method = 'PATCH';
    let status, result;
    const res = { writeHead(s) { status = s; }, end(body) { result = JSON.parse(body); } };
    await renameRoomRoute(req, res, `/collab/api/rooms/${id}`, { store: hub.store, hub });
    return { status, result };
  };
  assert.equal((await call(1, 'new')).status, 200);
  assert.equal(events.at(-1).rooms.find(r => r.id === 1).name, 'new');
  for (const name of ['', '   ', 'x'.repeat(33), 'two words']) assert.equal((await call(1, name)).status, 400);
  // #176: rename normalizes like create does (trim, drop one leading '#').
  assert.equal((await call(1, '  new  ')).status, 200);
  assert.equal(hub.store.room(1).name, 'new');
  // #176: renaming onto another channel's name, or onto 工作区<n>, is a conflict, not a silent duplicate.
  hub.store.ensureRoom(2, 'other');
  assert.equal((await call(1, 'other')).status, 409);
  assert.equal((await call(1, '工作区9')).status, 409);
  // #176: create strips a leading '#' (the list shows names with one), so rename must too —
  // otherwise '#new' was a second "new" on the same list.
  assert.equal((await call(1, '#other')).status, 409);
  assert.equal((await call(1, '#工作区9')).status, 409);
  assert.equal((await call(1, '#fresh')).status, 200);
  assert.equal(hub.store.room(1).name, 'fresh');
  assert.equal((await call(ws.id, 'new')).status, 400);
  assert.equal((await call(999, 'new')).status, 404);
  // Only the successful renames above ('new', 'fresh', 'new' again) reach the tab-title refresh.
  hub.store.close();
});

test('channel rename: preserves ids, messages, bindings, members, dispatch settings and workspace paths', () => {
  const hub = makeHub();
  const s = hub.store;
  s.ensureRoom(1, 'general', '/channel-project');
  const ws = s.createWorkspace(1);
  hub.setMember({ id: 'ds', name: 'DeepSeek', kind: 'dsh', online: true, rooms: [1] });
  const message = s.append(1, { authorKind: 'user', author: 'owner', name: '我', text: '@DeepSeek hello' }).message;
  s.bind('ds', 1, 'session-1');
  s.setDispatchMode(1, 'team');
  const binding = s.binding('ds', 1);
  const members = hub.memberView();
  assert.equal(s.renameRoom(1, '新频道').id, 1);
  assert.equal(s.room(1).name, '新频道');
  assert.deepEqual(s.message(message.id), message);
  assert.deepEqual(s.binding('ds', 1), binding);
  assert.deepEqual(hub.memberView(), members);
  assert.equal(s.dispatchMode(1), 'team');
  assert.equal(s.workspacePath(1, '/fallback'), '/channel-project');
  assert.equal(s.workspacePath(ws.id, '/fallback'), '/channel-project');
  assert.deepEqual(hub.routableIn(ws.id).map(m => m.id), ['ds']);
  assert.equal(s.room(ws.id).parent_id, 1);
  for (const name of ['', 'x'.repeat(33), 'two words', ' name', 'name\n', null, 4]) {
    // #366: 这句话原样显示在客户端，所以是中文。
    assert.throws(() => s.renameRoom(1, name), /频道名 1–32 个字符/);
  }
  assert.throws(() => s.renameRoom(ws.id, 'renamed'), /工作区名称由系统分配/);
  s.close();
});

test('channel rename: the persisted name survives reopening the database', async () => {
  const { mkdtempSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const path = join(mkdtempSync(join(tmpdir(), 'collab-rename-')), 'collab.sqlite3');
  const s = new Store(path);
  s.ensureRoom(1, 'general');
  s.renameRoom(1, '新频道');
  s.close();
  const reopened = new Store(path);
  assert.equal(reopened.room(1).name, '新频道');
  // Startup preserves the saved name while reapplying the configured directory.
  const config = resolveConfig({ dataDir: '/data', workspacePath: '/fallback', rooms: [{ id: 1, name: 'general', workspacePath: '/changed' }] });
  for (const room of config.rooms) reopened.ensureRoom(room.id, reopened.room(room.id)?.name ?? room.name.trim(), room.workspacePath);
  assert.equal(reopened.room(1).name, '新频道');
  assert.equal(reopened.workspacePath(1, '/fallback'), '/changed');
  reopened.close();
});

test('#176: channel names are unique and a workspace-shaped name is refused', () => {
  const s = new Store(':memory:');
  s.ensureRoom(1, 'general');
  const dev = s.createRoom('dev');
  // Two #general in the sidebar are indistinguishable: a second channel takes no existing name.
  // #366: 这几种回绝消息都会原样显示在客户端，所以断言中文（旧英文串已改掉）。
  assert.throws(() => s.createRoom('general'), e => e.code === 'conflict' && /频道名 general 已被占用/.test(e.message));
  assert.throws(() => s.createRoom('General'), e => e.code === 'conflict');
  assert.throws(() => s.renameRoom(dev.id, 'general'), e => e.code === 'conflict');
  // 工作区<n> is how a workspace is addressed; a chat channel must not shadow it.
  assert.throws(() => s.createRoom('工作区9'), e => e.code === 'conflict' && /工作区保留名/.test(e.message));
  assert.throws(() => s.renameRoom(dev.id, '工作区9'), e => e.code === 'conflict');
  // Renaming a channel onto its own name stays fine, and a private chat does not hold its name.
  assert.equal(s.renameRoom(dev.id, 'dev').name, 'dev');
  s.addMember({ id: 'm-a', name: 'probe', rooms: [1] });
  s.openDm('m-a', 'probe');
  assert.equal(s.createRoom('probe').name, 'probe');
  s.close();
});

test('channel default reply: CLI-neutral selection follows membership, workspaces and private chats', t => {
  const hub = makeHub();
  hub.store.ensureRoom(2, 'other');
  t.after(() => hub.store.close());
  const events = [];
  hub.subscribe(event => events.push(event));
  const workspace = hub.store.createWorkspace(1);
  for (const cli of ['codex', 'claudecode', 'gemini']) {
    hub.setMember({ id: 'a', name: 'A', kind: 'dsh', cli, rooms: [1] });
    assert.equal(hub.defaultReplyIn(1)?.id, 'a');
    assert.equal(hub.defaultReplyIn(workspace.id)?.id, 'a');
    assert.equal(hub.defaultReplyIn(2), undefined);
    assert.equal(events.filter(e => e.type === 'rooms').at(-1)?.rooms.find(r => r.id === 1).effective_lead_id, 'a');
  }
  hub.setMember({ id: 'b', name: 'B', kind: 'dsh', rooms: [1] });
  assert.equal(hub.defaultReplyIn(1), undefined);
  assert.equal(events.filter(e => e.type === 'rooms').at(-1).rooms.find(r => r.id === 1).effective_lead_id, null);
  hub.store.setLead(1, 'b');
  assert.equal(hub.defaultReplyIn(workspace.id)?.id, 'b');
  const dm = hub.store.openDm('b', 'B');
  assert.equal(hub.defaultReplyIn(dm.id)?.id, 'b');
  hub.store.setLead(1, null);
  hub.removeMember('b');
  assert.equal(hub.defaultReplyIn(1)?.id, 'a');
  assert.equal(events.filter(e => e.type === 'rooms').at(-1).rooms.find(r => r.id === 1).effective_lead_id, 'a');
  hub.store.setLead(1, 'removed');
  assert.equal(hub.defaultReplyIn(1), undefined, 'an unavailable explicit choice must not silently pick another member');
});

test('channel primary: delegation choices persist, inherit to workspaces and retain global authority', async () => {
  const { mkdtempSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const path = join(mkdtempSync(join(tmpdir(), 'collab-channel-primary-')), 'db');
  let store = new Store(path);
  for (const id of [1, 2, 3]) store.ensureRoom(id, `room${id}`);
  const ws = store.createWorkspace(1);
  const init = () => {
    const hub = new Hub(store, quiet, { selected: () => 'global' });
    for (const id of ['a', 'b', 'global']) hub.setMember({ id, name: id, kind: 'dsh', online: true });
    return hub;
  };
  let hub = init();
  store.setLead(1, 'a'); store.setLead(2, 'b');
  assert.equal(hub.primaryIn(1).id, 'a');
  assert.equal(hub.primaryIn(2).id, 'b');
  assert.equal(hub.primaryIn(3).id, 'global');
  assert.equal(hub.defaultReplyIn(3), undefined);
  assert.equal(hub.primaryIn(ws.id).id, 'a');
  store.close(); store = new Store(path); hub = init();
  assert.equal(hub.primaryIn(1).id, 'a');
  assert.equal(hub.primaryIn(2).id, 'b');
  assert.equal(hub.primaryIn(3).id, 'global');
  assert.equal(hub.defaultReplyIn(3), undefined);
  store.setLead(1, 'removed');
  assert.equal(hub.primaryIn(1), undefined, 'a missing explicit primary must not pick another channel’s role');
  store.close();
});

test('channel settings API: validates directories before writing and survives config reseeding', async () => {
  const { Readable } = await import('node:stream');
  const { mkdtempSync, writeFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const dir = mkdtempSync(join(tmpdir(), 'collab-settings-'));
  const file = join(dir, 'file'); writeFileSync(file, 'x');
  const hub = makeHub(); hub.store.ensureRoom(2, 'other');
  hub.setMember({ id: 'a', name: 'A', kind: 'dsh', rooms: [1] });
  hub.setMember({ id: 'b', name: 'B', kind: 'dsh', rooms: [2] });
  const events = []; hub.subscribe(e => events.push(e));
  const call = async (body) => {
    const req = Readable.from([Buffer.from(JSON.stringify(body))]); req.method = 'PATCH';
    let status, result;
    await roomSettingsRoute(req, { writeHead(s) { status = s; }, end(b) { result = JSON.parse(b); } }, '/collab/api/rooms/1/settings', { store: hub.store, hub, workspacePath: '/old' });
    return { status, result };
  };
  for (const path of ['relative', join(dir, 'missing'), file]) {
    const result = await call({ workspace_path: path, lead_id: 'a' });
    assert.equal(result.status, 400); assert.match(result.result.error, /工作目录/);
    assert.equal(hub.store.workspacePath(1, '/old'), '/old'); assert.equal(hub.store.leadId(1), null);
  }
  assert.equal((await call({ lead_id: 'b' })).status, 400);
  assert.equal((await call({ workspace_path: dir, lead_id: 'a' })).status, 200);
  assert.equal(events.at(-1).room_id, 1);
  assert.equal(hub.primaryIn(1).id, 'a'); assert.equal(hub.store.leadId(2), null);
  // 清除频道选择时空串等同 null；单成员仍自动接话，但不会自动获得派活权限。
  assert.equal((await call({ lead_id: '' })).status, 200);
  assert.equal(hub.store.leadId(1), null);
  assert.equal(hub.primaryIn(1), undefined);
  assert.equal(hub.defaultReplyIn(1)?.id, 'a');
  hub.store.ensureRoom(1, 'general', '/config');
  assert.equal(hub.store.workspacePath(1, '/old'), dir);
  hub.store.close();
});

test('dispatch mode: a workspace inherits its chat channel setting (PR #138 review 6)', () => {
  const s = new Store(':memory:');
  s.ensureRoom(1, 'general');
  const ws = s.createWorkspace(1);
  assert.equal(s.dispatchMode(ws.id), 'mixed');
  s.setDispatchMode(1, 'solo');
  assert.equal(s.dispatchMode(ws.id), 'solo');
  s.setDispatchMode(ws.id, 'team');
  assert.equal(s.dispatchMode(1), 'team', 'setting a workspace sets its chat channel');
});

test('relay cap settings: only 6–20, isolated per channel, workspaces inherit and persist (#445)', async () => {
  const { mkdtempSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const path = join(mkdtempSync(join(tmpdir(), 'collab-relay-')), 'relay.sqlite3');
  const s = new Store(path);
  s.ensureRoom(1, 'general');
  s.ensureRoom(2, 'other');
  const ws = s.createWorkspace(1);
  assert.deepEqual(s.relaySetting(1), { max_relay: 6 }, 'the default cap is 6');
  assert.deepEqual(s.relaySetting(ws.id), { max_relay: 6 }, 'a workspace follows its chat channel');
  for (const bad of [5, 21, 0, -1, 6.5, '8', null, undefined, NaN]) {
    assert.throws(() => s.setMaxRelay(1, bad), /6–20/, `${String(bad)} must be rejected`);
  }
  assert.equal(s.relaySetting(1).max_relay, 6, 'rejected values leave the cap unchanged');
  s.setMaxRelay(1, 8);
  s.setMaxRelay(2, 20);
  assert.equal(s.relaySetting(1).max_relay, 8);
  assert.equal(s.relaySetting(2).max_relay, 20, 'channels are isolated');
  assert.equal(s.relaySetting(ws.id).max_relay, 8, 'the workspace reads its chat channel');
  s.setMaxRelay(ws.id, 20);
  assert.equal(s.relaySetting(1).max_relay, 20, 'setting a workspace writes its chat channel');
  assert.equal(s.relaySetting(2).max_relay, 20);
  s.setMaxRelay(1, 6);
  s.close();
  const reopened = new Store(path);
  try {
    assert.equal(reopened.relaySetting(1).max_relay, 6, 'the setting survives reopening');
    assert.equal(reopened.relaySetting(2).max_relay, 20);
  } finally {
    reopened.close();
  }
});

test('channel settings API: GET returns and PATCH accepts the relay cap, invalid values roll back (#445)', async () => {
  const { Readable } = await import('node:stream');
  const hub = makeHub(); hub.store.ensureRoom(2, 'other');
  const call = async (method, body, roomId = 1) => {
    const req = body === undefined ? { method } : Object.assign(Readable.from([Buffer.from(JSON.stringify(body))]), { method });
    let status, result;
    await roomSettingsRoute(req, { writeHead(s) { status = s; }, end(b) { result = JSON.parse(b); } }, `/collab/api/rooms/${roomId}/settings`, { store: hub.store, hub, workspacePath: '/old' });
    return { status, result };
  };
  assert.equal((await call('GET')).result.max_relay, 6);
  for (const bad of [5, 21]) {
    const rejected = await call('PATCH', { max_relay: bad });
    assert.equal(rejected.status, 400);
    assert.match(rejected.result.error, /6–20/);
  }
  assert.equal((await call('GET')).result.max_relay, 6, 'rejected values are not stored');
  assert.equal((await call('PATCH', { max_relay: 8, lead_id: 'nobody' })).status, 400, 'a rejected field rolls the cap back too');
  assert.equal((await call('GET')).result.max_relay, 6);
  const saved = await call('PATCH', { max_relay: 20 });
  assert.equal(saved.status, 200);
  assert.equal(saved.result.max_relay, 20);
  assert.equal((await call('GET', undefined, 2)).result.max_relay, 6, 'another channel keeps its own value');
  hub.store.close();
});

test('mentions: own mention removed, others rewritten, fences ignored, bare name calls', () => {
  const members = [{ id: 'ju', name: '橘', mentionId: '111' }, { id: 'ds', name: 'DeepSeek' }];
  const ju = members[0];
  assert.deepEqual([...mentions('@橘 看下 @DeepSeek', members)].sort(), ['ds', 'ju']);
  assert.deepEqual([...mentions('```\n@橘\n```', members)], []);
  assert.equal(forMember('@橘 看下这个', ju, members), '看下这个');
  assert.equal(forMember('@橘 和 @DeepSeek 一起看', ju, members), '@橘(你) 和 @DeepSeek 一起看');
  assert.equal(forMember('@DeepSeek 叫 <@111>', members[1], members), '@DeepSeek(你) 叫 <@111>');
  assert.equal(forMember('@DeepSeek 你好', members[1], members), '你好');
  assert.equal(forDisplay('<@111> 你好', members), '@橘 你好');
  // Same cases as bridge/platform/discord/mentions_test.go TestNameCalled; the team list is
  // passed the way cloudweb.mjs does, so name lists and "和/、/跟/与" behave like Go.
  const team = ['龙娘', '鲸鱼娘', '彩虹猫'];
  const cases = [
    // a line opening with her name: a call
    ['橘，你看这个', true],
    ['橘 你看这个', true],
    ['橘？', true],
    ['橘', true],
    ['橘你来定', true],
    ['Claude橘：你来', true],
    ['龙娘、橘，你们看看', true],
    ['龙娘和橘 你们俩对一下', true],
    ['我算完了\n橘，你核对一下', true], // a later line opening with her name
    // the name inside a sentence: talk about her
    ['行了橘，别贫了', false],
    ['好的，我先等橘回复，这个你怎么看', false],
    ['收到！橘你先忙', false],
    ['那橘你呢', false],
    ['橘说得对', false],
    ['橘在忙，等她', false],
    ['跟橘的审美一样圆', false],
    ['橘子很好吃', false],
    ['```\n橘，\n```', false], // code block
    ['龙娘，你来', false],
    // PR #162 review 2: 和/、 followed by a non-name is not a call
    ['橘和他说过了', false],
    ['橘、龙娘说得对', false],
  ];
  for (const [text, want] of cases) {
    assert.equal(nameCalled(text, 'Claude橘', team), want, JSON.stringify(text));
  }
});

test('cloud-web: a mentioned message goes to the bot as written; the host adds no instructions of its own (#1016, #1662)', async () => {
  const hub = makeHub();
  const gw = new CloudWebGateway(hub, { token: 't', logger: quiet });
  const ju = connect(gw, 'bot=ju&name=橘');
  hub.post(1, { authorKind: 'user', author: 'owner', name: '我', text: '@橘 /model deepseek-v4' });
  await tick();
  assert.equal(ju.of('message').at(-1).content, '/model deepseek-v4');
  assert.equal(ju.of('message').at(-1).mentioned, true);
  hub.post(1, { authorKind: 'user', author: 'owner', name: '我', text: '@橘 看看日志' });
  await tick();
  assert.equal(ju.of('message').at(-1).content, '看看日志');
});

test('cloud-web: register ack, routing, prefixes, no self-echo, reconnect replaces', async () => {
  const hub = makeHub();
  hub.setMember({ id: 'ds', name: 'DeepSeek', kind: 'dsh', online: true });
  const gw = new CloudWebGateway(hub, { token: 't', logger: quiet });
  const ju = connect(gw, 'bot=ju&name=橘&mention_id=111');
  const whale = connect(gw, 'bot=whale&name=鲸鱼娘');
  assert.deepEqual(ju.of('register_ack')[0], { type: 'register_ack', ok: true, capabilities: [...CAPABILITIES, 'team_workspace'], server: { name: 'conest-dsh-collab' } });

  const bad = connect(gw, 'bot=system');
  assert.equal(bad.of('register_ack')[0].ok, false);
  assert.equal(bad.closed.code, 4002);

  hub.post(1, { authorKind: 'user', author: 'owner', name: '我', text: '@橘 看看日志' });
  await tick();
  const toJu = ju.of('message').at(-1);
  assert.equal(toJu.content, '看看日志');
  assert.equal(toJu.mentioned, true);
  assert.equal(toJu.chat_id, 'room-1');
  assert.equal(toJu.msg_id.startsWith('hub-'), true);
  assert.equal(whale.of('message').at(-1).content, '<@111> 看看日志');
  assert.equal(whale.of('message').at(-1).mentioned, false);

  ju.frame({ type: 'reply', reply_ctx: 'room-1', content: '看完了 @鲸鱼娘 你接着\n\n*claude · 1k tok*', agent: true });
  await tick(); await tick();
  const stored = hub.store.page(1, undefined, 1)[0];
  assert.equal(stored.author, 'ju');
  assert.equal(stored.from_turn, 1);
  const toWhale = whale.of('message').at(-1);
  assert.equal(toWhale.from_bot, true);
  assert.equal(toWhale.mentioned, true);
  assert.equal(toWhale.content, '【橘】看完了 你接着');
  assert.equal(toWhale.user_mention_id, '111');
  assert.equal(ju.of('message').length, 1, 'author never receives its own reply');

  hub.post(1, { authorKind: 'user', author: 'owner', name: '我', text: '橘，你看看这个' });
  await tick();
  assert.equal(ju.of('message').at(-1).mentioned, true, 'a bare name at line start calls the role');
  assert.equal(whale.of('message').at(-1).mentioned, false);

  const before = whale.of('message').length;
  ju.frame({ type: 'reply', reply_ctx: 'room-1', content: '✅ 已完成' });
  await tick(); await tick();
  assert.equal(whale.of('message').length, before, 'status notices are not forwarded');

  ju.frame({ type: 'preview_start', ref_id: 'r1', content: 'x' });
  assert.deepEqual(ju.of('preview_ack').at(-1), { type: 'preview_ack', ref_id: 'r1', preview_handle: '' });
  ju.frame({ type: 'preview_start', ref_id: 'r2', reply_ctx: 'room-1', content: PROGRESS_PREFIX + JSON.stringify({ state: 'running', steps: 2, agent: 'Claude' }) });
  const handle = ju.of('preview_ack').at(-1).preview_handle;
  assert.match(handle, /^\d+$/);
  assert.equal(whale.of('message').length, before, 'previews are not forwarded');
  whale.frame({ type: 'delete_message', preview_handle: handle });
  assert.ok(hub.store.message(Number(handle)), 'another bot cannot delete it');
  ju.frame({ type: 'delete_message', preview_handle: handle });
  assert.equal(hub.store.message(Number(handle)), undefined);

  ju.frame({ type: 'typing_start', reply_ctx: 'room-1' });
  assert.deepEqual([...hub.thinking.get(1)], ['ju']);
  const ju2 = connect(gw, 'bot=ju&name=橘');
  assert.equal(ju.closed.code, 4003);
  assert.equal(hub.thinking.get(1).has('ju'), false, 'reconnect clears stale typing');
  assert.equal(hub.members.get('ju').online, true, 'replaced socket close does not mark offline');
  ju2.close(1000);
  assert.equal(hub.members.get('ju').online, false, 'disconnected bot remains in the member list offline');
});


// M3 draft: external-member cases for dsh/collab/collab.test.mjs
//
// Where to put it (develop a28f19b7): insert after the existing
//   test('cloud-web: register ack, routing, prefixes, no self-echo, reconnect replaces', ...)
// All helpers/imports used below already exist in collab.test.mjs:
//   test, assert, makeHub(), connect(), tick(), CloudWebGateway, quiet
//
// Scope note: this file only covers behavior supported by the CURRENT gateway.
// Pre-provisioned members, per-member credentials, revocation and offline
// feedback are M1/M2 and are intentionally NOT asserted here; see
// reports/issue-drafts/321-外部成员身份与权限设计说明-草案.md (§10, §18).

test('cloud-web external member: register is visible in the roster and scoped to its room', () => {
  const hub = makeHub();
  hub.store.ensureRoom(2, 'office');
  const gw = new CloudWebGateway(hub, { token: 't', logger: quiet });

  const ext = connect(gw, 'bot=ext-qq&name=ExternalBot&mention_id=999&room=1');
  assert.equal(ext.of('register_ack')[0].ok, true);

  const member = hub.members.get('ext-qq');
  assert.equal(member.kind, 'bot');
  assert.equal(member.online, true);
  assert.equal(member.mentionId, '999');
  assert.deepEqual(member.rooms, [1]);
  assert.equal(hub.routableIn(1).some(m => m.id === 'ext-qq'), true);
  assert.equal(hub.routableIn(2).some(m => m.id === 'ext-qq'), false);

  gw.closeAll();
  hub.store.close();
});

test('cloud-web external member: disconnect is offline, reconnect replaces the old socket', () => {
  const hub = makeHub();
  hub.store.ensureRoom(2, 'office');
  const gw = new CloudWebGateway(hub, { token: 't', logger: quiet });

  const ext = connect(gw, 'bot=ext-qq&name=ExternalBot&mention_id=999&room=1');
  ext.close(1000);
  assert.equal(hub.members.get('ext-qq').online, false);
  assert.deepEqual(hub.members.get('ext-qq').rooms, [1], 'disconnect keeps the room scope');

  const again = connect(gw, 'bot=ext-qq&name=ExternalBot&mention_id=999&room=1');
  assert.equal(ext.closed.code, 1000, 'a clean close stays 1000');
  assert.equal(hub.members.get('ext-qq').online, true);
  assert.equal(hub.memberList().filter(m => m.id === 'ext-qq').length, 1, 'no duplicate member');

  const replaced = connect(gw, 'bot=ext-qq&name=ExternalBot&mention_id=999&room=1');
  assert.equal(again.closed.code, 4003, 'a reconnect replaces the old socket');
  assert.equal(replaced.of('register_ack')[0].ok, true);

  gw.closeAll();
  hub.store.close();
});

test('cloud-web external member: name collision, reserved ids and unknown rooms are refused', () => {
  const hub = makeHub();
  hub.store.ensureRoom(2, 'office');
  hub.setMember({ id: 'agent', name: 'ExternalBot', kind: 'dsh', rooms: [1] });
  const gw = new CloudWebGateway(hub, { token: 't', logger: quiet });

  const duplicate = connect(gw, 'bot=ext-2&name=ExternalBot&room=1');
  assert.equal(duplicate.of('register_ack')[0].ok, false);
  assert.equal(duplicate.closed.code, 4002);

  const reserved = connect(gw, 'bot=user&name=User&room=1');
  assert.equal(reserved.of('register_ack')[0].ok, false);
  assert.equal(reserved.closed.code, 4002);

  const unknownRoom = connect(gw, 'bot=ext-3&name=ExtThree&room=999');
  assert.equal(unknownRoom.of('register_ack')[0].ok, false);
  assert.equal(unknownRoom.closed.code, 4002);

  gw.closeAll();
  hub.store.close();
});

test('cloud-web external member: mentioned follows @name and <@mention_id>, chatter stays silent', async () => {
  const hub = makeHub();
  hub.setMember({ id: 'ds', name: 'DeepSeek', kind: 'dsh', online: true });
  const gw = new CloudWebGateway(hub, { token: 't', logger: quiet });
  const ext = connect(gw, 'bot=ext-qq&name=ExternalBot&mention_id=999&room=1');

  hub.post(1, { authorKind: 'user', author: 'owner', name: 'Owner', text: '@ExternalBot hello' });
  await tick();
  assert.equal(ext.of('message').at(-1).mentioned, true);

  hub.post(1, { authorKind: 'user', author: 'owner', name: 'Owner', text: 'no mention in this message' });
  await tick();
  assert.equal(ext.of('message').at(-1).mentioned, false);

  hub.post(1, { authorKind: 'user', author: 'owner', name: 'Owner', text: '<@999> hello again' });
  await tick();
  assert.equal(ext.of('message').at(-1).mentioned, true, 'the numeric <@mention_id> form calls the member');

  gw.closeAll();
  hub.store.close();
});

// Intentionally not asserted here (M1/M2):
// - "unknown member id is refused" and "removed member cannot re-register" need a
//   persistent member registry + revocation (M1);
// - "offline member mention feedback" needs M2.
// Add those after M1/M2 land, and mark them with the same test names for traceability.

test('cloud-web: a line-start name calls a non-primary role', async () => {
  const { mkdtempSync, writeFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const leadPath = join(mkdtempSync(join(tmpdir(), 'cloudweb-line-name-')), 'lead.json');
  writeFileSync(leadPath, JSON.stringify({ lead: 'whale', name: '鲸鱼娘' }));
  const store = new Store(':memory:');
  store.ensureRoom(1, 'general');
  const hub = new Hub(store, quiet, new LeadState(leadPath, quiet), 'whale');
  hub.setMember({ id: 'owner', name: '我', kind: 'human', online: true });
  hub.setMember({ id: 'whale', name: '鲸鱼娘', kind: 'bot', online: true });
  hub.setMember({ id: 'ju', name: '橘', kind: 'bot', online: true });
  const gw = new CloudWebGateway(hub, { token: 't', logger: quiet });
  const ju = connect(gw, 'bot=ju&name=橘');
  const whale = connect(gw, 'bot=whale&name=鲸鱼娘');

  hub.post(1, { authorKind: 'user', author: 'owner', name: '我', text: '橘，你看看这个', clientKey: 'line-name-sub' });
  await tick();
  assert.equal(ju.of('message').at(-1).mentioned, true, 'the named non-primary role is addressed');
  assert.equal(whale.of('message').at(-1).mentioned, false, 'the selected primary is not addressed by another role name');
});

test('cloud-web: token check accepts bearer, header, or query', () => {
  const gw = new CloudWebGateway(makeHub(), { token: 'secret', logger: quiet });
  const url = q => new URL(`http://x/cloud-web/ws${q}`);
  assert.equal(gw.authorized({ headers: { authorization: 'Bearer secret' } }, url('')), true);
  assert.equal(gw.authorized({ headers: { 'x-cloud-web-token': 'secret' } }, url('')), true);
  assert.equal(gw.authorized({ headers: {} }, url('?token=secret')), true);
  assert.equal(gw.authorized({ headers: { authorization: 'Bearer nope' } }, url('?token=secret')), false);
  assert.equal(new CloudWebGateway(makeHub(), { token: '', logger: quiet }).authorized({ headers: {} }, url('?token=')), false);
});

test('progress card payload becomes a titled card', () => {
  const c = progressCard(PROGRESS_PREFIX + JSON.stringify({ state: 'completed', steps: 3, elapsed_sec: 75, agent: 'Codex', items: [{ kind: 'tool_use', tool: 'Bash', text: 'go test' }] }));
  assert.equal(JSON.parse(c.card).title, 'Codex · 已完成');
  assert.match(c.text, /第 3 步 · 1分15秒\n🔧 Bash — go test/);
  assert.equal(progressCard('plain'), undefined);
});

test('progress card carries a brief view: tool name and outcome per step', () => {
  const c = progressCard(PROGRESS_PREFIX + JSON.stringify({ state: 'running', steps: 3, elapsed_sec: 9, agent: 'Codex', items: [
    { kind: 'thinking', text: 'hmm' },
    { kind: 'tool_use', tool: 'Bash', text: 'go test' }, { kind: 'tool_result', tool: 'Bash', text: 'ok', exit_code: 0 },
    { kind: 'tool_use', tool: 'Edit', text: 'a.go' }, { kind: 'tool_result', tool: 'Edit', text: 'boom', success: false },
    { kind: 'tool_use', tool: 'Read', text: 'b.go' },
  ] }));
  assert.equal(JSON.parse(c.card).brief, '第 3 步 · 9秒\n✅ Bash · 成功\n❌ Edit · 失败\n🔧 Read · 进行中');
  assert.match(c.text, /go test/);
});

test('#1616: step chips keep the newest steps whole and cut older ones once the card passes half a message', () => {
  const big = 'y'.repeat(MAX_TEXT / 4 - 16); // two of them and their calls fit in half a message
  const items = [];
  for (let i = 0; i < 4; i++) items.push({ kind: 'tool_use', tool: 'Bash', text: `step ${i}` }, { kind: 'tool_result', tool: 'Bash', text: big, exit_code: 0 });
  const chips = JSON.parse(progressCard(PROGRESS_PREFIX + JSON.stringify({ state: 'completed', steps: 4, items })).card).chips;
  assert.equal(chips[3].output.length, big.length, 'the newest output is whole');
  assert.equal(chips[2].output.length, big.length, 'so is the one before, within half a message');
  assert.ok(chips[0].output.length <= 120, 'the oldest falls back to one short line');
});

test('progress card carries step chips: tool, outcome, call and output per step (#125)', () => {
  const c = progressCard(PROGRESS_PREFIX + JSON.stringify({ state: 'running', steps: 4, elapsed_sec: 9, agent: 'Codex', items: [
    { kind: 'thinking', text: 'hmm' },
    { kind: 'tool_use', tool: 'Bash', text: 'go   test ./...' }, { kind: 'tool_result', tool: 'Bash', text: 'ok\n  all', exit_code: 0 },
    { kind: 'tool_use', tool: 'Edit', text: 'a.go' }, { kind: 'tool_result', tool: 'Edit', text: 'boom', success: false },
    { kind: 'tool_result', tool: 'Grep', text: 'x'.repeat(300) },
    { kind: 'tool_use', tool: 'Read', text: 'b.go' },
  ] }));
  assert.deepEqual(JSON.parse(c.card).chips, [
    // #1616: the call and output keep their lines and length (the step list folds them on the page).
    { tool: 'Bash', state: 'ok', input: 'go   test ./...', output: 'ok\n  all' },
    { tool: 'Edit', state: 'failed', input: 'a.go', output: 'boom' },
    { tool: 'Grep', state: 'ok', output: 'x'.repeat(300) },
    { tool: 'Read', state: 'running', input: 'b.go' },
  ]);
  const done = progressCard(PROGRESS_PREFIX + JSON.stringify({ state: 'completed', items: [{ kind: 'tool_use', tool: 'Read', text: 'b.go' }, { kind: 'error', text: 'denied' }, { kind: 'tool_use', text: 'q' }] }));
  assert.deepEqual(JSON.parse(done.card).chips, [{ tool: 'Read', state: 'failed', input: 'b.go', output: 'denied' }, { tool: '工具', state: 'unknown', input: 'q' }]);
});


/**
 * Minimal DSH runtime. Agents keep a pending inbox and a Session event log;
 * `turn()` plays one real-shaped turn: turn/start, the consumed input as
 * user/message (same id), assistant messages, turn/end — and feeds each event
 * to the driver like the root session/event listener does.
 */
const settle = async () => { for (let i = 0; i < 8; i++) await tick(); };

async function boundOnce(hub, dsh) {
  hub.post(1, { authorKind: 'user', author: 'owner', name: '我', text: '@DeepSeek 第一次' });
  await settle();
  const agent = dsh.sessions.get(dsh.made[0]);
  dsh.turn(agent, ['第一次的回答']);
  await settle();
  return agent;
}

/** @ ds again and answer the turn; returns the agent that got the prompt. */
async function sentJob(hub, dsh, sessionId, text) {
  const agent = (await dsh.ctx.agents.create({ sessionId })).agent;
  const t = hub.store.append(1, { authorKind: 'user', author: 'owner', name: '我', text }).message;
  const job = hub.store.addJob('ds', 1, t.id);
  const input = { id: `input-${sessionId}`, role: 'user', content: [{ type: 'text', text }] };
  hub.store.markSent(job.id, sessionId, agent.session.seq, input.id);
  agent.followup(input);
  return { job, agent, input };
}

test('store: a v1 database migrates to the current schema and keeps its rows', async () => {
  const { DatabaseSync } = await import('node:sqlite');
  const { mkdtempSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { tmpdir } = await import('node:os');
  const path = join(mkdtempSync(join(tmpdir(), 'collab-')), 'v1.sqlite3');
  const v2 = new Store(path);
  v2.ensureRoom(1, 'general');
  v2.append(1, { authorKind: 'user', author: 'owner', name: '我', text: 'kept' });
  v2.db.exec('ALTER TABLE messages DROP COLUMN reply_to; ALTER TABLE jobs DROP COLUMN input_id; DROP TABLE members; ALTER TABLE messages DROP COLUMN draft; PRAGMA user_version = 1');
  v2.close();
  const raw = new DatabaseSync(path);
  assert.equal(raw.prepare('PRAGMA user_version').get().user_version, 1);
  raw.close();
  const reopened = new Store(path);
  assert.equal(reopened.page(1, undefined, 1)[0].text, 'kept');
  const job = reopened.addJob('ds', 1, 1);
  assert.equal(reopened.markSent(job.id, 's', 0, 'in-1'), true);
  assert.equal(reopened.job(job.id).input_id, 'in-1');
  assert.deepEqual(reopened.members(), [], 'v3 members table exists after migration');
  assert.equal(reopened.page(1, undefined, 1)[0].draft, 0, 'v6 old rows are not drafts');
  reopened.close();
});

test('config: absolute paths, unique member ids, token from env only', () => {
  assert.throws(() => resolveConfig({ dataDir: 'rel', workspacePath: '/w' }), /dataDir/);
  assert.throws(() => resolveConfig({ dataDir: '/d', workspacePath: '/w', dshMembers: [{ id: 'owner', name: 'x' }] }), /unique/);
  const c = resolveConfig({ dataDir: '/d', workspacePath: '/w', dshMembers: [{ id: 'ds', name: 'DeepSeek' }] }, { CONEST_COLLAB_BOT_TOKEN: 'tok', HOME: '/home' });
  assert.equal(c.botToken, 'tok');
  assert.equal(c.leadFile, join('/home', '.bothouse', 'lead.json'));
  assert.deepEqual(c.rooms, [{ id: 1, name: 'general' }]);
});

function fakeLlm() {
  return {
    listProviders: () => [{ id: 'relay', name: '中转站' }, { id: 'broken', name: 'Broken' }],
    listModels: async (p) => { if (p === 'broken') throw Error('no key'); return [{ id: 'm1', name: 'Model 1' }]; },
    resolveModelInfo: async (p, m) => { if (p !== 'relay' || m !== 'm1') throw Error('unknown model'); return {}; },
  };
}

function makeHubFrom(store) {
  const hub = new Hub(store, quiet);
  hub.setMember({ id: 'owner', name: '我', kind: 'human', online: true });
  return hub;
}

test('cloud-web: a bot may not take a name another member already uses', () => {
  const hub = makeHub();
  hub.setMember({ id: 'ds', name: 'DeepSeek', kind: 'dsh', online: true });
  const gw = new CloudWebGateway(hub, { token: 't', logger: quiet });
  const ws = connect(gw, 'bot=imposter&name=DeepSeek');
  assert.equal(ws.of('register_ack')[0].ok, false);
  assert.equal(ws.closed.code, 4002);
});

test('store: a v3 database gains the cli column and keeps its members', async () => {
  const { mkdtempSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { tmpdir } = await import('node:os');
  const path = join(mkdtempSync(join(tmpdir(), 'collab-')), 'v3.sqlite3');
  const s = new Store(path);
  s.addMember({ id: 'old', name: 'Old', model: { provider: 'relay', model: 'm1' } });
  s.db.exec('ALTER TABLE messages DROP COLUMN reply_to; ALTER TABLE members DROP COLUMN avatar; ALTER TABLE members DROP COLUMN cli; ALTER TABLE messages DROP COLUMN draft; PRAGMA user_version = 3');
  s.close();
  const up = new Store(path);
  assert.equal(up.db.prepare('PRAGMA user_version').get().user_version, 11);
  assert.equal(up.member('old').cli, null);
  assert.equal(up.member('old').model, 'm1');
  assert.equal(up.addMember({ id: 'gm', name: 'GM', cli: 'gemini' }).cli, 'gemini');
  assert.deepEqual(up.members().map(m => m.id), ['old', 'gm']);
  up.close();
});

test('clis: detection lists installed CLIs in order; handler answers GET with [{cli, path}]', async () => {
  const { detectClis, handler } = await import('./clis.mjs');
  const paths = { codex: '/usr/local/bin/codex', claude: '/opt/bin/claude' };
  const lookup = async name => paths[name];
  assert.deepEqual(await detectClis(lookup), [{ cli: 'claude', path: '/opt/bin/claude' }, { cli: 'codex', path: '/usr/local/bin/codex' }]);
  const res = { writeHead(status, headers) { this.status = status; this.headers = headers; }, end(body) { this.body = body; } };
  await handler({ method: 'GET' }, res, lookup);
  assert.equal(res.status, 200);
  assert.deepEqual(JSON.parse(res.body), [{ cli: 'claude', path: '/opt/bin/claude' }, { cli: 'codex', path: '/usr/local/bin/codex' }]);
  await handler({ method: 'POST' }, res, lookup);
  assert.equal(res.status, 405);
  const real = await detectClis();
  for (const c of real) assert.ok(c.path.startsWith('/'), `real which gives absolute path for ${c.cli}`);
});

test('store: a v4 database gains the avatar column and keeps its members', async () => {
  const { mkdtempSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { tmpdir } = await import('node:os');
  const path = join(mkdtempSync(join(tmpdir(), 'collab-')), 'v4.sqlite3');
  const s = new Store(path);
  s.addMember({ id: 'old', name: 'Old', cli: 'claude' });
  s.db.exec('ALTER TABLE messages DROP COLUMN reply_to; ALTER TABLE members DROP COLUMN avatar; ALTER TABLE messages DROP COLUMN draft; PRAGMA user_version = 4');
  s.close();
  const up = new Store(path);
  assert.equal(up.db.prepare('PRAGMA user_version').get().user_version, 11);
  assert.equal(up.member('old').avatar, null);
  assert.equal(up.member('old').cli, 'claude');
  assert.equal(up.addMember({ id: 'w', name: 'W', avatar: 'whale' }).avatar, 'whale');
  up.close();
});

test('cloud-web: a bot announces its avatar as a slug or http(s) URL; junk is dropped', () => {
  const hub = makeHub();
  const gw = new CloudWebGateway(hub, { token: 't', logger: quiet });
  connect(gw, 'bot=ju&name=橘&avatar=orange');
  connect(gw, 'bot=pack&name=Pack&avatar=' + encodeURIComponent('http://127.0.0.1:9820/api/v1/library/avatar-image/senpai'));
  connect(gw, 'bot=junk&name=Junk&avatar=' + encodeURIComponent('javascript:alert(1)'));
  const view = Object.fromEntries(hub.memberView().map(m => [m.id, m.avatar]));
  assert.equal(view.ju, 'orange');
  assert.equal(view.pack, 'http://127.0.0.1:9820/api/v1/library/avatar-image/senpai');
  assert.equal(view.junk, undefined);
});

// #121 streamed replies: a draft row is shown but not fanned out; commit fans out once.
test('hub: a draft is shown but never fanned out; commit writes the full text and fans out once, durably', async () => {
  const { mkdtempSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { tmpdir } = await import('node:os');
  const path = join(mkdtempSync(join(tmpdir(), 'collab-')), 'draft.sqlite3');
  const store = new Store(path);
  store.ensureRoom(1, 'general');
  const hub = makeHubFrom(store);
  const seen = []; const planned = []; const pushed = [];
  hub.onMessage(m => seen.push(m.text));
  hub.onPlan(m => { planned.push(m.text); });
  hub.subscribe(e => pushed.push(e));
  const { message: d } = hub.draft(1, { authorKind: 'role', author: 'ju', name: '橘', text: '半句', clientKey: 'k' });
  assert.equal(d.draft, 1);
  assert.equal(hub.draft(1, { authorKind: 'role', author: 'ju', name: '橘', text: '又', clientKey: 'k' }).created, false);
  hub.edit(d.id, 'role', 'ju', '半句话');
  assert.equal(hub.commit(d.id, 'role', 'whale', '冒充', true), undefined, 'only the author commits');
  await tick();
  assert.deepEqual([seen, planned], [[], []], 'drafts and edits reach no agent');
  assert.deepEqual(pushed.map(e => e.message?.text), ['半句', '半句话'], 'browsers see the draft and its edit');
  // #1355: one message keeps its id for life; `draft` says whether it has settled and
  // `revision` moves with the stored text, so a consumer replaces one bubble instead of
  // appending a new one per streaming edit.
  assert.deepEqual(pushed.map(e => [e.message.id, e.message.draft === true]), [[d.id, true], [d.id, true]], 'draft frames keep one id and stay marked as drafts');
  const [draftRev, editRev] = pushed.map(e => e.message.revision);
  assert.equal(typeof draftRev, 'number');
  assert.ok(editRev >= draftRev, 'an edit never moves revision backwards');
  const row = hub.commit(d.id, 'role', 'ju', '整句话 @鲸鱼娘', true);
  assert.equal(row.id, d.id);
  assert.equal(row.text, '整句话 @鲸鱼娘');
  assert.equal(row.from_turn, 1);
  assert.equal(row.draft, 0);
  const committed = pushed.at(-1).message;
  assert.equal(pushed.length, 3, 'the commit is forwarded too');
  assert.equal(committed.id, d.id);
  assert.equal('draft' in committed, false, 'a committed reply is no longer a draft');
  assert.ok(committed.revision >= editRev, 'the commit moves revision on');
  assert.notEqual(committed.text, pushed[1].message.text);
  await tick();
  assert.deepEqual([seen, planned], [['整句话 @鲸鱼娘'], ['整句话 @鲸鱼娘']]);
  store.close();
  const again = makeHubFrom(new Store(path));
  const seen2 = [];
  again.onMessage(m => seen2.push(m.text));
  assert.equal(again.commit(d.id, 'role', 'ju', '整句话 @鲸鱼娘', true).id, d.id, 'a repeat after restart keeps the row');
  await tick();
  assert.deepEqual(seen2, [], 'a repeat after restart fans out nothing');
  assert.equal(again.store.page(1, undefined, 10).length, 1);
  again.store.close();
});

test('cloud-web reply ids: a reply to a task card carries the card id (reply_to_id); a reply frame with ref_id is acked with its row id', async () => {
  const hub = makeHub();
  const gw = new CloudWebGateway(hub, { token: 't', logger: quiet });
  const ju = connect(gw, 'bot=ju&name=橘&mention_id=111');
  ju.frame({ type: 'preview_start', ref_id: 'taskcard-task-1', reply_ctx: 'room-1', content: '任务卡：整理日志' });
  const card = ju.of('preview_ack').at(-1).preview_handle;
  assert.match(card, /^\d+$/, 'the bridge stores this handle as Task.MessageID');
  hub.post(1, { authorKind: 'user', author: 'owner', name: '我', text: '@橘 进展如何', replyTo: Number(card) });
  await tick(); await tick();
  const got = ju.of('message').at(-1);
  assert.equal(got.reply_to_id, card, 'same id as the task card handle');
  assert.equal(got.reply_to_author, '橘');
  assert.equal(got.reply_to_text, '任务卡：整理日志');
  hub.post(1, { authorKind: 'user', author: 'owner', name: '我', text: '@橘 普通' });
  await tick(); await tick();
  assert.equal(ju.of('message').at(-1).reply_to_id, undefined, 'a plain message has no reply fields');

  ju.frame({ type: 'reply', reply_ctx: 'room-1', ref_id: 'reply-1', content: '📬 汇报' });
  const ack = ju.of('preview_ack').at(-1);
  assert.equal(ack.ref_id, 'reply-1');
  const row = hub.store.page(1, undefined, 10).find(m => m.text === '📬 汇报');
  assert.equal(ack.preview_handle, String(row.id), 'the ack carries the posted row id');
  const acks = ju.of('preview_ack').length;
  ju.frame({ type: 'reply', reply_ctx: 'room-1', content: '无 ref_id' });
  assert.equal(ju.of('preview_ack').length, acks, 'no ref_id, no ack (wire unchanged)');
});

test('cloud-web reply_in_place: a text preview is a draft; the reply with its handle commits that row and is forwarded once', async () => {
  const hub = makeHub();
  const gw = new CloudWebGateway(hub, { token: 't', logger: quiet });
  const ju = connect(gw, 'bot=ju&name=橘&mention_id=111');
  const whale = connect(gw, 'bot=whale&name=鲸鱼娘');
  assert.ok(ju.of('register_ack')[0].capabilities.includes('reply_in_place'));
  ju.frame({ type: 'preview_start', ref_id: 'r1', reply_ctx: 'room-1', content: '先看' });
  const handle = ju.of('preview_ack').at(-1).preview_handle;
  assert.match(handle, /^\d+$/);
  ju.frame({ type: 'update_message', preview_handle: handle, content: '先看日志' });
  await tick(); await tick();
  assert.equal(whale.of('message').length, 0, 'the streaming preview is not forwarded');
  ju.frame({ type: 'reply', reply_ctx: 'room-1', preview_handle: handle, content: '先看日志，查完了 @鲸鱼娘 你接着', agent: true });
  await tick(); await tick();
  const rows = hub.store.page(1, undefined, 10).filter(m => m.author === 'ju');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, Number(handle));
  assert.equal(rows[0].text, '先看日志，查完了 @鲸鱼娘 你接着');
  assert.equal(whale.of('message').length, 1);
  assert.equal(whale.of('message')[0].content, '【橘】先看日志，查完了 你接着');
  ju.frame({ type: 'reply', reply_ctx: 'room-1', preview_handle: handle, content: '先看日志，查完了 @鲸鱼娘 你接着', agent: true });
  await tick(); await tick();
  assert.equal(whale.of('message').length, 1, 'a repeated commit is not forwarded again');
  ju.frame({ type: 'reply', reply_ctx: 'room-1', preview_handle: '999999', content: '预览没了 @鲸鱼娘', agent: true });
  await tick(); await tick();
  assert.equal(hub.store.page(1, undefined, 10).filter(m => m.author === 'ju').length, 2, 'a missing preview falls back to a new row');
  assert.equal(whale.of('message').length, 2);
});

test('cloud-web #119 task card survives disconnect/reconnect and keeps editing the same row', () => {
  const hub = makeHub();
  const gw = new CloudWebGateway(hub, { token: 't', logger: quiet });
  const card = (state, text) => PROGRESS_PREFIX + JSON.stringify({ version: 2, agent: '📋 整理日志', state, items: [{ kind: 'info', text }] });
  let ju = connect(gw, 'bot=ju&name=橘');
  const whale = connect(gw, 'bot=whale&name=鲸鱼娘');
  const before = whale.of('message').length;
  ju.frame({ type: 'preview_start', ref_id: 'taskcard-task-1', reply_ctx: 'room-1', content: card('running', '开始') });
  const handle = ju.of('preview_ack').at(-1).preview_handle;
  assert.match(handle, /^\d+$/);
  assert.equal(whale.of('message').length, before, 'the task card is not broadcast to other bots');
  ju.close(1006, 'gone');
  assert.ok(hub.store.message(Number(handle)), 'a dropped connection keeps the task card');
  ju = connect(gw, 'bot=ju&name=橘');
  assert.ok(hub.store.message(Number(handle)), 're-registering keeps the task card');
  ju.frame({ type: 'update_message', preview_handle: handle, content: card('completed', '完成一半') });
  const row = hub.store.message(Number(handle));
  assert.match(row.text, /完成一半/, 'later edits land on the same row');
  assert.equal(JSON.parse(row.card).state, 'completed');
  assert.equal(whale.of('message').length, before, 'edits are not broadcast either');
});

test('cloud-web #119 task card seq: a retried create refreshes the row, an older frame cannot roll it back', () => {
  const hub = makeHub();
  const gw = new CloudWebGateway(hub, { token: 't', logger: quiet });
  const card = (state, text) => PROGRESS_PREFIX + JSON.stringify({ version: 2, agent: '📋 整理日志', state, items: [{ kind: 'info', text }] });
  const ju = connect(gw, 'bot=ju&name=橘');
  ju.frame({ type: 'preview_start', ref_id: 'taskcard-task-1', reply_ctx: 'room-1', content: card('running', '开始'), seq: 1 });
  const handle = ju.of('preview_ack').at(-1).preview_handle;
  // The ack was lost; the bridge retries the create later with newer content.
  ju.frame({ type: 'preview_start', ref_id: 'taskcard-task-1', reply_ctx: 'room-1', content: card('running', '完成一半'), seq: 3 });
  assert.equal(ju.of('preview_ack').at(-1).preview_handle, handle, 'the retry returns the same row');
  let row = hub.store.message(Number(handle));
  assert.match(row.text, /完成一半/, 'the retried create shows its newer content');
  assert.equal(JSON.parse(row.card).seq, 3);
  ju.frame({ type: 'update_message', preview_handle: handle, content: card('running', '旧进度'), seq: 2 });
  row = hub.store.message(Number(handle));
  assert.match(row.text, /完成一半/, 'an older frame is ignored');
  ju.frame({ type: 'update_message', preview_handle: handle, content: card('completed', '完成'), seq: 4 });
  row = hub.store.message(Number(handle));
  assert.match(row.text, /完成/);
  assert.equal(JSON.parse(row.card).state, 'completed');
  assert.equal(JSON.parse(row.card).seq, 4);
  ju.frame({ type: 'preview_start', ref_id: 'taskcard-task-1', reply_ctx: 'room-1', content: card('running', '开始'), seq: 1 });
  assert.equal(JSON.parse(hub.store.message(Number(handle)).card).state, 'completed', 'a delayed first create does not reopen a finished card');
});

test('store shutdown: live drafts remain queryable and late disconnect cleanup is safe', () => {
  const hub = makeHub();
  const gateway = new CloudWebGateway(hub, { token: 't', logger: quiet });
  const bot = connect(gateway, 'bot=shutdown&name=Shutdown');
  hub.draft(1, { authorKind: 'role', author: 'shutdown', name: 'Shutdown', text: 'partial', clientKey: 'shutdown-draft' });
  assert.equal(hub.store.drafts('role', 'shutdown').length, 1);
  hub.dropDrafts('role', 'shutdown');
  assert.deepEqual(hub.store.drafts('role', 'shutdown'), []);
  // Older Node versions expose close() without the isOpen property.
  hub.store.db = { close: hub.store.db.close.bind(hub.store.db) };
  hub.store.close();
  assert.doesNotThrow(() => hub.store.close());
  assert.deepEqual(hub.store.drafts('role', 'shutdown'), []);
  assert.doesNotThrow(() => hub.dropDrafts('role', 'shutdown'));
  assert.doesNotThrow(() => bot.close(1001, 'server shutdown'));
  assert.throws(() => hub.store.page(1, undefined, 10), /closed|finalized/i,
    'ordinary queries after shutdown still report lifecycle errors');
});

test('cloud-web #120: permission prompt → button → card_action → card state; duplicates, expiry, offline', async () => {
  const hub = makeHub();
  const gw = new CloudWebGateway(hub, { token: 't', logger: quiet });
  const bot = connect(gw, 'bot=dou&name=大豆包');
  assert.ok(CAPABILITIES.includes('buttons'));
  const buttons = [[{ Text: '允许', Data: 'perm:allow' }, { Text: '拒绝', Data: 'perm:deny' }], [{ Text: '允许所有 (本次会话)', Data: 'perm:allow_all' }]];
  const prompt = (sk = 'cloud_web:room-1') => bot.frame({ type: 'buttons', session_key: sk, reply_ctx: 'room-1', content: '⚠️ **权限请求** run_command\n回复 **允许** / **拒绝** / **允许所有**', buttons });
  prompt();
  await tick();
  const first = hub.store.page(1).at(-1);
  const card = JSON.parse(first.card);
  assert.equal(card.kind, 'permission');
  assert.equal(card.state, 'pending');
  assert.deepEqual(card.actions.map(a => a.decision), ['allow', 'deny', 'allow_all']);

  // A newer prompt in the same session supersedes the old one.
  prompt();
  await tick();
  const second = hub.store.page(1).at(-1);
  assert.equal(JSON.parse(hub.store.message(first.id).card).state, 'expired');
  assert.throws(() => gw.decidePermission(first.id, 'allow'), /过期/);
  assert.equal(bot.of('card_action').length, 0);

  const out = gw.decidePermission(second.id, 'allow_all');
  assert.equal(JSON.parse(out.card).state, 'allowed_all');
  assert.deepEqual(bot.of('card_action'), [{ type: 'card_action', session_key: 'cloud_web:room-1', reply_ctx: 'room-1', action: 'perm:allow_all' }]);
  // Repeated click: rejected, nothing more sent to the bot.
  assert.throws(() => gw.decidePermission(second.id, 'deny'), /已经处理/);
  assert.equal(bot.of('card_action').length, 1);
  // Not a permission prompt / unknown decision.
  const plain = hub.post(1, { authorKind: 'user', author: 'owner', name: '我', text: 'hi' }).message;
  assert.throws(() => gw.decidePermission(plain.id, 'allow'), /不是权限请求/);
  assert.throws(() => gw.decidePermission(second.id, 'sudo'), /unknown decision/);

  // Offline bot: the request stays pending and the click says why.
  prompt();
  await tick();
  const third = hub.store.page(1).at(-1);
  gw.bots.delete('dou');
  assert.throws(() => gw.decidePermission(third.id, 'allow'), /断线/);
  assert.equal(JSON.parse(hub.store.message(third.id).card).state, 'pending');
  // Reconnect = restarted cc-connect: its pending requests expire.
  const again = connect(gw, 'bot=dou&name=大豆包');
  assert.equal(again.of('register_ack')[0].ok, true);
  assert.equal(JSON.parse(hub.store.message(third.id).card).state, 'expired');
});

test('cloud-web: bridge question buttons and a text reply reach the bot exactly once', async () => {
  const hub = makeHub();
  const gw = new CloudWebGateway(hub, { token: 't', logger: quiet });
  const bot = connect(gw, 'bot=dou&name=大豆包');
  const buttons = [[{ Text: '选 A', Data: 'askq:42:0' }, { Text: '选 B', Data: 'askq:42:1' }]];
  const ask = () => bot.frame({ type: 'buttons', session_key: 'cloud_web:room-1', reply_ctx: 'room-1', content: '❓ 选哪个方案？', buttons });
  ask();
  await tick();
  const first = hub.store.page(1).at(-1);
  assert.equal(JSON.parse(first.card).kind, 'question');
  gw.decidePermission(first.id, 'askq:42:1');
  assert.equal(JSON.parse(hub.store.message(first.id).card).state, 'answered');
  assert.equal(bot.of('card_action').at(-1).action, 'askq:42:1');
  assert.throws(() => gw.decidePermission(first.id, 'askq:42:0'), /已经处理/);
  ask();
  await tick();
  const second = hub.store.page(1).at(-1);
  hub.post(1, { authorKind: 'user', author: 'owner', name: '我', text: '我选自定义方案', replyTo: second.id });
  await tick();
  assert.equal(JSON.parse(hub.store.message(second.id).card).state, 'answered');
  assert.equal(bot.of('message').at(-1).content, '我选自定义方案');
  assert.equal(bot.of('card_action').length, 1);
});

test('cloud-web #120: owner text reply takes the same decision path; bot text does not approve', async () => {
  const hub = makeHub();
  const gw = new CloudWebGateway(hub, { token: 't', logger: quiet });
  const bot = connect(gw, 'bot=dou&name=大豆包');
  const other = connect(gw, 'bot=ju&name=橘');
  bot.frame({ type: 'buttons', session_key: 'cloud_web:room-1', reply_ctx: 'room-1', content: '权限请求', buttons: [[{ Text: '允许', Data: 'perm:allow' }, { Text: '拒绝', Data: 'perm:deny' }]] });
  await tick();
  const promptRow = hub.store.page(1).at(-1);
  // The prompt itself is not forwarded to other bots as chat.
  assert.equal(other.of('message').length, 0);
  // Another bot saying "允许" does not decide anything.
  other.frame({ type: 'reply', reply_ctx: 'room-1', content: '允许' });
  await tick(); await tick();
  assert.equal(JSON.parse(hub.store.message(promptRow.id).card).state, 'pending');
  const before = bot.of('message').length;
  hub.post(1, { authorKind: 'user', author: 'owner', name: '我', text: '拒绝' });
  await tick(); await tick();
  const card = JSON.parse(hub.store.message(promptRow.id).card);
  assert.equal(card.state, 'denied');
  assert.equal(card.decided_by, 'text');
  assert.equal(bot.of('card_action').at(-1).action, 'perm:deny');
  // The answered bot gets the decision once (card_action), not the text too.
  assert.equal(bot.of('message').length, before);
});

test('cloud-web #120: textDecision mirrors the bridge vocabularies', async () => {
  const { textDecision } = await import('./cloudweb.mjs');
  assert.equal(textDecision('允许所有'), 'allow_all');
  assert.equal(textDecision('allow all please'), 'allow_all');
  assert.equal(textDecision('好的，允许'), 'allow');
  assert.equal(textDecision('拒绝'), 'deny');
  assert.equal(textDecision('禁止允许这种'), undefined);
  assert.equal(textDecision('看看日志'), undefined);
  // Same separators as bridge permissionTokenSeparator: quotes, brackets, @, ·.
  assert.equal(textDecision('“允许”'), 'allow');
  assert.equal(textDecision('【允许】'), 'allow');
  assert.equal(textDecision('(拒绝)'), 'deny');
  assert.equal(textDecision('「允许」'), undefined); // not a bridge separator either
  assert.equal(textDecision("'allow'"), 'allow');
  assert.equal(textDecision('＠橘·允许所有'), 'allow_all');
});

test('cloud-web #120: owner text with several bots pending — no @ answers all, @ answers only that bot', async () => {
  const hub = makeHub();
  const gw = new CloudWebGateway(hub, { token: 't', logger: quiet });
  const dou = connect(gw, 'bot=dou&name=大豆包');
  const ju = connect(gw, 'bot=ju&name=橘');
  const ask = async b => {
    b.frame({ type: 'buttons', session_key: 'cloud_web:room-1', reply_ctx: 'room-1', content: '权限请求', buttons: [[{ Text: '允许', Data: 'perm:allow' }, { Text: '拒绝', Data: 'perm:deny' }]] });
    await tick();
    return hub.store.page(1).at(-1).id;
  };
  const state = id => JSON.parse(hub.store.message(id).card).state;
  // No @: every bot's cc-connect would act on the word, so every card takes the decision.
  let a = await ask(dou), b = await ask(ju);
  const msgsBefore = [dou.of('message').length, ju.of('message').length];
  hub.post(1, { authorKind: 'user', author: 'owner', name: '我', text: '“允许”' });
  await tick(); await tick();
  assert.equal(state(a), 'allowed');
  assert.equal(state(b), 'allowed');
  assert.equal(dou.of('card_action').at(-1).action, 'perm:allow');
  assert.equal(ju.of('card_action').at(-1).action, 'perm:allow');
  assert.deepEqual([dou.of('message').length, ju.of('message').length], msgsBefore);
  // @ one bot: only its card is decided; the other is not sent the text and stays pending.
  a = await ask(dou); b = await ask(ju);
  const douActs = dou.of('card_action').length, juMsgs = ju.of('message').length;
  hub.post(1, { authorKind: 'user', author: 'owner', name: '我', text: '@橘 拒绝' });
  await tick(); await tick();
  assert.equal(state(b), 'denied');
  assert.equal(ju.of('card_action').at(-1).action, 'perm:deny');
  assert.equal(state(a), 'pending');
  assert.equal(dou.of('card_action').length, douActs);
  assert.equal(dou.of('message').filter(m => /拒绝/.test(m.content)).length, 0);
  assert.equal(ju.of('message').length, juMsgs);
  // Text that is not a decision still reaches everyone.
  hub.post(1, { authorKind: 'user', author: 'owner', name: '我', text: '等一下' });
  await tick(); await tick();
  assert.equal(dou.of('message').at(-1).content, '等一下');
  assert.equal(state(a), 'pending');
});

// Issue #122: a channel message may reply to one earlier message.
test('reply: the quote is stored and served; a deleted original degrades without leaking it', async () => {
  const hub = makeHub();
  hub.store.ensureRoom(2, 'other');
  const events = [];
  hub.subscribe(e => events.push(e));
  const { message: orig } = hub.post(1, { authorKind: 'role', author: 'ju', name: '橘', text: '一'.repeat(50) });
  const { message: reply } = hub.post(1, { authorKind: 'user', author: 'owner', name: '我', text: '收到', replyTo: orig.id });
  assert.equal(reply.reply_to, orig.id);
  const { publicMessage: pm } = await import('./store.mjs');
  const pub = pm(reply, hub.store);
  assert.deepEqual(pub.reply_to, { id: orig.id, author_kind: 'role', author: 'ju', name: '橘', text: '一'.repeat(40) + '…' });
  assert.deepEqual(events.at(-1).message.reply_to, pub.reply_to, 'the live event carries the quote');
  assert.equal(publicMessage(orig, hub.store).reply_to, undefined, 'a plain message has no quote');
  assert.throws(() => hub.post(1, { authorKind: 'user', author: 'owner', name: '我', text: 'x', replyTo: 999 }), { code: 'reply-missing' });
  const { message: elsewhere } = hub.post(2, { authorKind: 'user', author: 'owner', name: '我', text: '别处' });
  assert.throws(() => hub.post(1, { authorKind: 'user', author: 'owner', name: '我', text: 'x', replyTo: elsewhere.id }), { code: 'reply-missing' }, 'only the same room');
  hub.remove(orig.id, 'role', 'ju');
  const gone = publicMessage(hub.store.message(reply.id), hub.store);
  assert.deepEqual(gone.reply_to, { id: orig.id, deleted: true });
  assert.doesNotMatch(JSON.stringify(gone), /一一/, 'deleted text never leaks');
});

test('reply: a v6 database gains reply_to and keeps its messages', async () => {
  const { mkdtempSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { tmpdir } = await import('node:os');
  const path = join(mkdtempSync(join(tmpdir(), 'collab-')), 'v6.sqlite3');
  const s = new Store(path);
  s.ensureRoom(1, 'general');
  s.append(1, { authorKind: 'user', author: 'owner', name: '我', text: '老消息' });
  s.db.exec('ALTER TABLE messages DROP COLUMN reply_to; PRAGMA user_version = 6');
  s.close();
  const up = new Store(path);
  assert.equal(up.db.prepare('PRAGMA user_version').get().user_version, 11);
  const old = up.page(1, undefined, 1)[0];
  assert.equal(old.text, '老消息');
  assert.equal(old.reply_to, null);
  assert.equal(up.append(1, { authorKind: 'user', author: 'owner', name: '我', text: '回', replyTo: old.id }).message.reply_to, old.id);
  up.close();
});

const records = hub => hub.store.page(1, undefined, 200).filter(m => m.author_kind === 'system');

test('tasks: the tasks table is ensured idempotently and survives reopen', async () => {
  const { mkdtempSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { tmpdir } = await import('node:os');
  const path = join(mkdtempSync(join(tmpdir(), 'collab-')), 'tasks.sqlite3');
  const s = new Store(path);
  s.ensureRoom(1, 'general');
  s.db.exec("INSERT INTO tasks (room_id, title, owner, created_by, status, created_at, updated_at) VALUES (1, 'kept', 'ds', 'owner', 'assigned', 1, 1)");
  s.db.exec('ALTER TABLE tasks DROP COLUMN note; PRAGMA user_version = 8');
  s.close();
  const again = new Store(path);
  again.ensureTasks();
  const cols = again.db.prepare('PRAGMA table_info(tasks)').all().map(c => c.name);
  assert.equal(cols.includes('note'), true, 'a missing column is added back');
  assert.equal(again.db.prepare('SELECT title FROM tasks').get().title, 'kept');
  assert.equal(again.db.prepare('PRAGMA user_version').get().user_version, 11);
  again.close();
});

const plain = v => JSON.parse(JSON.stringify(v));
test('store: a v6 database gains kind/parent_id; opening it creates no workspace', async () => {
  const { mkdtempSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { tmpdir } = await import('node:os');
  const path = join(mkdtempSync(join(tmpdir(), 'collab-')), 'v6.sqlite3');
  const old = new Store(path);
  old.ensureRoom(1, 'general');
  old.ensureRoom(2, 'dev');
  old.append(1, { authorKind: 'user', author: 'owner', name: '我', text: 'kept' });
  old.db.exec("DELETE FROM rooms WHERE kind = 'workspace'; ALTER TABLE rooms DROP COLUMN parent_id; ALTER TABLE rooms DROP COLUMN kind; PRAGMA user_version = 6");
  old.close();
  const s = new Store(path);
  assert.equal(s.db.prepare('PRAGMA user_version').get().user_version, 11);
  assert.deepEqual(plain(s.rooms()), [
    { id: 1, name: 'general', kind: 'chat', parent_id: null },
    { id: 2, name: 'dev', kind: 'chat', parent_id: null },
  ], 'no workspace is backfilled on open');
  assert.equal(s.page(1, undefined, 1)[0].text, 'kept');
  s.close();
  // Columns already present (e.g. another branch migrated first): reopening adds nothing twice.
  const again = new Store(path);
  again.db.exec('PRAGMA user_version = 6');
  again.close();
  const third = new Store(path);
  assert.equal(third.rooms().length, 2, 'still no workspace after reopening');
  third.close();
});

test('store: a configured chat channel gets no workspace until the first createWorkspace', () => {
  const s = new Store(':memory:');
  s.ensureRoom(1, 'general');
  assert.deepEqual(s.rooms().map(r => r.kind), ['chat'], 'startup creates no workspace');
  s.db.prepare("INSERT INTO tasks (room_id, title, owner, created_by, status, created_at, updated_at) VALUES (1, 'active task', 'ds', 'lead', 'assigned', 1, 1)").run();
  assert.deepEqual(s.roomsView().map(r => r.active), [1]);
  assert.deepEqual(plain(s.createWorkspace(1)), { id: 1000000, name: '工作区1', kind: 'workspace', parent_id: 1 });
  assert.equal(s.createWorkspace(1).name, '工作区2');
  assert.deepEqual(s.roomsView().map(r => r.active), [1, 0, 0]);
});

test('store: default config, then {id:2} added — starts, workspace ids stay out of the config range', async () => {
  const { mkdtempSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { tmpdir } = await import('node:os');
  const path = join(mkdtempSync(join(tmpdir(), 'collab-')), 'collab.sqlite3');
  const start = config => { // what plugin.apply does on startup
    const s = new Store(path);
    for (const r of resolveConfig({ dataDir: path, workspacePath: path, ...config }).rooms) s.ensureRoom(r.id, r.name);
    return s;
  };
  const first = start({}); // default config: one chat channel { id: 1, name: 'general' }
  assert.equal(first.rooms().some(r => r.kind === 'workspace'), false, 'startup creates no workspace');
  const ws = first.createWorkspace(1); // what the first POST .../workspaces does
  assert.deepEqual([ws.name, ws.parent_id], ['工作区1', 1]);
  assert.ok(ws.id >= 1000000, 'workspace ids start at 1000000');
  const key = roomKey(ws.id);
  const msg = first.append(ws.id, { authorKind: 'user', author: 'owner', name: '我', text: '在工作区' }).message;
  first.bind('m1', ws.id, 'sess-ws');
  first.addJob('m1', ws.id, msg.id);
  first.close();
  // A chat channel added to the config later takes its own small id; the workspace keeps its id.
  const second = start({ rooms: [{ id: 1, name: 'general' }, { id: 2, name: 'dev' }] });
  assert.deepEqual(plain(second.room(2)), { id: 2, name: 'dev', kind: 'chat', parent_id: null });
  assert.deepEqual(plain(second.room(ws.id)), { id: ws.id, name: '工作区1', kind: 'workspace', parent_id: 1 });
  assert.equal(second.message(msg.id).room_id, ws.id, 'the workspace keeps its messages');
  assert.equal(second.binding('m1', ws.id).session_id, 'sess-ws');
  assert.equal(second.job(1).room_id, ws.id);
  assert.equal(roomKey(second.rooms().find(r => r.kind === 'workspace').id), key, 'bot session key room-<id> is unchanged');
  assert.equal(second.page(2, undefined, 10).length, 0, 'the configured channel starts empty');
  // A config id that is inside the workspace range is refused instead of moving the workspace.
  assert.throws(() => second.ensureRoom(ws.id, 'clash'), e => e.code === 'workspace-id-conflict');
  second.close();
});

test('store: an unreleased dev database moves old small-id workspaces into the workspace range', async () => {
  const { mkdtempSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { tmpdir } = await import('node:os');
  const path = join(mkdtempSync(join(tmpdir(), 'collab-')), 'collab.sqlite3');
  const old = new Store(path);
  old.ensureRoom(1, 'general');
  // Shape written by the previous PR revision: 工作区1 shares the config sequence at id 2.
  old.db.exec("INSERT INTO rooms (id, name, kind, parent_id) VALUES (2, '工作区1', 'workspace', 1)");
  const msg = old.append(2, { authorKind: 'user', author: 'owner', name: '我', text: '在工作区' }).message;
  old.bind('m1', 2, 'sess-ws');
  old.addJob('m1', 2, msg.id);
  old.close();
  const s = new Store(path);
  assert.deepEqual(plain(s.rooms()), [
    { id: 1, name: 'general', kind: 'chat', parent_id: null },
    { id: 1000000, name: '工作区1', kind: 'workspace', parent_id: 1 },
  ]);
  assert.equal(s.message(msg.id).room_id, 1000000);
  assert.equal(s.binding('m1', 1000000).session_id, 'sess-ws');
  assert.equal(s.job(1).room_id, 1000000);
  s.close();
});

test('store: a v8 database missing reply_to (#133 shipped after) gains it on open', async () => {
  const { mkdtempSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { tmpdir } = await import('node:os');
  const path = join(mkdtempSync(join(tmpdir(), 'collab-')), 'collab.sqlite3');
  const s = new Store(path);
  s.ensureRoom(1, 'general');
  s.append(1, { authorKind: 'user', author: 'owner', name: '我', text: 'old' });
  s.db.exec('ALTER TABLE messages DROP COLUMN reply_to');
  assert.equal(s.db.prepare('PRAGMA user_version').get().user_version, 11);
  s.close();
  const up = new Store(path);
  assert.ok(up.db.prepare('PRAGMA table_info(messages)').all().some(c => c.name === 'reply_to'));
  assert.equal(up.db.prepare('PRAGMA user_version').get().user_version, 11);
  assert.equal(up.page(1, undefined, 1)[0].text, 'old');
  up.close();
});

test('store: creating a chat channel creates no workspace; the first createWorkspace makes 工作区1, then 工作区2', () => {
  const s = new Store(':memory:');
  const room = s.createRoom('ops');
  assert.deepEqual(plain(room), { id: 1, name: 'ops', kind: 'chat', parent_id: null });
  assert.equal(s.rooms().some(r => r.kind === 'workspace'), false, 'a new chat channel starts with no workspace');
  assert.equal(s.createWorkspace(1).name, '工作区1');
  assert.equal(s.createWorkspace(1).name, '工作区2');
  // Called on a workspace, the new one is a sibling under the same chat channel.
  const third = s.createWorkspace(1000000);
  assert.deepEqual([third.name, third.parent_id], ['工作区3', 1]);
  // Numbering follows the highest existing number, not the count.
  s.db.prepare('DELETE FROM rooms WHERE id = ?').run(third.id - 1);
  assert.equal(s.createWorkspace(1).name, '工作区4');
  const other = s.createRoom('other');
  assert.equal(other.kind, 'chat');
  // One shared pool per server: numbers continue across chat channels (1, 3, 4 exist).
  const pooled = s.createWorkspace(other.id);
  assert.deepEqual([pooled.name, pooled.parent_id], ['工作区5', other.id], 'numbering is unique across chat channels');
  assert.equal(s.createWorkspace(1).name, '工作区6');
  const names = s.rooms().filter(r => r.kind === 'workspace').map(r => r.name);
  assert.equal(new Set(names).size, names.length, `workspace names are globally unique: ${names}`);
  assert.throws(() => s.createWorkspace(99), e => e.code === 'room-missing');
});

test('store: opening renumbers the old per-chat duplicate 工作区n; ids and parents stay', async () => {
  const { mkdtempSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { tmpdir } = await import('node:os');
  const path = join(mkdtempSync(join(tmpdir(), 'collab-')), 'collab.sqlite3');
  const old = new Store(path);
  old.ensureRoom(1, 'general');
  old.ensureRoom(2, 'dev');
  // Shape before the shared pool: each chat channel numbered its own 工作区1..n.
  old.db.exec(`INSERT INTO rooms (id, name, kind, parent_id) VALUES
    (1000000, '工作区1', 'workspace', 1), (1000001, '工作区2', 'workspace', 1),
    (1000002, '工作区1', 'workspace', 2), (1000003, '工作区2', 'workspace', 2)`);
  old.close();
  const s = new Store(path);
  const ws = () => plain(s.rooms().filter(r => r.kind === 'workspace')).map(r => [r.id, r.name, r.parent_id]);
  assert.deepEqual(ws(), [[1000000, '工作区1', 1], [1000001, '工作区2', 1], [1000002, '工作区3', 2], [1000003, '工作区4', 2]]);
  s.close();
  const again = new Store(path); // idempotent
  assert.deepEqual(plain(again.rooms().filter(r => r.kind === 'workspace')).map(r => r.name), ['工作区1', '工作区2', '工作区3', '工作区4']);
  assert.equal(again.createWorkspace(2).name, '工作区5');
  again.close();
});

test('store: a workspace belongs to the chat channel it was made for, also after it is released (#762)', () => {
  const s = new Store(':memory:');
  s.ensureRoom(1, 'general');
  s.ensureRoom(2, 'dev');
  const w = s.createWorkspace(1);
  assert.equal(s.workspaceOwner(w.id), 1);
  // The owner may hand off again; another chat channel is refused.
  assert.equal(s.claimWorkspace(1, w.id).parent_id, 1);
  assert.throws(() => s.claimWorkspace(2, w.id), e => e.code === 'workspace-owned');
  assert.equal(s.room(w.id).parent_id, 1, 'a refused claim moves nothing');
  // From a workspace, the claim goes to its chat channel (still the owner here).
  const w2 = s.createWorkspace(1);
  assert.equal(s.claimWorkspace(w.id, w2.id).parent_id, 1);
  assert.throws(() => s.claimWorkspace(2, 1), e => e.code === 'not-workspace');
  assert.throws(() => s.claimWorkspace(2, 99), e => e.code === 'room-missing');
  // Released after its last task: free, but still general's; dev is refused, general takes it again.
  assert.equal(s.releaseWorkspace(w.id), true);
  assert.equal(s.workspaceOwner(w.id), null);
  assert.equal(s.releaseWorkspace(w.id), false, 'already free');
  assert.throws(() => s.claimWorkspace(2, w.id), e => e.code === 'workspace-owned');
  assert.equal(s.room(w.id).parent_id, 1, 'the free workspace stays under general');
  assert.equal(s.claimWorkspace(1, w.id).parent_id, 1);
  assert.equal(s.workspaceOwner(w.id), 1);
});

test('store #762: createWorkspace reuses only its own chat channel\'s lowest free workspace; another one gets 工作区n+1', () => {
  const s = new Store(':memory:');
  s.ensureRoom(1, 'general');
  s.ensureRoom(2, 'dev');
  const w1 = s.createWorkspace(1);
  const w2 = s.createWorkspace(1);
  const w3 = s.createWorkspace(2);
  assert.equal(w3.name, '工作区3', 'none free: a new one');
  s.releaseWorkspace(w2.id);
  s.releaseWorkspace(w1.id);
  // A released after its last task, then B hands off: B gets a new number, A's rooms stay under A.
  const got = s.createWorkspace(2);
  assert.deepEqual([got.name, got.parent_id], ['工作区4', 2]);
  assert.equal(s.room(w1.id).parent_id, 1);
  assert.equal(s.room(w2.id).parent_id, 1);
  // B's own free workspace comes first for B.
  s.releaseWorkspace(w3.id);
  assert.equal(s.createWorkspace(2).id, w3.id);
  // A takes its own lowest free one.
  const again = s.createWorkspace(1);
  assert.deepEqual([again.id, again.parent_id], [w1.id, 1]);
  assert.equal(s.createWorkspace(1).id, w2.id);
  assert.equal(s.createWorkspace(1).name, '工作区5');
});

test('store: a released workspace keeps its sessions until a new claim clears them; fresh ones start after its last message', () => {
  const s = new Store(':memory:');
  s.ensureRoom(1, 'general');
  const resets = [];
  s.onSessionsReset(id => resets.push(id));
  const w = s.createWorkspace(1);
  s.append(w.id, { authorKind: 'user', author: 'owner', name: 'owner', text: '旧活' });
  s.bind('ds', w.id, 'collab-old');
  const last = s.append(w.id, { authorKind: 'role', author: 'ds', name: 'DeepSeek', text: '[report]\n旧活做完了' }).message;
  assert.equal(s.releaseWorkspace(w.id), true);
  assert.equal(s.binding('ds', w.id).session_id, 'collab-old', 'release alone keeps the session (#597 G35)');
  assert.equal(s.createWorkspace(1).id, w.id, 'a new handoff takes the free workspace');
  assert.equal(s.binding('ds', w.id), undefined, 'and the old session is unbound');
  assert.deepEqual(resets, [w.id], 'the listeners drop their per-conversation state');
  s.bind('ds', w.id, 'collab-new');
  assert.equal(s.binding('ds', w.id).context_cursor, last.id, 'the fresh session never reads the old task');
});

test('store G35: claimed back for a task of its last claim a workspace keeps its sessions; a claim by another chat channel in between clears them', () => {
  const s = new Store(':memory:');
  s.ensureRoom(1, 'general');
  s.ensureRoom(2, 'dev');
  const w = s.createWorkspace(1);
  s.db.prepare(`INSERT INTO tasks (room_id, title, owner, created_by, status, created_at, updated_at) VALUES (?, '活', 'ds', 'lead', 'returned', 1, 1)`).run(w.id);
  const taskId = s.db.prepare('SELECT MAX(id) AS id FROM tasks').get().id;
  s.bind('ds', w.id, 'collab-old');
  s.releaseWorkspace(w.id);
  s.claimWorkspace(1, w.id, { handoff: taskId });
  assert.equal(s.binding('ds', w.id).session_id, 'collab-old', 'rework goes on in the same session');
  s.releaseWorkspace(w.id);
  assert.throws(() => s.claimWorkspace(2, w.id), e => e.code === 'workspace-owned', 'another chat channel never takes it (#762)');
  s.createWorkspace(1); // general's next handoff, a new claim
  s.releaseWorkspace(w.id);
  assert.equal(s.binding('ds', w.id), undefined, 'another claim started fresh');
  s.bind('ds', w.id, 'collab-next');
  s.claimWorkspace(1, w.id, { handoff: taskId });
  assert.equal(s.binding('ds', w.id), undefined, 'and the old task claimed back after it does not get the later task\'s session');
});

test('cloud-web: team_workspace frames (team mode E)', async () => {
  // A store without team mode A's createWorkspace: no capability, frames answered "unsupported".
  const hub = makeHub();
  hub.store.createWorkspace = undefined;
  const gw = new CloudWebGateway(hub, { token: 't', logger: quiet });
  const ju = connect(gw, 'bot=ju&name=橘');
  assert.equal(ju.of('register_ack')[0].capabilities.includes('team_workspace'), false);
  ju.frame({ type: 'team_workspace', ref_id: 'w1', op: 'list', reply_ctx: 'room-1' });
  await tick();
  assert.deepEqual(ju.of('team_workspace_ack').at(-1), { type: 'team_workspace_ack', ref_id: 'w1', ok: false, error: 'unsupported' });
});

test('cloud-web: team_workspace create on the real store (A #134) makes 工作区1 and answers', async () => {
  const hub2 = makeHub();
  const { store } = hub2;
  assert.deepEqual(store.rooms().filter(r => r.kind === 'workspace'), [], 'A no longer creates 工作区1 up front');
  const events = [];
  hub2.subscribe(e => events.push(e));
  const gw2 = new CloudWebGateway(hub2, { token: 't', logger: quiet });
  const ju2 = connect(gw2, 'bot=ju&name=橘');
  assert.equal(ju2.of('register_ack')[0].capabilities.includes('team_workspace'), true);
  ju2.frame({ type: 'team_workspace', ref_id: 'w2', op: 'list', session_key: 'cloud_web:room-1', reply_ctx: 'room-1' });
  await tick();
  assert.deepEqual(ju2.of('team_workspace_ack').at(-1), { type: 'team_workspace_ack', ref_id: 'w2', ok: true, self: { id: 'room-1', name: 'general' }, rooms: [] });
  ju2.frame({ type: 'team_workspace', ref_id: 'w3', op: 'create', reply_ctx: 'room-1' });
  await tick();
  const ack = ju2.of('team_workspace_ack').at(-1);
  assert.equal(ack.ok, true);
  assert.equal(ack.room.name, '工作区1');
  assert.ok(Number(ack.room.id.replace('room-', '')) >= 1000000, 'workspace ids start at 1000000');
  const w = store.room(Number(ack.room.id.replace('room-', '')));
  assert.equal(w.kind, 'workspace');
  assert.equal(w.parent_id, 1);
  assert.equal(events.at(-1).type, 'rooms');
  ju2.frame({ type: 'team_workspace', ref_id: 'w4', op: 'create', reply_ctx: 'room-1' });
  await tick();
  assert.equal(ju2.of('team_workspace_ack').at(-1).room.name, '工作区2');
  ju2.frame({ type: 'team_workspace', ref_id: 'w5', op: 'list', reply_ctx: 'room-1' });
  await tick();
  assert.deepEqual(ju2.of('team_workspace_ack').at(-1).rooms.map(r => r.name), ['工作区1', '工作区2']);
  // The list carries each workspace's parent; busy is the bridge's own count (#1662), not sent.
  assert.deepEqual(ju2.of('team_workspace_ack').at(-1).rooms.map(r => [r.name, r.parent_id, r.active]),
    [['工作区1', 'room-1', undefined], ['工作区2', 'room-1', undefined]]);
  // Another chat channel sees the whole pool, not only the workspaces it created.
  store.ensureRoom(2, 'dev');
  ju2.frame({ type: 'team_workspace', ref_id: 'w5b', op: 'list', reply_ctx: 'room-2' });
  await tick();
  assert.deepEqual(ju2.of('team_workspace_ack').at(-1).rooms.map(r => r.name), ['工作区1', '工作区2']);
  ju2.frame({ type: 'team_workspace', ref_id: 'w6', op: 'list', reply_ctx: 'room-9' });
  await tick();
  assert.equal(ju2.of('team_workspace_ack').at(-1).error, 'room-missing');
});

test('dispatch settings: migration distinguishes generated mixed rows and persists explicit mixed', () => {
  const s = new Store(':memory:');
  s.ensureRoom(1, 'general'); s.ensureRoom(2, 'other');
  s.dispatchMode(1); s.setDispatchMode(2, 'team');
  s.db.exec('ALTER TABLE room_settings DROP COLUMN dispatch_explicit; PRAGMA user_version = 9');
  s.ensureSchema();
  assert.deepEqual(s.dispatchSetting(1), { dispatch_mode: 'mixed', dispatch_explicit: false });
  assert.deepEqual(s.dispatchSetting(2), { dispatch_mode: 'team', dispatch_explicit: true });
  s.setDispatchMode(1, 'mixed');
  const ws = s.createWorkspace(1);
  s.ensureSchema();
  assert.deepEqual(s.dispatchSetting(ws.id), { dispatch_mode: 'mixed', dispatch_explicit: true });
  const hub = new Hub(s, quiet);
  const gateway = new CloudWebGateway(hub, quiet);
  assert.deepEqual(gateway.teamWorkspace({ op: 'dispatch_mode', reply_ctx: roomKey(ws.id) }), { ok: true, dispatch_mode: 'mixed', dispatch_explicit: true });
  s.close();
});

test('store: upgrading to single owner puts old workspaces with no task in work in the pool', async () => {
  const { mkdtempSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { tmpdir } = await import('node:os');
  const path = join(mkdtempSync(join(tmpdir(), 'collab-')), 'collab.sqlite3');
  const old = new Store(path);
  old.ensureRoom(1, 'general');
  old.ensureRoom(2, 'dev');
  const idle = old.createWorkspace(1);
  const busy = old.createWorkspace(1);
  old.db.prepare(`INSERT INTO tasks (room_id, title, owner, created_by, status, created_at, updated_at)
    VALUES (?, '旧活', 'ds', 'lead', ?, 1, 1)`).run(idle.id, 'done');
  old.db.prepare(`INSERT INTO tasks (room_id, title, owner, created_by, status, created_at, updated_at)
    VALUES (?, '还在做', 'ds', 'lead', ?, 1, 1)`).run(busy.id, 'accepted');
  // Shape before single owner: no free / claim_task / claim_bridge columns.
  for (const c of ['free', 'claim_task', 'claim_bridge']) old.db.exec(`ALTER TABLE rooms DROP COLUMN ${c}`);
  old.close();
  const s = new Store(path);
  assert.equal(s.workspaceOwner(idle.id), null, 'done before the upgrade: free');
  assert.throws(() => s.claimWorkspace(2, idle.id), e => e.code === 'workspace-owned', 'still general\'s (#762)');
  assert.equal(s.claimWorkspace(1, idle.id).parent_id, 1, 'general claims it again');
  assert.equal(s.workspaceOwner(busy.id), 1, 'a task still in work keeps its owner');
  assert.throws(() => s.claimWorkspace(2, busy.id), e => e.code === 'workspace-owned');
  s.close();
  const again = new Store(path); // the migration runs once: the claim stays
  assert.equal(again.workspaceOwner(idle.id), 1);
  again.close();
});

test('#144 attachments: stored on the message, shown publicly, forwarded to bots as images/files', async () => {
  const { mkdtempSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { Attachments } = await import('./attachments.mjs');
  const { publicMessage: pm } = await import('./store.mjs');
  const files = new Attachments(join(mkdtempSync(join(tmpdir(), 'collab-att-')), 'attachments'));
  const hub = makeHub();
  const gw = new CloudWebGateway(hub, { token: 't', logger: quiet, files });
  const ju = connect(gw, 'bot=ju&name=橘');
  await settle();

  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
  const attachments = files.save([
    { name: 'shot.png', mime: 'image/png', data: png.toString('base64') },
    { name: 'run.log', mime: 'text/plain', data: Buffer.from('boom').toString('base64') },
  ]);
  assert.equal(attachments.length, 2);
  assert.deepEqual(files.read(attachments[0].id), png);
  assert.equal(files.read('../etc/passwd'), undefined);

  // A message may carry only attachments.
  const { message } = hub.post(1, { authorKind: 'user', author: 'owner', name: '我', text: '', attachments });
  const view = publicMessage(message, hub.store);
  assert.deepEqual(view.attachments.map(a => [a.name, a.mime, a.size]), [['shot.png', 'image/png', 4], ['run.log', 'text/plain', 4]]);
  assert.equal(hub.store.attachmentMeta(attachments[1].id).name, 'run.log');
  assert.equal(hub.store.attachmentMeta('00000000-0000-0000-0000-000000000000'), undefined);

  await settle();
  const frame = ju.of('message').at(-1);
  assert.deepEqual(frame.images, [{ mime_type: 'image/png', data: png.toString('base64'), file_name: 'shot.png' }]);
  assert.deepEqual(frame.files, [{ mime_type: 'text/plain', data: Buffer.from('boom').toString('base64'), file_name: 'run.log' }]);

  assert.throws(() => files.save([{ name: 'x', mime: 'text/plain', data: '' }]), /empty/);
  assert.throws(() => hub.post(1, { authorKind: 'user', author: 'owner', name: '我', text: '' }), /empty/);
});

test('#144 attachments: only png/jpeg/gif/webp up to 5 MB go to bots as images, the rest as files', async () => {
  const { mkdtempSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { Attachments, MAX_IMAGE_BYTES } = await import('./attachments.mjs');
  const files = new Attachments(join(mkdtempSync(join(tmpdir(), 'collab-att-')), 'attachments'));
  const b64 = (buf) => buf.toString('base64');
  const saved = files.save([
    { name: 'a.png', mime: 'image/png', data: b64(Buffer.from('png')) },
    { name: 'b.svg', mime: 'image/svg+xml', data: b64(Buffer.from('<svg/>')) },
    { name: 'c.heic', mime: 'image/heic', data: b64(Buffer.from('heic')) },
    { name: 'd.jpg', mime: 'image/jpeg', data: b64(Buffer.alloc(MAX_IMAGE_BYTES + 1, 1)) },
  ]);
  const wire = files.wire(saved);
  assert.deepEqual(wire.images.map(i => i.file_name), ['a.png']);
  assert.deepEqual(wire.files.map(f => f.file_name), ['b.svg', 'c.heic', 'd.jpg']);
});

test('bot image/file/audio frames become channel attachments; media capabilities need a store', async () => {
  const { mkdtempSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { Attachments } = await import('./attachments.mjs');
  const { publicMessage: pm } = await import('./store.mjs');
  const { MEDIA_CAPABILITIES, audioMime } = await import('./cloudweb.mjs');
  const files = new Attachments(join(mkdtempSync(join(tmpdir(), 'collab-media-')), 'attachments'));
  const hub = makeHub();
  const gw = new CloudWebGateway(hub, { token: 't', logger: quiet, files });
  const ju = connect(gw, 'bot=ju&name=橘');
  await settle();
  for (const cap of MEDIA_CAPABILITIES) assert.ok(ju.of('register_ack')[0].capabilities.includes(cap), cap);
  const plain = connect(new CloudWebGateway(makeHub(), { token: 't', logger: quiet }), 'bot=ju&name=橘');
  await settle();
  assert.ok(!plain.of('register_ack')[0].capabilities.includes('image'));

  const b64 = (s) => Buffer.from(s).toString('base64');
  const at = { session_key: 'cloud_web:room-1', reply_ctx: 'room-1' };
  ju.frame({ type: 'image', ...at, data: b64('png'), mime_type: 'image/png', file_name: 'chart.png' });
  ju.frame({ type: 'file', ...at, data: b64('report'), mime_type: 'application/pdf', file_name: 'report.pdf' });
  ju.frame({ type: 'audio', ...at, data: b64('mp3'), format: 'mp3' });
  ju.frame({ type: 'image', ...at, data: '' });
  ju.frame({ type: 'file', session_key: 'cloud_web:room-99', data: b64('x'), file_name: 'lost.txt' });
  await settle();

  const rows = hub.store.page(1, undefined, 10).map(r => publicMessage(r, hub.store));
  assert.equal(rows.length, 3);
  assert.ok(rows.every(r => r.author === 'ju' && r.text === ''));
  assert.deepEqual(rows.map(r => r.attachments.map(a => [a.name, a.mime])), [
    [['chart.png', 'image/png']], [['report.pdf', 'application/pdf']], [['voice.mp3', 'audio/mpeg']],
  ]);
  assert.equal(files.read(rows[2].attachments[0].id).toString(), 'mp3');
  assert.equal(audioMime('ogg'), 'audio/ogg');
  assert.equal(audioMime('opus'), 'audio/ogg');
  assert.equal(audioMime(''), 'audio/mpeg');
});

test('bot websocket cap fits a default 50 MiB cc-connect attachment; a 7 MiB file frame is stored', async () => {
  const { mkdtempSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { Attachments } = await import('./attachments.mjs');
  const { publicMessage: pm } = await import('./store.mjs');
  const { BOT_WS_MAX_PAYLOAD } = await import('./plugin.mjs');
  const frameFor = (n) => JSON.stringify({ type: 'file', session_key: 'cloud_web:room-1', reply_ctx: 'room-1',
    data: Buffer.alloc(n).toString('base64'), mime_type: 'application/octet-stream', file_name: 'big.bin' });
  assert.ok(Buffer.byteLength(frameFor(50 * 1024 * 1024)) <= BOT_WS_MAX_PAYLOAD);

  const files = new Attachments(join(mkdtempSync(join(tmpdir(), 'collab-big-')), 'attachments'));
  const hub = makeHub();
  const ju = connect(new CloudWebGateway(hub, { token: 't', logger: quiet, files }), 'bot=ju&name=橘');
  await settle();
  const big = Buffer.alloc(7 * 1024 * 1024, 7);
  ju.frame({ type: 'file', session_key: 'cloud_web:room-1', reply_ctx: 'room-1', data: big.toString('base64'),
    mime_type: 'application/octet-stream', file_name: 'big.bin' });
  await settle();
  const [row] = hub.store.page(1, undefined, 10).map(r => publicMessage(r, hub.store));
  assert.deepEqual(row.attachments.map(a => [a.name, a.size]), [['big.bin', big.length]]);
  assert.ok(files.read(row.attachments[0].id).equals(big));
});

test('attachment download: 200 without Range, 206 for byte ranges, 416 out of range', async () => {
  const { createServer } = await import('node:http');
  const { sendAttachment, parseRange } = await import('./plugin.mjs');
  const bytes = Buffer.from('0123456789');
  const server = createServer((req, res) => sendAttachment(req, res, { mime: 'audio/mpeg', name: 'voice.mp3' }, bytes));
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const get = (range) => fetch(`http://127.0.0.1:${server.address().port}/`, range === undefined ? {} : { headers: { range } });
  try {
    const all = await get();
    assert.equal(all.status, 200);
    assert.equal(all.headers.get('accept-ranges'), 'bytes');
    assert.equal(all.headers.get('content-length'), '10');
    assert.equal(all.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(await all.text(), '0123456789');
    for (const [range, body, cr] of [['bytes=2-4', '234', 'bytes 2-4/10'], ['bytes=7-', '789', 'bytes 7-9/10'],
      ['bytes=-3', '789', 'bytes 7-9/10'], ['bytes=0-99', '0123456789', 'bytes 0-9/10'], ['bytes=0-1', '01', 'bytes 0-1/10']]) {
      const res = await get(range);
      assert.equal(res.status, 206, range);
      assert.equal(res.headers.get('content-range'), cr, range);
      assert.equal(res.headers.get('content-length'), String(body.length), range);
      assert.equal(res.headers.get('accept-ranges'), 'bytes', range);
      assert.equal(await res.text(), body, range);
    }
    for (const range of ['bytes=10-', 'bytes=99-120', 'bytes=-0']) {
      const res = await get(range);
      assert.equal(res.status, 416, range);
      assert.equal(res.headers.get('content-range'), 'bytes */10', range);
      await res.arrayBuffer();
    }
    assert.equal((await get('items=0-1')).status, 200);
    assert.equal(parseRange('bytes=0-1,4-5', 10), undefined);
  } finally { server.close(); }
});

test('#144 oversized POST body gets a 413 response instead of a dropped connection', async () => {
  const { createServer } = await import('node:http');
  const { withBody } = await import('./plugin.mjs');
  const server = createServer((req, res) => { withBody(req, res, async () => ({ ok: true }), true, 1024); });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/`, { method: 'POST', body: 'x'.repeat(256 * 1024) });
    assert.equal(res.status, 413);
    assert.equal((await res.json()).code, 'too-large');
  } finally { server.close(); }
});

test('#148 editing a reply keeps its quote for the edit response and the browser event', async () => {
  const hub = makeHub();
  const gw = new CloudWebGateway(hub, { token: 't', logger: quiet });
  const events = [];
  hub.subscribe(e => events.push(e));
  const call = route(hub, gw, { recall: () => [] });
  const { message: quoted } = hub.post(1, { authorKind: 'role', author: 'ju', name: '橘', text: '原话' });
  const { message: reply } = hub.post(1, { authorKind: 'user', author: 'owner', name: '我', text: '回一句', replyTo: quoted.id });
  const ok = await call('PATCH', `/collab/api/messages/${reply.id}`, { text: '改过的回复' });
  assert.equal(ok.status, 200);
  assert.equal(ok.json.message.reply_to?.id, quoted.id, 'the edited reply still quotes its message');
  assert.equal(events.at(-1).message.reply_to?.id, quoted.id);
});

test('#148 owner edits own message: text and edited_at change, others and cards are refused, browsers told', async () => {
  const hub = makeHub();
  const gw = new CloudWebGateway(hub, { token: 't', logger: quiet });
  const events = [];
  hub.subscribe(e => events.push(e));
  const call = route(hub, gw, { recall: () => [] });
  const { message: mine } = hub.post(1, { authorKind: 'user', author: 'owner', name: '我', text: '打错字了' });
  const { message: bot } = hub.post(1, { authorKind: 'role', author: 'ju', name: '橘', text: '收到' });
  const ok = await call('PATCH', `/collab/api/messages/${mine.id}`, { text: '改好了' });
  assert.equal(ok.status, 200);
  assert.equal(ok.json.message.text, '改好了');
  assert.equal(typeof ok.json.message.edited_at, 'number');
  assert.equal(hub.store.message(mine.id).text, '改好了');
  assert.equal(events.at(-1).type, 'message');
  assert.equal(events.at(-1).message.edited_at, ok.json.message.edited_at);
  assert.equal((await call('PATCH', `/collab/api/messages/${bot.id}`, { text: 'x' })).status, 403, 'not the owner\'s message');
  assert.equal(hub.store.message(bot.id).text, '收到');
  assert.equal((await call('PATCH', `/collab/api/messages/${mine.id}`, { text: '  ' })).status, 400, 'empty text');
  assert.equal((await call('PATCH', '/collab/api/messages/999', { text: 'x' })).status, 403);
  assert.equal(hub.store.page(1).find(m => m.id === bot.id).edited_at, null, 'an unedited row has no edited_at');
});

test('channel page (#123): grouped messages keep the avatar column and the empty placeholder is cleared', async () => {
  const { readFile } = await import('node:fs/promises');
  const page = await readFile(new URL('./page.html', import.meta.url), 'utf8');
  assert.match(page, /\.msg\.cont \.avatar \{ visibility: hidden; \}/, 'hiding the avatar must keep its grid slot');
  assert.match(page, /\.msg > :not\(\.avatar\) \{ grid-column: 2; min-width: 0; \}/, 'the message column stays in column 2');
  assert.match(page, /log\.querySelector\('\.state\.empty'\)\?\.remove\(\)/, 'the first message takes the empty placeholder down');
});

function route(hub, gateway, dsh) {
  return async (method, path, body) => {
    const req = new EventEmitter();
    req.method = method; req.url = path; req.headers = {};
    const res = { status: 0, body: '', writeHead(s) { this.status = s; }, end(b) { this.body = b; } };
    const p = ownMessageRoute(req, res, path, { store: hub.store, hub, gateway, dsh });
    if (body !== undefined) req.emit('data', Buffer.from(JSON.stringify(body)));
    req.emit('end');
    await p;
    return { status: res.status, json: JSON.parse(res.body) };
  };
}

const PRESET_POLICY = { default: 'ask', auto: 'ask', 'full-access': 'never' };
function askTool(dsh, members, agent, { preset = 'default', command = 'rm -rf build', signal, displayReason } = {}) {
  const callId = `call-${agent.session.events.length}`;
  dsh.emit(agent, 'tool/call', { turn: agent.turns, callId, name: 'bash', arguments: JSON.stringify({ command }) });
  const ran = [];
  const runTool = (outcome) => {
    if (outcome === 'allowed-once') ran.push(command);
    dsh.emit(agent, 'tool/result', { turn: agent.turns, message: { toolCallId: callId, isError: outcome !== 'allowed-once' } });
    return outcome;
  };
  if (PRESET_POLICY[preset] === 'never') return { ran, outcome: Promise.resolve(runTool('rejected')) };
  let fellThrough = false;
  const outcome = members.onApprovalRequest(
    { agent, toolName: 'bash', callId, reason: 'command needs to run outside the sandbox', displayReason, signal },
    () => { fellThrough = true; return Promise.resolve('unavailable'); },
  ).then(runTool);
  return { ran, outcome, fellThrough: () => fellThrough };
}
/**
 * Waits for a card's outcome, failing instead of hanging when no decision ever
 * comes (a lost signal, allowAll or expiry would otherwise leave the test pending).
 */
function decided(outcome, ms = 2000) {
  let timer;
  const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`no approval outcome within ${ms} ms`)), ms); });
  return Promise.race([outcome, timeout]).finally(() => clearTimeout(timer));
}

const cardsIn = (hub, room) => hub.store.page(room, undefined, 50).filter(m => m.card !== null && JSON.parse(m.card).kind === 'permission');
const cardState = (hub, id) => JSON.parse(hub.store.message(id).card).state;

/** @ the member in `room`, open the turn that takes the input, and return its agent. */
async function openTurn(hub, dsh, room, text = '@DeepSeek 清理一下') {
  hub.post(room, { authorKind: 'user', author: 'owner', name: '我', text });
  await settle();
  const agent = dsh.sessions.get(hub.store.binding('ds', room).session_id);
  dsh.turn(agent, [], null);
  return agent;
}

const scriptPath = url => fileURLToPath(url);

function createHmacForTest(key, payload) { return createHmacTest('sha256', key).update(payload).digest('base64url'); }

// CLI member tool approval follows the member's DSH permission preset (cli-member.mjs presetDecision).
const ACP_PERMISSION = {
  sessionId: 's1',
  toolCall: { toolCallId: 't1', title: 'Bash', rawInput: { command: 'rm -rf build' } },
  options: [{ optionId: 'allow-once', name: 'Allow once', kind: 'allow_once' }, { optionId: 'reject-once', name: 'Reject', kind: 'reject_once' }],
};

const permCards = hub => hub.store.page(1, undefined, 20).filter(m => m.card !== null && JSON.parse(m.card).kind === 'permission');

test('attachments: undelivered reasons are shown in Chinese by DSH error code, unknown ones stay as-is', async () => {
  const { undeliveredReasonZh } = await import('./attachments.mjs');
  assert.equal(undeliveredReasonZh({ reason: 'whatever', code: 'IMAGE_TOO_MANY_PIXELS' }), '图片太大，超过像素上限');
  assert.equal(undeliveredReasonZh({ reason: 'Image exceeds the configured byte limit.' }), '图片文件太大，超过大小上限');
  assert.equal(undeliveredReasonZh({ reason: 'Unsupported or malformed image data.', code: 'INVALID_IMAGE' }), '图片格式不支持或已损坏');
  assert.equal(undeliveredReasonZh({ reason: 'Image exceeds the configured per-side pixel limit.' }), '图片太长或太宽，超过单边像素上限');
  assert.equal(undeliveredReasonZh({ reason: 'something new' }), 'something new');
});

async function fakeGate(handler) {
  const { createServer } = await import('node:http');
  const calls = [];
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      calls.push({ path: req.url, body: JSON.parse(body || '{}') });
      const out = handler(calls.at(-1));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(out));
    });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  return { calls, port: server.address().port, close: () => new Promise(r => server.close(r)) };
}
const until = async (f) => { for (let i = 0; i < 400 && !f(); i++) await new Promise(r => setTimeout(r, 5)); };
const BOARD = { path: '【任务板 abc123】', desc: '谁手上有哪件事、做在哪\n#7 修登录 · 龙娘' };

const R12_REPORT = '副，返工完成得很好！\n\n幂运算功能已验收通过：\n- pow 函数实现正确，支持正数、负数和浮点数运算\n- 测试覆盖完整（27个用例全过）\n- README 文档已更新\n\n做得不错，继续保持。\n\n——主·松针';
test('channel directories: configuration rejects relative paths and accepts empty overrides', () => {
  const base = { dataDir: '/d', workspacePath: '/w' };
  for (const workspacePath of [null, '', '/channel']) {
    assert.doesNotThrow(() => resolveConfig({ ...base, rooms: [{ id: 1, name: 'general', workspacePath }] }));
  }
  for (const workspacePath of ['relative', 42, {}]) {
    assert.throws(() => resolveConfig({ ...base, rooms: [{ id: 1, name: 'general', workspacePath }] }), /workspacePath/);
  }
});


test('channel bots: same-channel name overlaps are refused, cross-channel names coexist, disconnect marks offline', async () => {
  const hub = makeHub(); hub.store.ensureRoom(2, 'office');
  hub.setMember({ id: 'agent', name: 'Shared', kind: 'dsh', rooms: [1] });
  const gateway = new CloudWebGateway(hub, { token: 't', logger: quiet });
  const refused = connect(gateway, 'bot=bad&name=Shared&room=1');
  assert.equal(refused.of('register_ack')[0].ok, false);
  const office = connect(gateway, 'bot=office&name=Shared&room=2');
  assert.equal(office.of('register_ack')[0].ok, true);
  const game = connect(gateway, 'bot=game&name=QQ&room=1');
  const officeQQ = connect(gateway, 'bot=officeqq&name=QQ&room=2');
  assert.equal(game.of('register_ack')[0].ok, true);
  assert.equal(officeQQ.of('register_ack')[0].ok, true);
  hub.post(1, { authorKind: 'user', author: 'owner', name: 'Owner', text: '@QQ hello' });
  await tick();
  assert.equal(game.of('message').length, 1);
  assert.equal(officeQQ.of('message').length, 0);
  assert.equal(office.of('message').length, 0);
  officeQQ.close(1000);
  assert.equal(hub.members.get('officeqq').online, false);
  assert.deepEqual(hub.members.get('officeqq').rooms, [2], 'disconnect retains channel membership');
  gateway.closeAll(); hub.store.close();
});


test('member scope migration: legacy scope is global even before any channels exist', () => {
  const store = new Store(':memory:');
  assert.equal(store.migrateMemberRooms(), false);
  store.addMember({ id: 'old', name: 'Old' });
  store.db.prepare('UPDATE members SET rooms = NULL WHERE id = ?').run('old');
  assert.equal(store.migrateMemberRooms(), true);
  assert.deepEqual(JSON.parse(store.member('old').rooms), []);
  assert.equal(store.migrateMemberRooms(), false);
  store.close();
});

// A delegated review is an authorization for the returned task, not unrelated work.
test('cloud-web: a restarted bridge leaves no progress card stuck at 处理中 (#913)', async () => {
  const hub = makeHub();
  const gw = new CloudWebGateway(hub, { token: 't', logger: quiet });
  const card = (state, text) => PROGRESS_PREFIX + JSON.stringify({
    agent: 'CC', state, steps: 1, elapsed_sec: 7, items: [{ kind: 'tool_use', tool: 'Bash', text }],
  });

  const first = connect(gw, 'bot=fish&name=%E6%B5%8B%E8%AF%95%E9%B1%BC&mention_id=9001');
  // A turn still running when the bridge process dies: its card is a draft nobody will close.
  first.frame({ type: 'preview_start', ref_id: 'p1', session_key: 'cloud_web:room-1', reply_ctx: 'room-1', content: card('running', 'seq 1 20') });
  await tick();
  const running = Number(first.of('preview_ack').at(-1).preview_handle);
  // A card of an earlier, finished turn: reconnect must leave it alone.
  first.frame({ type: 'preview_start', ref_id: 'p0', session_key: 'cloud_web:room-1', reply_ctx: 'room-1', content: card('completed', 'seq 1 5') });
  await tick();
  const done = Number(first.of('preview_ack').at(-1).preview_handle);
  assert.equal(JSON.parse(hub.store.message(running).card).state, 'running');
  assert.equal(JSON.parse(hub.store.message(done).card).state, 'completed');
  assert.equal(hub.store.message(running).draft, 1);

  // Same bot reconnects — a restarted cc-connect, holding no handle on the old row.
  const second = connect(gw, 'bot=fish&name=%E6%B5%8B%E8%AF%95%E9%B1%BC&mention_id=9001');
  await tick();

  const closed = hub.store.message(running);
  assert.equal(JSON.parse(closed.card).state, 'cancelled', 'stale running card is closed');
  assert.equal(JSON.parse(closed.card).title, 'CC · 已取消');
  assert.deepEqual(JSON.parse(closed.card).chips, [{ tool: 'Bash', state: 'unknown', input: 'seq 1 20' }], 'an open step of a cut turn is no longer running');
  assert.match(closed.text, /seq 1 20/, 'the steps stay readable');
  assert.match(closed.text, /已中断/);
  assert.equal(JSON.parse(hub.store.message(done).card).state, 'completed', 'a finished card is not rewritten');

  // The resumed turn's own card is untouched by its registration: it is posted after, and
  // a card the new process reopens by its own handle goes back to 处理中.
  second.frame({ type: 'preview_start', ref_id: 'p2', session_key: 'cloud_web:room-1', reply_ctx: 'room-1', content: card('running', 'seq 1 30') });
  await tick();
  const fresh = Number(second.of('preview_ack').at(-1).preview_handle);
  assert.equal(JSON.parse(hub.store.message(fresh).card).state, 'running');
});

test('cloud-web: a permission card a hub restart left pending expires when its bot reconnects (#1017)', async () => {
  const hub = makeHub();
  const gw = new CloudWebGateway(hub, { token: 't', logger: quiet });
  const prompt = { type: 'buttons', reply_ctx: 'room-1', session_key: 'cloud_web:room-1', content: '要运行 npm ci',
    buttons: [[{ Text: '允许', Data: 'perm:allow' }, { Text: '拒绝', Data: 'perm:deny' }]] };
  const first = connect(gw, 'bot=fish&name=%E6%B5%8B%E8%AF%95%E9%B1%BC&mention_id=9001');
  first.frame(prompt);
  await tick();
  const orphan = cardsIn(hub, 1)[0].id;
  // The hub restarted: the card row is still pending, the in-memory request is gone.
  hub.approvals.pending.clear();

  const second = connect(gw, 'bot=fish&name=%E6%B5%8B%E8%AF%95%E9%B1%BC&mention_id=9001');
  await tick();
  assert.equal(JSON.parse(hub.store.message(orphan).card).state, 'expired', 'the orphan no longer waits for a click');

  // The reconnected bot asks again: one pending card, not the same request shown twice.
  second.frame(prompt);
  await tick();
  const pending = cardsIn(hub, 1).filter(m => JSON.parse(m.card).state === 'pending');
  assert.equal(pending.length, 1);
});

test('cloud-web: a running card is closed even when the room moved far past the first page (#913)', async () => {
  const hub = makeHub();
  const gw = new CloudWebGateway(hub, { token: 't', logger: quiet });
  const card = PROGRESS_PREFIX + JSON.stringify({
    agent: 'CC', state: 'running', steps: 1, elapsed_sec: 7, items: [{ kind: 'tool_use', tool: 'Bash', text: 'seq 1 20' }],
  });

  const first = connect(gw, 'bot=fish&name=%E6%B5%8B%E8%AF%95%E9%B1%BC&mention_id=9001');
  first.frame({ type: 'preview_start', ref_id: 'p1', session_key: 'cloud_web:room-1', reply_ctx: 'room-1', content: card });
  await tick();
  const running = Number(first.of('preview_ack').at(-1).preview_handle);

  // A busy channel: the card is now older than any page of history the web UI would load.
  for (let i = 0; i < 120; i++) hub.post(1, { authorKind: 'user', author: 'owner', name: '我', text: `filler ${i}` });
  assert.equal(hub.store.page(1, undefined, 100).some(r => r.id === running), false, 'the card is outside the first page');

  connect(gw, 'bot=fish&name=%E6%B5%8B%E8%AF%95%E9%B1%BC&mention_id=9001');
  await tick();

  const closed = hub.store.message(running);
  assert.equal(JSON.parse(closed.card).state, 'cancelled', 'an old running card is still closed');
  assert.equal(JSON.parse(closed.card).title, 'CC · 已取消');
  assert.match(closed.text, /seq 1 20/);
  assert.match(closed.text, /已中断/);
});

test('#1020 queue: a bridge bot reports the messages waiting behind its turn; going offline clears them', async () => {
  const hub = makeHub();
  const gw = new CloudWebGateway(hub, { token: 't', logger: quiet });
  const events = [];
  hub.subscribe(e => { if (e.type === 'queue') events.push(e); });
  const ju = connect(gw, 'bot=ju&name=橘&token=t');
  assert.ok(ju.of('register_ack')[0].capabilities.includes('queue'));
  const a = hub.post(1, { authorKind: 'user', author: 'owner', name: '我', text: '@橘 一' }).message;
  const b = hub.post(1, { authorKind: 'user', author: 'owner', name: '我', text: '@橘 二' }).message;
  ju.frame({ type: 'queue', session_key: 'cloud-web:room-1:owner', reply_ctx: 'room-1', msg_ids: [`hub-${a.id}`, `hub-${b.id}`] });
  assert.deepEqual(hub.queueView(1), { ju: [a.id, b.id] });
  ju.frame({ type: 'queue', session_key: 'cloud-web:room-1:owner', reply_ctx: 'room-1', msg_ids: [`hub-${a.id}`, `hub-${b.id}`] });
  assert.equal(events.length, 1, 'an unchanged queue is not re-sent');
  ju.frame({ type: 'queue', reply_ctx: 'room-1', msg_ids: [] });
  assert.deepEqual(hub.queueView(1), {});
  ju.frame({ type: 'queue', reply_ctx: 'room-1', msg_ids: [`hub-${b.id}`] });
  ju.close(1000);
  assert.deepEqual(hub.queueView(1), {}, 'an offline bot has no queue');
});

test('#155: a closed private chat leaves the room list, keeps its history, and openDm brings it back', () => {
  const store = new Store(':memory:');
  store.addMember({ id: 'm-a', name: 'A' });
  const dm = store.openDm('m-a', 'A');
  store.append(dm.id, { authorKind: 'user', author: 'owner', name: 'Owner', text: 'hi' });
  assert.ok(store.roomsView().some(r => r.id === dm.id));
  store.closeDm(dm.id);
  assert.equal(store.roomsView().some(r => r.id === dm.id), false);
  assert.throws(() => store.closeDm(store.createRoom('general').id), /not a private chat/);
  const again = store.openDm('m-a', 'A');
  assert.equal(again.id, dm.id);
  assert.ok(store.roomsView().some(r => r.id === dm.id));
  assert.equal(store.page(dm.id).length, 1);
});

test('#155: a removed member\'s private chat is left out; a member without a stored row keeps its chat', () => {
  const store = new Store(':memory:');
  store.addMember({ id: 'm-gone', name: 'Gone' });
  const gone = store.openDm('m-gone', 'Gone');
  const bridge = store.openDm('cjiang', 'C酱'); // bridge roles join over cloud_web and have no members row
  store.removeMember('m-gone');
  const ids = store.roomsView().map(r => r.id);
  assert.equal(ids.includes(gone.id), false);
  assert.ok(ids.includes(bridge.id));
});

