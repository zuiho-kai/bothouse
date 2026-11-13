import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from './store.mjs';
import { Hub } from './hub.mjs';
import { Tasks } from './tasks.mjs';
import { QuotaCooling, quotaDeadline } from './quota-cooling.mjs';
import { DshMembers } from './dsh-member.mjs';

// #1730: a bridge-started shell exports GATE_PORT; clear it so this test file
// does not resolve the live gate port and hit the running instance.
delete process.env.GATE_PORT;

const start = Date.parse('2026-10-27T13:00:00Z');
test('#1606 Codex reset clock uses the local timezone and leaves missing deadlines unknown', () => {
  // Source: captured app-server error in bridge/agent/codex/appserver_session.go.
  const now = new Date(2026, 9, 27, 3).getTime();
  const error = "You've hit your usage limit. Try again at 4:13 AM.";
  assert.equal(quotaDeadline({ error }, now), new Date(2026, 9, 27, 4, 13).getTime());
  assert.equal(quotaDeadline({ error }, new Date(2026, 9, 27, 5).getTime()), new Date(2026, 9, 28, 4, 13).getTime());
  for (const error of ["You've hit your usage limit.", "You've hit your usage limit. Try again at unknown."]) {
    assert.equal(quotaDeadline({ error }, now), undefined);
  }
});

test('#1606 CLI quota failure blocks task reminders and nudge until the reported recovery', async t => {
  const store = new Store(':memory:'); store.ensureRoom(1, 'general');
  const hub = new Hub(store, { warn() {}, info() {} });
  hub.setMember({ id: 'owner', name: 'Owner', kind: 'human' });
  let now = new Date(2026, 9, 27, 3).getTime();
  const until = new Date(2026, 9, 27, 4, 13).getTime();
  const tasks = new Tasks(hub, { start: false, now: () => now / 1000 });
  let turns = 0;
  const root = mkdtempSync(join(tmpdir(), 'quota-1606-'));
  // Same isolation as collab.test.mjs: never fetch context from the live bridge.
  process.env.BOTHOUSE_CONFIG = join(root, 'no-bridge-config.toml');
  const members = new DshMembers(hub, { ctx: { agents: { created: [] } }, createUserMessage: m => m, workspacePath: root, logger: { warn() {}, info() {} },
    createCliMember: () => ({ async ask() {
      turns++;
      if (turns === 1) throw Object.assign(new Error('Internal error'), { data: { message: "You've hit your usage limit. Try again at 4:13 AM.", codexErrorInfo: 'usageLimitExceeded' } });
      return 'recovered';
    }, close() {} }),
  }, [{ id: 'xy', name: 'Fish', cli: 'codex' }]);
  const quota = new QuotaCooling(hub, tasks, (id, msg) => tasks.wake(id, msg), root, { now: () => now });
  hub.quota = quota;
  tasks.onWake((id, msg) => members.nudge(id, msg));
  t.after(async () => { quota.close(); tasks.close(); await members.close(); store.close(); });
  const settle = async () => { for (let i = 0; i < 20; i++) await new Promise(r => setImmediate(r)); };
  tasks.assign({ roomId: 1, title: 'work', owner: 'xy', actor: 'owner', ref: '无（新建）' });
  hub.post(1, { authorKind: 'user', author: 'owner', name: 'Owner', text: '@Fish work' });
  await settle();
  assert.equal(turns, 1);
  assert.equal(quota.cooling('xy'), true);
  assert.equal([...hub.thinking.values()].some(s => s.has('xy')), false);
  assert.ok(store.page(1).some(m => /额度用完了.*4:13 AM/.test(m.text)));
  tasks.start();
  for (const at of [new Date(2026, 9, 27, 3, 11).getTime(), until - 1]) {
    now = at; tasks.tick(); tasks.deliverPending(); quota.tick();
    const reminder = hub.post(1, { authorKind: 'system', author: 'system', name: 'reminder', text: '@Fish resume' }).message;
    assert.equal(members.nudge('xy', reminder), false);
    assert.equal(tasks.wake('xy', reminder), false);
    await settle();
    assert.equal(turns, 1);
  }
  now = until; quota.tick();
  assert.equal(quota.cooling('xy'), false);
  now = tasks.task(1).next_check_at * 1000; tasks.tick();
  await settle();
  assert.equal(turns, 2, 'the existing due-task reminder resumes after cooldown');
  assert.ok(store.page(1).some(m => m.author === 'xy' && m.text === 'recovered'));
});
test('quota deadline: only a reported limit, real reset durations and provider-local clocks', () => {
  const usage = (used, limitReached = false) => ({ usage: { buckets: [{ limitReached, windows: [{ windowSeconds: 18000, usedPercent: used, resetAfterSeconds: 3600 }] }] } });
  // A window near its limit still has usable quota; switching early throws it away.
  assert.equal(quotaDeadline(usage(95), start), undefined);
  assert.equal(quotaDeadline(usage(99), start), undefined);
  assert.equal(quotaDeadline(usage(100), start), start + 3600000);
  assert.equal(quotaDeadline({ error: 'RESOURCE_EXHAUSTED quota. Resets in 83h59m53s.' }, start), start + 302393000);
  assert.equal(quotaDeadline({ error: "You've hit your limit · resets 9:30pm (Asia/Tokyo)" }, start), Date.parse('2026-10-28T12:30:00Z'));
  assert.equal(quotaDeadline({ metadata: { quota_exhausted: 'Oct 30, 2pm (Asia/Tokyo)' } }, start), Date.parse('2026-10-30T05:00:00Z'));
  assert.equal(quotaDeadline({ error: 'quota exhausted; reset unavailable' }, start), undefined);
});

