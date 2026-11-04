// 一句话拉团队 (user 11-04): the primary role builds a channel of new roles with its ticket.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { Store } from './store.mjs';
import { Hub } from './hub.mjs';
import { Roster } from './roster.mjs';
import { Later } from './later.mjs';
import { teamRoute } from './plugin.mjs';
import { workspaceHint } from './dsh-member.mjs';

function setup() {
  const store = new Store(':memory:');
  store.ensureRoom(1, 'general');
  const hub = new Hub(store, { warn() {}, info() {} });
  hub.setMember({ id: 'jingyu', name: '鲸鱼娘', kind: 'dsh', online: true });
  hub.leadState = { selected: () => 'jingyu' };
  const dsh = { putMember: m => hub.setMember({ ...m, kind: 'dsh', online: true }), dropMember: id => hub.removeMember(id) };
  const llm = {
    listProviders: () => [{ id: 'deepseek', name: 'DeepSeek' }],
    listModels: async () => [{ id: 'deepseek-v4.1-flash', name: 'flash' }, { id: 'deepseek-v4.1-pro', name: 'pro' }],
    resolveModelInfo: async (p, m) => { if (p !== 'deepseek') throw new Error('no route'); return { id: m }; },
  };
  const roster = new Roster(hub, dsh, llm);
  const later = new Later(hub, ':memory:', () => true, { start: false });
  const call = async (ticket, body, room = 1) => {
    const req = Readable.from([Buffer.from(JSON.stringify(body))]); req.method = 'POST';
    req.headers = ticket === undefined ? {} : { 'x-later-ticket': ticket };
    const res = { writeHead(s) { this.status = s; }, end(d) { this.body = JSON.parse(d); } };
    await teamRoute(req, res, new URL(`http://x/collab/api/rooms/${room}/team`), { store, hub, later, roster });
    return res;
  };
  return { store, hub, later, call };
}

test('team: primary builds a channel with two roles on one model and leads it', async () => {
  const { store, hub, later, call } = setup();
  const res = await call(later.ticket('jingyu', 1), { channel: '小团队', model: 'deepseek-v4.1-flash',
    members: [{ name: '写手', persona: '写和改博客文章' }, { name: '程序员', persona: '写代码和审代码' }] });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const room = res.body.room;
  assert.equal(room.name, '小团队');
  assert.deepEqual(res.body.members.map(m => [m.name, m.model]), [['写手', 'deepseek-v4.1-flash'], ['程序员', 'deepseek-v4.1-flash']]);
  assert.equal(store.leadId(room.id), 'jingyu');
  assert.equal(hub.primaryIn(room.id)?.id, 'jingyu');
  const inRoom = hub.routableIn(room.id).map(m => m.name).sort();
  assert.deepEqual(inRoom, ['写手', '程序员', '鲸鱼娘'].sort());
  assert.ok(!hub.routableIn(1).some(m => m.name === '写手'), 'new roles stay out of the old channel');
  const row = store.members().find(m => m.name === '写手');
  assert.equal(row.provider, 'deepseek'); assert.equal(row.model, 'deepseek-v4.1-flash');
  later.close();
});

test('team: no model means DSH default; unknown model and non-primary are refused without side effects', async () => {
  const { store, hub, later, call } = setup();
  const ok = await call(later.ticket('jingyu', 1), { channel: '默认', members: [{ name: 'A' }] });
  assert.equal(ok.status, 200);
  assert.equal(store.members().find(m => m.name === 'A').model, null);
  const rooms = store.rooms().length;
  const bad = await call(later.ticket('jingyu', 1), { channel: 'x', model: 'gpt-9', members: [{ name: 'B' }] });
  assert.equal(bad.status, 400); assert.match(bad.body.error, /deepseek-v4.1-flash/);
  const dup = await call(later.ticket('jingyu', 1), { channel: 'y', members: [{ name: '鲸鱼娘' }] });
  assert.notEqual(dup.status, 200);
  assert.equal(store.rooms().length, rooms, 'refused requests create no channel');
  hub.setMember({ id: 'other', name: 'other', kind: 'dsh', online: true });
  assert.equal((await call(later.ticket('other', 1), { channel: 'z', members: [{ name: 'C' }] })).status, 403);
  assert.equal((await call(undefined, { channel: 'z', members: [{ name: 'C' }] })).status, 401);
  later.close();
});

test('team: only the primary role is told how to build a team', () => {
  const { hub, later } = setup();
  hub.setMember({ id: 'other', name: 'other', kind: 'dsh', online: true });
  assert.match(workspaceHint(hub, later, 'jingyu', 1), /【建团队】[\s\S]*\/collab\/api\/rooms\/1\/team/);
  assert.equal(workspaceHint(hub, later, 'other', 1), '');
  later.close();
});
