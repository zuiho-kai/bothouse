import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from './store.mjs';
import { Hub } from './hub.mjs';
import { Roster } from './roster.mjs';
import { CliMember } from './cli-member.mjs';
import { buildTeam, resolveConfig } from './plugin.mjs';
import { managementMembers, managementUpdate } from './member-management.mjs';

test('#1592 team-created Claude member keeps omitted fields and persists model edits', async t => {
  const store = new Store(':memory:'); t.after(() => store.close());
  store.ensureRoom(1, 'general');
  const hub = new Hub(store, { warn() {}, info() {} });
  hub.setMember({ id: 'lead', name: 'Lead', kind: 'dsh', online: true });
  const runtime = { putMember(m) { hub.setMember({ ...m, kind: 'dsh', online: true }); } };
  const roster = new Roster(hub, runtime);
  const team = await buildTeam({ channel: 'claude-team', members: [{ name: 'Claude', cli: 'claude', persona: 'keep me' }] }, 'lead', { store, hub, roster });
  const id = team.members[0].id;
  assert.equal(store.member(id).cli, 'claude');
  assert.equal(managementMembers(roster, hub).find(m => m.id === id).can_edit, true);
  await roster.update(id, { permissionPreset: 'read-only', nameCustomized: true });
  const before = { ...store.member(id) };
  const changed = await managementUpdate(roster, id, { model: 'sonnet' });
  assert.equal(changed.model, 'sonnet');
  assert.deepEqual(changed.cliConfig, { model: 'sonnet' });
  assert.deepEqual(managementMembers(roster, hub).find(m => m.id === id).cliConfig, { model: 'sonnet' });
  assert.equal(changed.apply.status, 'pending');
  assert.deepEqual({ ...store.member(id), model: before.model }, before, 'other columns are unchanged');
  const kept = await roster.update(id, { persona: 'edited' });
  assert.equal(kept.model, 'sonnet', 'legacy PATCH also keeps omitted model and CLI');
  assert.equal(kept.cli, 'claude');
  assert.equal(kept.name, 'Claude');
  assert.deepEqual(kept.rooms, [team.room.id]);
  roster.load([]);
  assert.equal(hub.members.get(id).model, 'sonnet', 'model survives roster reload');
  const cleared = await managementUpdate(roster, id, { model: null });
  assert.equal(cleared.model, null);
  assert.equal(cleared.cliConfig, null);
  for (const model of ['', '  ', 42, {}, { provider: 'p', model: 'm' }]) {
    await assert.rejects(managementUpdate(roster, id, { model }), /Claude model/);
  }
  assert.equal(store.member(id).model, null, 'invalid edits never write');
});

test('#1592 Claude config seeds remain read-only and invalid team models write nothing', async t => {
  const store = new Store(':memory:'); t.after(() => store.close()); store.ensureRoom(1, 'general');
  const hub = new Hub(store, { warn() {}, info() {} });
  const config = resolveConfig({ dataDir: '/tmp/unused', workspacePath: '/tmp', dshMembers: [{ id: 'seed', name: 'Seed', cli: 'claude', model: 'sonnet' }] }, {});
  const roster = new Roster(hub, { putMember(m) { hub.setMember({ ...m, kind: 'dsh', online: true }); } });
  roster.load(config.dshMembers);
  assert.equal(hub.members.get('seed').model, 'sonnet');
  await assert.rejects(managementUpdate(roster, 'seed', { model: 'opus' }), /read-only/);
  const before = { rooms: store.rooms().length, members: store.members().length };
  await assert.rejects(buildTeam({ channel: 'invalid', members: [{ name: 'Good', cli: 'claude' }, { name: 'Bad', cli: 'claude', model: { provider: 'p', model: 'm' } }] }, 'seed', { store, hub, roster }), /Claude model/);
  assert.deepEqual({ rooms: store.rooms().length, members: store.members().length }, before);
});

function claude({ reject = false, loaded = false } = {}) {
  const agent = new CliMember({ cli: 'claude', cwd: process.cwd() });
  const calls = [];
  agent._start = async () => {
    agent.ready = Promise.resolve({}); agent.exited = new Promise(() => {}); agent.canLoad = true;
    let model = 'default-model';
    const session = () => ({ sessionId: 's', models: { currentModelId: model, availableModels: [] } });
    agent.conn = {
      newSession: async () => session(),
      loadSession: async () => session(),
      request: async (method, params) => {
        assert.equal(method, 'session/set_model'); calls.push(['set', params.modelId]);
        if (reject) throw Error('model rejected');
        model = params.modelId; return {};
      },
      prompt: async () => { calls.push(['prompt', model]); agent.buffers.set('s', model); },
    };
  };
  return { agent, calls, options: loaded ? { resumeId: 's' } : {} };
}

for (const loaded of [false, true]) test(`#1592 Claude ${loaded ? 'resumed' : 'new'} session switches before next prompt and clears to default`, async () => {
  const { agent, calls, options } = claude({ loaded });
  assert.equal(await agent.ask('first', 'r', undefined, undefined, { ...options, model: 'sonnet' }), 'sonnet');
  assert.equal(await agent.ask('second', 'r', undefined, undefined, { model: 'opus' }), 'opus');
  assert.equal(await agent.ask('clear', 'r'), 'default-model');
  assert.deepEqual(calls, [['set', 'sonnet'], ['prompt', 'sonnet'], ['set', 'opus'], ['prompt', 'opus'], ['set', 'default-model'], ['prompt', 'default-model']]);
});

test('#1592 rejected Claude model stops the prompt instead of silently using the old model', async () => {
  const { agent, calls } = claude({ reject: true });
  await assert.rejects(agent.ask('first', 'r', undefined, undefined, { model: 'sonnet' }), /model rejected/);
  assert.equal(calls.some(c => c[0] === 'prompt'), false);
});
