// #1020 回复的记忆来源：which pushed memory entries a reply used, shown as a badge under it.
// The gate pushes entries tagged [#编号] before each turn (bridge/contrib/gate/ctxsvc.py exp_tag) and the
// agent reports the ones it used with memvote.py (+编号), which appends a by="self" line to votes.jsonl
// ({t, voter: CC_PROJECT, id: "页#指纹", vote, by, key: CC_SESSION_KEY, agent}). This module tails that file
// and hands each new reply of a member the entries it cited in that room since its previous reply.
// Nothing is guessed: no citation, no badge (a member that never runs memvote gets none).
//
// Where the file is: MEMVOTE_DIR (memvote.py's own override), else <BOTHOUSE_DATA_DIR>/gate, where
// bothouse installs the gate (bridge/core/gate_proc.go). Page paths are relative to GATE_WIKI (~/wiki)
// or start with ~/ for a role wiki (memvote.full_id).
import { closeSync, openSync, readSync, readFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';

const MAX_ITEMS = 12; // a badge lists at most this many entries
const TITLE_CHARS = 120;

export function defaultVotesFile(env = process.env) {
  const dir = String(env.MEMVOTE_DIR ?? '').trim() || (String(env.BOTHOUSE_DATA_DIR ?? '').trim() ? join(String(env.BOTHOUSE_DATA_DIR).trim(), 'gate') : '');
  return dir ? join(dir, 'votes.jsonl') : '';
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
