// #1044: the committed page packages are what build.mjs generates, and each one registers exactly
// its own sidebar entry and page (the panel also the wiki-galaxy page; only other-computers beats).
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

for (const [name, sidebar, mains, beats] of [
  ['bothouse-dsh-desk', ['collab-desk'], ['collab-desk'], false],
  ['bothouse-dsh-panel', ['bothouse-panel'], ['bothouse-panel', 'wiki-galaxy'], false],
  ['bothouse-dsh-devices', ['collab-devices'], ['collab-devices'], true],
]) {
  test(`${name} registers its own page`, () => {
    const mod = load(name);
    const side = [], main = [], effects = [];
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
        slots: { inject: (_s, reg) => reg(), register: (def) => { (def.name === 'main' ? main : side).push(def.name === 'main' ? def.key : def.id); return () => {}; } },
        layout: { selectPanel: () => {} },
      });
    } finally { globalThis.setInterval = realSet; globalThis.clearInterval = realClear; }
    assert.deepEqual(side, sidebar);
    assert.deepEqual(main, mains);
    assert.deepEqual(intervals, beats ? [3000] : []);
    const pkg = JSON.parse(readFileSync(join(here, '..', name, 'package.json'), 'utf8'));
    assert.equal(pkg.exports['./locale/*.json'], './locale/*.json', 'the Plugins page reads row titles from locale/');
    assert.ok(JSON.parse(readFileSync(join(here, '..', name, 'locale/zh.json'), 'utf8')).meta.title);
  });
}
