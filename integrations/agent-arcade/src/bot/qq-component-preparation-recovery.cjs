'use strict';
// Preparation recovery never starts/stops QQ and never deletes a residual tree.
// Only this writer's pre-publication record can authorize an explicit quarantine.
const fs=require('node:fs'),path=require('node:path');
const {createHash,randomUUID}=require('node:crypto'),{execFile}=require('node:child_process');
const {withRecoveryGate}=require('./qq-component-lock-recovery.cjs');
const {withNodeCodeGate}=require('./qq-node-code-gate.cjs');
const {withShellCodeGate}=require('./qq-shell-code-gate.cjs');
const MAX_FILES=10000,MAX_BYTES=512*1024*1024,MAX_FILE=128*1024*1024,MAX_RECORDS=256,MAX_META=2*1024*1024;
const UUID=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/,HEX=/^[a-f0-9]{64}$/,COMPONENTS=['napcat-shell','napcat-node'];
const CODES=new Set(['invalid_request','changed','cancelled','timeout','preparation_busy','preparation_record_missing','preparation_proof_unavailable','preparation_publishing','preparation_complete','preparation_selected','preparation_changed','preparation_limit','preparation_unsafe','preparation_recovery_failed','preparation_commit_unconfirmed','preparation_readback_failed','preparation_already_quarantined','preview_required','preview_expired','owner_alive','owner_identity_changed','process_check_failed','component_locked','reference_unverified','recovery_in_progress','recovery_gate_unsupported','recovery_gate_unavailable','recovery_gate_lost','recovery_gate_close_failed','node_repair_recovery_required','node_repair_changed','node_repair_unavailable','node_repair_busy','node_repair_cleanup_unconfirmed','shell_repair_recovery_required','shell_repair_changed','shell_repair_unavailable','shell_repair_busy','shell_repair_cleanup_unconfirmed']);
class QQPreparationRecoveryError extends Error{constructor(code){const safe=CODES.has(code)?code:'preparation_recovery_failed';super(`QQ component preparation recovery failed (${safe}).`);this.name='QQPreparationRecoveryError';this.code=safe;}}
const fail=code=>{throw new QQPreparationRecoveryError(code);},hash=v=>createHash('sha256').update(v).digest('hex');
const plain=v=>!!v&&typeof v==='object'&&!Array.isArray(v),canonical=v=>process.platform==='win32'?path.resolve(v).toLowerCase():path.resolve(v);
function local(value){if(typeof value!=='string'||!path.isAbsolute(value)||/^[/\\]{2}/.test(value)||value.includes('\0'))fail('preparation_unsafe');return path.resolve(value);}
function exists(file){try{fs.lstatSync(file);return true;}catch(e){if(e.code==='ENOENT')return false;fail('preparation_unsafe');}}
function dir(value,create=false){const target=local(value),root=path.parse(target).root;let current=root;for(const part of target.slice(root.length).split(path.sep).filter(Boolean)){current=path.join(current,part);if(!exists(current)){if(!create)fail('preparation_unsafe');fs.mkdirSync(current,{mode:0o700});}const st=fs.lstatSync(current,{bigint:true});if(!st.isDirectory()||st.isSymbolicLink()||canonical(fs.realpathSync(current))!==canonical(current))fail('preparation_unsafe');}return fs.lstatSync(target,{bigint:true});}
const fileId=st=>({dev:String(st.dev),ino:String(st.ino),birth:String(st.birthtimeNs)});
const statProof=st=>({...fileId(st),size:String(st.size),mtime:String(st.mtimeNs),ctime:String(st.ctimeNs),links:String(st.nlink)});
const sameId=(a,b)=>a.dev===b.dev&&a.ino===b.ino&&a.birth===b.birth;
const sameStat=(a,b)=>JSON.stringify(statProof(a))===JSON.stringify(statProof(b));
function readFile(file,max=MAX_META){dir(path.dirname(file));const before=fs.lstatSync(file,{bigint:true});if(!before.isFile()||before.isSymbolicLink()||before.nlink!==1n||before.size>BigInt(max)||canonical(fs.realpathSync(file))!==canonical(file))fail('preparation_unsafe');let fd;
 try{fd=fs.openSync(file,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW||0));if(!sameStat(before,fs.fstatSync(fd,{bigint:true})))fail('preparation_changed');const bytes=Buffer.alloc(Number(before.size)),extra=Buffer.alloc(1);let pos=0;while(pos<bytes.length){const n=fs.readSync(fd,bytes,pos,bytes.length-pos,pos);if(!n)fail('preparation_changed');pos+=n;}if(fs.readSync(fd,extra,0,1,pos)||!sameStat(before,fs.fstatSync(fd,{bigint:true}))||!sameStat(before,fs.lstatSync(file,{bigint:true})))fail('preparation_changed');return {bytes,stat:statProof(before),sha256:hash(bytes)};}finally{if(fd!==undefined)fs.closeSync(fd);}}
