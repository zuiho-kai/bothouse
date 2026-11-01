import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from './store.mjs';
import { Hub } from './hub.mjs';
import { readFileSync } from 'node:fs';
import { TeamExit, RULES, jargonProblems, exitMark, askEvidenceProblems, judgeExit, exitTaskPick, exitBounceText, exitSplit } from './team-exit.mjs';

const tick = () => new Promise(r => setImmediate(r));

function setup() {
  const store = new Store(':memory:');
  store.ensureRoom(1, 'general');
  const hub = new Hub(store, { warn() {}, info() {} });
  hub.setMember({ id: 'owner', name: 'Owner', kind: 'human', online: true });
  hub.setMember({ id: 'ds', name: 'DeepSeek', kind: 'dsh', online: true });
  const woken = [];
  hub.tasks = { wakers: [(id, m) => { woken.push([id, m.id]); return true; }], task: id => (id === 1 ? { id: 1, title: '修 CI' } : undefined) };
  const exit = new TeamExit(hub);
  const ws = store.createWorkspace(1);
  const say = async text => { hub.post(ws.id, { authorKind: 'role', author: 'ds', name: 'DeepSeek', text }); await tick(); };
  const chat = () => store.page(1, undefined, 50).filter(m => m.author_kind === 'system');
  const back = () => store.page(ws.id, undefined, 50).filter(m => m.author_kind === 'system');
  return { hub, exit, ws, say, chat, back, woken };
}

// The shared cases: the Go bridge runs the same file (bridge/core/team_exit_rules_test.go
// TestTeamExitSharedCases), so a rule judged differently on either side fails one of them.
const CASES = JSON.parse(readFileSync(new URL('./test/team-exit-cases.json', import.meta.url), 'utf8'));
const ruleText = ref => {
  const [key, id = ''] = ref.split(':');
  const [group, name] = key.split('.');
  const text = RULES[group]?.[name];
  assert.equal(typeof text, 'string', `case names rule ${ref}`);
  return text.replaceAll('{id}', id).replaceAll('{hits}', id);
};

test('shared cases: [ask] self-check', () => {
  for (const c of CASES.evidence) assert.deepEqual(askEvidenceProblems(c.body), c.want.map(ruleText), c.body);
});

test('shared cases: judging a marked reply', () => {
  for (const c of CASES.judge) {
    const mark = exitMark(c.reply);
    assert.equal(mark?.kind ?? '', c.want.kind, c.name);
    if (!mark) continue;
    const v = judgeExit(mark.kind, mark.body, { known: id => c.known.includes(id), bounces: c.bounces });
    assert.deepEqual(v, { id: c.want.id, line: c.want.line, problems: c.want.problems.map(ruleText), legacy: c.want.legacy }, c.name);
  }
});

test('shared cases: splitting the parts from the details', () => {
  for (const c of CASES.split) assert.deepEqual(exitSplit(c.body), c.want, c.body);
});

test('shared cases: which task a reply is about', () => {
  for (const c of CASES.pick) assert.equal(exitTaskPick(c.named, c.items), c.want, c.name);
});

test('shared cases: bounce text', () => {
  for (const c of CASES.bounce) assert.equal(exitBounceText(c.kind, c.problems), c.want);
});

for (const [name, text, want] of [
  ['missing 自验', '[ask]\n用 A 还是 B？\n类别：验收', '缺「自验：」'],
  ['missing 类别', '[ask]\n用 A 还是 B？\n自验：go test 通过', '缺「类别：」'],
  ['自验：无需 outside the four', '[ask]\n合不合？\n自验：无需\n类别：验收', '「自验：无需」只限'],
]) {
  test(`[ask] ${name} goes back to the workspace, not the chat channel`, async () => {
    const { say, chat, back, woken, hub } = setup();
    await say(text);
    assert.equal(chat().length, 0);
    const [notice] = back();
    assert.ok(notice, 'bounce notice posted in the workspace');
    assert.match(notice.text, new RegExp(want));
    assert.match(notice.text, /@DeepSeek/);
    assert.deepEqual(woken, [['ds', notice.id]], 'asking member woken on the notice');
    assert.equal(hub.store.db.prepare('SELECT COUNT(*) n FROM team_exit_asks').get().n, 0);
  });
}

