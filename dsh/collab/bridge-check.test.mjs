// #1798: after an apply the plugin checks the bridge, gate, memory wiki and members, starts the gate when it is
// down, and says the result in #general once per state.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Bridge, blockingItems, checkPoster, wikiProblem } from './bridge.mjs';

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
