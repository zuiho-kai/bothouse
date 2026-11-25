'use strict';

// Main-only, independent QCE credentials and fixed local listener ownership.
const fs=require('node:fs'),path=require('node:path');
const {randomUUID,createHash}=require('node:crypto');
const QCE=require('./qq-qce-managed-process.cjs');
const {QQRuntimeManager,runtimeSupport}=require('./qq-runtime.cjs');
const {identity,matches,validProof,readObject,validProcesses}=runtimeSupport;
const QCE_ENDPOINT=Object.freeze({host:'127.0.0.1',port:40653});
const QCE_BINDING_CODES=Object.freeze(['qce_invalid_request','qce_invalid_token','qce_credentials_locked','qce_credential_missing','qce_credential_scope_changed','qce_credential_revision_changed','qce_encryption_unavailable','qce_storage_write_unknown','qce_credential_limit','qce_listener_unverified','qce_binding_changed','qce_binding_cancelled','qce_version_unsupported','qce_process_unverified']);
const MAX_FILE=65536,MAX_PLAIN=32768,MAX_ENTRIES=32;
const hash=value=>createHash('sha256').update(value).digest('hex');
const fail=code=>{throw Object.assign(Error(`QCE: ${code}`),{code});};
const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&Object.getPrototypeOf(v)===Object.prototype;
const exact=(v,keys)=>plain(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(v);
const canonical=file=>process.platform==='win32'?path.resolve(file).toLowerCase():path.resolve(file);
const fileIdentity=s=>`${s.dev}:${s.ino}:${s.birthtimeNs}`;
function scope(value){if(!exact(value,['profileId','qqAccountId','workScope'])||typeof value.profileId!=='string'||!/^[A-Za-z0-9-]{1,64}$/.test(value.profileId)||typeof value.qqAccountId!=='string'||!/^[1-9]\d{4,14}$/.test(value.qqAccountId)||typeof value.workScope!=='string'||!/^[a-f0-9]{64}$/.test(value.workScope))fail('qce_invalid_request');return {...value};}
function token(value){if(typeof value!=='string'||!/^[A-Za-z0-9]{40}$/.test(value))fail('qce_invalid_token');return value;}
const sameScope=(a,b)=>a.profileId===b.profileId&&a.qqAccountId===b.qqAccountId&&a.workScope===b.workScope;

class QCECredentialStore{
 constructor({root,vault,io=fs}={}){
  if(typeof root!=='string'||!path.isAbsolute(root)||/^[/\\]{2}/.test(root)||root.length>2048)fail('qce_invalid_request');
  Object.assign(this,{root:path.resolve(root),vault,io,state:'ready',entries:[],revision:randomUUID(),fingerprint:null,fileIdentity:null,rootIdentity:null});this.file=path.join(this.root,'qq-qce-credentials.bin');
  try{
   const base=path.parse(this.root).root;let current=base;for(const part of this.root.slice(base.length).split(path.sep).filter(Boolean)){current=path.join(current,part);try{const s=io.lstatSync(current);if(!s.isDirectory()||s.isSymbolicLink())throw Error();}catch(e){if(e.code!=='ENOENT')throw e;io.mkdirSync(current,{mode:0o700});}if(canonical(io.realpathSync(current))!==canonical(current))throw Error();}
   this.rootIdentity=fileIdentity(io.lstatSync(this.root,{bigint:true}));const observed=this._read();
   if(observed){this._vault();const bytes=vault.decryptString(observed.bytes);if(typeof bytes!=='string'||Buffer.byteLength(bytes)>MAX_PLAIN)throw Error();const value=JSON.parse(bytes);if(!exact(value,['version','revision','entries'])||value.version!==1||!uuid(value.revision))throw Error();this.entries=this._entries(value.entries);this.revision=value.revision;this.fingerprint=hash(observed.bytes);this.fileIdentity=observed.identity;}
  }catch{this.state='locked';this.entries=[];}
 }
 _vault(){if(!this.vault?.isEncryptionAvailable?.()||typeof this.vault.encryptString!=='function'||typeof this.vault.decryptString!=='function')fail('qce_encryption_unavailable');}
 _entries(values){if(!Array.isArray(values)||values.length>MAX_ENTRIES)fail('qce_credential_limit');const seen=new Set();return values.map(v=>{if(!exact(v,['profileId','qqAccountId','workScope','token']))fail('qce_credentials_locked');const {token:value,...s}=v;scope(s);token(value);if(seen.has(s.profileId))fail('qce_credentials_locked');seen.add(s.profileId);return {...s,token:value};});}
 _read(){
  const io=this.io,root=io.lstatSync(this.root,{bigint:true});if(!root.isDirectory()||root.isSymbolicLink()||fileIdentity(root)!==this.rootIdentity||canonical(io.realpathSync(this.root))!==canonical(this.root))fail('qce_credentials_locked');
  let before;try{before=io.lstatSync(this.file,{bigint:true});}catch(e){if(e.code==='ENOENT')return null;throw e;}
  if(!before.isFile()||before.isSymbolicLink()||before.nlink!==1n||before.size<1n||before.size>BigInt(MAX_FILE))fail('qce_credentials_locked');let fd;
  try{
   fd=io.openSync(this.file,'r');const own=io.fstatSync(fd,{bigint:true});if(!own.isFile()||own.nlink!==1n||fileIdentity(own)!==fileIdentity(before)||own.size!==before.size||own.mtimeNs!==before.mtimeNs)fail('qce_credentials_locked');
   const buffer=Buffer.alloc(Number(own.size)+1);let n=0;while(n<buffer.length){const count=io.readSync(fd,buffer,n,buffer.length-n,null);if(!count)break;n+=count;}
   const end=io.fstatSync(fd,{bigint:true}),named=io.lstatSync(this.file,{bigint:true});if(n!==Number(own.size)||[end,named].some(s=>!s.isFile()||s.isSymbolicLink()||s.nlink!==1n||fileIdentity(s)!==fileIdentity(own)||s.size!==own.size||s.mtimeNs!==own.mtimeNs))fail('qce_credentials_locked');return {bytes:buffer.subarray(0,n),identity:fileIdentity(own)};
  }finally{if(fd!==undefined)io.closeSync(fd);}
 }
 _current(){if(this.state!=='ready')fail('qce_credentials_locked');try{const value=this._read();if((value?hash(value.bytes):null)!==this.fingerprint||(value?.identity??null)!==this.fileIdentity)throw Error();}catch{this.state='locked';this.entries=[];fail('qce_credentials_locked');}}
 _status(s){const row=this.entries.find(e=>e.profileId===s.profileId),state=!row?'empty':sameScope(row,s)?'saved':'scope_changed';return {state,saved:state==='saved',revision:this.revision};}
 status(value){const s=scope(value);try{this._current();this._vault();return this._status(s);}catch{return {state:'locked',saved:false,revision:null};}}
 capture(value){const s=scope(value);this._current();this._vault();const row=this.entries.find(e=>e.profileId===s.profileId);if(!row)fail('qce_credential_missing');if(!sameScope(row,s))fail('qce_credential_scope_changed');return {revision:this.revision,token:row.token};}
 assertCurrent(value,revision){if(!uuid(revision))fail('qce_invalid_request');const captured=this.capture(value);if(captured.revision!==revision)fail('qce_credential_revision_changed');return true;}
 _revision(expected){this._current();if(!uuid(expected))fail('qce_invalid_request');if(expected!==this.revision)fail('qce_credential_revision_changed');}
 _commit(values){
  this._current();this._vault();const entries=this._entries(values),revision=randomUUID();let cipher;
  try{const text=JSON.stringify({version:1,revision,entries});if(Buffer.byteLength(text)>MAX_PLAIN)fail('qce_credential_limit');cipher=this.vault.encryptString(text);if(!Buffer.isBuffer(cipher)||!cipher.length||cipher.length>MAX_FILE)throw Error();}catch(e){if(e.code==='qce_credential_limit')throw e;fail('qce_encryption_unavailable');}
  const staged=path.join(this.root,`.qq-qce-${randomUUID()}.pending`),expected=hash(cipher),io=this.io;let owned=null,observed;
  try{
   this._current();const fd=io.openSync(staged,'wx',0o600);try{owned=fileIdentity(io.fstatSync(fd,{bigint:true}));io.writeFileSync(fd,cipher);io.fsyncSync(fd);}finally{io.closeSync(fd);}
   this._current();const stat=io.lstatSync(staged,{bigint:true});if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1n||fileIdentity(stat)!==owned||stat.size!==BigInt(cipher.length))throw Error();
   io.renameSync(staged,this.file);observed=this._read();if(!observed||observed.identity!==owned||hash(observed.bytes)!==expected)throw Error();
  }catch{
   try{observed=this._read();}catch{}
   if(!observed||observed.identity!==owned||hash(observed.bytes)!==expected){this.state='locked';this.entries=[];fail('qce_storage_write_unknown');}
  }finally{if(owned)try{const stat=io.lstatSync(staged,{bigint:true});if(stat.isFile()&&!stat.isSymbolicLink()&&stat.nlink===1n&&fileIdentity(stat)===owned)io.unlinkSync(staged);}catch{}}
  this.entries=entries;this.revision=revision;this.fingerprint=expected;this.fileIdentity=observed.identity;
 }
 save(value,request){const s=scope(value);if(!exact(request,['token','expectedRevision']))fail('qce_invalid_request');const secret=token(request.token);this._revision(request.expectedRevision);this._commit([...this.entries.filter(e=>e.profileId!==s.profileId),{...s,token:secret}]);return this._status(s);}
 remove(value,request){const s=scope(value);if(!exact(request,['expectedRevision']))fail('qce_invalid_request');this._revision(request.expectedRevision);this._commit(this.entries.filter(e=>e.profileId!==s.profileId));return {...this._status(s),removed:true};}
}

