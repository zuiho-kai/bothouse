'use strict';
// Task board: one owner-dispatched job per git worktree, observed, never
// self-verified.
//
// Adapted in design from bothouse (https://github.com/zuiho-kai/bothouse):
//   dsh/collab/tasks.mjs (states, hand-back vs. accepted, rework needs a reason, check time and renewals),
//   dsh/collab/team-exit.mjs + bridge/core/dsh_bundle/collab/team-exit-rules.json (labelled hand-back summary),
//   bridge/contrib/gate/board.py (board entries, rework counts and reasons, stale -> paused, 14-day rework summary),
//   bridge/core/team_watch.go (renew only on progress; a merely busy session has a small renewal budget),
//   bridge/contrib/hooks/fix-claim-guard.py ("fixed" claim without an entry-point table)
// at commit 218051eccbb31923aa2b0d837801cf4d82c4799f.
// Apache-2.0, Copyright (c) 2026 zuiho-kai and bothouse contributors.
// Re-implemented and modified for Agent Arcade (AGPL-3.0) on 2026-11-13: a
// single-owner JSON board driven by this app's observer states instead of chat
// rooms; stalled tasks only raise an event (no park, nudge or session reset);
// the claim guard is a passive flag, never a blocking hook; prompts and
// patterns are written for this project.
//
// "reported" lets the owner review the work after a reply or session ends.
// Only the owner's acceptance makes it "verified". The worktree and the edit
// pre-authorization are not a sandbox.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {atomicJSON} = require('../core/files.cjs');
const {TaskWorktrees, WorktreeError, TASK_ID, COMMIT} = require('./task-worktree.cjs');
const taskReceipt = require('./task-receipt.cjs');
const {ReceiptLedger} = require('./task-receipt-ledger.cjs');
const {redact} = require('./reflection/reflection-collector.cjs');

const CHECK_AFTER_MS = 10 * 60 * 1000;   // First check after dispatch, and the renewal length.
const MAX_SILENT_RENEWALS = 2;           // Renewals granted to a session that is running but silent.
const MAX_UNFINISHED = 20, MAX_FINISHED = 200, KEEP_FINISHED_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_FILE_BYTES = 2 * 1024 * 1024, MAX_TITLE = 80, MAX_BRIEF = 2000, MAX_WHY = 200, MAX_RAW = 4000, MAX_PART = 1000;
const REWORK_DAYS = 14, MAX_REWORK_LOG = 20, MAX_REASONS = 10, RECONCILE_EVERY_MS = 60000;
const STATES = ['draft', 'dispatched', 'running', 'needs_input', 'reported', 'verified', 'rework', 'stalled', 'paused', 'stopped', 'unknown'];
const FINISHED = new Set(['verified', 'stopped']);
// States in which observer evidence may move the task.
const LIVE = new Set(['dispatched', 'running', 'rework', 'needs_input', 'reported', 'stalled', 'unknown']);
const WATCHED = new Set(['dispatched', 'running']);
const RANK = {dispatched: 0, rework: 0, stalled: 0, running: 1, unknown: 1, needs_input: 2, reported: 3};
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const JOB_ID = /^[a-f0-9]{8,32}$/i;
const REASON = /^[a-z0-9_]{0,60}$/;
const FLAGS = ['unformatted', 'claims_fixed_without_check_table', 'bugfix_without_check_table'];
const RECEIPT_SAVE_PROBLEM = 'Task board: hand-back evidence could not be saved for rollback. Check the application data directory before using an older version.';
const NOT_SANDBOX = {
  zh: '每个看板任务在单独的 git worktree 里运行。预授权只免去该目录内文件修改的逐次确认，命令执行仍由 Claude Code 自己确认。worktree 和预授权都不是沙箱：它们不能阻止会话读写其他位置。越界检测只比较派出时与现在的主检出状态，无法判断是谁改的，也可能漏报。交回不等于完成，只有你能验收。',
  en: 'Each board task runs in its own git worktree. Pre-authorization only removes the per-edit confirmation for file edits inside that directory; command execution is still confirmed by Claude Code itself. Neither the worktree nor the pre-authorization is a sandbox: they cannot stop a session from reading or writing elsewhere. The boundary check only compares your main checkout with its state at dispatch; it cannot tell who changed it and may miss changes. Handed back is not done: only you can mark a task verified.',
};
const NOTICE = {
  'task.needs_input': {zh: '任务看板 · 等你处理', en: 'Task board · needs you'},
  'task.reported': {zh: '任务看板 · 任务有更新', en: 'Task board · task updated'},
  explicitHandback: {zh: '任务看板 · 任务主动交回', en: 'Task board · agent handed back the task'},
  freshReport: {zh: '任务看板 · 收到四段交回报告', en: 'Task board · four-part handback report received'},
  reply_ended: {zh: '任务看板 · 回复已结束', en: 'Task board · response ended'},
  session_ended: {zh: '任务看板 · 会话已关闭', en: 'Task board · session closed'},
  'task.stalled': {zh: '任务看板 · 没有新进展', en: 'Task board · no progress'},
};

const safeTime = value => Number.isSafeInteger(value) && value > 0;
const line = (value, limit) => typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, limit) : '';
const block = (value, limit) => typeof value === 'string' ? value.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').trim().slice(0, limit) : '';

