// #876: read-only busy/idle view of cc-connect's team status files.
//
// cc-connect writes one <project>.json per bot under its team_status_dir
// (bridge/core/team.go:319). The hub only reads them: no writes, no bridge
// calls, no new event type. The existing `members` event carries the result.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

// Same cadence as bridge/core/team.go:26 teamPollInterval: the desk is never
// more than one writer tick behind.
export const TEAM_POLL_INTERVAL_MS = 2000;
// bridge/core/team.go:28 teamStaleAfter: three 20s heartbeats, then the bot
// is treated as gone rather than busy forever.
export const TEAM_STALE_AFTER_MS = 60_000;
const STATUS_FILE = /^[a-z0-9][a-z0-9_-]*\.json$/i;

function parseTime(value) {
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : undefined;
}

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function iso(ms) {
  return ms === undefined ? null : new Date(ms).toISOString();
}

/**
 * Merge one member's status files into the optional fields on a member view.
 * Every busy session is kept: a bot can work in several channels at once, and
 * the desk needs all of them, not just the first.
 */
export function presenceOf(entries) {
  const items = [];
  for (const entry of entries) {
    const project = text(entry?.project);
    for (const session of Array.isArray(entry?.sessions) ? entry.sessions : []) {
      if (session?.busy !== true) continue;
      items.push({ project, chat: text(session.chat) || null, task: text(session.task), since: parseTime(session.since) });
    }
  }
  const chats = [...new Set(items.map(i => i.chat).filter(Boolean))].sort();
  const since = items.map(i => i.since).filter(v => v !== undefined).sort((a, b) => a - b)[0];
  const lead = items.find(i => i.chat !== null && i.task) ?? items.find(i => i.chat !== null) ?? items.find(i => i.task) ?? items[0];
  const done = entries.map(e => parseTime(e?.done_at)).filter(v => v !== undefined).sort((a, b) => a - b).at(-1);
  return {
    busy: items.length > 0,
    busy_since: iso(since),
    busy_task: lead?.task ?? '',
    busy_chat: lead?.chat ?? null,
    busy_chats: chats,
    busy_count: items.length,
    busy_items: items.map(i => ({ project: i.project, chat: i.chat, task: i.task, since: iso(i.since) })),
    ...(items.length === 0 && done !== undefined ? { busy_done_at: iso(done) } : {}),
  };
}

/** Parse one status file; `error` is a reason the caller may warn about. */
export function readStatusFile(path, now, staleAfterMs = TEAM_STALE_AFTER_MS) {
  let raw;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (error) {
    return { error: error?.code === 'ENOENT' ? 'gone' : 'read' };
  }
  let entry;
  try {
    entry = JSON.parse(raw);
  } catch {
    return { error: 'json' };
  }
  if (entry === null || typeof entry !== 'object' || Array.isArray(entry)
    || typeof entry.project !== 'string' || entry.project.trim() === ''
    || (entry.sessions != null && !Array.isArray(entry.sessions))) return { error: 'shape' };
  const updated = parseTime(entry.updated);
  if (updated === undefined) return { error: 'shape' };
  if (now - updated > staleAfterMs) return { error: 'stale' };
  return { entry, updated };
}

export class TeamStatus {
  constructor(hub, dir, { logger, intervalMs = TEAM_POLL_INTERVAL_MS, staleAfterMs = TEAM_STALE_AFTER_MS, now = Date.now } = {}) {
    this.hub = hub;
    this.dir = dir;
    this.logger = logger;
    this.intervalMs = intervalMs;
    this.staleAfterMs = staleAfterMs;
    this.now = now;
    this.timer = undefined;
    this.published = new Set();
    this.fileOwner = new Map();
    this.warned = new Set();
  }

  start() {
    if (!this.dir || this.timer !== undefined) return;
    this.poll();
    this.timer = setInterval(() => this.poll(), this.intervalMs);
    this.timer.unref?.();
  }

  stop() {
    if (this.timer !== undefined) clearInterval(this.timer);
    this.timer = undefined;
    this.published.clear();
  }

  warnOnce(key, format, ...args) {
    if (this.warned.has(key)) return;
    this.warned.add(key);
    this.logger?.warn?.(format, ...args);
  }

  /** Match a status project to a hub member: id first, then display name. */
  resolve(project, name) {
    const members = this.hub.memberList().filter(m => m.kind !== 'human');
    const direct = members.find(m => String(m.id).toLowerCase() === text(project).toLowerCase());
    if (direct !== undefined) return direct;
    const label = text(name).toLowerCase();
    if (label === '') return undefined;
    const same = members.filter(m => text(m.name).toLowerCase() === label);
    if (same.length === 1) return same[0];
    if (same.length > 1) this.warnOnce(`ambiguous:${project}`, 'conest-collab: team project %s matches %d members by name; busy state skipped', project, same.length);
    return undefined;
  }

  poll() {
    if (!this.dir) return;
    let names;
    try {
      names = readdirSync(this.dir).sort();
    } catch {
      this.warnOnce('dir', 'conest-collab: team status directory is unreadable: %s', this.dir);
      for (const id of this.published) this.hub.setPresence(id, undefined);
      this.published.clear();
      return;
    }
    this.warned.delete('dir');
    const now = this.now();
    const byMember = new Map();
    const keep = new Set();
    for (const name of names) {
      if (!STATUS_FILE.test(name) || name.startsWith('board')) continue;
      const path = join(this.dir, name);
      const loaded = readStatusFile(path, now, this.staleAfterMs);
      if (loaded.error !== undefined) {
        if (loaded.error === 'stale' || loaded.error === 'gone') {
          this.fileOwner.delete(name);
        } else {
          this.warnOnce(`file:${name}`, 'conest-collab: bad team status file %s', path);
          // A writer may be mid-replace; keep the last good state, but only for the
          // same 60s window a readable file would still be valid in.
          const previous = this.fileOwner.get(name);
          if (previous !== undefined && now - previous.updated <= this.staleAfterMs) keep.add(previous.id);
          else this.fileOwner.delete(name);
        }
        continue;
      }
      this.warned.delete(`file:${name}`);
      const { entry, updated } = loaded;
      const member = this.resolve(entry.project, entry.name);
      if (member === undefined) {
        this.warnOnce(`member:${entry.project}`, 'conest-collab: no hub member for team project %s; busy state skipped', entry.project);
        continue;
      }
      this.warned.delete(`member:${entry.project}`);
      this.fileOwner.set(name, { id: member.id, updated });
      if (member.online === false || member.error) continue;
      const list = byMember.get(member.id) ?? [];
      list.push(entry);
      byMember.set(member.id, list);
    }
    // A stale, deleted or unmatched member must stop looking busy on the desk.
    for (const id of this.published) if (!byMember.has(id) && !keep.has(id)) this.hub.setPresence(id, undefined);
    for (const [id, entries] of byMember) this.hub.setPresence(id, presenceOf(entries));
    this.published = new Set([...byMember.keys(), ...keep]);
  }
}