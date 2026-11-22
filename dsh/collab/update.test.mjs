// #1798: the npm-installed plugin updates itself past pnpm's minimumReleaseAge.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { newer, ownPackage, selfUpdate, withReleaseAgeExclude } from './update.mjs';

test('newer compares x.y.z, pre-releases never win', () => {
  assert.equal(newer('0.1.84', '0.1.83'), true);
  assert.equal(newer('0.1.84', '0.1.84'), false);
  assert.equal(newer('0.1.9', '0.1.10'), false);
  assert.equal(newer('0.2.0-rc.1', '0.1.0'), false);
  assert.equal(newer('0.1.84', '0.1.84-rc.1'), true);
});

test('withReleaseAgeExclude adds the package once, in any list form', () => {
  const dsh = 'packages:\n  - .\n\nnodeLinker: hoisted\nautoInstallPeers: false\nminimumReleaseAgeExclude:\n  - bothouse-dsh@0.1.46\n';
  const out = withReleaseAgeExclude(dsh);
  assert.match(out, /minimumReleaseAgeExclude:\n {2}- bothouse-dsh\n {2}- bothouse-dsh@0\.1\.46\n/);
  assert.equal(withReleaseAgeExclude(out), undefined, 'already exempt');
  assert.equal(withReleaseAgeExclude('packages:\n  - .\n'), 'packages:\n  - .\nminimumReleaseAgeExclude:\n  - bothouse-dsh\n');
  assert.equal(withReleaseAgeExclude('minimumReleaseAgeExclude: [a, b]\n'), 'minimumReleaseAgeExclude: [a, b, bothouse-dsh]\n');
  assert.equal(withReleaseAgeExclude("minimumReleaseAgeExclude: ['bothouse-dsh']\n"), undefined);
  assert.equal(withReleaseAgeExclude('minimumReleaseAgeExclude:\n  - "bothouse-dsh"\nx: 1\n'), undefined);
});

/** A DSH profile with bothouse-dsh <version> installed; returns paths. */
function profile(version) {
  const dir = mkdtempSync(join(tmpdir(), 'self-update-'));
  const prof = join(dir, 'profiles', 'web');
  const pkg = join(prof, 'node_modules', 'bothouse-dsh');
  mkdirSync(join(pkg, 'collab'), { recursive: true });
  writeFileSync(join(prof, 'package.json'), JSON.stringify({ dependencies: { 'bothouse-dsh': version } }));
  writeFileSync(join(prof, 'pnpm-workspace.yaml'), 'packages:\n  - .\n');
  writeFileSync(join(pkg, 'package.json'), JSON.stringify({ name: 'bothouse-dsh', version }));
  const data = join(dir, 'data');
  mkdirSync(data);
  return { prof, file: join(pkg, 'collab', 'plugin.mjs'), marker: join(data, 'self-update.json') };
}
const registry = version => async () => ({ ok: true, json: async () => ({ version, dist: { tarball: `https://registry.npmjs.org/bothouse-dsh/-/bothouse-dsh-${version}.tgz` } }) });

test('ownPackage: only bothouse-dsh inside a DSH profile', () => {
  const p = profile('0.1.83');
  assert.deepEqual(ownPackage(p.file), { name: 'bothouse-dsh', version: '0.1.83', profileDir: p.prof });
  assert.equal(ownPackage('/nowhere/collab/plugin.mjs'), undefined);
});

test('behind the registry: exempt from the age rule, install the newest tarball, the new version says it is in', async () => {
  const p = profile('0.1.83');
  const said = [];
  const installs = [];
  const pm = { installBundle: async (spec, opts) => { installs.push([spec, opts]); return { application: 'applied', changed: true } } };
  const state = await selfUpdate({ pm, markerFile: p.marker, say: t => said.push(t), own: ownPackage(p.file), fetchImpl: registry('0.1.84') });
  assert.equal(state, 'updating');
  assert.deepEqual(installs, [['https://registry.npmjs.org/bothouse-dsh/-/bothouse-dsh-0.1.84.tgz', { enabled: true }]]);
  assert.match(readFileSync(join(p.prof, 'pnpm-workspace.yaml'), 'utf8'), /minimumReleaseAgeExclude:\n {2}- bothouse-dsh\n/);
  assert.deepEqual(said, [], 'the swapped-in version speaks');
  // The new version starts.
  const again = await selfUpdate({ pm, markerFile: p.marker, say: t => said.push(t), own: { ...ownPackage(p.file), version: '0.1.84' }, fetchImpl: registry('0.1.84') });
  assert.equal(again, 'told');
  assert.deepEqual(said, ['bothouse 插件已更新到 0.1.84。']);
  assert.equal(existsSync(p.marker), false);
});

test('current, offline, restart-required and failure', async () => {
  const p = profile('0.1.84');
  const said = [];
  const say = t => said.push(t);
  const pm = { installBundle: async () => { throw new Error('should not install'); } };
  assert.equal(await selfUpdate({ pm, markerFile: p.marker, say, own: ownPackage(p.file), fetchImpl: registry('0.1.84') }), 'current');
  assert.equal(await selfUpdate({ pm, markerFile: p.marker, say, own: ownPackage(p.file), fetchImpl: async () => { throw new Error('offline'); } }), 'offline');
  assert.equal(readFileSync(join(p.prof, 'pnpm-workspace.yaml'), 'utf8'), 'packages:\n  - .\n', 'up to date: the profile is not touched');

  const restart = { installBundle: async () => ({ application: 'restart-required', restartReason: 'no-hmr' }) };
  assert.equal(await selfUpdate({ pm: restart, markerFile: p.marker, say, own: ownPackage(p.file), fetchImpl: registry('0.1.85') }), 'restart');
  assert.deepEqual(said, ['bothouse 插件已更新到 0.1.85，重开 DSH 生效。']);
  assert.equal(await selfUpdate({ pm, markerFile: p.marker, say, own: { ...ownPackage(p.file), version: '0.1.85' }, fetchImpl: registry('0.1.85') }), 'told');
  assert.equal(said.length, 1, 'a restart-required update is told once');

  const q = profile('0.1.84');
  const broken = { installBundle: async () => ({ application: 'failed', error: { code: 'operation-error', diagnostic: 'ERR_PNPM_FETCH_404\nmore' } }) };
  assert.equal(await selfUpdate({ pm: broken, markerFile: q.marker, say, own: ownPackage(q.file), fetchImpl: registry('0.1.86') }), 'failed');
  assert.match(said.at(-1), /自动更新到 0\.1\.86 没成（ERR_PNPM_FETCH_404）/);
  assert.equal(await selfUpdate({ pm: broken, markerFile: q.marker, say, own: ownPackage(q.file), fetchImpl: registry('0.1.86') }), 'waiting', 'not tried again on every start');
  assert.equal(await selfUpdate({ pm: broken, markerFile: q.marker, say, own: ownPackage(q.file), fetchImpl: registry('0.1.86'), now: Date.now() + 25 * 3600_000 }), 'failed', 'tried again a day later');
});
