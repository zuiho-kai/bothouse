// #876 K: the read-only team status poller and the members fields it publishes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from './store.mjs';
import { Hub } from './hub.mjs';
import { TeamStatus, presenceOf, readStatusFile } from './team-status.mjs';
import { resolveConfig } from './plugin.mjs';

const quiet = { warn() {}, info() {} };
const NOW = Date.parse('2026-11-03T13:00:00.000Z');

function makeHub() {
  const store = new Store(':memory:');
  store.ensureRoom(1, 'general');
  const hub = new Hub(store, quiet);
  hub.setMember({ id: 'owner', name: '我', kind: 'human', online: true });
  hub.setMember({ id: 'deep', name: '肥鱼', kind: 'dsh', online: true });
  hub.setMember({ id: 'gge', name: 'G哥', kind: 'dsh', online: true });
  return hub;
}

function tempDir() {
  return mkdtempSync(join(tmpdir(), 'conest-team-'));
}

function writeStatus(dir, name, value) {
  writeFileSync(join(dir, name), typeof value === 'string' ? value : JSON.stringify(value));
}

function status(over = {}) {
  return {
    project: 'deep', name: '肥鱼', updated: new Date(NOW).toISOString(),
    sessions: [{ chat: '工作区1', task: '做 A', busy: true, since: new Date(NOW - 60_000).toISOString() }],
    ...over,
  };
}

function poll(hub, dir, options = {}) {
  new TeamStatus(hub, dir, { logger: quiet, now: () => NOW, ...options }).poll();
}

function member(hub, id = 'deep') {
  return hub.memberView().find(m => m.id === id);
}

test('presenceOf keeps every busy channel and summarizes the earliest start', () => {
  const p = presenceOf([status({
    sessions: [
      { chat: '工作区1', task: 'A', busy: true, since: new Date(NOW - 60_000).toISOString() },
      { chat: '工作区2', task: 'B', busy: true, since: new Date(NOW - 30_000).toISOString() },
      { chat: null, task: 'relay', busy: true, since: new Date(NOW - 90_000).toISOString() },
      { chat: '工作区1', task: 'finished', busy: false },
    ],
  })]);
  assert.equal(p.busy, true);
  assert.equal(p.busy_count, 3);
  assert.deepEqual(p.busy_chats, ['工作区1', '工作区2']);
  assert.equal(p.busy_items.length, 3);
  assert.equal(p.busy_chat, '工作区1');
  assert.equal(p.busy_task, 'A');
  assert.equal(p.busy_since, new Date(NOW - 90_000).toISOString());
  assert.equal(p.busy_items[2].chat, null);
});

test('presenceOf clears busy fields and keeps the last done time when idle', () => {
  const p = presenceOf([{ project: 'deep', sessions: [], done_at: '2026-11-03T12:30:00+08:00' }]);
  assert.equal(p.busy, false);
  assert.equal(p.busy_count, 0);
  assert.deepEqual(p.busy_chats, []);
  assert.equal(p.busy_since, null);
  assert.equal(p.busy_done_at, new Date('2026-11-03T12:30:00+08:00').toISOString());
  assert.equal(presenceOf([{ project: 'deep', sessions: null }]).busy, false);
});

test('poll maps by project id, publishes all channels, and emits only on change', () => {
  const hub = makeHub();
  const dir = tempDir();
  const events = [];
  hub.subscribe(event => events.push(event));
  writeStatus(dir, 'deep.json', status({
    sessions: [
      { chat: '工作区1', task: 'A', busy: true, since: new Date(NOW - 60_000).toISOString() },
      { chat: '工作区2', task: 'B', busy: true, since: new Date(NOW - 30_000).toISOString() },
    ],
  }));
  const poller = new TeamStatus(hub, dir, { logger: quiet, now: () => NOW });
  poller.poll();
  assert.equal(member(hub).busy, true);
  assert.equal(member(hub).busy_count, 2);
  assert.deepEqual(member(hub).busy_chats, ['工作区1', '工作区2']);
  assert.equal(events.filter(e => e.type === 'members').length, 1);

  poller.poll();
  assert.equal(events.filter(e => e.type === 'members').length, 1);
});

test('poll falls back to the display name and skips ambiguous names', () => {
  const hub = makeHub();
  const dir = tempDir();
  hub.setMember({ id: 'other', name: '肥鱼', kind: 'dsh', online: true });
  writeStatus(dir, 'z.json', status({ project: 'z', name: '肥鱼' }));
  poll(hub, dir);
  assert.equal(member(hub).busy, undefined);
  assert.equal(member(hub, 'other').busy, undefined);

  writeStatus(dir, 'deep.json', status({ project: 'deep', name: '不是肥鱼' }));
  poll(hub, dir);
  assert.equal(member(hub).busy, true, 'the id match must win over the name');

  writeStatus(dir, 'y.json', status({ project: 'y', name: '不存在' }));
  poll(hub, dir);
  assert.equal(member(hub).busy, true);
});