for (const kind of ['dsh', 'bot']) test(`quota journey (${kind}): persisted cooling -> room primary/tasks/wake -> no duplicates -> restore`, t => {
  const store = new Store(':memory:');
  store.ensureRoom(1, 'general');
  const hub = new Hub(store, { warn() {} });
  hub.setMember({ id: 'owner', name: 'Owner', kind: 'human' });
  for (const [id, name] of [['orange', 'Orange'], ['longniang', '龙娘'], ['jingyu', '鲸鱼娘']]) hub.setMember({ id, name, kind, online: true });
  store.ensureRoom(2, 'quiet');
  hub.leadState = { selected: () => 'orange' };
  store.setLead(1, 'orange');
  const workspace = store.createWorkspace(1);
  let now = start;
  const tasks = new Tasks(hub, { start: false, now: () => now / 1000 });
  const task = tasks.assign({ roomId: workspace.id, title: '修复代码', owner: 'orange', actor: 'owner', reason: '/isolation/original-handoff.md', ref: 'bridge/core/engine.go:1', base: 'develop' });
  const wakes = [];
  const dir = mkdtempSync(join(tmpdir(), 'quota-journey-'));
  const quota = new QuotaCooling(hub, tasks, (id, msg) => { wakes.push({ id, msg }); return true; }, dir, { now: () => now });
  hub.quota = quota;
  t.after(() => { quota.close(); tasks.close(); store.close(); });
  if (kind === 'dsh') quota.observe('orange', 1, { metadata: { quota_exhausted: new Date(now + 3600000).toISOString() } });
  else writeFileSync(join(dir, 'orange.json'), JSON.stringify({ cooling_until: new Date(now + 3600000).toISOString(), transfers: { 'go-task': { to: 'longniang' } } }));
  quota.tick();
  assert.equal(hub.primaryIn(1).id, 'jingyu');
  assert.equal(store.leadId(2), null, 'quota takeover must not opt an unset multi-member channel into replies');
  assert.equal(hub.defaultReplyIn(2), undefined);
  assert.equal(store.page(2).length, 0);
  assert.equal(tasks.task(task.id).owner, 'longniang');
  assert.equal(tasks.task(task.id).reason, '/isolation/original-handoff.md');
  assert.equal(tasks.task(task.id).base, 'develop');
  assert.equal(wakes.length, 2);
  assert.ok(wakes.find(w => w.id === 'longniang').msg.text.includes('/isolation/original-handoff.md'));
  assert.equal(tasks.wake('orange', wakes[0].msg), false);
  // A new host instance reads durable receipts, rather than repeating either wake.
  new QuotaCooling(hub, tasks, () => { assert.fail('wake duplicated'); }, dir, { now: () => now }).tick();
  assert.equal(wakes.length, 2);
  if (kind === 'bot') assert.ok(JSON.parse(readFileSync(join(dir, 'orange.json'))).transfers['go-task'], 'host overwrote Go receipts');
  now += 3600001;
  quota.tick();
  assert.equal(hub.primaryIn(1).id, 'orange');
  assert.equal(store.leadId(2), null, 'quota restoration also leaves the quiet channel unset');
  assert.equal(tasks.task(task.id).owner, 'longniang', 'recovery must not steal active work back');
  assert.ok(store.page(1).some(m => m.text.includes('额度恢复')));
});

