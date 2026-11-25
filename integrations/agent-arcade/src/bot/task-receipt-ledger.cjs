'use strict';
const crypto = require('node:crypto'), fs = require('node:fs'), path = require('node:path');
const {atomicJSON} = require('../core/files.cjs');
const {same, TASK_ID, branchName, COMMIT} = require('./task-worktree.cjs');

const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const JOB = /^[a-f0-9]{8,32}$/;
const HASH = /^[a-f0-9]{64}$/;
const MAX_ROUNDS = 440; // Previous and incoming board projections, each limited to 220 tasks.
const MAX_BYTES = 192 * 1024;

// RC14 retains these identifiers even when it rewrites the board. An
// unbound launch intent and its later bound session have distinct keys.
function scope(home, task) {
  if (!TASK_ID.test(task.id) || !UUID.test(task.launchId) || !COMMIT.test(task.baseCommit) ||
      !Number.isSafeInteger(task.floorAt) || task.floorAt <= 0 || !Number.isSafeInteger(task.createdAt) ||
      task.branch !== branchName(task.id) || !same(task.worktree, path.join(home, 'task-worktrees', task.id)) ||
      !((task.sessionId === '' && task.jobId === '') || (UUID.test(task.sessionId) && JOB.test(task.jobId)))) return '';
  try {
    const location = fs.realpathSync.native(task.worktree);
    if (!same(location, path.join(fs.realpathSync.native(home), 'task-worktrees', task.id))) return '';
    const dir = fs.lstatSync(task.worktree, {bigint:true});
    if (!dir.isDirectory()) return '';
    const identity = [task.id, task.createdAt, task.project, task.branch, task.baseCommit, task.worktree,
      task.floorAt, task.launchId, task.sessionId, task.jobId];
    const hash = parts => crypto.createHash('sha256').update(JSON.stringify(parts)).digest('hex');
    return {key:hash(identity), directory:hash([location, String(dir.dev), String(dir.ino)])};
  } catch { return ''; }
}

function project(home, tasks) {
  const records = new Map();
  for (const task of tasks) {
    if (!HASH.test(task.receiptDigest)) continue;
    const bound = scope(home, task);
    if (bound) records.set(bound.key, {directory:bound.directory, digest:task.receiptDigest, explicit:task.explicitHandback === true,
      spent:task.explicitHandback === true || (!!task.jobId && task.awaitingHandback === false)});
  }
  return records;
}

function combine(old, current) {
  // Saving an unrelated task must not rebind a proof to a replacement
  // directory that happens to occupy the old worktree path.
  if (old && old.directory !== current.directory) return old;
  if (old?.digest !== current.digest) return current;
  return {...current, explicit:old.explicit || current.explicit, spent:old.spent || current.spent};
}

function serialize(records) {
  return JSON.stringify({version:1, rounds:Object.fromEntries([...records].sort(([a],[b]) => a.localeCompare(b)))});
}

class ReceiptLedger {
  constructor({home}) {
    this.home = home;
    this.file = path.join(home, 'task-handback-proofs.json');
    this.saved = null;
    this.previous = new Map();
  }

  read() {
    if (this.saved) return this.saved;
    const stat = fs.lstatSync(this.file, {throwIfNoEntry:false});
    if (!stat) return this.saved = new Map();
    if (!stat.isFile() || stat.size > MAX_BYTES) throw Error('Unreadable handback proofs');
    const data = JSON.parse(fs.readFileSync(this.file,'utf8'));
    if (data?.version !== 1 || !data.rounds || typeof data.rounds !== 'object' ||
        Array.isArray(data.rounds) || Object.keys(data.rounds).length > MAX_ROUNDS) throw Error('Unreadable handback proofs');
    const records = new Map();
    for (const [key,row] of Object.entries(data.rounds)) {
      if (!HASH.test(key) || !row || !HASH.test(row.directory) || !HASH.test(row.digest) || typeof row.explicit !== 'boolean' ||
          typeof row.spent !== 'boolean' || (row.explicit && !row.spent)) continue;
      records.set(key, {directory:row.directory, digest:row.digest, explicit:row.explicit, spent:row.spent});
    }
    return this.saved = records;
  }

  restore(task, raw) {
    // An intact H22 row has its own evidence, including a deliberate empty
    // digest or a new round. Only fill the fields lost in an older rewrite.
    if (Object.hasOwn(raw,'receiptDigest') || Object.hasOwn(raw,'explicitHandback')) return;
    const bound = scope(this.home, task);
    if (!bound) return;
    let record;
    try { record = this.read().get(bound.key); } catch { return; }
    if (!record || record.directory !== bound.directory) return;
    task.receiptDigest = record.digest;
    if (record.spent) task.awaitingHandback = false;
    if (!record.explicit) return;
    task.explicitHandback = true;
    if (!task.report && !task.reportRaw && ['none','no_reply_text'].includes(task.reportStatus)) task.reportStatus = 'receipt';
  }

  checkpoint(tasks) {
    const current = project(this.home, tasks);
    let saved;
    try { saved = this.read(); } catch (error) {
      // A bad auxiliary file cannot block ordinary edits that introduce no
      // new protected facts. Never overwrite the damaged file with guesses.
      const addsProof = [...current].some(([key,row]) => {
        const prior = this.previous.get(key);
        return prior?.directory !== row.directory || prior.digest !== row.digest || (row.explicit && !prior.explicit) || (row.spent && !prior.spent);
      });
      if (!addsProof) return false;
      throw error;
    }
    const next = new Map(this.previous);
    for (const [key,row] of current) next.set(key, combine(next.get(key), row));
    for (const [key,row] of next) next.set(key, combine(saved.get(key), row));
    const bytes = serialize(next);
    if (bytes === serialize(saved)) return true;
    if (next.size > MAX_ROUNDS || Buffer.byteLength(bytes) > MAX_BYTES) throw Error('Handback proof limit exceeded');
    atomicJSON(this.file, JSON.parse(bytes));
    this.saved = next;
    return true;
  }

  // Drop obsolete rounds on a subsequent checkpoint, only after the primary
  // board has committed. A crash between the two writes leaves the previous
  // primary generation covered. An unmatched side record cannot create a task.
  committed(tasks) {
    this.previous = project(this.home, tasks);
  }
}

module.exports = {ReceiptLedger};
