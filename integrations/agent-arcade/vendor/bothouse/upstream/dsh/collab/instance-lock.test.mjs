// #1019: one DSH process per collab data directory (instance-lock.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { InstanceLock, LOCK_FILE, OWNER_FILE, acquireLockWithOwner, clearLockOwner, lockBusyMessage, lockStatus, readLockOwner, writeLockOwner } from './instance-lock.mjs';

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

// #216: the refused instance has to be able to name the holder, so the holder publishes
// who it is next to the lock and takes the record away when it releases.
test('the holder publishes who it is, and the record goes away with its lock', () => {
  const dir = mkdtempSync(join(tmpdir(), 'collab-lock-'));
  const path = join(dir, LOCK_FILE);
  assert.equal(readLockOwner(path), undefined, 'no record before anyone holds the lock');

  const lock = InstanceLock.acquire(path);
  assert.ok(lock);
  const written = writeLockOwner(path, { pid: process.pid, startedAt: 1_760_000_000_000, dataDir: dir, host: 'test-host' });
  const record = readLockOwner(path);
  assert.equal(record.pid, process.pid);
  assert.equal(record.startedAt, 1_760_000_000_000);
  assert.equal(record.dataDir, dir);
  assert.equal(record.lock, path, 'the record names the lock it belongs to');
  assert.equal(written.lock, path);

  lock.release();
  clearLockOwner(path);
  assert.equal(readLockOwner(path), undefined, 'a released lock leaves no record behind');
});

test('clearing one pid leaves another live holder\'s record alone', () => {
  const dir = mkdtempSync(join(tmpdir(), 'collab-lock-'));
  const path = join(dir, LOCK_FILE);
  writeLockOwner(path, { pid: process.pid + 1, startedAt: 1, dataDir: dir });
  clearLockOwner(path);
  assert.equal(readLockOwner(path)?.pid, process.pid + 1, 'the other holder still owns its record');
  clearLockOwner(path, process.pid + 1);
  assert.equal(readLockOwner(path), undefined);
});

// #216 regression (G哥 2026-11-06): the page read "held by another DSH" only when the holder
// record was there, so a busy lock without a record still showed "configure it in collab.yml".
test('a taken lock with no holder record still reads as busy, holder unknown', () => {
  const dir = mkdtempSync(join(tmpdir(), 'collab-lock-'));
  const path = join(dir, LOCK_FILE);
  const lock = InstanceLock.acquire(path);
  assert.ok(lock);
  // No writeLockOwner: an older install, or a holder that crashed before writing one.
  assert.deepEqual(lockStatus(path), { busy: true, owner: null, dataDir: dir, lock: path });
  lock.release();
});

test('the holder record names the live holder, and a freed lock reads as free', () => {
  const dir = mkdtempSync(join(tmpdir(), 'collab-lock-'));
  const path = join(dir, LOCK_FILE);
  const lock = InstanceLock.acquire(path);
  assert.ok(lock);
  writeLockOwner(path, { pid: process.pid, startedAt: 1_760_000_000_000, dataDir: dir, host: 'test-host' });
  assert.equal(lockStatus(path).owner?.pid, process.pid);
  lock.release();
  clearLockOwner(path);
  // The holder is gone: the refused page must stop naming it and ask for a restart instead.
  assert.deepEqual(lockStatus(path), { busy: false, free: true, dataDir: dir, lock: path });
});

test('a record left by a dead holder does not count as a live holder', () => {
  const dir = mkdtempSync(join(tmpdir(), 'collab-lock-'));
  const path = join(dir, LOCK_FILE);
  // 2**22 + 1 is outside every OS pid range, so no process can have it.
  writeLockOwner(path, { pid: 4_194_305, startedAt: 1, dataDir: dir });
  assert.deepEqual(lockStatus(path), { busy: false, free: true, dataDir: dir, lock: path });
});

