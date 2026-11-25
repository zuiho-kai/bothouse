'use strict';
// Local encrypted plans and durable occurrence admission. This store never
// contacts QCE, replays a claimed occurrence, or deletes an exported file.
const fs=require('node:fs'),path=require('node:path');
const {DatabaseSync}=require('node:sqlite');
const {randomUUID}=require('node:crypto');
const P=require('./qq-qce-export-policy.cjs');
const {validateDefinition}=require('./qq-qce-schedule-policy.cjs');
const MAX_PLANS=16,MAX_RUNS=128,MAX_PAYLOAD=32768,MAX_DB=8*1024*1024;
const CODES=new Set(['qce_schedules_locked','qce_schedules_changed','qce_schedules_limit','qce_schedules_unknown','qce_schedule_not_found','invalid_request','closed']);
const fail=code=>{throw Object.assign(Error(`QCE schedule records: ${code}`),{code});};
const equalPath=(a,b)=>process.platform==='win32'?a.toLowerCase()===b.toLowerCase():a===b;
const identity=s=>`${s.dev}:${s.ino}:${s.birthtimeNs}`;
const epoch=v=>Number.isSafeInteger(v)&&v>=0&&v<=4102444800000;
function scope(value,full=false){
 if(!P.plain(value))fail('invalid_request');
 const keys=['accountId','qqAccountId','workScope'];
 if(Object.keys(value).some(k=>![...keys,'credentialRevision'].includes(k))||keys.some(k=>!Object.hasOwn(value,k))||!P.profileId(value.accountId)||!P.qq(value.qqAccountId)||!/^[a-f0-9]{64}$/.test(value.workScope)||full&&!P.uuid(value.credentialRevision)||value.credentialRevision!==undefined&&value.credentialRevision!==null&&!P.uuid(value.credentialRevision))fail('invalid_request');
 return Object.fromEntries((full?[...keys,'credentialRevision']:keys).map(k=>[k,value[k]]));
}
const sameScope=(a,b,full=false)=>Object.keys(scope(a,full)).every(k=>a[k]===b[k]);
function planRecord(v){
 P.exact(v,['version','scheduleId','revision','scope','definition','enabled','nextAt','lastScheduledAt','createdAt','updatedAt']);
 if(v.version!==1||!P.uuid(v.scheduleId)||!P.uuid(v.revision)||typeof v.enabled!=='boolean'||(v.nextAt!==null&&!epoch(v.nextAt))||(v.lastScheduledAt!==null&&!epoch(v.lastScheduledAt))||!epoch(v.createdAt)||!epoch(v.updatedAt)||v.updatedAt<v.createdAt||v.enabled!==(v.nextAt!==null)||v.enabled&&v.lastScheduledAt!==null&&v.nextAt<=v.lastScheduledAt)fail('invalid_request');
 const s=scope(v.scope,true);if(Object.keys(v.scope).length!==4)fail('invalid_request');
 const definition=validateDefinition(v.definition);
 const result={...v,scope:s,definition};if(Buffer.byteLength(JSON.stringify(result))>MAX_PAYLOAD)fail('invalid_request');return structuredClone(result);
}
function runRecord(v){
 P.exact(v,['version','runId','revision','scheduleId','scope','kind','scheduledAt','slotKey','operationId','outcome','code','createdAt','updatedAt']);
 if(v.version!==1||![v.runId,v.revision,v.scheduleId,v.operationId].every(P.uuid)||!['manual','scheduled'].includes(v.kind)||!epoch(v.scheduledAt)||!P.text(v.slotKey,1024)||!v.slotKey||!['claimed','accepted','unknown','not_submitted'].includes(v.outcome)||v.code!==null&&(typeof v.code!=='string'||!/^[a-z][a-z0-9_]{0,79}$/.test(v.code))||!epoch(v.createdAt)||!epoch(v.updatedAt)||v.updatedAt<v.createdAt||v.outcome==='claimed'&&v.code!==null)fail('invalid_request');
 const s=scope(v.scope,true);if(Object.keys(v.scope).length!==4)fail('invalid_request');return structuredClone({...v,scope:s});
}
function folders(value){
 if(typeof value!=='string'||!path.isAbsolute(value)||/^[/\\]{2}/.test(value)||value.length>2048)fail('invalid_request');
 const target=path.resolve(value),proof=[];let current=path.parse(target).root;
 for(const part of target.slice(current.length).split(path.sep).filter(Boolean)){
  current=path.join(current,part);try{fs.mkdirSync(current,{mode:0o700});}catch(e){if(e.code!=='EEXIST')throw e;}
  const s=fs.lstatSync(current,{bigint:true});if(!s.isDirectory()||s.isSymbolicLink()||!equalPath(fs.realpathSync(current),current))fail('qce_schedules_locked');proof.push({path:current,id:identity(s)});
 }
 return {target,proof};
}
class QCEScheduleStore{
 constructor({root,vault,now=Date.now}={}){
  Object.assign(this,{vault,now,db:null,closed:false,state:'ready'});
  try{
   const f=folders(root);this.root=f.target;this.parents=f.proof;this.file=path.join(this.root,'qce-schedules.sqlite');this._files();
   this.db=new DatabaseSync(this.file,{timeout:1000,allowExtension:false});if(![0,1].includes(this.db.prepare('PRAGMA user_version').get().user_version))fail('qce_schedules_locked');
   this.db.exec('PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; PRAGMA max_page_count=2048;');if(this.db.prepare('PRAGMA page_size').get().page_size!==4096)fail('qce_schedules_locked');
   this.db.exec('CREATE TABLE IF NOT EXISTS plans(id TEXT PRIMARY KEY,revision TEXT NOT NULL,payload BLOB NOT NULL); CREATE TABLE IF NOT EXISTS runs(id TEXT PRIMARY KEY,revision TEXT NOT NULL,payload BLOB NOT NULL); PRAGMA user_version=1;');
   this.identity=identity(fs.lstatSync(this.file,{bigint:true}));
   for(const [table,max]of [['plans',MAX_PLANS],['runs',MAX_RUNS]]){if(this.db.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n>max)fail('qce_schedules_locked');for(const row of this.db.prepare(`SELECT * FROM ${table}`).all())this._decode(table,row);}
  }catch{this.state='locked';try{this.db?.close();}catch{}this.db=null;}
 }
 _files(){
  for(const p of this.parents){const s=fs.lstatSync(p.path,{bigint:true});if(!s.isDirectory()||s.isSymbolicLink()||identity(s)!==p.id||!equalPath(fs.realpathSync(p.path),p.path))fail('qce_schedules_locked');}
  for(const suffix of ['','-journal','-wal','-shm']){let s;const file=this.file+suffix;try{s=fs.lstatSync(file,{bigint:true});}catch(e){if(e.code==='ENOENT'&&(suffix||!this.identity))continue;throw e;}if(!s.isFile()||s.isSymbolicLink()||s.nlink!==1n||s.size>BigInt(MAX_DB)||!equalPath(fs.realpathSync(file),file)||!suffix&&this.identity&&identity(s)!==this.identity)fail('qce_schedules_locked');}
 }
 _ready(){if(this.closed)fail('closed');if(this.state!=='ready'||!this.db)fail('qce_schedules_locked');try{this._files();}catch{this.state='locked';fail('qce_schedules_locked');}}
 _decode(table,row){try{
  if(!P.uuid(row?.id)||!P.uuid(row?.revision)||!(row.payload instanceof Uint8Array)||row.payload.length>MAX_PAYLOAD*2||!this.vault?.isEncryptionAvailable())throw Error();
  const text=this.vault.decryptString(Buffer.from(row.payload));if(typeof text!=='string'||Buffer.byteLength(text)>MAX_PAYLOAD)throw Error();
  const v=(table==='plans'?planRecord:runRecord)(JSON.parse(text));if(v[table==='plans'?'scheduleId':'runId']!==row.id||v.revision!==row.revision)throw Error();return v;
 }catch{this.state='locked';fail('qce_schedules_locked');}}
 _encode(table,value){try{
  if(!this.vault?.isEncryptionAvailable())throw Error();const v=(table==='plans'?planRecord:runRecord)(value),bytes=this.vault.encryptString(JSON.stringify(v));if(!Buffer.isBuffer(bytes)||!bytes.length||bytes.length>MAX_PAYLOAD*2)throw Error();return bytes;
 }catch(e){if(e.code==='invalid_request')throw e;fail('qce_schedules_locked');}}
 _tx(fn){this._ready();try{this.db.exec('BEGIN IMMEDIATE');const value=fn();this.db.exec('COMMIT');return value;}catch(e){try{this.db.exec('ROLLBACK');}catch{}if(CODES.has(e?.code))throw e;fail('qce_schedules_unknown');}}
 _rows(table){this._ready();return this.db.prepare(`SELECT * FROM ${table}`).all().map(r=>this._decode(table,r));}
 _row(table,id){this._ready();if(!P.uuid(id))fail('invalid_request');const row=this.db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(id);if(!row)fail('qce_schedule_not_found');return this._decode(table,row);}
 _update(table,value,revision){const id=value[table==='plans'?'scheduleId':'runId'],payload=this._encode(table,value);if(this.db.prepare(`UPDATE ${table} SET revision=?,payload=? WHERE id=? AND revision=?`).run(value.revision,payload,id,revision).changes!==1)fail('qce_schedules_changed');return value;}
 _owned(value,id,revision,full=false){const s=scope(value,full),p=this._row('plans',id);if(!sameScope(p.scope,s,full)||revision!==undefined&&revision!==p.revision)fail('qce_schedules_changed');return p;}
 _time(old=0){const now=Math.max(this.now(),old);if(!epoch(now))fail('invalid_request');return now;}
 _check(table,value){const read=this._row(table,value[table==='plans'?'scheduleId':'runId']);if(JSON.stringify(read)!==JSON.stringify(value))fail('qce_schedules_unknown');return read;}
 list(value){const s=scope(value);return this._rows('plans').filter(p=>sameScope(p.scope,s)).sort((a,b)=>b.createdAt-a.createdAt);}
 get(value,id){return this._owned(value,id);}
 allEnabled(){return this._rows('plans').filter(p=>p.enabled);}
 create(value,definition){
  const s=scope(value,true),now=this._time(),p=planRecord({version:1,scheduleId:randomUUID(),revision:randomUUID(),scope:s,definition,enabled:false,nextAt:null,lastScheduledAt:null,createdAt:now,updatedAt:now}),payload=this._encode('plans',p);
  this._tx(()=>{if(this.db.prepare('SELECT COUNT(*) n FROM plans').get().n>=MAX_PLANS)fail('qce_schedules_limit');this.db.prepare('INSERT INTO plans VALUES(?,?,?)').run(p.scheduleId,p.revision,payload);});return this._check('plans',p);
 }
 update(value,id,revision,definition){
  const p=this._tx(()=>{const old=this._owned(value,id,revision,true);return this._update('plans',planRecord({...old,revision:randomUUID(),definition,enabled:false,nextAt:null,updatedAt:this._time(old.updatedAt)}),revision);});return this._check('plans',p);
 }
 setEnabled(value,id,revision,enabled,nextAt){
  if(typeof enabled!=='boolean'||(enabled?!epoch(nextAt):nextAt!==null))fail('invalid_request');
  const p=this._tx(()=>{const old=this._owned(value,id,revision,enabled);if(enabled&&(nextAt<=this.now()||old.lastScheduledAt!==null&&nextAt<=old.lastScheduledAt))fail('qce_schedules_changed');return this._update('plans',planRecord({...old,revision:randomUUID(),enabled,nextAt,updatedAt:this._time(old.updatedAt)}),revision);});return this._check('plans',p);
 }
 remove(value,id,revision){this._tx(()=>{this._owned(value,id,revision);if(this.db.prepare('DELETE FROM plans WHERE id=? AND revision=?').run(id,revision).changes!==1)fail('qce_schedules_changed');});if(this.db.prepare('SELECT id FROM plans WHERE id=?').get(id))fail('qce_schedules_unknown');return {removed:true,remoteTaskCancelled:false,filesDeleted:false};}
 advance(value,id,revision,input){
  P.exact(input,['nextAt','scheduledAt']);if(input.nextAt!==null&&(!epoch(input.nextAt)||input.nextAt<=input.scheduledAt)||!epoch(input.scheduledAt))fail('invalid_request');
  const p=this._tx(()=>{const old=this._owned(value,id,revision,true);if(!old.enabled||input.scheduledAt<old.nextAt||old.lastScheduledAt!==null&&input.scheduledAt<=old.lastScheduledAt)fail('qce_schedules_changed');return this._update('plans',planRecord({...old,revision:randomUUID(),enabled:input.nextAt!==null,nextAt:input.nextAt,lastScheduledAt:input.scheduledAt,updatedAt:this._time(old.updatedAt)}),revision);});return this._check('plans',p);
 }
 claim(value,id,revision,input){
  P.exact(input,['kind','scheduledAt','slotKey','nextAt','operationId']);if(!['scheduled','manual'].includes(input.kind)||!epoch(input.scheduledAt)||!P.text(input.slotKey,1024)||!input.slotKey||!P.uuid(input.operationId)||input.kind==='scheduled'&&input.nextAt!==null&&(!epoch(input.nextAt)||input.nextAt<=input.scheduledAt)||input.kind==='manual'&&input.nextAt!==null)fail('invalid_request');
  const result=this._tx(()=>{
   const old=this._owned(value,id,revision,true),runs=this._rows('runs');if(runs.length>=MAX_RUNS)fail('qce_schedules_limit');
   if(runs.some(r=>r.operationId===input.operationId||r.scheduleId===id&&r.kind===input.kind&&r.slotKey===input.slotKey))fail('qce_schedules_changed');
   if(input.kind==='scheduled'&&(!old.enabled||old.nextAt!==input.scheduledAt||old.lastScheduledAt!==null&&input.scheduledAt<=old.lastScheduledAt))fail('qce_schedules_changed');
   const now=this._time(),run=runRecord({version:1,runId:randomUUID(),revision:randomUUID(),scheduleId:id,scope:old.scope,kind:input.kind,scheduledAt:input.scheduledAt,slotKey:input.slotKey,operationId:input.operationId,outcome:'claimed',code:null,createdAt:now,updatedAt:now});
   this.db.prepare('INSERT INTO runs VALUES(?,?,?)').run(run.runId,run.revision,this._encode('runs',run));
   const plan=this._update('plans',planRecord({...old,revision:randomUUID(),...(input.kind==='scheduled'?{enabled:input.nextAt!==null,nextAt:input.nextAt,lastScheduledAt:input.scheduledAt}:{}),updatedAt:this._time(old.updatedAt)}),revision);
   return {plan,run};
  });return {plan:this._check('plans',result.plan),run:this._check('runs',result.run)};
 }
 done(value,id,revision,input){
  const s=scope(value,true);P.exact(input,['outcome','code']);if(!['accepted','unknown','not_submitted'].includes(input.outcome))fail('invalid_request');
  const r=this._tx(()=>{const old=this._row('runs',id);if(!sameScope(old.scope,s,true)||old.revision!==revision||old.outcome!=='claimed')fail('qce_schedules_changed');return this._update('runs',runRecord({...old,...input,revision:randomUUID(),updatedAt:this._time(old.updatedAt)}),revision);});return this._check('runs',r);
 }
 runs(value,scheduleId){const s=scope(value);if(scheduleId!==undefined&&!P.uuid(scheduleId))fail('invalid_request');return this._rows('runs').filter(r=>sameScope(r.scope,s)&&(!scheduleId||r.scheduleId===scheduleId)).sort((a,b)=>b.createdAt-a.createdAt);}
 // Main's runner must synchronously reject its active run before invoking this
 // explicit local action. An interrupted claim is never interpreted as unsent.
 settleInterrupted(value,id,revision){const s=scope(value);const r=this._tx(()=>{const old=this._row('runs',id);if(!sameScope(old.scope,s)||old.revision!==revision||old.outcome!=='claimed')fail('qce_schedules_changed');return this._update('runs',runRecord({...old,revision:randomUUID(),outcome:'unknown',code:'interrupted',updatedAt:this._time(old.updatedAt)}),revision);});return this._check('runs',r);}
 forgetRun(value,id,revision){const s=scope(value);this._tx(()=>{const r=this._row('runs',id);if(!sameScope(r.scope,s)||r.revision!==revision||r.outcome==='claimed')fail('qce_schedules_changed');if(this.db.prepare('DELETE FROM runs WHERE id=? AND revision=?').run(id,revision).changes!==1)fail('qce_schedules_changed');});return {forgotten:true,remoteTaskCancelled:false,filesDeleted:false};}
 close(){if(this.closed)return {closed:true};try{this.db?.close();this.db=null;this.closed=true;return {closed:true};}catch{fail('qce_schedules_unknown');}}
}
module.exports={QCEScheduleStore,scope,planRecord,runRecord,MAX_PLANS,MAX_RUNS,CODES};
