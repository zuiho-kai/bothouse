import { accessSync, chmodSync, constants, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export const LOCK_FILE = 'collab.lock';
// #216: the holder's identity, so the DSH that is refused can say who holds the lock
// instead of calling a busy service "not configured".
export const OWNER_FILE = 'collab.owner.json';

/**
 * #1019: one DSH process per collab data directory. Two hosts on the same collab.sqlite3 both run
 * reminders, recovery and bot routing, so every job and message is handled twice.
 *
 * The lock is an exclusive SQLite transaction on a separate file: SQLite takes a POSIX lock, the
 * kernel drops it when the process dies however it dies, so a crash never leaves a stale lock and
 * no pid file has to be guessed at. busy_timeout 0 makes the second taker fail at once.
 * Nothing is written to collab.sqlite3 itself.
 */
export class InstanceLock {
  /** @returns InstanceLock, or undefined when another process already holds `path`. */
  static acquire(path) {
    mkdirSync(dirname(path), { recursive: true });
    const db = new DatabaseSync(path);
    try {
      db.exec('PRAGMA busy_timeout = 0; BEGIN EXCLUSIVE');
    } catch (err) {
      db.close();
      if (/locked|busy/i.test(String(err?.message))) return undefined;
      throw err;
    }
    return new InstanceLock(db);
  }

  constructor(db) { this.db = db; }

  release() {
    if (this.db === undefined) return;
    const db = this.db;
    this.db = undefined;
    try { db.exec('ROLLBACK'); } catch { /* closing drops the lock anyway */ }
    db.close();
  }
}

/** Plain-language reason shown in the DSH log when the plugin refuses to start. */
export function lockBusyMessage(path) {
  return `conest-collab: 频道插件没有启动——这台电脑上已经有另一个 DSH 在用同一份频道数据（${path}）。`
    + '两个同时跑会让提醒、派活和消息各处理两遍。请用已经打开的那个 DSH；要换就先关掉它再打开。';
}

/**
 * #216: the instance that holds the lock records who it is next to it, so the DSH that is
 * refused can name the holder instead of telling the user to go and configure collab.yml.
 * Written after the lock is held (so the record always describes the current holder) and
 * removed on release; a record left behind by a crash is harmless because the reader also
 * checks the lock itself.
 * @returns the record written.
 */
export function writeLockOwner(path, info) {
  const file = join(dirname(path), OWNER_FILE);
  mkdirSync(dirname(file), { recursive: true });
  const record = { ...info, lock: path, writtenAt: info.writtenAt ?? Date.now() };
  // 来源：沿用 pairing.mjs saveJSON 的私有凭据权限；收紧旧诊断文件后再写连接口令。
  try { chmodSync(file, 0o600); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 });
  return record;
}

/**
 * #216: the holder record for the data directory of `path`.
 * @returns the record, or undefined when no holder wrote one (an older install, or a
 * crashed holder whose lock the kernel already dropped).
 */
export function readLockOwner(path) {
  try {
    const parsed = JSON.parse(readFileSync(join(dirname(path), OWNER_FILE), 'utf8'));
    return parsed !== null && typeof parsed === 'object' ? parsed : undefined;
  } catch {
    // Missing or half-written: the caller falls back to the plain refusal.
    return undefined;
  }
}

/** #216: remove `pid`'s record; another live holder's record is left alone. */
export function clearLockOwner(path, pid = process.pid) {
  const record = readLockOwner(path);
  if (record !== undefined && record.pid !== undefined && record.pid !== pid) return;
  try { unlinkSync(join(dirname(path), OWNER_FILE)); } catch { /* already gone */ }
}

/**
 * #216/#227: take the lock and publish who holds it, as one step.
 *
 * Writing the record can fail (a directory where the file should be, a full or read-only data
 * directory). The lock must not survive that failure: the plugin throws, the DSH keeps running
 * with the error logged, and a lock nobody will ever release welds the data directory shut for
 * every later DSH — the user sees "another DSH is using this" with no DSH to quit. So a failed
 * write releases the lock before the error travels on.
 *
 * @returns the held lock with its record written.
 * @throws the write error, after releasing the lock.
 */
