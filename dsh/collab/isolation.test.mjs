import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { EventEmitter } from 'node:events';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from './store.mjs';
import { Hub } from './hub.mjs';
import { CloudWebGateway } from './cloudweb.mjs';
import { DshMembers } from './dsh-member.mjs';
import { Roster } from './roster.mjs';
import { resolveConfig, historyRoute, browserRoute, seedRooms, apply } from './plugin.mjs';

const quiet = { warn() {}, info() {} };
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; let reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };

class Socket extends EventEmitter {
  sent = [];
  send(data) { this.sent.push(JSON.parse(data)); }
  close(code) { this.code = code; this.emit('close'); }
  frame(frame) { this.emit('message', JSON.stringify(frame), false); }
  of(type) { return this.sent.filter(f => f.type === type); }
}
function connect(gateway, secret = 'secret', query = '', project = 'unrelated-project') {
  const ws = new Socket();
  gateway.accept(ws, new URL('http://local/cloud-web/ws?' + query), secret === null ? {} : { authorization: 'Bearer ' + secret });
  ws.frame({ type: 'register', project });
  return ws;
}
function fixture(t) {
  const store = new Store(':memory:');
  store.ensureRoom(1, 'public'); store.ensureRoom(2, 'SECRET-ROOM'); store.setVisibility(2, 'private');
  const hub = new Hub(store, quiet);
  hub.setMember({ id: 'owner', name: 'Owner', kind: 'human', online: true });
  const gateway = new CloudWebGateway(hub, { token: 'shared', tokens: new Map([['secret', 'bot'], ['other-secret', 'other']]), logger: quiet });
  t.after(async () => { await hub.runtime?.members.close(); gateway.closeAll(); store.close(); });
  return { store, hub, gateway };
}

