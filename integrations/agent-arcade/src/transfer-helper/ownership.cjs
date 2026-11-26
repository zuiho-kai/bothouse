'use strict';
const fs=require('node:fs'), path=require('node:path');
const net=require('node:net');
const P=require('./policy.cjs');
const lstatSync=filename=>P.fileStats(fs.lstatSync(filename,{bigint:true}));
const lstat=async filename=>P.fileStats(await fs.promises.lstat(filename,{bigint:true}));
const stat=async fd=>P.fileStats(await fd.stat({bigint:true}));
function directory(target) {
  const absolute=path.resolve(target), parsed=path.parse(absolute); let current=parsed.root;
  for(const part of absolute.slice(parsed.root.length).split(path.sep).filter(Boolean)) {
    current=path.join(current,part); const s=lstatSync(current);
    if(!s.isDirectory()||s.isSymbolicLink())P.fail('scope_changed');
  }
  if(fs.realpathSync.native(absolute).toLowerCase()!==absolute.toLowerCase())P.fail('scope_changed');
  return P.identity(lstatSync(absolute));
}
function checkDirectory(target, proof) { const now=directory(target); if(!P.same(now,proof))P.fail('scope_changed'); return now; }
async function lock(root) {
  // The OS releases this exact listener after process death. There is no stale
  // pathname to unlink and no PID liveness race or process termination.
  const canonical=fs.realpathSync.native(root),key=P.hash(process.platform==='win32'?canonical.toLowerCase():canonical);
  const endpoint=process.platform==='win32'?'\\\\.\\pipe\\agent-arcade-transfer-'+key:process.platform==='linux'?'\0agent-arcade-transfer-'+key:null;
  if(!endpoint)P.fail('unsupported');
  const gate=net.createServer(socket=>socket.destroy());let closed=false;
  await new Promise((resolve,reject)=>{const onError=e=>{gate.off('listening',onReady);reject(new P.TransferError(e.code==='EADDRINUSE'||e.code==='EACCES'?'busy':'storage_failed',409));};const onReady=()=>{gate.off('error',onError);resolve();};gate.once('error',onError);gate.once('listening',onReady);gate.listen(endpoint);});
  gate.on('error',()=>{});
  return {assert(){if(closed||!gate.listening)P.fail('recovery_required');},async close(){if(closed)return;await new Promise((resolve,reject)=>gate.close(e=>e?reject(new P.TransferError('cleanup_unconfirmed')):resolve()));closed=true;}};
}
async function openExact(filename, proof, flags='r') {
  const fd=await fs.promises.open(filename,flags);try {const s=await stat(fd),l=await lstat(filename);
    if(!s.isFile()||l.isSymbolicLink()||!P.same(P.identity(s),P.identity(l))||proof&&!P.same(proof,P.identity(s)))P.fail('source_changed');
    return fd;
  }catch(e){await fd.close();throw e;}
}
async function digest(fd,length) {
  const hash=require('node:crypto').createHash('sha256'),buffer=Buffer.allocUnsafe(262144);let offset=0;
  while(offset<length){const {bytesRead}=await fd.read(buffer,0,Math.min(buffer.length,length-offset),offset);if(!bytesRead)P.fail('integrity_failed');hash.update(buffer.subarray(0,bytesRead));offset+=bytesRead;}
  return hash.digest('hex');
}
function names(target,max=P.LIMITS.listMaxEntries) {const dir=fs.opendirSync(target),out=[];try{let entry;while((entry=dir.readSync())){if(out.length>=max)P.fail('limit');out.push(entry.name);}}finally{dir.closeSync();}return out.sort();}
module.exports={directory,checkDirectory,lock,openExact,digest,names,lstatSync,lstat,stat};
