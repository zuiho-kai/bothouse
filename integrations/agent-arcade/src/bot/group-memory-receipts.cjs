'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {atomicJSON} = require('../core/files.cjs');
const {clean} = require('./dispatcher.cjs');

const DAY = 86_400_000, MAX_PER_SCOPE = 64, MAX_ROWS = 2048, MAX_BYTES = 576 * 1024;
const SCOPE = /^[a-f0-9]{64}$/u, RECEIPT = /^-?\d{1,20}$/u;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;
const CORRECTION = /^这条改成[：:]([\s\S]*)$/u;
const SECRET = /(?:密[码碼]|口令|[验驗][证證][码碼]|身份[证證][号號]|[银銀]行卡[号號]|私[钥鑰]|[访訪][问問]令牌)\s*(?:(?:是|[为為]|[:：])\s*\S|\d{4,})/u;
const error = (kind,name) => Object.assign(new Error(`Group ${kind} receipt unavailable for this operation.`),
  {code:`group_${kind}_receipt_${name}`});
const matches = (value,format) => typeof value === 'string' && format.test(value);
const exact = (value,keys) => value && typeof value === 'object' && !Array.isArray(value) &&
  Object.keys(value).length === keys.length && keys.every(key=>Object.hasOwn(value,key));
const validTime = value => Number.isSafeInteger(value) && value >= 0;
const validRevision = value => Number.isSafeInteger(value) && value > 0;

function validRows(rows,target,legacy) {
  if (!Array.isArray(rows) || rows.length > MAX_ROWS) return false;
  const fields = ['scope','receipt',target,'at',...(legacy ? [] : ['revision'])];
  const counts = new Map(), identities = new Set();
  for (const row of rows) {
    if (!exact(row,fields) || !matches(row.scope,SCOPE) || !matches(row.receipt,RECEIPT) ||
        (row[target] !== null && !matches(row[target],UUID)) || !validTime(row.at)) return false;
    if (!legacy && !(row[target] === null ? row.revision === null : validRevision(row.revision))) return false;
    const key = `${row.scope}:${row.receipt}`, count = (counts.get(row.scope) || 0) + 1;
    if (count > MAX_PER_SCOPE || identities.has(key)) return false;
    counts.set(row.scope,count);
    identities.add(key);
  }
  return true;
}

function parseQuotedGroupMemoryCommand(rawText) {
  if (typeof rawText !== 'string') return null;
  const body = rawText.trim();
  if (body === '忘记这条') return {operation:'forget'};
  const correction = CORRECTION.exec(body);
  if (!correction && body !== '这条改成') return null;
  const text = correction?.[1].trim() || '';
  if (!text || text.length > 600 || !text.isWellFormed() ||
      /[\p{Cc}\u2028-\u202e\u2066-\u2069]/u.test(text) || clean(text,600) !== text || SECRET.test(text)) {
    return {operation:'correct',error:'text'};
  }
  return {operation:'correct',text};
}

/** Bounded receipt index for the exact group/member/account/role scope. */
class GroupRevisionReceipts {
  #collisionWriteFailed = false;
  #kind;
  #target;
  #retention;
  #peerFile;

  constructor(options = {},kind) {
    const maxAge = (kind === 'appointment' ? 367 : 7) * DAY;
    const {file,now = Date.now,retentionMs = maxAge} = options;
    if (typeof file !== 'string' || !path.isAbsolute(file) || typeof now !== 'function' ||
        !Number.isSafeInteger(retentionMs) || retentionMs < 1 || retentionMs > maxAge) throw error(kind,'invalid');
    this.#kind = kind;
    this.#target = kind === 'appointment' ? 'appointmentId' : 'factId';
    this.#retention = retentionMs;
    // Both receipt kinds share the bridge-native message ID namespace.
    this.#peerFile = options.peerFile ?? path.join(path.dirname(file),
      kind === 'memory' ? 'appointment-receipts.json' : 'memory-receipts.json');
    if (typeof this.#peerFile !== 'string' || !path.isAbsolute(this.#peerFile)) throw error(kind,'invalid');
    this.file = file;
    this.now = now;
  }

