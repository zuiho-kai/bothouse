// Durable workspace questions; system forwards never enter agent routing.
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { withoutLeadingMentions } from './mentions.mjs';

export function exitTarget(msg) {
  return /^team-answer:([^:]+):/.exec(msg.client_key ?? '')?.[1];
}

// The workspace [ask]/[report] rules (first-line mark and #id format, the [ask] self-check, bounce
// texts) are one file, team-exit-rules.json next to this one; the Go bridge reads the same file
// (bridge/core/team_exit_rules.go, from its dsh_bundle copy) and both sides run the shared cases in
// test/team-exit-cases.json. No formats or texts live here. Regexes are written for both RE2 and JS.
export const RULES = JSON.parse(readFileSync(new URL('./team-exit-rules.json', import.meta.url), 'utf8'));
const HEADLINE = new RegExp(RULES.headline_re);
const SELF_CHECK = new RegExp(RULES.ask.self_check_re);
const CATEGORY = new RegExp(RULES.ask.category_re);
const EXEMPT = new RegExp(RULES.ask.exempt_re);
const NO_CHECK = new RegExp(RULES.ask.no_check_re);
const JARGON_URL = new RegExp(RULES.jargon.url_re, 'g');
const JARGON_LINE = new RegExp(RULES.jargon.line_re, 'g');
const JARGON_TABLE = new RegExp(RULES.jargon.table_re);
const BACKGROUND = new RegExp(RULES.summary.background_re);
const TODO = new RegExp(RULES.summary.todo_re);
const DETAIL = new RegExp(RULES.summary.detail_re);
const ADDED = new RegExp(RULES.summary.added_re);
// Consecutive bounces that still wake the asking member; later ones are only posted.
const BOUNCE_WAKE_LIMIT = RULES.bounce.wake_limit;

/** What an [ask] body lacks; [] means it may go to the user. */
export function askEvidenceProblems(body) {
  const cat = CATEGORY.exec(body);
  const category = cat ? body.slice(cat.index + cat[0].length).split('\n')[0].trim() : '';
  const own = SELF_CHECK.exec(body);
  let check = '';
  if (own) {
    let rest = body.slice(own.index + own[0].length);
    const next = CATEGORY.exec(rest);
    if (next) rest = rest.slice(0, next.index);
    check = rest.trim();
  }
  const problems = [];
  if (!check) problems.push(RULES.ask.missing_self_check);
  if (!category) problems.push(RULES.ask.missing_category);
  if (check && category && NO_CHECK.test(check) && !EXEMPT.test(category)) problems.push(RULES.ask.no_check_not_exempt);
  return problems;
}

/** { id, line, problems } of a marked body's first line; line is the part for the user (Go: exitHeadline). */
export function exitHeadline(body) {
  const first = String(body ?? '').split('\n')[0].trim();
  const m = HEADLINE.exec(first);
  const { missing_id: noId, missing_line: noLine } = RULES.headline;
  if (!m) return { id: 0, line: '', problems: first === '' || first.startsWith('#') ? [noId, noLine] : [noId] };
  const { summary: line } = exitSplit(body);
  return { id: Number(m[1]), line, problems: line ? [] : [noLine] };
}

/**
 * { summary, detail } of a marked body (Go: exitSplit): after the first line's #id, up to and
 * including the 「我加的：」 line (else the 「要你做的：」 line) is posted for the user; the lines after it go under that post.
 */
export function exitSplit(body) {
  let lines = String(body ?? '').replaceAll('\r\n', '\n').split('\n');
  const m = HEADLINE.exec(lines[0].trim());
  if (m) lines[0] = m[2];
  while (lines.length && !lines[0].trim()) lines.shift();
  let end = lines.findIndex(l => TODO.test(l));
  if (end >= 0) {
    const added = lines.findIndex((l, i) => i > end && ADDED.test(l));
    if (added >= 0) end = added;
  }
  if (end < 0) {
    const blank = lines.findIndex(l => !l.trim());
    end = blank < 0 ? lines.length - 1 : blank - 1;
  }
  const summary = lines.slice(0, end + 1).join('\n').trim();
  let rest = lines.slice(end + 1);
  while (rest.length && !rest[0].trim()) rest.shift();
  if (rest.length && DETAIL.test(rest[0].trim())) rest = rest.slice(1);
  return { summary, detail: rest.join('\n').trim() };
}

