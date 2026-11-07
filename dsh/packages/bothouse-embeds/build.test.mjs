// #1044: the committed page packages are what build.mjs generates, and each one registers exactly
// its own sidebar entry and page (the panel also the wiki-galaxy page).
// #238: 「其他电脑」 keeps a window-level beat, because switching to another panel unloads its page
// and nobody would keep an 「直到我断开」 link alive (pairing.mjs sweeps exactly that kind once no
// window beats for UNTIL_GRACE_MS). The beat runs only while such a link exists — a window with
// nothing paired, or with only 「记住」 links, sends nothing — and one lease is shared by the page
// and every window, so the tick is sent once, not once per window and not twice while the panel is
// open.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const here = import.meta.dirname;
const NAMES = ['bothouse-dsh-desk', 'bothouse-dsh-panel', 'bothouse-dsh-devices'];
const files = dir => readdirSync(dir, { recursive: true, withFileTypes: true }).filter(e => e.isFile()).map(e => join(e.parentPath, e.name).slice(dir.length + 1)).sort();
// The key devices.html publishes: this window reads it instead of asking the host every beat.
const PUBLISHED = 'bothouse-dsh-devices: until-disconnect';
const GLOBALS = ['window', 'document', 'location', 'navigator', 'localStorage', 'fetch', 'setInterval', 'clearInterval'];

test('committed packages match the generator', () => {
  const out = mkdtempSync(join(tmpdir(), 'embeds-'));
  execFileSync(process.execPath, [join(here, 'build.mjs'), out]);
  for (const name of NAMES) {
    const committed = join(here, '..', name), fresh = join(out, name);
    assert.deepEqual(files(committed), files(fresh), name);
    for (const f of files(fresh)) assert.equal(readFileSync(join(committed, f), 'utf8'), readFileSync(join(fresh, f), 'utf8'), `${name}/${f}: run node dsh/packages/bothouse-embeds/build.mjs`);
  }
});

/** One browser profile: the storage and the Web Locks its DSH windows share. */
function profile() {
  const store = new Map();
  const held = new Set();
  const waiting = [];
  const abort = () => Object.assign(new Error('aborted'), { name: 'AbortError' });
  const pump = () => Promise.resolve().then(() => {
    for (let i = 0; i < waiting.length; i += 1) {
      const next = waiting[i];
      if (held.has(next.name)) continue;
      waiting.splice(i, 1);
      held.add(next.name);
      try { next.grant(); } catch (error) { next.fail(error); }
      i = -1;
    }
  });
  return {
    store,
    /** navigator.locks, exclusive mode: a second caller waits until the holder aborts. */
    locks: {
      request(name, options, callback) {
        const opts = typeof options === 'function' ? {} : options;
        const run = typeof options === 'function' ? options : callback;
        if (opts.signal?.aborted) return Promise.reject(abort());
        if (held.has(name)) {
          return new Promise((resolve, reject) => {
            const entry = { name, grant: () => resolve(run()), fail: reject };
            waiting.push(entry);
            opts.signal?.addEventListener('abort', () => {
              const at = waiting.indexOf(entry);
              if (at >= 0) waiting.splice(at, 1);
              reject(abort());
            }, { once: true });
          });
        }
        held.add(name);
        // Held until this window closes, exactly like the page's never-settling callback.
        opts.signal?.addEventListener('abort', () => { held.delete(name); pump(); }, { once: true });
        try { return Promise.resolve(run()); } catch (error) { held.delete(name); pump(); throw error; }
      },
    },
  };
}

/**
 * One DSH window running a page package: its own globals, timers and fetch, sharing one profile.
 * `state.links` is what GET collab/api/remote/links answers for this machine.
 */
