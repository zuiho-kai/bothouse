'use strict';

// Original managed-Shell ownership evidence. No QQ protocol, token or command
// line is stored here. Paths are always rederived from the fixed setup reader.
const fs=require('node:fs'),path=require('node:path'),net=require('node:net');
const {createHash,randomUUID}=require('node:crypto');
const {gateEndpoint}=require('./qq-component-lock-recovery.cjs');
const QCE=require('./qq-qce-managed-process.cjs');
const MAX_LEASE=64*1024,VERSION_ID='napcat-shell-4.18.42-02e5ff0f79916c1e';
const UUID=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/,HEX=/^[a-f0-9]{64}$/;
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b),hash=b=>createHash('sha256').update(b).digest('hex');
const plain=v=>!!v&&typeof v==='object'&&!Array.isArray(v),keys=(v,list)=>plain(v)&&Object.keys(v).sort().join('|')===list.split(' ').sort().join('|');
const same=(a,b)=>typeof a==='string'&&typeof b==='string'&&path.resolve(a).toLowerCase()===path.resolve(b).toLowerCase();
const identity=st=>({dev:String(st.dev),ino:String(st.ino),birthNs:String(st.birthtimeNs)});
const full=st=>({...identity(st),size:String(st.size),mtimeNs:String(st.mtimeNs),ctimeNs:String(st.ctimeNs),nlink:String(st.nlink)});
class QQShellOwnerError extends Error{constructor(code='ownership_lost'){super(`Shell ownership check failed (${code}).`);this.code=code;}}
function fail(code){throw new QQShellOwnerError(code);}
function check(fn){if(fn===undefined)return;if(typeof fn!=='function')fail('start_guard_invalid');const result=fn();if(result&&typeof result.then==='function'){if(result instanceof Promise)result.catch(()=>{});fail('start_guard_invalid');}}
function local(file){if(typeof file!=='string'||file.length>1024||!path.isAbsolute(file)||/^[/\\]{2}/.test(file)||/[\x00-\x1f]/.test(file)||file.slice(2).includes(':'))fail();return path.resolve(file);}
function parents(file){let current=path.dirname(local(file)),out=[];for(;;){const st=fs.lstatSync(current,{bigint:true});if(!st.isDirectory()||st.isSymbolicLink())fail();out.push({path:current,identity:identity(st)});if(out.length>32)fail();const next=path.dirname(current);if(next===current)break;current=next;}return out;}
function dir(file){const target=local(file),p=parents(target),st=fs.lstatSync(target,{bigint:true});if(!st.isDirectory()||st.isSymbolicLink()||!same(fs.realpathSync(target),target))fail();return {path:target,identity:identity(st),parents:p};}
function fileStat(file,max=MAX_LEASE,allowedLinks=1){const st=fs.lstatSync(local(file),{bigint:true});if(!st.isFile()||st.isSymbolicLink()||st.nlink<1n||st.nlink>BigInt(allowedLinks)||st.size<0n||st.size>BigInt(max)||!same(fs.realpathSync(file),file))fail();return st;}
function exists(file){try{fs.lstatSync(file);return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}}
function proc(v,tree=false){return keys(v,tree?'pid createdAt executable parentPid':'pid createdAt executable')&&Number.isSafeInteger(v.pid)&&v.pid>0&&v.pid<=2147483647&&typeof v.createdAt==='string'&&v.createdAt.length<=64&&Number.isFinite(Date.parse(v.createdAt))&&typeof v.executable==='string'&&v.executable.length<=1024&&path.isAbsolute(v.executable)&&(!tree||Number.isSafeInteger(v.parentPid)&&v.parentPid>=0&&v.parentPid<=2147483647);}
const processIdentity=p=>({pid:p.pid,createdAt:p.createdAt,executable:p.executable});
const treeIdentity=p=>({...processIdentity(p),parentPid:p.parentPid});
const matches=(a,b)=>!!a&&!!b&&a.pid===b.pid&&a.createdAt===b.createdAt&&same(a.executable,b.executable);
function validateBinding(b){
  if(!keys(b,b?.version===2?'version directories descriptor selection component program qce':'version directories descriptor selection component program')||![1,2].includes(b.version)||!keys(b.directories,'installationRoot workDir configDir qqDataDir lockRoot')||!keys(b.selection,'path present identity sha256')||typeof b.selection.present!=='boolean'||!keys(b.component,'versionId codeRoot manifest')||b.component.versionId!==VERSION_ID||!keys(b.program,'qq launcher'))fail();
  const id=v=>keys(v,'dev ino birthNs')&&Object.values(v).every(n=>typeof n==='string'&&/^\d{1,30}$/.test(n));
  const ps=v=>Array.isArray(v)&&v.length>0&&v.length<=32&&v.every(p=>keys(p,'path identity')&&local(p.path)===p.path&&id(p.identity));
  for(const d of Object.values(b.directories))if(!keys(d,'path identity parents')||local(d.path)!==d.path||!id(d.identity)||!ps(d.parents))fail();
  const proof=v=>keys(v,'path identity size sha256 parents')&&local(v.path)===v.path&&id(v.identity)&&Number.isSafeInteger(v.size)&&v.size>=0&&v.size<=512*1024*1024&&HEX.test(v.sha256)&&ps(v.parents);
  if(!proof(b.descriptor)||!proof(b.component.manifest)||!proof(b.program.qq)||!proof(b.program.launcher)||local(b.component.codeRoot)!==b.component.codeRoot||local(b.selection.path)!==b.selection.path)fail();
  if(b.selection.present?(!id(b.selection.identity)||!HEX.test(b.selection.sha256)):(b.selection.identity!==null||b.selection.sha256!==null))fail();
  if(b.version===2)QCE.validateProof(b.qce,b.directories.workDir.path);
  return b;
}
function validateLease(v,accountId){
  if(!keys(v,'version engine instance token accountId installationId setupId descriptorSha256 selectionDigest manifestSha256 binding manager spawnManager runtime runtimeTree')||v.version!==2||v.engine!=='managed-shell'||!UUID.test(v.instance)||!UUID.test(v.token)||typeof v.accountId!=='string'||! /^[1-9]\d{4,11}$/.test(v.accountId)||accountId!==undefined&&v.accountId!==accountId||!HEX.test(v.installationId)||!UUID.test(v.setupId)||!HEX.test(v.descriptorSha256)||!HEX.test(v.selectionDigest)||!HEX.test(v.manifestSha256)||!proc(v.manager)||!proc(v.spawnManager)||v.runtime!==null&&!proc(v.runtime,true)||!Array.isArray(v.runtimeTree)||v.runtimeTree.length>64||v.runtimeTree.some(p=>!proc(p,true))||new Set(v.runtimeTree.map(p=>p.pid)).size!==v.runtimeTree.length)fail();
  validateBinding(v.binding);if(v.runtime===null?v.runtimeTree.length!==0:!v.runtimeTree.some(p=>equal(p,v.runtime)))fail();if(v.runtime&&v.runtime.parentPid!==v.spawnManager.pid)fail();return v;
}
function leaseContent(lease){const {file,...value}=lease;return value;}

