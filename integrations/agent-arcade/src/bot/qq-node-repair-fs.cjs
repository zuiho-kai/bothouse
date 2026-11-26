'use strict';
// Original bounded filesystem proofs for managed Node code recovery. No runtime
// configuration, account contents, execution or generic path-bearing IPC.
const fs=require('node:fs'),path=require('node:path');
const {createHash}=require('node:crypto');
const LIMITS=Object.freeze({maxInstallations:32,maxInstancesPerInstallation:32,maxProcesses:4096,maxEntries:10000,maxDepth:16,maxFileBytes:128*1024*1024,maxTreeBytes:512*1024*1024,maxManifestBytes:2*1024*1024,maxHistoryRecords:16,maxHistoryBytes:8*1024*1024*1024,previewTTL:300000});
const HEX=/^[a-f0-9]{64}$/,UUID=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&Object.getPrototypeOf(v)===Object.prototype;
const keys=(v,names)=>plain(v)&&Object.keys(v).sort().join('|')===[...names].sort().join('|');
const sha=v=>createHash('sha256').update(v).digest('hex');
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const failedHandles=new Map();
function fail(code='node_repair_changed'){throw Object.assign(new Error(`Managed Node recovery failed (${code}).`),{code});}
function local(value){if(typeof value!=='string'||value.length>1500||!path.isAbsolute(value)||/^[/\\]{2}/.test(value)||/[\p{Cc}\p{Cf}]/u.test(value)||value.slice(2).includes(':'))fail('unsafe_path');return path.resolve(value);}
const samePath=(a,b)=>local(a).toLowerCase()===local(b).toLowerCase();
function proof(s){
 if(typeof s.dev!=='bigint'||typeof s.ino!=='bigint'||s.size<0n||s.size>BigInt(Number.MAX_SAFE_INTEGER)||s.nlink>BigInt(Number.MAX_SAFE_INTEGER))fail('unsafe_path');
 return {dev:s.dev.toString(),ino:s.ino.toString(),birthtimeNs:s.birthtimeNs.toString(),mtimeNs:s.mtimeNs.toString(),ctimeNs:s.ctimeNs.toString(),size:Number(s.size),nlink:Number(s.nlink)};
}
const identity=p=>({dev:p.dev,ino:p.ino,birthtimeNs:p.birthtimeNs});
const sameIdentity=(a,b)=>!!a&&!!b&&equal(identity(a),identity(b));
function stat(file,{kind='file',max=LIMITS.maxFileBytes,links=1,io=fs}={}){
 const target=local(file);let cursor=target,leaf;
 for(;;){const s=io.lstatSync(cursor,{bigint:true});if(s.isSymbolicLink())fail('unsafe_path');if(cursor===target){leaf=s;if(kind==='directory'?!s.isDirectory():!s.isFile()||s.nlink!==BigInt(links)||s.size>BigInt(max))fail('unsafe_path');}else if(!s.isDirectory())fail('unsafe_path');const parent=path.dirname(cursor);if(parent===cursor)break;cursor=parent;}
 if(!samePath(io.realpathSync(target),target))fail('unsafe_path');return proof(leaf);
}
const directory=(file,io=fs)=>stat(file,{kind:'directory',io});
function exists(file,io=fs){try{io.lstatSync(file,{bigint:true});return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}}
function names(dir,max,io=fs){directory(dir,io);const rows=[],stream=io.opendirSync(dir);try{for(let row;(row=stream.readSync());){if(rows.length>=max)fail('node_repair_scope_unverified');rows.push(row.name);}}finally{stream.closeSync();}return rows.sort();}
function current({signal,assertCurrent}={}){if(signal?.aborted)fail('cancelled');if(assertCurrent!==undefined){if(typeof assertCurrent!=='function')fail('invalid_request');const result=assertCurrent();if(result&&typeof result.then==='function'){Promise.resolve(result).catch(()=>{});fail('invalid_request');}}if(signal?.aborted)fail('cancelled');}
function read(file,{max=LIMITS.maxManifestBytes,bytes=true,io=fs,check=()=>{},owner,links=1}={}){
 retryCloses(io);const before=stat(file,{max,io,links}),parents=directory(path.dirname(file),io);let fd,result;
 try{check();fd=io.openSync(file,'r');owner?.add(fd);const opened=proof(io.fstatSync(fd,{bigint:true}));if(!equal(before,opened))fail();const h=createHash('sha256'),parts=[],buffer=Buffer.alloc(Math.min(65536,opened.size));let pos=0;
  while(pos<opened.size){check();const n=io.readSync(fd,buffer,0,Math.min(buffer.length,opened.size-pos),pos);if(!n)fail();const block=buffer.subarray(0,n);h.update(block);if(bytes)parts.push(Buffer.from(block));pos+=n;}
  check();if(!equal(opened,proof(io.fstatSync(fd,{bigint:true})))||!equal(opened,stat(file,{max,io,links}))||!sameIdentity(parents,directory(path.dirname(file),io)))fail();result={...opened,sha256:h.digest('hex'),...(bytes?{bytes:Buffer.concat(parts)}:{})};
 }finally{if(fd!==undefined){try{io.closeSync(fd);owner?.delete(fd);}catch(e){if(!failedHandles.has(io))failedHandles.set(io,new Map());failedHandles.get(io).set(fd,{fd,expected:before,owner});throw Object.assign(new Error('Recovery file close unconfirmed.'),{code:'node_repair_cleanup_unconfirmed'});}}}return result;
}
function retryCloses(io=fs){const held=failedHandles.get(io);if(!held)return;let failed=false;for(const [fd,row]of held){try{let current;try{current=proof(io.fstatSync(fd,{bigint:true}));}catch(e){if(e.code==='EBADF'){held.delete(fd);row.owner?.delete(fd);continue;}throw e;}if(!sameIdentity(current,row.expected))fail('node_repair_cleanup_unconfirmed');io.closeSync(fd);held.delete(fd);row.owner?.delete(fd);}catch{failed=true;}}if(!held.size)failedHandles.delete(io);if(failed)fail('node_repair_cleanup_unconfirmed');}
function writeExclusive(file,value,{max=32*1024*1024,io=fs,check=()=>{}}={}){
 retryCloses(io);const bytes=Buffer.isBuffer(value)?value:Buffer.from(JSON.stringify(value)+'\n');if(bytes.length>max)fail('node_repair_scope_unverified');const parent=directory(path.dirname(file),io);let fd,expected;
 try{check();fd=io.openSync(file,'wx',0o600);expected=proof(io.fstatSync(fd,{bigint:true}));let pos=0;while(pos<bytes.length){check();const n=io.writeSync(fd,bytes,pos,Math.min(65536,bytes.length-pos));if(!n)fail('node_repair_failed');pos+=n;}io.fsyncSync(fd);expected=proof(io.fstatSync(fd,{bigint:true}));if(!equal(expected,stat(file,{max,io}))||!sameIdentity(parent,directory(path.dirname(file),io)))fail();}
 finally{if(fd!==undefined)try{io.closeSync(fd);}catch{if(!failedHandles.has(io))failedHandles.set(io,new Map());failedHandles.get(io).set(fd,{fd,expected});fail('node_repair_cleanup_unconfirmed');}}
 const r=read(file,{max,io,check});if(!r.bytes.equals(bytes))fail();return r;
}
function relative(value){if(typeof value!=='string'||!value||value.length>240||value!==value.normalize('NFC')||value.includes('\\')||/[:\p{Cc}\p{Cf}\u2028\u2029\ufffd]/u.test(value)||value.startsWith('/'))fail('unsafe_path');const parts=value.split('/');if(parts.length>LIMITS.maxDepth||parts.some(v=>!v||v==='.'||v==='..'||/[. ]$/.test(v)||/[<>"|?*]/.test(v)||/^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(v)))fail('unsafe_path');return value;}
function inside(root,rel){relative(rel);const target=path.resolve(root,...rel.split('/')),r=path.relative(root,target);if(!r||r==='..'||r.startsWith('..'+path.sep)||path.isAbsolute(r))fail('unsafe_path');return target;}
function tree(root,{io=fs,check=()=>{},owner,missing=false}={}){
 root=local(root);const parent=directory(path.dirname(root),io);if(!exists(root,io)){if(!missing)fail('node_repair_changed');return {present:false,parent:identity(parent),rows:[],bytes:0,files:0,digest:sha('absent')};}
 const rows=[],seen=new Set();let total=0,files=0;
 const walk=(dir,prefix)=>{check();const before=directory(dir,io);rows.push({path:prefix,kind:'directory',...before});for(const name of names(dir,LIMITS.maxEntries,io)){check();const rel=relative(prefix?prefix+'/'+name:name),key=rel.toLowerCase();if(seen.has(key)||seen.size>=LIMITS.maxEntries)fail('unsafe_path');seen.add(key);const target=inside(root,rel),s=io.lstatSync(target,{bigint:true});if(s.isSymbolicLink())fail('unsafe_path');if(s.isDirectory())walk(target,rel);else{const value=read(target,{max:LIMITS.maxFileBytes,bytes:false,io,check,owner});total+=value.size;if(total>LIMITS.maxTreeBytes)fail('node_repair_scope_unverified');files++;rows.push({path:rel,kind:'file',...value});}}if(!equal(before,directory(dir,io)))fail();};
 walk(root,'');if(!sameIdentity(parent,directory(path.dirname(root),io)))fail();rows.sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);return {present:true,parent:identity(parent),root:identity(rows.find(x=>x.path==='')),rows,bytes:total,files,digest:sha(JSON.stringify(rows))};
}
// Recheck a completed hash proof after an awaited process observation. Includes
// directory membership and exact file identity/stat; never adopts fresh bytes.
function assertTree(root,expected,{io=fs,check=()=>{},moved=false}={}){
 check();if(!sameIdentity(directory(path.dirname(root),io),expected.parent)&&!moved)fail();
 if(!expected.present){if(exists(root,io))fail();return;}
 const byPath=new Map(expected.rows.map(r=>[r.path,r]));
 for(const row of expected.rows){check();const file=row.path?inside(root,row.path):root,actual=row.kind==='file'?stat(file,{io}):directory(file,io),saved=Object.fromEntries(Object.entries(row).filter(([k])=>!['path','kind','sha256'].includes(k)));
  if(row.path===''&&moved?!sameIdentity(actual,saved):!equal(actual,saved))fail();
  if(row.kind==='directory'){const children=expected.rows.filter(r=>r.path&&path.posix.dirname(r.path)===(row.path||'.')).map(r=>path.posix.basename(r.path)).sort();if(!equal(names(file,LIMITS.maxEntries,io),children))fail();}
 }
 check();
}
function mkdir(file,io=fs){const parent=directory(path.dirname(file),io);io.mkdirSync(file,{mode:0o700});const result=directory(file,io);if(!sameIdentity(parent,directory(path.dirname(file),io)))fail();return result;}
function ensureDirectory(file,io=fs){if(exists(file,io))return directory(file,io);ensureDirectory(path.dirname(file),io);return mkdir(file,io);}
module.exports={LIMITS,HEX,UUID,plain,keys,sha,equal,fail,local,samePath,proof,identity,sameIdentity,stat,directory,exists,names,current,read,retryCloses,writeExclusive,relative,inside,tree,assertTree,mkdir,ensureDirectory};
