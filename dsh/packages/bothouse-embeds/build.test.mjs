// #1044: the committed page packages are what build.mjs generates, and each one registers exactly
// its own sidebar entry and page (the panel also the wiki-galaxy page). #238: no package may beat
// on its own — the other-computers page beats from its own page script, and only while an
// 「直到我断开」 link is connected, so a DSH window with nothing paired must stay silent.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const here = import.meta.dirname;
const NAMES = ['bothouse-dsh-desk', 'bothouse-dsh-panel', 'bothouse-dsh-devices'];
const files = dir => readdirSync(dir, { recursive: true, withFileTypes: true }).filter(e => e.isFile()).map(e => join(e.parentPath, e.name).slice(dir.length + 1)).sort();

test('committed packages match the generator', () => {
  const out = mkdtempSync(join(tmpdir(), 'embeds-'));
  execFileSync(process.execPath, [join(here, 'build.mjs'), out]);
  for (const name of NAMES) {
    const committed = join(here, '..', name), fresh = join(out, name);
    assert.deepEqual(files(committed), files(fresh), name);
    for (const f of files(fresh)) assert.equal(readFileSync(join(committed, f), 'utf8'), readFileSync(join(fresh, f), 'utf8'), `${name}/${f}: run node dsh/packages/bothouse-embeds/build.mjs`);
  }
});

function load(name) {
  let mod;
  globalThis.window = { __ModuleLoader__: { load: m => { assert.equal(m.id, name); mod = m.factory(req => req === 'react/jsx-runtime' ? { jsx: (type, props) => ({ type, props }) } : new Proxy({}, { get: () => () => null })); } } };
  // eslint-disable-next-line no-new-func
  new Function(readFileSync(join(here, '..', name, 'client.js'), 'utf8'))();
  return mod;
}

for (const [name, sidebar, mains] of [
  ['bothouse-dsh-desk', ['collab-desk'], ['collab-desk']],
  ['bothouse-dsh-panel', ['bothouse-panel'], ['bothouse-panel', 'wiki-galaxy']],
  ['bothouse-dsh-devices', ['collab-devices'], ['collab-devices']],
]) {
  test(`${name} registers its own page`, () => {
    const mod = load(name);
    const side = [], main = [], effects = [], frames = [];
    const intervals = [];
    const realSet = globalThis.setInterval, realClear = globalThis.clearInterval;
    globalThis.setInterval = (fn, ms) => { intervals.push(ms); return 1; };
    globalThis.clearInterval = () => {};
    globalThis.location = { hash: '' };
    globalThis.document = { baseURI: 'http://h/' };
    globalThis.fetch = () => Promise.resolve();
    try {
      mod.apply({
        effect: (fn) => effects.push(fn()),
        locale: { register: () => () => {}, bind: () => k => k },
        slots: { inject: (_s, reg) => reg(), register: (def, component) => { if (def.name === 'main') frames.push([def, component]); (def.name === 'main' ? main : side).push(def.name === 'main' ? def.key : def.id); return () => {}; } },
        layout: { selectPanel: () => {} },
      });
    } finally { globalThis.setInterval = realSet; globalThis.clearInterval = realClear; }
    assert.deepEqual(side, sidebar);
    assert.deepEqual(main, mains);
    for (const [def, component] of frames) {
      const frame = component(def.inject()).props.children;
      assert.equal(frame.type, 'iframe');
      assert.equal(frame.props.referrerPolicy, 'same-origin', `${def.key} must send the same-origin Referer`);
    }
    assert.deepEqual(intervals, [], `${name} must not start a timer (panel closed must not keep a link alive)`);
    const pkg = JSON.parse(readFileSync(join(here, '..', name, 'package.json'), 'utf8'));
    assert.equal(pkg.exports['./locale/*.json'], './locale/*.json', 'the Plugins page reads row titles from locale/');
    assert.ok(JSON.parse(readFileSync(join(here, '..', name, 'locale/zh.json'), 'utf8')).meta.title);
  });
}

// #238: the beat belongs to the devices page, which knows whether a link needs it. A package-level
// beat fires in every DSH window whether or not anything is paired, which is what the user reported.
test('no page package sends the remote-link heartbeat itself', () => {
  for (const name of NAMES) {
    const client = readFileSync(join(here, '..', name, 'client.js'), 'utf8');
    assert.ok(!client.includes('api/remote/alive'), `${name}/client.js must not POST the alive beat`);
  }
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
