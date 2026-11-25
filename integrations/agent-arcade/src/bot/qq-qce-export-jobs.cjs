'use strict';
// Main-only export ownership. No requests, task adoption, replay or file deletion.
const fs=require('node:fs'),path=require('node:path');
const {DatabaseSync}=require('node:sqlite');
const {randomUUID,createHash}=require('node:crypto');
const P=require('./qq-qce-policy.cjs');
const MAX_JOBS=64,MAX_PAYLOAD=32768,MAX_DB=8*1024*1024;
const CODES=new Set(['qce_jobs_locked','qce_jobs_changed','qce_jobs_limit','qce_jobs_unknown','qce_job_not_found','invalid_request','closed']);
const fail=code=>{throw Object.assign(Error(`QCE export records: ${code}`),{code});};
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const equalPath=(a,b)=>process.platform==='win32'?a.toLowerCase()===b.toLowerCase():a===b;
const id=s=>`${s.dev}:${s.ino}:${s.birthtimeNs}`;
const HEX=/^[a-f0-9]{64}$/;
function scope(value){
 P.exact(value,['accountId','qqAccountId','workScope','credentialRevision',...(Object.hasOwn(value||{},'pluginVersion')?['pluginVersion']:[])]);if(Object.hasOwn(value,'pluginVersion')&&value.pluginVersion!=='6.4.2')fail('invalid_request');
 if(!P.profileId(value.accountId)||!P.qq(value.qqAccountId)||!HEX.test(value.workScope)||!P.uuid(value.credentialRevision))fail('invalid_request');
 return {...value};
}
const sameLocalScope=(a,b)=>['accountId','qqAccountId','workScope'].every(k=>a[k]===b[k]);
function bounded(value){
 const pending=[[value,0]],seen=new Set();let n=0;
 while(pending.length){const [v,d]=pending.pop();if(++n>256||d>8)fail('invalid_request');
  if(v===null||typeof v==='boolean')continue;
  if(typeof v==='string'){if(v.length>4096||/[\p{Cc}\p{Cf}\p{Cs}]/u.test(v))fail('invalid_request');continue;}
  if(typeof v==='number'){if(!Number.isSafeInteger(v))fail('invalid_request');continue;}
  if(!Array.isArray(v)&&!P.plain(v)||seen.has(v))fail('invalid_request');seen.add(v);
  for(const k of Object.keys(v)){if(['__proto__','prototype','constructor','token','credential','password','secret','apiKey'].includes(k)||!Object.hasOwn(Object.getOwnPropertyDescriptor(v,k),'value'))fail('invalid_request');pending.push([v[k],d+1]);}
 }
}
function fileName(value){
 if(!P.text(value,240)||Buffer.byteLength(value)>240||value!==value.trim()||/[. ]$/.test(value)||/[\\/<>:"|?*]/.test(value)||/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(value)||!/^.+\.(json|txt|html|xlsx|zip)$/i.test(value))fail('invalid_request');return value;
}
function request(value){
 P.exact(value,['peer','format','filter','options']);bounded(value);
 P.exact(value.peer,['chatType','peerUid']);if(![1,2].includes(value.peer.chatType)||!P.text(value.peer.peerUid,128))fail('invalid_request');
 if(!['JSON','TXT','HTML','EXCEL'].includes(value.format))fail('invalid_request');
 P.exact(value.filter,['startTime','endTime']);for(const k of ['startTime','endTime'])if(!Number.isSafeInteger(value.filter[k])||value.filter[k]<0||value.filter[k]>8640000000000000)fail('invalid_request');if(value.filter.endTime<value.filter.startTime)fail('invalid_request');
 const o=value.options;P.exact(o,['outputDir','batchSize','includeResourceLinks','includeSystemMessages','preferGroupMemberName','prettyFormat','embedAvatarsAsBase64','useNameInFileName','useFriendlyFileName','skipDownloadResourceTypes','filterPureImageMessages','exportAsZip']);
 P.directory(o.outputDir);if(o.outputDir===null||o.batchSize!==100||o.includeResourceLinks!==true||o.prettyFormat!==true||o.embedAvatarsAsBase64!==false||o.useNameInFileName!==false||o.useFriendlyFileName!==false)fail('invalid_request');
 for(const k of ['includeSystemMessages','preferGroupMemberName','filterPureImageMessages','exportAsZip'])if(typeof o[k]!=='boolean')fail('invalid_request');
 if(!Array.isArray(o.skipDownloadResourceTypes)||o.skipDownloadResourceTypes.length>4||new Set(o.skipDownloadResourceTypes).size!==o.skipDownloadResourceTypes.length||o.skipDownloadResourceTypes.some(t=>!['image','video','audio','file'].includes(t))||o.filterPureImageMessages!==(o.skipDownloadResourceTypes.length===4)||o.exportAsZip&&value.format!=='HTML')fail('invalid_request');return value;
}
function record(v){
 P.exact(v,['version','operationId','revision','scope','request','requestDigest','outputDir','taskId','fileName','submission','createdAt','updatedAt']);
 if(v.version!==1||!P.uuid(v.operationId)||!P.uuid(v.revision)||!['prepared','attempted','acknowledged','unknown','not_submitted'].includes(v.submission))fail('invalid_request');
 scope(v.scope);request(v.request);if(!HEX.test(v.requestDigest)||digest(v.request)!==v.requestDigest)fail('invalid_request');
 P.directory(v.outputDir);if(v.outputDir===null||v.request.options?.outputDir!==v.outputDir)fail('invalid_request');
 if(!equalPath(path.win32.normalize(v.outputDir),path.win32.join(path.win32.dirname(path.win32.dirname(v.outputDir)),'agent-arcade-exports',v.operationId)))fail('invalid_request');
 if(v.taskId!==null&&!(typeof v.taskId==='string'&&/^export_[0-9]{13}_[a-z0-9]{1,9}$/.test(v.taskId)))fail('invalid_request');
 if(v.fileName!==null)fileName(v.fileName);
 if((v.submission==='acknowledged')!==(v.taskId!==null)||(v.taskId!==null)!==(v.fileName!==null))fail('invalid_request');
 if(!Number.isSafeInteger(v.createdAt)||v.createdAt<0||!Number.isSafeInteger(v.updatedAt)||v.updatedAt<v.createdAt||Buffer.byteLength(JSON.stringify(v))>MAX_PAYLOAD)fail('invalid_request');
 return structuredClone(v);
}
function folders(value){
 if(typeof value!=='string'||!path.isAbsolute(value)||/^[/\\]{2}/.test(value)||value.length>2048)fail('invalid_request');
 const target=path.resolve(value),proof=[];let current=path.parse(target).root;
 for(const part of target.slice(current.length).split(path.sep).filter(Boolean)){
  current=path.join(current,part);try{fs.mkdirSync(current,{mode:0o700});}catch(e){if(e.code!=='EEXIST')throw e;}
  const s=fs.lstatSync(current,{bigint:true});if(!s.isDirectory()||s.isSymbolicLink()||!equalPath(fs.realpathSync(current),current))fail('qce_jobs_locked');proof.push({path:current,id:id(s)});
 }
 return {target,proof};
}
class QCEExportJobs {
 constructor({root,vault,now=Date.now}={}){
  this.vault=vault;this.now=now;this.db=null;this.closed=false;this.state='ready';
  try{
   const f=folders(root);this.root=f.target;this.parents=f.proof;this.file=path.join(this.root,'qce-export-jobs.sqlite');this._files();
   this.db=new DatabaseSync(this.file,{timeout:1000,allowExtension:false});const version=this.db.prepare('PRAGMA user_version').get().user_version;if(![0,1].includes(version))fail('qce_jobs_locked');
   this.db.exec('PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; PRAGMA max_page_count=2048;');if(this.db.prepare('PRAGMA page_size').get().page_size!==4096)fail('qce_jobs_locked');
   this.db.exec('CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY,revision TEXT NOT NULL,payload BLOB NOT NULL); PRAGMA user_version=1;');
   this.identity=id(fs.lstatSync(this.file,{bigint:true}));if(this.db.prepare('SELECT COUNT(*) n FROM jobs').get().n>MAX_JOBS)fail('qce_jobs_locked');
   for(const row of this.db.prepare('SELECT * FROM jobs').all())this._decode(row);
  }catch{this.state='locked';try{this.db?.close();}catch{}this.db=null;}
 }
 _files(){
  for(const p of this.parents){const s=fs.lstatSync(p.path,{bigint:true});if(!s.isDirectory()||s.isSymbolicLink()||id(s)!==p.id||!equalPath(fs.realpathSync(p.path),p.path))fail('qce_jobs_locked');}
  for(const suffix of ['','-journal','-wal','-shm']){const file=this.file+suffix;let s;try{s=fs.lstatSync(file,{bigint:true});}catch(e){if(e.code==='ENOENT'&&(suffix||!this.identity))continue;throw e;}
   if(!s.isFile()||s.isSymbolicLink()||s.nlink!==1n||s.size>BigInt(MAX_DB)||!equalPath(fs.realpathSync(file),file)||!suffix&&this.identity&&id(s)!==this.identity)fail('qce_jobs_locked');}
 }
 _ready(){if(this.closed)fail('closed');if(this.state!=='ready'||!this.db)fail('qce_jobs_locked');try{this._files();}catch{this.state='locked';fail('qce_jobs_locked');}}
 _decode(row){try{if(!P.uuid(row?.id)||!P.uuid(row?.revision)||!(row.payload instanceof Uint8Array)||row.payload.length>MAX_PAYLOAD*2||!this.vault?.isEncryptionAvailable())fail('qce_jobs_locked');const raw=this.vault.decryptString(Buffer.from(row.payload));if(typeof raw!=='string'||Buffer.byteLength(raw)>MAX_PAYLOAD)fail('qce_jobs_locked');const v=record(JSON.parse(raw));if(v.operationId!==row.id||v.revision!==row.revision)fail('qce_jobs_locked');return v;}catch{fail('qce_jobs_locked');}}
 _encode(v){try{if(!this.vault?.isEncryptionAvailable())fail('qce_jobs_locked');const b=this.vault.encryptString(JSON.stringify(record(v)));if(!Buffer.isBuffer(b)||!b.length||b.length>MAX_PAYLOAD*2)fail('qce_jobs_locked');return b;}catch{fail('qce_jobs_locked');}}
 _tx(fn){this._ready();try{this.db.exec('BEGIN IMMEDIATE');const v=fn();this.db.exec('COMMIT');return v;}catch(e){try{this.db.exec('ROLLBACK');}catch{}if(CODES.has(e?.code))throw e;fail('qce_jobs_unknown');}}
 _row(operationId){this._ready();if(!P.uuid(operationId))fail('invalid_request');const raw=this.db.prepare('SELECT * FROM jobs WHERE id=?').get(operationId);if(!raw)fail('qce_job_not_found');try{return this._decode(raw);}catch{this.state='locked';fail('qce_jobs_locked');}}
 get(value,operationId){const s=scope(value),v=this._row(operationId);if(digest(v.scope)!==digest(s))fail('qce_jobs_changed');return v;}
 list(value){const s=scope(value);this._ready();try{return this.db.prepare('SELECT * FROM jobs').all().map(r=>this._decode(r)).filter(v=>sameLocalScope(v.scope,s)).sort((a,b)=>b.createdAt-a.createdAt);}catch{this.state='locked';fail('qce_jobs_locked');}}
 begin(value,input){
  const s=scope(value);P.exact(input,['operationId','request','outputDir']);request(input.request);const now=this.now();
  const v=record({version:1,...input,scope:s,requestDigest:digest(input.request),revision:randomUUID(),taskId:null,fileName:null,submission:'prepared',createdAt:now,updatedAt:now}),payload=this._encode(v);
  this._tx(()=>{if(this.db.prepare('SELECT COUNT(*) n FROM jobs').get().n>=MAX_JOBS)fail('qce_jobs_limit');if(this.db.prepare('SELECT id FROM jobs WHERE id=?').get(v.operationId))fail('qce_jobs_changed');this.db.prepare('INSERT INTO jobs VALUES(?,?,?)').run(v.operationId,v.revision,payload);});
  const actual=this.get(s,v.operationId);if(JSON.stringify(actual)!==JSON.stringify(v))fail('qce_jobs_unknown');return actual;
 }
 change(value,operationId,revision,submission,taskId=null,name=null){
  const old=this.get(value,operationId);if(old.revision!==revision)fail('qce_jobs_changed');
  const allowed={prepared:['attempted','not_submitted'],attempted:['acknowledged','unknown','not_submitted'],unknown:['acknowledged']};
  if(!allowed[old.submission]?.includes(submission))fail('invalid_request');
  const v=record({...old,revision:randomUUID(),submission,taskId,fileName:name,updatedAt:Math.max(this.now(),old.updatedAt)}),payload=this._encode(v);
  this._tx(()=>{if(this.db.prepare('UPDATE jobs SET revision=?,payload=? WHERE id=? AND revision=?').run(v.revision,payload,operationId,revision).changes!==1)fail('qce_jobs_changed');});
  const actual=this.get(value,operationId);if(actual.revision!==v.revision)fail('qce_jobs_unknown');return actual;
 }
 forget(value,operationId,revision){const s=scope(value),old=this._row(operationId);if(!sameLocalScope(old.scope,s)||old.revision!==revision)fail('qce_jobs_changed');this._tx(()=>{if(this.db.prepare('DELETE FROM jobs WHERE id=? AND revision=?').run(operationId,revision).changes!==1)fail('qce_jobs_changed');});if(this.db.prepare('SELECT id FROM jobs WHERE id=?').get(operationId))fail('qce_jobs_unknown');return {forgotten:true,remoteTaskCancelled:false,filesDeleted:false};}
 close(){if(this.closed)return {closed:true};try{this.db?.close();this.closed=true;this.db=null;return {closed:true};}catch{fail('qce_jobs_unknown');}}
}
module.exports={QCEExportJobs,scope,record,request,fileName,digest,MAX_JOBS,MAX_PAYLOAD,CODES};
