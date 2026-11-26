'use strict';
// Per-task git worktrees for the task board.
//
// Adapted in design from bothouse (https://github.com/zuiho-kai/bothouse):
//   bridge/contrib/gate/board.py (one entry per job with its branch/path),
//   dsh/collab/tasks.mjs (a job is worked on in its own workspace from a named base)
// at commit 218051eccbb31923aa2b0d837801cf4d82c4799f.
// Apache-2.0, Copyright (c) 2026 zuiho-kai and bothouse contributors.
// Re-implemented and modified for Agent Arcade (AGPL-3.0) on 2026-11-13: the
// upstream workspace pool is replaced by one git worktree per board task, kept
// outside the project tree, with argv-only git calls, refusal to delete
// unsaved work, and a best-effort boundary check of the owner's own checkout.
//
// A worktree is a separate directory, not a sandbox. Nothing here prevents a
// session from reading or writing elsewhere; boundaryCheck only compares the
// owner's checkout with a snapshot and cannot tell who changed it.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const {execFile} = require('node:child_process');
const MAX_OUTPUT = 1024 * 1024, TIMEOUT_MS = 20000, MAX_FILES = 200, MAX_PATH = 400, MAX_OUTSIDE = 20;
const MAX_FILE_BYTES = 128 * 1024, MAX_DIFF_CHARS = 48 * 1024, MAX_DIFF_LINES = 400;
const LOCAL_GIT = {localOnly: true};
const TASK_ID = /^[a-z0-9]{6,32}$/;
const COMMIT = /^[0-9a-f]{40,64}$/;
const BRANCH_PREFIX = 'arcade/task-';

class WorktreeError extends Error {
  constructor(code, details = {}) { super(code); this.name = 'WorktreeError'; this.code = code; this.details = details; }
}
// execFile with an argument array: no shell ever sees a path, title or branch.
function defaultRun(file, args, {cwd, timeoutMs = TIMEOUT_MS, encoding = 'utf8', localOnly = false} = {}) {
  return new Promise((resolve, reject) => {
    execFile(file, args, {cwd, timeout: timeoutMs, maxBuffer: MAX_OUTPUT, windowsHide: true, shell: false, encoding,
      // No credential prompt, and read-only commands do not refresh the owner's index.
      env: {...process.env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0',
        ...(localOnly ? {GIT_NO_LAZY_FETCH: '1', GIT_ALLOW_PROTOCOL: ''} : {})}},
    (error, stdout, stderr) => error ? reject(Object.assign(error, {stdout, stderr})) : resolve({stdout, stderr}));
  });
}
const fold = value => process.platform === 'win32' ? value.toLowerCase() : value;
function same(a, b) { return fold(path.resolve(a)) === fold(path.resolve(b)); }
function inside(child, parent) {
  const relative = path.relative(fold(path.resolve(parent)), fold(path.resolve(child)));
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}
function real(value) { try { return fs.realpathSync.native(value); } catch { return path.resolve(value); } }
function branchName(taskId) { return `${BRANCH_PREFIX}${taskId}`; }

function parseNumstat(output) {
  const files = []; let insertions = 0, deletions = 0, count = 0;
  for (const line of String(output).split('\n')) {
    const match = line.match(/^(\d+|-)\t(\d+|-)\t(.+)$/);
    if (!match) continue;
    count++;
    const binary = match[1] === '-', added = binary ? 0 : Number(match[1]), removed = binary ? 0 : Number(match[2]);
    insertions += added; deletions += removed;
    if (files.length < MAX_FILES) files.push({path: match[3].slice(0, MAX_PATH), insertions: added, deletions: removed, binary,
      ...(match[3].length > MAX_PATH ? {pathTruncated: true} : {})});
  }
  return {files, fileCount: count, insertions, deletions, truncated: count > files.length};
}
function parseStatus(output) {
  const parts = String(output).split('\0'), files = []; let count = 0;
  for (let index = 0; index < parts.length; index++) {
    const entry = parts[index];
    if (entry.length < 4) continue;
    const status = entry.slice(0, 2);
    if (/[RC]/.test(status)) index++; // The next field is the path it was renamed or copied from.
    count++;
    if (files.length < MAX_FILES) files.push({status, path: entry.slice(3, 3 + MAX_PATH),
      ...(entry.length > 3 + MAX_PATH ? {pathTruncated: true} : {})});
  }
  return {files, fileCount: count, truncated: count > files.length};
}

