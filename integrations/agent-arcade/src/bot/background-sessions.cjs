'use strict';
// Explicit, opt-in lifecycle prototype. Ownership is exact and durable; this
// module never stops the supervisor or adopts another application's sessions.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {execFile} = require('node:child_process');
const {promisify} = require('node:util');
const {atomicJSON} = require('../core/files.cjs');
const {ClaudeSessionMonitor, workspacePath, executable, UUID, JOB_ID} = require('./claude-sessions.cjs');
const MAX_JOBS = 20;
// The only permission modes this module will ever pass. 'acceptEdits' is the
// task board's pre-authorization of file edits inside a task worktree; it is
// neither a sandbox nor a way around command confirmation.
const PERMISSIONS = new Set(['default', 'acceptEdits']);
// Never part of a launch, whatever a caller asks for: options and modes that
// skip or auto-answer permission checks.
const FORBIDDEN_FLAGS = ['--dangerously-skip-permissions', '--allow-dangerously-skip-permissions', '--permission-prompts', '--permission-prompt-tool', '--allowedTools', '--allowed-tools', '--add-dir', '--settings', '--bare'];
const FORBIDDEN_MODES = ['bypassPermissions', 'dontAsk', 'auto'];
function assertSafeLaunchArgs(args) {
  if (!Array.isArray(args) || args.some(value => typeof value !== 'string')) throw Error('Launch arguments must be strings.');
  // Everything after the first "--" is the literal prompt, not an option.
  const end = args.indexOf('--'), options = end < 0 ? args : args.slice(0, end);
  for (const [index, value] of options.entries()) {
    const name = value.split('=')[0];
    if (FORBIDDEN_FLAGS.some(flag => flag.toLowerCase() === name.toLowerCase())) throw Error('A permission-skipping launch option was refused.');
    const operand = (value.startsWith('--') && value.includes('=') ? value.slice(value.indexOf('=') + 1) : value).toLowerCase();
    if (FORBIDDEN_MODES.some(mode => mode.toLowerCase() === operand)) throw Error('A permission-skipping launch mode was refused.');
    if (name === '--permission-mode' && !PERMISSIONS.has(value.includes('=') ? value.slice(value.indexOf('=') + 1) : options[index + 1])) throw Error('This permission mode is not offered.');
  }
  return args;
}
function launchArgs({launchId, permission = 'default', prompt = ''} = {}) {
  if (!UUID.test(launchId)) throw Error('A launch tag is required.');
  if (!PERMISSIONS.has(permission)) throw Error('This permission mode is not offered.');
  if (typeof prompt !== 'string' || prompt.length > 8000 || prompt.includes('\0')) throw Error('Background prompt must be at most 8,000 characters.');
  return assertSafeLaunchArgs(['--bg', '--name', `arcade-${launchId}`, '--permission-mode', permission, '--', prompt]);
}
function launchFailure(error) {
  // Inspect transient CLI error text only for fixed categories. Never publish
  // or persist raw output, which may contain a prompt, path or credential.
  const output = `${error?.stdout || ''}\n${error?.stderr || ''}`.slice(0, 100000);
  if (/workspace not trusted/i.test(output)) return {rejected: true, reason: 'Workspace is not trusted. Open it in the original Claude Code terminal to review trust first.'};
  if (/unknown option|unknown argument|unrecognized option/i.test(output)) return {rejected: true, reason: 'This Claude build does not accept the required background command flags.'};
  if (/background.+(?:not supported|not available|disabled)|agent view.+(?:not supported|not available|disabled)/i.test(output)) return {rejected: true, reason: 'Background sessions are unavailable or disabled in this environment.'};
  if (/nested.+session|inside another Claude Code session/i.test(output)) return {rejected: true, reason: 'Claude refused a nested session. Start Agent Arcade outside an active Claude environment.'};
  return {rejected: false, reason: error?.killed ? 'Background launch timed out.' : 'Background launch was not confirmed.'};
}
class BackgroundSessions {
  constructor({root, cli, run = promisify(execFile), now = Date.now, enabled = false} = {}) {
    if (typeof root !== 'string' || !path.isAbsolute(root)) throw Error('An absolute application data directory is required.');
    this.file = path.join(root, 'background-sessions.json'); this.cli = executable(cli); this.run = run; this.now = now; this.enabled = enabled === true;
    this.monitor = new ClaudeSessionMonitor({cli: this.cli, run, now}); this.pending = false;
    this.capability = {available: false, checked: false, version: '', error: ''};
    this.jobs = []; this.storageError = false;
    if (fs.existsSync(this.file)) {
      try {
        if (fs.statSync(this.file).size > 64000) throw Error('Oversized ledger');
        const saved = JSON.parse(fs.readFileSync(this.file, 'utf8'));
        if (![1, 2].includes(saved.version) || !Array.isArray(saved.jobs) || saved.jobs.length > MAX_JOBS) throw Error('Invalid ledger');
        for (const row of saved.jobs) {
          const launchId = saved.version === 1 ? row?.sessionId : row?.launchId;
          if (!row || !UUID.test(launchId) || (row.sessionId && !UUID.test(row.sessionId)) || (row.id && !JOB_ID.test(row.id)) || typeof row.workspace !== 'string' || !path.isAbsolute(row.workspace) || row.workspace.length > 4096 || !Number.isSafeInteger(row.createdAt)) throw Error('Invalid ownership');
          this.jobs.push({launchId, sessionId: row.id ? row.sessionId : '', id: row.id || '', workspace: row.workspace, createdAt: row.createdAt, state: 'unknown', request: !row.id ? 'creation-uncertain' : '', outcome: 'unverified'});
        }
      } catch { this.jobs = []; this.storageError = true; }
    }
  }
  setEnabled(value) { this.enabled = value === true; return this.snapshot(); }
  snapshot() { return {enabled: this.enabled, busy: this.pending, capability: {...this.capability}, storageError: this.storageError, jobs: structuredClone(this.jobs), experimental: true, channelsVerified: false}; }
  list() { return this.snapshot(); }
  save() { atomicJSON(this.file, {version: 2, jobs: this.jobs.map(({id, launchId, sessionId, workspace, createdAt, request}) => ({id, launchId, sessionId, workspace, createdAt, request}))}); }
  async command(args, cwd) { return this.run(this.cli, args, {cwd, timeout: 15000, maxBuffer: 1024 * 1024, windowsHide: true, shell: false, encoding: 'utf8'}); }
  async probe() {
    try {
      const versionResult = await this.command(['--version']);
      const parts = versionResult.stdout.match(/\b(\d+)\.(\d+)\.(\d+)\b/)?.slice(1).map(Number);
      const version = parts?.join('.') || '';
      if (!parts || parts[0] < 2 || parts[0] === 2 && (parts[1] < 1 || parts[1] === 1 && parts[2] < 317)) throw Error('Unsupported version');
      const {stdout} = await this.command(['--help']);
      if (!stdout.includes('--background') || !stdout.includes('--name') || !stdout.includes('respawn') || !stdout.includes('stop')) throw Error('Missing lifecycle commands');
      // Read from the CLI's own help text; an unlisted mode is never assumed.
      const modes = stdout.match(/--permission-mode\b[\s\S]{0,400}?\(choices:([^)]*)\)/)?.[1] || '';
      this.permissionModes = [...modes.matchAll(/"([A-Za-z]+)"/g)].map(match => match[1]);
      this.capability = {available: true, checked: true, version, error: ''};
    } catch { this.permissionModes = []; this.capability = {available: false, checked: true, version: '', error: 'Claude Code 2.1.317+ with background lifecycle commands is required.'}; }
    return this.snapshot();
  }
  async exclusive(fn) {
    if (!this.enabled) throw Error('Enable the background-session experiment first.');
    if (this.storageError) throw Error('Background ownership record is unreadable; no session can be changed.');
    if (this.pending) throw Error('A background-session operation is already pending.');
    this.pending = true;
    try { if (!this.capability.checked) await this.probe(); if (!this.capability.available) throw Error(this.capability.error); return await fn(); }
    finally { this.pending = false; }
  }
  async refresh(workspace) {
    const resolved = workspacePath(workspace), result = await this.monitor.refresh(resolved);
    let changed = false; const settled = new Set();
    for (const job of this.jobs.filter(item => item.workspace === resolved)) {
      const candidates = result.available ? result.sessions.filter(item => item.kind === 'background' && item.sessionId && (job.id && job.sessionId ? item.id === job.id && item.sessionId === job.sessionId : item.arcadeTag === job.launchId && (!job.id || item.id === job.id))) : [];
      const row = candidates.length === 1 ? candidates[0] : null;
      // A launch that never produced a session would otherwise block every
      // later create. Claude's own list not showing its tag, a minute on, is
      // the evidence that nothing was started.
      if (result.available && !candidates.length && !job.sessionId && job.request === 'creation-uncertain' && this.now() - job.createdAt > 60000) { settled.add(job); changed = true; continue; }
      if (!row || !row.id) { job.state = 'unknown'; job.request = job.request || 'status-unavailable'; continue; }
      if (!job.id || !job.sessionId) { job.id = row.id; job.sessionId = row.sessionId; changed = true; }
      job.state = row.state; job.status = row.status; job.waitingFor = row.waitingFor; job.checkedAt = result.checkedAt;
      job.request = ''; // Refreshed evidence, not command success, settles UI state.
    }
    if (settled.size) this.jobs = this.jobs.filter(job => !settled.has(job));
    if (changed) this.save();
    return this.snapshot();
  }
  // Whether the probed CLI lists a permission mode in its own help text.
  supportsPermission(mode) { return this.capability.available && PERMISSIONS.has(mode) && (this.permissionModes || []).includes(mode); }
  // Forget an ownership record without touching the session itself.
  release(launchId) {
    if (this.pending) throw Error('A background-session operation is already pending.');
    if (this.storageError) throw Error('Background ownership record is unreadable; no session can be changed.');
    const before = this.jobs.length; this.jobs = this.jobs.filter(job => job.launchId !== launchId);
    if (this.jobs.length !== before) this.save();
    return this.jobs.length !== before;
  }
  create({workspace, cwd, prompt = '', permission = 'default', launchId: requested} = {}) {
    return this.exclusive(async () => {
      const resolved = workspacePath(cwd === undefined ? workspace : cwd);
      if (typeof prompt !== 'string' || prompt.length > 8000 || prompt.includes('\0')) throw Error('Background prompt must be at most 8,000 characters.');
      if (!PERMISSIONS.has(permission)) throw Error('This permission mode is not offered.');
      if (requested !== undefined && (!UUID.test(requested) || this.jobs.some(job => job.launchId === requested.toLowerCase()))) throw Error('A fresh launch tag is required.');
      if (this.jobs.length >= MAX_JOBS) throw Error('Background prototype supports at most 20 owned sessions.');
      if (this.jobs.some(job => !job.id || !job.sessionId)) throw Error('Resolve the previous uncertain launch before starting another session.');
      const launchId = requested === undefined ? crypto.randomUUID() : requested.toLowerCase();
      const args = launchArgs({launchId, permission, prompt});
      const job = {id: '', launchId, sessionId: '', workspace: resolved, createdAt: this.now(), state: 'unknown', request: 'creating', outcome: 'unverified'};
      this.jobs.push(job); this.save(); // Durable identity before a side effect.
      try {
        const {stdout} = await this.command(args, resolved);
        // --session-id is not preserved by --bg in the tested 2.1.317 build.
        // Bind the CLI-reported job to our durable random launch tag instead.
        const printed = stdout.match(/backgrounded\s*·\s*([a-f0-9]{8,32})(?:\s*·|\s|$)/i)?.[1];
        if (printed) { job.id = printed.toLowerCase(); this.save(); }
      } catch (error) {
        const failure = launchFailure(error);
        if (failure.rejected) {
          this.jobs = this.jobs.filter(item => item !== job); this.save();
          throw Error(failure.reason);
        }
        job.request = 'creation-uncertain'; this.save();
        throw Error(`${failure.reason} Refresh its status before retrying; check the original Claude Code terminal if it remains unavailable.`);
      }
      await this.refresh(resolved);
      if (!job.id || !job.sessionId) { job.request = 'creation-uncertain'; this.save(); throw Error('Claude returned without a matching owned session. Refresh before another launch.'); }
      return this.snapshot();
    });
  }
  owned(id) {
    if (typeof id !== 'string' || !JOB_ID.test(id)) throw Error('An exact owned background session ID is required.');
    const job = this.jobs.find(item => item.id === id);
    if (!job) throw Error('This session was not created by Agent Arcade.');
    return job;
  }
  stop(id) { return this.change(id, 'stop'); }
  resume(id) { return this.change(id, 'respawn'); }
  change(id, command) {
    return this.exclusive(async () => {
      const job = this.owned(id);
      await this.refresh(job.workspace);
      if (job.state === 'unknown') throw Error('Cannot confirm the owned session identity. Refresh before changing it.');
      if (command === 'respawn' && !['stopped', 'failed', 'done'].includes(job.state)) throw Error('Stop the session before restarting it.');
      job.request = command === 'stop' ? 'stop-requested' : 'resume-requested'; this.save();
      try { await this.command([command, job.id], job.workspace); }
      catch { job.request = 'command-uncertain'; this.save(); throw Error('The session command was not confirmed. Refresh its status in Claude Code.'); }
      await this.refresh(job.workspace);
      return this.snapshot();
    });
  }
}
module.exports = {BackgroundSessions, launchFailure, launchArgs, assertSafeLaunchArgs, PERMISSIONS, FORBIDDEN_FLAGS, FORBIDDEN_MODES};