function open(name, state, shared = profile()) {
  const alive = [];
  const reads = [];
  const timers = [];
  const effects = [];
  const sidebar = [];
  const main = [];
  const frames = [];
  let mod, saved = new Map();

  const install = () => {
    saved = new Map(GLOBALS.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
    const define = (key, value) => Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
    define('document', { baseURI: 'http://h/' });
    define('location', { hash: '' });
    define('navigator', { locks: shared.locks });
    define('localStorage', {
      getItem: k => (shared.store.has(k) ? shared.store.get(k) : null),
      setItem: (k, v) => { shared.store.set(k, String(v)); },
      removeItem: k => { shared.store.delete(k); },
    });
    define('setInterval', (fn, ms) => { timers.push({ fn, ms }); return timers.length; });
    define('clearInterval', id => { if (id) timers[id - 1] = undefined; });
    define('fetch', (url, init = {}) => {
      const path = String(url);
      if (path === 'http://h/collab/api/remote/alive') { alive.push(init); return Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true }) }); }
      if (path === 'http://h/collab/api/remote/links') { reads.push(init); return Promise.resolve({ ok: true, status: 200, json: async () => ({ links: state.links }) }); }
      return Promise.resolve({ ok: false, status: 404, json: async () => ({ error: path }) });
    });
    define('window', { __ModuleLoader__: { load: m => { assert.equal(m.id, name); mod = m.factory(req => req === 'react/jsx-runtime' ? { jsx: (type, props) => ({ type, props }) } : new Proxy({}, { get: () => () => null })); } } });
  };
  const restore = () => {
    for (const [key, descriptor] of saved) {
      if (descriptor === undefined) delete globalThis[key];
      else Object.defineProperty(globalThis, key, descriptor);
    }
  };
  const act = fn => { install(); try { return fn(); } finally { restore(); } };
  const settleIn = async () => {
    install();
    try { for (let i = 0; i < 4; i += 1) await new Promise(r => setImmediate(r)); } finally { restore(); }
  };

  return {
    name, state, shared, alive, reads, timers, effects, sidebar, main, frames,
    /** Run the package's apply(), as DSH does when it loads this page for this window. */
    apply() {
      act(() => {
        new Function(readFileSync(join(here, '..', name, 'client.js'), 'utf8'))();
        mod.apply({
          effect: fn => effects.push(fn()),
          locale: { register: () => () => {}, bind: () => k => k },
          slots: {
            inject: (_s, reg) => reg(),
            register: (def, component) => { if (def.name === 'main') frames.push([def, component]); (def.name === 'main' ? main : sidebar).push(def.name === 'main' ? def.key : def.id); return () => {}; },
          },
          layout: { selectPanel: () => {} },
        });
      });
      return this;
    },
    /** Render one registered page, as DSH does when the panel shows it. */
    render(def, component) { return act(() => component(def.inject())); },
    /** One ALIVE_EVERY_MS of wall clock: fire this window's beat, as the browser would. */
    tick() { act(() => { for (const t of timers) t?.fn(); }); return this; },
    /** Let this window's startup requests and lock handovers settle. */
    async settle() { await settleIn(); return this; },
    /** The person closes this window: DSH runs the effect cleanups. */
    close() { act(() => { for (const stop of effects) if (typeof stop === 'function') stop(); }); return this; },
  };
}

const UNTIL = [{ id: 'a', name: 'mini', mode: 'temp', created_at: 0, expires_at: null }];

for (const [name, sidebar, mains] of [
  ['bothouse-dsh-desk', ['collab-desk'], ['collab-desk']],
  ['bothouse-dsh-panel', ['bothouse-panel'], ['bothouse-panel', 'wiki-galaxy']],
  ['bothouse-dsh-devices', ['collab-devices'], ['collab-devices']],
]) {
  test(`${name} registers its own page`, () => {
    const win = open(name, { links: [] }).apply();
    assert.deepEqual(win.sidebar, sidebar);
    assert.deepEqual(win.main, mains);
    for (const [def, component] of win.frames) {
      const frame = win.render(def, component).props.children;
      assert.equal(frame.type, 'iframe');
      assert.equal(frame.props.referrerPolicy, 'same-origin', `${def.key} must send the same-origin Referer`);
    }
    // Only 「其他电脑」 beats: it is the page whose links the host sweeps when no window beats (#238).
    if (name === 'bothouse-dsh-devices') assert.deepEqual(win.timers.map(t => t?.ms), [3000], 'the beat runs on the ALIVE_EVERY_MS tick');
    else assert.deepEqual(win.timers, [], `${name} must not start a timer (panel closed must not keep a link alive)`);
    const pkg = JSON.parse(readFileSync(join(here, '..', name, 'package.json'), 'utf8'));
    assert.equal(pkg.exports['./locale/*.json'], './locale/*.json', 'the Plugins page reads row titles from locale/');
    assert.ok(JSON.parse(readFileSync(join(here, '..', name, 'locale/zh.json'), 'utf8')).meta.title);
  });
}

// #238 ①: nothing paired must stay silent — no beat, and no list read either.
test('#238: a window with nothing paired sends no beat', async () => {
  const win = open('bothouse-dsh-devices', { links: [] }).apply();
  await win.settle();
  win.tick().tick().tick();
  assert.deepEqual(win.alive, [], 'no link is connected, so there is nothing to keep alive');
  assert.deepEqual(win.reads, [], 'nothing published and nothing paired: the window need not even ask');
});

