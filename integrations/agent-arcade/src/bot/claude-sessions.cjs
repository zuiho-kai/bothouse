'use strict';
// Read only the documented CLI interface. Never read Claude's credentials,
// transcripts or internal ~/.claude/jobs files.
const fs = require('node:fs');
const path = require('node:path');
const {execFile} = require('node:child_process');
const {promisify} = require('node:util');
const execute = promisify(execFile);
const STATES = new Set(['working', 'blocked', 'done', 'failed', 'stopped']);
const STATUSES = new Set(['busy', 'waiting', 'idle']);
const WAITS = new Set(['permission prompt', 'input needed', 'sandbox request', 'worker request', 'dialog open']);
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const JOB_ID = /^[a-f0-9]{8,32}$/i;
const MAX_BYTES = 1024 * 1024, MAX_SESSIONS = 200;

function executable(value) {
  const cli = typeof value === 'object' ? value?.cli : value;
  if (typeof cli !== 'string' || !path.isAbsolute(cli) || /\.(?:cmd|bat|ps1)$/i.test(cli)) throw Error('A native Claude executable is required.');
  return cli;
}
function workspacePath(value) {
  if (typeof value !== 'string' || value.length > 4096 || !path.isAbsolute(value) || value.includes('\0')) throw Error('Choose an absolute project directory.');
  const resolved = fs.realpathSync(value);
  if (!fs.statSync(resolved).isDirectory()) throw Error('Choose a project directory.');
  return resolved;
}
function inside(child, parent) {
  const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}
