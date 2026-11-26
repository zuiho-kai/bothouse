'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');

const MAX_RECORDS = 10000;
const STATES = new Set(['received', 'queued', 'running', 'waiting_permission', 'waiting_question',
  'cancelling', 'reply_ended', 'error', 'limit', 'cancelled', 'command_handled', 'rejected',
  'forwarded_unverified', 'interrupted_unknown', 'skipped']);
const INCOMPLETE = ['received', 'queued', 'running', 'waiting_permission', 'waiting_question', 'cancelling', 'forwarded_unverified'];
const digest = value => createHash('sha256').update(value).digest('hex');
const storageError = () => Object.assign(new Error('Durable message storage is unavailable. New dispatch is paused.'), { code: 'journal_unavailable' });
const DELIVERY_FIELDS = ['version','planned','attempted','accepted','unknown','inFlight','unattemptedAtCancel','inFlightAtCancel'];
function deliveryMetadata(task) {
  const value=task.bubbleDelivery;
  if(value===undefined||task.local===true)return null;
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==DELIVERY_FIELDS.length||
      Object.keys(value).some(key=>!DELIVERY_FIELDS.includes(key))||value.version!==1||
      typeof task.id!=='string'||!task.id||task.id.length>180)throw storageError();
  const {planned,attempted,accepted,unknown,inFlight,unattemptedAtCancel,inFlightAtCancel}=value;
  if(![planned,attempted,accepted,unknown].every(n=>Number.isInteger(n)&&n>=0&&n<=4)||
      !Number.isInteger(inFlight)||inFlight<0||inFlight>1||attempted>planned||accepted+unknown+inFlight!==attempted||
      (unattemptedAtCancel===null)!==(inFlightAtCancel===null)||
      (unattemptedAtCancel!==null&&(!Number.isInteger(unattemptedAtCancel)||unattemptedAtCancel!==planned-attempted||
        !Number.isInteger(inFlightAtCancel)||inFlightAtCancel<0||inFlightAtCancel>1||inFlightAtCancel>attempted)))throw storageError();
  return {taskId:task.id,...value};
}

