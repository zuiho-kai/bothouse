// Tests for the team desk page. The page is a single HTML file with inline CSS
// and JS, served by the B route (which serves index.html only). These tests read
// the shipped file, not a copy: inline roster/fixture must stay in sync with the
// artifacts next to it, and the event semantics that the page relies on must not
// silently regress.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createPreviewServer, DEMO_MEMBERS, fixtureEvents } from './preview.mjs';

const html = readFileSync(new URL('./index.html', import.meta.url), 'utf8');
const rosterFile = JSON.parse(readFileSync(new URL('./roster.json', import.meta.url), 'utf8'));
const rows = fixtureEvents();

function inlineJson(id) {
  const match = new RegExp('<script type="application/json" id="' + id + '">\\n([\\s\\S]*?)\\n</script>').exec(html);
  assert.ok(match, 'inline ' + id);
  return JSON.parse(match[1]);
}

test('inline roster equals roster.json and maps the six known members', () => {
  const inline = inlineJson('roster');
  assert.deepEqual(inline, rosterFile);
  assert.equal(inline.members.length, 6);
  assert.equal(inline.defaultAvatar, '');
  const byProject = Object.fromEntries(inline.members.map((m) => [m.project, m]));
  for (const project of ['gge', 'cjiang', 'deep', 'gjiang', 'cursor', 'grok']) assert.ok(byProject[project], project);
  assert.equal(byProject.gge.avatar, 'dragon');
  assert.equal(byProject.deep.name, '肥鱼');
  assert.equal(byProject.cursor.avatar, '', 'cursor must fall back to an initial badge');
  assert.equal(byProject.grok.avatar, '', 'grok must fall back to an initial badge');
  assert.doesNotMatch(JSON.stringify(inline), /cc-connect|\/Users\/|~\/|notes\/desk/, 'no internal paths in the shipped roster');
});

test('inline fixture equals fixture.sample.jsonl and keeps the dispatcher -> worker contract', () => {
  const inline = inlineJson('fixtureData');
  assert.equal(inline.length, 34, 'members + 21 task + thinking + message rows');
  const taskRows = inline.filter((row) => row.kind);
  assert.deepEqual(taskRows, rows);
  assert.equal(rows.length, 21);
  const membersEvent = inline.find((row) => row.type === 'members');
  assert.ok(membersEvent && membersEvent.members.length === 5);
  const ids = new Set(membersEvent.members.map((m) => m.id));
  let last = -Infinity;
  for (const row of taskRows) {
    assert.ok(row.id && row.title, 'shaped row');
    const ts = Date.parse(row.ts);
    assert.ok(Number.isFinite(ts));
    assert.ok(ts >= last, 'ordered');
    last = ts;
    if (row.kind === 'returned' || row.kind === 'done') {
      assert.equal(row.from, 'lead', 'from is the dispatcher');
      assert.ok(ids.has(row.to) && row.to !== 'lead', 'to is the worker');
    }
    for (const ref of [row.from, row.to]) if (ref) assert.ok(ids.has(ref), 'unknown member ' + ref);
  }
  assert.equal(inline.find((row) => row.id === '21' && row.kind === 'created').to, 'ayou');
  assert.equal(inline.find((row) => row.id === '25' && row.kind === 'created').to, '', 'created without an assignee');
  assert.equal(inline.find((row) => row.id === '25' && row.kind === 'assigned').to, 'ache');
});