function parseSessions(output, workspace) {
  if (typeof output !== 'string' || Buffer.byteLength(output) > MAX_BYTES) throw Error('Session response exceeds the limit.');
  let values;
  try { values = JSON.parse(output); } catch { throw Error('Claude did not return a JSON session list.'); }
  if (!Array.isArray(values) || values.length > MAX_SESSIONS) throw Error('Session list is invalid or too large.');
  const seen = new Set(), jobIds = new Set(), result = [];
  for (const row of values) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) continue;
    // Some supported interactive versions omit kind/cwd. --cwd remains the
    // authoritative scope. If cwd is present, additionally enforce it locally.
    if (row.cwd !== undefined && (typeof row.cwd !== 'string' || row.cwd.length > 4096 || !path.isAbsolute(row.cwd) || !inside(row.cwd, workspace))) continue;
    const sessionId = typeof row.sessionId === 'string' && UUID.test(row.sessionId) ? row.sessionId.toLowerCase() : '';
    const id = typeof row.id === 'string' && JOB_ID.test(row.id) ? row.id.toLowerCase() : '';
    if (!sessionId && !id) continue;
    const key = sessionId || `job:${id}`;
    if (seen.has(key)) throw Error('Claude returned duplicate session identities.');
    if (id && jobIds.has(id)) throw Error('Claude returned duplicate background job identities.');
    seen.add(key);
    if (id) jobIds.add(id);
    result.push({sessionId, id, kind: ['interactive', 'background'].includes(row.kind) ? row.kind : id ? 'background' : 'unknown',
      arcadeTag: typeof row.name === 'string' && /^arcade-[a-f0-9-]{36}$/.test(row.name) && UUID.test(row.name.slice(7)) ? row.name.slice(7) : '',
      state: STATES.has(row.state) ? row.state : 'unknown', status: STATUSES.has(row.status) ? row.status : 'unknown',
      waitingFor: WAITS.has(row.waitingFor) && row.status === 'waiting' ? row.waitingFor : '',
      startedAt: Number.isSafeInteger(row.startedAt) && row.startedAt > 0 ? row.startedAt : null,
      pid: Number.isSafeInteger(row.pid) && row.pid > 0 ? row.pid : null,
      outcome: 'unverified'});
  }
  return result;
}
function classify(row) {
  if (!row) return 'unknown';
  if (row.status === 'waiting' || row.state === 'blocked') return 'waiting';
  if (row.state === 'failed') return 'error';
  if (row.state === 'stopped') return 'ended';
  if (row.status === 'busy' || row.state === 'working') return 'running';
  if (row.state === 'done') return 'response-ended';
  if (row.status === 'idle') return 'idle';
  return 'unknown';
}
function reconcileSessionEvidence(tasks, snapshot, now = Date.now()) {
  const fresh = snapshot?.available === true && Number.isFinite(snapshot.checkedAt) && now - snapshot.checkedAt <= 30000 && now >= snapshot.checkedAt;
  const rows = new Map((snapshot?.sessions || []).filter(row => row.sessionId).map(row => [row.sessionId, row]));
  const observedIds = new Set(snapshot?.observedSessionIds || []);
  return (Array.isArray(tasks) ? tasks : []).map(task => {
    // Parent-level session status says nothing about a particular subagent.
    if (task.agent) return {...task, sessionEvidence: {fresh, agreement: 'unavailable', reason: 'subagent_not_in_session_list'}};
    const row = rows.get(String(task.session).toLowerCase()), observed = classify(row);
    if (!row && !observedIds.has(String(task.session).toLowerCase())) return {...task, sessionEvidence: {fresh, agreement: 'unavailable', reason: 'outside_observed_scope'}};
    const compatible = {running: ['running'], waiting: ['waiting'], done: ['response-ended', 'idle'], idle: ['idle', 'response-ended'], ended: ['ended'], error: ['error']};
    const agreement = !fresh ? 'stale' : !row ? 'missing' : observed === 'unknown' || !compatible[task.state] ? 'unknown' : compatible[task.state].includes(observed) ? 'consistent' : 'conflict';
    return {...task, sessionEvidence: {fresh, agreement, observed: fresh && row ? observed : 'unknown', checkedAt: snapshot?.checkedAt || null, outcome: 'unverified'}};
  });
}
class ClaudeSessionMonitor {
  constructor({cli, run = execute, now = Date.now} = {}) {
    this.cli = executable(cli); this.run = run; this.now = now; this.pending = null;
    this.value = {available: false, checkedAt: null, attemptedAt: null, workspace: '', sessions: [], observedSessionIds: [], error: '', source: 'claude-agents-json'};
  }
  snapshot() { return {...structuredClone(this.value), stale: !this.value.checkedAt || this.now() - this.value.checkedAt > 30000}; }
  refresh(workspace) {
    const resolved = workspacePath(workspace);
    if (this.pending) {
      if (resolved !== this.value.workspace) return Promise.reject(Error('A session check for another project is still running.'));
      return this.pending;
    }
    if (resolved !== this.value.workspace) this.value = {...this.value, sessions: [], observedSessionIds: [], checkedAt: null};
    this.value.workspace = resolved;
    this.value.attemptedAt = this.now();
    this.pending = (async () => {
      try {
        const {stdout} = await this.run(this.cli, ['agents', '--json', '--all', '--cwd', resolved], {cwd: resolved, timeout: 8000, maxBuffer: MAX_BYTES, windowsHide: true, shell: false, encoding: 'utf8'});
        const sessions = parseSessions(stdout, resolved);
        const observedSessionIds = [...new Set([...this.value.observedSessionIds, ...sessions.map(row => row.sessionId).filter(Boolean)])].slice(-1000);
        this.value = {...this.value, available: true, checkedAt: this.now(), sessions, observedSessionIds, error: ''};
      } catch {
        // Do not retain raw subprocess errors: they can include names/prompts.
        this.value = {...this.value, available: false, error: 'Session status unavailable. Check Claude Code version, agent-view availability and project access.'};
      }
      return this.snapshot();
    })().finally(() => { this.pending = null; });
    return this.pending;
  }
  reconcile(tasks) { return reconcileSessionEvidence(tasks, this.snapshot(), this.now()); }
}
module.exports = {ClaudeSessionMonitor, parseSessions, reconcileSessionEvidence, classify, workspacePath, executable, UUID, JOB_ID};
