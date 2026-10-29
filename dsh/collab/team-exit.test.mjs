import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from './store.mjs';
import { Hub } from './hub.mjs';
import { TeamExit, exitMark, askEvidenceProblems, ASK_MISSING_SELF_CHECK, ASK_MISSING_CATEGORY, ASK_NO_CHECK_NOT_EXEMPT } from './team-exit.mjs';

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

test('askEvidenceProblems: what an [ask] body lacks', () => {
  const cases = [
    ['用 A 还是 B？', [ASK_MISSING_SELF_CHECK, ASK_MISSING_CATEGORY]],
    ['用 A 还是 B？\n类别：验收', [ASK_MISSING_SELF_CHECK]],
    ['用 A 还是 B？\n自验：go test 通过', [ASK_MISSING_CATEGORY]],
    ['合不合？\n自验：无需\n类别：验收', [ASK_NO_CHECK_NOT_EXEMPT]],
    ['选哪条路？\n自验：无需\n类别：方向', []],
    ['要充值\n自验：无需\n类别：花钱', []],
    ['看成片\n自验：无需\n类别：需要用户看的成品', []],
    ['点授权\n自验: 无需\n类别: 权限确认', []],
    ['合不合？\n自验：\n```\nok core\n```\n类别：验收', []],
    ['合不合？\n类别：验收\n自验：截图 /tmp/a.png', []],
    ['选哪条路？\n自验\u3000：无需\u3000\n类别\u3000：方向', []],
    ['合不合？\n自验：无需\u3000看过\n类别：验收', [ASK_NO_CHECK_NOT_EXEMPT]],
  ];
  for (const [body, want] of cases) assert.deepEqual(askEvidenceProblems(body), want, body);
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
    '[ask] #1 选哪条路？\n自验：无需\n类别：方向',
    '[ask] #1 要充值吗\n自验：无需\n类别：花钱',
    '[ask] #1 看下成片\n自验：无需\n类别：需要用户看的成品',
    '[ask] #1 点一下授权\n自验：无需\n类别：权限确认',
    '[ask] #1 PR #12 合不合？\n自验：node --test 输出 ok\n类别：验收',
  ];
  for (const a of asks) await say(a);
  assert.equal(back().length, 0);
  assert.equal(chat().length, asks.length);
  assert.ok(chat().every(m => /ask-[0-9a-f]{8}/.test(m.text)));
});

test('[report] needs no 自验 or 类别', async () => {
  const { say, chat, back } = setup();
  await say('[report] #1 第一阶段做完');
  assert.equal(back().length, 0);
  assert.match(chat()[0].text, /#1「修 CI」：第一阶段做完/);
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
