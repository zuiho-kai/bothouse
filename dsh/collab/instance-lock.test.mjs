// #1019: one DSH process per collab data directory (instance-lock.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { InstanceLock, LOCK_FILE, lockBusyMessage } from './instance-lock.mjs';

// 子进程用 `import {…} from "<module>"` 引入本模块，所以给的是 file: URL 而不是文件路径：
// fileURLToPath() 在 Windows 上得到 C:\...\instance-lock.mjs，盘符 c: 会被 ESM 加载器当成
// 协议，子进程直接 exit 1（ERR_UNSUPPORTED_ESM_URL_SCHEME），下面的测试于是永远等不到输出。
const lockModule = new URL('./instance-lock.mjs', import.meta.url).href;

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
  const child = spawn(process.execPath, ['--no-warnings', '--input-type=module', '-e', code], { stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk; });
  // 子进程起不来时（#1031 在 Windows 上就是模块路径被当成协议，子进程 exit 1），stdout 永远
  // 不会有数据；只等 stdout 会把整条 CI 挂到超时，所以等不到就 30s 报错并带上 stderr。
  let timer;
  const ready = new Promise(resolve => child.stdout.once('data', resolve));
  const gaveUp = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`child printed nothing within 30000 ms: ${stderr}`)), 30_000);
  });
  try {
    await Promise.race([ready, gaveUp]);
  } catch (err) {
    child.kill('SIGKILL');
    throw err;
  } finally {
    clearTimeout(timer);
  }
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
