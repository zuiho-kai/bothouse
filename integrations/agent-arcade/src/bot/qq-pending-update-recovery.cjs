'use strict';

// Original opaque-plan quarantine. Never parse or follow an upstream plan.
const fs=require('node:fs'),path=require('node:path');
const {createHash,randomUUID}=require('node:crypto');
const MAX_BYTES=2*1024*1024,MAX_HISTORY=64,TTL=300000;
const UUID=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const HEX=/^[a-f0-9]{64}$/;
const HISTORY='.agent-arcade-pending-updates';
const CODES=new Set(['invalid_request','invalid_response','cancelled','changed','manager_closing',
  'pending_update_unsupported','pending_update_missing','pending_update_changed','pending_update_busy','pending_update_unsafe','pending_update_history_full','pending_update_recovery_required','pending_update_preview_required','pending_update_expired','pending_update_failed','pending_update_unconfirmed','pending_update_readback_failed','pending_update_cleanup_unconfirmed',
  'component_missing','component_changed','component_io_failed','manifest_invalid','prepared_invalid','package_not_staged','artifact_changed','selection_invalid','selection_changed','qq_component_changed','managed_installation_changed','invalid_installation','unsafe_path','runtime_locked','operation_in_progress','process_check_failed','desktop_running','runtime_running','component_locked','component_lock_changed','recovery_in_progress','unsafe_lock','component_lock_handle_close_failed','component_lock_retained','component_lock_state_unverified']);