  #load(file = this.file,kind = this.#kind) {
    const target = kind === 'memory' ? 'factId' : 'appointmentId';
    const unavailable = () => error(this.#kind,'unavailable');
    let fd;
    try {
      const parent = fs.lstatSync(path.dirname(file));
      if (!parent.isDirectory()) throw unavailable();
      const before = fs.lstatSync(file);
      if (!before.isFile() || before.nlink !== 1 || before.size > MAX_BYTES) throw unavailable();
      fd = fs.openSync(file,fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
      const opened = fs.fstatSync(fd);
      if (!opened.isFile() || opened.nlink !== 1 || opened.dev !== before.dev || opened.ino !== before.ino ||
          opened.size > MAX_BYTES) throw unavailable();
      const bytes = Buffer.alloc(opened.size+1);
      const count = fs.readSync(fd,bytes,0,bytes.length,0);
      if (count !== opened.size) throw unavailable();
      const data = JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(0,count)));
      const memory = kind === 'memory';
      const header = memory ? exact(data,['schema','rows']) && [1,2].includes(data.schema) :
        exact(data,['schema','kind','rows']) && data.schema === 2 && data.kind === kind;
      if (!header || !validRows(data.rows,target,data.schema === 1)) throw unavailable();
      // Earlier development rows lack any proof of the displayed revision.
      return data.schema === 1 ? data.rows.map(row=>({...row,factId:null,revision:null})) : data.rows;
    } catch (cause) {
      if (cause?.code === 'ENOENT' && fd === undefined) return [];
      throw unavailable();
    } finally {
      if (fd !== undefined) fs.closeSync(fd);
    }
  }

  resolve(scope,receipt) {
    if (this.#collisionWriteFailed || !matches(scope,SCOPE) || !matches(receipt,RECEIPT)) return null;
    try {
      const now = this.now();
      if (!validTime(now)) return null;
      const peerKind = this.#kind === 'memory' ? 'appointment' : 'memory';
      // Even an expired peer row is evidence that this ID was not unambiguous.
      if (this.#load(this.#peerFile,peerKind).some(row=>row.scope === scope && row.receipt === receipt)) return null;
      const row = this.#load().find(row=>row.scope === scope && row.receipt === receipt);
      const id = row?.[this.#target];
      return id && row.at >= now-this.#retention && row.at <= now ? {[this.#target]:id,revision:row.revision} : null;
    } catch { return null; }
  }

  record(scope,receipt,id,revision) {
    const target = this.#target, kind = this.#kind;
    if (!matches(scope,SCOPE) || !matches(receipt,RECEIPT) || !matches(id,UUID) || !validRevision(revision)) throw error(kind,'invalid');
    if (this.#collisionWriteFailed) throw error(kind,'unavailable');
    const now = this.now();
    if (!validTime(now)) throw error(kind,'unavailable');
    const peerKind = kind === 'memory' ? 'appointment' : 'memory';
    const peerTarget = peerKind === 'memory' ? 'factId' : 'appointmentId';
    let rows = this.#load(), peerRows = this.#load(this.#peerFile,peerKind);
    const key = row => `${row.scope}:${row.receipt}`;
    const peers = new Map(peerRows.map(row=>[key(row),row]));
    const collisions = new Set(rows.filter(row=>peers.has(key(row))).map(key));
    // Repair pre-existing cross-kind overlap before any expiry/bound pruning.
    // Write the long-lived appointment side first. If the second write fails,
    // either the peer tombstone or the old overlap still rejects both quotes.
    const repairs = new Set(rows.filter(row=>collisions.has(key(row)) &&
      (row[target] !== null || peers.get(key(row))[peerTarget] !== null)).map(key));
    if (repairs.size) {
      rows = rows.map(row=>repairs.has(key(row)) ? {...row,[target]:null,revision:null,at:now} : row);
      peerRows = peerRows.map(row=>repairs.has(key(row)) ? {...row,[peerTarget]:null,revision:null,at:now} : row);
      try {
        if (kind === 'appointment') {
          this.#save(this.file,kind,rows);
          this.#save(this.#peerFile,peerKind,peerRows);
        } else {
          this.#save(this.#peerFile,peerKind,peerRows);
          this.#save(this.file,kind,rows);
        }
      } catch { this.#collisionWriteFailed = true; throw error(kind,'unavailable'); }
    }
    if (collisions.has(`${scope}:${receipt}`)) throw error(kind,'collision');
    const prior = rows.find(row=>row.scope === scope && row.receipt === receipt);
    const peer = peerRows.find(row=>row.scope === scope && row.receipt === receipt);
    if (peer) {
      // A new callback can collide with a different kind even if this kind has
      // no row yet. Persist the peer tombstone before the new local marker.
      const own = {scope,receipt,[target]:null,revision:null,at:now};
      const other = {...peer,[peerTarget]:null,revision:null,at:now};
      try {
        const peerNext = this.#bounded(peerRows,other,peerTarget,now,(peerKind === 'memory' ? 7 : 367)*DAY);
        this.#save(this.#peerFile,peerKind,peerNext);
        // Invalidating the existing binding must precede even the local bound
        // check: a full local index cannot leave the old quote executable.
        this.#save(this.file,kind,this.#bounded(rows,own,target,now,this.#retention));
      } catch { this.#collisionWriteFailed = true; throw error(kind,'unavailable'); }
      throw error(kind,'collision');
    }
    if (prior?.[target] === id && prior.revision === revision) return true;
    if (prior?.[target] === null) throw error(kind,'collision');
    const candidate = {scope,receipt,[target]:prior ? null : id,revision:prior ? null : revision,at:now};
    try {
      this.#save(this.file,kind,this.#bounded(rows,candidate,target,now,this.#retention));
    } catch {
      if (prior) this.#collisionWriteFailed = true;
      throw error(kind,'unavailable');
    }
    if (prior) throw error(kind,'collision');
    return true;
  }

  #save(file,kind,rows) {
    const state = {schema:2,...(kind === 'memory' ? {} : {kind}),rows};
    if (Buffer.byteLength(JSON.stringify(state,null,2)) > MAX_BYTES) throw error(this.#kind,'unavailable');
    atomicJSON(file,state);
  }

  #bounded(rows,candidate,target,now,retention) {
    const recent = rows.filter(row=>!(row.scope === candidate.scope && row.receipt === candidate.receipt) &&
      row.at >= now-(row[target] === null ? 367*DAY : retention));
    // A bound may evict ordinary links, but cannot erase live collision proof.
    const protectedRows = recent.filter(row=>row[target] === null);
    const next = [...protectedRows,candidate], counts = new Map();
    for (const row of next) counts.set(row.scope,(counts.get(row.scope) || 0)+1);
    if (next.length > MAX_ROWS || [...counts.values()].some(count=>count > MAX_PER_SCOPE)) {
      throw error(this.#kind,'unavailable');
    }
    for (let index=recent.length-1; index>=0 && next.length<MAX_ROWS; index--) {
      const row = recent[index];
      if (row[target] === null || (counts.get(row.scope) || 0) >= MAX_PER_SCOPE) continue;
      next.push(row);
      counts.set(row.scope,(counts.get(row.scope) || 0)+1);
    }
    const selected = new Set(next);
    return [...recent.filter(row=>selected.has(row)),candidate];
  }

}

class GroupMemoryReceipts extends GroupRevisionReceipts {
  constructor(options) { super(options,'memory'); }
}

module.exports = {GroupMemoryReceipts, GroupRevisionReceipts, parseQuotedGroupMemoryCommand};
