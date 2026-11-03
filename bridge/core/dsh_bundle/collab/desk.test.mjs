// #876 团队工作台 B 路：事件流尾随、回放接口、桌面页路由。
// 全部用临时 BOARD_DIR / 内存库，不碰线上任务板和频道库。
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, appendFileSync, truncateSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from './store.mjs';
import { readFileSync } from 'node:fs';
import { DeskEvents, deskReplay, deskRoute, readBoardEvents, BOARD_EVENTS_FILE, REPLAY_MAX } from './desk.mjs';
import { resolveConfig } from './plugin.mjs';

const quiet = { warn() {}, info() {} };

function boardDir() {
  return mkdtempSync(join(tmpdir(), 'desk-b-'));
}
function line(value) {
  return `${JSON.stringify(value)}\n`;
}
function fakeRes() {
  return {
    status: 0, headers: {}, body: '',
    writeHead(status, headers) { this.status = status; this.headers = headers ?? {}; },
    end(body) { this.body = body ?? ''; },
  };
}
function collectingHub() {
  const events = [];
  return { events, emit(event) { events.push(event); } };
}
function tick() {
  return new Promise(resolve => setImmediate(resolve));
}

test('desk: 启动前写好的事件不当成新光柱，启动后追加的才推进事件流', async () => {
  const dir = boardDir();
  const file = join(dir, BOARD_EVENTS_FILE);
  writeFileSync(file, line({ ts: '2026-11-03T12:00:00+08:00', id: '1', kind: 'created', from: 'lead', to: 'a' }));
  const hub = collectingHub();
  const desk = new DeskEvents(hub, { boardDir: dir, logger: quiet, intervalMs: 60_000 });
  desk.start();
  desk.stop();
  assert.deepEqual(hub.events, []);

  appendFileSync(file, line({ ts: '2026-11-03T12:00:05+08:00', id: '93', kind: 'assigned', from: 'cjiang', to: 'deep', title: 'B 路' }));
  desk.poll();
  assert.equal(hub.events.length, 1);
  assert.equal(hub.events[0].type, 'task');
  assert.equal(hub.events[0].id, '93');
  assert.equal(hub.events[0].kind, 'assigned');
  assert.equal(hub.events[0].from, 'cjiang');
  assert.equal(hub.events[0].to, 'deep');
  assert.equal(hub.events[0].title, 'B 路');
});

test('desk: 半行留到写完再发，坏行跳过不中断', () => {
  const dir = boardDir();
  const file = join(dir, BOARD_EVENTS_FILE);
  writeFileSync(file, '');
  const hub = collectingHub();
  const desk = new DeskEvents(hub, { boardDir: dir, logger: quiet });
  desk.start();
  desk.stop();

  const whole = line({ ts: '2026-11-03T12:01:00+08:00', id: '94', kind: 'returned', from: 'deep', to: 'cjiang' });
  appendFileSync(file, whole.slice(0, 12));
  desk.poll();
  assert.deepEqual(hub.events, []);

  appendFileSync(file, whole.slice(12));
  desk.poll();
  assert.equal(hub.events.length, 1);
  assert.equal(hub.events[0].kind, 'returned');

  appendFileSync(file, '{not json}\n' + line({ ts: '2026-11-03T12:01:02+08:00', id: '94', kind: 'done', from: 'cjiang', to: 'deep' }));
  desk.poll();
  assert.equal(hub.events.length, 2);
  assert.equal(hub.events[1].kind, 'done');
});

test('desk: 文件被截断后从头再读，不卡在半截 offset', () => {
  const dir = boardDir();
  const file = join(dir, BOARD_EVENTS_FILE);
  writeFileSync(file, line({ ts: '2026-11-03T12:02:00+08:00', id: '95', kind: 'created', from: 'lead', to: 'a' }));
  const hub = collectingHub();
  const desk = new DeskEvents(hub, { boardDir: dir, logger: quiet });
  desk.start();
  desk.stop();
  appendFileSync(file, line({ ts: '2026-11-03T12:02:01+08:00', id: '95', kind: 'assigned', from: 'lead', to: 'b' }));
  desk.poll();
  assert.equal(hub.events.length, 1);

  truncateSync(file, 0);
  writeFileSync(file, line({ ts: '2026-11-03T12:02:02+08:00', id: '96', kind: 'created', from: 'lead', to: 'c' }));
  desk.poll();
  assert.equal(hub.events.length, 2);
  assert.equal(hub.events[1].id, '96');
});