class QQShellOwnerProof{
  constructor(){this.handles=new Map();this.gates=new Set();this.guards=new Set();this.resourceRevision=0;}
  _open(file,flags){const fd=fs.openSync(file,flags,0o600);this.resourceRevision++;this.handles.set(fd,null);const st=fs.fstatSync(fd,{bigint:true});this.handles.set(fd,identity(st));return fd;}
  _close(fd){const proof=this.handles.get(fd);if(!this.handles.has(fd))return;let st;try{st=fs.fstatSync(fd,{bigint:true});}catch(e){if(e.code==='EBADF'){this.handles.delete(fd);return;}fail('cleanup_unconfirmed');}if(!proof||!equal(identity(st),proof))fail('cleanup_unconfirmed');try{fs.closeSync(fd);this.handles.delete(fd);}catch{fail('cleanup_unconfirmed');}}
  read(file,max=MAX_LEASE,{keep=false}={}){
    return this._read(file,max,keep,1);
  }
  _read(file,max,keep,allowedLinks){
    const p=parents(file),before=fileStat(file,max,allowedLinks);let fd;
    try{fd=this._open(file,'r');const opened=fs.fstatSync(fd,{bigint:true});if(!equal(full(opened),full(before)))fail();const digest=createHash('sha256'),chunks=[],buffer=Buffer.alloc(Math.min(1024*1024,Number(opened.size)));let at=0;
      while(at<Number(opened.size)){const n=fs.readSync(fd,buffer,0,Math.min(buffer.length,Number(opened.size)-at),at);if(!n)fail();digest.update(buffer.subarray(0,n));if(max<=4*1024*1024)chunks.push(Buffer.from(buffer.subarray(0,n)));at+=n;}
      if(!equal(full(opened),full(fs.fstatSync(fd,{bigint:true})))||!equal(full(opened),full(fileStat(file,max,allowedLinks)))||!equal(p,parents(file)))fail();
      const proof={path:local(file),identity:identity(opened),size:at,sha256:digest.digest('hex'),parents:p,...(allowedLinks===2?{links:String(opened.nlink)}:{})};const result={proof,bytes:max<=4*1024*1024?Buffer.concat(chunks):null,...(keep?{fd}:{})};if(!keep){this._close(fd);fd=undefined;}return result;
    }catch(e){if(fd!==undefined)this._close(fd);throw e;}
  }
  capture(context){
    const {managed:m,current:c,layout:l}=context;if(c.kind!=='prepared'||c.versionId!==VERSION_ID||l.installationKind!=='managed-shell')fail();
    const directories={};for(const [key,value]of Object.entries({installationRoot:m.installationRoot,workDir:m.workDir,configDir:m.configDir,qqDataDir:m.qqDataDir,lockRoot:context.lockRoot}))directories[key]=dir(value);
    const descriptor=this.read(context.descriptor).proof,manifest=this.read(context.manifest,4*1024*1024).proof,qq=this.read(m.qq.file,512*1024*1024).proof,launcher=this.read(path.join(l.codeRoot,'NapCatWinBootMain.exe'),512*1024*1024).proof;
    if(descriptor.sha256!==m.descriptorSha256||manifest.sha256!==c.manifestSha256||qq.sha256!==m.qq.sha256||qq.size!==m.qq.size)fail();
    const selected=context.selectionPresent?this.read(context.selectionFile).proof:null;if(!selected&&exists(context.selectionFile))fail();
    const binding={version:1,directories,descriptor,selection:{path:context.selectionFile,present:!!selected,identity:selected?.identity||null,sha256:selected?.sha256||null},component:{versionId:c.versionId,codeRoot:l.codeRoot,manifest},program:{qq,launcher}};
    validateBinding(binding);return {installationId:m.installationId,setupId:m.setupId,descriptorSha256:m.descriptorSha256,selectionDigest:l.selectionDigest,manifestSha256:c.manifestSha256,binding};
  }
  assertBinding(lease,context,{programs=false}={}){
    const {managed:m,current:c,layout:l}=context,b=lease.binding;validateBinding(b);
    if(lease.installationId!==m.installationId||lease.setupId!==m.setupId||lease.descriptorSha256!==m.descriptorSha256||lease.selectionDigest!==l.selectionDigest||lease.manifestSha256!==c.manifestSha256||c.versionId!==VERSION_ID||!same(b.component.codeRoot,l.codeRoot)||!same(b.descriptor.path,context.descriptor)||!same(b.component.manifest.path,context.manifest)||!same(b.selection.path,context.selectionFile)||!same(b.program.qq.path,m.qq.file)||!same(b.program.launcher.path,path.join(l.codeRoot,'NapCatWinBootMain.exe')))fail();
    for(const [k,file]of Object.entries({installationRoot:m.installationRoot,workDir:m.workDir,configDir:m.configDir,qqDataDir:m.qqDataDir,lockRoot:context.lockRoot}))if(!equal(b.directories[k],dir(file)))fail();
    for(const proof of [b.descriptor,b.component.manifest,...(programs?Object.values(b.program):[])])if(!equal(proof,this.read(proof.path,proof===b.component.manifest?4*1024*1024:512*1024*1024).proof))fail();
    if(b.version===2)QCE.assertProof(b.qce,{workDir:m.workDir},{hashes:programs});
    if(b.selection.present){const p=this.read(context.selectionFile).proof;if(!context.selectionPresent||!equal(p.identity,b.selection.identity)||p.sha256!==b.selection.sha256)fail();}else if(context.selectionPresent||exists(context.selectionFile))fail();
  }
  readLease(file,accountId){const {proof,bytes}=this.read(file);let value;try{value=JSON.parse(bytes);}catch{fail();}validateLease(value,accountId);const lease={file,...value};Object.defineProperty(lease,'ownerFile',{value:proof,writable:true});return lease;}
  assertLease(lease){if(!lease.ownerFile||!equal(this.read(lease.file).proof,lease.ownerFile))fail('runtime_locked');}
  // Only these two fixed, read-only blocker paths may be a helper's two-name
  // publication. Exact link count joins the byte/inode/parent proof. Leases,
  // descriptors, programs and guards retain their single-link rule.
  blockers(context){return [path.join(context.managed.configDir,'napcat-update.json'),path.join(context.managed.configDir,'.agent-arcade-pending-updates','pending.json')].map(file=>({file,proof:exists(file)?this._read(file,2*1024*1024,false,2).proof:null}));}
  assertBlockers(records){for(const r of records)if(r.proof?!equal(this._read(r.file,2*1024*1024,false,2).proof,r.proof):exists(r.file))fail('ownership_lost');}
  createLease(file,value){validateLease(value,value.accountId);const bytes=Buffer.from(JSON.stringify(value));if(bytes.length>MAX_LEASE)fail('unsafe_lock');let fd;
    try{parents(file);fd=this._open(file,'wx');fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);}finally{if(fd!==undefined)this._close(fd);}return this.readLease(file,value.accountId);
  }
  writeLease(lease){validateLease(leaseContent(lease),lease.accountId);this.assertLease(lease);const bytes=Buffer.from(JSON.stringify(leaseContent(lease)));if(bytes.length>MAX_LEASE)fail('unsafe_lock');const temp=`${lease.file}.${randomUUID()}.part`;let fd,proof,sealed,ownedIdentity,attempted=false,published=false;
    const heldAfterRename=()=>{
      // Keep the exclusively opened descriptor across rename. NTFS can tunnel
      // the old destination birth time onto this same inode; it cannot recycle
      // its volume/file ID while our descriptor remains held. This exception
      // is local to this controlled rename, never to ordinary identity checks.
      if(fd===undefined||!sealed||!equal(this.handles.get(fd),ownedIdentity))fail('cleanup_unconfirmed');
      const held=fs.fstatSync(fd,{bigint:true});
      if(!held.isFile()||held.dev!==sealed.dev||held.ino!==sealed.ino||held.size!==sealed.size||held.mtimeNs!==sealed.mtimeNs||held.nlink<0n||held.nlink>1n)fail('runtime_locked');
      const actual=Buffer.alloc(bytes.length);let offset=0;while(offset<actual.length){const n=fs.readSync(fd,actual,offset,actual.length-offset,offset);if(!n)fail('runtime_locked');offset+=n;}
      if(!actual.equals(bytes)||!equal(full(held),full(fs.fstatSync(fd,{bigint:true}))))fail('runtime_locked');
      // Closing this exact owned descriptor is separate from proving the name
      // was published: a foreign replacement must not strand our original FD.
      ownedIdentity=identity(held);this.handles.set(fd,ownedIdentity);return held;
    };
    try{
      fd=this._open(temp,'wx+');fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);proof=this.read(temp).proof;sealed=fs.fstatSync(fd,{bigint:true});ownedIdentity=identity(sealed);
      if(!equal(ownedIdentity,proof.identity)||!equal(ownedIdentity,this.handles.get(fd))||proof.sha256!==hash(bytes))fail('runtime_locked');
      this.assertLease(lease);if(!equal(parents(temp),proof.parents)||!equal(full(sealed),full(fileStat(temp)))||!equal(full(sealed),full(fs.fstatSync(fd,{bigint:true}))))fail('runtime_locked');
      attempted=true;let renameError;try{fs.renameSync(temp,lease.file);}catch(e){renameError=e;}
      let current;try{
        const held=heldAfterRename();current=this.read(lease.file).proof;
        if(exists(temp)||!equal(current.identity,identity(held))||current.sha256!==proof.sha256||current.size!==bytes.length||!equal(current.parents,proof.parents)||!equal(parents(lease.file),proof.parents)||!equal(full(held),full(fileStat(lease.file)))||!equal(full(held),full(fs.fstatSync(fd,{bigint:true}))))fail('runtime_locked');
      }catch(e){throw renameError||e;}
      // A throwing rename is still a known publication only after this complete
      // held/name/content/parent readback. No error alone implies it was undone.
      lease.ownerFile=current;published=true;
    }finally{
      if(fd!==undefined){if(attempted)try{heldAfterRename();}catch{/* Preserve an unverified descriptor owner for explicit cleanup. */}this._close(fd);}
      if(!published&&proof&&exists(temp)&&equal(this.read(temp).proof,proof))fs.unlinkSync(temp);
    }
  }
  releaseLease(lease){this.assertLease(lease);const r=this.read(lease.file,MAX_LEASE,{keep:true});let cleared=false;try{if(!equal(r.proof,lease.ownerFile))fail('runtime_locked');let error;try{fs.unlinkSync(lease.file);}catch(e){error=e;}if(!equal(parents(lease.file),r.proof.parents)||exists(lease.file)||!equal(identity(fs.fstatSync(r.fd,{bigint:true})),r.proof.identity)||fs.fstatSync(r.fd,{bigint:true}).nlink!==0n){if(error)throw error;fail('runtime_locked');}cleared=true;}finally{try{this._close(r.fd);}catch(e){if(cleared)e.leaseCleared=true;throw e;}}return {cleared:true};}
  async _observe(host,pid){const a=await host.snapshot(),b=await host.inspect([pid]);if(!Array.isArray(a)||a.length>4096||!Array.isArray(b)||b.length>1||b.some(p=>p.pid!==pid||!proc(processIdentity(p))))fail('process_check_failed');const rows=a.filter(p=>p.pid===pid);if(rows.length!==b.length||rows.length>1||rows.length&&!matches(rows[0],b[0]))fail('process_check_failed');return b[0]||null;}
  async _dead(host,owner){const p=await this._observe(host,owner.pid);if(p)fail(matches(p,owner)?'owner_alive':'ownership_lost');}
  _sameRecord(record){if(!equal(this.read(record.file,record.max).proof,record.proof))fail('runtime_locked');}
  async _closeGate(owner){if(owner.working)fail('cleanup_unconfirmed');owner.closing=true;try{if(!owner.closed)await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new QQShellOwnerError('cleanup_unconfirmed')),5000);timer.unref?.();owner.server.close(e=>{clearTimeout(timer);e?reject(e):resolve();});});if(!owner.closed)fail();this.gates.delete(owner);}catch{if(owner.closed){this.gates.delete(owner);return;}fail('cleanup_unconfirmed');}}
  _newGuard(file,value){
    const g={file,max:4096,parents:parents(file),fd:null,created:null,proof:null,unlinkAttempted:false};
    // Register immediately after the exclusive open; an unknown initial fstat
    // remains retained, never upgraded from a possibly reused descriptor.
    const fd=fs.openSync(file,'wx',0o600);g.fd=fd;this.resourceRevision++;this.handles.set(fd,null);this.guards.add(g);
    const st=fs.fstatSync(fd,{bigint:true});g.created=identity(st);this.handles.set(fd,g.created);
    const bytes=Buffer.from(JSON.stringify(value));fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);g.proof=this.read(file,4096).proof;
    if(!equal(g.proof.identity,g.created)||g.proof.sha256!==hash(bytes))fail('ownership_lost');return g;
  }
  _guardRemoved(g){if(!g.created||g.fd===null||!equal(parents(g.file),g.parents))return false;const st=fs.fstatSync(g.fd,{bigint:true});return equal(identity(st),g.created)&&st.nlink===0n&&!exists(g.file)&&equal(parents(g.file),g.parents);}
  _removeGuard(g){
    if(!g.created){try{fs.fstatSync(g.fd,{bigint:true});}catch(e){if(e.code==='EBADF'){this.handles.delete(g.fd);g.fd=null;this.guards.delete(g);return;}throw e;}fail('cleanup_unconfirmed');}if(g.fd===null)fail('cleanup_unconfirmed');
    if(!this._guardRemoved(g)){
      if(!equal(parents(g.file),g.parents))fail('cleanup_unconfirmed');
      const st=fileStat(g.file,4096),held=fs.fstatSync(g.fd,{bigint:true});if(!equal(identity(st),g.created)||!equal(identity(held),g.created)||!equal(full(st),full(held)))fail('cleanup_unconfirmed');
      if(g.proof)this._sameRecord(g);
      // This is our known exclusive inode, even if its first write/fsync failed.
      g.unlinkAttempted=true;try{fs.unlinkSync(g.file);}catch(e){if(!this._guardRemoved(g))throw e;}
      if(!this._guardRemoved(g))fail('cleanup_unconfirmed');
    }
    this._close(g.fd);g.fd=null;this.guards.delete(g);
  }
  async withGuard({context,accountId,lease,host,assertCurrent,mutating=false},operation){
    if(this.guards.size||this.gates.size||this.handles.size)fail('cleanup_unconfirmed');
    check(assertCurrent);const endpoint=gateEndpoint(context.managed.installationId),server=net.createServer(s=>s.destroy()),gate={server,working:true,closing:false,closed:false,lost:false};server.maxConnections=1;
    await new Promise((resolve,reject)=>{const bad=()=>reject(new QQShellOwnerError('operation_in_progress'));server.once('error',bad);server.listen(endpoint,()=>{server.removeListener('error',bad);resolve();});});this.resourceRevision++;this.gates.add(gate);server.on('error',()=>{gate.lost=true;});server.on('close',()=>{gate.closed=true;if(!gate.closing)gate.lost=true;});
    let ownGuard,accountGuard,result,failure;const records=[],originalRecords=[];
    const assertGate=()=>{if(gate.lost||!server.listening)fail('operation_in_progress');};
    const assertFixed=()=>{assertGate();if(exists(path.join(context.lockRoot,'configuration.edit')))fail('operation_in_progress');for(const r of records)this._sameRecord(r);for(const r of originalRecords)if(!r.proof&&r.file!==ownGuard?.file&&exists(r.file))fail('runtime_locked');};
    try{
      assertFixed();const manager=await this._observe(host,process.pid);if(!manager||!same(manager.executable,process.execPath))fail('process_check_failed');check(assertCurrent);assertFixed();
      for(const [file,schema]of [[context.lockFile,'qq_component_lock_v2'],[`${context.lockFile}.recover`,'qq_component_recovery_guard_v1']])if(exists(file)){const r=this.read(file,4096);let value;try{value=JSON.parse(r.bytes);}catch{fail('ownership_lost');}if(value.schema!==schema||value.installationId!==context.managed.installationId||!proc(value.owner)||!UUID.test(value.token))fail('ownership_lost');await this._dead(host,value.owner);check(assertCurrent);const record={file,max:4096,proof:r.proof};this._sameRecord(record);records.push(record);originalRecords.push({file,proof:r.proof});}else originalRecords.push({file,proof:null});
      if(!exists(`${context.lockFile}.recover`)){ownGuard=this._newGuard(`${context.lockFile}.recover`,{schema:'qq_component_recovery_guard_v1',installationId:context.managed.installationId,owner:processIdentity(manager),token:randomUUID(),at:new Date().toISOString()});records.push(ownGuard);}
      if(mutating){const file=`${lease.file}.recover`;if(exists(file))fail('operation_in_progress');accountGuard=this._newGuard(file,{schema:'qq_shell_owner_guard_v1',installationId:lease.installationId,accountId,owner:processIdentity(manager),leaseSha256:lease.ownerFile.sha256,token:randomUUID()});records.push(accountGuard);}
      else if(exists(`${lease.file}.recover`))fail('operation_in_progress');
      assertFixed();check(assertCurrent);result=await operation(()=>{check(assertCurrent);assertFixed();},assertFixed,originalRecords);
    }catch(e){failure=e;}finally{
      let cleanup;for(const g of [...this.guards].reverse())try{this._removeGuard(g);}catch(e){cleanup=e;}gate.working=false;try{await this._closeGate(gate);}catch(e){cleanup=e;}if(cleanup){const error=new QQShellOwnerError('cleanup_unconfirmed');if(result)error.result=result;if(failure)error.causeCode=failure.code;failure=error;}
    }if(failure)throw failure;return result;
  }
  _guardState(g){return JSON.stringify({file:g.file,max:g.max,parents:g.parents,fd:g.fd,created:g.created,proof:g.proof,unlinkAttempted:g.unlinkAttempted});}
  _gateState(g){return JSON.stringify({working:g.working,closing:g.closing,closed:g.closed,lost:g.lost});}
  captureResources(){return {owner:this,revision:this.resourceRevision,handles:[...this.handles].map(([fd,proof])=>({fd,proof,state:JSON.stringify(proof)})),guards:[...this.guards].map(ref=>({ref,state:this._guardState(ref),fd:ref.fd})),gates:[...this.gates].map(ref=>({ref,server:ref.server,state:this._gateState(ref)}))};}
  assertCapturedResources(saved){
    if(saved?.owner!==this||saved.revision!==this.resourceRevision||saved.handles.length!==this.handles.size||saved.guards.length!==this.guards.size||saved.gates.length!==this.gates.size||saved.handles.some(v=>!this.handles.has(v.fd)||this.handles.get(v.fd)!==v.proof||JSON.stringify(this.handles.get(v.fd))!==v.state)||saved.guards.some(v=>!this.guards.has(v.ref)||this._guardState(v.ref)!==v.state)||saved.gates.some(v=>!this.gates.has(v.ref)||v.ref.server!==v.server||this._gateState(v.ref)!==v.state))fail('orphan_cleanup_changed');
  }
  async closeCaptured(saved){
    this.assertCapturedResources(saved);let failure;const closedGuardFDs=new Set(),retainedGuardFDs=new Set();
    for(const v of saved.guards){
      try{
        // An unknown initial guard inode cannot be recovered from an EBADF or
        // from a new file at its old name. Keep that precise uncertainty here.
        if(!this.guards.has(v.ref)||this._guardState(v.ref)!==v.state||!v.ref.created)fail('cleanup_unconfirmed');this._removeGuard(v.ref);
        if(this.guards.has(v.ref)||v.ref.fd!==null)fail('cleanup_unconfirmed');closedGuardFDs.add(v.fd);
      }catch(e){failure=e;retainedGuardFDs.add(v.fd);}
    }
    for(const v of saved.gates)try{if(!this.gates.has(v.ref)||v.ref.server!==v.server||this._gateState(v.ref)!==v.state)fail('cleanup_unconfirmed');await this._closeGate(v.ref);if(this.gates.has(v.ref)||v.ref.closed!==true)fail('cleanup_unconfirmed');}catch(e){failure=e;}
    for(const v of saved.handles){
      if(retainedGuardFDs.has(v.fd))continue;
      try{if(closedGuardFDs.has(v.fd)){if(this.handles.has(v.fd))fail('cleanup_unconfirmed');continue;}
        if(!this.handles.has(v.fd)||this.handles.get(v.fd)!==v.proof||JSON.stringify(this.handles.get(v.fd))!==v.state)fail('cleanup_unconfirmed');this._close(v.fd);if(this.handles.has(v.fd))fail('cleanup_unconfirmed');
      }catch(e){failure=e;}
    }
    // Only captured references were visited. Guard verification may itself
    // open and close a temporary read FD; any additional retained resource
    // keeps the owner unconfirmed and is never added to the captured targets.
    if(failure||this.handles.size||this.guards.size||this.gates.size)fail('cleanup_unconfirmed');return {closed:true};
  }
  async close(){for(const g of [...this.guards])this._removeGuard(g);for(const g of [...this.gates])await this._closeGate(g);for(const fd of [...this.handles.keys()])this._close(fd);return {closed:true};}
}
module.exports={QQShellOwnerProof,QQShellOwnerError,MAX_LEASE,validateLease,processIdentity,treeIdentity,matches,check,hash};