function jsonFile(file,max){const record=readFile(file,max);let value;try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(record.bytes));}catch{fail('preparation_proof_unavailable');}if(!plain(value))fail('preparation_proof_unavailable');return {...record,value};}
function names(folder,limit){const handle=fs.opendirSync(folder),result=[];try{let row;while((row=handle.readSync())){if(result.length>=limit)fail('preparation_limit');result.push(row.name);}return result.sort();}finally{handle.closeSync();}}
function childName(name){if(typeof name!=='string'||!name||name.length>240||name==='.'||name==='..'||/[\\/:\p{Cc}\p{Cf}<>"|?*]/u.test(name)||/[. ]$/.test(name)||name!==name.normalize('NFC')||/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name))fail('preparation_unsafe');}
function inventory(value){
 if(!plain(value)||!Array.isArray(value.files)||!value.files.length||!Array.isArray(value.directories)||value.files.length+value.directories.length>MAX_FILES)fail('preparation_proof_unavailable');
 const seen=new Set(),dirs=new Set(value.directories),files=[];let total=0;
 const relative=name=>{if(typeof name!=='string'||name.length>240)fail('preparation_unsafe');const parts=name.split('/');if(parts.length>16)fail('preparation_limit');for(const part of parts)childName(part);if(seen.has(name.toLowerCase()))fail('preparation_unsafe');seen.add(name.toLowerCase());return parts;};
 for(const name of value.directories)relative(name);
 for(const row of value.files){if(!plain(row)||!Number.isSafeInteger(row.size)||row.size<0||row.size>MAX_FILE)fail('preparation_proof_unavailable');const parts=relative(row.path);for(let i=1;i<parts.length;i++)if(!dirs.has(parts.slice(0,i).join('/')))fail('preparation_proof_unavailable');total+=row.size;if(total>MAX_BYTES)fail('preparation_limit');files.push({path:row.path,size:row.size});}
 return {files,directories:[...value.directories]};
}
function permitted(contents,expected){const files=new Map(expected.files.map(row=>['code/'+row.path,row.size])),directories=new Set(['','code',...expected.directories.map(name=>'code/'+name)]);if(contents.files.some(row=>!files.has(row.path)||BigInt(row.stat.size)>BigInt(files.get(row.path)))||contents.directories.some(row=>!directories.has(row.path)))fail('preparation_unsafe');}
function tree(root){const directories=[],files=[],queue=[{relative:'',file:root,depth:0}],seen=new Set();let totalBytes=0;
 while(queue.length){const entry=queue.pop();if(entry.depth>17||files.length+directories.length>MAX_FILES)fail('preparation_limit');const before=dir(entry.file),rows=names(entry.file,MAX_FILES);directories.push({path:entry.relative,stat:statProof(before)});
  for(const name of rows){childName(name);const relative=entry.relative?`${entry.relative}/${name}`:name,key=relative.toLowerCase();if(seen.has(key))fail('preparation_unsafe');seen.add(key);if(seen.size>MAX_FILES)fail('preparation_limit');const file=path.join(entry.file,name),st=fs.lstatSync(file,{bigint:true});if(st.isSymbolicLink())fail('preparation_unsafe');if(st.isDirectory())queue.push({relative,file,depth:entry.depth+1});else{if(!st.isFile()||st.nlink!==1n||st.size>BigInt(MAX_FILE))fail('preparation_unsafe');totalBytes+=Number(st.size);if(totalBytes>MAX_BYTES)fail('preparation_limit');const row=readFile(file,MAX_FILE);files.push({path:relative,stat:row.stat,sha256:row.sha256});}}
  if(!sameStat(before,fs.lstatSync(entry.file,{bigint:true}))||JSON.stringify(rows)!==JSON.stringify(names(entry.file,MAX_FILES)))fail('preparation_changed');
 }
 files.sort((a,b)=>a.path<b.path?-1:1);directories.sort((a,b)=>a.path<b.path?-1:1);return {directories,files,totalBytes};}
function movedTree(value){return {files:value.files,directories:value.directories.map(row=>row.path?row:{path:'',stat:{dev:row.stat.dev,ino:row.stat.ino,birth:row.stat.birth}}),totalBytes:value.totalBytes};}
function proof(value){return plain(value)&&Number.isSafeInteger(value.pid)&&value.pid>0&&typeof value.createdAt==='string'&&Number.isFinite(Date.parse(value.createdAt))&&typeof value.executable==='string'&&path.isAbsolute(value.executable)&&!/^[/\\]{2}/.test(value.executable);}
const identity=row=>({pid:row.pid,createdAt:row.createdAt,executable:row.executable});
const sameOwner=(a,b)=>proof(a)&&proof(b)&&a.pid===b.pid&&a.createdAt===b.createdAt&&canonical(a.executable)===canonical(b.executable);
let nativeOwn;
function createPreparationProcessHost(){return {async inspect(pids){
 if(process.platform!=='win32'||!Array.isArray(pids)||pids.length!==1||!Number.isSafeInteger(pids[0])||pids[0]<1)fail('process_check_failed');
 const script=`$ErrorActionPreference='Stop';$rows=@(Get-CimInstance Win32_Process -Filter 'ProcessId=${pids[0]}' | ForEach-Object {[pscustomobject]@{pid=[int]$_.ProcessId;createdAt=$_.CreationDate.ToUniversalTime().ToString('o');executable=[string]$_.ExecutablePath}});ConvertTo-Json -InputObject $rows -Compress`;
 const executable=path.join(process.env.SystemRoot||'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe');
 const output=await new Promise((resolve,reject)=>execFile(executable,['-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{windowsHide:true,timeout:10000,maxBuffer:16384},(error,stdout)=>error?reject(new QQPreparationRecoveryError('process_check_failed')):resolve(stdout)));
 try{return JSON.parse(output.trim());}catch{fail('process_check_failed');}
 }};}
async function observe(host,pid){let rows;try{rows=await host.inspect([pid]);}catch{fail('process_check_failed');}if(!Array.isArray(rows)||rows.length>1||rows.some(row=>!proof(row)||row.pid!==pid))fail('process_check_failed');return rows[0]||null;}
function currentGuard(signal,assertCurrent){if(signal?.aborted)fail(signal.reason?.code==='timeout'?'timeout':'cancelled');if(assertCurrent!==undefined&&typeof assertCurrent!=='function')fail('invalid_request');const result=assertCurrent?.();if(result&&typeof result.then==='function'){result.catch(()=>{});fail('invalid_request');}}
class QQPreparationRecovery{
 constructor({root,packages,component='napcat-shell',lockRoot,processHost,now=Date.now,monotonic=()=>performance.now()}={}){
  if(!COMPONENTS.includes(component)||!packages||typeof packages.verify!=='function'||typeof now!=='function'||typeof monotonic!=='function'||processHost&&typeof processHost.inspect!=='function')fail('invalid_request');
  this.root=local(root);this.component=component;this.packages=packages;this.lockRoot=local(lockRoot||path.join(path.dirname(this.root),'qq-runtime-locks'));this.host=processHost||createPreparationProcessHost();this.nativeHost=!processHost;this.now=now;this.monotonic=monotonic;
  this.base=path.join(this.root,'qq-component-versions',component);this.records=path.join(this.root,'qq-component-preparation-records',component);this.quarantine=path.join(this.root,'qq-component-preparation-quarantine',component);this.ticket=null;this.busy=false;
 }
 _gate(versionId,operation,{signal,gate}={}){
  const run=held=>withRecoveryGate(hash(JSON.stringify(['qq-preparation-v1',canonical(this.root),this.component,versionId])),async assertPreparation=>{
   const checked=()=>{held?.();assertPreparation();if(this.component==='napcat-node')require('./qq-managed-node-repair-metadata.cjs').assertManagedNodeRepairReady({root:this.root});else require('./qq-managed-shell-repair-metadata.cjs').assertManagedShellRepairReady({root:this.root});};
   checked();return operation(checked);
  });
  return this.component==='napcat-node'?withNodeCodeGate({root:this.root,signal,gate},run):withShellCodeGate({root:this.root,signal,gate},run);
 }
 _version(value){if(typeof value!=='string'||!new RegExp(`^${this.component}-4\\.18\\.42-[a-f0-9]{16}$`).test(value))fail('invalid_request');return value;}
 _record(id){if(typeof id!=='string'||!UUID.test(id))fail('invalid_request');const file=path.join(this.records,`${id}.json`);if(!exists(file))fail('preparation_record_missing');const row=jsonFile(file),v=row.value;
  if(v.schema!=='qq_component_preparation_v1'||v.preparationId!==id||v.component!==this.component||v.version!=='4.18.42'||!proof(v.owner)||!plain(v.directory)||!['dev','ino','birth'].every(k=>typeof v.directory[k]==='string'&&/^\d+$/.test(v.directory[k]))||!plain(v.source)||!HEX.test(v.source.sha256)||v.source.tag!=='v4.18.42'||!Number.isSafeInteger(v.source.assetId)||v.source.assetId<1||!Number.isSafeInteger(v.source.size)||v.source.size<1||v.source.size>128*1024*1024||v.versionId!==`${this.component}-${v.version}-${v.source.sha256.slice(0,16)}`||!['extracting','publishing'].includes(v.phase))fail('preparation_proof_unavailable');this._version(v.versionId);inventory(v.inventory);return {...row,file};
 }
 list(){const entries=[],issues=new Set();if(!exists(this.records))return {entries,issues:[]};try{dir(this.records);const entriesNames=names(this.records,MAX_RECORDS);for(const name of entriesNames){try{if(!/^[a-f0-9-]{36}\.json$/.test(name))fail('preparation_proof_unavailable');const r=this._record(name.slice(0,-5)),v=r.value;if(!exists(path.join(this.base,v.versionId)))continue;if(v.phase!=='extracting'){issues.add('preparation_publishing');continue;}if(exists(path.join(this.base,v.versionId,'prepared.json')))continue;if(!sameId(fileId(dir(path.join(this.base,v.versionId))),v.directory))continue;entries.push({preparationId:v.preparationId,component:v.component,versionId:v.versionId,version:v.version,state:'recorded-incomplete',verification:'not-checked'});}catch(error){issues.add(CODES.has(error?.code)?error.code:'preparation_proof_unavailable');}}}catch(error){issues.add(CODES.has(error?.code)?error.code:'preparation_recovery_failed');}return {entries,issues:[...issues]};}
 discardPreview(){this.ticket=null;}
 async _own(){if(this.nativeHost){nativeOwn??=observe(this.host,process.pid).catch(error=>{nativeOwn=null;throw error;});const row=await nativeOwn;if(!row||canonical(row.executable)!==canonical(process.execPath))fail('process_check_failed');return identity(row);}const row=await observe(this.host,process.pid);if(!row||canonical(row.executable)!==canonical(process.execPath))fail('process_check_failed');return identity(row);}
 async runWriter({versionId,version,source,signal,gate},operation){
  this._version(versionId);if(version!=='4.18.42'||versionId!==`${this.component}-${version}-${source?.sha256?.slice(0,16)}`||typeof operation!=='function')fail('invalid_request');
  let preparedCommitted=false;try{return await this._gate(versionId,async assertGate=>{currentGuard(signal);assertGate();const owner=await this._own();currentGuard(signal);assertGate();let file,fd,expected,value,result,failure;
   const exact=()=>{if(!file||fd===undefined)fail('preparation_proof_unavailable');const row=readFile(file);if(JSON.stringify(row.stat)!==JSON.stringify(expected.stat)||row.sha256!==expected.sha256||!sameStat(fs.fstatSync(fd,{bigint:true}),fs.lstatSync(file,{bigint:true})))fail('preparation_changed');};
   const writer={allocated:(versionDir,expectedInventory)=>{assertGate();currentGuard(signal);if(canonical(versionDir)!==canonical(path.join(this.base,versionId)))fail('invalid_request');dir(this.records,true);if(names(this.records,MAX_RECORDS).length>=MAX_RECORDS)fail('preparation_limit');const preparationId=randomUUID();value={schema:'qq_component_preparation_v1',preparationId,component:this.component,versionId,version,source,owner,directory:fileId(dir(versionDir)),phase:'extracting',inventory:inventory(expectedInventory),createdAt:new Date(this.now()).toISOString()};file=path.join(this.records,`${preparationId}.json`);const bytes=Buffer.from(JSON.stringify(value)+'\n');if(bytes.length>MAX_META)fail('preparation_limit');fd=fs.openSync(file,'wx',0o600);fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);const st=statProof(fs.fstatSync(fd,{bigint:true}));expected=readFile(file);if(JSON.stringify(st)!==JSON.stringify(expected.stat)||expected.sha256!==hash(bytes))fail('preparation_changed');exact();},
    publishing:()=>{assertGate();currentGuard(signal);exact();value={...value,phase:'publishing'};const bytes=Buffer.from(JSON.stringify(value)+'\n');fs.writeSync(fd,bytes,0,bytes.length,0);fs.ftruncateSync(fd,bytes.length);fs.fsyncSync(fd);const st=statProof(fs.fstatSync(fd,{bigint:true}));expected=readFile(file);if(JSON.stringify(st)!==JSON.stringify(expected.stat)||expected.sha256!==hash(bytes))fail('preparation_changed');exact();},
    assertOwned:()=>{assertGate();currentGuard(signal);exact();}
   };
   try{result=await operation(writer);}catch(error){failure=error;}
   finally{
    if(fd!==undefined){let removable=false;try{exact();removable=result?.state==='prepared'||!exists(path.join(this.base,versionId));}catch{/* Keep unknown marker and bytes. */}try{fs.closeSync(fd);}catch{/* The artifact result is independent of handle cleanup. */}fd=undefined;
     if(removable)try{const row=readFile(file);if(JSON.stringify(row.stat)===JSON.stringify(expected.stat)&&row.sha256===expected.sha256)fs.unlinkSync(file);}catch{/* Retain an orphan record; it never authorizes a complete version. */}
    }
   }
   if(failure)throw failure;preparedCommitted=result?.state==='prepared';return result;
  },{signal,gate});}catch(error){if(preparedCommitted)error.committed=true;throw error;}
 }
 _references(versionId){const files=[],directories=[];
  const listing=(folder,limit=256)=>{if(!exists(folder)){directories.push({path:folder,absent:true});return [];}const st=dir(folder),listing=names(folder,limit);directories.push({path:folder,id:fileId(st),names:listing});return listing;};
  const selected=(file,schema)=>{const row=jsonFile(file,2*1024*1024),v=row.value;if(!schema.includes(v.schema)||!plain(v.current)||v.previous!==null&&!plain(v.previous))fail('reference_unverified');for(const ref of [v.current,v.previous]){if(!ref)continue;if(ref.kind==='prepared'){if(typeof ref.versionId!=='string'||typeof ref.manifestSha256!=='string'||!HEX.test(ref.manifestSha256))fail('reference_unverified');if(ref.versionId===versionId)fail('preparation_selected');}else if(ref.kind!=='original')fail('reference_unverified');}files.push({file,sha256:row.sha256,stat:row.stat});};
  for(const name of listing(this.lockRoot,1024))if(name==='configuration.edit'||name.startsWith('installation-')&&(/\.lock(?:\.recover)?$/.test(name)))fail('component_locked');
  const selections=path.join(this.lockRoot,'component-selections');for(const name of listing(selections)){if(/^[a-f0-9]{64}\.json$/.test(name))selected(path.join(selections,name),['qq_component_selection_v1']);else if(!/^[a-f0-9]{64}$/.test(name))fail('reference_unverified');else dir(path.join(selections,name));}
  for(const [name,schema]of [['qq-installations','qq_managed_shell_v1'],['qq-node-installations','qq_managed_node_v1']]){const root=path.join(this.root,name);for(const id of listing(root)){if(!UUID.test(id))fail('reference_unverified');const folder=path.join(root,id);dir(folder);if(!exists(path.join(folder,'installation.json')))fail('reference_unverified');selected(path.join(folder,'installation.json'),[schema]);}}
  return {files,directories};
 }
 _observation(record){const v=record.value;if(v.phase!=='extracting')fail('preparation_publishing');const versionDir=path.join(this.base,v.versionId),target=path.join(this.quarantine,v.preparationId);
  if(!exists(versionDir)){if(exists(target))fail('preparation_already_quarantined');fail('preparation_changed');}if(exists(path.join(versionDir,'prepared.json')))fail('preparation_complete');if(!sameId(fileId(dir(versionDir)),v.directory))fail('preparation_changed');if(exists(target))fail('preparation_changed');
  const now=this._record(v.preparationId);if(now.sha256!==record.sha256||JSON.stringify(now.stat)!==JSON.stringify(record.stat))fail('preparation_changed');const contents=tree(versionDir);permitted(contents,v.inventory);const references=this._references(v.versionId);return {contents,references,digest:hash(JSON.stringify({record:{sha256:record.sha256,stat:record.stat},contents,references}))};
 }
 async _dead(owner){const current=await observe(this.host,owner.pid);if(current){if(sameOwner(current,owner))fail('owner_alive');fail('owner_identity_changed');}}
 async _eligible(record,{signal,assertCurrent,assertGate}){currentGuard(signal,assertCurrent);assertGate();await this._dead(record.value.owner);currentGuard(signal,assertCurrent);assertGate();await this._dead(record.value.owner);currentGuard(signal,assertCurrent);assertGate();return this._observation(record);}
 async preview({preparationId,signal,assertCurrent}={}){if(this.busy)fail('preparation_busy');this.busy=true;this.discardPreview();try{const record=this._record(preparationId);return await this._gate(record.value.versionId,async assertGate=>{const obs=await this._eligible(record,{signal,assertCurrent,assertGate});currentGuard(signal,assertCurrent);assertGate();const token=randomUUID(),expiresAt=this.now()+300000;this.ticket={token,expectedDigest:obs.digest,preparationId,expiresAt,deadline:this.monotonic()+300000};return {operation:'preparation-recovery',ticketId:token,expectedDigest:obs.digest,expiresAt,preparationId,component:this.component,versionId:record.value.versionId,version:record.value.version,fileCount:obs.contents.files.length,directoryCount:obs.contents.directories.length,totalBytes:obs.contents.totalBytes,preservesDirectory:true,automaticRetry:false,automaticStart:false};});}catch(error){throw this._public(error);}finally{this.busy=false;}}
 async recover({ticketId,expectedDigest,signal,assertCurrent}={}){if(this.busy)fail('preparation_busy');const ticket=this.ticket;this.discardPreview();if(!ticket||ticket.token!==ticketId||typeof expectedDigest!=='string'||expectedDigest!==ticket.expectedDigest)fail('preview_required');if(this.monotonic()>=ticket.deadline)fail('preview_expired');this.busy=true;
  try{const record=this._record(ticket.preparationId);return await this._gate(record.value.versionId,async assertGate=>{
   let obs=await this._eligible(record,{signal,assertCurrent,assertGate});if(obs.digest!==expectedDigest)fail('preparation_changed');dir(this.quarantine,true);
   // Directory creation is outside the version tree. Recheck both proofs after
   // that I/O and the final independent owner observation, immediately before rename.
   await this._dead(record.value.owner);obs=this._observation(record);if(obs.digest!==expectedDigest)fail('preparation_changed');if(this.monotonic()>=ticket.deadline)fail('preview_expired');currentGuard(signal,assertCurrent);assertGate();
   const source=path.join(this.base,record.value.versionId),target=path.join(this.quarantine,record.value.preparationId);let committed=false,attempted=false;
   try{attempted=true;fs.renameSync(source,target);committed=true;const actual=tree(target);if(exists(source)||JSON.stringify(movedTree(actual))!==JSON.stringify(movedTree(obs.contents)))fail('preparation_readback_failed');
    return {committed:true,recovered:true,quarantineId:record.value.preparationId,component:this.component,versionId:record.value.versionId,preserved:true,automaticRetry:false,automaticStart:false,selectionChanged:false};
   }catch(error){if(!committed){try{if(!exists(source)&&exists(target)&&JSON.stringify(movedTree(tree(target)))===JSON.stringify(movedTree(obs.contents)))committed=true;}catch{/* Unknown effect remains unknown. */}}
    if(committed)return {committed:true,recovered:false,quarantineId:record.value.preparationId,component:this.component,versionId:record.value.versionId,preserved:true,automaticRetry:false,automaticStart:false,selectionChanged:false,recoveryIssue:'preparation_readback_failed'};
    const out=new QQPreparationRecoveryError('preparation_commit_unconfirmed');out.changeAttempted=attempted;out.committed=null;throw out;
   }
  });}catch(error){throw this._public(error);}finally{this.busy=false;}
 }
 _public(error){if(error instanceof QQPreparationRecoveryError)return error;const out=new QQPreparationRecoveryError(error?.code);if(error?.committed===true)out.committed=true;if(error?.committed===null){out.committed=null;out.changeAttempted=true;}return out;}
}
module.exports={QQPreparationRecovery,QQPreparationRecoveryError,createPreparationProcessHost};
