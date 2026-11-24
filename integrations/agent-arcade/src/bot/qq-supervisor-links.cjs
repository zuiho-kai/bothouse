'use strict';
// Independent supervisor credentials and durable request IDs. No existing token is inherited.
const fs=require('node:fs'),path=require('node:path');
const {randomUUID,createHash}=require('node:crypto');
const P=require('./qq-supervisor-policy.cjs');
const R=require('./qq-supervisor-recovery-policy.cjs');
const L=require('./qq-supervisor-lock-policy.cjs');
const Q=require('./qq-supervisor-orphan-policy.cjs');
const {validateRemoteOrigin,validateRemoteTrust}=require('./qq-remote-transport.cjs');
const N=require('./qq-supervisor-native-passkey-policy.cjs'),B=require('./qq-supervisor-profile-backup-policy.cjs');
const C=require('./qq-supervisor-component-repair-policy.cjs');
const MAX_BYTES=2*1024*1024,MAX_ENTRIES=16;
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const clone=value=>structuredClone(value);
const fail=code=>{throw Object.assign(Error(`Supervisor links: ${code}`),{code});};
const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&Object.getPrototypeOf(v)===Object.prototype;
const exact=(v,keys)=>plain(v)&&Object.keys(v).every(k=>keys.includes(k));
const uuid=v=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(v);
const text=(v,min,max)=>typeof v==='string'&&v.length>=min&&v.length<=max&&v.trim()===v&&!/[\p{Cc}\p{Cf}\p{Cs}\u2028\u2029]/u.test(v);
const identity=s=>`${s.dev}:${s.ino}:${s.birthtimeNs??s.birthtimeMs}`;
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);

