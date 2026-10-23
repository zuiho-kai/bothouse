import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from './store.mjs';
import { Hub } from './hub.mjs';
import { DshMembers, promptText } from './dsh-member.mjs';
import { resolveConfig } from './plugin.mjs';

const paths = { dataDir: '/collab-test-data', workspacePath: '/collab-test-workspace' };
const quiet = { warn() {} };

test('lead config: optional, stable id, explicit config wins over environment', () => {
  const seed = { ...paths, dshMembers: [{ id: 'ds', name: 'DeepSeek' }] };
  assert.equal(resolveConfig(seed, {}).leadMember, undefined, 'never pick the first member');
  assert.equal(resolveConfig(seed, { CONEST_COLLAB_LEAD: '' }).leadMember, undefined);
  assert.equal(resolveConfig(seed, { CONEST_COLLAB_LEAD: 'external-bot' }).leadMember, 'external-bot');
  assert.equal(resolveConfig({ ...seed, leadMember: 'ds' }, { CONEST_COLLAB_LEAD: 'external-bot' }).leadMember, 'ds');
  assert.equal(resolveConfig({ ...seed, leadMember: 'ds' }, { CONEST_COLLAB_LEAD: 'invalid id' }).leadMember, 'ds');
});

test('lead config: reject invalid types, reserved ids and malformed ids', () => {
  for (const leadMember of [null, false, 7, [], {}, '', ' ', 'DeepSeek', '@ds', 'ds bot', 'owner', 'user', 'system', '-ds', 'a'.repeat(33)]) {
    assert.throws(() => resolveConfig({ ...paths, leadMember }, {}), /leadMember/, JSON.stringify(leadMember));
  }
  for (const value of [false, 7, 'invalid id', 'owner']) {
    assert.throws(() => resolveConfig(paths, { CONEST_COLLAB_LEAD: value }), /leadMember/);
  }
  for (const leadMember of ['ds', 'external-bot', 'bot_1', 'a'.repeat(32)]) {
    assert.equal(resolveConfig({ ...paths, leadMember }, {}).leadMember, leadMember);
  }
});

test('native prompt: lead reception and explicit handoff without delivery claims', () => {
  const prompt = promptText({ name: 'general' }, { id: 'ds', name: 'DeepSeek' }, [{ name: '我', text: '你好' }]);
  assert.doesNotMatch(prompt, /最后一条 @ 了你/);
  assert.match(prompt, /主 bot/);
  assert.match(prompt, /显式 @/);
  assert.match(prompt, /不要.*(?:已送达|已派工)/);
  assert.match(prompt, /【我】你好$/);
});

// This worktree intentionally has the old Hub. Stub only the agreed route
// return value; production planning, transactions, jobs and queues stay real.
function fixture(t, route) {
  const store = new Store(':memory:');
  store.ensureRoom(1, 'general');
  const hub = new Hub(store, quiet);
  hub.route = t.mock.fn(route);
  const dsh = new DshMembers(hub, { logger: quiet }, [
    { id: 'ds', name: 'DeepSeek' },
    { id: 'writer', name: 'Writer' },
  ]);
  dsh.run = t.mock.fn(async () => {});
  t.after(async () => { await dsh.close(); store.close(); });
  return { store, hub, dsh };
}

const cases = [
  { name: 'plain human message only wakes lead', text: '你好', targets: ['ds'], reason: 'lead', expected: ['ds'] },
  { name: 'explicit mention overrides lead', text: '@Writer 看一下', targets: ['writer'], reason: 'mention', expected: ['writer'] },
  { name: 'bare role name cannot dispatch', authorKind: 'role', text: 'Writer，你来', targets: [], reason: 'context', expected: [] },
  { name: 'explicit role mention dispatches', authorKind: 'role', text: '@Writer 你来', targets: ['writer'], reason: 'mention', expected: ['writer'] },
  { name: 'hub context decision stays silent even with mention text', text: '@Writer 看一下', targets: [], reason: 'context', expected: [] },
  { name: 'external lead creates no native job', text: '你好', targets: ['external-bot'], reason: 'lead', expected: [] },
  { name: 'self mention is excluded', authorKind: 'role', author: 'ds', text: '@DeepSeek @Writer', targets: ['ds', 'writer'], reason: 'mention', expected: ['writer'] },
  { name: 'missing lead creates no job', text: '你好', targets: [], reason: 'context', error: 'lead unavailable', expected: [] },
];

for (const scenario of cases) {
  test(`native plan: ${scenario.name}`, async (t) => {
    const { store, hub, dsh } = fixture(t, () => ({ targets: new Set(scenario.targets), reason: scenario.reason, error: scenario.error }));
    const input = { authorKind: scenario.authorKind ?? 'user', author: scenario.author ?? 'owner', name: 'sender', text: scenario.text, clientKey: 'trigger' };
    const { message } = hub.post(1, input);
    const jobs = store.openJobs();
    assert.deepEqual(jobs.map(job => job.member_id), scenario.expected);
    assert.ok(jobs.every(job => job.state === 'pending' && job.trigger_id === message.id));
    assert.equal(hub.route.mock.calls.length, 1);
    assert.equal(hub.route.mock.calls[0].arguments[0].id, message.id);
    hub.post(1, input);
    assert.equal(hub.route.mock.calls.length, 1, 'deduplicated message does not plan again');
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(dsh.run.mock.calls.map(call => call.arguments[0]), jobs.map(job => job.id));
  });
}

test('native plan: hub filters cards and system notices without jobs', async (t) => {
  const { store, hub, dsh } = fixture(t, () => ({ targets: new Set(), reason: 'context' }));
  hub.post(1, { authorKind: 'system', author: 'system', name: 'system', text: '@DeepSeek notice' });
  hub.post(1, { authorKind: 'role', author: 'writer', name: 'Writer', text: '@DeepSeek card', card: '{}' });
  assert.equal(dsh.plan(undefined), undefined);
  assert.equal(dsh.plan(null), undefined);
  assert.deepEqual(store.openJobs(), []);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(dsh.run.mock.calls.length, 0);
});

test('native plan: message and all routed jobs roll back together', async (t) => {
  const { store, hub, dsh } = fixture(t, () => ({ targets: new Set(['ds', 'writer']), reason: 'mention' }));
  const addJob = store.addJob.bind(store);
  store.addJob = (id, ...args) => {
    if (id === 'writer') throw Error('injected job write failure');
    return addJob(id, ...args);
  };
  assert.throws(() => hub.post(1, { authorKind: 'user', author: 'owner', name: '我', text: '@DeepSeek @Writer' }), /job write failure/);
  assert.deepEqual(store.page(1), []);
  assert.deepEqual(store.openJobs(), []);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(dsh.run.mock.calls.length, 0);
});