test('desk: 回放把板事件和房间消息按时间合并，窗口外的都不带', () => {
  const dir = boardDir();
  writeFileSync(join(dir, BOARD_EVENTS_FILE), [
    line({ ts: '2026-11-03T12:00:00+08:00', id: '93', kind: 'assigned', from: 'cjiang', to: 'deep', title: 'B 路' }),
    line({ ts: '2026-11-03T12:05:00+08:00', id: '93', kind: 'returned', from: 'deep', to: 'cjiang', title: 'B 路' }),
    line({ ts: '2026-11-03T13:00:00+08:00', id: '93', kind: 'done', from: 'cjiang', to: 'deep', title: 'B 路' }),
  ].join(''));
  const store = new Store(':memory:');
  store.ensureRoom(1, 'general');
  store.append(1, { authorKind: 'user', author: 'owner', name: '我', text: 'before' }, 1_000);
  store.append(1, { authorKind: 'role', author: 'deep', name: '肥鱼', text: 'in window' }, Date.parse('2026-11-03T12:02:00+08:00') / 1000);
  store.append(1, { authorKind: 'user', author: 'owner', name: '我', text: 'after' }, Date.parse('2026-11-03T14:00:00+08:00') / 1000);

  const replay = deskReplay({ store, boardDir: dir, from: '2026-11-03T11:59:00+08:00', to: '2026-11-03T12:10:00+08:00' });
  assert.deepEqual(replay.events.map(e => e.type === 'task' ? `task:${e.kind}` : `message:${e.message.text}`),
    ['task:assigned', 'message:in window', 'task:returned']);
  assert.equal(replay.from, '2026-11-03T03:59:00.000Z');
  assert.equal(replay.to, '2026-11-03T04:10:00.000Z');
});

test('desk: 回放缺参数或时间非法是 400，不是 500', () => {
  const store = new Store(':memory:');
  store.ensureRoom(1, 'general');
  const dir = boardDir();
  const bad = fakeRes();
  deskRoute({ method: 'GET' }, bad, new URL('http://x/collab/api/desk/replay?from=&to='), { store, boardDir: dir });
  assert.equal(bad.status, 400);
  assert.match(bad.body, /ISO/);

  const reversed = fakeRes();
  deskRoute({ method: 'GET' }, reversed, new URL('http://x/collab/api/desk/replay?from=2026-11-03T12:00:00Z&to=2026-11-03T11:00:00Z'), { store, boardDir: dir });
  assert.equal(reversed.status, 400);
  assert.match(reversed.body, /earlier/);
});

test('desk: /collab/desk 出页面，回放出 JSON，两条之外的路径不归它管', () => {
  const store = new Store(':memory:');
  store.ensureRoom(1, 'general');
  const dir = boardDir();
  const page = fakeRes();
  const handled = deskRoute({ method: 'GET' }, page, new URL('http://x/collab/desk'), { store, boardDir: dir });
  assert.equal(handled, true);
  assert.equal(page.status, 200);
  assert.match(page.headers['content-type'], /text\/html/);
  assert.match(page.body, /<html/i);

  const replay = fakeRes();
  deskRoute({ method: 'GET' }, replay, new URL('http://x/collab/api/desk/replay?from=2026-11-03T12:00:00Z&to=2026-11-03T12:10:00Z'), { store, boardDir: dir });
  assert.equal(replay.status, 200);
  assert.deepEqual(JSON.parse(replay.body).events, []);

  assert.equal(deskRoute({ method: 'GET' }, fakeRes(), new URL('http://x/collab/api/events'), { store, boardDir: dir }), undefined);
  assert.equal(deskRoute({ method: 'GET' }, fakeRes(), new URL('http://x/collab/desk'), { store, boardDir: dir }), true);
});