// Short, synchronous transactions contain metadata only. No transcript, cursor,
// credentials, context tokens, tool arguments or approval codes are persisted.
// Opening/closing per operation also avoids a long-lived Windows file lock.
class MessageJournal {
  constructor({ root, now = Date.now, loadSqlite = () => require('node:sqlite') } = {}) {
    this.file = path.toNamespacedPath(path.join(root, 'bot-recovery.sqlite')); this.now = now;
    this.available = false; this.pendingExpired = 0; this.lastPending = 0;
    this.lastStates = new Map(); this.lastDeliveries = new Map(); this.cache = { interrupted: 0, recent: [], companionDelivery: [] };
    try {
      this.DatabaseSync = loadSqlite().DatabaseSync;
      fs.mkdirSync(root, { recursive: true });
      this.withDb(db => {
        db.exec(`CREATE TABLE IF NOT EXISTS inbound (
          id TEXT PRIMARY KEY, mode TEXT NOT NULL, state TEXT NOT NULL,
          created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, task_id TEXT);
          CREATE INDEX IF NOT EXISTS inbound_task ON inbound(task_id);
          CREATE TABLE IF NOT EXISTS channel_delivery (
            id TEXT PRIMARY KEY, state TEXT NOT NULL CHECK(state IN ('attempted','accepted','unknown','not_submitted')),
            created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
          CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value INTEGER NOT NULL);
          CREATE TABLE IF NOT EXISTS companion_delivery (
            task_id TEXT PRIMARY KEY CHECK(length(task_id) BETWEEN 1 AND 180),
            planned INTEGER NOT NULL CHECK(planned BETWEEN 0 AND 4), attempted INTEGER NOT NULL CHECK(attempted BETWEEN 0 AND 4),
            accepted INTEGER NOT NULL CHECK(accepted BETWEEN 0 AND 4), unknown INTEGER NOT NULL CHECK(unknown BETWEEN 0 AND 4),
            in_flight INTEGER NOT NULL CHECK(in_flight BETWEEN 0 AND 1),
            cancel_unattempted INTEGER, cancel_in_flight INTEGER,
            created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
            CHECK(attempted<=planned AND accepted+unknown+in_flight=attempted),
            CHECK((cancel_unattempted IS NULL AND cancel_in_flight IS NULL) OR
              (cancel_unattempted IS NOT NULL AND cancel_in_flight IS NOT NULL AND cancel_unattempted=planned-attempted AND
               cancel_in_flight BETWEEN 0 AND 1 AND cancel_in_flight<=attempted)));`);
        this.pendingExpired = db.prepare("SELECT value FROM metadata WHERE key='pending_requests'").get()?.value || 0;
        db.prepare("INSERT OR REPLACE INTO metadata(key,value) VALUES('pending_requests',0)").run();
        db.prepare(`UPDATE inbound SET state='interrupted_unknown',updated_at=? WHERE state IN (${INCOMPLETE.map(() => '?').join(',')})`).run(now(), ...INCOMPLETE);
        // No interrupted send is relabelled accepted or available to replay.
        db.prepare('UPDATE companion_delivery SET unknown=unknown+in_flight,in_flight=0,updated_at=? WHERE in_flight>0').run(now());
        db.prepare("UPDATE channel_delivery SET state='unknown',updated_at=? WHERE state='attempted'").run(now());
        this.pruneDelivery(db,now());
        this.refresh(db);
      }, true);
      this.available = true;
    } catch { this.available = false; }
  }
  withDb(fn, initializing = false) {
    if (!initializing && !this.available) throw storageError();
    let db;
    try {
      db = new this.DatabaseSync(this.file, { allowExtension: false });
      db.exec('PRAGMA busy_timeout=1000; PRAGMA trusted_schema=OFF; PRAGMA synchronous=FULL; BEGIN IMMEDIATE;');
      const result = fn(db); db.exec('COMMIT'); return result;
    } catch { this.available = false; throw storageError(); }
    finally { if (db) { try { db.close(); } catch { /* The operation already failed closed. */ } } }
  }
  key(ownerId, id) {
    if (typeof ownerId !== 'string' || !ownerId || ownerId.length > 256 ||
        !['number', 'string'].includes(typeof id) || !String(id) || String(id).length > 180) throw storageError();
    return digest(JSON.stringify([ownerId, String(id)]));
  }
  refresh(db) {
    this.cache = {
      interrupted: db.prepare("SELECT count(*) AS count FROM inbound WHERE state='interrupted_unknown'").get().count,
      recent: db.prepare('SELECT substr(id,1,12) AS id,mode,state,updated_at AS updatedAt FROM inbound ORDER BY updated_at DESC,rowid DESC LIMIT 10').all().map(row => ({ ...row })),
      channelDelivery: db.prepare('SELECT substr(id,1,12) AS id,state,updated_at AS updatedAt FROM channel_delivery ORDER BY updated_at DESC,rowid DESC LIMIT 10').all().map(row=>({...row})),
      companionDelivery: db.prepare('SELECT task_id,planned,attempted,accepted,unknown,in_flight AS inFlight,cancel_unattempted AS unattemptedAtCancel,cancel_in_flight AS inFlightAtCancel,updated_at AS updatedAt FROM companion_delivery ORDER BY updated_at DESC,rowid DESC LIMIT 10').all().map(({task_id,...row})=>({taskHash:digest(task_id),...row}))
    };
  }
  pruneDelivery(db,now) {
    db.prepare('DELETE FROM companion_delivery WHERE updated_at<? OR NOT EXISTS (SELECT 1 FROM inbound WHERE inbound.task_id=companion_delivery.task_id)').run(now-30*86400000);
  }
  claim(ownerId, id, mode) {
    if (!['api', 'native', 'claude', 'codex', 'deepseek', 'gpt', 'gemini', 'doubao'].includes(mode)) throw storageError();
    const key = this.key(ownerId, id), now = this.now();
    return this.withDb(db => {
      if (db.prepare('SELECT 1 FROM inbound WHERE id=?').get(key)) return false;
      // Fail closed at the bound. Prune only records outside the documented
      // 30-day retention; do not silently forget current IDs and replay them.
      db.prepare('DELETE FROM inbound WHERE updated_at < ?').run(now - 30 * 86400000);
      this.pruneDelivery(db,now);
      if (db.prepare('SELECT count(*) AS count FROM inbound').get().count >= MAX_RECORDS) throw storageError();
      db.prepare('INSERT INTO inbound(id,mode,state,created_at,updated_at) VALUES(?,?,\'received\',?,?)').run(key, mode, now, now);
      this.refresh(db); return true;
    });
  }
  // Relay acknowledgements require an all-or-nothing durable batch before any
  // dispatch. Return internal IDs only; message bodies never enter this store.
  claimBatch(ownerId,ids,mode){
    if(!['api','native','claude','codex','deepseek','gpt','gemini','doubao'].includes(mode)||!Array.isArray(ids)||ids.length<1||ids.length>50||new Set(ids).size!==ids.length)throw storageError();
    const keys=ids.map(id=>this.key(ownerId,id)),now=this.now();
    return this.withDb(db=>{
      db.prepare('DELETE FROM inbound WHERE updated_at<?').run(now-30*86400000);this.pruneDelivery(db,now);
      const fresh=keys.map((key,index)=>({key,id:ids[index]})).filter(row=>!db.prepare('SELECT 1 FROM inbound WHERE id=?').get(row.key));
      if(db.prepare('SELECT count(*) AS count FROM inbound').get().count+fresh.length>MAX_RECORDS)throw storageError();
      const insert=db.prepare("INSERT INTO inbound(id,mode,state,created_at,updated_at) VALUES(?,?,'received',?,?)");
      for(const row of fresh)insert.run(row.key,mode,now,now);
      this.refresh(db);return {claimedIds:[...ids],newIds:fresh.map(row=>row.id)};
    });
  }
  // An application-level send attempt is recorded before transport preflight;
  // it is not a claim that HTTP POST occurred. Only a verified API receipt is
  // accepted. A crash during preflight/submission stays conservatively unknown.
  attemptDelivery(ownerId,id){
    const key=this.key(ownerId,id),now=this.now();
    this.withDb(db=>{
      db.prepare('DELETE FROM channel_delivery WHERE updated_at<?').run(now-30*86400000);
      if(db.prepare('SELECT count(*) AS count FROM channel_delivery').get().count>=MAX_RECORDS)throw storageError();
      db.prepare("INSERT INTO channel_delivery(id,state,created_at,updated_at) VALUES(?,'attempted',?,?)").run(key,now,now);this.refresh(db);
    });
  }
  completeDelivery(ownerId,id,state){
    if(!['accepted','unknown','not_submitted'].includes(state))throw storageError();
    const key=this.key(ownerId,id);
    this.withDb(db=>{
      const old=db.prepare('SELECT state FROM channel_delivery WHERE id=?').get(key);
      if(!old||old.state!=='attempted'&&old.state!==state)throw storageError();
      db.prepare('UPDATE channel_delivery SET state=?,updated_at=? WHERE id=?').run(state,this.now(),key);this.refresh(db);
    });
  }
  disposition(ownerId, id, state, taskId = null) {
    if (!STATES.has(state) || (taskId !== null && (typeof taskId !== 'string' || taskId.length > 180))) throw storageError();
    this.withDb(db => {
      db.prepare('UPDATE inbound SET state=?,task_id=?,updated_at=? WHERE id=?').run(state, taskId, this.now(), this.key(ownerId, id));
      this.refresh(db);
    });
  }
  observe(snapshot = {}) {
    const tasks=Array.isArray(snapshot.tasks)?snapshot.tasks:[];
    const deliveries=tasks.map(deliveryMetadata).filter(row=>row&&this.lastDeliveries.get(row.taskId)!==JSON.stringify(row));
    const changes = tasks.filter(task =>
      typeof task.id === 'string' && STATES.has(task.state) && this.lastStates.get(task.id) !== task.state);
    const pending = Math.min(8, Array.isArray(snapshot.pending) ? snapshot.pending.length : 0);
    if (!changes.length && !deliveries.length && pending === this.lastPending) return;
    const persisted=[];
    this.withDb(db => {
      for (const task of changes) db.prepare('UPDATE inbound SET state=?,updated_at=? WHERE task_id=?').run(task.state, this.now(), task.id);
      this.pruneDelivery(db,this.now());
      for(const row of deliveries){
        // Only a companion task actually bound to durable channel input gets a
        // record. Local voice and unlinked/old snapshots cannot create orphans.
        if(!db.prepare('SELECT 1 FROM inbound WHERE task_id=?').get(row.taskId))continue;
        const old=db.prepare('SELECT * FROM companion_delivery WHERE task_id=?').get(row.taskId);
        if(old&&(row.planned!==old.planned||row.attempted<old.attempted||row.accepted<old.accepted||row.unknown<old.unknown||
          (old.cancel_unattempted!==null&&(row.unattemptedAtCancel!==old.cancel_unattempted||row.inFlightAtCancel!==old.cancel_in_flight))))throw storageError();
        if(!old&&db.prepare('SELECT count(*) AS count FROM companion_delivery').get().count>=MAX_RECORDS)throw storageError();
        const now=this.now();
        db.prepare(`INSERT INTO companion_delivery(task_id,planned,attempted,accepted,unknown,in_flight,cancel_unattempted,cancel_in_flight,created_at,updated_at)
          VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(task_id) DO UPDATE SET planned=excluded.planned,attempted=excluded.attempted,
          accepted=excluded.accepted,unknown=excluded.unknown,in_flight=excluded.in_flight,cancel_unattempted=excluded.cancel_unattempted,
          cancel_in_flight=excluded.cancel_in_flight,updated_at=excluded.updated_at`).run(row.taskId,row.planned,row.attempted,row.accepted,row.unknown,row.inFlight,row.unattemptedAtCancel,row.inFlightAtCancel,now,now);
        persisted.push(row);
      }
      db.prepare("INSERT OR REPLACE INTO metadata(key,value) VALUES('pending_requests',?)").run(pending);
      this.refresh(db);
    });
    for (const task of changes) this.lastStates.set(task.id, task.state);
    for(const row of persisted)this.lastDeliveries.set(row.taskId,JSON.stringify(row));
    if (this.lastStates.size > 200) this.lastStates = new Map([...this.lastStates].slice(-100));
    if(this.lastDeliveries.size>200)this.lastDeliveries=new Map([...this.lastDeliveries].slice(-100));
    this.lastPending = pending;
  }
  snapshot() {
    return { storage: this.available ? 'sqlite' : 'unavailable', available: this.available,
      ...this.cache, pendingExpired: this.pendingExpired,
      problem: this.available ? '' : 'Local recovery storage is unavailable. Reopen the app or check its data folder before starting new tasks.' };
  }
  clear() {
    this.withDb(db => { db.exec('DELETE FROM inbound; DELETE FROM metadata; DELETE FROM companion_delivery; DELETE FROM channel_delivery;'); this.refresh(db); });
    this.lastStates.clear(); this.lastDeliveries.clear(); this.pendingExpired = 0; this.lastPending = 0;
  }
}
module.exports = { MessageJournal, MAX_RECORDS };