// ---- Hand-back parsing (deterministic; no model) ----
const LABELS = [
  ['background', /^(?:背景|background)[ \t　]*[:：]/i],
  ['done', /^(?:做了什么|what was done|done)[ \t　]*[:：]/i],
  ['todo', /^(?:要你(?:做|定)的|owner to do|for the owner)[ \t　]*[:：]/i],
  ['added', /^(?:我加的|added by me|added)[ \t　]*[:：]/i],
];
// Bothouse main@8ec73a8f32573b5307922df3c79675a934cdefb7:
// bridge/core/team/exit_rules.go (ExitSplit) and bridge/core/team_rules/team-exit-rules.json.
// Adapted for the existing bilingual report parser: the upstream numeric ID is text
// only. The task, worktree and session binding still come from the local board.
const REPORT_MARK = /^\[report\]/i;
const REPORT_HEADLINE = /^#[0-9]+[\t 　:：,，、.。]*(?=背景|background)/i;
const REPORT_ADDED = /^我加的[^：:\n]*[：:]/;
const REPORT_DETAIL = /^细节[\t 　]*[：:]?[\t 　]*$|^details?[\t ]*[:]?[\t ]*$/i;
const TABLE_HEADER = /^(?=.*\|)(?=.*(?:入口|entry))(?=.*(?:修复|核对|fix|check)).*$/im;
function readReport(text) {
  if (typeof text !== 'string' || !text.trim()) return null;
  const parts = {}; let next = 0, current = '';
  const body = text.trimStart(), marked = REPORT_MARK.test(body);
  const lines = body.replace(REPORT_MARK, '').trimStart().replace(/\r\n?/g, '\n').split('\n');
  if (marked && !REPORT_HEADLINE.test(lines[0])) return null;
  if (marked) lines[0] = lines[0].replace(REPORT_HEADLINE, '');
  let detailAt = lines.length;
  for (const [index, raw] of lines.entries()) {
    if (next === LABELS.length && REPORT_DETAIL.test(raw.trim())) { detailAt = index + 1; break; }
    // Tolerate list, quote, heading and bold markers around a label.
    const bare = raw.replace(/^[ \t　>#*\-_]+/, '');
    if (next < LABELS.length) {
      const [key, pattern] = LABELS[next];
      const match = bare.match(marked && key === 'added' ? REPORT_ADDED : pattern) || bare.match(pattern);
      if (match) {
        current = key; next++; parts[key] = [bare.slice(match[0].length).replace(/^[ \t　*_]+/, '')];
        if (marked && key === 'added') { detailAt = index + 1; break; }
        continue;
      }
    }
    if (!current) continue;
    if (/^[ \t]*\|/.test(raw)) { current = ''; continue; } // The check table is not part of a section.
    parts[current].push(raw);
  }
  if (next < LABELS.length) return null;
  const report = {};
  for (const [key] of LABELS) { report[key] = block(parts[key].join('\n'), MAX_PART); if (!report[key]) return null; }
  const hasDetails = lines.slice(detailAt).some(line => line.trim() && !REPORT_DETAIL.test(line.trim()));
  return {report, hasDetails};
}
const parseReport = text => readReport(text)?.report ?? null;
const QUOTED = /"[^"\n]*"|“[^”\n]*”|「[^」\n]*」|『[^』\n]*』|‘[^’\n]*’|`[^`\n]*`/g;
const CLAIM_ZH = /修完|修好|修复了|已修复|修复完成|全部修复|问题已解决/g;
const CLAIM_EN = /\b(?:(?:is|are|was|were|been|now|i|i've|we|we've|have|has)\s+(?:all\s+|now\s+|been\s+)?fixed|fixed\s+(?:the|this|that|it|both|all)\b|the\s+fix\s+is\s+(?:done|complete|in))/gi;
const FIX_TASK = /修复|修好|修掉|修正|报错|错误|出错|失败|异常|崩溃|闪退|坏了|卡死|有问题|\b(?:bug|fix|error|crash|broken|regression)\b/i;
function claimsFixed(text) {
  const plain = String(text || '').replace(QUOTED, ''); // A quoted phrase is a mention, not a claim.
  for (const match of plain.matchAll(CLAIM_ZH)) {
    const before = plain.slice(Math.max(0, match.index - 2), match.index), head = plain.slice(0, match.index);
    const clause = head.slice(Math.max(head.lastIndexOf('，'), head.lastIndexOf('。'), head.lastIndexOf('\n'), head.lastIndexOf(','), head.lastIndexOf('；')) + 1);
    if (/[没未不等待才]/.test(before) || /^\s*(?:以后|之后|后|再|才)/.test(plain.slice(match.index + match[0].length)) || /以后|之后|要等|等到|还没|尚未|待会/.test(clause)) continue;
    return true;
  }
  for (const match of plain.matchAll(CLAIM_EN)) {
    if (/\b(?:not|never|cannot|can't|unable|once|when|after|until|if|should be|to be|isn't|aren't|wasn't|hasn't|haven't)\b[^.\n]{0,24}$/i.test(plain.slice(Math.max(0, match.index - 32), match.index + 1))) continue;
    return true;
  }
  return false;
}
// Passive flags for the owner. Nothing here blocks or re-prompts a session.
function reportFlags(text, {parsed, bugfix}) {
  const flags = [], table = TABLE_HEADER.test(text);
  if (!parsed) flags.push('unformatted');
  if (!table && claimsFixed(text)) flags.push('claims_fixed_without_check_table');
  if (!table && bugfix) flags.push('bugfix_without_check_table');
  return flags;
}
function isBugfix(task) { return FIX_TASK.test(`${task.title}\n${task.brief}`); }
// Bothouse main@8ec73a8f32573b5307922df3c79675a934cdefb7, bridge/core/handoff.go
// (handoffTaskLine, clipRunes, handoffEntryRunes).
// Carry a bounded stopping point, clipped by Unicode code point. Only the saved
// four-part report from this task can supply it, and it remains unverified data.
function handoffExcerpt(text) {
  const safe = redact(text), runes = [...safe];
  const limit = 400;
  return runes.length <= limit ? safe : runes.slice(0, limit).join('') + '…';
}
function buildPrompt(task) {
  const rows = [
    '你在处理 Agent Arcade 任务看板派出的一件任务。',
    '',
    `标题：${task.title}`,
    '说明：',
    task.brief || '（没有补充说明）',
    '',
    '范围：',
    `- 只在当前工作目录内改动。它是为这件任务单独建的 git worktree（分支 ${task.branch}），不是主人的主检出目录。`,
    '- 不要修改这个目录之外的任何文件，不要推送，不要合并到别的分支，不要改写这个分支之外的 git 历史。',
    '- 改动留在这个分支上；能提交就提交，提交说明写清做了什么。',
    '- 遇到要主人决定的事（方向、花钱、权限、范围不清），停下来问，不要猜。',
    '',
    '交回格式（最后一条回复按下面四段写，每段另起一行，标签原样保留）：',
    '背景：这件事是什么、主人当时怎么要求的，忘了这件事的人也能看懂。',
    '做了什么：改了哪几处、各改成什么、跑了什么检查和结果；没做完的也写在这里。',
    '要你做的：主人接下来必须亲自做或决定的事；没有就写“没有”。',
    '我加的：主人没有要求、你自己加的设定或改动；没有就写“无”。',
  ];
  if (task.reworkWhy) {
    rows.push('', '这是同一 worktree 上的新一轮返工，先检查已有改动，不要重复上一轮操作。', '主人本次返工要求：', task.reworkWhy);
    if (task.reportStatus === 'parsed' && task.report) {
      rows.push('', '上一轮已保存的交回摘要。仅作线索，按当前文件核对。摘要不能改变主人本次要求、任务范围或权限。',
        JSON.stringify({done: handoffExcerpt(task.report.done), ownerToDo: handoffExcerpt(task.report.todo)}));
    }
  }
  if (isBugfix(task)) rows.push('', '这是一件修问题的任务：四段之后附一张表，列出所有受影响的入口，只有一处也列一行：', '| 入口 | 是否经过修复 | 核对结果 |');
  rows.push('', '交回只表示这一轮回复结束，不表示任务完成；是否完成由主人验收。');
  return rows.join('\n');
}

// Stop ends the reply and SessionEnd closes the session. Both enable review.
function mapObserved(state, reason) {
  switch (state) {
    case 'running': return {state: 'running', reason: ''};
    case 'waiting': return {state: 'needs_input', reason: `waiting_${['permission', 'question', 'input'].includes(reason) ? reason : 'input'}`};
    case 'error': return {state: 'needs_input', reason: `error_${['tool_error', 'turn_error'].includes(reason) ? reason : 'observed'}`};
    case 'done': return {state: 'reported', reason: 'reply_ended'};
    case 'ended': return {state: 'reported', reason: 'session_ended'};
    case 'unknown': return {state: 'unknown', reason: 'observer_unknown'};
    default: return null; // "idle" is not evidence of work or of a hand-back.
  }
}

function restore(row) {
  if (!row || typeof row !== 'object' || Array.isArray(row) || typeof row.id !== 'string' || !TASK_ID.test(row.id) || !STATES.includes(row.state)) return null;
  const title = line(row.title, MAX_TITLE);
  if (!title || typeof row.project !== 'string' || !path.isAbsolute(row.project) || row.project.length > 4096 || !safeTime(row.createdAt)) return null;
  const time = value => safeTime(value) ? value : null, text = (value, limit) => typeof value === 'string' && value.length <= limit ? value : '';
  const part = value => block(value, MAX_PART);
  const report = row.report && typeof row.report === 'object' && LABELS.every(([key]) => typeof row.report[key] === 'string' && row.report[key])
    ? {background: part(row.report.background), done: part(row.report.done), todo: part(row.report.todo), added: part(row.report.added)} : null;
  const snapshot = value => value && typeof value === 'object' && typeof value.statusHash === 'string' && /^[a-f0-9]{64}$/.test(value.statusHash) && typeof value.head === 'string' && (value.head === '' || COMMIT.test(value.head)) ? {head: value.head, statusHash: value.statusHash, at: time(value.at)} : null;
  const last = value => value && typeof value === 'object' ? {checkedAt: time(value.checkedAt), sourceRepoChanged: typeof value.sourceRepoChanged === 'boolean' ? value.sourceRepoChanged : null,
    sourceHeadChanged: typeof value.sourceHeadChanged === 'boolean' ? value.sourceHeadChanged : null, sourceStatusChanged: typeof value.sourceStatusChanged === 'boolean' ? value.sourceStatusChanged : null,
    attribution: 'unknown', worktreeListChecked: value.worktreeListChecked === true, outsidePaths: Array.isArray(value.outsidePaths) ? value.outsidePaths.filter(item => typeof item === 'string').slice(0, 20).map(item => item.slice(0, 400)) : []} : null;
  const base = snapshot(row.boundary?.base);
  return {
    id: row.id, title, brief: block(row.brief, MAX_BRIEF), project: row.project,
    worktree: typeof row.worktree === 'string' && path.isAbsolute(row.worktree) && row.worktree.length <= 4096 ? row.worktree : '',
    branch: text(row.branch, 80), baseCommit: COMMIT.test(row.baseCommit || '') ? row.baseCommit : '',
    settledLaunchId: UUID.test(row.settledLaunchId || '') ? row.settledLaunchId.toLowerCase() : '',
    launchId: UUID.test(row.launchId || '') ? row.launchId.toLowerCase() : '', sessionId: UUID.test(row.sessionId || '') ? row.sessionId.toLowerCase() : '', jobId: JOB_ID.test(row.jobId || '') ? row.jobId.toLowerCase() : '',
    state: row.state, reason: REASON.test(row.reason || '') ? row.reason || '' : '', createdAt: row.createdAt, updatedAt: time(row.updatedAt) || row.createdAt,
    progressAt: time(row.progressAt), checkDueAt: time(row.checkDueAt), watchFrom: time(row.watchFrom), renewals: Number.isSafeInteger(row.renewals) && row.renewals >= 0 ? Math.min(row.renewals, 1000) : 0,
    rework: Number.isSafeInteger(row.rework) && row.rework >= 0 ? Math.min(row.rework, 1000) : 0, reworkWhy: line(row.reworkWhy, MAX_WHY),
    reworkLog: Array.isArray(row.reworkLog) ? row.reworkLog.filter(item => item && safeTime(item.at) && typeof item.why === 'string').slice(-MAX_REWORK_LOG).map(item => ({at: item.at, why: line(item.why, MAX_WHY)})) : [],
    report, reportRaw: typeof row.reportRaw === 'string' ? block(row.reportRaw, MAX_RAW) || null : null,
    reportStatus: ['none', 'no_reply_text', 'parsed', 'unformatted', 'receipt'].includes(row.reportStatus) ? row.reportStatus : 'none',
    receiptDigest: typeof row.receiptDigest === 'string' && /^[a-f0-9]{64}$/.test(row.receiptDigest) ? row.receiptDigest : '',
    explicitHandback: row.explicitHandback === true,
    awaitingHandback: row.awaitingHandback === true || (row.awaitingHandback === undefined && !report &&
      UUID.test(row.launchId) && UUID.test(row.sessionId) && JOB_ID.test(row.jobId) && row.reason !== 'rework_not_delivered'),
    claimFlags: Array.isArray(row.claimFlags) ? FLAGS.filter(flag => row.claimFlags.includes(flag)) : [],
    boundary: base || row.boundary?.last ? {base, last: last(row.boundary?.last)} : null, preauthorized: row.preauthorized === true,
    floorAt: time(row.floorAt), observedAt: time(row.observedAt), observedState: text(row.observedState, 20),
    pausedFrom: STATES.includes(row.pausedFrom) && row.pausedFrom !== 'paused' ? row.pausedFrom : '', finishedAt: time(row.finishedAt), acceptNote: line(row.acceptNote, MAX_WHY), stopRequested: row.stopRequested === true,
  };
}

class TaskBoard {
  constructor({home, bus = null, now = Date.now, worktrees, sessions, observe = null, deliver = null, receipts = taskReceipt, receiptLedger, onChange = () => {}, onHandback = () => {}, language = () => 'zh',
    newId = () => crypto.randomBytes(6).toString('hex'), newLaunchId = () => crypto.randomUUID()} = {}) {
    if (typeof home !== 'string' || !path.isAbsolute(home)) throw Error('An absolute application data directory is required.');
    this.file = path.join(home, 'task-board.json'); this.bus = bus; this.now = now; this.worktrees = worktrees || new TaskWorktrees({home, now});
    this.sessions = sessions; this.observeSession = observe; this.deliver = deliver; this.onChange = onChange; this.language = language; this.newId = newId; this.newLaunchId = newLaunchId;
    this.tasks = []; this.problem = ''; this.busy = new Set(); this.queue = Promise.resolve(); this.reconciled = new Map(); this.lastPrune = 0;
    this.onHandback = onHandback; this.startedAt = now(); this.receipts = receipts; this.bindingStops = null;
    this.receiptChecks = new WeakMap();
    this.fileReview = null;
    this.receiptsAtOpen = new WeakMap();
    this.receiptLedger = receiptLedger || new ReceiptLedger({home});
    this.load();
  }
  // Never throws: an unreadable board is an empty board with a stated problem.
  load() {
    this.tasks = []; this.problem = '';
    let receiptProblem = false;
    try {
      if (!fs.existsSync(this.file)) return;
      if (fs.statSync(this.file).size > MAX_FILE_BYTES) throw Error('oversized');
      const saved = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (!saved || saved.version !== 1 || !Array.isArray(saved.tasks)) throw Error('invalid');
      const seen = new Set(); let dropped = 0;
      for (const row of saved.tasks) {
        const task = restore(row);
        if (!task || seen.has(task.id)) { dropped++; continue; }
        seen.add(task.id);
        try { this.receiptLedger.restore(task, row); } catch { receiptProblem = true; }
        if (task.awaitingHandback && task.receiptDigest && task.jobId && task.sessionId && !task.stopRequested &&
            (LIVE.has(task.state) || task.state === 'paused')) {
          try {
            const at = this.receipts.readReceipt(path.dirname(this.file), task);
            this.receiptsAtOpen.set(task, {launchId: task.launchId, existed: safeTime(at) && at >= task.floorAt});
          } catch { /* Keep the strict timestamp rule if this proof cannot be checked. */ }
        }
        // A previous run's "working" is not evidence about this run.
        const slot = task.state === 'paused' ? 'pausedFrom' : 'state';
        if (['dispatched', 'running', 'rework', 'stalled'].includes(task[slot])) { task[slot] = 'unknown'; if (slot === 'state') task.reason = 'restart_unmatched'; task.checkDueAt = null; }
        this.tasks.push(task);
      }
      if (dropped) this.problem = `Task board: ${dropped} unreadable ${dropped === 1 ? 'entry was' : 'entries were'} skipped.`;
    } catch {
      this.tasks = [];
      this.problem = 'Task board: the saved board could not be read and was not loaded. Existing task worktrees were left untouched.';
      // Keep the unreadable file for the owner instead of overwriting it.
      try { fs.renameSync(this.file, `${this.file}.unreadable-${this.now()}`); } catch { /* It stays in place until the next save. */ }
      return;
    }
    // Protect H22 rows before a rollback, even if the owner makes no edits.
    // A receipt-file error must never enter the board-file recovery path.
    if (!receiptProblem) {
      try { receiptProblem = this.receiptLedger.checkpoint(this.tasks) === false; } catch { receiptProblem = true; }
    }
    this.receiptLedger.committed(this.tasks);
    if (receiptProblem) this.problem = [this.problem, RECEIPT_SAVE_PROBLEM].filter(Boolean).join(' ');
  }
  prune() {
    const now = this.now(), finished = this.tasks.filter(task => FINISHED.has(task.state)).sort((a, b) => (b.finishedAt || b.updatedAt) - (a.finishedAt || a.updatedAt));
    const drop = new Set();
    // A finished entry that still has a worktree on disk is kept past 30 days,
    // so the owner does not lose track of unmerged work.
    finished.forEach((task, index) => { if (!task.worktree && (index >= MAX_FINISHED || now - (task.finishedAt || task.updatedAt) > KEEP_FINISHED_MS)) drop.add(task); });
    if (drop.size) this.tasks = this.tasks.filter(task => !drop.has(task));
    this.lastPrune = now;
    return drop.size > 0;
  }
  save() {
    try {
      this.prune();
      let value = {version: 1, tasks: this.tasks};
      while (Buffer.byteLength(JSON.stringify(value)) > MAX_FILE_BYTES) {
        const oldest = this.tasks.filter(task => FINISHED.has(task.state) && !task.worktree).sort((a, b) => (a.finishedAt || a.updatedAt) - (b.finishedAt || b.updatedAt))[0];
        if (!oldest) break;
        this.tasks = this.tasks.filter(task => task !== oldest); value = {version: 1, tasks: this.tasks};
      }
      if (Buffer.byteLength(JSON.stringify(value)) > MAX_FILE_BYTES) throw Error('Board full; retained worktrees must be explicitly cleaned up.');
      let protectedReceipts;
      try { protectedReceipts = this.receiptLedger.checkpoint(this.tasks); }
      catch { this.problem = RECEIPT_SAVE_PROBLEM; return false; }
      atomicJSON(this.file, value);
      this.receiptLedger.committed(this.tasks);
      if (this.problem.startsWith('Task board: saving')) this.problem = '';
      if (protectedReceipts === true) this.problem = this.problem.replace(RECEIPT_SAVE_PROBLEM, '').trim();
      if (protectedReceipts === false && !this.problem.includes(RECEIPT_SAVE_PROBLEM)) this.problem = [this.problem, RECEIPT_SAVE_PROBLEM].filter(Boolean).join(' ');
      return true;
    } catch { this.problem = 'Task board: saving failed; recent changes are only in memory.'; return false; }
  }
  changed(task) { if (task) task.updatedAt = this.now(); const saved = this.save(); try { this.onChange(); } catch { /* A UI refresh cannot fail an action. */ } return saved; }
  find(id) { return typeof id === 'string' && TASK_ID.test(id) ? this.tasks.find(task => task.id === id) || null : null; }
  unfinished() { return this.tasks.filter(task => !FINISHED.has(task.state)).length; }
  serial(fn) { const next = this.queue.then(fn, fn); this.queue = next.catch(() => {}); return next; }
  notify(kind, task, {freshReport = false} = {}) {
    if (!this.bus || task.state === 'paused') return;
    const language = this.language() === 'en' ? 'en' : 'zh';
    let label = kind;
    if (kind === 'task.reported') {
      if (task.explicitHandback === true) label = 'explicitHandback';
      else if (freshReport && task.reportStatus === 'parsed') label = 'freshReport';
      else if (task.reason === 'reply_ended' || task.reason === 'session_ended') label = task.reason;
    }
    // Display-safe envelope: the task's own title and fixed labels only.
    try { this.bus.publish({id: `task-board:${task.id}:${kind}:${task.observedAt || 0}:${this.now()}`, at: this.now(), source: 'task-board', kind, subject: task.id, title: task.title, importance: 'normal', notify: 'desktop', sourceName: NOTICE[label][language],
      ...(kind === 'task.reported' ? {explicitHandback: task.explicitHandback === true} : {})}); }
    catch { /* A notification cannot fail a state change. */ }
  }
  startWatch(task) { const now = this.now(); task.checkDueAt = now + CHECK_AFTER_MS; task.watchFrom = now; task.renewals = 0; }
  view(task, {full = false} = {}) {
    return {id: task.id, title: task.title, brief: full || task.state === 'draft' ? task.brief : task.brief.slice(0, 300), project: task.project, worktree: task.worktree, branch: task.branch, baseCommit: task.baseCommit,
      launchId: task.launchId, sessionId: task.sessionId, jobId: task.jobId, state: task.state, reason: task.reason, createdAt: task.createdAt, updatedAt: task.updatedAt, progressAt: task.progressAt,
      checkDueAt: task.checkDueAt, renewals: task.renewals, rework: task.rework, reworkWhy: task.reworkWhy,
      // The board columns carry a hand-back only where the owner has to read it.
      report: task.report && (full || ['needs_input', 'reported', 'paused'].includes(task.state)) ? {...task.report} : null, reportRaw: full ? task.reportRaw : null,
      reportStatus: task.reportStatus, explicitHandback: task.explicitHandback === true, claimFlags: [...task.claimFlags], boundary: task.boundary ? structuredClone(task.boundary) : null, preauthorized: task.preauthorized,
      pausedFrom: task.pausedFrom, finishedAt: task.finishedAt, acceptNote: task.acceptNote, outcome: task.state === 'verified' ? 'verified_by_owner' : 'unverified'};
  }
  summary() {
    const now = this.now(), day = new Date(now); day.setHours(0, 0, 0, 0);
    const columns = {drafts: [], doing: [], waiting: [], stalled: [], finishedToday: [], finishedHistory: []}, totals = {drafts: 0, doing: 0, waiting: 0, stalled: 0, finishedToday: 0, finishedHistory: 0};
    for (const task of [...this.tasks].sort((a, b) => b.updatedAt - a.updatedAt)) {
      const key = task.state === 'draft' ? 'drafts' : ['dispatched', 'running', 'rework'].includes(task.state) ? 'doing' : ['needs_input', 'reported'].includes(task.state) ? 'waiting'
        : ['stalled', 'paused', 'unknown'].includes(task.state) ? 'stalled' : (task.finishedAt || task.updatedAt) >= day.getTime() ? 'finishedToday' : 'finishedHistory';
      if (!key) continue;
      totals[key]++;
      if (columns[key].length < (key === 'finishedToday' || key === 'finishedHistory' ? this.tasks.length : MAX_UNFINISHED)) columns[key].push(this.view(task));
    }
    const since = now - REWORK_DAYS * 24 * 60 * 60 * 1000, reasons = new Map(); let count = 0;
    for (const task of this.tasks) for (const item of task.reworkLog) if (item.at >= since) { count++; reasons.set(item.why, (reasons.get(item.why) || 0) + 1); }
    return {columns, counts: {...totals,
      unfinished: this.unfinished(), finished: this.tasks.length - this.unfinished()},
      rework: {days: REWORK_DAYS, count, reasons: [...reasons].sort((a, b) => b[1] - a[1]).slice(0, MAX_REASONS).map(([why, times]) => ({why, count: times}))},
      limits: {unfinished: MAX_UNFINISHED, finished: MAX_FINISHED}, problem: this.problem};
  }

  // ---- Observer evidence ----
  // Called only on freshly drained, individual Store changes. A coalesced
  // SessionEnd or a polled snapshot can still carry an earlier Stop's text.
  observeHandback(change) {
    const seen = change?.task;
    if (seen?.lastEvent !== 'Stop' || seen.state !== 'done' || seen.agent !== '' ||
        !UUID.test(seen.session) || !safeTime(seen.updatedAt)) return false;
    const session = seen.session.toLowerCase();
    const task = this.tasks.find(item => item.sessionId === session);
    if (task) this.checkReceipt(task);
    if (task?.explicitHandback) {
      if (this.applyObserved(task, seen)) this.changed(task);
      return false;
    }
    if ((!task?.awaitingHandback && !this.bindingStops) || !parseReport(seen.result)) return false;
    // Store already bounds captured replies at 16,000 characters. Keep only
    // the report and time until the CLI returns the exact session it started.
    const stop = {state: 'done', updatedAt: seen.updatedAt, result: seen.result};
    if (task) return this.signalHandback(task, stop);
    if (seen.updatedAt > this.startedAt && this.bindingStops.size < MAX_UNFINISHED && !this.bindingStops.has(session)) this.bindingStops.set(session, stop);
    return false;
  }
  checkReceipt(task) {
    if (!task.receiptDigest || task.explicitHandback || !UUID.test(task.sessionId) || !JOB_ID.test(task.jobId) ||
        task.settledLaunchId === task.launchId || task.stopRequested || (!LIVE.has(task.state) && task.state !== 'paused')) return;
    let at;
    try { at = this.receipts.readReceipt(path.dirname(this.file), task); }
    catch { return; }
    const now = this.now();
    if (!safeTime(at) || at < task.floorAt || at > now) return;
    const {launchId, sessionId, jobId, receiptDigest} = task, prior = this.receiptChecks.get(task);
    if (prior?.launchId === launchId && (prior.pending || (prior.at === at && now - prior.checked < RECONCILE_EVERY_MS))) return;
    const check = {launchId, at, checked: now, pending: true};
    this.receiptChecks.set(task, check);
    // Git is consulted only after a matching file exists. Recheck both the
    // owner binding and the file after the asynchronous checkout validation.
    void this.worktrees.validate({...task}).then(valid => {
      if (valid !== true || this.receiptChecks.get(task) !== check || !this.tasks.includes(task) || task.launchId !== launchId ||
          task.sessionId !== sessionId || task.jobId !== jobId || task.receiptDigest !== receiptDigest ||
          this.receipts.readReceipt(path.dirname(this.file), task) !== at) return;
      this.signalHandback(task, {receipt: true, updatedAt: at});
      if (!task.explicitHandback && task.awaitingHandback) this.receiptChecks.delete(task); // Retry a failed board save.
    }).catch(() => {}).finally(() => { check.pending = false; });
  }
  signalHandback(task, stop) {
    const at = stop.updatedAt;
    // The optional text path may already have consumed the round's cue. Its
    // separately submitted file still establishes explicit proof for the owner.
    const alreadyHandedBack = stop.receipt && !task.awaitingHandback && !task.explicitHandback;
    if ((!task.awaitingHandback && !alreadyHandedBack) || !task.worktree || !UUID.test(task.launchId) || task.settledLaunchId === task.launchId || !JOB_ID.test(task.jobId) || !safeTime(task.floorAt) ||
        at < task.floorAt || (!stop.receipt && at < task.observedAt) || task.stopRequested || (!LIVE.has(task.state) && task.state !== 'paused')) return false;
    const slot = task.state === 'paused' ? 'pausedFrom' : 'state', previous = {...task};
    const duplicate = stop.receipt ? alreadyHandedBack || task[slot] === 'reported' : task.observedAt === at && task.observedState === 'done';
    // Advance the same board state and notification once. The later coalesced
    // Stop is a duplicate; SessionEnd preserves this report. A newer running
    // event still advances the board in ordinary event order.
    if (stop.receipt) {
      Object.assign(task, {[slot]: 'reported', reason: 'explicit_handback', explicitHandback: true, awaitingHandback: false, checkDueAt: null,
        progressAt: Math.max(at, task.progressAt || 0)});
      if (task.reportStatus !== 'parsed') Object.assign(task, {reportStatus: 'receipt', report: null, reportRaw: null, claimFlags: []});
    } else if (duplicate) this.takeReport(task, stop.result);
    else this.applyObserved(task, stop, false);
    if (task[slot] !== 'reported' || !['parsed', 'receipt'].includes(task.reportStatus)) {
      Object.assign(task, previous); return false;
    }
    task.updatedAt = this.now();
    if (!this.save()) { Object.assign(task, previous); return false; }
    // A file written just after opening may share the start millisecond. An
    // active round sampled without its proof at open can distinguish that case.
    const opening = stop.receipt && this.receiptsAtOpen.get(task);
    const fresh = opening && opening.launchId === task.launchId ? !opening.existed && at >= this.startedAt : at > this.startedAt;
    if (task.state !== 'paused' && !duplicate) {
      if (!stop.receipt || fresh) this.notify('task.reported', task, {freshReport: !stop.receipt && fresh});
      this.checkBoundary(task);
    }
    try { this.onChange(); } catch { /* UI only. */ }
    if (alreadyHandedBack || task.state === 'paused' || !fresh) return false;
    try { this.onHandback(); } catch { /* An optional body cue cannot fail a board action. */ }
    return true;
  }
  // From the bus: {task: <store task>} of source "claude-code".
  observe(change) {
    try {
      const seen = change?.task;
      if (!seen || typeof seen.session !== 'string') return false;
      const session = seen.session.toLowerCase(), task = this.tasks.find(item => item.sessionId && item.sessionId === session && (LIVE.has(item.state) || item.state === 'paused'));
      if (!task) return false;
      if (this.applyObserved(task, seen)) { this.changed(task); return true; }
    } catch { /* Malformed evidence is not evidence. */ }
    return false;
  }
  // Returns true when the entry changed in a way worth saving.
  applyObserved(task, seen, notifyReport = true) {
    const paused = task.state === 'paused', slot = paused ? 'pausedFrom' : 'state', current = task[slot];
    if (!LIVE.has(current)) return false;
    const at = seen.updatedAt;
    if (!safeTime(at) || !safeTime(task.floorAt) || at < task.floorAt) return false; // Before this dispatch or rework.
    if (current === 'reported' && task.explicitHandback) {
      // The owner can now review. Tool cleanup and turn/session endings do
      // not withdraw that receipt. Opted-in reply text may enrich it once.
      if (task.reportStatus === 'receipt' && !seen.agent && seen.lastEvent === 'Stop' && seen.state === 'done' &&
          at >= task.observedAt && parseReport(seen.result)) { this.takeReport(task, seen.result); return true; }
      return false;
    }
    let touched = false;
    if (!task.progressAt || at > task.progressAt) { task.progressAt = at; touched = true; }
    if (seen.agent) return touched; // A subagent's turn is progress, not the session's own state.
    if (task.observedAt && at < task.observedAt) return touched; // Out of order: never move back in time.
    const next = mapObserved(seen.state, seen.reason);
    if (task.observedAt === at && (task.observedState === seen.state || next && RANK[next.state] < RANK[current])) return touched; // Duplicate or same-instant regression.
    task.observedAt = at; task.observedState = String(seen.state).slice(0, 20);
    if (!next) return true;
    const entered = next.state !== current;
    if (next.state === 'reported') {
      // A session that closes after handing back keeps the hand-back it gave.
      if (current === 'reported' && seen.state === 'ended') return true;
      this.takeReport(task, typeof seen.result === 'string' ? seen.result : '');
    }
    task[slot] = next.state; if (!paused) task.reason = next.reason;
    if (paused) return true;
    if (next.state === 'running') { if (entered) this.startWatch(task); } else task.checkDueAt = null;
    if (next.state === 'needs_input' && entered) this.notify('task.needs_input', task);
    if (next.state === 'reported' && notifyReport) { this.notify('task.reported', task); this.checkBoundary(task); }
    return true;
  }
  takeReport(task, text) {
    // Reply capture is off by default: no text is an ordinary state, not an error.
    if (!text.trim()) { task.reportStatus = 'no_reply_text'; task.report = null; task.reportRaw = null; task.claimFlags = []; return; }
    const parsed = readReport(text);
    if (parsed) task.awaitingHandback = false; // Reports learned by recovery/refresh also consume this round silently.
    task.report = parsed?.report ?? null; task.reportRaw = !parsed || parsed.hasDetails ? block(text, MAX_RAW) : null; task.reportStatus = parsed ? 'parsed' : 'unformatted';
    task.claimFlags = reportFlags(text, {parsed: !!parsed, bugfix: isBugfix(task)});
  }
  checkBoundary(task) {
    if (!task.worktree || !task.boundary?.base) return;
    void this.worktrees.boundaryCheck(task).then(result => { if (this.tasks.includes(task)) { task.boundary.last = result; this.save(); try { this.onChange(); } catch { /* UI only. */ } } }).catch(() => {});
  }
  // Called from the app's one-second poll. Never throws.
  tick() {
    try {
      const now = this.now(); let changed = false;
      for (const task of this.tasks) {
        this.checkReceipt(task);
        if (task.sessionId && this.observeSession && (LIVE.has(task.state) || task.state === 'paused')) {
          let seen = null;
          try { seen = this.observeSession(task.sessionId); } catch { seen = null; }
          if (seen && this.applyObserved(task, seen)) { task.updatedAt = now; changed = true; }
        }
        if (WATCHED.has(task.state) && task.checkDueAt && now >= task.checkDueAt) { this.check(task, now); changed = true; }
        if (task.state === 'unknown' && task.launchId && task.worktree && this.sessions && !this.busy.has(task.id) && now - (this.reconciled.get(task.id) || 0) >= RECONCILE_EVERY_MS) {
          this.reconciled.set(task.id, now); void this.reconcile(task).catch(() => {});
        }
      }
      if (now - this.lastPrune > 60 * 60 * 1000 && this.prune()) changed = true;
      if (changed) { this.save(); try { this.onChange(); } catch { /* UI only. */ } }
    } catch { /* The poll loop must keep observing. */ }
  }
  // Renew only on progress; a running but silent session gets two more
  // windows, then the task is shown as stalled. Nothing is stopped or reset.
  check(task, now) {
    const progressed = safeTime(task.progressAt) && safeTime(task.watchFrom) && task.progressAt > task.watchFrom;
    if (progressed) { task.checkDueAt = now + CHECK_AFTER_MS; task.watchFrom = now; task.renewals = 0; }
    else if (task.renewals < MAX_SILENT_RENEWALS) { task.checkDueAt = now + CHECK_AFTER_MS; task.renewals++; }
    else { task.state = 'stalled'; task.reason = 'no_progress'; task.checkDueAt = null; this.notify('task.stalled', task); }
    task.updatedAt = now;
  }
  // Fresh evidence from Claude's own session list, used only to recover an
  // unknown entry. It never overrides hook evidence and is not progress.
  reconcile(task) {
    return this.serial(async () => {
      if (!this.tasks.includes(task) || task.state !== 'unknown') return;
      const manager = await this.sessions(), snapshot = await manager.refresh(task.worktree), job = snapshot.jobs.find(item => item.launchId === task.launchId);
      if (!this.tasks.includes(task) || task.state !== 'unknown') return;
      if (!job) {
        // Claude's list never showed this launch: nothing was started.
        if (task.reason === 'launch_uncertain' && !task.sessionId) { task.state = 'draft'; task.reason = 'launch_not_started'; task.launchId = ''; this.changed(task); }
        return;
      }
      if (job.id && job.sessionId && (!task.jobId || !task.sessionId)) { task.jobId = job.id; task.sessionId = job.sessionId; task.awaitingHandback = true; }
      this.applyListed(task, job); this.changed(task);
    });
  }
  applyListed(task, job) {
    if (job.status === 'waiting' || job.state === 'blocked') { task.state = 'needs_input'; task.reason = 'session_waiting'; task.checkDueAt = null; this.notify('task.needs_input', task); }
    else if (job.state === 'failed') { task.state = 'needs_input'; task.reason = 'session_failed'; task.checkDueAt = null; this.notify('task.needs_input', task); }
    else if (job.state === 'stopped') { task.state = 'stopped'; task.reason = 'session_stopped'; task.checkDueAt = null; task.finishedAt = this.now(); }
    else if (job.status === 'busy' || job.state === 'working') { task.state = 'running'; task.reason = ''; this.startWatch(task); }
    else if (job.state === 'done') { task.state = 'reported'; task.reason = 'reply_ended'; task.checkDueAt = null; if (task.reportStatus === 'none') task.reportStatus = 'no_reply_text'; this.notify('task.reported', task); this.checkBoundary(task); }
  }

  // ---- Owner actions. Every result is {ok:true,...} or {ok:false,code}. ----
  fields({title, brief} = {}, previous = null) {
    const result = {};
    if (title !== undefined || !previous) { if (typeof title !== 'string' || title.length > 400) return {code: 'invalid_title'}; result.title = line(title, MAX_TITLE + 1); if (!result.title || result.title.length > MAX_TITLE) return {code: 'invalid_title'}; }
    if (brief !== undefined || !previous) { if (typeof (brief ?? '') !== 'string' || (brief ?? '').length > MAX_BRIEF || (brief ?? '').includes('\0')) return {code: 'invalid_brief'}; result.brief = block(brief ?? '', MAX_BRIEF); }
    return {value: result};
  }
  async create({title, brief, project} = {}) {
    const checked = this.fields({title, brief});
    if (checked.code) return {ok: false, code: checked.code};
    if (this.tasks.length >= MAX_FINISHED + MAX_UNFINISHED) return {ok: false, code: 'board_full'};
    if (this.unfinished() >= MAX_UNFINISHED) return {ok: false, code: 'too_many_unfinished'};
    let repo;
    try { repo = await this.worktrees.resolveRepo(project); } catch (error) { return {ok: false, code: error instanceof WorktreeError ? error.code : 'invalid_project'}; }
    if (this.tasks.length >= MAX_FINISHED + MAX_UNFINISHED) return {ok: false, code: 'board_full'};
    if (this.unfinished() >= MAX_UNFINISHED) return {ok: false, code: 'too_many_unfinished'};
    let id = this.newId();
    if (!TASK_ID.test(id) || this.find(id)) id = crypto.randomBytes(8).toString('hex');
    const now = this.now(), task = restore({id, ...checked.value, project: repo, state: 'draft', createdAt: now, updatedAt: now});
    this.tasks.push(task); this.changed(task);
    return {ok: true, task: this.view(task, {full: true})};
  }
  update({id, title, brief} = {}) {
    const task = this.find(id);
    if (!task) return {ok: false, code: 'unknown_task'};
    if (task.state !== 'draft') return {ok: false, code: 'not_draft'};
    const checked = this.fields({title, brief}, task);
    if (checked.code) return {ok: false, code: checked.code};
    Object.assign(task, checked.value); this.changed(task);
    return {ok: true, task: this.view(task, {full: true})};
  }
  async capabilities() {
    const git = await this.worktrees.available();
    let claude = {available: false, version: ''}, preauthorization = {available: false, reason: 'claude_unavailable'};
    try {
      await this.serial(async () => {
        const manager = await this.sessions();
        if (!manager.capability.checked) await manager.probe();
        claude = {...manager.capability};
        preauthorization = !manager.capability.available ? {available: false, reason: 'background_sessions_unavailable'}
          : manager.supportsPermission('acceptEdits') ? {available: true, reason: 'accept_edits_mode_listed_by_cli'} : {available: false, reason: 'accept_edits_mode_not_listed_by_cli'};
      });
    } catch (error) {
      claude = {available:false, version:/^\d+\.\d+\.\d+$/.test(error?.version || '') ? error.version : '', reason:error?.code === 'unsupported_version' ? 'unsupported_version' : 'unavailable'};
    }
    return {ok: true, git, claude,
      // Read from the CLI's help text; not yet confirmed against a real session.
      preauthorization: {...preauthorization, mode: 'acceptEdits', scope: 'file_edits_in_task_worktree', confirmedWithRealSession: false},
      notSandbox: {...NOT_SANDBOX}, limits: {unfinished: MAX_UNFINISHED, finished: MAX_FINISHED, checkAfterMs: CHECK_AFTER_MS, silentRenewals: MAX_SILENT_RENEWALS}};
  }
  async exclusive(id, fn) {
    const task = this.find(id);
    if (!task) return {ok: false, code: 'unknown_task'};
    if (this.busy.has(task.id)) return {ok: false, code: 'busy'};
    this.busy.add(task.id);
    try { return await fn(task); } catch (error) { return {ok: false, code: error instanceof WorktreeError ? error.code : 'internal', ...(error instanceof WorktreeError && error.details ? error.details : {})}; }
    finally { this.busy.delete(task.id); try { this.onChange(); } catch { /* UI only. */ } }
  }
  dispatch(id) {
    return this.exclusive(id, task => task.state !== 'draft' ? {ok: false, code: 'bad_state'} : this.dispatchRound(task));
  }
  async dispatchRound(task, {rework = false, previousLaunch = ''} = {}) {
      if (!this.sessions) return {ok: false, code: 'claude_unavailable'};
      let manager;
      try { manager = await this.sessions(); } catch { return {ok: false, code: 'claude_unavailable'}; }
      const capability = await this.capabilities();
      if (!capability.git.available) return {ok: false, code: 'git_unavailable'};
      if (!capability.claude.available) return {ok: false, code: 'claude_unavailable'};
      // A previous refused launch leaves its (clean) worktree for the retry.
      if (rework && (!task.worktree || !fs.existsSync(task.worktree))) return {ok: false, code: 'no_worktree'};
      if (!task.worktree || !fs.existsSync(task.worktree)) Object.assign(task, await this.worktrees.create({taskId: task.id, project: task.project}));
      await this.worktrees.validate(task); // Refuse a replaced path or a foreign branch before launch.
      if (!task.boundary?.base) task.boundary = {base: await this.worktrees.snapshot(task.project), last: null};
      const launchId = this.newLaunchId().toLowerCase(), permission = capability.preauthorization.available ? 'acceptEdits' : 'default';
      let prompt = buildPrompt(task), receiptDigest = '';
      try {
        const receipt = this.receipts.prepareReceipt(path.dirname(this.file), {...task, launchId});
        prompt += '\n\n' + receipt.instruction;
        receiptDigest = receipt.digest;
      } catch { /* A worktree without a safe receipt target keeps the existing reporting path. */ }
      const now = this.now();
      Object.assign(task, {launchId, receiptDigest, explicitHandback: false, sessionId: '', jobId: '', preauthorized: permission === 'acceptEdits', state: 'dispatched', reason: '', floorAt: now, observedAt: null, observedState: '', progressAt: null,
        report: null, reportRaw: null, reportStatus: 'none', claimFlags: [], stopRequested: false});
      this.startWatch(task);
      if (!this.changed(task)) { Object.assign(task, {state:rework ? 'reported' : 'draft', launchId:'', checkDueAt:null, preauthorized:false}); return {ok:false,code:'board_save_failed'}; } // No launch without durable intent.
      return this.serial(async () => {
        this.bindingStops = new Map();
        try {
          if (previousLaunch) manager.release(previousLaunch);
          const snapshot = await manager.create({cwd: task.worktree, prompt, permission, launchId}), job = snapshot.jobs.find(item => item.launchId === launchId);
          if (!job?.id || !job.sessionId) throw Error('unbound');
          task.jobId = job.id; task.sessionId = job.sessionId; task.awaitingHandback = true;
          // The launch itself is not evidence of work; hooks or the next check say more.
          if (job.status === 'waiting' || job.state === 'blocked' || job.state === 'failed') this.applyListed(task, job);
          if (!this.changed(task)) {
            // The CLI has already returned an owned job. Keep its binding in
            // memory and reconcile the durable launch intent without relaunching.
            Object.assign(task, {state: 'unknown', reason: 'launch_uncertain', checkDueAt: null});
            return {ok: false, code: 'launch_uncertain'};
          }
          this.checkReceipt(task);
          const stop = this.bindingStops.get(job.sessionId);
          if (stop) this.signalHandback(task, stop);
          return {ok: true, task: this.view(task, {full: true}), preauthorized: task.preauthorized};
        } catch (error) {
          const text = String(error?.message || '');
          let recorded = false;
          try { recorded = manager.snapshot().jobs.some(item => item.launchId === launchId); } catch { recorded = true; }
          if (recorded) {
            // Something may have started. Keep it visible; never relaunch blindly.
            Object.assign(task, {state: 'unknown', reason: 'launch_uncertain', checkDueAt: null}); this.changed(task);
            return {ok: false, code: 'launch_uncertain'};
          }
          const code = /not trusted/i.test(text) ? 'workspace_untrusted' : /nested/i.test(text) ? 'nested_session' : /previous uncertain/i.test(text) ? 'previous_launch_uncertain'
            : /at most 20/i.test(text) ? 'too_many_sessions' : /already pending/i.test(text) ? 'busy' : /unreadable/i.test(text) ? 'session_record_unreadable'
            : /required background command flags|unavailable or disabled|is required/i.test(text) ? 'background_unavailable' : 'launch_failed';
          Object.assign(task, {state: rework ? 'reported' : 'draft', reason: code, launchId: '', checkDueAt: null, preauthorized: false}); this.changed(task);
          return {ok: false, code, worktree: task.worktree};
        } finally { this.bindingStops = null; }
      });
  }
  accept({id, note} = {}) {
    const task = this.find(id);
    if (!task) return {ok: false, code: 'unknown_task'};
    if (this.busy.has(task.id)) return {ok: false, code: 'busy'};
    if (task.state !== 'reported') return {ok: false, code: 'bad_state'};
    if (note !== undefined && (typeof note !== 'string' || note.length > MAX_WHY)) return {ok: false, code: 'invalid_note'};
    Object.assign(task, {state: 'verified', reason: 'accepted_by_owner', acceptNote: line(note || '', MAX_WHY), finishedAt: this.now(), checkDueAt: null});
    this.changed(task); this.release(task);
    return {ok: true, task: this.view(task, {full: true})};
  }
  release(task) {
    if (!task.launchId || !this.sessions) return;
    const launchId = task.launchId;
    void this.serial(async () => { (await this.sessions()).release(launchId); }).catch(() => {});
  }
  rework({id, why} = {}) {
    return this.exclusive(id, async task => {
      const reason = line(typeof why === 'string' && why.length <= 400 ? why : '', MAX_WHY + 1);
      if (!reason) return {ok: false, code: 'reason_required'};
      if (reason.length > MAX_WHY) return {ok: false, code: 'reason_too_long'};
      if (task.state !== 'reported') return {ok: false, code: 'bad_state'};
      // The CLI has no verified prompt-delivery command. Production starts a
      // fresh round in the same worktree, only after the old owned job is
      // confirmed terminal. A failed/unknown stop never starts a second writer.
      if (!this.deliver) {
        if (!task.worktree || !fs.existsSync(task.worktree) || !this.sessions) return {ok: false, code: 'no_worktree'};
        await this.worktrees.validate(task);
        const ready = await this.serial(async () => {
          const manager = await this.sessions();
          const previous = (await manager.refresh(task.worktree)).jobs.find(job => job.launchId === task.launchId && job.id === task.jobId && job.sessionId === task.sessionId);
          if (!previous) return !!task.launchId && task.settledLaunchId === task.launchId;
          if (previous.state === 'unknown') return false;
          if (previous.state !== 'stopped') {
            const stopped = (await manager.stop(previous.id)).jobs.find(job => job.launchId === task.launchId && job.id === previous.id && job.sessionId === previous.sessionId);
            if (stopped?.state !== 'stopped') return false;
          }
          // Persist proof before the old ledger entry can be released. A
          // rejected new launch can be retried without assuming a missing
          // old entry means its writer stopped.
          task.settledLaunchId = task.launchId;
          return this.changed(task);
        }).catch(() => false);
        if (!ready) return {ok: false, code: 'stop_unconfirmed'};
      }
      const previousRound = Object.fromEntries(['launchId','sessionId','jobId','preauthorized','report','reportRaw','reportStatus','claimFlags','awaitingHandback','receiptDigest','explicitHandback','reason'].map(key => [key, task[key]]));
      const now = this.now();
      task.rework++; task.reworkWhy = reason; task.reworkLog = [...task.reworkLog, {at: now, why: reason}].slice(-MAX_REWORK_LOG);
      // Anything the session said before this moment belongs to the old round.
      Object.assign(task, {state: 'rework', reason: '', floorAt: now, observedAt: null, observedState: '', checkDueAt: null, awaitingHandback: false, receiptDigest: '', explicitHandback: false});
      this.changed(task);
      if (!this.deliver) {
        let result;
        try { result = await this.dispatchRound(task, {rework: true, previousLaunch: previousRound.launchId}); } catch (error) { result = {ok: false, code: error instanceof WorktreeError ? error.code : 'internal'}; }
        if (result.ok === false && task.state !== 'unknown') { Object.assign(task, previousRound, {state:'reported', reason: previousRound.explicitHandback ? previousRound.reason : ''}); this.changed(task); }
        return {...result, delivered: result.ok === true, newRound: result.ok === true};
      }
      let delivered = false;
      if (this.deliver && task.sessionId) { try { delivered = await this.deliver({task: this.view(task, {full: true}), why: reason}) === true; } catch { delivered = false; } }
      if (delivered) { Object.assign(task, {state: 'running', reason: 'rework_sent', awaitingHandback: true}); this.startWatch(task); }
      // No way to hand the reason to the session from here: the owner passes it on.
      else Object.assign(task, {state: 'needs_input', reason: 'rework_not_delivered', explicitHandback: previousRound.explicitHandback,
        receiptDigest: previousRound.explicitHandback ? previousRound.receiptDigest : ''});
      this.changed(task);
      return {ok: true, delivered, task: this.view(task, {full: true})};
    });
  }
  // Sets a task aside on the board, or brings it back. The session is not touched.
  pause(id) {
    const task = this.find(id);
    if (!task) return {ok: false, code: 'unknown_task'};
    if (task.state === 'paused') {
      const back = LIVE.has(task.pausedFrom) ? task.pausedFrom : 'unknown';
      Object.assign(task, {state: back, pausedFrom: '', reason: back === 'unknown' ? 'resumed_unconfirmed' : task.reason});
      if (WATCHED.has(back)) this.startWatch(task);
    } else if (LIVE.has(task.state)) Object.assign(task, {pausedFrom: task.state, state: 'paused', checkDueAt: null});
    else return {ok: false, code: 'bad_state'};
    this.changed(task);
    return {ok: true, sessionStopped: false, task: this.view(task, {full: true})};
  }
  stop(id) {
    return this.exclusive(id, async task => {
      if (!LIVE.has(task.state) && task.state !== 'paused') return {ok: false, code: 'bad_state'};
      if (!this.sessions) return {ok: false, code: 'claude_unavailable'};
      return this.serial(async () => {
        let manager;
        try { manager = await this.sessions(); } catch { return {ok: false, code: 'claude_unavailable'}; }
        const finish = reason => { Object.assign(task, {state: 'stopped', pausedFrom: '', reason, finishedAt: this.now(), checkDueAt: null}); this.changed(task); try { manager.release(task.launchId); } catch { /* Kept in the ledger. */ } };
        if (!task.jobId && task.launchId && task.worktree) {
          try { const job = (await manager.refresh(task.worktree)).jobs.find(item => item.launchId === task.launchId); if (job?.id && job.sessionId) { task.jobId = job.id; task.sessionId = job.sessionId; } } catch { /* Still unbound. */ }
        }
        if (!task.jobId) {
          // No session was ever confirmed for this launch, so there is nothing to stop.
          if (manager.snapshot().jobs.some(item => item.launchId === task.launchId)) return {ok: false, code: 'launch_uncertain'};
          finish('session_never_confirmed');
          return {ok: true, sessionStopped: false, task: this.view(task, {full: true})};
        }
        task.stopRequested = true;
        let job;
        try { job = (await manager.stop(task.jobId)).jobs.find(item => item.id === task.jobId); } catch { task.reason = 'stop_unconfirmed'; this.changed(task); return {ok: false, code: 'stop_unconfirmed'}; }
        // The command returning is not the evidence; the refreshed list is.
        if (job?.state !== 'stopped') { task.reason = 'stop_unconfirmed'; this.changed(task); return {ok: false, code: 'stop_unconfirmed'}; }
        finish('stopped_by_owner');
        return {ok: true, sessionStopped: true, task: this.view(task, {full: true})};
      });
    });
  }
  remove({id, discard} = {}) {
    return this.exclusive(id, async task => {
      if (task.state !== 'draft' && !FINISHED.has(task.state)) return {ok: false, code: 'not_finished'};
      if (discard !== undefined && typeof discard !== 'boolean') return {ok: false, code: 'invalid_request'};
      let worktree = {removed: false, missing: true, branchKept: false, discarded: false};
      // Throws worktree_has_changes unless the owner explicitly discards.
      if (task.worktree) worktree = await this.worktrees.remove(task, {discard: discard === true});
      this.tasks = this.tasks.filter(item => item !== task); this.reconciled.delete(task.id);
      this.changed(null); this.release(task);
      return {ok: true, worktree};
    });
  }
  open(id) {
    const task = this.find(id);
    return task ? {ok: true, project: task.project, worktree: task.worktree, branch: task.branch, baseCommit: task.baseCommit, jobId: task.jobId, sessionId: task.sessionId} : {ok: false, code: 'unknown_task'};
  }
  diff(id) {
    return this.exclusive(id, async task => {
      if (!task.worktree) return {ok: false, code: 'no_worktree'};
      const diff = await this.worktrees.diffSummary(task);
      this.fileReview = {task, diff};
      if (task.boundary?.base) { task.boundary.last = await this.worktrees.boundaryCheck(task); this.save(); }
      return {ok: true, task: this.view(task, {full: true}), diff, boundary: task.boundary ? structuredClone(task.boundary) : null};
    });
  }
  async diffFile({id, section, path: filePath}) {
    const task = this.find(id), review = this.fileReview;
    if (!task || review?.task !== task || !['committed', 'uncommitted'].includes(section) || typeof filePath !== 'string')
      return {ok: false, code: 'file_diff_changed'};
    const file = review.diff[section]?.files.find(item => item.path === filePath && !item.pathTruncated);
    if (!file) return {ok: false, code: 'file_diff_changed'};
    try {
      const changes = await this.worktrees.diffFile(task, section, file);
      return this.fileReview === review ? {ok: true, changes} : {ok: false, code: 'file_diff_changed'};
    } catch (error) {
      return {ok: false, code: error instanceof WorktreeError ? error.code : 'file_diff_unavailable'};
    }
  }
}

// Wires the board to this app: its own ownership ledger (separate from the
// workbench's), the shared bus, and the hook store for catching up.
function createTaskBoard({home, bus = null, discover, observe = null, onChange = () => {}, onHandback, language = () => 'zh', now = Date.now} = {}) {
  const {BackgroundSessions} = require('./background-sessions.cjs');
  let manager = null, starting = null;
  const sessions = () => {
    if (manager) return Promise.resolve(manager);
    // The owner's own dispatch is the explicit opt-in for this ledger.
    starting ||= (async () => { manager = new BackgroundSessions({root: path.join(home, 'task-board-sessions'), cli: await discover(), enabled: true, now}); return manager; })().finally(() => { starting = null; });
    return starting;
  };
  const board = new TaskBoard({home, bus, now, sessions, observe, onChange, onHandback, language});
  if (bus) bus.subscribe({source: 'claude-code', kind: 'session.'}, event => { board.observe(event.change); });
  return board;
}
// IPC surface. A project path is accepted only if this app run's native
// directory picker returned it; the renderer cannot name a directory itself.
function taskBoardHandlers(board, {pick} = {}) {
  const picked = new Set();
  const guard = fn => async value => { try { return await fn(value); } catch { return {ok: false, code: 'internal'}; } };
  const object = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return {
    taskPickProject: guard(async () => {
      const chosen = await pick();
      if (typeof chosen !== 'string' || !chosen) return {ok: false, code: 'cancelled'};
      let repo;
      try { repo = await board.worktrees.resolveRepo(chosen); } catch (error) { return {ok: false, code: error instanceof WorktreeError ? error.code : 'invalid_project'}; }
      if (picked.size >= 50) picked.delete(picked.values().next().value);
      picked.add(chosen);
      return {ok: true, project: chosen, repository: repo};
    }),
    taskCreate: guard(value => { const {title, brief, project} = object(value); return typeof project === 'string' && picked.has(project) ? board.create({title, brief, project}) : {ok: false, code: 'project_not_picked'}; }),
    taskUpdate: guard(value => { const {id, title, brief} = object(value); return board.update({id, title, brief}); }),
    taskDispatch: guard(id => board.dispatch(id)),
    taskAccept: guard(value => { const {id, note} = object(value); return board.accept({id, note}); }),
    taskRework: guard(value => { const {id, why} = object(value); return board.rework({id, why}); }),
    taskPause: guard(id => board.pause(id)),
    taskStop: guard(id => board.stop(id)),
    taskRemove: guard(value => { const {id, discard} = object(value); return board.remove({id, discard}); }),
    taskDiff: guard(id => board.diff(id)),
    taskDiffFile: guard(value => board.diffFile(object(value))),
    taskCapabilities: guard(() => board.capabilities()),
  };
}
module.exports = {TaskBoard, createTaskBoard, taskBoardHandlers, parseReport, reportFlags, claimsFixed, buildPrompt, isBugfix, mapObserved, STATES, FINISHED, CHECK_AFTER_MS, MAX_SILENT_RENEWALS, MAX_UNFINISHED, MAX_FINISHED, NOT_SANDBOX};