// #238 ①: a 「记住」 link never lapses (pairing.mjs sweeps temp links only), so no beat either.
test('#238: a window with only a 「记住」 link sends no beat', async () => {
  const shared = profile();
  shared.store.set(PUBLISHED, '0'); // devices.html read the list: one 「记住」 link, no temp
  const win = open('bothouse-dsh-devices', { links: [{ id: 'a', name: 'mini', mode: 'remember', created_at: 0, expires_at: null }] }, shared).apply();
  await win.settle();
  win.tick().tick();
  assert.deepEqual(win.alive, [], 'remember links never lapse, so a beat would only add requests');
});

// #238 ②: with an 「直到我断开」 link the window keeps beating past UNTIL_GRACE_MS (10 s) with the
// devices page closed — which is exactly what switching to another panel does to the page.
test('#238: an 「直到我断开」 link is kept alive past UNTIL_GRACE_MS with the page closed', async () => {
  const shared = profile();
  shared.store.set(PUBLISHED, '1'); // devices.html published after the person connected
  const win = open('bothouse-dsh-devices', { links: UNTIL }, shared).apply();
  await win.settle();
  assert.equal(win.reads.length, 1, 'the window confirms the published flag once, it does not re-read each beat');
  for (let i = 0; i < 5; i += 1) win.tick(); // 15 s: three sweeps of pairing.mjs would swallow a stopped beat
  assert.equal(win.alive.length, 5, 'one beat per ALIVE_EVERY_MS, still beating 15 s later');
  assert.equal(win.reads.length, 1, 'beating does not re-read the list');
  assert.equal(win.alive[0].method, 'POST');
  assert.equal(win.alive[0].credentials, 'same-origin');
});

// #238 ②: the beat follows what the page publishes, so a link disconnected in any window stops it.
test('#238: the beat stops when the page publishes that no 「直到我断开」 link is left', async () => {
  const shared = profile();
  shared.store.set(PUBLISHED, '1');
  const state = { links: UNTIL };
  const win = open('bothouse-dsh-devices', state, shared).apply();
  await win.settle();
  win.tick();
  assert.equal(win.alive.length, 1);
  // The person clicks 断开 (here or in another window): devices.html reads the list and publishes.
  state.links = [];
  shared.store.set(PUBLISHED, '0');
  win.tick().tick().tick();
  assert.equal(win.alive.length, 1, 'nothing is connected any more, so the window goes silent again');
});

// #238: two DSH windows send one beat between them, and the survivor takes over when one closes.
test('#238: two windows send one beat between them', async () => {
  const shared = profile();
  shared.store.set(PUBLISHED, '1');
  const first = open('bothouse-dsh-devices', { links: UNTIL }, shared).apply();
  await first.settle();
  const second = open('bothouse-dsh-devices', { links: UNTIL }, shared).apply();
  await second.settle();
  for (let i = 0; i < 4; i += 1) { first.tick(); second.tick(); }
  assert.equal(first.alive.length, 4, 'the window holding the lease beats');
  assert.equal(second.alive.length, 0, 'the other window stands down instead of sending a second copy');
  // The first window closes: its lease is released and the second one continues the beat.
  first.close();
  await second.settle();
  const before = second.timers.filter(Boolean).length;
  second.tick();
  assert.equal(second.alive.length, 1, 'the surviving window keeps the link alive');
  assert.ok(before > 0, 'it started its own beat on taking the lease over');
});

// Exercise the shipped legacy client function, including the untrusted delivery path.
test('legacy bundle only sends a Referer for trusted embeds', () => {
  const bundle = readFileSync(join(here, '../../../bridge/core/dsh_bundle/packages/client-ui-discord/lib/client.js'), 'utf8');
  const match = bundle.match(/function EmbedFrame\(\{ src, title, sandboxed = false, sameOrigin = false \}\) \{[\s\S]*?\n\}/);
  assert.ok(match, 'EmbedFrame exists in shipped bundle');
  const jsx = (_type, props) => props;
  const frame = new Function('react_jsx_runtime', 'PanelPages_module_default', `${match[0]}; return EmbedFrame` )({ jsx }, { frame: 'frame' });
  assert.equal(frame({ src: '/collab/desk', title: 'desk' }).referrerPolicy, 'same-origin');
  for (const sameOrigin of [false, true]) {
    const delivery = frame({ src: '/delivery', title: 'delivery', sandboxed: true, sameOrigin });
    assert.equal(delivery.referrerPolicy, 'no-referrer');
    assert.ok(delivery.sandbox.includes('allow-scripts'));
    assert.equal(delivery.sandbox.includes('allow-same-origin'), !sameOrigin);
  }
});
