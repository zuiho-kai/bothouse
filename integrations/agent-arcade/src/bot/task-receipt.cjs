'use strict';
const crypto = require('node:crypto'), fs = require('node:fs'), path = require('node:path');
const {same, TASK_ID} = require('./task-worktree.cjs');

const ROUND = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const CODE = /^[a-f0-9]{32}$/;
const IGNORE = '/.gitignore\n/ready\n';

function receiptPath(home, task) {
  if (!path.isAbsolute(home) || !TASK_ID.test(task.id) || !ROUND.test(task.launchId) ||
      !same(task.worktree, path.join(home, 'task-worktrees', task.id))) throw Error('Unexpected receipt worktree');
  return path.join(task.worktree, '.arcade-handback-' + task.launchId, 'ready');
}

function checkWorktree(home, task) {
  const actual = fs.realpathSync.native(task.worktree);
  if (!same(actual, path.join(fs.realpathSync.native(home), 'task-worktrees', task.id))) throw Error('Receipt worktree moved');
  const stat = fs.lstatSync(task.worktree, {bigint:true});
  if (!stat.isDirectory()) throw Error('Expected the dispatched worktree');
  return stat;
}

// Bind the proof to the directories actually issued for this launch. Replacing
// a directory at the same path must not move entitlement to another checkout.
function digestFor(task, worktree, directory, code) {
  return crypto.createHash('sha256').update([
    task.id, task.launchId, worktree.dev, worktree.ino, directory.dev, directory.ino, code,
  ].join('\0')).digest('hex');
}

function prepareReceipt(home, task) {
  const target = receiptPath(home, task), dir = path.dirname(target);
  const worktree = checkWorktree(home, task);
  // An existing directory belongs to someone else. Never adopt or overwrite it.
  fs.mkdirSync(dir, {mode:0o700});
  const directory = fs.lstatSync(dir, {bigint:true});
  const expected = path.join(fs.realpathSync.native(task.worktree), path.basename(dir));
  if (!directory.isDirectory() || !same(fs.realpathSync.native(dir), expected)) throw Error('Receipt directory moved');
  fs.writeFileSync(path.join(dir,'.gitignore'), IGNORE, {flag:'wx', mode:0o600});
  const code = crypto.randomBytes(16).toString('hex');
  const instruction = [
    '本轮工作准备好交给主人验收时，最后用文件写入工具创建下面的交回文件，原样写入一行指定内容。需要主人先做决定时请先提问，保留回执到实际交回时再写。',
    '交回文件：' + target,
    '文件内容：' + code,
    '此码仅用于本轮本机交回，请勿将它写入回复、日志或提交。主人另行验收。',
  ].join('\n');
  return {instruction, digest:digestFor(task, worktree, directory, code)};
}

// Return the time of a complete proof. A missing/partial file simply gets
// another chance on the normal board tick. No files are scanned or deleted.
function readReceipt(home, task) {
  if (!/^[a-f0-9]{64}$/.test(task.receiptDigest)) return null;
  let fd;
  try {
    const target = receiptPath(home, task);
    const file = fs.lstatSync(target, {throwIfNoEntry:false, bigint:true});
    if (!file?.isFile() || file.nlink !== 1n || file.size < 32n || file.size > 34n) return null;
    const worktree = checkWorktree(home, task);
    const directory = fs.lstatSync(path.dirname(target), {bigint:true});
    if (!directory.isDirectory() || !same(fs.realpathSync.native(target),
      path.join(fs.realpathSync.native(task.worktree), path.basename(path.dirname(target)), 'ready'))) return null;
    fd = fs.openSync(target, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0) | (fs.constants.O_NONBLOCK || 0));
    const opened = fs.fstatSync(fd, {bigint:true});
    if (!opened.isFile() || opened.nlink !== 1n || opened.dev !== file.dev || opened.ino !== file.ino || opened.size !== file.size) return null;
    const bytes = Buffer.alloc(35);
    const count = fs.readSync(fd, bytes, 0, bytes.length, 0);
    if (count !== Number(opened.size)) return null;
    const code = bytes.toString('latin1', 0, count).replace(/\r?\n$/, '');
    if (code.length !== 32 || !CODE.test(code) || digestFor(task, worktree, directory, code) !== task.receiptDigest) return null;
    return Number(opened.mtimeMs);
  } catch { return null; }
  finally { if (fd !== undefined) fs.closeSync(fd); }
}

module.exports = {prepareReceipt, readReceipt};