export function acquireLockWithOwner(path, info) {
  const lock = InstanceLock.acquire(path);
  if (lock === undefined) return undefined;
  try {
    writeLockOwner(path, info);
  } catch (error) {
    lock.release();
    throw error;
  }
  return lock;
}

/** #216: is `pid` a live process on this machine? EPERM means it exists but is not ours. */
function alive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (error) { return error?.code === 'EPERM'; }
}

/**
 * #227: does anyone hold the lock at `path`? Answered by reading it, never by taking it.
 *
 * The probe used to be `InstanceLock.acquire` + release, so it held the exclusive lock for the
 * instant between the two: a page poll landing in that instant made a DSH starting at the same
 * moment refuse to start (实测约 95 us/次，另一进程 120 次启动被拒 0 次但这是运气), and on a free
 * directory it created the lock file. A read-only connection takes no lock and creates no file:
 * a holder's `BEGIN EXCLUSIVE` makes the read fail at once with SQLITE_BUSY — the same signal
 * without the contention (实测约 32 us/次).
 *
 * @returns 'held' when someone holds the lock, 'free' when nobody does, 'unknown' when the file
 * cannot be read for a reason other than "locked" (permissions, I/O).
 */
function probeLock(path) {
  let db;
  try {
    db = new DatabaseSync(path, { readOnly: true });
    // 来源：沿用 InstanceLock.acquire 的 0 —— 探测不能等，等就等于页面轮询把状态请求拖住。
    db.exec('PRAGMA busy_timeout = 0;');
    db.prepare('SELECT count(*) FROM sqlite_master').get();
    return 'free';
  } catch (error) {
    // 来源：SQLite 结果码——5 BUSY / 6 LOCKED 是别人的排他事务。
    if (error?.errcode === 5 || error?.errcode === 6 || /\blocked\b|\bbusy\b/i.test(String(error?.message))) return 'held';
    // 14 CANTOPEN 有歧义：文件不在（没人持锁）和数据目录不可读（读不出状态）都会报它。
    // 来源：实测——目录 000 时 existsSync 也回 false，只有 access 的 EACCES/ENOENT 能分开。
    try { accessSync(path, constants.R_OK); } catch (denied) { return denied?.code === 'ENOENT' ? 'free' : 'unknown'; }
    return 'unknown';
  } finally {
    try { db?.close(); } catch { /* nothing to close */ }
  }
}

/**
 * #216: what a DSH that lost the lock tells its own page about that lock.
 * - the lock is free (the holder quit): `free`, so the page asks for a restart instead of
 *   repeating a holder that already let go;
 * - the lock is held and a live holder recorded itself: who holds it;
 * - the lock is held, or cannot be read, without a trustworthy record: busy, holder unknown —
 *   the page must still not call it "not configured".
 *
 * The record alone never decides. Only `alive(pid)` plus a held lock makes it the holder: a dead
 * pid's record outlives its holder, and a crash between `release` and `clearLockOwner` leaves a
 * record naming a process that holds nothing (#227 2026-11-06 19:40，notes/utils/227-lockprobe/e.mjs).
 */
export function lockStatus(path) {
  const record = readLockOwner(path);
  // #216: the data directory and the lock path travel with every answer, so a page told
  // "busy, holder unknown" can still say which directory to look at and which file to check
  // (`lsof <lock>`) — and does not have to rebuild a path itself, which breaks on Windows.
  const where = { dataDir: dirname(path), lock: path };
  if (probeLock(path) === 'free') return { busy: false, free: true, ...where };
  // #227: still held (or unreadable) — name the holder only when the record and the lock agree.
  if (record !== undefined && alive(record.pid)) {
    const { local, ...owner } = record;
    return { busy: true, owner, ...where };
  }
  return { busy: true, owner: null, ...where };
}
