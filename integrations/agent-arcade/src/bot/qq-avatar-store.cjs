'use strict';
// Private upload spool. Only capabilities created here may supply bridge paths.
// Unknown uploads survive restarts; cleanup deletes local artifacts, not QQ state.
const fs=require('node:fs'),path=require('node:path');
const {randomUUID,createHash}=require('node:crypto');
const {validateImagePayload}=require('./qq-media.cjs');
const {fail,uuid}=require('./qq-avatar.cjs');
const MAX_FILES=8,MAX_BYTES=32*1024*1024,MAX_IMAGE=4*1024*1024,EXPIRY=24*60*60*1000;
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const stat=file=>fs.lstatSync(file,{bigint:true});
const regular=s=>s.isFile()&&!s.isSymbolicLink()&&s.nlink===1n;
const proof=s=>({dev:String(s.dev),ino:String(s.ino),size:String(s.size),birth:String(s.birthtimeNs),mtime:String(s.mtimeNs),ctime:String(s.ctimeNs)});
const same=(a,b)=>regular(b)&&Object.entries(a).every(([k,v])=>proof(b)[k]===v);
function directory(root){
 if(typeof root!=='string'||!path.isAbsolute(root)||/^[/\\]{2}/.test(root)||/[\x00-\x1f]/.test(root)||root.slice(path.parse(root).root.length).includes(':'))fail('upload_store_unavailable');
 let current=path.parse(root).root;for(const part of path.relative(current,path.resolve(root)).split(path.sep)){current=path.join(current,part);const s=stat(current);if(!s.isDirectory()||s.isSymbolicLink())fail('upload_store_unavailable');}
 const s=stat(root);return {dev:s.dev,ino:s.ino,birth:s.birthtimeNs};
}
function readFd(fd,size){if(!Number.isSafeInteger(size)||size<1||size>MAX_IMAGE)fail('upload_file_changed');const bytes=Buffer.alloc(size+1);let n=0;while(n<bytes.length){const count=fs.readSync(fd,bytes,n,bytes.length-n,n);if(!count)break;n+=count;}if(n!==size){bytes.fill(0);fail('upload_file_changed');}return bytes.subarray(0,size);}
class QQAvatarUploadStore{
 constructor({root,now=Date.now}={}){if(typeof now!=='function')fail('invalid_request');this.root=path.resolve(root||'');this.now=now;this.active=new Map();if(typeof root!=='string'||!path.isAbsolute(root))fail('invalid_request');
  const parent=path.dirname(this.root);directory(parent);try{fs.mkdirSync(this.root,{mode:0o700});}catch(error){if(error.code!=='EEXIST')fail('upload_store_unavailable');}this.rootProof=directory(this.root);
 }
 _root(){const next=directory(this.root);if(Object.keys(next).some(k=>next[k]!==this.rootProof[k]))fail('upload_store_unavailable');}
 _path(id,extension){if(!uuid(id))fail('upload_store_unavailable');return path.join(this.root,`${id}.${extension}`);}
 _read(id){
  this._root();const file=this._path(id,'png'),recordFile=this._path(id,'json');let fd,bytes;
  try{const a=stat(recordFile);if(!regular(a)||a.size<1n||a.size>4096n)fail('upload_file_changed');fd=fs.openSync(recordFile,'r');if(!same(proof(a),fs.fstatSync(fd,{bigint:true})))fail('upload_file_changed');bytes=readFd(fd,Number(a.size));if(!same(proof(a),fs.fstatSync(fd,{bigint:true}))||!same(proof(a),stat(recordFile)))fail('upload_file_changed');const record=JSON.parse(bytes.toString('utf8'));
   if(record.schema!=='qq_avatar_upload_v1'||record.id!==id||!['prepared','attempted','settled'].includes(record.phase)||!Number.isSafeInteger(record.createdAt)||record.createdAt<0||!Number.isSafeInteger(record.expiresAt)||record.expiresAt!==record.createdAt+EXPIRY||!/^[a-f0-9]{64}$/.test(record.scope)||!/^[a-f0-9]{64}$/.test(record.sha256)||!record.file||Object.keys(record.file).sort().join('|')!=='birth|ctime|dev|ino|mtime|size')fail('upload_file_changed');
   const imageStat=stat(file);if(!same(record.file,imageStat)||imageStat.size<1n||imageStat.size>BigInt(MAX_IMAGE))fail('upload_file_changed');return {record,file,recordFile,recordProof:proof(a)};
  }catch(error){if(error?.code==='upload_store_unavailable')throw error;fail('upload_file_changed');}finally{bytes?.fill(0);if(fd!==undefined)fs.closeSync(fd);}
 }
 _scan(){this._root();const names=fs.readdirSync(this.root);if(names.length>MAX_FILES*2+2)fail('upload_store_full');const ids=new Set();let unknown=0;for(const name of names){const match=/^([a-f0-9-]{36})\.(png|json)$/.exec(name);if(match&&uuid(match[1]))ids.add(match[1]);else unknown++;}return {ids,unknown};}
 summary(scope){const {ids,unknown}=this._scan();let retainedCount=0,unsafeCount=unknown;for(const id of ids){if(this.active.has(id))continue;try{const row=this._read(id);if(row.record.scope===scope)retainedCount++;}catch{unsafeCount++;}}return {retainedCount,unsafeCount};}
 create(bytes,scope){
  const dims=validateImagePayload(bytes);if(dims.width!==dims.height)fail('image_not_square');if(typeof scope!=='string'||!/^[a-f0-9]{64}$/.test(scope))fail('invalid_request');this.cleanup(scope,{expiredOnly:true});
  const {ids,unknown}=this._scan();if(unknown)fail('upload_store_unavailable');if(ids.size>=MAX_FILES)fail('upload_store_full');let total=0;for(const id of ids){const row=this._read(id);total+=Number(row.record.file.size);}if(total+bytes.length>MAX_BYTES)fail('upload_store_full');
  const id=randomUUID(),file=this._path(id,'png'),recordFile=this._path(id,'json');let fd,rfd;
  try{this._root();fd=fs.openSync(file,'wx+',0o600);fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);const initial=fs.fstatSync(fd,{bigint:true});if(!same(proof(initial),stat(file)))fail('upload_file_changed');const createdAt=this.now();if(!Number.isSafeInteger(createdAt)||createdAt<0)fail('invalid_request');
   const record={schema:'qq_avatar_upload_v1',id,phase:'prepared',createdAt,expiresAt:createdAt+EXPIRY,scope,sha256:hash(bytes),file:proof(initial)};
   rfd=fs.openSync(recordFile,'wx+',0o600);const writeRecord=()=>{const raw=Buffer.from(JSON.stringify(record));fs.ftruncateSync(rfd,0);fs.writeSync(rfd,raw,0,raw.length,0);fs.fsyncSync(rfd);const check=readFd(rfd,raw.length);const equal=check.equals(raw);check.fill(0);if(!equal)fail('upload_file_changed');};writeRecord();let recordProof=proof(fs.fstatSync(rfd,{bigint:true}));let ended=false;
   const check=()=>{if(ended)fail('upload_file_changed');this._root();if(!same(record.file,stat(file))||!same(record.file,fs.fstatSync(fd,{bigint:true}))||!same(recordProof,stat(recordFile))||!same(recordProof,fs.fstatSync(rfd,{bigint:true})))fail('upload_file_changed');const current=readFd(fd,bytes.length);try{if(hash(current)!==record.sha256)fail('upload_file_changed');}finally{current.fill(0);}};
   const phase=next=>{check();record.phase=next;writeRecord();recordProof=proof(fs.fstatSync(rfd,{bigint:true}));check();};
   const finish=remove=>{if(ended)return {removed:false};let removed=false;try{check();if(remove){fs.unlinkSync(file);removed=true;if(same(recordProof,stat(recordFile)))fs.unlinkSync(recordFile);}}catch{}finally{ended=true;this.active.delete(id);try{fs.closeSync(fd);}catch{}try{fs.closeSync(rfd);}catch{}}return {removed,retained:!removed};};
   const upload=Object.freeze({id,file,assertIntact:check,markAttempted:()=>phase('attempted'),markSettled:()=>phase('settled'),discard:()=>finish(true),retain:()=>finish(false)});this.active.set(id,upload);check();return upload;
  }catch(error){if(fd!==undefined)try{fs.closeSync(fd);}catch{}if(rfd!==undefined)try{fs.closeSync(rfd);}catch{}this.active.delete(id);if(error?.code?.startsWith('upload_')||error?.code==='invalid_request')throw error;fail('upload_store_unavailable');}
 }
 cleanup(scope,{expiredOnly=false}={}){
  if(typeof scope!=='string'||!/^[a-f0-9]{64}$/.test(scope))fail('invalid_request');const {ids,unknown}=this._scan();let removed=0,retained=unknown;
  for(const id of ids){if(this.active.has(id)){retained++;continue;}let fd;try{const row=this._read(id);if(row.record.scope!==scope)continue;
    // Never use a timer/restart as evidence that an ambiguous QQ write ended.
    if(expiredOnly&&(row.record.phase==='attempted'||this.now()<row.record.expiresAt))continue;
    fd=fs.openSync(row.file,'r');if(!same(row.record.file,fs.fstatSync(fd,{bigint:true})))fail('upload_file_changed');const content=readFd(fd,Number(row.record.file.size));try{if(hash(content)!==row.record.sha256)fail('upload_file_changed');}finally{content.fill(0);}
    this._root();if(!same(row.record.file,stat(row.file))||!same(row.record.file,fs.fstatSync(fd,{bigint:true}))||!same(row.recordProof,stat(row.recordFile)))fail('upload_file_changed');fs.unlinkSync(row.file);removed++;if(same(row.recordProof,stat(row.recordFile)))fs.unlinkSync(row.recordFile);
   }catch{retained++;}finally{if(fd!==undefined)try{fs.closeSync(fd);}catch{}}
  }return {removed,retained,...(retained?{code:'cleanup_incomplete'}:{})};
 }
}
module.exports={QQAvatarUploadStore,EXPIRY,MAX_FILES};
