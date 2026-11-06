// #238 其他电脑没配对时不发心跳：跑 devices.html 的页面脚本本身，数它到底发了几次 alive。
// 没连着电脑（列表为空）、只连了「记住」的电脑 → 0 次；有「直到我断开」的连接才发；断开后停。
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

function element() {
  return {
    hidden: false, textContent: '', innerHTML: '', value: '', src: '', className: '', onclick: undefined,
    dataset: {},
    classList: { add() {}, remove() {}, toggle() {} },
    style: {},
    append() {}, replaceChildren() {}, addEventListener() {}, focus() {}, setAttribute() {},
  };
}

/** Run the page script with a fake DOM; `state.links` is what GET api/remote/links answers. */
function page(state) {
  const els = new Map();
  const alive = [];
  const timers = [];
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
  new Function('document', 'fetch', 'setInterval', 'clearInterval', 'confirm', SCRIPT)(
    document, fetch, setInterval, clearInterval, () => true);
  return {
    alive,
    timers,
    els,
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
});

test('#238: a 「记住」 link needs no beat either', async () => {
  const p = page({ links: [{ id: 'a', name: 'mini', mode: 'remember', created_at: 0, expires_at: null }] });
  await p.settle();
  p.tick();
  assert.deepEqual(p.alive, [], 'remember links never lapse, so a beat would only add requests');
});

test('#238: an 「直到我断开」 link beats while the page is open, and stops after disconnect', async () => {
  const state = { links: [{ id: 'a', name: 'mini', mode: 'temp', created_at: 0, expires_at: null }] };
  const p = page(state);
  await p.settle();
  assert.ok(p.alive.length >= 1, 'an until-disconnect link must be kept alive');
  assert.equal(p.alive[0].method, 'POST');
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
});
