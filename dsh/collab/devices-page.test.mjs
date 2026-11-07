// #238 其他电脑没配对时不发心跳：跑 devices.html 的页面脚本本身，数它到底发了几次 alive。
// 没连着电脑（列表为空）、只连了「记住」的电脑 → 0 次；有「直到我断开」的连接才发；断开后停。
// 页面还要把同一个答案发布给 DSH 窗口（切面板后页面没了，窗口接着跳），并且与窗口共用一个
// 租约：窗口持有租约时页面只登记不跳，页面持有租约时窗口不跳，多窗口加起来也只有一份。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const HTML = readFileSync(new URL('./devices.html', import.meta.url), 'utf8');
const SCRIPT = (() => {
  // 同 panel.test.mjs:76：不写死换行，Windows 的 core.autocrlf=true 检出（CI 的 dsh-collab-windows）
  // 会把这段切成 CRLF，硬编码 \n 会取不到脚本。
  const m = /<script>\r?\n([\s\S]*?)\r?\n<\/script>/.exec(HTML);
  assert.ok(m, 'devices.html still carries its page script');
  return m[1];
})();
// 页面发布的键名：DSH 窗口读它决定还要不要跳（dsh/packages/bothouse-embeds/build.mjs）。
const PUBLISHED = 'bothouse-dsh-devices: until-disconnect';
const LEASE = 'bothouse-dsh-devices: heartbeat';

function element() {
  return {
    hidden: false, textContent: '', innerHTML: '', value: '', src: '', className: '', onclick: undefined,
    dataset: {},
    classList: { add() {}, remove() {}, toggle() {} },
    style: {},
    append() {}, replaceChildren() {}, addEventListener() {}, focus() {}, setAttribute() {},
  };
}

/** navigator.locks, exclusive mode; `taken` pretends a DSH window already holds it. */
function locks(taken) {
  const held = new Set(taken ? [LEASE] : []);
  return {
    held,
    request(name, options, callback) {
      const run = typeof options === 'function' ? options : callback;
      if (held.has(name)) return new Promise(() => {});
      held.add(name);
      return Promise.resolve().then(run);
    },
  };
}

/** Run the page script with a fake DOM; `state.links` is what GET api/remote/links answers. */
function page(state, options = {}) {
  const els = new Map();
  const alive = [];
  const timers = [];
  const store = options.store ?? new Map();
  const navigator = { locks: options.locks ?? locks(false) };
  const localStorage = {
    getItem: k => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: k => { store.delete(k); },
  };
  const document = {
    getElementById: id => { if (!els.has(id)) els.set(id, element()); return els.get(id); },
    querySelectorAll: () => [],
    querySelector: () => undefined,
    createElement: () => element(),
  };
  const json = (status, body) => ({ ok: status < 400, status, json: async () => body });
  const fetch = async (path, init) => {
    if (path === 'api/remote/alive') { alive.push(init); return json(200, { ok: true }); }
    if (path === 'api/remote/links') return json(200, { links: state.links });
    if (path === 'api/remote/peers') return json(200, { peers: [] });
    if (path === 'api/pair/devices') return json(200, { devices: [] });
    if (path === 'api/pair/code') return json(200, { waiting: false });
    return json(404, { error: `unexpected ${path}` });
  };
  const setInterval = (fn, ms) => { timers.push({ fn, ms }); return timers.length; };
  const clearInterval = () => {};
  // eslint-disable-next-line no-new-func
  new Function('document', 'fetch', 'setInterval', 'clearInterval', 'confirm', 'localStorage', 'navigator', SCRIPT)(
    document, fetch, setInterval, clearInterval, () => true, localStorage, navigator);
  return {
    alive,
    timers,
    els,
    store,
    locks: navigator.locks,
    published: () => store.get(PUBLISHED),
    /** Let the page's startup requests (api/remote/links and friends) settle. */
    settle: async () => { for (let i = 0; i < 3; i += 1) await new Promise(r => setImmediate(r)); },
    /** Fire every interval the page registered, as 3 s of wall clock would. */
    tick: () => { for (const t of timers) t.fn(); },
  };
}

test('#238: no paired computer means zero alive requests', async () => {
  const p = page({ links: [] });
  await p.settle();
  assert.deepEqual(p.alive, [], 'page load with no links must not beat');
  p.tick(); p.tick(); p.tick();
  assert.deepEqual(p.alive, [], 'the 3 s beat must stay silent while nothing is connected');
  assert.equal(p.published(), '0', 'the window is told there is nothing to keep alive');
});

test('#238: a 「记住」 link needs no beat either', async () => {
  const p = page({ links: [{ id: 'a', name: 'mini', mode: 'remember', created_at: 0, expires_at: null }] });
  await p.settle();
  p.tick();
  assert.deepEqual(p.alive, [], 'remember links never lapse, so a beat would only add requests');
  assert.equal(p.published(), '0', 'remember links never lapse, so the window must not beat for them');
});

test('#238: an 「直到我断开」 link beats while the page is open, and stops after disconnect', async () => {
  const state = { links: [{ id: 'a', name: 'mini', mode: 'temp', created_at: 0, expires_at: null }] };
  const p = page(state);
  await p.settle();
  assert.ok(p.alive.length >= 1, 'an until-disconnect link must be kept alive');
  assert.equal(p.alive[0].method, 'POST');
  assert.equal(p.published(), '1', 'the window is told to keep beating once this page is gone');
  const before = p.alive.length;
  p.tick();
  assert.equal(p.alive.length, before + 1, 'one beat per interval');
  // The person clicks 断开: the page reloads the list, which is now empty.
  state.links = [];
  p.els.get('back').onclick();
  await p.settle();
  const after = p.alive.length;
  p.tick(); p.tick();
  assert.equal(p.alive.length, after, 'after disconnect nothing is left to keep alive');
  assert.equal(p.published(), '0', 'and the window is told to stop as well');
});

// 只一份的一半：窗口已经拿着租约时，开着的页面也退让（另一半在 build.test.mjs 里数两个窗口）。
test('#238: the page stands down while a DSH window holds the beat lease', async () => {
  const shared = locks(true);
  const p = page({ links: [{ id: 'a', name: 'mini', mode: 'temp', created_at: 0, expires_at: null }] }, { locks: shared });
  await p.settle();
  p.tick(); p.tick();
  assert.deepEqual(p.timers, [], 'the window already beats, so the page must not start a second timer');
  assert.deepEqual(p.alive, [], 'and must not send a beat of its own');
  assert.equal(p.published(), '1', 'it still publishes, so a closing window hands the beat back');
});
