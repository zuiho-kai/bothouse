'use strict';
// Explicit retirement of this repairer's completed code backups. Every path
// comes from a fixed operation ID; no account/work directory is a target.
const fs=require('node:fs'),path=require('node:path'),{randomUUID}=require('node:crypto');
const F=require('./qq-node-repair-fs.cjs'),{paths}=require('./qq-managed-node-repair-metadata.cjs'),{withNodeCodeGate}=require('./qq-node-code-gate.cjs');
const MAX_INTENT=32*1024*1024,SLOTS=['old-code','staged-code'],META=['preparing.json','prepared.json','intent.json','terminal.json'];
const fail=()=>F.fail('node_repair_retirement_unavailable');
function identity(v){if(!F.keys(v,['dev','ino','birthtimeNs'])||Object.values(v).some(x=>typeof x!=='string'||!/^\d{1,40}$/.test(x)))fail();return v;}
function proof(v,{file=false,row=false}={}){
 const fields=['dev','ino','birthtimeNs','mtimeNs','ctimeNs','size','nlink',...(file?['sha256']:[]),...(row?['path','kind']:[])];
 if(!F.keys(v,fields))fail();identity(F.identity(v));for(const key of ['mtimeNs','ctimeNs'])if(typeof v[key]!=='string'||! /^-?\d{1,40}$/.test(v[key]))fail();
 if(!Number.isSafeInteger(v.size)||v.size<0||v.size>F.LIMITS.maxFileBytes||!Number.isSafeInteger(v.nlink)||v.nlink<0||file&&(v.nlink!==1||!F.HEX.test(v.sha256)))fail();
 if(row){if(!['file','directory'].includes(v.kind)||file!==(v.kind==='file'))fail();if(v.path!=='')F.relative(v.path);}return v;
}
function tree(v){
 if(!F.keys(v,['present','parent','root','rows','bytes','files','digest'])||v.present!==true||!Array.isArray(v.rows)||v.rows.length<1||v.rows.length>F.LIMITS.maxEntries+1||!F.HEX.test(v.digest))fail();identity(v.parent);identity(v.root);
 const seen=new Set();let bytes=0,files=0;
 for(const row of v.rows){proof(row,{file:row.kind==='file',row:true});const key=row.path.toLowerCase();if(seen.has(key))fail();seen.add(key);if(row.kind==='file'){bytes+=row.size;files++;}}
 const root=v.rows.find(x=>x.path==='');if(root?.kind!=='directory'||!F.sameIdentity(root,v.root)||bytes!==v.bytes||files!==v.files||bytes>F.LIMITS.maxTreeBytes||F.sha(JSON.stringify(v.rows))!==v.digest)fail();
 const byPath=new Map(v.rows.map(r=>[r.path,r]));for(const row of v.rows){if(!row.path)continue;const parent=row.path.includes('/')?row.path.slice(0,row.path.lastIndexOf('/')):'';if(byPath.get(parent)?.kind!=='directory')fail();}return v;
}
function validateCapture(root,id,value){
 const p=paths(root),expected=path.join(p.operationsRoot,id);
 if(!F.UUID.test(id)||!F.keys(value,['operationId','operationRoot','operationIdentity','endedAt','terminalOutcome','trees','metadataFiles','live'])||value.operationId!==id||!F.samePath(value.operationRoot,expected)||!Number.isSafeInteger(value.endedAt)||value.endedAt<0||!['completed','restored','abandoned'].includes(value.terminalOutcome))fail();identity(value.operationIdentity);
 if(!Array.isArray(value.trees)||value.trees.length>2||new Set(value.trees.map(x=>x.slot)).size!==value.trees.length)fail();
 for(const t of value.trees){if(!F.keys(t,['slot','path','proof'])||!SLOTS.includes(t.slot)||!F.samePath(t.path,path.join(expected,t.slot)))fail();tree(t.proof);if(!F.sameIdentity(t.proof.parent,value.operationIdentity))fail();}
 if(!Array.isArray(value.metadataFiles)||value.metadataFiles.length>4||new Set(value.metadataFiles.map(x=>x.name)).size!==value.metadataFiles.length)fail();
 for(const m of value.metadataFiles){if(!F.keys(m,['name','proof'])||!META.includes(m.name))fail();proof(m.proof,{file:true});}
 const live=value.live;if(!F.keys(live,['versionParentIdentity','codeIdentity','manifestSha256','descriptors'])||!F.HEX.test(live.manifestSha256)||!Array.isArray(live.descriptors)||live.descriptors.length<1||live.descriptors.length>32)fail();identity(live.versionParentIdentity);if(live.codeIdentity!==null)identity(live.codeIdentity);
 const ids=new Set();for(const d of live.descriptors){if(!F.keys(d,['setupId','descriptorSha256'])||!F.UUID.test(d.setupId)||!F.HEX.test(d.descriptorSha256)||ids.has(d.setupId))fail();ids.add(d.setupId);}
 // Retain proofs, but reconstruct every usable deletion path. Even an otherwise
 // equivalent journal spelling is never used as a filesystem instruction.
 return structuredClone({...value,operationRoot:expected,trees:value.trees.map(t=>({...t,path:path.join(expected,t.slot)}))});
}
const fixedResult={operation:'node-code-history-retirement',currentCodeTouched:false,originalManifestTouched:false,descriptorsTouched:false,accountDataTouched:false,automaticStart:false};
class QQNodeRepairHistory{
 constructor({root,io=fs,now=Date.now,monotonic=()=>performance.now(),captureOperation,assertLive}={}){
  this.root=F.local(root);this.io=io;this.now=now;this.monotonic=monotonic;this.captureOperation=captureOperation;this.assertLive=assertLive;this.ticket=null;this.active=null;this.closed=false;this.handles=new Map();
  if(typeof now!=='function'||typeof monotonic!=='function'||typeof captureOperation!=='function'||typeof assertLive!=='function')F.fail('invalid_request');
 }
 _intentPath(id){if(!F.UUID.test(id))F.fail('invalid_request');return path.join(paths(this.root).retirementsRoot,id+'.json');}
 _sync(callback,...args){const result=callback(...args);if(result&&typeof result.then==='function'){Promise.resolve(result).catch(()=>{});F.fail('invalid_request');}return result;}
 _live(capture,check){check();this._sync(this.assertLive,capture,{check});check();}
 _readIntent(id){
  const file=this._intentPath(id);if(!F.exists(file,this.io))return null;const read=F.read(file,{max:MAX_INTENT,io:this.io});let v;try{v=JSON.parse(read.bytes);}catch{fail();}
  if(!F.keys(v,['schema','operationId','createdAt','parentIdentity','operationParentIdentity','capture'])||v.schema!=='qq_node_retirement_v1'||v.operationId!==id||!Number.isSafeInteger(v.createdAt)||v.createdAt<0)fail();identity(v.parentIdentity);identity(v.operationParentIdentity);
  const capture=validateCapture(this.root,id,v.capture);if(!F.sameIdentity(v.parentIdentity,F.directory(path.dirname(file),this.io)))fail();
  if(!F.sameIdentity(v.operationParentIdentity,F.directory(paths(this.root).operationsRoot,this.io)))fail();
  return {capture,read:{...read,bytes:undefined},file,value:v};
 }
 _remaining(capture,check,{partial=true}={}){
  check();const op=capture.operationRoot,io=this.io;if(!F.exists(op,io)){if(!partial)fail();return {files:[],directories:[],metadata:[],bytes:0};}
  if(!F.sameIdentity(capture.operationIdentity,F.directory(op,io)))fail();const allowed=[...capture.trees.map(t=>t.slot),...capture.metadataFiles.map(m=>m.name)],actual=F.names(op,6,io);if(actual.some(n=>!allowed.includes(n))||!partial&&actual.length!==allowed.length)fail();
  const files=[],directories=[],metadata=[];let bytes=0;
  for(const item of capture.trees){
   check();if(!F.exists(item.path,io)){if(!partial)fail();continue;}const seen=F.tree(item.path,{io,check}),expected=new Map(item.proof.rows.map(r=>[r.path,r]));
   if(!F.sameIdentity(seen.parent,capture.operationIdentity)||!partial&&seen.rows.length!==expected.size)fail();
   for(const row of seen.rows){const before=expected.get(row.path);if(!before||before.kind!==row.kind||!F.sameIdentity(before,row)||row.kind==='file'&&!F.equal(before,row))fail();const file=row.path?F.inside(item.path,row.path):item.path;if(row.kind==='file'){files.push({file,proof:before});bytes+=row.size;}else directories.push({file,proof:before});}
  }
  for(const item of capture.metadataFiles){const file=path.join(op,item.name);check();if(!F.exists(file,io)){if(!partial)fail();continue;}const actual=F.read(file,{max:MAX_INTENT,bytes:false,io,check});if(!F.equal(actual,item.proof))fail();metadata.push({file,proof:item.proof,name:item.name});bytes+=actual.size;}
  return {files,directories,metadata,bytes};
 }
 _closeHandles(){
  let failed=false;for(const [fd,expected]of this.handles){try{let actual;try{actual=F.proof(this.io.fstatSync(fd,{bigint:true}));}catch(e){if(e.code==='EBADF'){this.handles.delete(fd);continue;}throw e;}if(!expected||!F.sameIdentity(actual,expected))fail();this.io.closeSync(fd);this.handles.delete(fd);}catch{failed=true;}}
  try{F.retryCloses(this.io);}catch{failed=true;}if(failed)F.fail('node_repair_cleanup_unconfirmed');
 }
 _writeIntent(capture,operationParentIdentity,check){
  const file=this._intentPath(capture.operationId),parent=path.dirname(file);F.ensureDirectory(parent,this.io);const parentIdentity=F.identity(F.directory(parent,this.io));
  const value={schema:'qq_node_retirement_v1',operationId:capture.operationId,createdAt:this.now(),parentIdentity,operationParentIdentity,capture},raw=Buffer.from(JSON.stringify(value)+'\n');if(raw.length>MAX_INTENT)fail();check();let fd;
  try{fd=this.io.openSync(file,'wx',0o600);this.handles.set(fd,null);this.handles.set(fd,F.proof(this.io.fstatSync(fd,{bigint:true})));this.io.writeFileSync(fd,raw);this.io.fsyncSync(fd);check();const held=F.proof(this.io.fstatSync(fd,{bigint:true}));this.handles.set(fd,held);if(!F.sameIdentity(parentIdentity,F.directory(parent,this.io))||!F.sameIdentity(held,F.stat(file,{max:MAX_INTENT,io:this.io})))fail();}
  finally{if(fd!==undefined){try{this.io.closeSync(fd);this.handles.delete(fd);}catch{F.fail('node_repair_cleanup_unconfirmed');}}}
  const result=this._readIntent(capture.operationId);if(!result||!F.equal(result.value,value))fail();return result;
 }
 discardPreview(){this.ticket=null;}
 async _operation(options,callback){
  if(this.closed)F.fail('manager_closing');if(this.active)F.fail('node_repair_busy');
  const operation=Promise.resolve().then(()=>withNodeCodeGate({root:this.root,signal:options.signal,gate:options.gate},gate=>{
   const check=()=>{if(this.closed)F.fail('manager_closing');F.current(options);gate();};this._closeHandles();check();return callback(check);
  }));this.active=operation;try{return await operation;}finally{if(this.active===operation)this.active=null;}
 }
 async preview({operationId,signal,assertCurrent,gate}={}){
  if(!F.UUID.test(operationId))F.fail('invalid_request');this.discardPreview();
  return this._operation({signal,assertCurrent,gate},check=>{
   const intent=this._readIntent(operationId),capture=intent?intent.capture:validateCapture(this.root,operationId,this._sync(this.captureOperation,operationId,{check}));
   this._live(capture,check);const remaining=this._remaining(capture,check,{partial:!!intent});this._live(capture,check);
   const operationParentIdentity=intent?.value.operationParentIdentity||F.identity(F.directory(paths(this.root).operationsRoot,this.io));
   const ticketId=randomUUID(),expectedDigest=F.sha(JSON.stringify([capture,operationParentIdentity,intent?.read.sha256??null,remaining])),expiresAt=this.now()+F.LIMITS.previewTTL;
   this.ticket={ticketId,expectedDigest,capture,operationParentIdentity,intentHash:intent?.read.sha256??null,intentIdentity:intent?F.identity(intent.read):null,deadline:this.monotonic()+F.LIMITS.previewTTL};
   return {...fixedResult,operationId,ticketId,expectedDigest,expiresAt,resume:!!intent,retainedBytes:remaining.bytes,retainedFileCount:remaining.files.length,removesRetainedCode:true,reversible:false};
  });
 }
 async confirm({ticketId,expectedDigest,signal,assertCurrent,gate}={}){
  const ticket=this.ticket;this.ticket=null;if(!ticket||ticket.ticketId!==ticketId||ticket.expectedDigest!==expectedDigest)F.fail('preview_required');
  let attempted=false,intent=null,retired=false;
  const result=(committed,code=null)=>({...fixedResult,operationId:ticket.capture.operationId,committed,retired:committed===true?true:committed===false?false:null,cleanupRequired:committed!==true,cleanupVerified:committed===true&&this.handles.size===0,code});
  try{return await this._operation({signal,assertCurrent,gate},check=>{
   const capture=ticket.capture;this._live(capture,check);if(!F.sameIdentity(ticket.operationParentIdentity,F.directory(paths(this.root).operationsRoot,this.io)))fail();intent=this._readIntent(capture.operationId);
   if(ticket.intentHash?(intent?.read.sha256!==ticket.intentHash||!F.sameIdentity(intent.read,ticket.intentIdentity)):intent!==null)fail();
   const remaining=this._remaining(capture,check,{partial:!!intent});
   if(F.sha(JSON.stringify([capture,ticket.operationParentIdentity,intent?.read.sha256??null,remaining]))!==ticket.expectedDigest)F.fail('node_repair_changed');
   if(this.monotonic()>=ticket.deadline)F.fail('preview_expired');
   if(!intent)intent=this._writeIntent(capture,ticket.operationParentIdentity,check);
   const boundary=()=>{check();if(!attempted&&this.monotonic()>=ticket.deadline)F.fail('preview_expired');this._live(capture,check);if(!F.sameIdentity(ticket.operationParentIdentity,F.directory(paths(this.root).operationsRoot,this.io)))fail();const saved=this._readIntent(capture.operationId);if(!saved||saved.read.sha256!==intent.read.sha256||!F.sameIdentity(saved.read,intent.read))fail();if(F.exists(capture.operationRoot,this.io)&&!F.sameIdentity(capture.operationIdentity,F.directory(capture.operationRoot,this.io)))fail();};
   const removeFile=row=>{boundary();const parent=F.identity(F.directory(path.dirname(row.file),this.io)),actual=F.read(row.file,{max:MAX_INTENT>row.proof.size?MAX_INTENT:row.proof.size,bytes:false,io:this.io,check});const expected={...row.proof};delete expected.path;delete expected.kind;if(!F.equal(actual,expected))fail();boundary();if(!F.sameIdentity(parent,F.directory(path.dirname(row.file),this.io))||!F.equal(F.stat(row.file,{max:row.proof.size,io:this.io}),Object.fromEntries(Object.entries(expected).filter(([k])=>k!=='sha256'))))fail();attempted=true;this.io.unlinkSync(row.file);if(F.exists(row.file,this.io))fail();};
   for(const row of remaining.files)removeFile(row);
   for(const row of remaining.directories.sort((a,b)=>b.file.length-a.file.length)){boundary();const parent=F.identity(F.directory(path.dirname(row.file),this.io));if(!F.sameIdentity(row.proof,F.directory(row.file,this.io))||F.names(row.file,F.LIMITS.maxEntries,this.io).length)fail();boundary();if(!F.sameIdentity(row.proof,F.directory(row.file,this.io))||!F.sameIdentity(parent,F.directory(path.dirname(row.file),this.io)))fail();attempted=true;this.io.rmdirSync(row.file);if(F.exists(row.file,this.io))fail();}
   // The live guard recognizes terminal settled intents. Remove the old intent
   // before its terminal, so interrupted retirement cannot invent a live repair.
   for(const name of META)for(const row of remaining.metadata.filter(r=>r.name===name))removeFile(row);
   boundary();if(F.exists(capture.operationRoot,this.io)){if(F.names(capture.operationRoot,6,this.io).length)fail();boundary();if(!F.sameIdentity(capture.operationIdentity,F.directory(capture.operationRoot,this.io)))fail();attempted=true;this.io.rmdirSync(capture.operationRoot);}
   if(F.exists(capture.operationRoot,this.io))fail();boundary();attempted=true;this.io.unlinkSync(intent.file);
   if(F.exists(intent.file,this.io)||F.exists(capture.operationRoot,this.io))fail();retired=true;return result(true);
  });}catch(e){
   // If the final unlink reported an error after applying, absence is checked
   // independently; otherwise keep the durable retirement for explicit resume.
   if(retired)return {...result(true,'node_repair_cleanup_unconfirmed'),cleanupRequired:true,cleanupVerified:false};
   if(attempted&&intent){try{
    const capture=ticket.capture,stable=()=>{if(!F.sameIdentity(ticket.operationParentIdentity,F.directory(paths(this.root).operationsRoot,this.io))||!F.sameIdentity(intent.value.parentIdentity,F.directory(path.dirname(intent.file),this.io)))fail();};
    stable();this._live(capture,stable);if(!F.exists(intent.file,this.io)&&!F.exists(capture.operationRoot,this.io)){stable();return result(true);}
   }catch{/* Replaced parents or incomplete absence proof retain an unknown outcome. */}}
   const out=result(attempted?null:false,e?.code==='preview_expired'?'preview_expired':e?.code==='cancelled'?'cancelled':'node_repair_retirement_unconfirmed');
   if(!attempted&&!intent&&!F.exists(this._intentPath(ticket.capture.operationId),this.io))out.cleanupRequired=false;
   return out;
  }
 }
 inspect(operationId){
  if(!F.UUID.test(operationId))F.fail('invalid_request');let intent;
  try{intent=this._readIntent(operationId);if(!intent)return null;const check=()=>{};this._live(intent.capture,check);const remaining=this._remaining(intent.capture,check);return {operationId,state:'retiring',canResumeRetirement:true,retainedBytes:remaining.bytes,endedAt:intent.capture.endedAt,code:null};}
  catch{return {operationId,state:'blocked',canResumeRetirement:false,retainedBytes:0,endedAt:intent?.capture.endedAt??0,code:'node_repair_retirement_unavailable'};}
 }
 async close(){this.closed=true;this.discardPreview();await this.active?.catch(()=>{});this._closeHandles();return {closed:true};}
}
module.exports={QQNodeRepairHistory};
