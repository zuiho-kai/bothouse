'use strict';
// Original resumable local ownership. Closing releases handles; it never discards a job.
const fs=require('node:fs'),path=require('node:path'),{createHash,randomUUID}=require('node:crypto');
const P=require('./qq-transfer-client.cjs'),{folders,checkFolders}=require('./qq-transfer-jobs.cjs');
const ST={bigint:true},tick=()=>new Promise(r=>setImmediate(r));
const same=(a,b)=>a&&b&&String(a.dev)===String(b.dev)&&String(a.ino)===String(b.ino)&&String(a.ino)!=='0';
const proof=s=>({dev:String(s.dev),ino:String(s.ino),birth:String(s.birthtimeNs),size:String(s.size),mtime:String(s.mtimeNs),ctime:String(s.ctimeNs)});
const exact=(a,b)=>same(a,b)&&String(a.size)===String(b.size)&&String(a.mtimeNs??a.mtime)===String(b.mtimeNs??b.mtime)&&String(a.ctimeNs??a.ctime)===String(b.ctimeNs??b.ctime);
const ordinary=s=>s.isFile()&&!s.isSymbolicLink()&&s.nlink===1n;
const canonical=v=>process.platform==='win32'?v.toLowerCase():v;
function check(o={}){if(o.signal?.aborted)P.fail('cancelled');const v=o.assertCurrent?.();if(v?.then){v.catch?.(()=>{});P.fail('invalid_request');}if(o.signal?.aborted)P.fail('cancelled');}
function maybe(file){try{return fs.lstatSync(file,ST);}catch(e){if(e.code==='ENOENT')return null;throw e;}}
function local(file){if(typeof file!=='string'||!path.isAbsolute(file)||/^[/\\]{2}/.test(file)||file.length>4096||/[\p{Cc}\p{Cf}\u2028\u2029]/u.test(file)||file.slice(2).includes(':'))P.fail('transfer_local_unsafe');const value=path.resolve(file),name=path.basename(value);P.name(name);if(/[<>:"|?*]|[. ]$/.test(name)||/^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(name))P.fail('transfer_local_unsafe');return value;}
async function hash(fd,size,o={}){const h=createHash('sha256'),b=Buffer.allocUnsafe(65536);try{for(let pos=0;pos<size;){check(o);const n=fs.readSync(fd,b,0,Math.min(b.length,size-pos),pos);if(n<1)P.fail('transfer_local_changed');pos+=n;h.update(b.subarray(0,n));await tick();}check(o);return h.digest('hex');}finally{b.fill(0);}}
function named(fd,file,old,{size,links=1}={}){const held=fs.fstatSync(fd,ST),actual=fs.lstatSync(file,ST);if(!held.isFile()||actual.isSymbolicLink()||!same(held,old)||!same(actual,old)||held.nlink!==BigInt(links)||actual.nlink!==BigInt(links)||size!==undefined&&held.size!==BigInt(size)||canonical(fs.realpathSync(file))!==canonical(file))P.fail('transfer_local_changed');return held;}
function closeFd(item){if(item.fd===null)return;let held;try{held=fs.fstatSync(item.fd,ST);}catch(e){if(e.code==='EBADF'){item.fd=null;return;}throw e;}if(!same(held,item.record.stat))P.fail('transfer_cleanup_unconfirmed');fs.closeSync(item.fd);item.fd=null;}
// Register immediately after open, including before the first fstat/fsync can fail.
class PendingHandle{
 constructor(stage,fd,file,remove=false){Object.assign(this,{stage,fd,file,remove,identity:null});stage.resources.add(this);}
 release(){this.stage.resources.delete(this);this.fd=null;}
 async close(){try{if(this.fd!==null){const st=fs.fstatSync(this.fd,ST);if(this.identity&&!same(st,this.identity))P.fail('transfer_cleanup_unconfirmed');this.identity??=proof(st);fs.closeSync(this.fd);this.fd=null;}
  if(this.remove){const st=maybe(this.file);if(st){if(!ordinary(st)||!same(st,this.identity)||canonical(fs.realpathSync(this.file))!==canonical(this.file))P.fail('transfer_cleanup_unconfirmed');fs.unlinkSync(this.file);}this.remove=false;}
  this.stage.resources.delete(this);return {closed:true};
 }catch{P.fail('transfer_cleanup_unconfirmed');}}
}
class UploadSource{
 constructor(stage,file,fd,record){this.stage=stage;this.file=file;this.fd=fd;this.record=record;this.closed=false;stage.resources.add(this);}
 async verify(o={}){check(o);if(this.closed)P.fail('closed');checkFolders(this.record.parents);const held=named(this.fd,this.file,this.record.stat,{size:this.record.size});if(!exact(held,this.record.stat)||await hash(this.fd,this.record.size,o)!==this.record.sha256||!exact(held,named(this.fd,this.file,this.record.stat,{size:this.record.size})))P.fail('transfer_local_changed');return true;}
 async read(offset,length,o={}){check(o);if(this.closed)P.fail('closed');P.integer(offset,this.record.size);P.integer(length,P.LIMITS.chunk);if(!length||offset+length>this.record.size)P.fail('invalid_request');checkFolders(this.record.parents);const before=named(this.fd,this.file,this.record.stat,{size:this.record.size});if(!exact(before,this.record.stat))P.fail('transfer_local_changed');const b=Buffer.alloc(length);let n=0;while(n<length){check(o);const read=fs.readSync(this.fd,b,n,length-n,offset+n);if(!read)P.fail('transfer_local_changed');n+=read;}if(!exact(before,named(this.fd,this.file,this.record.stat,{size:this.record.size})))P.fail('transfer_local_changed');return b;}
 async close(){if(this.closed)return {closed:true};try{closeFd(this);this.closed=true;this.stage.resources.delete(this);return {closed:true};}catch{P.fail('transfer_cleanup_unconfirmed');}}
}
class PartialDownload{
 constructor(stage,record,fd){this.stage=stage;this.record=structuredClone(record);this.fd=fd;this.closed=false;this.finishing=false;stage.resources.add(this);}
 snapshot(){return structuredClone(this.record);}
 _current(o={}){check(o);if(this.closed||this.fd===null)P.fail('closed');checkFolders(this.record.parents);return named(this.fd,this.record.temp,this.record.stat,{size:this.record.bytes});}
 async verify(o={}){const before=this._current(o);if(await hash(this.fd,this.record.bytes,o)!==this.record.prefixSha256||!exact(before,this._current(o)))P.fail('transfer_local_changed');return true;}
 async append(offset,bytes,o={}){if(!Buffer.isBuffer(bytes)||!bytes.length||bytes.length>P.LIMITS.chunk||offset!==this.record.bytes||offset+bytes.length>P.LIMITS.download||this.finishing)P.fail('invalid_request');this._current(o);let pos=0;while(pos<bytes.length){check(o);const n=fs.writeSync(this.fd,bytes,pos,bytes.length-pos,offset+pos);if(!n)P.fail('storage_failed');pos+=n;}fs.fsyncSync(this.fd);const next=named(this.fd,this.record.temp,this.record.stat,{size:offset+bytes.length}),digest=await hash(this.fd,offset+bytes.length,o);if(!exact(next,named(this.fd,this.record.temp,this.record.stat,{size:offset+bytes.length})))P.fail('transfer_local_changed');this.record={...this.record,stat:proof(next),bytes:offset+bytes.length,prefixSha256:digest};return this.snapshot();}
 async publish({length,sha256,...o}){P.integer(length);if(!P.HEX.test(sha256)||this.finishing)P.fail('invalid_request');this.finishing=true;try{await this.verify(o);if(this.record.bytes!==length||this.record.prefixSha256!==sha256)P.fail('integrity_failed');check(o);if(maybe(this.record.target))P.fail('target_exists');this._current(o);fs.fsyncSync(this.fd);check(o);fs.linkSync(this.record.temp,this.record.target);const linked=named(this.fd,this.record.target,this.record.stat,{size:length,links:2});if(await hash(this.fd,length,o)!==sha256||!exact(linked,named(this.fd,this.record.target,this.record.stat,{size:length,links:2})))P.fail('transfer_unknown');check(o);fs.unlinkSync(this.record.temp);const published=named(this.fd,this.record.target,this.record.stat,{size:length});if(await hash(this.fd,length,o)!==sha256||!exact(published,named(this.fd,this.record.target,this.record.stat,{size:length})))P.fail('transfer_unknown');this.record={...this.record,stat:proof(published),published:true};return {saved:true,bytes:length,sha256};}catch(e){throw new P.QQTransferError(e?.code==='target_exists'?'target_exists':'transfer_unknown');}finally{this.finishing=false;}}
 async close(){if(this.closed)return {closed:true};if(this.finishing)P.fail('transfer_cleanup_unconfirmed');try{closeFd(this);this.closed=true;this.stage.resources.delete(this);return {closed:true};}catch{P.fail('transfer_cleanup_unconfirmed');}}
}
class QQTransferStage{
 constructor(){this.resources=new Set();this.closed=false;}
 async releaseJob(job){
  for(const resource of [...this.resources]){
   const selected=typeof job.source?.file==='string'&&resource.file===job.source.file?job.source:resource.record?.temp===job.target?.temp&&job.target?.temp?job.target:null;
   if(!selected)continue;
   if(resource.fd!==null&&!same(fs.fstatSync(resource.fd,ST),selected.stat))P.fail('transfer_cleanup_unconfirmed');
   const result=await resource.close();if(result?.closed!==true)P.fail('transfer_cleanup_unconfirmed');
  }
  return {closed:true};
 }
 async prepareUpload(file,o={}){check(o);if(this.closed)P.fail('closed');file=local(file);const parents=folders(path.dirname(file)).proof,before=fs.lstatSync(file,ST);if(!ordinary(before)||before.size>BigInt(P.LIMITS.upload)||canonical(fs.realpathSync(file))!==canonical(file))P.fail('transfer_local_unsafe');let source;const fd=fs.openSync(file,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW||0)),pending=new PendingHandle(this,fd,file);try{if(!exact(before,fs.fstatSync(fd,ST)))P.fail('transfer_local_changed');source=new UploadSource(this,file,fd,{file,parents,stat:proof(before),size:Number(before.size),name:path.basename(file),sha256:''});pending.release();source.record.sha256=await hash(fd,source.record.size,o);await source.verify(o);return source;}catch(e){if(source)await source.close();else await pending.close();throw e;}}
 async reopenUpload(record,o={}){if(!P.plain(record)||!P.HEX.test(record.sha256))P.fail('transfer_local_changed');const source=await this.prepareUpload(record.file,o);try{if(!exact(source.record.stat,record.stat)||source.record.size!==record.size||source.record.sha256!==record.sha256||JSON.stringify(source.record.parents)!==JSON.stringify(record.parents))P.fail('transfer_local_changed');return source;}catch(e){await source.close();throw e;}}
 prepareTarget(file){if(this.closed)P.fail('closed');file=local(file);const parents=folders(path.dirname(file)).proof;if(maybe(file))P.fail('target_exists');return {target:file,parents,expectedAbsent:true};}
 async createDownload(target,jobId,o={}){check(o);P.uuid(jobId);if(this.closed||!P.plain(target)||target.expectedAbsent!==true)P.fail('invalid_request');local(target.target);checkFolders(target.parents);if(maybe(target.target))P.fail('target_exists');const temp=path.join(path.dirname(target.target),`.arcade-transfer-${jobId}-${randomUUID()}.part`);let fd=null,pending=null;try{fd=fs.openSync(temp,'wx+',0o600);pending=new PendingHandle(this,fd,temp,true);const st=fs.fstatSync(fd,ST);if(!ordinary(st))P.fail('transfer_local_unsafe');fs.fsyncSync(fd);const result=new PartialDownload(this,{...target,temp,stat:proof(st),bytes:0,prefixSha256:P.sha(Buffer.alloc(0)),published:false},fd);pending.release();return result;}catch(e){if(pending)await pending.close();throw e;}}
 async reopenDownload(record,{pending=null,...o}={}){check(o);if(this.closed||!P.plain(record)||record.published||!P.HEX.test(record.prefixSha256))P.fail('transfer_local_changed');local(record.target);local(record.temp);if(path.dirname(record.temp)!==path.dirname(record.target)||!/^\.arcade-transfer-[a-f0-9-]{36}-[a-f0-9-]{36}\.part$/.test(path.basename(record.temp)))P.fail('transfer_local_unsafe');checkFolders(record.parents);const before=fs.lstatSync(record.temp,ST);if(!ordinary(before)||!same(before,record.stat)||before.size<BigInt(record.bytes)||before.size>BigInt(P.LIMITS.download))P.fail('transfer_local_changed');const fd=fs.openSync(record.temp,'r+'),owner=new PendingHandle(this,fd,record.temp);let item;try{if(!exact(before,fs.fstatSync(fd,ST)))P.fail('transfer_local_changed');if(await hash(fd,record.bytes,o)!==record.prefixSha256)P.fail('transfer_local_changed');if(before.size!==BigInt(record.bytes)){if(!pending||pending.kind!=='chunk'||pending.state!=='attempted'||pending.from!==record.bytes||pending.to<Number(before.size))P.fail('transfer_local_changed');check(o);if(!exact(before,named(fd,record.temp,record.stat,{size:Number(before.size)})))P.fail('transfer_local_changed');fs.ftruncateSync(fd,record.bytes);fs.fsyncSync(fd);}const actual=named(fd,record.temp,record.stat,{size:record.bytes});item=new PartialDownload(this,{...record,stat:proof(actual)},fd);owner.release();await item.verify(o);return item;}catch(e){if(item)await item.close();else await owner.close();throw e;}}
 async inspectPublished(record,{length,sha256,...o}){
  check(o);local(record.target);local(record.temp);checkFolders(record.parents);
  const target=maybe(record.target);if(!target)return {saved:false};
  if(!target.isFile()||target.isSymbolicLink()||!same(target,record.stat)||target.size!==BigInt(length)||![1n,2n].includes(target.nlink))P.fail('transfer_local_changed');
  const fd=fs.openSync(record.target,'r'),owner=new PendingHandle(this,fd,record.target);try{
   const before=named(fd,record.target,record.stat,{size:length,links:Number(target.nlink)});
   if(!exact(before,target)||await hash(fd,length,o)!==sha256)P.fail('integrity_failed');
   checkFolders(record.parents);if(!exact(before,named(fd,record.target,record.stat,{size:length,links:Number(target.nlink)})))P.fail('transfer_local_changed');
   const temp=maybe(record.temp);
   if(temp){
    if(path.dirname(record.temp)!==path.dirname(record.target)||!same(temp,target)||temp.isSymbolicLink()||target.nlink!==2n)P.fail('transfer_local_changed');
    check(o);checkFolders(record.parents);
    if(!exact(before,named(fd,record.target,record.stat,{size:length,links:2}))||!exact(temp,fs.lstatSync(record.temp,ST)))P.fail('transfer_local_changed');
    fs.unlinkSync(record.temp);
   }
   const after=named(fd,record.target,record.stat,{size:length});
   if(await hash(fd,length,o)!==sha256)P.fail('integrity_failed');
   checkFolders(record.parents);if(!exact(after,named(fd,record.target,record.stat,{size:length})))P.fail('transfer_local_changed');
   return {saved:true,bytes:length,sha256};
  }finally{await owner.close();}
 }
 async discard(record,o={}){check(o);if(record.published)return {discarded:false};local(record.temp);checkFolders(record.parents);const st=maybe(record.temp);if(!st)return {discarded:true};if(!ordinary(st)||!same(st,record.stat))P.fail('transfer_cleanup_unconfirmed');const fd=fs.openSync(record.temp,'r'),owner=new PendingHandle(this,fd,record.temp);try{if(!same(fs.fstatSync(fd,ST),st)||await hash(fd,record.bytes,o)!==record.prefixSha256)P.fail('transfer_cleanup_unconfirmed');check(o);if(!exact(st,fs.lstatSync(record.temp,ST)))P.fail('transfer_cleanup_unconfirmed');fs.unlinkSync(record.temp);return {discarded:true};}finally{await owner.close();}}
 async close(){this.closed=true;let failed=false;for(const resource of [...this.resources])try{await resource.close();}catch{failed=true;}if(failed)P.fail('transfer_cleanup_unconfirmed');return {closed:true};}
}
module.exports={QQTransferStage,UploadSource,PartialDownload,hash,proof,same,exact};