class QQSupervisorLinks {
 constructor({root,vault,validateOrigin=validateRemoteOrigin,validateTrust=validateRemoteTrust}={}){
  if(typeof root!=='string'||!path.isAbsolute(root)||typeof validateOrigin!=='function'||typeof validateTrust!=='function')fail('invalid_config');
  Object.assign(this,{root:path.resolve(root),vault,validateOrigin,validateTrust,state:'ready',entries:[],fingerprint:null,fileIdentity:null,rootIdentity:null,leases:new Map()});
  try{
   if(!fs.existsSync(this.root))fs.mkdirSync(this.root,{recursive:true,mode:0o700});
   const stat=fs.lstatSync(this.root,{bigint:true});if(!stat.isDirectory()||stat.isSymbolicLink())fail('unsafe_storage');
   this.root=fs.realpathSync(this.root);this.rootIdentity=identity(stat);this.file=path.join(this.root,'qq-supervisor-links.json');
   const observed=this._read();this.fingerprint=observed?hash(observed.bytes):null;this.fileIdentity=observed?.identity??null;
   if(observed){
    if(!vault?.isEncryptionAvailable())fail('credentials_locked');
    const envelope=JSON.parse(observed.bytes.toString('utf8'));
    if(!exact(envelope,['version','data'])||![1,2,3,4,5,6,7].includes(envelope.version)||typeof envelope.data!=='string'||!envelope.data||!/^[A-Za-z0-9+/]+={0,2}$/.test(envelope.data))fail('invalid_storage');
    const decrypted=vault.decryptString(Buffer.from(envelope.data,'base64'));
    if(typeof decrypted!=='string'||Buffer.byteLength(decrypted)>MAX_BYTES)fail('invalid_storage');
    const stored=JSON.parse(decrypted);
    if(!exact(stored,['version','entries'])||stored.version!==envelope.version||!Array.isArray(stored.entries))fail('invalid_storage');
    if(stored.version===1){for(const e of stored.entries){if(!plain(e)||!Array.isArray(e.history))fail('invalid_storage');if(e.pending!==null)e.pending=this._legacyPending(e.pending);e.history=e.history.map(h=>{if(!exact(h,['pending','operation','endedAt']))fail('invalid_storage');return {...h,pending:this._legacyPending(h.pending)};});}}
    if(stored.version<3&&stored.entries.some(e=>e?.pending?.kind==='component-lock'||e?.history?.some(h=>h?.pending?.kind==='component-lock')))fail('invalid_storage');
    if(stored.version<4&&stored.entries.some(e=>e?.pending?.kind==='orphan-cleanup'||e?.history?.some(h=>h?.pending?.kind==='orphan-cleanup')))fail('invalid_storage');
    if(stored.version<5&&stored.entries.some(e=>e?.pending?.kind==='native-passkey'||e?.history?.some(h=>h?.pending?.kind==='native-passkey')))fail('invalid_storage');
    if(stored.version<6&&stored.entries.some(e=>e?.pending?.kind==='profile-backup'||e?.history?.some(h=>h?.pending?.kind==='profile-backup')))fail('invalid_storage');
    if(stored.version<7&&stored.entries.some(e=>e?.pending?.kind==='component-repair'||e?.history?.some(h=>h?.pending?.kind==='component-repair')))fail('invalid_storage');
    this.entries=this._entries(stored.entries);
   }
  }catch{this.state='locked';this.entries=[];}
 }
 _entry(v){
  if(!exact(v,['supervisorId','remoteId','remoteRevision','label','origin','instanceId','revision','trustRevision','credentialRevision','trust','token','expectedQQ','pending','history'])||
   !['supervisorId','remoteId','remoteRevision','instanceId','revision','trustRevision','credentialRevision'].every(k=>uuid(v[k]))||!text(v.label,1,64)||! /^[1-9][0-9]{4,11}$/.test(v.expectedQQ)||!this._pending(v.pending)||!Array.isArray(v.history)||v.history.length>16||!v.history.every(x=>this._history(x))||typeof v.token!=='string'||! /^[A-Za-z0-9_-]{43,256}$/.test(v.token))fail('invalid_registration');
  if(v.pending?.kind==='orphan-cleanup'&&v.pending.accountId!==v.expectedQQ||v.history.some(h=>h.pending.kind==='orphan-cleanup'&&h.pending.accountId!==v.expectedQQ))fail('invalid_registration');
  const origin=this.validateOrigin(v.origin),trust=this.validateTrust(v.trust);
  if(origin!==v.origin)fail('invalid_registration');return {...clone(v),origin,trust:clone(trust)};
 }
 _legacyPending(v){if(!exact(v,['requestId','action','phase','createdAt','ledgerId','observationId','terminal']))fail('invalid_storage');const p={...v,kind:'process'};if(!this._pending(p))fail('invalid_storage');return p;}
 _pending(v){if(v===null)return true;if(!plain(v)||!['process','pending-update','component-lock','orphan-cleanup','native-passkey','profile-backup','component-repair'].includes(v.kind)||!uuid(v.requestId)||!uuid(v.ledgerId)||!['prepared','attempted'].includes(v.phase)||!Number.isSafeInteger(v.createdAt)||v.createdAt<=0)return false;const base=['kind','requestId','action','phase','createdAt','ledgerId','terminal'];if(v.kind==='process'){if(!exact(v,[...base,'observationId'])||!uuid(v.observationId)||!['start','stop','recover'].includes(v.action))return false;}else if(v.kind==='component-repair'){try{if(!exact(v,[...base,'operationId','ticketId','expectedDigest']))return false;C.request({requestId:v.requestId,action:v.action,operationId:v.operationId,ticketId:v.ticketId,expectedDigest:v.expectedDigest});}catch{return false;}}else if(v.kind==='profile-backup'){try{if(!exact(v,[...base,'backupId','sha256','currentSha256','ticketId','expectedDigest']))return false;B.request({requestId:v.requestId,action:v.action,backupId:v.backupId,sha256:v.sha256,currentSha256:v.currentSha256,ticketId:v.ticketId,expectedDigest:v.expectedDigest});}catch{return false;}}else if(v.kind==='native-passkey'){try{if(!exact(v,[...base,'recordId','origin','ticketId','expectedDigest']))return false;N.origin(v.origin);N.request({requestId:v.requestId,action:v.action,recordId:v.recordId,ticketId:v.ticketId,expectedDigest:v.expectedDigest});}catch{return false;}}else if(v.kind==='orphan-cleanup'){if(!exact(v,[...base,'accountId','ticketId','expectedDigest'])||! /^[1-9][0-9]{4,11}$/.test(v.accountId)||!['terminate','settle','settle-resources'].includes(v.action)||!uuid(v.ticketId)||!R.HEX.test(v.expectedDigest))return false;}else if(!exact(v,[...base,'recordId','ticketId','expectedDigest'])||!(v.kind==='pending-update'?['disable','reconcile']:['clear-installation','clear-recovery-guard']).includes(v.action)||!R.HEX.test(v.recordId)||!uuid(v.ticketId)||!R.HEX.test(v.expectedDigest))return false;return v.terminal===null||this._terminal(v.terminal,v);}
 _terminal(v,p){try{if(p.kind==='process')P.operation(v);else if(p.kind==='component-repair')C.operation(v);else if(p.kind==='profile-backup')B.operation(v);else if(p.kind==='native-passkey')N.operation(v);else if(p.kind==='pending-update')R.operation(v);else if(p.kind==='orphan-cleanup')Q.operation(v,p.accountId);else L.operation(v);return v.phase==='unknown'&&v.finishedAt!==null&&v.requestId===p.requestId&&v.action===p.action&&(p.kind!=='native-passkey'||v.origin===p.origin)&&(p.kind==='component-repair'?v.operationId===p.operationId:p.kind==='profile-backup'?v.backupId===p.backupId:p.kind==='process'||p.kind==='orphan-cleanup'||v.recordId===p.recordId);}catch{return false;}}
 _history(v){return exact(v,['pending','operation','endedAt'])&&this._pending(v.pending)&&this._terminal(v.operation,v.pending)&&Number.isSafeInteger(v.endedAt)&&v.endedAt>0;}
 _entries(values){
  if(values.length>MAX_ENTRIES)fail('registration_limit');const entries=values.map(v=>this._entry(v));
  if(['supervisorId','remoteId','origin','instanceId'].some(k=>new Set(entries.map(v=>v[k])).size!==entries.length))fail('supervisor_registered');
  return entries;
 }
 _read(){
  const root=fs.lstatSync(this.root,{bigint:true});if(!root.isDirectory()||root.isSymbolicLink()||identity(root)!==this.rootIdentity)fail('unsafe_storage');
  let before;try{before=fs.lstatSync(this.file,{bigint:true});}catch(e){if(e.code==='ENOENT')return null;throw e;}
  if(!before.isFile()||before.isSymbolicLink()||before.nlink!==1n||before.size>BigInt(MAX_BYTES))fail('unsafe_storage');
  let fd;try{
   fd=fs.openSync(this.file,'r');const own=fs.fstatSync(fd,{bigint:true});
   if(!own.isFile()||identity(own)!==identity(before)||own.size!==before.size||own.nlink!==1n)fail('unsafe_storage');
   const bytes=Buffer.alloc(Number(own.size)+1);let n=0;
   while(n<bytes.length){const count=fs.readSync(fd,bytes,n,bytes.length-n,null);if(!count)break;n+=count;}
   const after=fs.lstatSync(this.file,{bigint:true}),end=fs.fstatSync(fd,{bigint:true});
   if(n!==Number(own.size)||[after,end].some(s=>!s.isFile()||s.isSymbolicLink()||identity(s)!==identity(own)||s.nlink!==1n||s.size!==own.size||s.mtimeNs!==own.mtimeNs))fail('unsafe_storage');
   return {bytes:bytes.subarray(0,n),identity:identity(own)};
  }finally{if(fd!==undefined)fs.closeSync(fd);}
 }
 _current(){
  if(this.state!=='ready')fail('credentials_locked');
  try{const read=this._read();if((read?hash(read.bytes):null)!==this.fingerprint||(read?.identity??null)!==this.fileIdentity)throw Error();}
  catch{this.state='locked';this.entries=[];fail('credentials_locked');}
 }
 _find(supervisorId){this._current();if(!uuid(supervisorId))fail('invalid_request');const e=this.entries.find(v=>v.supervisorId===supervisorId);if(!e)fail('supervisor_not_found');return e;}
 _match(supervisorId,revision){const e=this._find(supervisorId);if(e.revision!==revision)fail('registration_changed');return e;}
 _public(e){const {token,trust,pending,history,...rest}=e;const safePending=pending?{kind:pending.kind,requestId:pending.requestId,action:pending.action,...['pending-update','component-lock','native-passkey'].includes(pending.kind)?{recordId:pending.recordId}:{},...pending.kind==='native-passkey'?{origin:pending.origin}:{},...pending.kind==='profile-backup'?{backupId:pending.backupId}:{},...pending.kind==='component-repair'?{operationId:pending.operationId}:{},phase:pending.phase,createdAt:pending.createdAt,ledgerId:pending.ledgerId,canEndRecovery:pending.terminal!==null}:null;return {...clone(rest),pending:safePending,historyCount:history.length,trust:{privateCA:!!trust.caPem,spkiSha256:trust.spkiSha256||null},credentialState:'saved'};}
 snapshot(){try{this._current();return {state:'ready',items:this.entries.map(e=>this._public(e))};}catch{return {state:'locked',items:[]};}}
 list(){return this.snapshot();}
 capture(supervisorId){return clone(this._find(supervisorId));}
 _commit(values){
  this._current();const entries=this._entries(values);if(!this.vault?.isEncryptionAvailable())fail('encryption_unavailable');
  let bytes;try{
   const encrypted=this.vault.encryptString(JSON.stringify({version:7,entries}));if(!Buffer.isBuffer(encrypted)||!encrypted.length)throw Error();
   bytes=Buffer.from(JSON.stringify({version:7,data:encrypted.toString('base64')}));if(bytes.length>MAX_BYTES)fail('storage_limit');
  }catch(e){if(e.code==='storage_limit')throw e;fail('encryption_unavailable');}
  const fingerprint=hash(bytes),staged=path.join(this.root,`.qq-supervisor-links-${randomUUID()}.pending`);let owned=null,observed;
  try{
   this._current();const fd=fs.openSync(staged,'wx',0o600);
   try{owned=identity(fs.fstatSync(fd,{bigint:true}));fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
   this._current();const check=fs.lstatSync(staged,{bigint:true});if(!check.isFile()||check.isSymbolicLink()||check.nlink!==1n||identity(check)!==owned)fail('unsafe_storage');
   fs.renameSync(staged,this.file);observed=this._read();if(!observed||observed.identity!==owned||hash(observed.bytes)!==fingerprint)throw Error();
  }catch{
   // A lost rename result is accepted only after exact owned-file readback.
   try{observed=this._read();}catch{}
   if(!observed||observed.identity!==owned||hash(observed.bytes)!==fingerprint){this.state='locked';this.entries=[];fail('storage_write_unknown');}
  }finally{
   if(owned)try{const s=fs.lstatSync(staged,{bigint:true});if(s.isFile()&&!s.isSymbolicLink()&&s.nlink===1n&&identity(s)===owned)fs.unlinkSync(staged);}catch{}
  }
  this.entries=entries;this.fingerprint=fingerprint;this.fileIdentity=observed.identity;
 }
 create(input){
  if(!exact(input,['remoteId','remoteRevision','label','origin','instanceId','trust','token','expectedQQ']))fail('invalid_request');this._current();
  const entry=this._entry({...input,pending:null,history:[],origin:this.validateOrigin(input.origin),supervisorId:randomUUID(),revision:randomUUID(),trustRevision:randomUUID(),credentialRevision:randomUUID()});
  this._commit([...this.entries,entry]);return this._public(entry);
 }
 replace(input){
  if(!exact(input,['supervisorId','revision','patch'])||!exact(input.patch,['remoteRevision','label','origin','instanceId','trust','token','expectedQQ'])||!Object.keys(input.patch).length)fail('invalid_request');
  const old=this._match(input.supervisorId,input.revision);if(this.leases.has(old.supervisorId))fail('operation_in_progress');if(old.pending)fail('operation_unresolved');
  const next=this._entry({...old,...input.patch,...('origin'in input.patch?{origin:this.validateOrigin(input.patch.origin)}:{}),revision:randomUUID(),trustRevision:('trust'in input.patch||'origin'in input.patch)?randomUUID():old.trustRevision,credentialRevision:'token'in input.patch?randomUUID():old.credentialRevision});
  this._commit(this.entries.map(v=>v.supervisorId===old.supervisorId?next:v));return this._public(next);
 }
 forget(input){
  if(!exact(input,['supervisorId','revision']))fail('invalid_request');const old=this._match(input.supervisorId,input.revision);if(this.leases.has(old.supervisorId))fail('operation_in_progress');if(old.pending)fail('operation_unresolved');
  this._commit(this.entries.filter(v=>v.supervisorId!==old.supervisorId));return {forgotten:true};
 }
 setPending(supervisorId,revision,pending){
  // Legacy main-only process callers are normalized; stored v3 is always typed.
  if(pending!==null&&!Object.hasOwn(pending,'kind'))pending=this._legacyPending(pending);
  const entry=this._match(supervisorId,revision);if(!this._pending(pending)||pending?.kind==='orphan-cleanup'&&pending.accountId!==entry.expectedQQ)fail('invalid_request');
  if(entry.pending&&pending){const fixed=v=>{const {phase,terminal,...rest}=v;return rest;};if(!equal(fixed(entry.pending),fixed(pending))||entry.pending.phase==='attempted'&&pending.phase!=='attempted')fail('operation_unresolved');}
  this._commit(this.entries.map(v=>v.supervisorId===supervisorId?{...v,pending:clone(pending)}:v));return this._public(this._find(supervisorId));
 }
 endRecovery(supervisorId,revision,requestId,endedAt){
  const e=this._match(supervisorId,revision);if(this.leases.has(supervisorId))fail('operation_in_progress');
  if(!e.pending||e.pending.requestId!==requestId||!this._terminal(e.pending.terminal,e.pending))fail('operation_unresolved');if(e.history.length>=16)fail('history_limit');
  const history=[...e.history,{pending:clone(e.pending),operation:clone(e.pending.terminal),endedAt}];
  this._commit(this.entries.map(v=>v.supervisorId===supervisorId?{...v,pending:null,history}:v));return {ended:true,requestId,historyCount:history.length};
 }
 async withOperation(input,operation){
  if(!exact(input,['supervisorId','revision'])||typeof operation!=='function')fail('invalid_request');const entry=this._match(input.supervisorId,input.revision),id=entry.supervisorId;
  if(this.leases.has(id))fail('operation_in_progress');const key={};this.leases.set(id,key);
  const assertCurrent=()=>{if(this.leases.get(id)!==key)fail('operation_closed');const next=this._match(id,entry.revision);const withoutPending=v=>{const {pending,...rest}=v;return rest;};if(!equal(withoutPending(next),withoutPending(entry)))fail('registration_changed');return next;};
  try{return await operation({assertCurrent,capture:()=>clone(assertCurrent())});}finally{if(this.leases.get(id)===key)this.leases.delete(id);}
 }
}
module.exports={QQSupervisorLinks,MAX_ENTRIES};
