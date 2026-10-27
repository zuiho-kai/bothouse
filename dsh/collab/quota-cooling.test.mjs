import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from './store.mjs';
import { Hub } from './hub.mjs';
import { Tasks } from './tasks.mjs';
import { QuotaCooling, quotaDeadline } from './quota-cooling.mjs';

const start = Date.parse('2026-10-27T13:00:00Z');
test('quota deadline: below 5%, real reset durations and provider-local clocks', () => {
  const usage = used => ({ usage: { buckets: [{ windows: [{ windowSeconds: 18000, usedPercent: used, resetAfterSeconds: 3600 }] }] } });
  assert.equal(quotaDeadline(usage(95), start), undefined);
  assert.equal(quotaDeadline(usage(96), start), start + 3600000);
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
