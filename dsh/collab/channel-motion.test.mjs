// U3 频道页交互动效与易用性（Issue #98）的测试。
//
// 页面是自包含的单文件（dsh/collab/page.html），没有前端测试依赖，所以这里用
// test/channel-motion.dom.mjs 这个极简 DOM 垫片把内联脚本真跑起来，断言交互行为；
// 另外用源码断言守住「动效只用 transform / opacity」和 reduced-motion 降级这两条达标线。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';
import { makeDocument } from './test/channel-motion.dom.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const PAGE = join(HERE, 'page.html');
const SOURCE = readFileSync(PAGE, 'utf8');
const SCRIPT = /<script>([\s\S]*)<\/script>/.exec(SOURCE)[1];

const IDS = [...SOURCE.matchAll(/\sid="([^"]+)"/g)].map(m => m[1]);

const STATE = {
  me: 'owner',
  rooms: [{ id: '1', name: '团队' }],
  members: [{ id: 'fy', name: '肥鱼' }, { id: 'gx', name: 'G哥', kind: 'bot' }],
  thinking: {},
};

/** 起一个页面实例：vm 跑内联脚本，fetch / EventSource 换成可控假实现。 */
async function boot({ sendFails = 0, messages = [] } = {}) {
  const { document, byId } = makeDocument(IDS);
  const posts = [];
  const instances = [];
  let failuresLeft = sendFails;

  const json = body => ({ ok: true, status: 200, statusText: 'OK', json: async () => body });
  const fetch = async (path, init = {}) => {
    const method = init.method || 'GET';
    if (path === '/collab/api/state') return json(STATE);
    if (path.endsWith('/mode')) return json({ dispatch_mode: 'mixed' });
    if (/\/messages\?/.test(path)) return json({ messages });
    if (method === 'POST' && /\/messages$/.test(path)) {
      const body = JSON.parse(init.body);
      posts.push(body);
      if (failuresLeft > 0) { failuresLeft -= 1; throw Error('网络断了'); }
      return json({ message: { id: 90, room_id: '1', author: 'owner', name: '主人', text: body.text, created_at: Date.now(), client_key: body.client_key } });
    }
    return json({});
  };

  const matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  const sandbox = {
    document,
    window: { matchMedia },
    matchMedia,
    fetch,
    location: { reload() {} },
    alert() {},
    console: { warn() {}, error() {}, log() {} },
    crypto: { randomUUID: () => 'k-' + Math.random().toString(16).slice(2), getRandomValues: a => a },
    EventSource: class { constructor(url) { this.url = url; instances.push(this); } addEventListener() {} },
    setTimeout,
    clearTimeout,
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(SCRIPT, sandbox);

  // 初始化是异步 IIFE（拉 state → openRoom），等它落地
  for (let i = 0; i < 20; i++) await new Promise(r => setTimeout(r, 0));

  // 造一个「已滚到离底很远」的状态：#log 高 400、内容 4000、滚到 0
  const log = byId.get('log');
  const setScroll = (top, height = 4000) => {
    log.scrollHeight = height;
    log.clientHeight = 400;
    log.scrollTop = top;
  };
  return { byId, posts, instances, setScroll, log, sandbox };
}

const tick = () => new Promise(r => setTimeout(r, 0));

test('结构：回到最新按钮、未读计数、补全浮层、发送状态条都在位且可访问', () => {
  for (const id of ['jumpLatest', 'jumpCount', 'mentionPop', 'sendState', 'log', 'thinking']) {
    assert.ok(IDS.includes(id), `页面缺 #${id}`);
  }
  assert.match(SOURCE, /id="jumpLatest"[^>]*type="button"[^>]*aria-label="回到最新"/, '回到最新按钮要带 aria-label');
  assert.match(SOURCE, /id="mentionPop"[^>]*role="listbox"/, '@ 补全要有 listbox 语义');
  assert.match(SOURCE, /id="sendState"[^>]*role="status"/, '发送状态要用 role=status');
  assert.match(SOURCE, /id="thinking"[^>]*aria-live="polite"/, '正在输入要 aria-live');
});

test('动效只用 transform / opacity，并在 reduced-motion 下降级', () => {
  const css = /<style>([\s\S]*)<\/style>/.exec(SOURCE)[1];
  const U3 = css.slice(css.indexOf('U3：交互动效与易用性'));
  const props = [...U3.matchAll(/(?:transition|animation)\s*:\s*([^;]+);/g)].map(m => m[1]);
  assert.ok(props.length > 0, 'U3 段应有过渡/动画声明');
  // 白名单：只允许这些属性参与动效（transition 里可以出现 border-color，动画帧里只动 transform/opacity）
  // 允许出现在过渡/动画里的词：属性名只剩 transform / opacity / border-color，
  // 其余只能是时长、曲线、无限循环、none，或本页的设计令牌变量。
  const OK = /^(transform|opacity|border-color|var\(--[a-z-]+\)|msg-enter|typing-bob|linear|ease|ease-in|ease-out|ease-in-out|infinite|none|\d+(\.\d+)?m?s|cubic-bezier\([^)]*\))$/;
  for (const p of props) {
    for (const tok of p.split(/[\s,]+/).filter(Boolean)) {
      assert.match(tok, OK, `动效声明里出现不该参与动画的词（会引发布局或超出白名单）：${tok} ← ${p}`);
    }
  }
  // keyframes 帧里不许出现 width / height / margin / top / left 这类会重排的属性
  // 用括号配平把每个 @keyframes 块切出来（正则跨不过嵌套大括号）
  const blocks = [];
  for (let i = U3.indexOf('@keyframes'); i >= 0; i = U3.indexOf('@keyframes', i + 1)) {
    const open = U3.indexOf('{', i);
    let depth = 0, j = open;
    for (; j < U3.length; j++) {
      if (U3[j] === '{') depth++;
      else if (U3[j] === '}' && --depth === 0) break;
    }
    blocks.push(U3.slice(open, j + 1));
  }
  assert.ok(blocks.length >= 2, '应当有两个关键帧动画（新消息进场、正在输入三点）');
  for (const body of blocks) {
    assert.doesNotMatch(body, /\b(width|height|margin|padding|top|left|right|bottom)\s*:/, `关键帧里出现会引发布局的属性：${body.slice(0, 80)}`);
    assert.match(body, /transform|opacity/, '关键帧至少动 transform 或 opacity');
  }
  assert.match(U3, /@media \(prefers-reduced-motion: reduce\)/, 'U3 段要有 reduced-motion 降级');
  assert.match(U3, /\.msg\.enter \{ animation: none; \}/, 'reduced-motion 下新消息不播进场动画');
  assert.match(U3, /\.typing-dots i \{ animation: none;/, 'reduced-motion 下三点静止');
});

test('回到最新：离底才出现，别人发的新消息累加未读数，点击后回底清零', async () => {
  const { byId, setScroll, instances } = await boot();
  const jump = byId.get('jumpLatest');
  const count = byId.get('jumpCount');
  assert.equal(jump.dataset.show, '0', '贴底时不该出现');
  assert.equal(count.hidden, true);

  setScroll(0);
  byId.get('log').dispatch('scroll');
  assert.equal(jump.dataset.show, '1', '离底要出现回到最新');

  // 事件流推送一条别人的消息
  const es = instances[0];
  const push = m => es.onmessage({ data: JSON.stringify({ type: 'message', message: m }) });
  const now = Math.floor(Date.now() / 1000);
  push({ id: 11, room_id: '1', author: 'gx', name: 'G哥', text: '看下这个', created_at: now });
  assert.equal(count.hidden, false, '离底时来新消息要出未读');
  assert.equal(count.textContent, '1');

  // 自己发的即时可见，不计未读
  push({ id: 12, room_id: '1', author: 'owner', name: '主人', text: '收到', created_at: now + 1 });
  assert.equal(count.textContent, '1', '自己发的不算未读');

  assert.match(jump.getAttribute('aria-label'), /1 条未读/, '未读数要进无障碍名');

  // 点一下回底
  jump.dispatch('click');
  assert.equal(jump.dataset.show, '0', '回底后按钮收起');
  assert.equal(count.hidden, true, '未读清零');
});

test('@ 成员补全：输入 @ 前缀出候选，方向键+Enter 选中，Esc 关闭且不动草稿', async () => {
  const { byId } = await boot();
  const input = byId.get('input');
  const pop = byId.get('mentionPop');

  input.value = '叫 @肥';
  input.selectionStart = input.value.length;
  input.selectionEnd = input.value.length;
  input.dispatch('input');
  assert.equal(pop.hidden, false, '@ 前缀应弹出候选');
  assert.equal(pop.children.length, 1, '只匹配「肥鱼」');
  assert.equal(pop.children[0].dataset.name, '肥鱼');

  const ev = input.dispatch('keydown', { key: 'Enter', shiftKey: false, isComposing: false });
  assert.equal(pop.hidden, true, 'Enter 选中后关补全');
  assert.equal(input.value, '叫 @肥鱼 ', '插入 @名字 加一个空格');
  assert.ok(ev.defaultPrevented, 'Enter 在补全里应被拦下，不能同时发出消息');

  input.value = '叫 @G';
  input.selectionStart = input.value.length;
  input.selectionEnd = input.value.length;
  input.dispatch('input');
  assert.equal(pop.hidden, false);
  input.dispatch('keydown', { key: 'Escape' });
  assert.equal(pop.hidden, true, 'Esc 关补全');
  assert.equal(input.value, '叫 @G', 'Esc 不动草稿');
});

test('发送失败：显示错误与重试按钮，重试复用同一个 client_key，成功后状态清空', async () => {
  const { byId, posts } = await boot({ sendFails: 1 });
  const input = byId.get('input');
  const form = byId.get('form');
  const box = byId.get('sendState');

  input.value = '在吗';
  form.dispatch('submit');
  for (let i = 0; i < 10; i++) await tick();

  assert.equal(box.dataset.kind, 'error', '失败要标成 error');
  assert.match(box.textContent, /发送失败/, '失败要给人话');
  assert.equal(input.value, '在吗', '失败后原文回到输入框');
  const retry = box.querySelector('.btn');
  assert.ok(retry, '要有重试按钮');
  assert.equal(posts.length, 1);

  retry.dispatch('click');
  for (let i = 0; i < 10; i++) await tick();

  assert.equal(posts.length, 2, '重试发出了第二次请求');
  assert.equal(posts[0].client_key, posts[1].client_key, '重试必须复用同一个 client_key（服务端幂等）');
  assert.equal(box.hidden, true, '成功后状态条收起');
});

test('正在输入：有人 thinking 时给出三点 + 名字，收空后清掉', async () => {
  const { byId, instances } = await boot();
  const think = byId.get('thinking');
  assert.equal(think.children.length, 0, '初始没有人在想');

  const es = instances[0];
  es.onmessage({ data: JSON.stringify({ type: 'thinking', room_id: '1', members: ['fy'] }) });
  assert.equal(think.children.length, 1, '有人在想要有指示');
  assert.equal(think.querySelector('.typing-dots').children.length, 3, '三点动画元素');
  assert.match(think.textContent, /肥鱼 正在输入…/);

  es.onmessage({ data: JSON.stringify({ type: 'thinking', room_id: '1', members: [] }) });
  assert.equal(think.children.length, 0, '没人想之后清掉');
});
