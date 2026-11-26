'use strict';
// Optional helper credentials have their own encrypted container. No model or QQ vault migration.
const fs=require('node:fs'),path=require('node:path');
const {randomUUID,createHash}=require('node:crypto');
const MAX_BYTES=2*1024*1024,MAX_ENTRIES=16;
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const clone=value=>structuredClone(value);
const fail=code=>{throw Object.assign(Error(`Transfer links: ${code}`),{code});};
const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&Object.getPrototypeOf(v)===Object.prototype;
const exact=(v,keys)=>plain(v)&&Object.keys(v).every(k=>keys.includes(k));
const uuid=v=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(v);
const text=(v,min,max)=>typeof v==='string'&&v.length>=min&&v.length<=max&&v.trim()===v&&!/[\p{Cc}\p{Cf}\p{Cs}\u2028\u2029]/u.test(v);
const identity=s=>`${s.dev}:${s.ino}:${s.birthtimeNs??s.birthtimeMs}`;
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);

class QQTransferLinks {
 constructor({root,vault,validateOrigin,validateTrust}={}){
  if(typeof root!=='string'||!path.isAbsolute(root)||typeof validateOrigin!=='function'||typeof validateTrust!=='function')fail('invalid_config');
  Object.assign(this,{root:path.resolve(root),vault,validateOrigin,validateTrust,state:'ready',entries:[],fingerprint:null,fileIdentity:null,rootIdentity:null,leases:new Map()});
  try{
   if(!fs.existsSync(this.root))fs.mkdirSync(this.root,{recursive:true,mode:0o700});
   const stat=fs.lstatSync(this.root,{bigint:true});if(!stat.isDirectory()||stat.isSymbolicLink())fail('unsafe_storage');
   this.root=fs.realpathSync(this.root);this.rootIdentity=identity(stat);this.file=path.join(this.root,'qq-transfer-links.json');
   const observed=this._read();this.fingerprint=observed?hash(observed.bytes):null;this.fileIdentity=observed?.identity??null;
   if(observed){
    if(!vault?.isEncryptionAvailable())fail('credentials_locked');
    const envelope=JSON.parse(observed.bytes.toString('utf8'));
    if(!exact(envelope,['version','data'])||envelope.version!==1||typeof envelope.data!=='string'||!envelope.data||!/^[A-Za-z0-9+/]+={0,2}$/.test(envelope.data))fail('invalid_storage');
    const decrypted=vault.decryptString(Buffer.from(envelope.data,'base64'));
    if(typeof decrypted!=='string'||Buffer.byteLength(decrypted)>MAX_BYTES)fail('invalid_storage');
    const stored=JSON.parse(decrypted);
    if(!exact(stored,['version','entries'])||stored.version!==1||!Array.isArray(stored.entries))fail('invalid_storage');
    this.entries=this._entries(stored.entries);
   }
  }catch{this.state='locked';this.entries=[];}
 }
 _entry(v){
  if(!exact(v,['helperId','remoteId','remoteRevision','label','origin','instanceId','revision','trustRevision','credentialRevision','trust','token'])||
   !['helperId','remoteId','remoteRevision','instanceId','revision','trustRevision','credentialRevision'].every(k=>uuid(v[k]))||!text(v.label,1,64)||typeof v.token!=='string'||! /^[A-Za-z0-9_-]{43,256}$/.test(v.token))fail('invalid_registration');
  const origin=this.validateOrigin(v.origin),trust=this.validateTrust(v.trust);
  if(origin!==v.origin)fail('invalid_registration');return {...clone(v),origin,trust:clone(trust)};
 }
 _entries(values){
  if(values.length>MAX_ENTRIES)fail('registration_limit');const entries=values.map(v=>this._entry(v));
  if(['helperId','remoteId','origin','instanceId'].some(k=>new Set(entries.map(v=>v[k])).size!==entries.length))fail('helper_registered');
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
 _find(helperId){this._current();if(!uuid(helperId))fail('invalid_request');const e=this.entries.find(v=>v.helperId===helperId);if(!e)fail('helper_not_found');return e;}
 _match(helperId,revision){const e=this._find(helperId);if(e.revision!==revision)fail('registration_changed');return e;}
 _public(e){const {token,trust,...rest}=e;return {...clone(rest),trust:{privateCA:!!trust.caPem,spkiSha256:trust.spkiSha256||null},credentialState:'saved'};}
 snapshot(){try{this._current();return {state:'ready',items:this.entries.map(e=>this._public(e))};}catch{return {state:'locked',items:[]};}}
 list(){return this.snapshot();}
 capture(helperId){return clone(this._find(helperId));}
 _commit(values){
  this._current();const entries=this._entries(values);if(!this.vault?.isEncryptionAvailable())fail('encryption_unavailable');
  let bytes;try{
   const encrypted=this.vault.encryptString(JSON.stringify({version:1,entries}));if(!Buffer.isBuffer(encrypted)||!encrypted.length)throw Error();
   bytes=Buffer.from(JSON.stringify({version:1,data:encrypted.toString('base64')}));if(bytes.length>MAX_BYTES)fail('storage_limit');
  }catch(e){if(e.code==='storage_limit')throw e;fail('encryption_unavailable');}
  const fingerprint=hash(bytes),staged=path.join(this.root,`.qq-transfer-links-${randomUUID()}.pending`);let owned=null,observed;
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
  if(!exact(input,['remoteId','remoteRevision','label','origin','instanceId','trust','token']))fail('invalid_request');this._current();
  const entry=this._entry({...input,origin:this.validateOrigin(input.origin),helperId:randomUUID(),revision:randomUUID(),trustRevision:randomUUID(),credentialRevision:randomUUID()});
  this._commit([...this.entries,entry]);return this._public(entry);
 }
 update(input){
  if(!exact(input,['helperId','revision','patch'])||!exact(input.patch,['remoteRevision','label','origin','instanceId','trust','token'])||!Object.keys(input.patch).length)fail('invalid_request');
  const old=this._match(input.helperId,input.revision);if(this.leases.has(old.helperId))fail('operation_in_progress');
  const next=this._entry({...old,...input.patch,...('origin'in input.patch?{origin:this.validateOrigin(input.patch.origin)}:{}),revision:randomUUID(),trustRevision:('trust'in input.patch||'origin'in input.patch)?randomUUID():old.trustRevision,credentialRevision:'token'in input.patch?randomUUID():old.credentialRevision});
  this._commit(this.entries.map(v=>v.helperId===old.helperId?next:v));return this._public(next);
 }
 forget(input){
  if(!exact(input,['helperId','revision']))fail('invalid_request');const old=this._match(input.helperId,input.revision);if(this.leases.has(old.helperId))fail('operation_in_progress');
  this._commit(this.entries.filter(v=>v.helperId!==old.helperId));return {forgotten:true};
 }
 async withOperation(input,operation){
  if(!exact(input,['helperId','revision'])||typeof operation!=='function')fail('invalid_request');const entry=this._match(input.helperId,input.revision),id=entry.helperId;
  if(this.leases.has(id))fail('operation_in_progress');const key={};this.leases.set(id,key);
  const assertCurrent=()=>{if(this.leases.get(id)!==key)fail('operation_closed');const next=this._match(id,entry.revision);if(!equal(next,entry))fail('registration_changed');return next;};
  try{return await operation({assertCurrent,capture:()=>clone(assertCurrent())});}finally{if(this.leases.get(id)===key)this.leases.delete(id);}
 }
}
module.exports={QQTransferLinks,MAX_ENTRIES};