test('desk: 板事件超过一页时只留最近的一页', () => {
  const dir = boardDir();
  const lines = [];
  for (let i = 0; i < REPLAY_MAX + 20; i += 1) {
    lines.push(line({ ts: new Date(Date.UTC(2026, 10, 3, 4, 0, 0) + i * 1000).toISOString(), id: String(i), kind: 'created', from: 'lead', to: 'a' }));
  }
  writeFileSync(join(dir, BOARD_EVENTS_FILE), lines.join(''));
  const store = new Store(':memory:');
  store.ensureRoom(1, 'general');
  const replay = deskReplay({ store, boardDir: dir, from: '2026-11-03T04:00:00Z', to: '2026-11-03T06:00:00Z' });
  assert.equal(replay.events.length, REPLAY_MAX);
  assert.equal(replay.events.at(-1).id, String(REPLAY_MAX + 19));
});

test('desk: readBoardEvents 对缺失目录返回空，不抛', () => {
  assert.deepEqual(readBoardEvents(join(tmpdir(), 'definitely-not-there-876')), []);
  assert.deepEqual(readBoardEvents(undefined), []);
});

test('desk: boardDir 从配置或 BOARD_DIR 来，相对路径拒绝', () => {
  const base = { dataDir: '/tmp/x', workspacePath: '/tmp', leadFile: '/tmp/lead.json' };
  assert.equal(resolveConfig(base, {}).boardDir, undefined);
  assert.equal(resolveConfig(base, { BOARD_DIR: '/tmp/board' }).boardDir, '/tmp/board');
  assert.equal(resolveConfig({ ...base, boardDir: '/tmp/cfg' }, { BOARD_DIR: '/tmp/board' }).boardDir, '/tmp/cfg');
  assert.throws(() => resolveConfig({ ...base, boardDir: 'rel/board' }, {}), /absolute path/);
});
test('desk names: PUT saves a custom nametag, GET returns it, empty name restores default', async () => {
  const { mkdtempSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join: pjoin } = await import('node:path');
  const { Readable } = await import('node:stream');
  const { DESK_NAMES_FILE } = await import('./desk.mjs');
  const namesFile = pjoin(mkdtempSync(pjoin(tmpdir(), 'desk-names-')), 'sub', DESK_NAMES_FILE);
  const call = async (method, body) => {
    const req = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]);
    req.method = method;
    const res = fakeRes();
    await deskRoute(req, res, new URL('http://x/collab/api/desk/names'), { namesFile });
    return { status: res.status, body: JSON.parse(res.body) };
  };
  assert.deepEqual((await call('GET')).body, { names: {} });
  assert.deepEqual((await call('PUT', { id: 'cjiang', name: '  小橘  ' })).body, { names: { cjiang: '小橘' } });
  assert.deepEqual((await call('GET')).body, { names: { cjiang: '小橘' } });
  assert.equal((await call('PUT', { id: 'cjiang', name: 'x'.repeat(25) })).status, 400);
  assert.equal((await call('PUT', { name: 'a' })).status, 400);
  assert.deepEqual((await call('PUT', { id: 'cjiang', name: '' })).body, { names: {} });
});

test('roster defaults nametags to model names and keeps old nicknames as aliases', () => {
  const roster = JSON.parse(readFileSync(new URL('./desk/roster.json', import.meta.url), 'utf8'));
  const by = Object.fromEntries(roster.members.map(m => [m.project, m]));
  assert.equal(by.cjiang.name, 'Claude'); assert.ok(by.cjiang.aliases.includes('C酱'));
  assert.equal(by.deep.name, 'DeepSeek'); assert.ok(by.deep.aliases.includes('肥鱼'));
  assert.equal(by.gge.name, 'GPT'); assert.ok(by.gge.aliases.includes('G哥'));
  assert.equal(by.gjiang.name, 'Gemini'); assert.ok(by.gjiang.aliases.includes('大豆包'));
  assert.equal(by.grok.name, 'Grok');
  const page = readFileSync(new URL('./desk/index.html', import.meta.url), 'utf8');
  const embedded = JSON.parse(page.split('<script type="application/json" id="roster">')[1].split('</script>')[0]);
  assert.deepEqual(embedded, roster);
});