function regularMode(mode) {
  if (!/^100[0-7]{3}$/.test(mode)) throw new WorktreeError('file_diff_special');
}

function previewText(bytes) {
  if (bytes.includes(0)) throw new WorktreeError('file_diff_binary');
  try { new TextDecoder('utf-8', {fatal: true}).decode(bytes); }
  catch { throw new WorktreeError('file_diff_binary'); }
  return bytes;
}

function readWorkingFile(worktree, segments) {
  let file = worktree;
  for (const [index, segment] of segments.entries()) {
    file = path.join(file, segment);
    const stat = fs.lstatSync(file, {throwIfNoEntry: false});
    if (!stat) return Buffer.alloc(0);
    if (stat.isSymbolicLink() || (index === segments.length - 1 ? !stat.isFile() : !stat.isDirectory()))
      throw new WorktreeError('file_diff_special');
  }
  if (!inside(fs.realpathSync.native(file), worktree)) throw new WorktreeError('file_diff_special');
  const fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  try {
    const before = fs.fstatSync(fd);
    if (!before.isFile()) throw new WorktreeError('file_diff_special');
    if (before.size > MAX_FILE_BYTES) throw new WorktreeError('file_diff_large');
    const bytes = Buffer.alloc(before.size + 1);
    const count = fs.readSync(fd, bytes, 0, bytes.length, 0);
    const after = fs.lstatSync(file);
    if (count !== before.size || after.isSymbolicLink() || before.ino !== after.ino || before.dev !== after.dev ||
        before.mtimeMs !== after.mtimeMs || !inside(fs.realpathSync.native(file), worktree))
      throw new WorktreeError('file_diff_changed');
    return previewText(bytes.subarray(0, count));
  } finally { fs.closeSync(fd); }
}

