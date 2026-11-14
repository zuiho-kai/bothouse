import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from './store.mjs';
import { Hub } from './hub.mjs';
import { readFileSync } from 'node:fs';
import { TeamExit, RULES, jargonProblems, lengthProblems, exitMark, askEvidenceProblems, selfRouteProblems, judgeExit, exitTaskPick, exitBounceText, exitSplit } from './team-exit.mjs';

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
  const say = async text => { const { message } = hub.post(ws.id, { authorKind: 'role', author: 'ds', name: 'DeepSeek', text }); await tick(); return message; };
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

test('self-route check rejects sudo asks and reports, while payment asks pass', async () => {
  const { exit, say, chat, back } = setup();
  const sudoAsk = '[ask] #1 背景：你让我做隔离验收。\n选择好了。\n要你做的：请在本机终端跑这一句 sudo。\n我加的：无\n自验：没有运行\n类别：验收';
  const ask = await say(sudoAsk);
  assert.equal(chat().length, 0);
  assert.match(back().at(-1).text, /先换路/);
  assert.equal(exit.consumeRejected(ask.id), true, 'a rejected ask cannot proceed through task handling');

  await say('[report] #1 背景：你让我完成验收。\n已完成。\n要你做的：请在终端运行 sudo。\n我加的：无');
  assert.equal(chat().length, 0, 'the report does not reach the chat channel');
  assert.match(back().at(-1).text, /先换路/);

  await say('[ask] #1 背景：你让我确认设备下单。\n选好了。\n自验：无需\n类别：花钱\n要你做的：请确认付款 ¥320 下单打板。\n我加的：无');
  assert.equal(back().length, 2, 'the payment ask is not bounced');
  assert.equal(chat().length, 1, 'the payment ask reaches the chat channel');
});

test('self-route helper uses the existing rule text and ignores user-only actions', () => {
  const problem = selfRouteProblems('[report]\n要你做的：在本机终端跑一次 sudo');
  assert.equal(problem.length, 1);
  assert.match(problem[0], /「要你做的」把能自己做的事/);
  assert.deepEqual(selfRouteProblems('[ask]\n要你做的：确认付款 ¥320 下单打板'), []);
});

test('self-route report is forwarded with its check note after the repair wake limit', async () => {
  const { say, chat, back } = setup();
  const report = '[report] #1 背景：你让我完成验收。\n已完成。\n要你做的：请在终端运行 sudo。\n我加的：无';
  await say(report);
  await say(report);
  assert.equal(chat().length, 0);
  await say(report);
  assert.equal(back().length, 2);
  assert.equal(chat().length, 1);
  assert.match(chat()[0].text, /先换路/);
  assert.match(chat()[0].text, /请在终端运行 sudo/);
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

test('a part over two sentences goes back, never cut (11-10「为什么回复那么长」)', () => {
  const long = '背景：一。二。三。\n做了。上线了。\n要你做的：没有。\n我加的：无';
  const p = lengthProblems(long);
  assert.equal(p.length, 1);
  assert.ok(p[0].includes('「背景」那段写了 3 句'));
  assert.deepEqual(lengthProblems('背景：修汇报。\n改好了。已上线。要你做的：没有。\n我加的：无'), []);
});

test('a name the task was asked with is not jargon in its report (DSH walk 11-14: 「写个 hello.py」)', async () => {
  assert.deepEqual(jargonProblems('已写好 hello.py 并跑通', '帮我写个 hello.py，打印当前时间'), []);
  assert.equal(jargonProblems('已写好 hello.py 和 util.py', '帮我写个 hello.py').length, 1, 'a name the user never wrote still goes back');
  const { hub, say, chat, back } = setup();
  hub.tasks.task = id => (id === 1 ? { id: 1, title: '帮我写个 hello.py，打印当前时间' } : undefined);
  await say('[report] #1 背景：你让我写个 hello.py 打印时间。\n写好跑通了，输出是当前时间。\n要你做的：没有。\n我加的：无');
  assert.equal(back().length, 0, 'no bounce for the user\'s own word');
  assert.match(chat()[0].text, /hello\.py/);
});

test('walk 11-14: a DSH member\'s [report] is not bounced for wording, since Tasks hands it back and copies it anyway', async () => {
  const { say, back, woken } = setup();
  await say('[report] #1 背景：你让我修 CI。\n改了 `ci.yml` 和 fooBar。\n要你做的：没有。\n我加的：无');
  assert.equal(back().length, 0, 'no 「没有转给用户」 notice for a report that does reach the channel');
  assert.deepEqual(woken, [], 'the member is not woken to rewrite it');
});