test('a stale or deleted status clears the previous busy state', () => {
  const hub = makeHub();
  const dir = tempDir();
  const poller = new TeamStatus(hub, dir, { logger: quiet, now: () => NOW });
  writeStatus(dir, 'deep.json', status());
  poller.poll();
  assert.equal(member(hub).busy, true);

  writeStatus(dir, 'deep.json', status({ updated: new Date(NOW - 61_000).toISOString() }));
  poller.poll();
  assert.equal(member(hub).busy, undefined);

  writeStatus(dir, 'deep.json', status());
  poller.poll();
  assert.equal(member(hub).busy, true);
  writeFileSync(join(dir, 'deep.json'), '{not json');
  poller.poll();
  assert.equal(member(hub).busy, true, 'a half-written file must not clear the last good state');
});

test('an unreadable directory clears the last busy state', () => {
  const hub = makeHub();
  const dir = tempDir();
  const poller = new TeamStatus(hub, dir, { logger: quiet, now: () => NOW });
  writeStatus(dir, 'deep.json', status());
  poller.poll();
  assert.equal(member(hub).busy, true);
  renameSync(dir, `${dir}-gone`);
  poller.poll();
  assert.equal(member(hub).busy, undefined);
});

test('start polls immediately and stop clears the timer', () => {
  const hub = makeHub();
  const dir = tempDir();
  writeStatus(dir, 'deep.json', status());
  const poller = new TeamStatus(hub, dir, { logger: quiet, now: () => NOW, intervalMs: 60_000 });
  poller.start();
  assert.equal(member(hub).busy, true);
  poller.stop();
  assert.equal(poller.timer, undefined);
});

test('poll ignores sessions:null, board files and a missing directory', () => {
  const hub = makeHub();
  const dir = tempDir();
  writeStatus(dir, 'deep.json', status({ sessions: null }));
  writeStatus(dir, 'board.json', status({ project: 'board' }));
  poll(hub, dir);
  assert.equal(member(hub).busy, false);

  poll(hub, join(dir, 'missing'));
  assert.equal(member(hub).busy, false);
});

test('setPresence is idempotent, clears on undefined, offline and removal', () => {
  const hub = makeHub();
  const events = [];
  hub.subscribe(event => events.push(event));
  hub.setPresence('deep', { busy: true, busy_count: 1, busy_chats: ['工作区1'] });
  assert.equal(member(hub).busy, true);
  const emitted = events.length;
  hub.setPresence('deep', { busy: true, busy_count: 1, busy_chats: ['工作区1'] });
  assert.equal(events.length, emitted);

  hub.setPresence('gge', { busy: true, busy_count: 1 });
  hub.setOnline('gge', false);
  assert.equal(member(hub, 'gge').busy, undefined);
  hub.setOnline('gge', true);
  hub.setPresence('gge', { busy: true, busy_count: 1 });
  hub.removeMember('gge');
  assert.equal(hub.memberView().some(m => m.id === 'gge'), false);

  hub.setPresence('deep', { busy: true, busy_count: 1 });
  hub.setError('deep', 'boom');
  assert.equal(member(hub).busy, undefined);
  hub.setError('deep', undefined);
  hub.setPresence('deep', { busy: true, busy_count: 1 });
  assert.equal(member(hub).busy, true);

  hub.setPresence('deep', undefined);
  assert.equal(member(hub).busy, undefined);
});

test('resolveConfig: explicit teamStatusDir, env, boardDir fallback, and off', () => {
  const base = { dataDir: '/tmp/a', workspacePath: '/tmp/b', leadFile: '/tmp/lead.json' };
  assert.equal(resolveConfig(base, {}).teamStatusDir, undefined);
  assert.equal(resolveConfig({ ...base, boardDir: '/tmp/team' }, {}).teamStatusDir, '/tmp/team');
  assert.equal(resolveConfig({ ...base, boardDir: '/tmp/team', teamStatusDir: '/tmp/explicit' }, {}).teamStatusDir, '/tmp/explicit');
  assert.equal(resolveConfig({ ...base, boardDir: '/tmp/team', teamStatusDir: '' }, {}).teamStatusDir, undefined);
  assert.equal(resolveConfig(base, { CONEST_TEAM_STATUS_DIR: '/tmp/env' }).teamStatusDir, '/tmp/env');
  assert.equal(resolveConfig({ ...base, boardDir: '/tmp/team' }, { CONEST_TEAM_STATUS_DIR: '' }).teamStatusDir, '/tmp/team');
  assert.throws(() => resolveConfig({ ...base, teamStatusDir: 'relative' }, {}), /teamStatusDir must be an absolute path/);
});

test('readStatusFile accepts null sessions and rejects a bad shape', () => {
  const dir = tempDir();
  writeStatus(dir, 'ok.json', status({ sessions: null }));
  assert.equal(readStatusFile(join(dir, 'ok.json'), NOW).entry.project, 'deep');
  writeStatus(dir, 'bad.json', { project: 'deep', updated: new Date(NOW).toISOString(), sessions: 'nope' });
  assert.equal(readStatusFile(join(dir, 'bad.json'), NOW).error, 'shape');
});