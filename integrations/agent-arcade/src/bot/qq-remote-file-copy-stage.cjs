'use strict';
// Original private byte spool. Remote names never become local filesystem paths.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {randomUUID,createHash}=require('node:crypto'),{crc32}=require('node:zlib'),yauzl=require('yauzl');
const {QQHeldZipReader}=require('./qq-held-zip-reader.cjs');
const P=require('./qq-remote-policy.cjs'),F=require('./qq-remote-files-policy.cjs');
const LIMITS=Object.freeze({file:64*1024*1024,data:128*1024*1024,archive:128*1024*1024,spool:512*1024*1024,entries:4096,depth:32,ratio:250});
const ST={bigint:true},same=(a,b)=>!!a&&!!b&&a.ino>0n&&a.ino===b.ino&&a.dev===b.dev;
const regular=s=>s.isFile()&&!s.isSymbolicLink()&&s.nlink===1n;
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function check(o={}){if(o.signal?.aborted)P.fail('cancelled');const result=o.assertCurrent?.();if(result?.then){result.catch?.(()=>{});P.fail('invalid_request');}if(o.signal?.aborted)P.fail('cancelled');}
function hash(fd,size){const out=createHash('sha256'),buf=Buffer.allocUnsafe(65536);try{for(let at=0;at<size;){const n=fs.readSync(fd,buf,0,Math.min(buf.length,size-at),at);if(n<1)P.fail('file_baseline_changed');out.update(buf.subarray(0,n));at+=n;}return out.digest('hex');}finally{buf.fill(0);}}
class Blob{
 constructor(owner,max){this.owner=owner;this.max=max;this.fd=null;this.path=null;this.proof=null;this.bytes=0;this.sealed=false;this.sha256=null;}
 assert(){this.owner.assert();if(this.fd===null)P.fail('closed');const named=fs.lstatSync(this.path,ST),held=fs.fstatSync(this.fd,ST);if(!regular(named)||!regular(held)||!same(named,this.proof)||!same(held,this.proof)||named.size!==held.size||named.mtimeNs!==held.mtimeNs||this.sealed&&(held.size!==BigInt(this.bytes)||held.mtimeNs!==this.proof.mtimeNs))P.fail('file_baseline_changed');}
 async write(bytes,o={}){check(o);this.assert();if(this.sealed||!Buffer.isBuffer(bytes))P.fail('invalid_request');if(this.bytes+bytes.length>this.max||this.owner.written+bytes.length>LIMITS.spool)P.fail('file_transfer_too_large');let at=0;while(at<bytes.length){const n=fs.writeSync(this.fd,bytes,at,bytes.length-at,this.bytes+at);if(n<1)P.fail('file_upload_unavailable');at+=n;}this.bytes+=bytes.length;this.owner.written+=bytes.length;}
 async finish(o={}){check(o);this.assert();fs.fsyncSync(this.fd);this.sha256=hash(this.fd,this.bytes);this.proof=fs.fstatSync(this.fd,ST);this.sealed=true;this.assert();check(o);return {saved:true,bytes:this.bytes,sha256:this.sha256,archiveVerified:false};}
 async verify(o={}){check(o);this.assert();if(!this.sealed||hash(this.fd,this.bytes)!==this.sha256)P.fail('file_baseline_changed');this.assert();check(o);}
 async *chunks(o={}){await this.verify(o);const h=createHash('sha256');for(let at=0;at<this.bytes;){check(o);this.assert();const b=Buffer.allocUnsafe(Math.min(65536,this.bytes-at));if(fs.readSync(this.fd,b,0,b.length,at)!==b.length)P.fail('file_baseline_changed');at+=b.length;h.update(b);yield b;}check(o);this.assert();if(h.digest('hex')!==this.sha256)P.fail('file_baseline_changed');}
 async close(){if(this.fd===null){if(this.path&&fs.existsSync(this.path))P.fail('file_cleanup_unconfirmed');this.owner.blobs.delete(this);return {closed:true};}if(this.path){this.assert();if(this.sealed&&hash(this.fd,this.bytes)!==this.sha256)P.fail('file_cleanup_unconfirmed');fs.unlinkSync(this.path);this.path=null;}else{let held;try{held=fs.fstatSync(this.fd,ST);}catch(e){if(e.code!=='EBADF')throw e;this.fd=null;this.owner.blobs.delete(this);return {closed:true};}if(!same(held,this.proof))P.fail('file_cleanup_unconfirmed');}fs.closeSync(this.fd);this.fd=null;this.owner.blobs.delete(this);return {closed:true};}
}
class QQRemoteCopyStage{
 constructor({temporaryRoot}={}){this.temporaryRoot=temporaryRoot;this.dir=null;this.parent=null;this.dirProof=null;this.parentProof=null;this.blobs=new Set();this.written=0;this.closed=false;this.closing=null;}
 _init(){if(this.closed)P.fail('closed');if(this.dir)return;this.parent=fs.realpathSync(this.temporaryRoot||os.tmpdir());this.parentProof=fs.lstatSync(this.parent,ST);if(!this.parentProof.isDirectory()||this.parentProof.isSymbolicLink())P.fail('file_upload_unavailable');this.dir=fs.mkdtempSync(path.join(this.parent,'arcade-copy-'));this.dirProof=fs.lstatSync(this.dir,ST);fs.chmodSync(this.dir,0o700);this.assert();}
 assert(){if(!this.dir)P.fail('closed');const parent=fs.lstatSync(this.parent,ST),dir=fs.lstatSync(this.dir,ST);if(!parent.isDirectory()||parent.isSymbolicLink()||!same(parent,this.parentProof)||!dir.isDirectory()||dir.isSymbolicLink()||!same(dir,this.dirProof)||fs.realpathSync(this.dir)!==this.dir)P.fail('file_cleanup_unconfirmed');}
 create(max=LIMITS.archive){this._init();this.assert();if(this.closed||this.blobs.size>=LIMITS.entries*2+80)P.fail('files_limit');const b=new Blob(this,max);this.blobs.add(b);b.path=path.join(this.dir,randomUUID()+'.bytes');b.fd=fs.openSync(b.path,'wx+',0o600);b.proof=fs.fstatSync(b.fd,ST);if(!regular(b.proof))P.fail('file_upload_unavailable');return b;}
 sources(rows){const stage=this;return {files:rows.map(r=>({name:r.name,size:r.blob.bytes,sha256:r.blob.sha256})),totalBytes:rows.reduce((n,r)=>n+r.blob.bytes,0),async verify(o){for(const r of rows)await r.blob.verify(o);},async *chunks(index,o){if(!Number.isSafeInteger(index)||!rows[index])P.fail('invalid_request');stage.assert();yield* rows[index].blob.chunks(o);}};}
 async archive(blob,baseName,style,o={}){
  await blob.verify(o);let zip;const files=[],dirs=new Set(),seen=new Map(),offset=baseName===null?0:1;let total=0,count=0;
  try{
   zip=await yauzl.fromRandomAccessReaderPromise(new QQHeldZipReader({fd:blob.fd,assert:()=>{check(o);blob.assert();}}),blob.bytes,{lazyEntries:true,autoClose:false,strictFileNames:true,validateEntrySizes:true});if(zip.entryCount>LIMITS.entries)P.fail('file_archive_invalid');
   for await(const entry of zip.eachEntry()){
    check(o);blob.assert();if(++count>LIMITS.entries)P.fail('file_archive_invalid');const directory=entry.fileName.endsWith('/'),full=directory?entry.fileName.slice(0,-1):entry.fileName,parts=full.split('/');
    if(parts.length>LIMITS.depth+offset||offset&&parts[0]!==baseName||parts.some(p=>{try{F.name(p,style);return false;}catch{return true;}}))P.fail('file_archive_invalid');
    if(offset&&parts.length===1&&!directory)P.fail('file_archive_invalid');const type=(entry.externalFileAttributes>>>16)&0xf000;
    if(entry.isEncrypted()||![0,8].includes(entry.compressionMethod)||![0,0x8000,0x4000].includes(type)||type===0x4000&&!directory||type===0x8000&&directory||directory&&entry.uncompressedSize!==0)P.fail('file_archive_invalid');
    for(let i=offset+1;i<=parts.length;i++){const rel=parts.slice(offset,i).join('/'),key=rel.toLowerCase(),isDir=directory||i<parts.length,old=seen.get(key),explicit=i===parts.length;if(old&&(old.rel!==rel||old.directory!==isDir||!isDir||explicit&&old.explicit))P.fail('file_archive_invalid');seen.set(key,{rel,directory:isDir,explicit:explicit||old?.explicit===true});if(seen.size>LIMITS.entries)P.fail('files_limit');if(isDir)dirs.add(rel);}
    total+=entry.uncompressedSize;if(!Number.isSafeInteger(total)||total>LIMITS.data||entry.uncompressedSize>LIMITS.file||entry.uncompressedSize>Math.max(1,entry.compressedSize)*LIMITS.ratio)P.fail('file_transfer_too_large');
    const output=directory?null:this.create(LIMITS.file),stream=await zip.openReadStreamPromise(entry),abort=()=>stream.destroy();o.signal?.addEventListener('abort',abort,{once:true});let size=0,crc=0;
    try{for await(const bytes of stream){check(o);size+=bytes.length;if(size>entry.uncompressedSize)P.fail('file_archive_invalid');crc=crc32(bytes,crc);if(output)await output.write(bytes,o);await tick();}if(size!==entry.uncompressedSize||crc!==entry.crc32)P.fail('file_archive_invalid');if(output){await output.finish(o);files.push({relativePath:parts.slice(offset).join('/'),blob:output});}}
    finally{o.signal?.removeEventListener('abort',abort);stream.destroy();}
   }
   await blob.verify(o);return {files,dirs:[...dirs].sort(),bytes:total,entries:count};
  }catch(error){if(o.signal?.aborted)P.fail('cancelled');if(P.safeCode(error)!=='unavailable')throw error;P.fail('file_archive_invalid');}finally{zip?.close();}
 }
 close(){if(this.closing)return this.closing;this.closed=true;const run=(async()=>{if(!this.dir)return {closed:true};let failed=false;for(const b of [...this.blobs])try{await b.close();}catch{failed=true;}if(failed||this.blobs.size)P.fail('file_cleanup_unconfirmed');this.assert();fs.rmdirSync(this.dir);this.dir=null;return {closed:true};})();this.closing=run.finally(()=>{this.closing=null;});return this.closing;}
}
module.exports={QQRemoteCopyStage,LIMITS};
