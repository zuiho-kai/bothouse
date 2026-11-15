// #876 P 路：角色之间 @ 对方时的细光。
// 回放接口只给原文（#1662：@ 由桥解析，插件不再解析），
// 页面画细光；实时事件没有这个字段时，页面从文本认的规则也不能比 hub 宽（代码块不算、最长名优先）。
// 页面是单文件内联 JS，这里把 applyMessage 抽出来用桩跑，测的是随包发出的那份源码。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Store } from './store.mjs';
import { deskReplay } from './desk.mjs';

const MEMBERS = [
  { id: 'deep', name: '肥鱼' },
  { id: 'cjiang', name: 'C酱' },
  { id: 'ayu', name: '阿柚' },
  { id: 'ayuzi', name: '阿柚子' },
];

/** 临时库 + 一条房间消息，返回 (from, to) 时间窗和库。 */
function roomWith(text, author = 'deep', name = '肥鱼', kind = 'role') {
  const store = new Store(':memory:');
  store.ensureRoom(1, 'general');
  const message = store.append(1, { authorKind: kind, author, name, text }).message;
  const at = new Date(message.created_at * 1000);
  return { store, from: new Date(at.getTime() - 60_000).toISOString(), to: new Date(at.getTime() + 60_000).toISOString() };
}

function replay(store, from, to, members = MEMBERS) {
  return deskReplay({ store, boardDir: undefined, from, to, members });
}

test('回放不再带 mentions：谁被叫到由桥判断（#1662），页面自己从文本认来画', () => {
  const { store, from, to } = roomWith('@C酱 这份发布说明你看下，另外 @阿柚 别改');
  const event = replay(store, from, to).events.find(e => e.type === 'message');
  assert.equal('mentions' in event.message, false);
  assert.equal(event.message.text, '@C酱 这份发布说明你看下，另外 @阿柚 别改', '原文不动');
});

/** 从随包 index.html 抽出 applyMessage 源码，用桩执行；测的是真正发出去的那份。 */
function loadApplyMessage() {
  const html = readFileSync(new URL('./desk/index.html', import.meta.url), 'utf8');
  const start = html.indexOf('function applyMessage(ev, animate = true) {');
  assert.ok(start > 0, 'applyMessage found');
  const end = html.indexOf('\nfunction applyEvent(', start);
  assert.ok(end > start, 'applyMessage end found');
  const source = html.slice(start, end);
  assert.doesNotMatch(source, /\bdocument\.|\bwindow\./, 'applyMessage 不碰 DOM，才能这样测');
  return new Function('S', 'resolveRef', 'beam', 'addLog', 'displayName', 'slipFrom', source + '\nreturn applyMessage;');
}

function harness(members = [{ id: 'deep', name: '肥鱼' }, { id: 'cjiang', name: 'C酱' }, { id: 'ayu', name: '阿柚' }, { id: 'ayuzi', name: '阿柚子' }]) {
  const beams = [];
  const logs = [];
  const slips = [];
  const S = { byId: new Map(members.map(m => [m.id, m])), memberList: members, rosterFor: new Map() };
  const make = loadApplyMessage();
  const applyMessage = make(S, ref => S.byId.get(ref), (a, b, kind) => beams.push([a.id, b.id, kind]), (...args) => logs.push(args), m => m.name, id => slips.push(id));
  return { beams, logs, slips, apply: (message, animate = true) => applyMessage({ type: 'message', message }, animate) };
}

test('页面：回放给的 mentions 直接画细光，不依赖文本里还有没有 @', () => {
  const h = harness();
  h.apply({ id: 7, author: 'deep', name: '肥鱼', author_kind: 'role', text: '（内容已被改写）', mentions: ['cjiang', 'ayu'] });
  assert.deepEqual(h.beams, [['deep', 'cjiang', 'at'], ['deep', 'ayu', 'at']]);
  assert.equal(h.logs.length, 1);
});

test('页面：mentions 里自己不算，未知 id 跳过', () => {
  const h = harness();
  h.apply({ author: 'deep', author_kind: 'role', text: 'x', mentions: ['deep', 'nobody', 'ayu'] });
  assert.deepEqual(h.beams, [['deep', 'ayu', 'at']]);
});

test('页面：实时事件没有 mentions 时按文本认，代码块里的不画', () => {
  const h = harness();
  h.apply({ author: 'deep', author_kind: 'role', text: '```\n@C酱\n```\n真正的 @阿柚' });
  assert.deepEqual(h.beams, [['deep', 'ayu', 'at']], '只画代码块外那个');
});

test('页面：文本认法也最长优先，@阿柚子 不点亮阿柚', () => {
  const h = harness();
  h.apply({ author: 'deep', author_kind: 'role', text: '@阿柚子 接一下' });
  assert.deepEqual(h.beams, [['deep', 'ayuzi', 'at']]);
});

test('页面：主人发的消息和没 @ 的消息都不画，回放里 animate=false 只记日志', () => {
  const h = harness();
  h.apply({ author: 'deep', author_kind: 'user', text: '@C酱 看下' });
  h.apply({ author: 'deep', author_kind: 'role', text: '没有找人' });
  assert.deepEqual(h.beams, []);
  h.apply({ author: 'deep', author_kind: 'role', text: '@C酱 看下', mentions: ['cjiang'] }, false);
  assert.deepEqual(h.beams, [], '回放重建场景时不连闪');
  assert.equal(h.logs.at(-1)[0], 'at');
});