// #1019: one DSH process per collab data directory (instance-lock.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { InstanceLock, LOCK_FILE, lockBusyMessage } from './instance-lock.mjs';

const lockModule = fileURLToPath(new URL('./instance-lock.mjs', import.meta.url));

/** Another process tries the lock and prints held/busy. */
function tryInOtherProcess(path) {
  const code = `import { InstanceLock } from ${JSON.stringify(lockModule)};
    const l = InstanceLock.acquire(${JSON.stringify(path)}); console.log(l ? 'held' : 'busy'); l?.release();`;
  const r = spawnSync(process.execPath, ['--no-warnings', '--input-type=module', '-e', code], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim();
}

test('a second process cannot take the lock while the first holds it, and can after release', () => {
  const path = join(mkdtempSync(join(tmpdir(), 'collab-lock-')), LOCK_FILE);
  const lock = InstanceLock.acquire(path);
  assert.ok(lock);
  assert.equal(tryInOtherProcess(path), 'busy');
  lock.release();
  lock.release(); // idempotent
  assert.equal(tryInOtherProcess(path), 'held');
});

test('a second taker in the same process is refused too (plugin reload before teardown)', () => {
  const path = join(mkdtempSync(join(tmpdir(), 'collab-lock-')), 'nested', LOCK_FILE);
  const a = InstanceLock.acquire(path);
  assert.ok(a);
  assert.equal(InstanceLock.acquire(path), undefined);
  a.release();
  const b = InstanceLock.acquire(path);
  assert.ok(b);
  b.release();
});

test('a holder killed with SIGKILL leaves no stale lock', async () => {
  const path = join(mkdtempSync(join(tmpdir(), 'collab-lock-')), LOCK_FILE);
  const code = `import { InstanceLock } from ${JSON.stringify(lockModule)};
    InstanceLock.acquire(${JSON.stringify(path)}); console.log('ready'); setInterval(() => {}, 1000);`;
  const child = spawn(process.execPath, ['--no-warnings', '--input-type=module', '-e', code], { stdio: ['ignore', 'pipe', 'inherit'] });
  await new Promise(resolve => child.stdout.once('data', resolve));
  assert.equal(InstanceLock.acquire(path), undefined);
  child.kill('SIGKILL');
  await new Promise(resolve => child.once('exit', resolve));
  const lock = InstanceLock.acquire(path);
  assert.ok(lock);
  lock.release();
});

test('the refusal says what happened in plain words and names the data', () => {
  const msg = lockBusyMessage('/home/u/.conest-collab/collab.lock');
  assert.match(msg, /另一个 DSH/);
  assert.match(msg, /\/home\/u\/\.conest-collab\/collab\.lock/);
});
