// A DSH member's own wiki index on the first turn of each conversation, as the bridge gives a role
// its MEMORY.md (bridge/core/memoryindex.go memoryBlock, project option memory_index): same head line,
// same once-per-fresh-context rule. The member's wiki is <BOTHOUSE_DATA_DIR>/roles/<member id>/wiki,
// where bothouse makes it (bridge/core/setup_dsh_wiki.go).
// #1643: the plugin installed alone (no bridge, no BOTHOUSE_DATA_DIR) used to give no block at all, so a
// member never learned it had a memory. The data dir now falls back the way the gate's does
// (memory-sources.mjs dataDirCandidates: ... else ~/.bothouse under os.homedir(), which also works on a
// Windows without HOME, #1047), and a member without a MEMORY.md gets a starter one on its first turn.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { dataDirCandidates } from './memory-sources.mjs';

// bridge/core/memoryindex.go memoryIndexHead
export const MEMORY_INDEX_HEAD = '（你的记忆 wiki 目录页';

// The MEMORY.md a member without one starts with: where its memory lives and how to add to it.
export const STARTER_MEMORY_INDEX = [
  '# 记忆目录',
  '',
  '这是你的记忆 wiki 的目录页，每个新会话开头自动附上。值得以后记得的事（用户的偏好、定下的做法、做过的事），在这个目录旁边写成一页，再在这里加一行：',
  '- [标题](页面.md) — 一句话说明',
  '',
].join('\n');

export class MemoryIndex {
  /**
   * @param options - { dataDir?: bothouse data dir (default: BOTHOUSE_DATA_DIR, GATE_SETUP_DIR, CC_DATA_DIR,
   *   else ~/.bothouse; '' = none), home? }.
   */
  constructor({ dataDir, home = homedir() } = {}) {
    this.dataDir = String(dataDir ?? dataDirCandidates(process.env, home)[0]).trim();
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
    try { body = readFileSync(file, 'utf8').trim(); } catch (error) {
      if (error?.code !== 'ENOENT') return none;
      try {
        mkdirSync(dirname(file), { recursive: true });
        writeFileSync(file, STARTER_MEMORY_INDEX, { flag: 'wx' });
        body = readFileSync(file, 'utf8').trim();
      } catch { return none; }
    }
    if (!body) return none;
    const shown = this.home && file.startsWith(this.home + '/') ? '~' + file.slice(this.home.length) : file;
    return {
      block: `${MEMORY_INDEX_HEAD} ${shown}，新会话系统自动附上，不用回应）\n${body}`,
      commit: () => { this.given.set(key, session); },
    };
  }

  /** /new for a (member, room) whose session key does not change (a local CLI member): start it over. */
  reset(member, room) {
    this.given.delete(`${member}\u0000${room}`);
  }

  /** This member's conversation in room lost its context (a CLI session that could not be resumed): give it again. */
  forget(member, room) {
    this.given.delete(`${member}\u0000${room}`);
  }

  /** A released workspace starts its conversations over: give the index again. */
  resetRoom(room) {
    for (const key of this.given.keys()) if (key.endsWith(`\u0000${room}`)) this.given.delete(key);
  }
}
