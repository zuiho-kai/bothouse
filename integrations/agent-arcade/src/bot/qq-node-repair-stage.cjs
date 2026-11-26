'use strict';
// Original fixed-artifact extraction into an owned recovery directory. The
// archive reader never owns an extra FD; all source/output handles stay here.
const fs=require('node:fs'),path=require('node:path'),yauzl=require('yauzl');
const {createHash}=require('node:crypto'),{crc32}=require('node:zlib');
const {QQHeldZipReader}=require('./qq-held-zip-reader.cjs');
const F=require('./qq-node-repair-fs.cjs'),M=require('./qq-managed-node-repair-metadata.cjs');
class QQNodeRepairStage{
 constructor({packages,io=fs,component='napcat-node'}={}){if(!['napcat-node','napcat-shell'].includes(component)||typeof packages?.verify!=='function'||component==='napcat-node'&&typeof packages?.stage!=='function')F.fail('invalid_request');this.component=component;this.metadata=component==='napcat-shell'?require('./qq-managed-shell-repair-metadata.cjs'):M;this.packages=packages;this.io=io;this.handles=new Map();this.owned=new Map();this.treeRoot=null;this.closed=false;this.busy=false;}
 _open(file,flags,expected){const fd=this.io.openSync(file,flags,0o600);this.handles.set(fd,{file,expected:expected||null,created:flags==='wx'});try{const p=F.proof(this.io.fstatSync(fd,{bigint:true}));this.handles.get(fd).expected=p;if(flags==='wx')this.owned.set(file,{kind:'file',proof:p});if(expected&&!F.equal(p,expected))F.fail();return fd;}catch(e){this._close(fd);throw e;}}
 _close(fd){const r=this.handles.get(fd);if(!r)return;try{const p=F.proof(this.io.fstatSync(fd,{bigint:true}));if(!r.expected||!F.sameIdentity(r.expected,p))F.fail('node_repair_cleanup_unconfirmed');this.io.closeSync(fd);this.handles.delete(fd);}catch(e){if(e.code==='EBADF'){this.handles.delete(fd);return;}F.fail('node_repair_cleanup_unconfirmed');}}
 _createdDirectory(file){const proof=F.mkdir(file,this.io);this.owned.set(file,{kind:'directory',proof});}
 captureOwnedTree(operationDir){const root=path.join(operationDir,'staged-code');if(this.treeRoot!==root){if(this.treeRoot||F.exists(root,this.io))F.fail('node_repair_unconfirmed');return F.tree(root,{io:this.io,missing:true});}const result=F.tree(root,{io:this.io});if(result.rows.length!==this.owned.size)F.fail('node_repair_unconfirmed');for(const row of result.rows){const file=row.path?F.inside(root,row.path):root,owned=this.owned.get(file);if(!owned||owned.kind!==row.kind||!F.sameIdentity(row,owned.proof)||row.kind==='file'&&!F.equal(Object.fromEntries(Object.entries(row).filter(([k])=>!['path','kind','sha256'].includes(k))),owned.proof))F.fail('node_repair_unconfirmed');}return result;}
 async _artifact({signal,check}){
  const fixed=this.metadata;let artifact;try{artifact=await this.packages.verify({version:fixed.VERSION,signal});}catch(e){if(e.code!=='package_not_staged')throw e;if(this.component==='napcat-shell')F.fail('shell_repair_source_unavailable');artifact=await this.packages.stage({version:fixed.VERSION,signal});}check();
  if(!artifact||artifact.component!==this.component||artifact.version!==fixed.VERSION||artifact.state!=='verified-staged'||artifact.sha256!==fixed.SOURCE.sha256||artifact.size!==fixed.SOURCE.size||artifact.assetId!==fixed.SOURCE.assetId)F.fail(this.component==='napcat-shell'?'shell_repair_source_unavailable':'node_repair_source_unavailable');
  const proof=F.read(artifact.file,{max:128*1024*1024,bytes:false,io:this.io,check});if(proof.size!==fixed.SOURCE.size||proof.sha256!==fixed.SOURCE.sha256)F.fail('artifact_changed');return {artifact,proof};
 }
 async prepare({operationDir,manifest,signal,assertCurrent}={}){
  if(this.closed||this.busy)F.fail('node_repair_busy');this.busy=true;const check=()=>F.current({signal,assertCurrent});let zip,fd,output,stream;
  try{
   check();F.directory(operationDir,this.io);const {artifact,proof}=await this._artifact({signal,check});check();fd=this._open(artifact.file,'r',Object.fromEntries(Object.entries(proof).filter(([k])=>k!=='sha256')));
   const held={fd,assert:()=>{check();const p=F.proof(this.io.fstatSync(fd,{bigint:true}));if(!F.equal(p,this.handles.get(fd).expected))F.fail('artifact_changed');},readSync:this.io.readSync.bind(this.io)};
   zip=await yauzl.fromRandomAccessReaderPromise(new QQHeldZipReader(held),proof.size,{autoClose:false,lazyEntries:true,decodeStrings:true,strictFileNames:true,validateEntrySizes:true});zip.on('error',()=>{});check();if(!Number.isInteger(zip.entryCount)||zip.entryCount<1||zip.entryCount>F.LIMITS.maxEntries)F.fail('archive_limit');
   const records=[],names=new Map();let total=0,metadata=0;
   for await(const entry of zip.eachEntry()){
    check();const directory=entry.fileName.endsWith('/'),name=F.relative(directory?entry.fileName.slice(0,-1):entry.fileName),parts=name.split('/'),mode=(entry.externalFileAttributes>>>16)&0xf000,dos=entry.externalFileAttributes&0xffff;
    if(entry.isEncrypted()||![0,8].includes(entry.compressionMethod)||![0,0x8000,0x4000].includes(mode)||Boolean(mode===0x4000||dos&0x10)!==directory||(dos&0x448)||entry.extraFields.some(x=>[0x756e,0x000d].includes(x.id)))F.fail('archive_unsafe');
    if(!Number.isSafeInteger(entry.uncompressedSize)||!Number.isSafeInteger(entry.compressedSize)||entry.uncompressedSize<0||entry.compressedSize<0||entry.uncompressedSize>F.LIMITS.maxFileBytes||entry.uncompressedSize>Math.max(1,entry.compressedSize)*250||directory&&(entry.uncompressedSize!==0||entry.crc32!==0))F.fail('archive_limit');
    total+=entry.uncompressedSize;metadata+=Buffer.byteLength(entry.fileName)+Buffer.byteLength(entry.fileComment||'')+entry.extraFields.reduce((n,x)=>n+x.data.length,0);if(total>F.LIMITS.maxTreeBytes||metadata>8*1024*1024)F.fail('archive_limit');
    for(let i=1;i<=parts.length;i++){const value=parts.slice(0,i).join('/'),key=value.toLowerCase(),dir=i<parts.length||directory,explicit=i===parts.length,old=names.get(key);if(old&&(old.name!==value||old.directory!==dir||!dir||explicit&&old.explicit))F.fail('archive_unsafe');names.set(key,{name:value,directory:dir,explicit:explicit||old?.explicit||false});}
    records.push({entry,name,directory});
   }
   const files=records.filter(x=>!x.directory),directories=[...names.values()].filter(x=>x.directory).map(x=>x.name).sort();
   if(!F.equal(directories,[...manifest.directories].sort())||files.length!==manifest.files.length||files.some(x=>{const expected=manifest.files.find(f=>f.path===x.name);return !expected||expected.size!==x.entry.uncompressedSize;}))F.fail('manifest_invalid');
   const staged=path.join(operationDir,'staged-code');this.treeRoot=staged;this._createdDirectory(staged);for(const dir of directories.sort((a,b)=>a.split('/').length-b.split('/').length||a.localeCompare(b)))this._createdDirectory(F.inside(staged,dir));
   for(const row of files){
    check();const target=F.inside(staged,row.name),expected=manifest.files.find(f=>f.path===row.name);output=this._open(target,'wx');let size=0,crc=0;const h=createHash('sha256');
    try{stream=await zip.openReadStreamPromise(row.entry);const abort=()=>stream.destroy(Object.assign(new Error('Cancelled'),{code:'cancelled'}));signal?.addEventListener('abort',abort,{once:true});
     try{for await(const chunk of stream){check();size+=chunk.length;if(size>expected.size)F.fail('archive_limit');h.update(chunk);crc=crc32(chunk,crc);let at=0;while(at<chunk.length){check();const n=this.io.writeSync(output,chunk,at,chunk.length-at);if(!n)F.fail('node_repair_failed');at+=n;const saved=F.proof(this.io.fstatSync(output,{bigint:true}));this.handles.get(output).expected=saved;this.owned.set(target,{kind:'file',proof:saved});}}}finally{signal?.removeEventListener('abort',abort);stream.destroy();stream=null;}
     if(size!==expected.size||crc!==row.entry.crc32||h.digest('hex')!==expected.sha256)F.fail('archive_invalid');this.io.fsyncSync(output);this.handles.get(output).expected=F.proof(this.io.fstatSync(output,{bigint:true}));this.owned.set(target,{kind:'file',proof:this.handles.get(output).expected});if(!F.equal(this.handles.get(output).expected,F.stat(target,{io:this.io})))F.fail();
    }finally{if(output!==undefined){this._close(output);output=undefined;}}
   }
   check();held.assert();if(!F.equal(this.handles.get(fd).expected,F.stat(artifact.file,{max:128*1024*1024,io:this.io})))F.fail('artifact_changed');const result=F.tree(staged,{io:this.io,check});return {path:staged,proof:result,source:{verification:'full-pinned-archive-and-manifest',archiveBytes:this.metadata.SOURCE.size,fileCount:files.length,totalBytes:total}};
  }finally{stream?.destroy();zip?.close();let failure;for(const id of [...this.handles.keys()])try{this._close(id);}catch(e){failure=e;}this.busy=false;if(failure)throw failure;}
 }
 close(){if(this.busy)return Promise.reject(Object.assign(new Error('Repair stage still running.'),{code:'node_repair_cleanup_unconfirmed'}));for(const fd of [...this.handles.keys()])this._close(fd);F.retryCloses(this.io);this.closed=true;return Promise.resolve({closed:true});}
}
module.exports={QQNodeRepairStage};
