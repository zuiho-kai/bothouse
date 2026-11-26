'use strict';
// Original, local-only recovery. Restores an already recorded healthy previous
// selection; it does not fix, delete, download or execute the damaged code.
const fs=require('node:fs'),path=require('node:path');
const {createHash,randomUUID}=require('node:crypto');
const {performance}=require('node:perf_hooks');
const HEX=/^[a-f0-9]{64}$/,UUID=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const ID=/^napcat-shell-\d+\.\d+\.\d+-[a-f0-9]{16}$/;
const REQUIRED=['NapCatWinBootMain.exe','NapCatWinBootHook.dll','napcat.mjs','qqnt.json'];
const LIMITS={file:128*1024*1024,total:512*1024*1024,entries:10000,metadata:2*1024*1024,depth:16};
const CODES=new Set(['invalid_request','repair_unavailable','repair_not_needed','preview_required','preview_expired','repair_changed','repair_busy','cancelled','changed','manager_closing','repair_failed','repair_commit_unconfirmed','repair_readback_failed','invalid_response','unsafe_path','manifest_invalid','selection_invalid','selection_changed','component_changed','component_missing','component_io_failed','qq_component_changed','managed_installation_changed','invalid_installation','pending_upstream_update','runtime_locked','operation_in_progress','process_check_failed','desktop_running','runtime_running','component_locked','component_lock_changed','recovery_in_progress','unsafe_lock','selection_history_full','prepared_invalid','package_not_staged','artifact_changed','version_change_not_supported','component_lock_handle_close_failed','component_lock_retained','component_lock_state_unverified']);
const plain=v=>v&&typeof v==='object'&&!Array.isArray(v),hex=v=>typeof v==='string'&&HEX.test(v),sha=v=>createHash('sha256').update(v).digest('hex');
const codeOf=e=>CODES.has(e?.code)?e.code:'repair_failed';
class QQComponentRepairError extends Error{constructor(code){super(`QQ component repair failed (${CODES.has(code)?code:'repair_failed'}).`);this.code=CODES.has(code)?code:'repair_failed';}}
const fail=code=>{throw new QQComponentRepairError(code);};
const same=(a,b)=>path.resolve(a).toLowerCase()===path.resolve(b).toLowerCase();
function local(value){if(typeof value!=='string'||!path.isAbsolute(value)||/^[/\\]{2}/.test(value)||/[\0\r\n]/.test(value))fail('unsafe_path');return path.resolve(value);}
function safe(file,{directory=false,max=LIMITS.file}={}){
  const resolved=local(file);let cursor=resolved,found;
  for(;;){const st=fs.lstatSync(cursor);if(st.isSymbolicLink())fail('unsafe_path');if(cursor===resolved){found=st;if(directory?!st.isDirectory():!st.isFile()||st.nlink!==1||st.size>max)fail('unsafe_path');}else if(!st.isDirectory())fail('unsafe_path');const parent=path.dirname(cursor);if(parent===cursor)break;cursor=parent;}
  if(!same(fs.realpathSync(resolved),resolved))fail('unsafe_path');return found;
}
const identity=st=>({dev:String(st.dev),ino:String(st.ino),size:st.size,mtime:st.mtimeMs,ctime:st.ctimeMs,birthtime:st.birthtimeMs,nlink:st.nlink});
const equalStat=(a,b)=>JSON.stringify(identity(a))===JSON.stringify(identity(b));
const dirIdentity=file=>{const st=safe(file,{directory:true});return {dev:String(st.dev),ino:String(st.ino),birthtime:st.birthtimeMs};};
function read(file,{max=LIMITS.file,bytes=false}={}){
  const before=safe(file,{max}),fd=fs.openSync(file,'r');let result;
  try{const opened=fs.fstatSync(fd);if(!equalStat(before,opened))fail('repair_changed');const hash=createHash('sha256'),buffer=Buffer.alloc(Math.min(65536,opened.size)),parts=[];let pos=0;
    while(pos<opened.size){const n=fs.readSync(fd,buffer,0,Math.min(buffer.length,opened.size-pos),pos);if(!n)fail('repair_changed');const block=buffer.subarray(0,n);hash.update(block);if(bytes)parts.push(Buffer.from(block));pos+=n;}
    if(!equalStat(opened,fs.fstatSync(fd))||!equalStat(opened,safe(file,{max})))fail('repair_changed');result={...identity(opened),sha256:hash.digest('hex'),...(bytes?{bytes:Buffer.concat(parts)}:{})};
  }finally{fs.closeSync(fd);}return result;
}
function relative(value){
  if(typeof value!=='string'||!value||value.length>240||value.includes('\\')||/[:\p{Cc}\p{Cf}\u2028\u2029\ufffd]/u.test(value)||value!==value.normalize('NFC')||value.startsWith('/'))fail('manifest_invalid');
  const parts=value.split('/');if(parts.length>LIMITS.depth||parts.some(v=>!v||v==='.'||v==='..'||/[. ]$/.test(v)||/[<>"|?*]/.test(v)||/^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(v)))fail('manifest_invalid');return value;
}
function preparedMetadata(selection,record){
  if(record.kind!=='prepared'||!ID.test(record.versionId)||!hex(record.manifestSha256))fail('repair_unavailable');
  const root=path.join(selection.preparedRoot,record.versionId);safe(root,{directory:true});
  if(JSON.stringify(fs.readdirSync(root).sort())!==JSON.stringify(['code','prepared.json']))fail('manifest_invalid');
  const metadata=read(path.join(root,'prepared.json'),{max:LIMITS.metadata,bytes:true});if(metadata.sha256!==record.manifestSha256)fail('manifest_invalid');let value;try{value=JSON.parse(metadata.bytes);}catch{fail('manifest_invalid');}delete metadata.bytes;
  if(!plain(value)||value.schema!=='qq_component_prepared_v1'||value.component!=='napcat-shell'||value.versionId!==record.versionId||value.version!==record.version||!Array.isArray(value.files)||!value.files.length||value.files.length>LIMITS.entries||!Array.isArray(value.directories)||value.directories.length>LIMITS.entries)fail('manifest_invalid');
  const files=new Map(),dirs=new Set(),names=new Set();let total=0;
  for(const row of value.files){if(!plain(row)||!hex(row.sha256)||!Number.isSafeInteger(row.size)||row.size<0||row.size>LIMITS.file)fail('manifest_invalid');relative(row.path);const key=row.path.toLowerCase();if(names.has(key))fail('manifest_invalid');names.add(key);files.set(row.path,{size:row.size,sha256:row.sha256});total+=row.size;if(total>LIMITS.total)fail('manifest_invalid');}
  for(const name of value.directories){relative(name);if(names.has(name.toLowerCase()))fail('manifest_invalid');names.add(name.toLowerCase());dirs.add(name);}
  for(const name of [...files.keys(),...dirs]){const parts=name.split('/');for(let i=1;i<parts.length;i++)if(!dirs.has(parts.slice(0,i).join('/')))fail('manifest_invalid');}
  if(REQUIRED.some(name=>!files.has(name))||![...files.keys()].some(name=>name.startsWith('static/')))fail('manifest_invalid');
  return {root,codeRoot:path.join(root,'code'),metadata,files,dirs};
}
function tree(selection,record,{allowDamage=false}={}){
  const manifest=preparedMetadata(selection,record),proof=[],seenFiles=new Set(),seenDirs=new Set(),names=new Set();let count=0,total=0,damaged=false;
  const walk=(directory,prefix='')=>{const before=safe(directory,{directory:true});proof.push({path:prefix,kind:'directory',...identity(before)});
    for(const name of fs.readdirSync(directory).sort()){if(++count>LIMITS.entries*2)fail('manifest_invalid');const rel=relative(prefix+name),file=path.join(directory,name),st=fs.lstatSync(file),key=rel.toLowerCase();if(names.has(key))fail('unsafe_path');names.add(key);
      if(st.isSymbolicLink())fail('unsafe_path');if(st.isDirectory()){seenDirs.add(rel);if(!manifest.dirs.has(rel))damaged=true;walk(file,rel+'/');}
      else{const actual=read(file);total+=actual.size;if(total>LIMITS.total)fail('manifest_invalid');const expected=manifest.files.get(rel);if(!expected||expected.size!==actual.size||expected.sha256!==actual.sha256)damaged=true;seenFiles.add(rel);proof.push({path:rel,kind:'file',...actual});}
    }if(!equalStat(before,safe(directory,{directory:true})))fail('repair_changed');
  };walk(manifest.codeRoot);
  if(seenFiles.size!==manifest.files.size||[...manifest.files.keys()].some(name=>!seenFiles.has(name))||seenDirs.size!==manifest.dirs.size||[...manifest.dirs].some(name=>!seenDirs.has(name)))damaged=true;
  if(damaged&&!allowDamage)fail('component_changed');return {metadata:manifest.metadata,root:dirIdentity(manifest.root),proof,damaged};
}
function targetProof(selection,target){
  if(target.kind==='prepared')return tree(selection,target);
  if(target.kind!=='original'||selection.managed||!Array.isArray(target.files)||target.files.length!==REQUIRED.length)fail('repair_unavailable');
  return {root:dirIdentity(selection.workDir),files:target.files.map(row=>{const actual=read(path.join(selection.workDir,row.path));if(actual.size!==row.size||actual.sha256!==row.sha256)fail('component_changed');return {path:row.path,...actual};})};
}
function brief(value){return {kind:value.kind,version:value.version,...(value.kind==='prepared'?{versionId:value.versionId}:{})};}
function currentCheck(signal,assertCurrent){if(signal?.aborted)fail('cancelled');if(assertCurrent!==undefined&&typeof assertCurrent!=='function')fail('invalid_request');const value=assertCurrent?.();if(value&&typeof value.then==='function'){Promise.resolve(value).catch(()=>{});fail('invalid_request');}}
function mkdirSafe(dir){if(!fs.existsSync(dir)){safe(path.dirname(dir),{directory:true});fs.mkdirSync(dir,{mode:0o700});}safe(dir,{directory:true});}
function writeNew(file,bytes){const fd=fs.openSync(file,'wx',0o600);try{fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);return identity(fs.fstatSync(fd));}finally{fs.closeSync(fd);}}
function removeOwn(file,proof,hash){try{const current=read(file,{max:32768});if(current.dev===proof?.dev&&current.ino===proof?.ino&&current.sha256===hash)fs.unlinkSync(file);}catch{/* Preserve unknown files and uncertain writes. */}}
class QQComponentRepair{
  constructor({selection,now=()=>Date.now(),monotonic=()=>performance.now()}={}){
    if(!selection||['_state','_qq','_stopped','_verify','_lock','_summary'].some(key=>typeof selection[key]!=='function')||typeof now!=='function'||typeof monotonic!=='function')fail('invalid_request');
    this.selection=selection;this.now=now;this.monotonic=monotonic;this.ticket=null;this.busy=false;this.closed=false;
  }
  discard(){this.ticket=null;}
  discardPreview(){this.discard();}
  close(){this.closed=true;this.discard();}
  _alive(signal,assertCurrent){if(this.closed)fail('manager_closing');currentCheck(signal,assertCurrent);}
  _observe(){
    const selection=this.selection,state=selection._state();if(!state.bytes||state.value.current.kind!=='prepared'||!state.value.previous)fail('repair_unavailable');
    if(state.value.current.version!==state.value.previous.version)fail('version_change_not_supported');if(JSON.stringify(state.value.current)===JSON.stringify(state.value.previous))fail('repair_unavailable');
    selection._qq(state);const stateProof=read(selection.stateFile,{max:32768});if(stateProof.sha256!==state.digest)fail('repair_changed');
    const damage=tree(selection,state.value.current,{allowDamage:true});if(!damage.damaged)fail('repair_not_needed');
    const target=targetProof(selection,state.value.previous),layout={components:dirIdentity(selection.componentsRoot),work:dirIdentity(selection.workDir),config:dirIdentity(path.join(selection.workDir,'config')),qq:read(selection.qqExe,{max:512*1024*1024}),managed:selection.managed?.read().descriptorSha256||null};
    const digest=sha(Buffer.from(JSON.stringify({stateProof,damage,target,layout})));return {state,digest,target:state.value.previous};
  }
  _locks(assertOwned){
    const exists=file=>{try{fs.lstatSync(file);return true;}catch(error){if(error.code==='ENOENT')return false;throw error;}};
    if(exists(`${this.selection.lockFile}.recover`))fail('recovery_in_progress');if(assertOwned)assertOwned();else if(exists(this.selection.lockFile))fail('component_locked');
  }
  async _checked(signal,assertCurrent,assertOwned){
    this._alive(signal,assertCurrent);this._locks(assertOwned);await this.selection._stopped();this._alive(signal,assertCurrent);const first=this._observe();await this.selection._verify(first.target,signal);this._alive(signal,assertCurrent);await this.selection._stopped();this._alive(signal,assertCurrent);this._locks(assertOwned);const result=this._observe();if(result.digest!==first.digest)fail('repair_changed');return result;
  }
  async preview({signal,assertCurrent}={}){
    if(this.busy)fail('repair_busy');this.discard();this.busy=true;
    try{const checked=await this._checked(signal,assertCurrent);this._alive(signal,assertCurrent);
      const ticket={id:randomUUID(),digest:checked.digest,stateDigest:checked.state.digest,deadline:this.monotonic()+300000};this.ticket=ticket;
      return {operation:'repair',ticketId:ticket.id,expectedDigest:ticket.digest,expiresAt:this.now()+300000,current:brief(checked.state.value.current),target:{...brief(checked.target),verification:checked.target.kind==='prepared'?'full-manifest':'mandatory-files-only'},damage:'code_integrity_mismatch',preservesDamagedDirectory:true,clearsRollback:true,automaticStart:false};
    }catch(error){throw new QQComponentRepairError(codeOf(error));}finally{this.busy=false;}
  }
  async repair({ticketId,expectedDigest,signal,assertCurrent}={}){
    if(this.busy)fail('repair_busy');if(typeof ticketId!=='string'||!UUID.test(ticketId)||!hex(expectedDigest))fail('invalid_request');const ticket=this.ticket;this.discard();if(!ticket||ticket.id!==ticketId)fail('preview_required');if(ticket.digest!==expectedDigest)fail('repair_changed');if(this.monotonic()>=ticket.deadline)fail('preview_expired');this._alive(signal,assertCurrent);this.busy=true;
    let receipt=null,attempted=false,committed=false;
    try{return await this.selection._lock(async assertOwned=>{
      const checked=await this._checked(signal,assertCurrent,assertOwned);if(checked.digest!==ticket.digest||checked.state.digest!==ticket.stateDigest)fail('repair_changed');assertOwned();
      const selection=this.selection;mkdirSafe(selection.stateDir);mkdirSafe(selection.historyDir);if(fs.readdirSync(selection.historyDir).length>=64)fail('selection_history_full');
      const value={schema:'qq_component_selection_v1',installationId:selection.installationId,current:checked.target,previous:null,qq:checked.state.value.qq,changedAt:new Date(this.now()).toISOString()};
      const bytes=Buffer.from(JSON.stringify(value,null,2)+'\n'),bytesHash=sha(bytes),tmp=path.join(selection.stateDir,`${selection.installationId}.${randomUUID()}.repair.tmp`),history=path.join(selection.historyDir,`${randomUUID()}.json`);let tempProof;
      try{const historyProof=writeNew(history,checked.state.bytes);tempProof=writeNew(tmp,bytes);
        const final=await this._checked(signal,assertCurrent,assertOwned);if(final.digest!==ticket.digest)fail('repair_changed');if(this._observe().digest!==ticket.digest)fail('repair_changed');const saved=read(history,{max:32768});if(saved.ino!==historyProof.ino||saved.dev!==historyProof.dev||saved.sha256!==checked.state.digest)fail('repair_changed');this._locks(assertOwned);this._alive(signal,assertCurrent);if(this.monotonic()>=ticket.deadline)fail('preview_expired');const temp=read(tmp,{max:32768});if(temp.ino!==tempProof.ino||temp.dev!==tempProof.dev||temp.sha256!==bytesHash)fail('repair_changed');
        // No await between the last ownership/context checks and atomic rename.
        attempted=true;fs.renameSync(tmp,selection.stateFile);committed=true;
        const after=selection._state();if(after.digest!==bytesHash)fail('repair_readback_failed');receipt={committed:true,repaired:true,selection:selection._summary(after),damagedDirectoryPreserved:true,automaticStart:false};return receipt;
      }catch(error){
        if(attempted&&!committed){try{committed=read(selection.stateFile,{max:32768}).sha256===bytesHash;}catch{/* Effects remain uncertain. */}}
        if(committed){receipt={committed:true,repaired:true,selection:null,damagedDirectoryPreserved:true,automaticStart:false,refreshIssue:codeOf(error)};return receipt;}
        if(attempted){receipt={committed:null,changeAttempted:true,code:'repair_commit_unconfirmed',automaticStart:false};return receipt;}
        throw error;
      }finally{if(tempProof&&!committed)removeOwn(tmp,tempProof,bytesHash);}
    });}catch(error){if(committed||error?.committed===true)return {...(receipt||{committed:true,repaired:true,selection:null,damagedDirectoryPreserved:true,automaticStart:false}),...(['component_lock_handle_close_failed','component_lock_retained','component_lock_state_unverified'].includes(codeOf(error))?{lockRecoveryIssue:codeOf(error)}:{refreshIssue:codeOf(error)})};if(attempted)return {committed:null,changeAttempted:true,code:'repair_commit_unconfirmed',automaticStart:false};throw new QQComponentRepairError(codeOf(error));}
    finally{this.busy=false;}
  }
}
module.exports={QQComponentRepair,QQComponentRepairError,codeOf};
