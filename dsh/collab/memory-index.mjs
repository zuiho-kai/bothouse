// A DSH member's own wiki index on the first turn of each conversation, as the bridge gives a role
// its MEMORY.md (bridge/core/memoryindex.go memoryBlock, project option memory_index): same head line,
// same once-per-fresh-context rule. The member's wiki is <BOTHOUSE_DATA_DIR>/roles/<member id>/wiki,
// where bothouse makes it (bridge/core/setup_dsh_wiki.go). No wiki, no block.
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

// bridge/core/memoryindex.go memoryIndexHead
export const MEMORY_INDEX_HEAD = '（你的记忆 wiki 目录页';

export class MemoryIndex {
  /** @param options - { dataDir?: bothouse data dir (default process.env.BOTHOUSE_DATA_DIR), home? }. */
  constructor({ dataDir = process.env.BOTHOUSE_DATA_DIR, home = homedir() } = {}) {
    this.dataDir = String(dataDir ?? '').trim();
    this.home = home;
    /** `${member}\0${room}` -> session the index was given in (undefined for a local CLI member). */
    this.given = new Map();
  }

  /** The member's MEMORY.md path ('' when there is no data dir). */
  path(member) {
    return this.dataDir ? join(this.dataDir, 'roles', String(member), 'wiki', 'MEMORY.md') : '';
  }

  /**
   * The index block when this (member, room) conversation has not had it (a new `session` is a fresh
   * context and gets it again), and a commit() that records it as given once the prompt is handed over.
   * @returns {{ block: string, commit: () => void }}
   */
  turn({ member, room, session }) {
    const none = { block: '', commit: () => {} };
    const key = `${member}\u0000${room}`;
    if (this.given.has(key) && this.given.get(key) === session) return none;
    const file = this.path(member);
    if (!file) return none;
    let body;
    try { body = readFileSync(file, 'utf8').trim(); } catch { return none; }
    if (!body) return none;
    const shown = this.home && file.startsWith(this.home + '/') ? '~' + file.slice(this.home.length) : file;
    return {
      block: `${MEMORY_INDEX_HEAD} ${shown}，新会话系统自动附上，不用回应）\n${body}`,
      commit: () => { this.given.set(key, session); },
    };
  }

  /** A released workspace starts its conversations over: give the index again. */
  resetRoom(room) {
    for (const key of this.given.keys()) if (key.endsWith(`\u0000${room}`)) this.given.delete(key);
  }
}
