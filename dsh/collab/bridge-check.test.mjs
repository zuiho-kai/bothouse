// #1798: after an apply the plugin checks the bridge, gate, memory wiki and members, starts the gate when it is
// down, and says the result in #general once per state.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Bridge, blockingItems, checkPoster, prepText, wikiProblem } from './bridge.mjs';

/** A fake bridge management server; gate: { running, status }, start: what POST /setup/gate/start answers. */
async function fakeBridge({ gate, start }) {
  const calls = [];
  const srv = createServer((req, res) => {
    calls.push(`${req.method} ${req.url}`);
    const send = data => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ ok: true, data })); };
    if (req.url === '/api/v1/status') return send({ version: 'x' });
    if (req.url === '/api/v1/setup/gate') return send({ gate });
    if (req.url === '/api/v1/setup/gate/start' && req.method === 'POST') { if (start.started) gate = { running: true, status: 'running' }; return send(start); }
    res.writeHead(404); res.end();
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const dir = mkdtempSync(join(tmpdir(), 'bridge-check-'));
  const configFile = join(dir, 'config.toml');
  writeFileSync(configFile, `[management]\nenabled = true\nhost = "127.0.0.1"\nport = ${srv.address().port}\ntoken = "t"\n`);
  return { calls, dir, configFile, close: () => srv.close() };
}

const members = [{ id: 'm-dsh', name: 'DSH' }, { id: 'm-codex', name: 'Codex', cli: 'codex' }];

test('self-check: a stopped gate is started, everything good says 装好了 once', async () => {
  const f = await fakeBridge({ gate: { running: false, status: 'starting' }, start: { running: true, started: true, reason: '' } });
  try {
    const b = new Bridge({ dataDir: f.dir, configFile: f.configFile, members: () => members, online: () => true, checkWait: 0, checkPoll: 1 });
    const r = await b.selfCheck([{ step: 'wiki cron', ok: true, detail: 'already there' }]);
    assert.equal(r.ok, true, JSON.stringify(r.items));
    assert.ok(f.calls.includes('POST /api/v1/setup/gate/start'), 'the gate was started');
    const posted = [];
    const post = checkPoster({ post: (room, m) => posted.push([room, m]) }, () => 1, join(f.dir, 'self-check.json'));
    assert.equal(post(r), true);
    assert.equal(post(r), false, 'the same state is said once');
    assert.equal(posted[0][0], 1);
    assert.match(posted[0][1].text, /^装好了.*DSH、Codex/);
    assert.equal(posted[0][1].authorKind, 'system');
  } finally { f.close(); }
});

test('self-check: says where it is stuck, in plain words', async () => {
  const f = await fakeBridge({ gate: { running: false, status: 'python_missing' }, start: { running: false, started: false, reason: 'python_missing' } });
  try {
    const b = new Bridge({ dataDir: f.dir, configFile: f.configFile, members: () => members, online: id => id === 'm-dsh', checkWait: 0, checkPoll: 1 });
    const r = await b.selfCheck([{ step: 'role 1 wiki', ok: false, detail: 'git not found' }]);
    assert.equal(r.ok, false);
    const posted = [];
    checkPoster({ post: (_room, m) => posted.push(m.text) }, () => 1, join(f.dir, 'self-check.json'))(r);
    assert.match(posted[0], /记忆服务没起来：本机缺 Python/);
    assert.match(posted[0], /记忆 wiki 没建好：git not found/);
    assert.match(posted[0], /成员没连上：Codex/);
    assert.doesNotMatch(posted[0], /后台服务没起来/);
  } finally { f.close(); }
});

test('self-check: no bridge answering is the first thing said', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'bridge-check-'));
  const b = new Bridge({ dataDir: dir, configFile: join(dir, 'none.toml'), members: () => members, online: () => true, checkWait: 0, checkPoll: 1 });
  const r = await b.selfCheck([]);
  assert.equal(r.ok, false);
  assert.match(r.items.find(i => i.key === 'service').why, /后台服务没起来/);
});