test('quota takeover waits for an idle member and retries an offline wake; preserves manual selection', t => {
  const store = new Store(':memory:'); store.ensureRoom(1, 'general');
  const hub = new Hub(store, { warn() {} });
  hub.setMember({ id: 'owner', kind: 'human', name: 'Owner' });
  for (const id of ['orange', 'jingyu', 'manual']) hub.setMember({ id, name: id, kind: 'dsh', online: true });
  store.setLead(1, 'orange');
  const tasks = new Tasks(hub, { start: false });
  let now = start, reachable = false, wakes = 0;
  const dir = mkdtempSync(join(tmpdir(), 'quota-retry-'));
  const quota = new QuotaCooling(hub, tasks, () => { if (!reachable) return false; wakes++; return true; }, dir, { now: () => now });
  hub.quota = quota;
  t.after(() => { tasks.close(); store.close(); });
  hub.setThinking(1, 'jingyu', true); hub.setThinking(1, 'manual', true);
  quota.observe('orange', 1, { error: 'quota. Resets in 1h' });
  quota.tick(); assert.equal(hub.primaryIn(1).id, 'orange');
  hub.setThinking(1, 'jingyu', false);
  quota.tick(); assert.equal(hub.primaryIn(1).id, 'jingyu'); assert.equal(wakes, 0);
  reachable = true;
  quota.tick(); quota.tick(); assert.equal(wakes, 1);
  store.setLead(1, 'manual');
  now += 3600001; quota.tick();
  assert.equal(hub.primaryIn(1).id, 'manual');
});

test('quota: a cooling owner receives no due-task reminder', t => {
  const store = new Store(':memory:'); store.ensureRoom(1, 'general');
  const hub = new Hub(store, { warn() {} });
  hub.setMember({ id: 'owner', kind: 'human', name: 'Owner' });
  hub.setMember({ id: 'orange', kind: 'dsh', name: 'Orange' });
  let now = start;
  const tasks = new Tasks(hub, { start: false, now: () => now / 1000 });
  tasks.assign({ roomId: 1, title: 'work', owner: 'orange', actor: 'owner', ref: '无（新建）' });
  const quota = new QuotaCooling(hub, tasks, () => assert.fail('cooling member woken'), mkdtempSync(join(tmpdir(), 'quota-watch-')), { now: () => now });
  hub.quota = quota;
  quota.observe('orange', 1, { error: 'quota. Resets in 1h' });
  const before = store.page(1).length;
  now += 700000;
  tasks.start(); tasks.tick();
  assert.equal(store.page(1).length, before);
  t.after(() => { tasks.close(); store.close(); });
});

test('quota card mirror: transferred member changes the existing task owner without a second wake', t => {
  const store = new Store(':memory:'); store.ensureRoom(1, 'general');
  const hub = new Hub(store, { warn() {} });
  for (const id of ['lead', 'orange', 'longniang']) hub.setMember({ id, name: id, kind: 'bot', online: true });
  const tasks = new Tasks(hub, { start: false });
  t.after(() => { tasks.close(); store.close(); });
  const message = hub.post(1, { authorKind: 'role', author: 'lead', name: 'lead', text: 'card' }).message;
  const member = { id: 'worker', reporter_project: 'orange', title: '修复代码', status: 'running' };
  tasks.fromCard(1, 'lead', message.id, [member]);
  const original = tasks.activeTasksOf('orange')[0];
  tasks.fromCard(1, 'lead', message.id, [{ ...member, reporter_project: 'longniang', name: 'longniang', status: 'queued' }]);
  assert.equal(tasks.activeTasksOf('orange').length, 0);
  assert.equal(tasks.activeTasksOf('longniang')[0].id, original.id);
  tasks.fromCard(1, 'lead', message.id, [{ ...member, reporter_project: 'longniang', name: 'longniang', status: 'completed' }]);
  assert.equal(tasks.task(original.id).status, 'returned');
});
