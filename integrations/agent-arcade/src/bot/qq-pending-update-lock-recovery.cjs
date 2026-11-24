'use strict';
// Narrow dead-owner lock recovery. It never starts/stops a process or changes a plan.
const fs=require('node:fs'),path=require('node:path'),net=require('node:net');
const {createHash,randomUUID}=require('node:crypto');
const {gateEndpoint}=require('./qq-component-lock-recovery.cjs');
const {QQPendingUpdateRecovery}=require('./qq-pending-update-recovery.cjs');
const LIMITS=Object.freeze({maxRecords:2,maxLockBytes:4096,previewTtlMs:300000});
const CODES=new Set(['pending_lock_unsupported','pending_lock_missing','pending_lock_changed','pending_lock_unsafe','pending_lock_busy','pending_lock_guard_required','pending_lock_owner_alive','pending_lock_owner_changed','pending_lock_owner_unverified','pending_lock_expired','pending_lock_preview_required','pending_lock_unconfirmed','pending_lock_cleanup_unconfirmed','pending_lock_failed','invalid_request','cancelled','changed','manager_closing','component_missing','component_changed','component_io_failed','manifest_invalid','prepared_invalid','package_not_staged','artifact_changed','selection_invalid','selection_changed','qq_component_changed','managed_installation_changed','invalid_installation','unsafe_path','runtime_locked','operation_in_progress','process_check_failed','desktop_running','runtime_running','recovery_in_progress','recovery_gate_unavailable','recovery_gate_lost','pending_update_unsafe','pending_update_changed','pending_update_recovery_required','pending_update_unconfirmed','pending_update_history_full','pending_update_cleanup_unconfirmed']);
const HEX=/^[a-f0-9]{64}$/,UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const hash=v=>createHash('sha256').update(v).digest('hex'),equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const code=e=>CODES.has(e?.code)?e.code:e?.code==='pending_update_missing'?'pending_lock_missing':'pending_lock_failed';
class QQPendingUpdateLockRecoveryError extends Error{constructor(c){super(`Pending update lock recovery failed (${CODES.has(c)?c:'pending_lock_failed'}).`);this.code=CODES.has(c)?c:'pending_lock_failed';}}
const fail=c=>{throw new QQPendingUpdateLockRecoveryError(c);};
const nodeId=s=>({dev:String(s.dev),ino:String(s.ino),birth:String(s.birthtimeNs)});
const identity=s=>({...nodeId(s),size:String(s.size),mtime:String(s.mtimeNs),ctime:String(s.ctimeNs),links:String(s.nlink)});
const owner=v=>v&&Number.isSafeInteger(v.pid)&&v.pid>0&&typeof v.createdAt==='string'&&v.createdAt.length<=64&&Number.isFinite(Date.parse(v.createdAt))&&typeof v.executable==='string'&&path.isAbsolute(v.executable)&&!/^[/\\]{2}/.test(v.executable)&&!/[\0\r\n]/.test(v.executable);
const sameOwner=(a,b)=>owner(a)&&owner(b)&&a.pid===b.pid&&a.createdAt===b.createdAt&&path.resolve(a.executable).toLowerCase()===path.resolve(b.executable).toLowerCase();
// Compare the full serialized timestamp without truncating fractions to JS ms.
// CIM provides microseconds; its .NET round-trip representation has seven digits.
// Strict calendar/offset validation is required before a later identity can prove
// that the recorded process ended. Ambiguous or equal timestamps never do so.
function creationTicks(value){
 const m=typeof value==='string'&&/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,7}))?(Z|[+-]\d{2}:\d{2})$/.exec(value);if(!m)return null;
 const [year,month,day,hour,minute,second]=m.slice(1,7).map(Number),leap=year%4===0&&(year%100!==0||year%400===0),days=[31,leap?29:28,31,30,31,30,31,31,30,31,30,31];
 if(year<1||month<1||month>12||day<1||day>days[month-1]||hour>23||minute>59||second>59)return null;
 if(m[8]!=='Z'){const h=Number(m[8].slice(1,3)),n=Number(m[8].slice(4));if(h>14||n>59||h===14&&n!==0)return null;}
 const whole=Date.parse(m[1]+'-'+m[2]+'-'+m[3]+'T'+m[4]+':'+m[5]+':'+m[6]+m[8]);if(!Number.isSafeInteger(whole))return null;
 return BigInt(whole)*10000n+BigInt((m[7]||'').padEnd(7,'0'));
}
const completeOwner=v=>owner(v)&&/^[a-z]:[\\/]/i.test(v.executable)&&!/[\x00-\x1f]/.test(v.executable)&&creationTicks(v.createdAt)!==null;
const effects=()=>({scope:'declared-installation',mayAffectOtherAccounts:true,clearsOnlySelectedLock:true,updateRecordsChanged:false,accountRecordsChanged:false,automaticStart:false,automaticStop:false,rollsBackCode:false});
class QQPendingUpdateLockRecovery{
 constructor({selection,processHost,now=Date.now,monotonic=()=>performance.now(),io=fs,createServer=(...args)=>net.createServer(...args)}={}){
  if(typeof selection?.withPendingUpdateLockRecoveryProof!=='function'||!HEX.test(selection.installationId)||typeof processHost?.snapshot!=='function'||typeof processHost?.inspect!=='function'||typeof now!=='function'||typeof monotonic!=='function'||typeof createServer!=='function')fail('invalid_request');
  Object.assign(this,{selection,host:processHost,now,monotonic,io,createServer,ticket:null,epoch:0,closed:false,active:null,closing:null});this.fds=new Set();this.gates=new Set();this.guards=new Set();
  // Existing journal parsing is reused through exact owned handles. Its numeric
  // retry IDs cannot close a new object after an ambiguous close/reused fd.
  const pendingOwners=new Map(),pendingIO=Object.create(io);
  pendingIO.openSync=(...args)=>{const r={fd:io.openSync(...args),proof:null};this.fds.add(r);pendingOwners.set(r.fd,r);try{r.proof=nodeId(io.fstatSync(r.fd,{bigint:true}));}catch(e){this._closeFD(r,true);throw e;}return r.fd;};
  pendingIO.closeSync=fd=>{const r=pendingOwners.get(fd);if(!r)fail('pending_lock_cleanup_unconfirmed');this._closeFD(r);};
  this.pending=new QQPendingUpdateRecovery({selection,io:pendingIO});
 }
 _file(kind){return kind==='installation'?this.selection.lockFile:`${this.selection.lockFile}.recover`;}
 _id(kind){return hash(`${this.selection.installationId}\0pending-update-lock\0${kind}`);}
 _check(options={},epoch,deadline){if(this.closed)fail('manager_closing');if(options.signal?.aborted)fail('cancelled');if(options.assertCurrent!==undefined&&typeof options.assertCurrent!=='function')fail('invalid_request');const value=options.assertCurrent?.();if(value?.then){value.catch?.(()=>{});fail('invalid_request');}if(epoch!==undefined&&epoch!==this.epoch)fail('changed');if(deadline!==undefined&&this.monotonic()>=deadline)fail('pending_lock_expired');}
 _exists(file){try{this.io.lstatSync(file,{bigint:true});return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}}
 _safe(file,{directory=false,max=LIMITS.maxLockBytes}={}){
  if(typeof file!=='string'||!path.isAbsolute(file)||/^[/\\]{2}/.test(file)||/[\0\r\n]/.test(file))fail('pending_lock_unsafe');const resolved=path.resolve(file),parents=[];let cursor=resolved,stat;
  for(;;){const s=this.io.lstatSync(cursor,{bigint:true});if(s.isSymbolicLink()||(cursor===resolved?(directory?!s.isDirectory():!s.isFile()||s.nlink!==1n||s.size>BigInt(max)):!s.isDirectory()))fail('pending_lock_unsafe');if(cursor===resolved)stat=s;else parents.push({path:cursor,identity:nodeId(s)});const next=path.dirname(cursor);if(next===cursor)break;cursor=next;}
  if(path.resolve(this.io.realpathSync(resolved)).toLowerCase()!==resolved.toLowerCase())fail('pending_lock_unsafe');return {stat,parents};
 }
 _closeFD(r,first=false){
  if(!this.fds.has(r))return;let s;try{s=this.io.fstatSync(r.fd,{bigint:true});}catch(e){if(e.code==='EBADF'){this.fds.delete(r);return;}if(!first)fail('pending_lock_cleanup_unconfirmed');}
  if(!first&&!r.proof)fail('pending_lock_cleanup_unconfirmed');if(r.proof&&s&&!equal(nodeId(s),r.proof))fail('pending_lock_cleanup_unconfirmed');
  try{this.io.closeSync(r.fd);this.fds.delete(r);}catch{fail('pending_lock_cleanup_unconfirmed');}
 }
 _read(file,max=LIMITS.maxLockBytes,{keep=false,hashOnly=false}={}){
  const before=this._safe(file,{max}),r={fd:this.io.openSync(file,'r'),proof:null};this.fds.add(r);let result;
  try{const opened=this.io.fstatSync(r.fd,{bigint:true});r.proof=nodeId(opened);if(!equal(identity(opened),identity(before.stat)))fail('pending_lock_changed');const size=Number(opened.size),bytes=hashOnly?null:Buffer.alloc(size),chunk=hashOnly?Buffer.alloc(Math.min(size,1024*1024)):bytes,h=createHash('sha256');let at=0;
   while(at<size){const n=this.io.readSync(r.fd,chunk,hashOnly?0:at,Math.min(hashOnly?chunk.length:size-at,size-at),at);if(!n)fail('pending_lock_changed');h.update(chunk.subarray(hashOnly?0:at,(hashOnly?0:at)+n));at+=n;}
   const after=this._safe(file,{max});if(!equal(identity(opened),identity(this.io.fstatSync(r.fd,{bigint:true})))||!equal(identity(opened),identity(after.stat))||!equal(before.parents,after.parents))fail('pending_lock_changed');result={identity:identity(opened),parents:before.parents,sha256:h.digest('hex'),bytes,...keep?{held:r}:{}};
  }catch(e){try{this._closeFD(r,true);}catch(cleanup){throw cleanup;}throw e;}if(!keep)this._closeFD(r,true);return result;
 }
 _lock(kind,{keep=false}={}){const file=this._file(kind),r=this._read(file,LIMITS.maxLockBytes,{keep});try{const value=JSON.parse(r.bytes);if(value?.schema!==(kind==='installation'?'qq_component_lock_v2':'qq_component_recovery_guard_v1')||value.installationId!==this.selection.installationId||!UUID.test(value.token)||!owner(value.owner)||typeof value.at!=='string'||!Number.isFinite(Date.parse(value.at))||Object.keys(value).some(k=>!['schema','installationId','owner','token','at'].includes(k))||Object.keys(value.owner).some(k=>!['pid','createdAt','executable'].includes(k)))fail('pending_lock_unsafe');return {...r,value};}catch(e){if(r.held)this._closeFD(r.held,true);if(e instanceof QQPendingUpdateLockRecoveryError)throw e;fail('pending_lock_unsafe');}}
 _proof(r){return r?{identity:r.identity,parents:r.parents,sha256:r.sha256,value:r.value}:null;}
 _parents(expected){for(const p of expected){const s=this.io.lstatSync(p.path,{bigint:true});if(!s.isDirectory()||s.isSymbolicLink()||!equal(nodeId(s),p.identity))fail('pending_lock_changed');}}
 _removed(file,proof,held){this._parents(proof.parents);if(this._exists(file))return false;if(!held||!this.fds.has(held))return false;const s=this.io.fstatSync(held.fd,{bigint:true});if(!equal(nodeId(s),{dev:proof.identity.dev,ino:proof.identity.ino,birth:proof.identity.birth})||s.nlink!==0n)return false;this._parents(proof.parents);return true;}
 _lockPair(){return {installation:this._exists(this._file('installation'))?this._proof(this._lock('installation')):null,recoveryGuard:this._exists(this._file('recovery-guard'))?this._proof(this._lock('recovery-guard')):null};}
 _snapshot(gate){
  gate.assertContext();const pending=this.pending.captureLockRecoveryProof(),files={};
  for(const [name,max]of [['descriptor',16384],['manifest',4*1024*1024],['selection',32768],['qqExe',512*1024*1024]]){const file=gate.paths[name];if(name==='selection'&&!this._exists(file)){files[name]=null;continue;}const r=this._read(file,max,{hashOnly:true});files[name]={identity:r.identity,parents:r.parents,sha256:r.sha256};}
  if(files.descriptor.sha256!==gate.managed.descriptorSha256||files.manifest.sha256!==gate.context.current.manifestSha256||files.qqExe.sha256!==gate.managed.qq.sha256)fail('pending_lock_changed');
  const directories={};for(const key of ['installationRoot','workDir','configDir','lockRoot','codeRoot']){const p=this._safe(gate.paths[key],{directory:true});directories[key]={identity:nodeId(p.stat),parents:p.parents};}
  return {context:gate.context,pending,files,directories,locks:this._lockPair()};
 }
 async _ownerObservations(pid){let rows,direct;try{rows=await this.host.snapshot();direct=await this.host.inspect([pid]);}catch{fail('pending_lock_owner_unverified');}if(!Array.isArray(rows)||rows.length>4096||!Array.isArray(direct)||direct.length>1)fail('pending_lock_owner_unverified');const found=rows.filter(v=>v?.pid===pid);if(found.length>1||found.some(v=>!owner(v))||direct.some(v=>!owner(v)||v.pid!==pid))fail('pending_lock_owner_unverified');return {found,direct};}
 async _observe(pid){const {found,direct}=await this._ownerObservations(pid);if(found.length!==direct.length||found.length&&!sameOwner(found[0],direct[0]))fail('pending_lock_owner_unverified');return direct[0]||null;}
 async _dead(value){
  const expected=value.owner;if(!completeOwner(expected))fail('pending_lock_owner_unverified');const {found,direct}=await this._ownerObservations(expected.pid),savedTime=creationTicks(expected.createdAt);
  // Both independent reads must exclude the ORIGINAL identity. A complete later
  // process may appear/disappear between reads; it is never stopped or adopted.
  // Same-time/path conflicts, older identities and incomplete rows still refuse.
  for(const current of [...found,...direct]){if(sameOwner(current,expected))fail('pending_lock_owner_alive');if(!completeOwner(current))fail('pending_lock_owner_unverified');if(creationTicks(current.createdAt)<=savedTime)fail('pending_lock_owner_changed');}
  if(found.length&&direct.length&&!sameOwner(found[0],direct[0]))fail('pending_lock_owner_unverified');
 }
 async _self(){const v=await this._observe(process.pid);if(!v||path.resolve(v.executable).toLowerCase()!==path.resolve(process.execPath).toLowerCase())fail('pending_lock_owner_unverified');return {pid:v.pid,createdAt:v.createdAt,executable:v.executable};}
 async _gate(fn){
  const server=this.createServer(socket=>socket.destroy()),r={server,confirmed:false,active:true,closing:null};server.maxConnections=1;
  server.on('close',()=>{r.confirmed=true;});server.on('error',()=>{r.lost=true;});this.gates.add(r);
  try{await new Promise((resolve,reject)=>{const failed=e=>{server.removeListener('listening',ready);r.confirmed=true;reject(new QQPendingUpdateLockRecoveryError(['EADDRINUSE','EACCES','EPERM'].includes(e.code)?'recovery_in_progress':'recovery_gate_unavailable'));};const ready=()=>{server.removeListener('error',failed);resolve();};server.once('error',failed);server.once('listening',ready);server.listen(gateEndpoint(this.selection.installationId));});return await fn(()=>{if(r.lost||r.confirmed||!server.listening)fail('recovery_gate_lost');});}
  finally{r.active=false;await this._closeGate(r);}
 }
 async _closeGate(r){if(r.active)fail('pending_lock_busy');if(r.confirmed){this.gates.delete(r);return;}if(r.closing)return r.closing;r.closing=new Promise((resolve,reject)=>{try{r.server.close(e=>{if(e&&!r.confirmed)reject(new QQPendingUpdateLockRecoveryError('pending_lock_cleanup_unconfirmed'));else{r.confirmed=true;this.gates.delete(r);resolve();}});}catch{reject(new QQPendingUpdateLockRecoveryError('pending_lock_cleanup_unconfirmed'));}}).finally(()=>{r.closing=null;});return r.closing;}
 _run(fn){if(this.active)fail('pending_lock_busy');if(this.closed)fail('manager_closing');if(this.fds.size||this.gates.size||this.guards.size)fail('pending_lock_cleanup_unconfirmed');const task=Promise.resolve().then(fn);this.active=task;return task.finally(()=>{if(this.active===task)this.active=null;});}
 discardPreview(){this.ticket=null;this.epoch++;}
 inspect(options={}){return this._run(async()=>{this._check(options);try{return await this.selection.withPendingUpdateLockRecoveryProof(async gate=>{this.pending.captureLockRecoveryProof();gate.assertContext();const records=[];for(const kind of ['recovery-guard','installation'])if(this._exists(this._file(kind))){try{this._lock(kind);records.push({recordId:this._id(kind),kind,state:'present',code:null});}catch(e){records.push({recordId:this._id(kind),kind,state:'unverified',code:code(e)});}}this._check(options);return {supported:true,component:'napcat-shell',version:'4.18.42',scope:'declared-installation',verification:'not-checked',records,issue:null};},{signal:options.signal});}catch(e){if(['pending_lock_unsupported','pending_update_unsupported'].includes(e.code))return {supported:false,component:'napcat-shell',version:'4.18.42',scope:'declared-installation',verification:'not-checked',records:[],issue:'pending_lock_unsupported'};throw new QQPendingUpdateLockRecoveryError(code(e));}});}
 async _verified(gate,kind,check,expected){check();const initial=this._snapshot(gate),target=kind==='installation'?initial.locks.installation:initial.locks.recoveryGuard;if(!target)fail('pending_lock_missing');if(kind==='installation'&&initial.locks.recoveryGuard)fail('pending_lock_guard_required');if(expected&&hash(JSON.stringify(initial))!==expected)fail('pending_lock_changed');
  for(let pass=0;pass<2;pass++){await gate.assertStopped();check();await this._dead(target.value);check();if(kind==='recovery-guard'&&initial.locks.installation){await this._dead(initial.locks.installation.value);check();}if(pass===0){await gate.verify();check();}}
  const final=this._snapshot(gate);if(!equal(final,initial))fail('pending_lock_changed');return final;
 }
 preview({recordId,signal,assertCurrent}={}){if(!HEX.test(recordId))return Promise.reject(new QQPendingUpdateLockRecoveryError('invalid_request'));this.discardPreview();const epoch=this.epoch,options={signal,assertCurrent};return this._run(async()=>{try{return await this._gate(assertGate=>this.selection.withPendingUpdateLockRecoveryProof(async gate=>{const kind=['installation','recovery-guard'].find(v=>this._id(v)===recordId);if(!kind)fail('pending_lock_missing');const check=()=>{assertGate();this._check(options,epoch);},proof=await this._verified(gate,kind,check),digest=hash(JSON.stringify(proof));check();const ticket={recordId,kind,ticketId:randomUUID(),expectedDigest:digest,deadline:this.monotonic()+LIMITS.previewTtlMs,epoch};this.ticket=ticket;return {operation:'clear-pending-update-lock',recordId,kind,ticketId:ticket.ticketId,expectedDigest:digest,expiresAt:this.now()+LIMITS.previewTtlMs,component:'napcat-shell',version:'4.18.42',verification:'full-manifest',owner:'confirmed-absent',stopped:'all-related-processes-and-shared-locks-checked',effects:effects()};},{signal}));}catch(e){this.ticket=null;throw new QQPendingUpdateLockRecoveryError(code(e));}});}
 _remaining(){const out={};for(const [key,kind]of [['installation','installation'],['recoveryGuard','recovery-guard']])try{out[key]=this._exists(this._file(kind));}catch{out[key]=null;}return out;}
 _guardCreate(self){const file=this._file('recovery-guard'),bytes=Buffer.from(JSON.stringify({schema:'qq_component_recovery_guard_v1',installationId:this.selection.installationId,owner:self,token:randomUUID(),at:new Date(this.now()).toISOString()})),r={file,bytes,proof:null,held:null,unlinkAttempted:false};const held={fd:this.io.openSync(file,'wx',0o600),proof:null};r.held=held;this.guards.add(r);this.fds.add(held);
  try{const st=this.io.fstatSync(held.fd,{bigint:true});held.proof=nodeId(st);this.io.writeFileSync(held.fd,bytes);this.io.fsyncSync(held.fd);const saved=this._read(file);if(!equal(nodeId(this.io.fstatSync(held.fd,{bigint:true})),{dev:saved.identity.dev,ino:saved.identity.ino,birth:saved.identity.birth})||!saved.bytes.equals(bytes))fail('pending_lock_changed');r.proof={identity:saved.identity,parents:saved.parents,sha256:saved.sha256};return r;}
  catch(e){if(held.proof)try{const saved=this._read(file);if(equal(held.proof,{dev:saved.identity.dev,ino:saved.identity.ino,birth:saved.identity.birth})){r.bytes=saved.bytes;r.proof={identity:saved.identity,parents:saved.parents,sha256:saved.sha256};}}catch{}throw e;}
 }
 _closeGuard(r){if(!this.guards.has(r))return;if(!r.proof)fail('pending_lock_cleanup_unconfirmed');this._parents(r.proof.parents);
  if(!r.removalConfirmed){if(r.unlinkAttempted&&!this._exists(r.file)){if(!this._removed(r.file,r.proof,r.held))fail('pending_lock_cleanup_unconfirmed');r.removalConfirmed=true;}
   else{const read=this._read(r.file,LIMITS.maxLockBytes,{keep:true}),owned=v=>({dev:v.dev,ino:v.ino,birth:v.birth,size:v.size,links:v.links});try{if(!equal(owned(read.identity),owned(r.proof.identity))||!equal(read.parents,r.proof.parents)||read.sha256!==r.proof.sha256||!read.bytes.equals(r.bytes))fail('pending_lock_cleanup_unconfirmed');this._parents(r.proof.parents);r.unlinkAttempted=true;try{this.io.unlinkSync(r.file);}catch(e){if(!this._removed(r.file,r.proof,read.held))throw e;}if(!this._removed(r.file,r.proof,read.held))fail('pending_lock_cleanup_unconfirmed');r.removalConfirmed=true;}finally{this._closeFD(read.held);}}
  }if(r.held)this._closeFD(r.held);this.guards.delete(r);
 }
 confirm({ticketId,expectedDigest,signal,assertCurrent}={}){
  const ticket=this.ticket;this.ticket=null;if(!ticket||ticketId!==ticket.ticketId||expectedDigest!==ticket.expectedDigest)return Promise.reject(new QQPendingUpdateLockRecoveryError('pending_lock_preview_required'));const operationId=randomUUID(),options={signal,assertCurrent};let attempted=false,cleared=false,ownGuard=null,receiptCode=null;
  const make=()=>{const remaining=this._remaining(),cleanupVerified=this.fds.size===0&&this.gates.size===0&&this.guards.size===0;return {operation:'clear-pending-update-lock',recordId:ticket.recordId,kind:ticket.kind,operationId,committed:cleared?true:attempted?null:false,lockCleared:cleared?true:attempted?null:false,cleanupVerified,recoveryRequired:!cleanupVerified||remaining.installation!==false||remaining.recoveryGuard!==false||attempted&&!cleared,remainingLocks:remaining,pendingUpdateRecoveryRequired:true,updateRecordsChanged:false,accountRecordsChanged:false,automaticStart:false,automaticStop:false,rollsBackCode:false,code:receiptCode};};
  return this._run(async()=>{try{await this._gate(async assertGate=>{try{return await this.selection.withPendingUpdateLockRecoveryProof(async gate=>{
   const check=()=>{assertGate();this._check(options,ticket.epoch,ticket.deadline);};const proof=await this._verified(gate,ticket.kind,check,ticket.expectedDigest);const self=await this._self();check();
   if(ticket.kind==='installation'){ownGuard=this._guardCreate(self);check();}
   await gate.assertStopped();check();const target=ticket.kind==='installation'?proof.locks.installation:proof.locks.recoveryGuard;await this._dead(target.value);check();if(ticket.kind==='recovery-guard'&&proof.locks.installation){await this._dead(proof.locks.installation.value);check();}
   const current=this._snapshot(gate);if(ownGuard)current.locks.recoveryGuard=null;if(!equal(current,proof))fail('pending_lock_changed');
   if(ownGuard){const g=this._read(ownGuard.file);if(!equal({identity:g.identity,parents:g.parents,sha256:g.sha256},ownGuard.proof))fail('pending_lock_changed');}
   const held=this._lock(ticket.kind,{keep:true});try{if(!equal(this._proof(held),target))fail('pending_lock_changed');check();const named=this._lock(ticket.kind);if(!equal(this._proof(named),target))fail('pending_lock_changed');this._parents(target.parents);if(!equal(identity(this.io.fstatSync(held.held.fd,{bigint:true})),target.identity))fail('pending_lock_changed');attempted=true;try{this.io.unlinkSync(this._file(ticket.kind));}catch(e){try{cleared=this._removed(this._file(ticket.kind),target,held.held);}catch{}throw e;}if(!this._removed(this._file(ticket.kind),target,held.held))fail('pending_lock_unconfirmed');cleared=true;}finally{this._closeFD(held.held);}
  },{signal});}finally{for(const r of [...this.guards])try{this._closeGuard(r);}catch{receiptCode='pending_lock_cleanup_unconfirmed';}}});}catch(e){receiptCode=receiptCode||code(e);}
   return make();
  });
 }
 close(){if(this.closing)return this.closing;this.closed=true;this.discardPreview();this.closing=(async()=>{if(this.active)await this.active.catch(()=>{});let failed=false;for(const r of [...this.gates])try{await this._closeGate(r);}catch{failed=true;}if(this.guards.size&&!this.gates.size)try{await this._gate(async assertGate=>{for(const r of [...this.guards]){assertGate();this._closeGuard(r);}});}catch{failed=true;}const retainedGuardHandles=new Set([...this.guards].map(r=>r.held));for(const r of [...this.fds])if(!retainedGuardHandles.has(r))try{this._closeFD(r);}catch{failed=true;}try{this.pending.close();}catch{failed=true;}if(failed||this.guards.size||this.fds.size||this.gates.size)fail('pending_lock_cleanup_unconfirmed');return {closed:true};})().finally(()=>{this.closing=null;});return this.closing;}
}
module.exports={QQPendingUpdateLockRecovery,QQPendingUpdateLockRecoveryError,CODES,LIMITS};
