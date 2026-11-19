// #1798 (user 11-19: 插件不写版本号也能装到最新): DSH installs plugins with pnpm, whose minimumReleaseAge
// (pnpm 11 default 1440 minutes) skips releases younger than a day, so `dsh plugin add bothouse-dsh` installs the
// release before the newest. On start the npm-installed plugin compares its own version with the registry's latest;
// when behind it exempts bothouse-dsh from that age rule in the profile's pnpm-workspace.yaml (later plain installs
// get the newest too) and installs the newest through DSH's plugin manager (installBundle, the same pnpm path as
// `dsh plugin add`). With HMR (the web profile) installBundle refuses a registry spec naming an installed package
// (`already-installed`, dsh-plugin-manager README "With HMR, installBundle() refuses…"), but a tarball spec installs
// over it and the recomposition swaps the running plugin; without HMR it reports restart-required.
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PACKAGE = 'bothouse-dsh';
// 来源：npm registry 文档 GET /<name>/<tag> 返回该 tag 的版本清单（含 dist.tarball）。
export const LATEST_URL = `https://registry.npmjs.org/${PACKAGE}/latest`;
// 来源：registry 单次请求正常一秒内；连不上就跳过这次，不拖插件启动。
const FETCH_TIMEOUT_MS = 5_000;
// A failed update is tried again a day later, not on every start.
const RETRY_AFTER_MS = 24 * 3600_000;

/**
 * The npm package this plugin runs from: { name, version, profileDir } when it is bothouse-dsh installed into a DSH
 * profile ($DSH_HOME/profiles/<profile>/node_modules/…), else undefined (the bridge's own copy, a dev checkout).
 */
export function ownPackage(pluginFile = fileURLToPath(import.meta.url)) {
  let pkg;
  try { pkg = JSON.parse(readFileSync(join(dirname(pluginFile), '..', 'package.json'), 'utf8')); } catch { return undefined; }
  if (pkg?.name !== PACKAGE || typeof pkg.version !== 'string') return undefined;
  const at = pluginFile.indexOf(`${sep}node_modules${sep}`);
  if (at < 0) return undefined;
  const profileDir = pluginFile.slice(0, at);
  return existsSync(join(profileDir, 'package.json')) ? { name: pkg.name, version: pkg.version, profileDir } : undefined;
}

/** a > b for x.y.z versions; a pre-release (x.y.z-rc.1) is never taken as newer. */
export function newer(a, b) {
  const parse = v => /^(\d+)\.(\d+)\.(\d+)$/.exec(String(v ?? ''))?.slice(1).map(Number);
  const x = parse(a);
  const y = parse(String(b ?? '').replace(/-.*$/, ''));
  if (x === undefined || y === undefined) return false;
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i];
  return /-/.test(String(b)); // 0.1.84 is newer than 0.1.84-rc.1
}

/**
 * Exempt `name` (every version) from pnpm's minimumReleaseAge in pnpm-workspace.yaml `text`: adds it to
 * minimumReleaseAgeExclude (block or [inline] list), or adds that key. Returns the new text, or undefined when it
 * is already exempt.
 */
export function withReleaseAgeExclude(text, name = PACKAGE) {
  const lines = text.split(/\r?\n/);
  const key = lines.findIndex(l => /^minimumReleaseAgeExclude\s*:/.test(l));
  const quoted = new RegExp(`^['"]?${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"]?$`);
  if (key < 0) {
    const body = text.length === 0 || text.endsWith('\n') ? text : text + '\n';
    return `${body}minimumReleaseAgeExclude:\n  - ${name}\n`;
  }
  const inline = /^minimumReleaseAgeExclude\s*:\s*\[(.*)\]\s*$/.exec(lines[key]);
  if (inline !== null) {
    const items = inline[1].split(',').map(s => s.trim()).filter(Boolean);
    if (items.some(s => quoted.test(s))) return undefined;
    lines[key] = `minimumReleaseAgeExclude: [${[...items, name].join(', ')}]`;
    return lines.join('\n');
  }
  for (let i = key + 1; i < lines.length && /^\s+(-|#)/.test(lines[i]); i++) {
    if (quoted.test(lines[i].replace(/^\s+-\s*/, '').replace(/\s+#.*$/, '').trim())) return undefined;
  }
  const indent = /^(\s+)-/.exec(lines[key + 1] ?? '')?.[1] ?? '  ';
  lines.splice(key + 1, 0, `${indent}- ${name}`);
  return lines.join('\n');
}

/** The registry's latest release: { version, tarball }, or undefined when it cannot be read. */
export async function latestRelease(fetchImpl = fetch, url = LATEST_URL) {
  try {
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), headers: { accept: 'application/json' } });
    if (!res.ok) return undefined;
    const doc = await res.json();
    return typeof doc?.version === 'string' && typeof doc?.dist?.tarball === 'string' ? { version: doc.version, tarball: doc.dist.tarball } : undefined;
  } catch {
    return undefined;
  }
}

function readMarker(file) {
  try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return undefined; }
}