const codeOf=e=>CODES.has(e?.code)?e.code:'pending_update_failed';
class QQPendingUpdateRecoveryError extends Error{constructor(code){super(`Pending update recovery failed (${CODES.has(code)?code:'pending_update_failed'}).`);this.code=CODES.has(code)?code:'pending_update_failed';}}
const fail=code=>{throw new QQPendingUpdateRecoveryError(code);};
const hash=value=>createHash('sha256').update(value).digest('hex');
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const plain=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
const exists=(file,io=fs)=>{try{io.lstatSync(file);return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}};
const identity=st=>({dev:String(st.dev),ino:String(st.ino),size:String(st.size),mtime:String(st.mtimeNs),birth:String(st.birthtimeNs),ctime:String(st.ctimeNs),links:String(st.nlink)});
const nodeId=st=>({dev:String(st.dev),ino:String(st.ino)});
function safe(file,{directory=false,io=fs,max=MAX_BYTES,links=1}={}){
  if(typeof file!=='string'||!path.isAbsolute(file)||/^[/\\]{2}/.test(file)||/[\0\r\n]/.test(file))fail('pending_update_unsafe');
  const target=path.resolve(file);let cursor=target,result;
  for(;;){const st=io.lstatSync(cursor,{bigint:true});if(st.isSymbolicLink()||(cursor===target?(directory?!st.isDirectory():!st.isFile()||st.nlink<1n||st.nlink>BigInt(links)||st.size>BigInt(max)):!st.isDirectory()))fail('pending_update_unsafe');if(cursor===target)result=st;const next=path.dirname(cursor);if(next===cursor)break;cursor=next;}
  if(path.resolve(io.realpathSync(target)).toLowerCase()!==target.toLowerCase())fail('pending_update_unsafe');return result;
}
function names(dir,max,io=fs){safe(dir,{directory:true,io});const result=[],handle=io.opendirSync(dir);try{for(let row;(row=handle.readSync());){if(result.length>=max)fail('pending_update_history_full');result.push(row.name);}}finally{handle.closeSync();}return result.sort();}
function assertPendingUpdateRecoveryReady(configDirs){
  if(!Array.isArray(configDirs)||configDirs.length>32)fail('pending_update_recovery_required');
  try{for(const config of configDirs){const root=path.join(config,HISTORY);if(exists(root)){safe(root,{directory:true});if(exists(path.join(root,'pending.json')))fail('pending_update_recovery_required');}}}catch{fail('pending_update_recovery_required');}
}
class QQPendingUpdateRecovery{
  constructor({selection,now=Date.now,monotonic=()=>performance.now(),io=fs}={}){
    if(typeof selection?.pendingUpdateRecoveryContext!=='function'||typeof selection?.withPendingUpdateRecovery!=='function'||typeof now!=='function'||typeof monotonic!=='function')fail('invalid_request');
    this.selection=selection;this.now=now;this.monotonic=monotonic;this.io=io;this.ticket=null;this.busy=false;this.closed=false;this.epoch=0;this.failedHandles=new Set();
  }
  discardPreview(){this.ticket=null;this.epoch++;}
  close(){this.closed=true;this.discardPreview();for(const fd of [...this.failedHandles])this._release(fd);return {closed:true};}
  _release(fd){try{this.io.closeSync(fd);this.failedHandles.delete(fd);}catch{this.failedHandles.add(fd);fail('pending_update_cleanup_unconfirmed');}}
  _check(signal,assertCurrent,epoch,deadline){if(this.closed)fail('manager_closing');if(signal?.aborted)fail('cancelled');assertCurrent?.();if(epoch!==undefined&&epoch!==this.epoch)fail('changed');if(deadline!==undefined&&this.monotonic()>=deadline)fail('pending_update_expired');}
  _read(file,{keep=false,max=MAX_BYTES,links=1}={}){
    const before=safe(file,{io:this.io,max,links}),fd=this.io.openSync(file,'r');let result;
    try{const opened=this.io.fstatSync(fd,{bigint:true});if(!equal(identity(opened),identity(before)))fail('pending_update_changed');const bytes=Buffer.alloc(Number(opened.size));let offset=0;
      while(offset<bytes.length){const n=this.io.readSync(fd,bytes,offset,bytes.length-offset,offset);if(!n)fail('pending_update_changed');offset+=n;}
      if(!equal(identity(opened),identity(this.io.fstatSync(fd,{bigint:true})))||!equal(identity(opened),identity(safe(file,{io:this.io,max,links}))))fail('pending_update_changed');result={identity:identity(opened),sha256:hash(bytes),bytes,...(keep?{fd}:{})};
    }catch(e){try{this._release(fd);}catch(cleanup){throw cleanup;}throw e;}
    if(!keep)this._release(fd);return result;
  }
  _write(file,bytes){
    const fd=this.io.openSync(file,'wx',0o600);let proof;
    try{this.io.writeFileSync(fd,bytes);this.io.fsyncSync(fd);const st=this.io.fstatSync(fd,{bigint:true}),saved=this._read(file,{max:16384});if(!equal(nodeId(st),{dev:saved.identity.dev,ino:saved.identity.ino})||saved.sha256!==hash(bytes))fail('pending_update_changed');proof={identity:saved.identity,sha256:saved.sha256};}finally{this._release(fd);}return proof;
  }
  _context(){
    const value=this.selection.pendingUpdateRecoveryContext();
    if(!plain(value)||!['napcat-shell','napcat-node'].includes(value.component)||value.version!=='4.18.42'||!HEX.test(value.installationId)||!HEX.test(value.selectionDigest)||!Array.isArray(value.configDirs)||value.configDirs.length>32||new Set(value.configDirs.map(p=>path.resolve(p).toLowerCase())).size!==value.configDirs.length)fail('invalid_response');
    return value;
  }
  _paths(context,config){const root=path.join(config,HISTORY);return {recordId:hash(`${context.installationId}\0${path.resolve(config).toLowerCase()}`),config,source:path.join(config,'napcat-update.json'),root,pending:path.join(root,'pending.json')};}
  _record(p){
    const pending=this._read(p.pending,{max:16384,links:2});let value;try{value=JSON.parse(pending.bytes);}catch{fail('pending_update_recovery_required');}
    if(!plain(value)||value.schema!=='qq_pending_update_v1'||!UUID.test(value.operationId)||value.recordId!==p.recordId||!HEX.test(value.sourceSha256)||!plain(value.sourceIdentity)||!plain(value.configIdentity)||!plain(value.operationIdentity)||!Number.isSafeInteger(value.bytes)||value.bytes<0||value.bytes>MAX_BYTES)fail('pending_update_recovery_required');
    const operationDir=path.join(p.root,value.operationId),intent=path.join(operationDir,'intent.json'),retained=path.join(operationDir,'plan.bin');
    if(!equal(nodeId(safe(operationDir,{directory:true,io:this.io})),value.operationIdentity)||!equal(nodeId(safe(p.config,{directory:true,io:this.io})),value.configIdentity)||!equal(nodeId(safe(p.root,{directory:true,io:this.io})),value.historyIdentity))fail('pending_update_changed');
    const original=this._read(intent,{max:16384,links:2});if(original.sha256!==pending.sha256||original.identity.ino!==pending.identity.ino||original.identity.dev!==pending.identity.dev||original.identity.links!=='2'||pending.identity.links!=='2')fail('pending_update_changed');
    return {value,pending,operationDir,intent,retained};
  }
  _observe(context){
    return context.configDirs.map(config=>{
      const p=this._paths(context,config),parent=nodeId(safe(config,{directory:true,io:this.io}));let source=null,record=null;
      if(exists(p.root,this.io)){safe(p.root,{directory:true,io:this.io});const list=names(p.root,MAX_HISTORY+1,this.io);if(list.some(n=>n!=='pending.json'&&!UUID.test(n)))fail('pending_update_unsafe');if(exists(p.pending,this.io)){const r=this._record(p);let destination=null;if(exists(r.retained,this.io)){const value=this._read(r.retained,{links:2});destination={identity:value.identity,sha256:value.sha256,bytes:value.bytes.length};}record={value:r.value,pending:{identity:r.pending.identity,sha256:r.pending.sha256},destination};}}
      if(exists(p.source,this.io)){const value=this._read(p.source,{links:record?2:1});source={identity:value.identity,sha256:value.sha256,bytes:value.bytes.length};}
      return {recordId:p.recordId,parent,source,record};
    });
  }
  async list({signal,assertCurrent}={}){
    this._check(signal,assertCurrent);let context;
    try{context=this._context();}catch(e){if(e.code==='pending_update_unsupported')return {supported:false,component:this.selection.prepared?.component==='napcat-node'?'napcat-node':'napcat-shell',verification:'not-checked',records:[],issue:e.code};throw new QQPendingUpdateRecoveryError(codeOf(e));}
    const records=[];
    try{for(const config of context.configDirs){this._check(signal,assertCurrent);const p=this._paths(context,config);safe(config,{directory:true,io:this.io});if(exists(p.pending,this.io))records.push({recordId:p.recordId,state:'review-required',bytes:null});else if(exists(p.source,this.io)){const st=safe(p.source,{io:this.io});records.push({recordId:p.recordId,state:'pending-update',bytes:Number(st.size)});}}return {supported:true,component:context.component,verification:'not-checked',records,issue:null};}catch(e){throw new QQPendingUpdateRecoveryError(codeOf(e));}
  }
  async _checked(gate,check,signal){
    check();gate.assertOwned();const context=this._context(),initial=hash(JSON.stringify({context,rows:this._observe(context)}));
    await gate.assertStopped();check();await gate.verify(signal);check();await gate.assertStopped();check();gate.assertOwned();
    const next=this._context(),rows=this._observe(next),digest=hash(JSON.stringify({context:next,rows}));if(digest!==initial)fail('pending_update_changed');return {context:next,rows,digest};
  }
  _outcome(row){
    const r=row.record;if(!r)fail('pending_update_recovery_required');const v=r.value;
    const source=row.source&&row.source.identity.dev===v.sourceIdentity.dev&&row.source.identity.ino===v.sourceIdentity.ino&&row.source.identity.size===v.sourceIdentity.size&&row.source.identity.mtime===v.sourceIdentity.mtime&&row.source.sha256===v.sourceSha256;
    const destination=r.destination&&r.destination.identity.dev===v.sourceIdentity.dev&&r.destination.identity.ino===v.sourceIdentity.ino&&r.destination.bytes===v.bytes&&r.destination.sha256===v.sourceSha256;
    if(source&&!r.destination&&row.source.identity.links==='1')return false;if(!row.source&&destination&&r.destination.identity.links==='1')return true;if(source&&destination&&row.source.identity.links==='2'&&r.destination.identity.links==='2')return 'linked';fail('pending_update_unconfirmed');
  }
  captureLockRecoveryProof(){
    this._check();const context=this._context(),rows=this._observe(context);
    if(!rows.some(row=>row.source||row.record))fail('pending_update_missing');
    for(const row of rows)if(row.record)this._outcome(row);
    return structuredClone({context,rows});
  }
  async preview({recordId,signal,assertCurrent}={}){
    if(!HEX.test(recordId))fail('invalid_request');if(this.busy)fail('pending_update_busy');this.discardPreview();const epoch=this.epoch;this.busy=true;
    const check=()=>this._check(signal,assertCurrent,epoch);
    try{return await this.selection.withPendingUpdateRecovery(async gate=>{const observed=await this._checked(gate,check,signal),row=observed.rows.find(r=>r.recordId===recordId);if(!row||!row.source&&!row.record)fail('pending_update_missing');
      if(observed.rows.some(r=>r.record&&r.recordId!==recordId))fail('pending_update_recovery_required');if(row.record)this._outcome(row);
      const operation=row.record?'reconcile-pending-update':'disable-pending-update',ticket={id:randomUUID(),recordId,digest:observed.digest,deadline:this.monotonic()+TTL,epoch,operation};this.ticket=ticket;
      return {operation,recordId,ticketId:ticket.id,expectedDigest:ticket.digest,expiresAt:this.now()+TTL,component:observed.context.component,version:'4.18.42',verification:'full-manifest',bytes:row.source?.bytes??row.record.value.bytes,disablesPlan:!row.record,preservesOriginal:true,rollsBackCode:false,automaticStart:false};
    });}catch(e){this.ticket=null;throw new QQPendingUpdateRecoveryError(codeOf(e));}finally{this.busy=false;}
  }
  _receipt(recordId,operationId,disabled,code){return {committed:disabled===null?null:true,disabled,retained:disabled,recordId,operationId,automaticStart:false,rollsBackCode:false,...(code?{code}: {})};}
  _clearPending(p,record){
    const now=this._read(p.pending,{max:16384,links:2});if(!equal(now.identity,record.pending.identity)||now.sha256!==record.pending.sha256)fail('pending_update_changed');this.io.unlinkSync(p.pending);if(exists(p.pending,this.io))fail('pending_update_cleanup_unconfirmed');
  }
  _finish(p,record,disabled){
    const file=path.join(record.operationDir,'result.json'),data=Buffer.from(JSON.stringify({schema:'qq_pending_update_result_v1',operationId:record.value.operationId,recordId:p.recordId,disabled,retained:disabled})+'\n');
    if(exists(file,this.io)){if(!this._read(file,{max:16384}).bytes.equals(data))fail('pending_update_changed');}else this._write(file,data);
    this._clearPending(p,record);
  }
  async confirm({ticketId,expectedDigest,signal,assertCurrent}={}){
    if(this.busy)fail('pending_update_busy');if(!UUID.test(ticketId)||!HEX.test(expectedDigest))fail('invalid_request');const ticket=this.ticket;this.ticket=null;if(!ticket||ticket.id!==ticketId)fail('pending_update_preview_required');if(ticket.digest!==expectedDigest)fail('pending_update_changed');
    const check=()=>this._check(signal,assertCurrent,ticket.epoch,ticket.deadline);check();this.busy=true;let result=null,operationId=null,journalStarted=false,renameAttempted=false,confirmed=false;
    try{const receipt=await this.selection.withPendingUpdateRecovery(async gate=>{
      const checked=await this._checked(gate,check,signal);if(checked.digest!==ticket.digest)fail('pending_update_changed');const row=checked.rows.find(r=>r.recordId===ticket.recordId),config=checked.context.configDirs.find(c=>this._paths(checked.context,c).recordId===ticket.recordId);if(!row||!config)fail('pending_update_changed');const p=this._paths(checked.context,config);
      if(row.record){operationId=row.record.value.operationId;let disabled=this._outcome(row);check();gate.assertOwned();const current=this._observe(this._context());if(hash(JSON.stringify({context:this._context(),rows:current}))!==ticket.digest)fail('pending_update_changed');journalStarted=true;if(disabled==='linked'){const record=this._record(p);this.io.unlinkSync(record.retained);const after=this._observe(this._context()).find(r=>r.recordId===p.recordId);if(this._outcome(after)!==false)fail('pending_update_unconfirmed');disabled=false;}this._finish(p,this._record(p),disabled);confirmed=true;result=this._receipt(p.recordId,operationId,disabled);return result;}
      if(!row.source)fail('pending_update_missing');
      if(!exists(p.root,this.io)){safe(p.config,{directory:true,io:this.io});this.io.mkdirSync(p.root,{mode:0o700});}safe(p.root,{directory:true,io:this.io});const history=names(p.root,MAX_HISTORY,this.io);if(history.length>=MAX_HISTORY)fail('pending_update_history_full');if(history.some(n=>!UUID.test(n)))fail('pending_update_recovery_required');
      operationId=randomUUID();const operationDir=path.join(p.root,operationId);this.io.mkdirSync(operationDir,{mode:0o700});const operationIdentity=nodeId(safe(operationDir,{directory:true,io:this.io}));
      const held=this._read(p.source,{keep:true});
      try{
        if(!equal(held.identity,row.source.identity)||held.sha256!==row.source.sha256)fail('pending_update_changed');
        const value={schema:'qq_pending_update_v1',operationId,recordId:p.recordId,bytes:held.bytes.length,sourceIdentity:held.identity,sourceSha256:held.sha256,configIdentity:row.parent,historyIdentity:nodeId(safe(p.root,{directory:true,io:this.io})),operationIdentity},bytes=Buffer.from(JSON.stringify(value)+'\n');
        const intent=path.join(operationDir,'intent.json'),intentProof=this._write(intent,bytes);check();gate.assertOwned();
        // Atomically expose already fsynced bytes; no incomplete pending JSON.
        const intentNow=this._read(intent,{max:16384});if(!equal(intentNow.identity,intentProof.identity)||intentNow.sha256!==intentProof.sha256)fail('pending_update_changed');
        journalStarted=true;this.io.linkSync(intent,p.pending);const published=this._record(p);
        await gate.assertStopped();check();await gate.verify(signal);check();await gate.assertStopped();check();gate.assertOwned();
        const final=this._observe(this._context()),target=final.find(r=>r.recordId===p.recordId);
        if(!target?.source||!equal(target.source,row.source)||!equal(target.parent,row.parent)||!target.record||target.record.destination||!equal(target.record.value,value)||!equal(target.record.pending.identity,published.pending.identity)||target.record.pending.sha256!==published.pending.sha256)fail('pending_update_changed');
        for(const other of checked.rows)if(other.recordId!==p.recordId&&!equal(other,final.find(r=>r.recordId===other.recordId)))fail('pending_update_changed');
        const record=this._record(p);if(!equal(identity(this.io.fstatSync(held.fd,{bigint:true})),held.identity))fail('pending_update_changed');check();gate.assertOwned();
        // Exclusive hard-link publication cannot overwrite a concurrent target.
        // Only this journal's exact two-name inode may temporarily have nlink=2.
        renameAttempted=true;this.io.linkSync(p.source,record.retained);
        const linked=this._observe(this._context()).find(r=>r.recordId===p.recordId);if(this._outcome(linked)!=='linked')fail('pending_update_unconfirmed');check();gate.assertOwned();
        this.io.unlinkSync(p.source);
        const after=this._observe(this._context()).find(r=>r.recordId===p.recordId);if(this._outcome(after)!==true)fail('pending_update_readback_failed');const retained=this._read(record.retained);if(retained.sha256!==held.sha256||retained.identity.dev!==held.identity.dev||retained.identity.ino!==held.identity.ino)fail('pending_update_readback_failed');
        confirmed=true;result=this._receipt(p.recordId,operationId,true);this._finish(p,this._record(p),true);return result;
      }finally{this._release(held.fd);}
    });return receipt?.lockRecoveryIssue?{...receipt,code:codeOf({code:receipt.lockRecoveryIssue})}:receipt;}catch(e){const code=codeOf(e);if(confirmed||e?.committed===true)return {...(result||this._receipt(ticket.recordId,operationId,true)),code};if(journalStarted||renameAttempted)return this._receipt(ticket.recordId,operationId,null,renameAttempted?'pending_update_unconfirmed':code);throw new QQPendingUpdateRecoveryError(code);}finally{this.busy=false;}
  }
}
module.exports={QQPendingUpdateRecovery,QQPendingUpdateRecoveryError,CODES,assertPendingUpdateRecoveryReady};