test('wikiProblem reads the apply steps', () => {
  assert.equal(wikiProblem([{ step: 'wiki cron', ok: true, detail: 'added: wiki ingest' }, { step: 'team', ok: false, detail: 'x' }]), '');
  assert.equal(wikiProblem([{ step: 'role 2 memory_index', ok: false, detail: 'no wiki' }]), 'no wiki');
  assert.match(wikiProblem([{ step: 'wiki cron', ok: true, detail: '跳过：没有主 wiki（/h/wiki 里没有 bin/ingest.py），所以没加 wiki 整理定时' }]), /没有主 wiki/);
  assert.equal(wikiProblem([{ step: 'wiki cron', ok: true, detail: 'skipped: the main wiki /h/wiki was not made by the wizard (searched, never written), so the wiki cron jobs were not added' }]), '');
});

test('#1798 self-check: a blocking apply warning (CLI not logged in) is where it is stuck, not 装好了', async () => {
  const f = await fakeBridge({ gate: { running: true, status: 'running' }, start: { running: true, started: true, reason: '' } });
  try {
    const ms = [{ id: 'm-dsh', name: 'DSH' }, { id: 'claude-code', name: 'Claude Code', cli: 'claude' }];
    const b = new Bridge({ dataDir: f.dir, configFile: f.configFile, members: () => ms, online: () => true, checkWait: 0, checkPoll: 1 });
    // The shape of a real apply answer (runs/1798/evidence/bothouse-apply.log).
    const warnings = [
      { code: 'reply_language_default', project: 'm-dsh', blocking: false, message: 'No reply language was given', fix: 'x' },
      { code: 'agent_not_logged_in', project: 'claude-code', blocking: true, message: '「Claude Code」用本机的 Claude Code，但它还没登录：登录之前机器人收到消息也答不出来。', fix: '在这台机器的终端运行 claude auth login（或运行 claude 后输入 /login），按提示登录；没有浏览器时…' },
    ];
    const r = await b.selfCheck([], undefined, warnings);
    assert.equal(r.ok, false, 'a member that cannot answer is not 装好了');
    const posted = [];
    checkPoster({ post: (_room, m) => posted.push(m.text) }, () => 1, join(f.dir, 'self-check.json'))(r);
    assert.match(posted[0], /^还没完全装好/);
    assert.match(posted[0], /- Claude Code 还没登录：在终端运行 claude，按提示登录一次/);
    assert.doesNotMatch(posted[0], /装好了：|都已在线|reply language/);
  } finally { f.close(); }
  // Unknown codes and members fall back to the bridge's own words, cut to the first sentence.
  assert.deepEqual(blockingItems([{ code: 'x_missing', project: 'p', blocking: true, message: '缺了 X。', fix: '装上 X；再试' }]).map(i => i.why), ['缺了 X：装上 X']);
});

test('#1798 blockingItems: one login item per member named in the warning, with its id and hint', () => {
  const ms = [{ id: 'cx', name: 'Codex', cli: 'codex' }, { id: 'cx2', name: '小码', cli: 'codex' }];
  const items = blockingItems([{ code: 'agent_not_logged_in', project: 'Codex,小码', blocking: true, message: 'x', fix: 'y' }], ms);
  assert.deepEqual(items.map(i => [i.member, i.hint]), [['cx', '在终端运行 codex login，按提示登录一次'], ['cx2', '在终端运行 codex login，按提示登录一次']]);
});