/**
 * Bring the npm-installed plugin up to the registry's latest. say(text): a system line in #general (may throw once
 * this plugin was swapped out). Returns what happened: not-npm | offline | current | told | waiting | updating |
 * restart | failed (for the log and tests).
 * @param opts.pm - DSH's plugin manager (ctx.get('pluginManager')).
 * @param opts.markerFile - where the attempt is kept (the channel data directory), so the new version can say it is in.
 */
export async function selfUpdate({ pm, markerFile, say, logger, own = ownPackage(), fetchImpl = fetch, now = Date.now() }) {
  if (own === undefined) return 'not-npm';
  const marker = readMarker(markerFile);
  if (marker?.target === own.version) {
    // The new version is running: say so once (a restart-required update was already told).
    try { unlinkSync(markerFile); } catch { /* gone */ }
    if (marker.state !== 'restart') say(`bothouse 插件已更新到 ${own.version}。`);
    return 'told';
  }
  const latest = await latestRelease(fetchImpl);
  if (latest === undefined) return 'offline';
  if (!newer(latest.version, own.version)) return 'current';
  // Later plain `dsh plugin add bothouse-dsh` runs get the newest as well.
  const ws = join(own.profileDir, 'pnpm-workspace.yaml');
  try {
    if (existsSync(ws)) {
      const next = withReleaseAgeExclude(readFileSync(ws, 'utf8'));
      if (next !== undefined) writeFileSync(ws, next);
    }
  } catch (error) {
    logger?.warn?.('conest-collab: cannot exempt %s from minimumReleaseAge in %s: %s', PACKAGE, ws, error?.message ?? error);
  }
  if (marker?.target === latest.version && now - Date.parse(marker.at ?? '') < RETRY_AFTER_MS) return 'waiting';
  const keep = state => writeFileSync(markerFile, JSON.stringify({ target: latest.version, from: own.version, state, at: new Date(now).toISOString() }) + '\n', { mode: 0o600 });
  if (typeof pm?.installBundle !== 'function') {
    keep('failed');
    say(`bothouse 插件有新版 ${latest.version}（现在是 ${own.version}）。在插件页卸载 bothouse-dsh 后重新安装即可装到新版。`);
    return 'failed';
  }
  keep('installing');
  logger?.info?.('conest-collab: updating %s %s → %s', PACKAGE, own.version, latest.version);
  let res;
  try {
    res = await pm.installBundle(latest.tarball, { enabled: true });
  } catch (error) {
    res = { application: 'failed', error: { message: error?.message ?? String(error) } };
  }
  if (res?.application === 'applied') return 'updating'; // the new version is loaded and says it is in
  if (res?.application === 'restart-required') {
    keep('restart');
    say(`bothouse 插件已更新到 ${latest.version}，重开 DSH 生效。`);
    return 'restart';
  }
  keep('failed');
  const why = String(res?.error?.diagnostic || res?.error?.message || res?.error?.code || res?.application || '原因不明').split('\n')[0].slice(0, 200);
  logger?.warn?.('conest-collab: updating %s to %s failed: %s', PACKAGE, latest.version, why);
  say(`bothouse 插件自动更新到 ${latest.version} 没成（${why}）。可在插件页卸载 bothouse-dsh 后重新安装。`);
  return 'failed';
}