// #227 rework (2026-11-06 19:26 复现，notes/utils/227-lockprobe/c.mjs): the four-way table
// "record live/dead × lock free/held" was only half covered. A dead record kept next to a lock
// that someone else actually holds was reported as the holder — the page then names a ghost pid
// and tells the user to go and quit a process that does not exist. Held without a trustworthy
// record must read as "held, holder unknown" (owner null), exactly like no record at all.
test('a dead holder record next to a held lock reads as held, holder unknown', () => {
  const dir = mkdtempSync(join(tmpdir(), 'collab-lock-'));
  const path = join(dir, LOCK_FILE);
  // 2**22 + 1 is outside every OS pid range, so no process can have it.
  writeLockOwner(path, { pid: 4_194_305, startedAt: 1, dataDir: dir });
  // The lock itself is held — by an older install that writes no record, or by a holder that
  // has not written its own record yet.
  const lock = InstanceLock.acquire(path);
  assert.ok(lock);
  assert.deepEqual(lockStatus(path), { busy: true, owner: null, dataDir: dir, lock: path });
  lock.release();
});

// #227 rework, third defect (2026-11-06 19:40 主角色实测，notes/utils/227-lockprobe/e.mjs): the
// teardown releases the lock and then clears the record, so a crash in between leaves a record
// naming a process that is still alive — this one — next to a lock nobody holds. Trusting the
// record alone reported that free lock as held and pointed the page at a process that holds
// nothing. Free is free: the record has to agree with the lock to name a holder.
test('a live holder record next to a free lock reads as free, not held', () => {
  const dir = mkdtempSync(join(tmpdir(), 'collab-lock-'));
  const path = join(dir, LOCK_FILE);
  // The lock file is there (the holder released it), the lock is free, and the record points at
  // a process that certainly exists: this test's own.
  const lock = InstanceLock.acquire(path);
  assert.ok(lock);
  lock.release();
  writeLockOwner(path, { pid: process.pid, startedAt: 1, dataDir: dir });
  assert.deepEqual(lockStatus(path), { busy: false, free: true, dataDir: dir, lock: path });
  // and the status read did not take anything: the next start gets the lock immediately.
  const again = InstanceLock.acquire(path);
  assert.ok(again, 'the status read left the lock taken');
  again.release();
});

// #227: a page poll must not be able to refuse a DSH that is starting at that same moment, and
// reading the status must not create a lock file where there is none.
test('reading the status never takes the lock and never creates the lock file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'collab-lock-'));
  const path = join(dir, LOCK_FILE);
  assert.deepEqual(lockStatus(path), { busy: false, free: true, dataDir: dir, lock: path });
  assert.equal(existsSync(path), false, 'the status read created a lock file nobody asked for');
  // While another install holds it, repeated reads report held and disturb nothing.
  const lock = InstanceLock.acquire(path);
  assert.ok(lock);
  assert.deepEqual(lockStatus(path), { busy: true, owner: null, dataDir: dir, lock: path });
  assert.deepEqual(lockStatus(path), { busy: true, owner: null, dataDir: dir, lock: path });
  lock.release();
  assert.deepEqual(lockStatus(path), { busy: false, free: true, dataDir: dir, lock: path });
});

// #227 rework (2026-11-06 19:26 复现，notes/utils/227-lockprobe/d.mjs): the record is written
// right after the lock is taken. When that write throws, the plugin throws too and the DSH stays
// alive with the error logged — while the lock, which no teardown was ever registered for, stays
// held. Every later DSH is then refused with "another DSH is using this" and none is using it.
test('a failed owner record releases the lock instead of welding the data directory shut', () => {
  const dir = mkdtempSync(join(tmpdir(), 'collab-lock-'));
  const path = join(dir, LOCK_FILE);
  // A directory where the record file belongs makes the write fail (EISDIR), the same shape as
  // a read-only or full data directory.
  mkdirSync(join(dir, OWNER_FILE));
  assert.throws(() => acquireLockWithOwner(path, { pid: process.pid, startedAt: 1, dataDir: dir }));
  // The failure must not have left the lock behind: another DSH can still start here.
  assert.equal(tryInOtherProcess(path), 'held');
  assert.equal(readLockOwner(path), undefined, 'no half-written record is left to read');
});