test('page is self-contained and only talks to the three agreed endpoints', () => {
  assert.match(html, /<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"/);
  assert.match(html, /\/collab\/api\/state/);
  assert.match(html, /\/collab\/api\/events/);
  assert.match(html, /\/collab\/api\/desk\/replay/);
  assert.match(html, /id="roster"/);
  assert.match(html, /id="fixtureData"/);
  assert.doesNotMatch(html, /<script[^>]+src=/i);
  assert.doesNotMatch(html, /<link[^>]+stylesheet/i);
  assert.doesNotMatch(html, /fetch\([^)]*fixture\.sample\.jsonl/, 'fixture is inline; B serves index.html only');
  assert.doesNotMatch(html, /https?:\/\/[^\s"']+\.(png|css|js)\b/i);
});

test('event semantics: returned goes worker -> dispatcher, dispatch draws once, ids are indexed', () => {
  assert.match(html, /function workerAndDispatcher/);
  assert.match(html, /beam\(worker, dispatcher, 'return'\)/, 'return light must fly back to the dispatcher');
  assert.match(html, /function dispatchBeamOnce/);
  assert.match(html, /if \(!dispatchAllowed\(id, to\.id, S\.dispatched\)\) return;/, 'created+assigned must not draw twice in one assignment');
  assert.match(html, /kind === 'created' && from && animate\) dispatchBeamOnce/, 'created with an assignee is a dispatch');
  assert.match(html, /S\.byId\.set\(m\.id, m\)/, 'member index must be populated');
  assert.match(html, /state\.effective_lead_id \?\? state\.lead_id/, 'lead is read at runtime');
  assert.doesNotMatch(html, /S\.lead = 'gge'/);
});

test('@ 细光：流动虚线 + 小圆点走过，实时和回放共用同一条动画', () => {
  const beamFn = html.slice(html.indexOf('function beam('), html.indexOf('function flashSeat'));
  assert.match(beamFn, /P\.beams\.push\(\{ from: from\.id, to: to\.id, kind/, '流光进像素画布的飞行队列');
  assert.match(html, /if \(b\.kind === 'at' && i % 2\) continue;/, '@ 拖尾是细虚点');
  assert.match(html, /else if \(b\.kind === 'at'\) \{ px\(ctx, p\.x - 1, p\.y - 1, 2, 2/, '@ 光点是细小的一颗');
  const apply = html.slice(html.indexOf('function applyMessage'), html.indexOf('function applyEvent'));
  assert.match(apply, /beam\(author, target, 'at'\)/, '实时与回放都从 applyMessage 画 @');
  const step = html.slice(html.indexOf('function stepReplay'), html.indexOf('function startReplay'));
  assert.match(step, /applyEvent\(ev, true\)/, '回放播放也走动画，才能看到小圆点');
});

test('hidden 元素不被组件 display 覆盖（空态与回放条）', () => {
  assert.match(html, /\[hidden\]\{display:none!important\}/, 'hidden 必须有全局强制规则');
  assert.match(html, /\.empty\{[^}]*display:grid/, '空态组件自身会覆盖 hidden，正是回归来源');
  assert.match(html, /\.replaybar\{[^}]*display:flex/, '回放条自身会覆盖 hidden，正是回归来源');
});

test('回放模式断开实时 SSE，并丢弃在途回调', () => {
  const setMode = html.slice(html.indexOf('function setModeUI'), html.indexOf('async function goLive'));
  assert.match(setMode, /if \(!live\) \{ disconnectLive\(\); setConn\('replay', '回放模式'\); \}/);
  assert.match(html, /if \(S\.es !== es \|\| S\.mode !== 'live'\) return;/, '旧连接或回放中的回调必须丢弃');
  const load = html.slice(html.indexOf('async function loadReplayWindow'), html.indexOf('async function loadFixture'));
  assert.match(load, /setModeUI\('replay'\)/, '载入回放先切模式并断流');
  const boot = html.slice(html.indexOf('async function boot'), html.lastIndexOf('boot();'));
  assert.match(boot, /if \(from && to\)[\s\S]*?setModeUI\('replay'\)[\s\S]*?await loadReplayWindow\(false\);[\s\S]*?return;/, '时间窗入口直接进回放');
  assert.ok(boot.indexOf("setModeUI('replay')") < boot.indexOf('await goLive()'), '时间窗入口不应先连实时');
});

test('派活去重只限同一次派活，交回/打回后可再次画光', () => {
  const block = html.split('// <dispatch-model>')[1]?.split('// </dispatch-model>')[0];
  assert.ok(block, 'dispatch model block');
  const model = new Function(block + '\nreturn { dispatchKey, dispatchAllowed, forgetDispatch };')();
  const set = new Set();
  assert.equal(model.dispatchAllowed('21', 'ayou', set), true, 'first dispatch draws');
  set.add(model.dispatchKey('21', 'ayou'));
  assert.equal(model.dispatchAllowed('21', 'ayou', set), false, 'created+assigned same cycle draws once');
  assert.equal(model.dispatchAllowed('21', 'ache', set), true, 'another worker is a different dispatch');
  model.forgetDispatch('21', set);
  assert.equal(set.size, 0, 'return/reject clears only this task keys');
  assert.equal(model.dispatchAllowed('21', 'ayou', set), true, 're-dispatch after return draws again');
  assert.equal((html.match(/forgetDispatch\(id, S\.dispatched\)/g) ?? []).length, 3, 'returned/rejected/paused-done end the cycle');
});

test('preview server: page, state and replay window', async () => {
  const server = createPreviewServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  try {
    const page = await fetch(base + '/collab/desk');
    assert.equal(page.status, 200);
    assert.match(page.headers.get('content-type') ?? '', /text\/html/);
    assert.match(await page.text(), /团队工作台/);

    const state = await (await fetch(base + '/collab/api/state')).json();
    assert.equal(state.members.length, 5);
    assert.equal(state.effective_lead_id, 'lead');

    const from = encodeURIComponent('2026-11-03T09:02:00+08:00');
    const to = encodeURIComponent('2026-11-03T09:14:00+08:00');
    const replay = await (await fetch(base + '/collab/api/desk/replay?from=' + from + '&to=' + to)).json();
    assert.equal(replay.events.length, 4);
    assert.ok(replay.events.every((e) => e.type === 'task' && e.kind));
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