function sameProcess(a,b){return matches(a,b)&&a.parentPid===b.parentPid;}
function installKey(v){return JSON.stringify(['installationKind','launcher','qqExe','workDir','configDir','core','selectedNapcatVersion','napcatVersion','descriptorSha256','selectionDigest'].map(k=>v[k]??null));}
function treeKey(rows){return JSON.stringify(rows.map(row=>({...identity(row),executable:canonical(row.executable),parentPid:row.parentPid})).sort((a,b)=>a.pid-b.pid));}
async function verifyQCEListener({runtime,qqAccountId,signal,assertCurrent,expectedVersion='5.5.77'}={}){
 if(!(runtime instanceof QQRuntimeManager)||typeof qqAccountId!=='string'||!/^[1-9]\d{4,11}$/.test(qqAccountId)||typeof assertCurrent!=='function')fail('qce_invalid_request');
 if(!['5.5.77',QCE.VERSION].includes(expectedVersion))fail('qce_version_unsupported');
 const outside=()=>{if(signal?.aborted)fail('qce_binding_cancelled');try{const result=assertCurrent();if(result&&typeof result.then==='function')throw Error();}catch(e){if(e.code==='qce_binding_cancelled')throw e;fail('qce_binding_changed');}};
 try{
 outside();const install=runtime.instance(qqAccountId),run=runtime.runs.get(qqAccountId);
 if(!runtime.managed||!install.available||!['managed-node','managed-shell'].includes(install.installationKind)||!run?.proof||!validProof(run.proof)||!run.lease)fail('qce_listener_unverified');
 if((install.selectedNapcatVersion||install.napcatVersion)!=='4.18.42')fail('qce_version_unsupported');
 if(expectedVersion===QCE.VERSION){if(install.installationKind!=='managed-shell')fail('qce_version_unsupported');try{if(run.lease.binding?.version!==2)fail('qce_process_unverified');QCE.assertProof(run.lease.binding.qce,install);}catch{fail('qce_process_unverified');}}
 const key=installKey(install),rootProof={...run.proof},{file:leaseFile,...expectedLease}=run.lease,leaseKey=JSON.stringify(expectedLease),runtimeId=runtime.id;
 const current=()=>{outside();if(runtime.closing||runtime.pending.has(qqAccountId)||runtime.runs.get(qqAccountId)!==run||runtime.id!==runtimeId||!matches(run.proof,rootProof)||run.proof.parentPid!==rootProof.parentPid||installKey(runtime.instance(qqAccountId))!==key)fail('qce_binding_changed');const {file,...lease}=run.lease,saved=readObject(file);if(file!==leaseFile||JSON.stringify(lease)!==leaseKey||JSON.stringify(saved)!==leaseKey||saved?.instance!==runtimeId||!runtime._validLease(saved,qqAccountId)||!matches(saved.runtime,rootProof))fail('qce_binding_changed');};
 const observe=async()=>{
  current();const rows=await runtime._processes();current();if(!matches(rows.find(p=>p.pid===rootProof.pid),rootProof))fail('qce_listener_unverified');const tree=runtime._tree(rows,rootProof,install,run.lease);if(!tree.length||tree.length>64||tree.some(p=>!validProof(identity(p))||!Number.isSafeInteger(p.parentPid)||p.parentPid<0))fail('qce_listener_unverified');
  const retained=expectedLease.runtimeTree||[],pids=[...new Set([...tree,...retained].map(p=>p.pid))];if(pids.length>128)fail('qce_listener_unverified');const inspected=validProcesses(await runtime._inspect(pids));current();
  if(tree.some(p=>!sameProcess(inspected.find(q=>q.pid===p.pid),p)))fail('qce_listener_unverified');for(const old of retained){const now=inspected.find(p=>p.pid===old.pid);if(now&&(!matches(now,old)||!tree.some(p=>sameProcess(now,p))))fail('qce_listener_unverified');}
  const listeners=await runtime.host.listeners();current();if(!Array.isArray(listeners)||listeners.length>4096||listeners.some(p=>!p||!Number.isSafeInteger(p.pid)||p.pid<1||!Number.isInteger(p.port)||p.port<1||p.port>65535||typeof p.address!=='string'||p.address.length>128))fail('qce_listener_unverified');
  const bound=listeners.filter(p=>p.port===QCE_ENDPOINT.port);if(bound.length!==1||!['127.0.0.1','0.0.0.0','::'].includes(bound[0].address))fail('qce_listener_unverified');const listener=bound[0],process=tree.find(p=>p.pid===listener.pid);if(!process)fail('qce_listener_unverified');
  let bridge=null;if(expectedVersion===QCE.VERSION){try{QCE.assertProof(run.lease.binding.qce,install);}catch{fail('qce_process_unverified');}if(!QCE.isChild(process,tree,run.lease,install))fail('qce_listener_unverified');const bridges=listeners.filter(p=>p.port===run.lease.binding.qce.bridgePort);if(bridges.length!==1||bridges[0].address!=='127.0.0.1'||bridges[0].pid!==process.parentPid)fail('qce_listener_unverified');bridge={...bridges[0],process:identity(tree.find(p=>p.pid===process.parentPid))};}
  else if(![install.qqExe,install.launcher].some(file=>canonical(file)===canonical(process.executable)))fail('qce_listener_unverified');return {tree:treeKey(tree),listener:{...listener},...(bridge?{bridge}:{}),process:{...identity(process),executable:canonical(process.executable),parentPid:process.parentPid}};
 };
 const first=await observe(),second=await observe();current();if(JSON.stringify(first)!==JSON.stringify(second))fail('qce_listener_unverified');return {...QCE_ENDPOINT,endpointId:hash(JSON.stringify({runtimeId,qqAccountId,root:rootProof,lease:hash(leaseKey),install:key,observation:second})),ownershipVerified:true};}
 catch(e){if(QCE_BINDING_CODES.includes(e?.code))throw e;fail('qce_listener_unverified');}
}
module.exports={readManagedQCEVersion:QCE.readManagedQCEVersion,QCECredentialStore,verifyQCEListener,QCE_ENDPOINT,QCE_BINDING_CODES};