// Controllable host boundaries. No model, shell tools, real credentials or sleeps.
function runtime(hub, configs = [{ id: 'ds', name: 'DeepSeek' }]) {
  const agents = new Map(); const gates = {}; const entered = {}; const paths = []; const prompts = [];
  let next = 0; let members;
  const wait = async point => { entered[point]?.resolve(); if (gates[point]) await gates[point].promise; };
  const agentFor = (id, meta) => {
    const events = []; const inbox = [];
    const session = { id, events, get seq() { return events.length; }, snapshotEvents(from = 0) { return events.slice(from); }, requestHeader() {} };
    const agent = { session, meta, ctx: { on() {} }, prompts: [], cancellations: [],
      followup(input) { this.prompts.push(input); prompts.push(input); inbox.push(input); },
      inbox: { nextTurn: inbox, remove(id) { const index = inbox.findIndex(m => m.id === id); if (index < 0) return false; inbox.splice(index, 1); return true; } },
      cancel(...args) { this.cancellations.push(args); }, async whenIdle() {},
    };
    agents.set(id, agent); return agent;
  };
  const ctx = {
    agents: { get: id => agents.get(id), resumes: 0,
      async create({ sessionId, meta }) { const agent = agentFor(sessionId, meta); await wait('create'); return { agent }; },
      async resume() { this.resumes++; throw Error('unsafe resume must never execute'); },
    },
    agentDefaultModel: { currentSelection: () => ({ provider: 'fake', model: 'fake' }) },
    agentPresets: { async resolve() { await wait('preset'); return { id: 'default' }; }, async acquireScope() { return { async [Symbol.asyncDispose]() {} }; }, async mount() {} },
    permissionPresets: { set() {} }, sessionTitle: { rename() {} },
    workspaceRegistry: { async create(path) { paths.push(path); await wait('workspace'); return { path, async attachSession() { await wait('attach'); } }; } },
  };
  members = new DshMembers(hub, { ctx, workspacePath: '/isolated', logger: quiet, createUserMessage: value => ({ ...value, id: 'input-' + ++next }) }, configs);
  const rt = { agents, ctx, paths, prompts, members, agentFor,
    pause(point) { gates[point] = deferred(); entered[point] = deferred(); return { entered: entered[point].promise, release: () => gates[point].resolve() }; },
    emit(agent, type, data) { const event = { type, data, seq: agent.session.seq + 1 }; agent.session.events.push(event); members.onSessionEvent(agent.session, event); },
    async drain() { await tick(); await tick(); },
  };
  hub.runtime = rt; return rt;
}
const post = (hub, room = 2, text = '@DeepSeek SECRET-CONTENT') => hub.post(room, { authorKind: 'user', author: 'owner', name: 'Owner', text });
const grant = (store, id = 'ds', room = 2) => store.addRoomMember(room, id);
const revoke = (store, members, id = 'ds', room = 2) => {
  store.transaction(() => { store.removeRoomMember(room, id); members.fenceRoom(room); });
  members.reconcileRoom(room);
};
async function http(t, handler) {
  const server = createServer((req, res) => Promise.resolve(handler(req, res)).catch(error => { if (!res.headersSent) res.writeHead(500); res.end(error.message); }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  return 'http://127.0.0.1:' + server.address().port;
}
async function ownerApi(t, f) {
  const rt = f.hub.runtime ?? runtime(f.hub); const roster = new Roster(f.hub, rt.members);
  const owner = req => req.headers['x-owner'] === 'yes';
  const base = await http(t, (req, res) => browserRoute(req, res, { ...f, dsh: rt.members, roster, owner, ownerName: 'Owner', events: (_req, res) => { res.writeHead(200); res.end('owner-events'); } }));
  const call = (method, path, body, auth = 'owner') => fetch(base + '/collab/api/' + path, { method, headers: { 'content-type': 'application/json', ...(auth === 'owner' ? { 'x-owner': 'yes' } : auth === 'none' ? {} : { authorization: 'Bearer ' + auth }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { call, base, rt };
}

test('identity: config/env reject reserved ids, collisions and ambiguous secrets', () => {
  const base = { dataDir: '/data', workspacePath: '/work' };
  for (const id of ['owner', 'user', 'system', 'Grok', '../etc']) {
    assert.throws(() => resolveConfig({ ...base, botTokens: { [id]: 'SECRET-VALUE' } }, {}), /id/i);
    assert.throws(() => resolveConfig(base, { CONEST_COLLAB_BOT_TOKENS: id + ':SECRET-VALUE' }), /id/i);
    assert.throws(() => resolveConfig({ ...base, dshMembers: [{ id, name: 'x' }] }, {}));
  }
  for (const config of [{ botTokens: { a: 'same', b: 'same' } }, { botTokens: { ds: 'secret' }, dshMembers: [{ id: 'ds', name: 'DS' }] }]) assert.throws(() => resolveConfig({ ...base, ...config }, {}), /credential|secret|collision/i);
  assert.throws(() => resolveConfig({ ...base, botTokens: { a: 'shared' } }, { CONEST_COLLAB_BOT_TOKEN: 'shared' }), /credential/i);
  assert.throws(() => resolveConfig(base, { CONEST_COLLAB_BOT_TOKENS: 'a:secret,a:other' }), /identity/i);
  assert.throws(() => resolveConfig(base, { CONEST_COLLAB_BOT_TOKENS: 'SECRET-VALUE' }), error => !error.message.includes('SECRET-VALUE'));
  assert.deepEqual([...resolveConfig({ ...base, botTokens: { a: 'old' } }, { CONEST_COLLAB_BOT_TOKENS: 'a:new' }).botTokens], [['new', 'a']]);
});
test('identity: persisted roster and runtime cannot collide with offline dedicated bots', t => {
  const { hub, store } = fixture(t); const rt = runtime(hub); const roster = new Roster(hub, rt.members);
  assert.equal(roster.newId('bot').startsWith('m-'), true);
  for (const id of ['owner', 'user', 'system', 'bot']) {
    assert.throws(() => rt.members.putMember({ id, name: 'x' }), /id|collision/i);
    assert.throws(() => store.addMember({ id, name: 'x' }), /id|collision/i);
  }
  store.db.prepare("INSERT INTO members (id, name, persona, source, created_at, removed) VALUES ('bot', 'old', '', 'ui', 0, 0)").run();
  assert.throws(() => roster.load([]), /collision/i);
});
test('identity: WS token fixes identity; project is not identity; shared cannot take over', t => {
  const { hub, gateway } = fixture(t); const real = connect(gateway, 'secret', '', 'owner');
  assert.equal(real.of('register_ack')[0].ok, true); assert.equal(hub.members.get('bot').kind, 'bot');
  for (const secret of ['shared', 'wrong', null]) { const ws = connect(gateway, secret, 'bot=bot'); assert.equal(ws.of('register_ack')[0].ok, false); assert.equal(real.code, undefined); }
  for (const id of ['other', 'owner', 'system', 'user']) assert.equal(connect(gateway, 'secret', 'bot=' + id).of('register_ack')[0].ok, false);
  const replacement = connect(gateway, 'secret', 'bot=bot'); assert.equal(replacement.of('register_ack')[0].ok, true); assert.equal(real.code, 4003);
});
test('history HTTP: production handler enforces headers, private ACL and immediate revoke', async t => {
  const f = fixture(t); post(f.hub);
  const base = await http(t, (req, res) => historyRoute(req, res, { ...f, owner: req => req.headers['x-owner'] === 'yes' }));
  const get = (room, secret, suffix = '') => fetch(base + '/api/rooms/' + room + '/messages' + suffix, { headers: secret === 'owner' ? { 'x-owner': 'yes' } : secret ? { authorization: 'Bearer ' + secret } : {} });
  for (const secret of ['secret', 'shared']) { const response = await get(2, secret); assert.equal(response.status, 403); assert.doesNotMatch(await response.text(), /SECRET/); }
  assert.equal((await get(2, null)).status, 401); assert.equal((await get(2, null, '?token=secret')).status, 401); assert.equal((await get(2, 'wrong')).status, 401);
  assert.equal((await get(1, 'shared')).status, 200); grant(f.store, 'bot');
  const allowed = await get(2, 'secret'); assert.equal(allowed.status, 200); assert.match(await allowed.text(), /SECRET-CONTENT/);
  assert.equal((await get(2, 'owner')).status, 200); f.store.removeRoomMember(2, 'bot'); assert.equal((await get(2, 'secret')).status, 403);
});
test('policy HTTP: initial_members, every members method, atomic validation and obsolete identity deletion', async t => {
  const f = fixture(t); const { call } = await ownerApi(t, f); const before = f.store.rooms().length;
  for (const initial_members of [['ghost'], ['owner'], ['user'], ['shared'], ['bot', 'ghost'], ['bot', 'bot']]) {
    assert.equal((await call('POST', 'rooms', { name: 'invalid', visibility: 'private', initial_members })).status, 400); assert.equal(f.store.rooms().length, before);
  }
  const create = await call('POST', 'rooms', { name: 'closed', visibility: 'private', initial_members: ['ds', 'bot'] });
  assert.equal(create.status, 200); const { room } = await create.json(); assert.equal(room.visibility, 'private');
  assert.equal(f.store.canAccess('ds', room.id), true); assert.equal(f.store.canAccess('bot', room.id), true);
  const prefix = 'rooms/' + room.id; const listed = await (await call('GET', prefix + '/members')).json();
  assert.deepEqual(listed.members.map(m => m.member_id).sort(), ['bot', 'ds', 'owner']);
  assert.deepEqual(listed.members.find(m => m.member_id === 'owner'), { member_id: 'owner', role: 'owner', added_at: null });
  assert.equal(typeof listed.members.find(m => m.member_id === 'bot').added_at, 'number');
  assert.equal((await call('PATCH', prefix, { name: 'renamed' })).status, 200); assert.equal(f.store.visibility(room.id), 'private');
  assert.equal((await call('PATCH', prefix, { visibility: 'public', initial_members: [] })).status, 400); assert.equal(f.store.visibility(room.id), 'private');
  assert.equal((await call('POST', prefix + '/members', { member_ids: ['other', 'ghost'] })).status, 400); assert.equal(f.store.canAccess('other', room.id), false);
  assert.equal((await call('POST', prefix + '/members', { member_id: 'other' })).status, 200);
  assert.equal((await call('POST', prefix + '/members', { member_id: 'bot', role: 'owner' })).status, 400);
  assert.equal((await call('DELETE', prefix + '/members/owner')).status, 400);
  f.store.addMember({ id: 'gone', name: 'Gone' }); grant(f.store, 'gone', room.id); f.store.removeMember('gone');
  assert.equal((await call('POST', prefix + '/members', { member_id: 'gone' })).status, 400);
  assert.equal((await call('DELETE', prefix + '/members/gone')).status, 200); assert.equal(f.store.canAccess('gone', room.id), false);
  assert.equal((await call('DELETE', prefix + '/members/bot')).status, 200); assert.equal(f.store.canAccess('bot', room.id), false);
  assert.equal((await call('PATCH', prefix, { visibility: 'public' })).status, 200); assert.equal(f.store.room(room.id).name, 'renamed');
  assert.equal((await call('GET', prefix)).status, 200);
});
test('policy HTTP: bot/shared/body identity cannot gain owner management, state or SSE', async t => {
  const f = fixture(t); const { call } = await ownerApi(t, f); const ws = connect(f.gateway); const observed = []; f.hub.subscribe(e => observed.push(e));
  const actions = [['POST', 'rooms', { name: 'x', initial_members: ['bot'], owner: 'owner' }], ['GET', 'rooms/2'], ['PATCH', 'rooms/2', { visibility: 'public' }], ['GET', 'rooms/2/members'], ['POST', 'rooms/2/members', { member_id: 'bot' }], ['DELETE', 'rooms/2/members/bot'], ['POST', 'rooms/2/stop'], ['POST', 'rooms/2/continue'], ['GET', 'state'], ['GET', 'events'], ['GET', 'models'], ['POST', 'members', { name: 'x' }]];
  for (const auth of ['secret', 'shared', 'none']) for (const [method, path, body] of actions) { const response = await call(method, path + '?owner=owner', body, auth); assert.equal(response.status, 401, auth + ' ' + method + ' ' + path); assert.doesNotMatch(await response.text(), /SECRET-ROOM/); }
  assert.equal((await call('GET', 'state')).status, 200); assert.equal((await call('GET', 'events')).status, 200);
  await call('POST', 'rooms/2/members', { member_id: 'bot' }); assert.ok(observed.some(e => e.type === 'room_members_changed')); assert.ok(observed.some(e => e.type === 'room_updated'));
  assert.equal(ws.sent.some(e => e.type === 'room_updated' || e.type === 'room_members_changed'), false);
});
test('policy: config seeds once and cannot undo persisted runtime revocation', t => {
  const { store } = fixture(t); const seeds = [{ id: 3, name: 'seed', visibility: 'private', initial_members: ['bot'] }];
  seedRooms(store, seeds); store.removeRoomMember(3, 'bot'); const stamp = store.accessStamp('bot', 3);
  seedRooms(store, seeds); assert.equal(store.canAccess('bot', 3), false); assert.equal(store.accessStamp('bot', 3), stamp);
});

test('DSH admission: outsider creates no job, workspace, Agent or input', async t => {
  const { hub, store } = fixture(t); const rt = runtime(hub);
  post(hub); await rt.drain();
  assert.deepEqual(store.openJobs(), []);
  assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM jobs').get().n, 0, 'no interrupted job hidden from openJobs');
  assert.deepEqual(rt.paths, []); assert.equal(rt.agents.size, 0);
  assert.deepEqual(rt.prompts, []); assert.equal(rt.ctx.agents.resumes, 0);
});

for (const point of ['preset', 'workspace', 'create', 'attach']) {
  test('DSH admission: revoke/regrant across await ' + point + ' invalidates queued work', async t => {
    const { hub, store } = fixture(t); const rt = runtime(hub); grant(store);
    const gate = rt.pause(point);
    post(hub); await gate.entered;
    post(hub, 2, '@DeepSeek queued-before-revoke'); await tick();
    const old = store.openJobs(); assert.equal(old.length, 2);
    revoke(store, rt.members); grant(store);
    gate.release(); await rt.drain();
    assert.equal(store.canAccess('ds', 2), true);
    assert.ok(old.every(j => store.job(j.id).state === 'interrupted'));
    assert.equal(store.binding('ds', 2), undefined);
    assert.deepEqual(rt.prompts, [], 'fresh authorization must not admit old work');
    for (const agent of rt.agents.values()) assert.equal(store.sessionFenced(agent.session.id), true);
    post(hub, 2, '@DeepSeek fresh-after-regrant'); await rt.drain();
    assert.equal(rt.prompts.length, 1);
    assert.match(rt.prompts[0].content[0].text, /fresh-after-regrant/);
    assert.equal(store.sessionFenced(store.binding('ds', 2).session_id), false);
  });
}

test('DSH running: claimed input revoked/regranted cannot publish late completion or reuse Session', async t => {
  const { hub, store } = fixture(t); const rt = runtime(hub); grant(store);
  post(hub); await rt.drain();
  const old = store.openJobs()[0]; const agent = rt.agents.get(old.session_id);
  agent.inbox.nextTurn.push({ id: 'web-ui' });
  agent.inbox.remove(old.input_id);
  rt.members.onClaimed(agent.session.id, old.input_id, 8);
  revoke(store, rt.members); grant(store);
  assert.equal(agent.cancellations.length, 1);
  assert.equal(store.sessionFenced(agent.session.id), true);
  assert.equal(store.job(old.id).state, 'interrupted');
  rt.emit(agent, 'turn/start', { turn: 8 });
  rt.emit(agent, 'user/message', { id: old.input_id });
  rt.emit(agent, 'assistant/message', { message: { content: [{ type: 'text', text: 'STALE-COMPLETION' }] } });
  rt.emit(agent, 'turn/end', { turn: 8, reason: { kind: 'completed' } });
  await rt.drain();
  assert.equal(store.page(2).some(m => m.text.includes('STALE-COMPLETION')), false);
  assert.deepEqual(agent.inbox.nextTurn.map(m => m.id), ['web-ui']);
  post(hub, 2, '@DeepSeek fresh'); await rt.drain();
  assert.notEqual(store.binding('ds', 2).session_id, old.session_id);
  assert.equal(rt.prompts.length, 2);
});

async function rejectedWrites(ws, hub, store, reply_ctx, handle) {
  const frames = ['reply', 'typing_start', 'typing_stop', 'preview_start', 'update_message', 'delete_message'];
  const before = store.page(2); const events = []; const unsubscribe = hub.subscribe(e => events.push(e));
  try {
    for (const type of frames) {
      const ref_id = 'reject-' + type + '-' + ws.sent.length;
      ws.frame({ type, ref_id, reply_ctx, content: 'UNAUTHORIZED-OUTPUT', preview_handle: handle, agent: true });
      await tick();
      assert.deepEqual(ws.of('error').filter(e => e.ref_id === ref_id), [{ type: 'error', code: 'forbidden', error: 'forbidden', ref_id }], type);
      if (type === 'preview_start') assert.deepEqual(ws.of('preview_ack').filter(e => e.ref_id === ref_id), [{ type: 'preview_ack', ref_id, preview_handle: '' }]);
    }
    assert.deepEqual(store.page(2), before, 'no write/delete side effects');
    assert.deepEqual(events, [], 'no message, edit, delete or thinking broadcasts');
  } finally { unsubscribe(); }
}

test('WS writes: all six frames reject outsiders, including stopped edit/delete', async t => {
  const { store, hub, gateway } = fixture(t); const ws = connect(gateway);
  grant(store, 'bot'); const ctx = gateway.replyContext(2, 'bot');
  ws.frame({ type: 'preview_start', ref_id: 'old-preview', reply_ctx: ctx, content: 'original' }); await tick();
  const handle = ws.of('preview_ack').at(-1).preview_handle; assert.ok(handle);
  store.removeRoomMember(2, 'bot'); gateway.reconcileRoom(2);
  await rejectedWrites(ws, hub, store, ctx, handle);
  hub.stopRoom(2);
  await rejectedWrites(ws, hub, store, ctx, handle);
});

test('WS generations: regrant/reconnect and visibility cycles never revive old context or handle', async t => {
  const { store, hub, gateway } = fixture(t); let ws = connect(gateway); grant(store, 'bot');
  const oldCtx = gateway.replyContext(2, 'bot');
  ws.frame({ type: 'preview_start', ref_id: 'preview', reply_ctx: oldCtx, content: 'original' }); await tick();
  const handle = ws.of('preview_ack').at(-1).preview_handle; assert.ok(handle);
  store.removeRoomMember(2, 'bot'); gateway.reconcileRoom(2); grant(store, 'bot'); gateway.reconcileRoom(2);
  ws.close(); ws = connect(gateway);
  await rejectedWrites(ws, hub, store, oldCtx, handle);
  const freshCtx = gateway.replyContext(2, 'bot'); assert.notEqual(freshCtx, oldCtx);
  ws.frame({ type: 'reply', reply_ctx: freshCtx, content: 'fresh', agent: true }); await tick();
  assert.equal(store.page(2).some(m => m.text === 'fresh'), true);
  store.setVisibility(2, 'public'); gateway.reconcileRoom(2);
  const publicCtx = gateway.replyContext(2, 'bot');
  store.setVisibility(2, 'private'); gateway.reconcileRoom(2);
  store.setVisibility(2, 'public'); gateway.reconcileRoom(2);
  await rejectedWrites(ws, hub, store, publicCtx, handle);
  gateway.closeAll();
  const restarted = new CloudWebGateway(hub, { token: 'shared', tokens: new Map([['secret', 'bot'], ['other-secret', 'other']]), logger: quiet });
  t.after(() => restarted.closeAll());
  ws = connect(restarted);
  await rejectedWrites(ws, hub, store, oldCtx, handle);
  ws.frame({ type: 'reply', reply_ctx: restarted.replyContext(2, 'bot'), content: 'fresh-after-gateway-restart', agent: true }); await tick();
  assert.equal(store.page(2).some(m => m.text === 'fresh-after-gateway-restart'), true);
});

test('migration: v4 variants, v5 and stamped v6 repair missing structure without inventing old evidence', () => {
  for (const version of ['owner4', 'ours4', 'v5', 'v6']) {
    const path = join(mkdtempSync(join(tmpdir(), 'gge56-schema-')), 'collab.sqlite3');
    let store = new Store(path); store.ensureRoom(1, 'legacy');
    const trigger = store.append(1, { authorKind: 'user', author: 'owner', name: 'Owner', text: 'legacy' }).message;
    const job = store.addJob('ds', 1, trigger.id); store.bind('ds', 1, 'legacy-session');
    store.markSent(job.id, 'legacy-session', 0, 'legacy-input');
    store.db.exec('ALTER TABLE bindings DROP COLUMN workspace_path; ALTER TABLE bindings DROP COLUMN access_stamp; ALTER TABLE jobs DROP COLUMN workspace_path; ALTER TABLE jobs DROP COLUMN access_stamp; ALTER TABLE rooms DROP COLUMN access_epoch; ALTER TABLE messages DROP COLUMN access_stamp; DROP TABLE room_grants; DROP TABLE session_fences;');
    if (version === 'owner4') store.db.exec('DROP TABLE relay_blocked; DROP TABLE room_controls;');
    if (version === 'ours4') store.db.exec('ALTER TABLE members DROP COLUMN cli;');
    if (version !== 'v6') store.db.exec('DROP TABLE room_members; ALTER TABLE rooms DROP COLUMN visibility;');
    store.db.exec('PRAGMA user_version = ' + (version.endsWith('4') ? 4 : version === 'v5' ? 5 : 6));
    store.close();
    for (const repeat of [false, true]) {
      store = new Store(path);
      assert.equal(store.db.prepare('PRAGMA user_version').get().user_version, 6, version);
      assert.equal(store.binding('ds', 1).workspace_path, null);
      assert.equal(store.binding('ds', 1).access_stamp, null);
      assert.equal(store.job(job.id).workspace_path, null); assert.equal(store.job(job.id).access_stamp, null);
      assert.equal(store.hasColumn('members', 'cli'), true); assert.equal(store.control(1).stopped, 0);
      assert.equal(store.room(1).visibility, 'public'); assert.equal(store.page(1)[0].text, 'legacy');
      if (!repeat) { store.fenceSession('legacy-session', 'test'); grant(store, 'ds', 1); store.stampMessage(trigger.id, 'new-proof'); }
      else { assert.equal(store.sessionFenced('legacy-session'), true); assert.equal(store.canAccess('ds', 1), true); assert.equal(store.message(trigger.id).access_stamp, 'new-proof'); }
      store.close();
    }
  }
});

test('migration: old sent never resumes/replays, new member by room Sessions stay independent', async t => {
  const { hub, store } = fixture(t); const rt = runtime(hub, [{ id: 'ds', name: 'DeepSeek' }, { id: 'peer', name: 'Peer' }]); grant(store);
  const trigger = store.append(1, { authorKind: 'user', author: 'owner', name: 'Owner', text: '@DeepSeek old' }).message;
  const old = store.addJob('ds', 1, trigger.id);
  store.bind('ds', 1, 'old-unloaded'); store.markSent(old.id, 'old-unloaded', 0, 'old-input');
  rt.members.recover(); await rt.drain();
  assert.equal(store.job(old.id).state, 'interrupted'); assert.equal(store.sessionFenced('old-unloaded'), true);
  assert.equal(rt.ctx.agents.resumes, 0); assert.deepEqual(rt.prompts, []);
  post(hub, 1, '@DeepSeek room-one'); post(hub, 2, '@DeepSeek room-two'); post(hub, 1, '@Peer peer-one'); await rt.drain();
  assert.deepEqual(new Set(rt.paths), new Set(['/isolated/ds/room-1', '/isolated/ds/room-2', '/isolated/peer/room-1']));
  const bindings = [store.binding('ds', 1), store.binding('ds', 2), store.binding('peer', 1)];
  assert.equal(new Set(bindings.map(b => b.session_id)).size, 3);
  assert.equal(bindings.some(b => b.session_id === 'old-unloaded'), false);
  const roomTwo = rt.agents.get(bindings[1].session_id).prompts[0].content[0].text;
  assert.match(roomTwo, /room-two/); assert.doesNotMatch(roomTwo, /room-one|peer-one|old-input/);
});

test('apply wiring: registered production HTTP and upgrade handlers enforce credentials and ACL', async t => {
  // Only external DSH/ws packages and host services are doubles. apply(), routing,
  // gateway and SQLite are the production modules, exercised through registration.
  const root = mkdtempSync(join(tmpdir(), 'gge56-host-'));
  const entry = join(root, 'host.cjs'); writeFileSync(entry, '');
  const llm = join(root, 'node_modules/@deepseek-ai/dsh-llm'); const wsModule = join(root, 'node_modules/ws');
  mkdirSync(llm, { recursive: true }); mkdirSync(wsModule, { recursive: true });
  writeFileSync(join(llm, 'package.json'), JSON.stringify({ type: 'module', main: 'index.mjs' }));
  writeFileSync(join(llm, 'index.mjs'), 'export const createUserMessage = value => ({...value, id: crypto.randomUUID()});');
  writeFileSync(join(wsModule, 'index.js'), 'module.exports.WebSocketServer = class { handleUpgrade(req, socket, head, accept) { accept(socket); } close() {} };');
  const f = fixture(t); const rt = runtime(f.hub);
  const routes = []; const upgrades = []; const dispose = []; const listeners = new Map();
  const ctx = { ...rt.ctx, logger: quiet,
    on(type, fn) { listeners.set(type, fn); },
    connection: { requestRejection: req => req.headers['x-owner'] === 'yes' ? undefined : 'unauthorized' },
    webServer: { register(route) { routes.push(route); return () => {}; }, registerUpgrade(route) { upgrades.push(route); return () => {}; } },
    effect(fn) { dispose.push(fn()); },
  };
  t.after(async () => { for (const end of dispose.reverse()) await end?.(); });
  const previousEntry = process.argv[1]; const envName = 'GGE56_APPLY_SHARED_TOKEN'; const previousToken = process.env[envName];
  try {
    process.argv[1] = entry; process.env[envName] = 'shared';
    await apply(ctx, { dataDir: join(root, 'data'), workspacePath: join(root, 'work'), botTokenEnv: envName, botTokensEnv: 'GGE56_APPLY_DEDICATED_TOKENS', botTokens: { bot: 'secret' }, rooms: [{ id: 1, name: 'public' }, { id: 2, name: 'private', visibility: 'private' }] });
  } finally {
    process.argv[1] = previousEntry;
    if (previousToken === undefined) delete process.env[envName]; else process.env[envName] = previousToken;
  }
  assert.deepEqual(routes.map(r => [r.kind, r.path]), [['prefix', '/collab'], ['prefix', '/api/rooms']]);
  assert.deepEqual(upgrades.map(r => r.path), ['/cloud-web/ws']);
  assert.deepEqual([...listeners.keys()], ['session/event', 'agent/inbox/claimed', 'agent/inbox/discarded']);
  const base = await http(t, (req, res) => {
    const route = routes.find(r => req.url.startsWith(r.path));
    if (route) return route.handler(req, res);
    res.writeHead(404); res.end();
  });
  const request = (method, path, body, credential = 'owner') => fetch(base + path, { method, headers: { 'content-type': 'application/json', ...(credential === 'owner' ? { 'x-owner': 'yes' } : { authorization: 'Bearer ' + credential }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  assert.equal((await request('GET', '/collab/api/state', undefined, 'secret')).status, 401);
  assert.equal((await request('GET', '/collab/api/events', undefined, 'shared')).status, 401);
  assert.equal((await request('GET', '/collab/api/state')).status, 200);
  assert.equal((await request('POST', '/collab/api/rooms/2/messages', { text: 'APPLY-SECRET' })).status, 200);
  assert.equal((await request('GET', '/api/rooms/2/messages', undefined, 'secret')).status, 403);
  assert.equal((await request('GET', '/api/rooms/2/messages', undefined, 'shared')).status, 403);
  assert.equal((await request('GET', '/api/rooms/1/messages', undefined, 'shared')).status, 200);
  assert.equal((await request('POST', '/collab/api/rooms/2/members', { member_id: 'bot' })).status, 200);
  assert.equal((await request('GET', '/collab/api/rooms/2/members')).status, 200);
  const allowed = await request('GET', '/api/rooms/2/messages', undefined, 'secret'); assert.equal(allowed.status, 200); assert.match(await allowed.text(), /APPLY-SECRET/);
  assert.equal((await request('PATCH', '/collab/api/rooms/2', { name: 'renamed' })).status, 200);
  assert.equal((await request('DELETE', '/collab/api/rooms/2/members/bot')).status, 200);
  assert.equal((await request('GET', '/api/rooms/2/messages', undefined, 'secret')).status, 403);
  const rejected = { end(value) { this.response = value; } };
  upgrades[0].handler({ url: '/cloud-web/ws', headers: {} }, rejected, Buffer.alloc(0));
  assert.match(rejected.response, /401 Unauthorized/);
  for (const [secret, ok] of [['secret', true], ['shared', false]]) {
    const socket = new Socket();
    upgrades[0].handler({ url: '/cloud-web/ws?bot=bot', headers: { authorization: 'Bearer ' + secret } }, socket, Buffer.alloc(0));
    socket.frame({ type: 'register', project: 'unrelated-project' });
    assert.equal(socket.of('register_ack')[0].ok, ok);
  }
});

function recoveryJob(store, rt, mode) {
  const trigger = store.append(1, { authorKind: 'user', author: 'owner', name: 'Owner', text: '@DeepSeek old' }).message;
  const job = store.addJob('ds', 1, trigger.id);
  const path = rt.members.workspaceFor({ id: 'ds' }, 1);
  const agent = rt.agentFor('recovery-' + mode, { cwd: path });
  store.bind('ds', 1, agent.session.id, path, job.access_stamp);
  store.markSent(job.id, agent.session.id, 0, 'old-input', path);
  agent.status = 'running';
  if (mode === 'active') {
    rt.emit(agent, 'turn/start', { turn: 7 });
    rt.emit(agent, 'user/message', { id: 'old-input' });
    rt.emit(agent, 'assistant/message', { message: { content: [{ type: 'text', text: 'OLD-SECRET' }] } });
  }
  agent.inbox.nextTurn.push({ id: 'web-ui' });
  return { job: store.job(job.id), agent };
}

test('recovery P1: unfinished consumed turn is cancelled, fenced and never reused', async t => {
  const { hub, store } = fixture(t); const rt = runtime(hub);
  const { job, agent } = recoveryJob(store, rt, 'active');
  await rt.members.settleSent(job);
  assert.equal(store.job(job.id).state, 'interrupted');
  assert.equal(agent.cancellations.length, 1, 'cancel exactly the consuming turn');
  assert.deepEqual(agent.cancellations[0][1], { keepInbox: true });
  assert.equal(store.sessionFenced(agent.session.id), true);
  assert.deepEqual(agent.inbox.nextTurn.map(m => m.id), ['web-ui']);
  assert.equal(store.page(1).some(m => m.text.includes('OLD-SECRET')), false);
  post(hub, 1, '@DeepSeek fresh'); await rt.drain();
  assert.notEqual(store.binding('ds', 1).session_id, agent.session.id);
  assert.equal(rt.prompts.length, 1);
});

test('recovery P1: lost claimed/turn-start window terminates without stuck watcher', async t => {
  const { hub, store } = fixture(t); const rt = runtime(hub);
  const { job, agent } = recoveryJob(store, rt, 'claim-gap');
  await rt.members.settleSent(job);
  assert.equal(store.job(job.id).state, 'interrupted');
  assert.equal(store.sessionFenced(agent.session.id), true);
  assert.equal(rt.members.watching.has(agent.session.id), false);
  assert.equal(agent.cancellations.length, 0, 'unknown turn must not cancel unrelated Web UI work');
  rt.emit(agent, 'user/message', { id: 'old-input' });
  rt.emit(agent, 'turn/end', { turn: 7, reason: { kind: 'completed' } });
  post(hub, 1, '@DeepSeek fresh'); await rt.drain();
  assert.equal(store.job(job.id).state, 'interrupted');
  assert.equal(rt.members.watching.has(agent.session.id), false);
  assert.notEqual(store.binding('ds', 1).session_id, agent.session.id);
  assert.equal(rt.prompts.length, 1);
});

test('recovery P1: async cancel rejection keeps fence and releases queue', async t => {
  const { hub, store } = fixture(t); const rt = runtime(hub);
  const { job, agent } = recoveryJob(store, rt, 'active');
  const cancellation = deferred();
  agent.cancel = (...args) => { agent.cancellations.push(args); return cancellation.promise; };
  await rt.members.settleSent(job);
  cancellation.reject(Error('controlled cancellation failure')); await rt.drain();
  assert.equal(store.job(job.id).state, 'interrupted');
  assert.equal(store.sessionFenced(agent.session.id), true);
  post(hub, 1, '@DeepSeek fresh'); await rt.drain();
  assert.notEqual(store.binding('ds', 1).session_id, agent.session.id);
  assert.deepEqual(agent.inbox.nextTurn.map(m => m.id), ['web-ui']);
});