class TaskWorktrees {
  constructor({home, run = defaultRun, git = 'git', now = Date.now} = {}) {
    if (typeof home !== 'string' || !path.isAbsolute(home)) throw Error('An absolute application data directory is required.');
    this.root = path.join(home, 'task-worktrees'); this.run = run; this.gitFile = git; this.now = now;
  }
  async git(args, cwd, timeoutMs = TIMEOUT_MS, options = {}) {
    if (!Array.isArray(args) || args.some(value => typeof value !== 'string' || value.includes('\0'))) throw new WorktreeError('invalid_arguments');
    const {stdout} = await this.run(this.gitFile, args, {cwd, timeoutMs, ...options});
    if (!(options.encoding === 'buffer' ? Buffer.isBuffer(stdout) : typeof stdout === 'string') || stdout.length > MAX_OUTPUT)
      throw new WorktreeError('git_output_too_large');
    return stdout;
  }
  async available() {
    try { const version = (await this.git(['--version'], undefined, 5000)).match(/\d+\.\d+(?:\.\d+)?/)?.[0] || ''; return {available: !!version, version}; }
    catch { return {available: false, version: ''}; }
  }
  // The repository that contains the chosen directory.
  async resolveRepo(project) {
    if (typeof project !== 'string' || project.length > 4096 || project.includes('\0') || !path.isAbsolute(project)) throw new WorktreeError('invalid_project');
    let resolved;
    try { resolved = fs.realpathSync.native(project); if (!fs.statSync(resolved).isDirectory()) throw Error('Not a directory'); }
    catch { throw new WorktreeError('invalid_project'); }
    let top;
    try { top = (await this.git(['rev-parse', '--show-toplevel'], resolved)).trim(); }
    catch (error) { throw new WorktreeError(error instanceof WorktreeError ? error.code : error?.code === 'ENOENT' ? 'git_unavailable' : 'not_a_git_repository'); }
    if (!top || !path.isAbsolute(top) || !fs.existsSync(top)) throw new WorktreeError('not_a_git_repository');
    return real(top);
  }
  paths(task) {
    if (!task || typeof task.id !== 'string' || !TASK_ID.test(task.id)) throw new WorktreeError('invalid_task');
    const worktree = path.join(this.root, task.id), branch = branchName(task.id);
    // Only the directory and branch this module would itself have created.
    if (task.worktree && !same(task.worktree, worktree)) throw new WorktreeError('worktree_mismatch');
    if (task.branch && task.branch !== branch) throw new WorktreeError('worktree_mismatch');
    if (typeof task.project !== 'string' || !path.isAbsolute(task.project)) throw new WorktreeError('invalid_project');
    return {worktree, branch, repo: task.project, base: COMMIT.test(task.baseCommit || '') ? task.baseCommit : ''};
  }
  async create({taskId, project} = {}) {
    if (typeof taskId !== 'string' || !TASK_ID.test(taskId)) throw new WorktreeError('invalid_task');
    const repo = await this.resolveRepo(project);
    let head;
    try { head = (await this.git(['rev-parse', '--verify', 'HEAD'], repo)).trim(); } catch { throw new WorktreeError('no_commits'); }
    if (!COMMIT.test(head)) throw new WorktreeError('no_commits');
    fs.mkdirSync(this.root, {recursive: true, mode: 0o700});
    const worktree = path.join(this.root, taskId), branch = branchName(taskId);
    if (inside(real(this.root), repo)) throw new WorktreeError('worktrees_inside_project');
    if (fs.existsSync(worktree)) throw new WorktreeError('worktree_exists');
    // Adds a branch and worktree metadata under the project's .git directory;
    // the owner's working tree, index and HEAD are not changed.
    try { await this.git(['worktree', 'add', '-b', branch, worktree, head], repo, 60000); }
    catch (error) { throw new WorktreeError(error instanceof WorktreeError ? error.code : 'worktree_failed'); }
    let top = '';
    try { top = (await this.git(['rev-parse', '--show-toplevel'], worktree)).trim(); } catch { /* Checked below. */ }
    if (!top || !same(real(top), real(worktree))) throw new WorktreeError('worktree_failed');
    return {project: repo, worktree, branch, baseCommit: head};
  }
  // Reusing a task directory must not follow a replaced symlink or another
  // checkout. This validates ownership, not confinement of the CLI itself.
  async validate(task) {
    const {worktree, branch, repo} = this.paths(task);
    if (!fs.existsSync(worktree)) throw new WorktreeError('no_worktree');
    if (!same(real(worktree), path.join(real(this.root), task.id))) throw new WorktreeError('worktree_mismatch');
    let top, current, sameRepository;
    try {
      top = (await this.git(['rev-parse', '--show-toplevel'], worktree)).trim();
      current = (await this.git(['symbolic-ref', '--quiet', '--short', 'HEAD'], worktree)).trim();
      // Another repository can use the same branch name at the same path.
      // Linked worktrees of the selected project share its Git common directory.
      const commonDirectory = async cwd => {
        const name = (await this.git(['rev-parse', '--git-common-dir'], cwd)).trim();
        return fs.realpathSync.native(path.resolve(cwd, name));
      };
      const [linked, owner] = await Promise.all([commonDirectory(worktree), commonDirectory(repo)]);
      sameRepository = same(linked, owner);
    } catch { throw new WorktreeError('worktree_mismatch'); }
    if (!same(real(top), real(worktree)) || current !== branch || !sameRepository) throw new WorktreeError('worktree_mismatch');
    return true;
  }
  async snapshot(repo) {
    const head = (await this.git(['rev-parse', '--verify', 'HEAD'], repo)).trim();
    const status = await this.git(['status', '--porcelain=v1', '-z'], repo);
    let numstat = '';
    // Catches a further edit to a file that was already modified at dispatch.
    try { numstat = await this.git(['diff', '--numstat', 'HEAD'], repo); } catch { numstat = 'unavailable'; }
    return {head: COMMIT.test(head) ? head : '', statusHash: crypto.createHash('sha256').update(status).update('\0').update(numstat).digest('hex'), at: this.now()};
  }
  async state(task) {
    const {worktree, branch} = this.paths(task);
    if (!fs.existsSync(worktree)) return {exists: false, dirty: false, unmerged: 0};
    // Cleanup needs to know whether any work exists, even when the owner's status hides untracked files.
    const dirty = (await this.git(['status', '--porcelain=v1', '-z', '--untracked-files=normal'], worktree)).length > 0;
    // Commits on the task branch that no other local branch contains.
    const unmerged = Number((await this.git(['rev-list', '--count', `refs/heads/${branch}`, '--not', `--exclude=${branch}`, '--branches'], worktree)).trim());
    if (!Number.isSafeInteger(unmerged)) throw new WorktreeError('worktree_state_unknown');
    return {exists: true, dirty, unmerged};
  }
  // Refuses to delete uncommitted or unmerged work unless the owner explicitly
  // discards it. Never pushes, merges or touches the owner's working tree.
  async remove(task, {discard = false} = {}) {
    const {worktree, branch, repo} = this.paths(task);
    let current;
    try { current = await this.state(task); } catch (error) { throw new WorktreeError(error instanceof WorktreeError ? error.code : 'worktree_state_unknown'); }
    if (!current.exists) return {removed: false, missing: true, branchKept: true, discarded: false};
    const unsaved = current.dirty || current.unmerged > 0;
    if (unsaved && discard !== true) throw new WorktreeError('worktree_has_changes', {dirty: current.dirty, unmerged: current.unmerged});
    try { await this.git(['worktree', 'remove', ...(discard === true && current.dirty ? ['--force'] : []), worktree], repo, 60000); }
    catch { throw new WorktreeError('worktree_remove_failed'); }
    let branchKept = false;
    try { await this.git(['branch', discard === true && current.unmerged > 0 ? '-D' : '-d', branch], repo); } catch { branchKept = true; }
    return {removed: true, missing: false, branchKept, discarded: unsaved};
  }
  async diffSummary(task) {
    const {worktree, base} = this.paths(task);
    if (!fs.existsSync(worktree)) return {exists: false, commits: 0, committed: parseNumstat(''), uncommitted: parseStatus('')};
    if (!base) throw new WorktreeError('invalid_task');
    const commits = Number((await this.git(['rev-list', '--count', `${base}..HEAD`], worktree)).trim());
    const committed = parseNumstat(await this.git(['-c', 'core.quotepath=off', 'diff', '--numstat', `${base}...HEAD`], worktree));
    const uncommitted = parseStatus(await this.git(['status', '--porcelain=v1', '-z', '--untracked-files=all'], worktree));
    return {exists: true, commits: Number.isSafeInteger(commits) ? commits : 0, committed, uncommitted};
  }
  // Binary and size checks precede the patch. Git sees two bounded local copies
  // rather than the working file, so repository filters cannot run.
  async diffFile(task, section, file) {
    const relative = file.path, segments = relative.split('/');
    if (file.binary) throw new WorktreeError('file_diff_binary');
    if (file.pathTruncated || /[\\:\u0000-\u001f]/u.test(relative) ||
        segments.some(segment => !segment || /^\.{1,2}$|^\.git$/i.test(segment) ||
          process.platform === 'win32' && (/[. ]$/.test(segment) || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(segment))) ||
        /[RCU]/.test(file.status || '') || section === 'committed' && (relative.includes(' => ') || relative.startsWith('"')))
      throw new WorktreeError('file_diff_special');
    await this.validate(task);
    const {worktree, base} = this.paths(task);
    const readGit = (args, options = LOCAL_GIT) => this.git(args, worktree, 5000, options);
    async function readBlob(entry) {
      if (!entry) return Buffer.alloc(0);
      const tab = entry.indexOf('\t');
      const [mode, typeOrId, idOrStage] = entry.slice(0, tab).split(' ');
      regularMode(mode);
      const id = typeOrId === 'blob' ? idOrStage : typeOrId;
      if (tab < 0 || entry.slice(tab + 1) !== relative || !COMMIT.test(id)) throw new WorktreeError('file_diff_special');
      const size = Number((await readGit(['cat-file', '-s', id])).trim());
      if (!Number.isSafeInteger(size) || size < 0 || size > MAX_FILE_BYTES) throw new WorktreeError('file_diff_large');
      return previewText(await readGit(['cat-file', 'blob', id], {...LOCAL_GIT, encoding: 'buffer'}));
    }
    const tree = async ref => readBlob((await readGit(['--literal-pathspecs', 'ls-tree', '-z', ref, '--', relative])).slice(0, -1));
    const head = (await readGit(['rev-parse', '--verify', 'HEAD'])).trim();
    if (!COMMIT.test(head) || !base) throw new WorktreeError('file_diff_changed');
    if (section === 'committed') {
      const origin = (await readGit(['merge-base', base, head])).trim();
      if (!COMMIT.test(origin)) throw new WorktreeError('file_diff_changed');
      return this.patchFile([['committed', await tree(origin), await tree(head)]]);
    }
    const entries = (await readGit(['--literal-pathspecs', 'ls-files', '--stage', '-z', '--', relative])).split('\0').filter(Boolean);
    if (entries.length > 1 || entries[0] && !/^[^\t]+ 0\t/.test(entries[0])) throw new WorktreeError('file_diff_special');
    const committed = await tree(head), staged = await readBlob(entries[0]);
    const working = readWorkingFile(worktree, segments);
    return this.patchFile([['staged', committed, staged], ['working', staged, working]]);
  }
  async patchFile(pairs) {
    const changes = [];
    if (pairs.every(([,before,after]) => before.equals(after))) return changes;
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'arcade-diff-'));
    const left = path.join(scratch, 'before.txt'), right = path.join(scratch, 'after.txt');
    try {
      for (const [kind, before, after] of pairs) {
        if (before.equals(after)) continue;
        fs.writeFileSync(left, before, {mode: 0o600});
        fs.writeFileSync(right, after, {mode: 0o600});
        let output;
        try {
          output = await this.git(['diff', '--no-index', '--no-ext-diff', '--no-textconv', '--no-color',
            '--text', '--unified=3', '--', 'before.txt', 'after.txt'], scratch, 5000, LOCAL_GIT);
        } catch (error) {
          if (error.code !== 1 || typeof error.stdout !== 'string') throw error;
          output = error.stdout;
        }
        const lines = output.split('\n');
        const first = lines.findIndex(line => line.startsWith('@@ '));
        if (first < 0) continue;
        const patch = lines.slice(first, first + MAX_DIFF_LINES).join('\n');
        changes.push({kind, text: patch.slice(0, MAX_DIFF_CHARS),
          truncated: patch.length > MAX_DIFF_CHARS || lines.length - first > MAX_DIFF_LINES});
      }
      return changes;
    } finally {
      for (const file of [left, right]) await fs.promises.rm(file, {force: true});
      await fs.promises.rmdir(scratch);
    }
  }
  // Best effort. A changed checkout means "changed while the task ran", not
  // "changed by the task"; an unchanged one does not prove nothing else was touched.
  async boundaryCheck(task) {
    const {worktree, repo} = this.paths(task), base = task.boundary?.base, root = real(this.root), outsidePaths = [];
    const note = value => { if (outsidePaths.length < MAX_OUTSIDE && !outsidePaths.includes(value)) outsidePaths.push(value.slice(0, MAX_PATH)); };
    if (fs.existsSync(worktree) && !inside(real(worktree), root)) note(real(worktree));
    let listed = false;
    try {
      const output = await this.git(['worktree', 'list', '--porcelain'], repo);
      listed = true;
      for (const block of output.split(/\r?\n\r?\n/)) {
        const where = block.match(/^worktree (.+)$/m)?.[1]?.trim(), branch = block.match(/^branch refs\/heads\/(.+)$/m)?.[1]?.trim();
        if (!where || !branch?.startsWith(BRANCH_PREFIX)) continue;
        if (!inside(real(where), root)) note(path.resolve(where));
      }
    } catch { /* Reported as an incomplete check. */ }
    let now = null;
    try { now = await this.snapshot(repo); } catch { /* Reported as unknown. */ }
    const known = !!now && !!base && typeof base.head === 'string' && typeof base.statusHash === 'string';
    const sourceHeadChanged = known ? now.head !== base.head : null, sourceStatusChanged = known ? now.statusHash !== base.statusHash : null;
    return {checkedAt: this.now(), sourceRepoChanged: known ? sourceHeadChanged || sourceStatusChanged : null, sourceHeadChanged, sourceStatusChanged,
      // Who changed the checkout cannot be determined from here.
      attribution: 'unknown', worktreeListChecked: listed, outsidePaths};
  }
}
module.exports = {TaskWorktrees, WorktreeError, defaultRun, parseNumstat, parseStatus, branchName, inside, same, TASK_ID, COMMIT};
