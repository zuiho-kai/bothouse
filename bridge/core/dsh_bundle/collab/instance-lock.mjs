import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export const LOCK_FILE = 'collab.lock';

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
