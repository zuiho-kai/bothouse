// #1020 回复的记忆来源：which pushed memory entries a reply used, shown as a badge under it.
// The gate pushes entries tagged [#编号] before each turn (bridge/contrib/gate/ctxsvc.py exp_tag) and the
// agent reports the ones it used with memvote.py (+编号), which appends a by="self" line to votes.jsonl
// ({t, voter: CC_PROJECT, id: "页#指纹", vote, by, key: CC_SESSION_KEY, agent}). This module tails that file
// and hands each new reply of a member the entries it cited in that room since its previous reply.
// Nothing is guessed: no citation, no badge (a member that never runs memvote gets none).
//
// Where the file is: MEMVOTE_DIR (memvote.py's own override), else <gate data dir>/gate, where bothouse
// installs the gate (bridge/core/gate_proc.go). The data dir is found the way the gate itself finds it
// (bridge/contrib/gate/datadir.py data_dir, Go brand.go dataDir): BOTHOUSE_DATA_DIR, GATE_SETUP_DIR,
// CC_DATA_DIR, else ~/.bothouse (~/.cc-connect only while that legacy layout is the one that exists).
// It must not depend on BOTHOUSE_DATA_DIR alone: a `dsh web` started by a script that reuses an old
// environment has only CC_DATA_DIR, and the badge used to vanish there silently.
// Page paths are relative to GATE_WIKI (~/wiki) or start with ~/ for a role wiki (memvote.full_id).
import { closeSync, existsSync, openSync, readSync, readFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';

const MAX_ITEMS = 12; // a badge lists at most this many entries
const TITLE_CHARS = 120;

/** `~/x` in a config value, as expanduser does for the gate (datadir.guard). */
const expand = (value, home) => String(value ?? '').trim().replace(/^~(?=\/|$)/, home);

/**
 * The bothouse data dirs this machine may have, in the order the gate itself picks one
 * (bridge/contrib/gate/datadir.py data_dir; Go brand.go dataDir for the last one).
 * @param {NodeJS.ProcessEnv} env
 * @param {string} home
 * @returns {string[]}
 */
export function dataDirCandidates(env = process.env, home = homedir()) {
  const dirs = [];
  for (const key of ['BOTHOUSE_DATA_DIR', 'GATE_SETUP_DIR', 'CC_DATA_DIR']) {
    const dir = expand(env[key], home);
    if (dir !== '') dirs.push(dir);
  }
  // ~/.cc-connect is the legacy layout, used only while ~/.bothouse does not exist and it does.
  const preferred = join(home, '.bothouse');
  const legacy = join(home, '.cc-connect');
  dirs.push(!existsSync(preferred) && existsSync(legacy) ? legacy : preferred);
  return dirs;
}

/**
 * memvote.py's votes.jsonl: MEMVOTE_DIR when set (memvote's own override names the one file it writes),
 * else <the gate's data dir>/gate. Same precedence as the gate reading its own directory, so a `dsh web`
 * that inherited only CC_DATA_DIR reads the file the running gate actually appends to.
 * @param {NodeJS.ProcessEnv} env
 * @param {string} home
 * @returns {string}
 */
export function defaultVotesFile(env = process.env, home = homedir()) {
  const dir = expand(env.MEMVOTE_DIR, home);
  if (dir !== '') return join(dir, 'votes.jsonl');
  return join(dataDirCandidates(env, home)[0], 'gate', 'votes.jsonl');
}

/** Room id a cite's session key names: bridge cloud-web "…room-<id>…", or the DSH gate key "dsh:<member>:<room>". */
export function keyRoom(key) {
  const s = String(key ?? '');
  const m = /(?:^|:)room-(\d+)(?::|$)/.exec(s) ?? /^dsh:[^:]+:(\d+)$/.exec(s);
  return m ? Number(m[1]) : undefined;
}

export class MemorySources {
  /** @param options - { file?: votes.jsonl path, wiki?, home?, logger? } */
  constructor({ file = defaultVotesFile(), wiki = process.env.GATE_WIKI || join(homedir(), 'wiki'), home = homedir(), logger } = {}) {
    this.file = file;
    this.wiki = String(wiki).replace(/^~(?=\/|$)/, home);
    this.home = home;
    this.logger = logger;
    // Say which file the badge reads, so a silent one is explained in the log instead of vanishing.
    if (!this.file) this.logger?.warn?.('collab: memory sources: no votes.jsonl path (set BOTHOUSE_DATA_DIR, GATE_SETUP_DIR or CC_DATA_DIR, or MEMVOTE_DIR); replies carry no memory sources');
    else if (existsSync(this.file)) this.logger?.info?.('collab: memory sources: reading %s', this.file);
    else this.logger?.warn?.('collab: memory sources: %s does not exist yet (wrong data dir, or the gate has not recorded a cite); replies carry no memory sources until it appears', this.file);
    // Only citations made after this process started belong to its replies.
    this.offset = this.size();
    this.rest = '';
    /** `${voter}\0${room}` -> ordered unique entry ids cited and not yet shown. */
    this.pending = new Map();
    this.titles = new Map();
  }

  size() {
    if (!this.file) return 0;
    try { return statSync(this.file).size; } catch { return 0; }
  }

  /** Read the lines appended since the last call. */
  poll() {
    if (!this.file) return;
    const size = this.size();
    if (size < this.offset) { this.offset = 0; this.rest = ''; } // rotated or truncated
    if (size === this.offset) return;
    let fd;
    try {
      fd = openSync(this.file, 'r');
      const buf = Buffer.alloc(size - this.offset);
      readSync(fd, buf, 0, buf.length, this.offset);
      this.offset = size;
      const lines = (this.rest + buf.toString('utf8')).split('\n');
      this.rest = lines.pop() ?? '';
      for (const line of lines) this.take1(line);
    } catch (error) {
      this.logger?.warn?.('collab: memory sources: %s', error?.message ?? error);
    } finally {
      if (fd !== undefined) closeSync(fd);
    }
  }

  take1(line) {
    let r;
    try { r = JSON.parse(line); } catch { return; }
    // by="self" vote=1: the agent says it used this entry (memvote.py "+编号"); "-" (entry wrong) and "x" are not sources.
    if (r?.by !== 'self' || r.vote !== 1 || typeof r.id !== 'string' || !r.id.includes('#')) return;
    const room = keyRoom(r.key);
    if (room === undefined || !r.voter) return;
    const k = `${r.voter}\u0000${room}`;
    const list = this.pending.get(k) ?? [];
    if (!list.includes(r.id)) list.push(r.id);
    this.pending.set(k, list);
  }

  /**
   * The entries `voter` cited in `room` since its previous reply there, as [{ id, ref, page, title }]
   * (ref = the short 编号 shown in the push), and forget them. [] when it cited none.
   */
  take(voter, room) {
    this.poll();
    const k = `${voter}\u0000${room}`;
    const ids = this.pending.get(k);
    if (!ids?.length) return [];
    this.pending.delete(k);
    return ids.slice(0, MAX_ITEMS).map(id => {
      const [page, ref] = [id.slice(0, id.lastIndexOf('#')), id.slice(id.lastIndexOf('#') + 1)];
      return { id, ref, page, title: this.title(page, ref) };
    });
  }

  /** The wiki line an entry id points at (memvote.full_id: sha1 of the stripped line, first 10 hex), trimmed. */
  title(page, ref) {
    const key = `${page}#${ref}`;
    if (this.titles.has(key)) return this.titles.get(key);
    let out = '';
    const path = page.startsWith('~/') ? join(this.home, page.slice(2)) : join(this.wiki, page);
    try {
      for (const raw of readFileSync(path, 'utf8').split('\n')) {
        if (createHash('sha1').update(raw.trim()).digest('hex').slice(0, 10) !== ref) continue;
        out = raw.trim().replace(/^[-*]\s+/, '').replace(/\s+/g, ' ');
        break;
      }
    } catch { /* page moved or gone: the badge still shows its path */ }
    if (out.length > TITLE_CHARS) out = out.slice(0, TITLE_CHARS - 1) + '…';
    this.titles.set(key, out);
    return out;
  }
}