// The stand-in bothouse is a /bin/sh script, which Windows cannot spawn.
test('#1798 first start: no bridge running → progress steps, then 准备好了 and the result said even if said before', { skip: process.platform === 'win32' }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'bridge-prep-'));
  const bin = join(dir, 'bothouse');
  // A stand-in bothouse: setup apply answers saved with one blocking warning; nothing else answers.
  writeFileSync(bin, `#!/bin/sh\n/bin/cat >/dev/null\necho '{"saved":true,"steps":[],"warnings":[{"code":"agent_not_logged_in","project":"Codex","blocking":true,"message":"m","fix":"f"}]}'\n`, { mode: 0o755 });
  const b = new Bridge({ dataDir: dir, configFile: join(dir, 'none.toml'), origin: () => 'http://127.0.0.1:1', token: 't', members: () => members,
    online: () => false, env: { PATH: dir, HOME: dir }, checkWait: 0, checkPoll: 1 });
  b.start = () => {};
  const steps = [];
  const blocking = [];
  b.onProgress = p => steps.push(prepText(p));
  b.onBlocking = items => blocking.push(...items.map(i => i.member));
  const said = new Promise(resolve => { b.onCheck = (result, force) => resolve({ result, force }); });
  await b.apply();
  const { result, force } = await said;
  assert.equal(b.preparing, false);
  assert.equal(force, true, 'the progress line points at the result, so it is said again');
  assert.equal(result.ok, false);
  assert.deepEqual(blocking, ['m-codex']);
  assert.match(steps[0], /正在写成员和记忆 wiki/);
  assert.match(steps[1], /正在起后台服务/);
  assert.match(steps.at(-1), /^准备结束（用时 \d+ 秒）/);
  const posted = [];
  const post = checkPoster({ post: (_room, m) => posted.push(m.text) }, () => 1, join(dir, 'self-check.json'));
  post(result);
  assert.equal(post(result), false);
  assert.equal(post(result, true), true);
  assert.equal(prepText({ stage: 'done', seconds: 78 }), '准备好了（用时 78 秒）');
  assert.match(prepText({ stage: 'members', online: 1, total: 2 }), /成员上线 1\/2/);
});

// #1884 (user「后台挂了插件自己拉起来」): a member dropped and the bridge no longer answers → it is started again.
test('#1884 revive: the bridge is gone → started again; up again → nothing said', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'bridge-revive-'));
  writeFileSync(join(dir, 'bothouse'), '#!/bin/sh\n', { mode: 0o755 });
  const configFile = join(dir, 'config.toml');
  writeFileSync(configFile, '[management]\nenabled = true\nhost = "127.0.0.1"\nport = 1\ntoken = "t"\n');
  const b = new Bridge({ dataDir: dir, configFile, members: () => members, env: { PATH: dir, HOME: dir }, checkWait: 1_000, checkPoll: 1, reviveWait: 1 });
  b.first = false;
  let srv;
  const started = [];
  // The stand-in start brings up a management server that answers /status, as the real bridge does.
  b.start = (bin) => {
    started.push(bin);
    srv = createServer((_req, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"ok":true,"data":{}}'); });
    srv.listen(0, '127.0.0.1', () => writeFileSync(configFile, `[management]\nenabled = true\nhost = "127.0.0.1"\nport = ${srv.address().port}\ntoken = "t"\n`));
    return new Promise(() => {});
  };
  const said = [];
  b.onCheck = r => said.push(r);
  try {
    await b.revive();
    assert.deepEqual(started, [join(dir, 'bothouse')]);
    assert.deepEqual(said, [], 'it came up, so nothing is said');
    await b.revive();
    assert.equal(started.length, 1, 'a bridge that answers is not started again');
    b.noKey = true;
    srv.close();
    await b.revive();
    assert.equal(started.length, 1, 'no key: the key card is in charge, not a restart');
  } finally { srv?.close(); }
});

test('#1884 revive: a bridge that exits at once is said in #general with its log', { skip: process.platform === 'win32' }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'bridge-revive-'));
  writeFileSync(join(dir, 'bothouse'), '#!/bin/sh\necho "config.toml: bad port" >&2\nexit 3\n', { mode: 0o755 });
  writeFileSync(join(dir, 'bothouse.log'), 'level=INFO msg=bye\n');
  const b = new Bridge({ dataDir: dir, configFile: join(dir, 'none.toml'), members: () => members, env: { PATH: dir, HOME: dir }, checkWait: 10_000, checkPoll: 50, reviveWait: 1 });
  b.first = false;
  const said = [];
  b.onCheck = r => said.push(r);
  await b.revive();
  assert.equal(said.length, 1);
  const posted = [];
  checkPoster({ post: (_room, m) => posted.push(m.text) }, () => 1, join(dir, 'self-check.json'))(said[0]);
  assert.match(posted[0], /后台服务停了，自动重新启动后马上退出了（退出码 3）：config\.toml: bad port/);
  assert.doesNotMatch(posted[0], /msg=bye/, 'the stopped bridge\'s own lines are not the reason');
});