/** What the part for the user lacks: background, what was done, what the user is to do, what the agent added (Go: summaryProblems). */
export function summaryProblems(summary) {
  const lines = String(summary).split('\n');
  const problems = [];
  if (!BACKGROUND.test(lines[0].trim())) problems.push(RULES.summary.missing_background);
  const todo = lines.findIndex(l => TODO.test(l));
  let done = false;
  for (let i = 1; i < lines.length && !done; i++) {
    let l = lines[i];
    if (i === todo) l = l.slice(0, TODO.exec(l).index);
    else if (todo >= 0 && i > todo) break;
    done = l.trim() !== '';
  }
  if (!done) problems.push(RULES.summary.missing_done);
  if (todo < 0) problems.push(RULES.summary.missing_todo);
  if (!lines.some(l => ADDED.test(l))) problems.push(RULES.summary.missing_added);
  return problems;
}

/** The part for the user names numbers, workspaces, branches, paths or identifiers, or has a table (Go: jargonProblems). */
export function jargonProblems(line) {
  const problems = [];
  const hits = [...String(line).replace(JARGON_URL, ' ').matchAll(JARGON_LINE)].map(m => m[0].replace(/^[^~/`#!_\-0-9A-Za-z＃！工]+/u, ''));
  if (hits.length) problems.push(RULES.jargon.line.replaceAll('{hits}', hits.join('、')));
  if (JARGON_TABLE.test(line)) problems.push(RULES.jargon.table);
  return problems;
}

/** Why a workspace [ask]/[report] stayed in the workspace and how to resend it (Go: exitBounceText). */
export function exitBounceText(kind, problems) {
  const vars = { kind, problems: problems.join(RULES.bounce.sep), extra: RULES.bounce.extra[kind] ?? '' };
  return RULES.bounce.text.replace(/\{(kind|problems|extra)\}/g, (_, k) => vars[k]);
}

/**
 * How a marked body is judged (Go: judgeExit): { id, line, problems, legacy }. known(id): the id is a
 * task; bounces: replies in a row already sent back. problems [] means it goes to the chat channel;
 * legacy: the format is still wrong but bounces stopped waking the member (the bridge's chat lead
 * rewrites it; DSH posts it without the headline).
 */
export function judgeExit(kind, body, { known, bounces = 0 }) {
  const problems = kind === 'ask' ? askEvidenceProblems(body) : [];
  let { id, line, problems: hp } = exitHeadline(body);
  if (!hp.length && !known(id)) hp = [RULES.headline.unknown_id.replaceAll('{id}', String(id))];
  else if (!hp.length) hp = [...summaryProblems(line), ...jargonProblems(line)];
  // Format goes back only while bounces still wake the member; after that the chat lead rewrites it.
  if (hp.length && !problems.length && bounces >= BOUNCE_WAKE_LIMIT) return { id, line, problems, legacy: true };
  return { id, line, problems: [...problems, ...hp], legacy: false };
}

/**
 * The task a workspace reply is about (Go: exitTaskPick): the one its first line names when that one
 * is here (bound to this workspace), else the one bound here last; 0 when none is here.
 * items: [{ id, here, bound }], bound compared as given.
 */
export function exitTaskPick(named, items) {
  let pick = 0, last;
  for (const it of items) {
    if (!it.here) continue;
    if (named > 0 && it.id === named) return named;
    if (pick === 0 || it.bound > last) { pick = it.id; last = it.bound; }
  }
  return pick;
}

const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const MARKS = RULES.kinds.map(k => escapeRe(RULES.mark.replace('{kind}', k))).join('|');
const FIRST_MARK = new RegExp(`^(${MARKS})([\\s\\S]*)$`, 'i');
// A mark with nothing after it is no mark (Go: parseExitKind).
const firstMark = t => { const m = FIRST_MARK.exec(t); return m?.[2].trim() ? m : null; };
const markKind = tag => RULES.kinds.find(k => RULES.mark.replace('{kind}', k).toLowerCase() === tag.toLowerCase());
const LINE_MARK = new RegExp(`^[ \\t]*(${MARKS})`, 'i');

/**
 * The [ask] / [report] mark of a role reply: { kind, body } or undefined. Marked on the first
 * line, as the bridge reads it (core/team_exit.go parseExitKind, first line only). lastLine (a
 * DSH member, whose reply is one row for the whole turn: first line 【接】#id, then everything it
 * said) also takes the line starting the turn's last part: the last line that opens with the mark.
 * team (the routable members): @-mentions a reply or a part opens with are not part of it (#597 G37:
 * a DSH reply comes back as 「@主 [report]…」, dsh-member.mjs returnToLead, also as a later part of
 * the turn's row, #597 G40), as for its stance line.
 */
export function exitMark(text, { lastLine = false, team = [] } = {}) {
  const t = withoutLeadingMentions(String(text ?? ''), team).trim();
  let m = firstMark(t);
  if (m === null && lastLine) {
    const lines = t.split('\n');
    for (let i = lines.length - 1; i > 0 && m === null; i--) {
      const line = withoutLeadingMentions(lines[i], team);
      if (LINE_MARK.test(line)) m = firstMark([line.trimStart(), ...lines.slice(i + 1)].join('\n'));
    }
  }
  return m === null ? undefined : { kind: markKind(m[1]), body: m[2].trim() };
}

export class TeamExit {
  constructor(hub) {
    this.hub = hub;
    this.db = hub.store.db;
    this.enabled = this.db.prepare('PRAGMA table_info(rooms)').all().some(c => c.name === 'parent_id');
    if (!this.enabled) return;
    this.db.exec(`CREATE TABLE IF NOT EXISTS team_exit_asks (
      id TEXT PRIMARY KEY, parent_id INTEGER NOT NULL, workspace_id INTEGER NOT NULL,
      member_id TEXT NOT NULL, forwarded_id INTEGER UNIQUE, source_id INTEGER UNIQUE,
      answer_source_id INTEGER UNIQUE, answered INTEGER NOT NULL DEFAULT 0)`);
    this.bounces = new Map(); // `${room}:${member}` -> consecutive [ask] bounces
    hub.onMessage(msg => this.onMessage(msg));
  }

  /** Post why the [ask] stayed in the workspace and wake its author to fix it. */
  bounce(room, msg, problems, kind = 'ask') {
    const key = `${room.id}:${msg.author}`;
    const count = (this.bounces.get(key) ?? 0) + 1;
    this.bounces.set(key, count);
    const { message } = this.hub.post(room.id, {
      authorKind: 'system', author: 'system', name: 'system', clientKey: `team-exit-bounce:${msg.id}`,
      text: `📬 @${msg.name} ${exitBounceText(kind, problems)}`,
    });
    if (count > BOUNCE_WAKE_LIMIT) return;
    for (const wake of this.hub.tasks?.wakers ?? []) {
      try { if (wake(msg.author, message)) break; } catch (error) { this.hub.logger?.warn?.('collab: ask bounce wake failed: %s', error?.message ?? error); }
    }
  }

  answerFor(msg) {
    if (!this.enabled || msg.author_kind !== 'user' || exitTarget(msg)) return;
    const prior = this.db.prepare('SELECT * FROM team_exit_asks WHERE answer_source_id = ?').get(msg.id);
    if (prior) return prior;
    const token = /\bask-[0-9a-f]{8}\b/.exec(msg.text)?.[0];
    return this.db.prepare(`SELECT * FROM team_exit_asks WHERE parent_id = ? AND answered = 0
      AND (forwarded_id = ? OR id = ?) ORDER BY source_id LIMIT 1`).get(msg.room_id, msg.reply_to ?? null, token ?? null);
  }

  onMessage(msg) {
    const answer = this.answerFor(msg);
    if (answer) {
      if (answer.answered) return;
      // Stable client key prevents duplicate delivery if acknowledgement is retried.
      const { message } = this.hub.post(answer.workspace_id, {
        authorKind: 'user', author: msg.author, name: msg.name,
        text: `@${this.hub.members?.get(answer.member_id)?.name ?? answer.member_id} 用户回复 ${answer.id}：\n${msg.text}`,
        clientKey: `team-answer:${answer.member_id}:${answer.id}`,
      });
      this.db.prepare('UPDATE team_exit_asks SET answered = 1, answer_source_id = ? WHERE id = ?').run(msg.id, answer.id);
      // #597 G35: the watch waited on the user (Tasks.watch awaitingUser); it starts again from here.
      this.hub.tasks?.rewatch?.(answer.workspace_id, answer.member_id);
      return message;
    }
    if (msg.author_kind !== 'role') return;
    const mark = msg.card == null ? exitMark(msg.text, this.markOpts(msg)) : undefined;
    const room = this.workspaceOf(msg);
    if (!room) return;
    const ask = mark?.kind === 'ask';
    let headline;
    if (mark) {
      const bounces = this.bounces.get(`${room.id}:${msg.author}`) ?? 0;
      const v = judgeExit(mark.kind, mark.body, { known: id => Boolean(this.hub.tasks?.task?.(id)), bounces });
      if (v.problems.length) return this.bounce(room, msg, v.problems, mark.kind);
      // Once bounces stop waking the member, a reply still without a headline goes out as before.
      if (!v.legacy) headline = { ...v, task: this.hub.tasks?.task?.(v.id) };
    }
    // Any reply without a bounced [ask] ends the run of bounces.
    this.bounces.delete(`${room.id}:${msg.author}`);
    if (!mark) return;
    let record;
    if (ask) {
      this.db.prepare(`INSERT OR IGNORE INTO team_exit_asks (id, parent_id, workspace_id, member_id, source_id)
        VALUES (?, ?, ?, ?, ?)`).run(`ask-${randomBytes(4).toString('hex')}`, room.parent_id, room.id, msg.author, msg.id);
      record = this.db.prepare('SELECT * FROM team_exit_asks WHERE source_id = ?').get(msg.id);
    }
    const message = this.forward(room, msg, mark.body, record, headline);
    if (ask) {
      this.db.prepare('UPDATE team_exit_asks SET forwarded_id = ? WHERE id = ?').run(message.id, record.id);
      const tasks = this.hub.tasks;
      // #597 G35: a DSH member's [ask] keeps its task in work and watched (and its workspace, so the
      // answer reaches the same session); a bridge bot's [ask] parks it as before (#280).
      if (tasks && !this.markOpts(msg).lastLine) {
        const busy = tasks.q.allBusy.all('assigned', 'accepted', 'asked', 'rework');
        const named = headline?.task;
        const items = [...(named ? [named] : []), ...busy]
          .map(t => ({ id: t.id, here: t.room_id === room.id, bound: t.updated_at }));
        const selected = exitTaskPick(named?.id ?? 0, items);
        if (selected) tasks.pauseTask(selected);
      }
    }
  }

  /** A DSH member's one-row reply may carry its mark on a later line; a bridge bot's only on the first. */
  markOpts(msg) {
    return { lastLine: this.hub.members?.get(msg.author)?.kind === 'dsh', team: this.hub.routable?.() ?? [] };
  }

  /** The workspace room msg was posted in (with a chat channel above it), or undefined. */
  workspaceOf(msg) {
    if (!this.enabled) return undefined;
    const room = this.db.prepare('SELECT * FROM rooms WHERE id = ?').get(msg.room_id);
    return room?.parent_id && room.parent_id !== room.id ? room : undefined;
  }

  /**
   * Copy a workspace reply into its chat channel (once per source row: a repeated client key
   * returns the copy already posted). ask: its team_exit_asks record; otherwise a 阶段结果.
   */
  forward(room, msg, body, ask, headline) {
    let text = `📬 来自 ${room.name} · ${msg.name}${ask ? ` · ${ask.id}` : ' · 阶段结果'}\n${body}`;
    let detail = '';
    if (headline) {
      // The three parts for the user, named by its task; DSH has no threads, so the details are a
      // second post marked as such (Go: postWithDetail).
      const name = headline.task?.title ?? '';
      detail = exitSplit(body).detail;
      text = `📬「${name}」${ask ? `要你定\n${headline.line}\n（直接回复这条就能答复，编号 ${ask.id}）` : `\n${headline.line}`}`;
      if (detail) detail = `📬 细节「${name}」（来自 ${room.name} · ${msg.name}，想看再展开，不用回）\n${detail}`;
    }
    const { message } = this.hub.post(room.parent_id, {
      authorKind: 'system', author: 'system', name: 'system', clientKey: `team-exit:${msg.id}`, text,
    });
    if (detail) {
      this.hub.post(room.parent_id, {
        authorKind: 'system', author: 'system', name: 'system', clientKey: `team-exit-detail:${msg.id}`, text: detail,
      });
    }
    return message;
  }

  /**
   * The delivery msg of a workspace task, copied into the chat channel (Tasks.handBack): its
   * [report] body, already forwarded by onMessage, or else the reply without its stance line, so
   * the chat channel always gets the result and not only the 交回 record. undefined outside a
   * workspace and for an [ask] (a question, not a result).
   */
  forwardResult(msg) {
    const room = this.workspaceOf(msg);
    if (!room || msg.author_kind !== 'role' || msg.card != null) return undefined;
    const mark = exitMark(msg.text, this.markOpts(msg));
    if (mark?.kind === 'ask') return undefined;
    const lines = String(msg.text).trim().split('\n');
    if (/^\s*(?:@\S+\s+)*【(接|问|退|升)】/.test(lines[0])) lines.shift();
    const body = mark?.body ?? (lines.join('\n').trim() || String(msg.text).trim());
    const headline = mark ? exitHeadline(mark.body) : undefined;
    if (headline && !headline.problems.length) headline.task = this.hub.tasks?.task?.(headline.id);
    return this.forward(room, msg, body, undefined, headline?.task ? headline : undefined);
  }
}