test('complete [ask] in each of the four categories, or with evidence, reaches the chat channel', async () => {
  const { say, chat, back } = setup();
  const asks = [
    '选哪条路？\n自验：无需\n类别：方向',
    '要充值吗\n自验：无需\n类别：花钱',
    '看下成片\n自验：无需\n类别：需要用户看的成品',
    '点一下授权\n自验：无需\n类别：权限确认',
    '这个改动合不合？\n自验：node --test 输出 ok\n类别：验收',
  ].map(q => `[ask] #1 背景：你让我修 CI。\n两条路都试过了。\n要你定的：${q.replace("\n", "\n我加的：无\n")}`);
  for (const a of asks) await say(a);
  assert.equal(back().length, 0);
  const parts = chat().filter(m => !m.text.startsWith('📬 细节'));
  assert.equal(parts.length, asks.length);
  assert.ok(parts.every(m => /ask-[0-9a-f]{8}/.test(m.text)));
});

test('[report] needs no 自验 or 类别', async () => {
  const { say, chat, back } = setup();
  await say('[report] #1 背景：你让我修 CI。\n第一阶段做完，已经上线。\n要你做的：没有。\n我加的：无\n\n细节：\n跑了 node --test');
  assert.equal(back().length, 0);
  assert.equal(chat()[0].text, '📬「修 CI」\n背景：你让我修 CI。\n第一阶段做完，已经上线。\n要你做的：没有。\n我加的：无');
  assert.match(chat()[1].text, /^📬 细节「修 CI」[^\n]*\n跑了 node --test$/);
});

test('only two bounces in a row wake the member; a good ask resets', async () => {
  const { say, woken, back } = setup();
  for (let i = 0; i < 3; i++) await say(`[ask]\n问一下 ${i}`);
  assert.equal(back().length, 3);
  assert.equal(woken.length, 2);
  await say('[ask]\n选哪个\n自验：无需\n类别：方向');
  await say('[ask]\n又问');
  assert.equal(woken.length, 3);
});

test('a plain reply between bounces resets the count; the next bad ask wakes again', async () => {
  const { say, woken, back } = setup();
  await say('[ask]\n问一下 1');
  await say('[ask]\n问一下 2');
  assert.equal(woken.length, 2);
  await say('好，我先自己查一下');
  await say('[ask]\n又问');
  assert.equal(back().length, 3);
  assert.equal(woken.length, 3, 'third bounce still wakes after a plain reply');
});

test('a mark on a later line counts only for a DSH member (lastLine); the bridge reads the first line only', async () => {
  const text = '【接】#3\n\n先说明格式\n[report]\n做完了';
  assert.equal(exitMark(text), undefined, 'first line only by default, as core/team_exit.go parseExitKind');
  assert.deepEqual(exitMark(text, { lastLine: true }), { kind: 'report', body: '做完了' });
  const { hub, ws, chat, back } = setup();
  hub.setMember({ id: 'bot', name: 'Bot', kind: 'cloud-web', online: true });
  hub.post(ws.id, { authorKind: 'role', author: 'bot', name: 'Bot', text: '解释一下格式：\n[ask] 开头的行是提问' });
  await tick();
  assert.equal(chat().length, 0, 'a bridge bot\'s reply with [ask] mid-text is neither forwarded nor bounced');
  assert.equal(back().length, 0);
});

test('jargon permits product names and complete links', () => {
  for (const text of ['DeepSeek 与 OpenClaw 并排图已补', '邀请：https://discord.gg/fooBar，文档 https://example.com/a-b/file.md#123']) assert.deepEqual(jargonProblems(text), []);
});
test('jargon still rejects internal identifiers outside links', () => {
  for (const text of ['fooBar', '~/x/y', '#123', 'https://discord.gg/ok 后面 fooBar']) assert.equal(jargonProblems(text).length, 1);
});
