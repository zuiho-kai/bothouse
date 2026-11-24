'use strict';
const path=require('node:path'),{randomUUID}=require('node:crypto');
const P=require('./qq-qce-export-policy.cjs');
const {captured}=require('./qq-qce-session.cjs');
const {QQQCEExportClient}=require('./qq-qce-export-client.cjs');
const base=v=>({accountId:v.accountId,panelId:v.panelId}),sameScope=(a,b)=>a?.accountId===b.accountId&&a?.panelId===b.panelId;
const same=(a,b)=>Object.keys(a).every(k=>a[k]===b[k]);
function knownReceipt(action,ticket,ack){return {kind:'qce-export-change',action,ticketId:ticket.id,operationId:ticket.operationId,...ack,observation:{state:'unavailable'},automaticRetry:false,cancelStopsAllWritesVerified:false};}
class QQQCEExportSession{
 constructor({capture,verifyContext,jobs,clientFactory=o=>new QQQCEExportClient(o),saveDownload,now=Date.now,monotonic=()=>performance.now()}={}){
  if([capture,verifyContext,clientFactory,now,monotonic].some(x=>typeof x!=='function')||!jobs||['begin','get','list','change','forget'].some(k=>typeof jobs[k]!=='function'))P.fail('invalid_request');
  Object.assign(this,{capture,verifyContext,jobs,clientFactory,saveDownload,now,monotonic});this.session=null;this.retiringSession=null;this.retiring=Promise.resolve({closed:true});this.closed=false;
 }
 get accountId(){return this.session?.accountId||null;}get panelId(){return this.session?.panelId||null;}
 _capture(input){if(this.closed)P.fail('closed');const value=this.capture(base(input));if(value?.then){value.catch?.(()=>{});P.fail('invalid_request');}return captured(value,input);}
 _assert(s){if(this.closed||this.session!==s||s.abort.signal.aborted||!same(s.binding,this._capture(s)))P.fail('changed');}
 _envelope(s){return {...base(s),qqAccountId:s.binding.qqAccountId};}
 _get(input){const s=this.session;if(!sameScope(s,input))P.fail('changed');this._assert(s);if(s.pending)P.fail('operation_in_progress');return s;}
 _record(s,id){const r=this.jobs.get(P.scope(s.binding),id);if(r?.then||!P.plain(r)||r.operationId!==id||r.requestDigest!==P.digest(r.request)||!P.plain(r.scope)||P.digest(r.scope)!==P.digest(P.scope(s.binding)))P.fail('qce_jobs_changed');return r;}
 async _verify(s,check){check();const value=await this.verifyContext(s.binding,{signal:s.opAbort.signal,assertCurrent:check});check();P.exact(value,['verified','endpoint'],'endpoint_unverified');const e=value.endpoint;P.exact(e,['host','port','token','endpointId','ownershipVerified'],'endpoint_unverified');if(value.verified!==true||e.host!=='127.0.0.1'||e.port!==40653||e.ownershipVerified!==true||!P.text(e.endpointId,256)||typeof e.token!=='string'||!/^[A-Za-z0-9]{40}$/.test(e.token))P.fail('endpoint_unverified');if(s.endpoint&&!same(s.endpoint,e))P.fail('changed');if(!s.endpoint)s.endpoint={...e};if(!s.client){s.client=this.clientFactory({host:e.host,port:e.port,token:e.token,version:s.binding.pluginVersion});if(!s.client||['system','config','targets','createTask','task','cancelTask','download','close'].some(k=>typeof s.client[k]!=='function'))P.fail('invalid_response');check();}}
 _options(s,check){return {signal:s.opAbort.signal,assertCurrent:check};}
 async _identity(s,check){check();P.identity(await s.client.system(this._options(s,check)),s.binding.qqAccountId,s.binding.pluginVersion);check();}
 async _task(s,record,check){if(!record.taskId)P.fail('task_unavailable');await this._verify(s,check);await this._identity(s,check);const raw=await s.client.task(record.taskId,this._options(s,check));check();const task=P.task(raw,record,s.binding.pluginVersion);await this._identity(s,check);return task;}
 _run(s,fn,{deadline=null}={}){
  if(s.pending)P.fail('operation_in_progress');const epoch=s.epoch,abort=new AbortController();s.opAbort=abort;const onAbort=()=>abort.abort();s.abort.signal.addEventListener('abort',onAbort,{once:true});
  const check=()=>{this._assert(s);if(s.epoch!==epoch||abort.signal.aborted)P.fail('cancelled');if(deadline!==null&&this.monotonic()>=deadline)P.fail('expired_ticket');};
  const operation=Promise.resolve().then(()=>{check();return fn(check,epoch);});s.pending=operation;
  return operation.finally(()=>{s.abort.signal.removeEventListener('abort',onAbort);if(s.pending===operation)s.pending=null;if(s.opAbort===abort)s.opAbort=null;});
 }
 _open(input,fn){
  const binding=this._capture(input);let s=this.session;if(s?.pending)P.fail('operation_in_progress');let retiring=Promise.resolve();
  if(!sameScope(s,input)||!same(s.binding,binding)){retiring=this._retire();s={...base(input),binding,abort:new AbortController(),opAbort:null,pending:null,client:null,endpoint:null,ticket:null,baseline:null,epoch:0,timer:null};this.session=s;s.timer=setInterval(()=>this.observe(),250);s.timer.unref?.();}
  return this._run(s,async check=>{await retiring;check();return fn(s,check);});
 }
 read(input){P.qceExportRequest(input);return this._open(input,async(s,check)=>{s.ticket=null;s.baseline=null;await this._verify(s,check);await this._identity(s,check);const config=P.config(await s.client.config(this._options(s,check)));check();P.directory(config.currentExportsDir);const page=P.targets(await s.client.targets(input.kind,input.page,this._options(s,check)),input.kind,input.page);check();await this._identity(s,check);const observationId=randomUUID(),rows=page.rows.map(t=>({...t,targetId:randomUUID()}));s.baseline={id:observationId,kind:input.kind,page:input.page,rows,config,deadline:this.monotonic()+P.LIMITS.ticketTtlMs};return {...this._envelope(s),profile:{kind:'qce-export-targets',observationId,fetchedAt:new Date(this.now()).toISOString(),version:s.binding.pluginVersion,targetKind:input.kind,page:input.page,pageSize:100,totalCount:page.totalCount,totalPages:page.totalPages,targets:rows.map(t=>({targetId:t.targetId,...P.publicTarget(t)})),scope:{kind:'shared-os-user',accountIsolated:false},limits:{...P.LIMITS}}};});}
 listJobs(input){P.qceExportRequest(input,'jobs');return this._open(input,async(s,check)=>{check();const records=this.jobs.list(P.scope(s.binding));if(!Array.isArray(records)||records.length>P.LIMITS.maxJobs)P.fail('qce_jobs_locked');return {...this._envelope(s),jobs:records.map(r=>P.publicJob(r,s.binding)),source:'local-encrypted-export-journal'};});}
 preview(input){
  P.qceExportRequest(input,'preview');const s=this._get(input);s.ticket=null;
  if(input.action==='create'){
   const b=s.baseline;if(!b||b.id!==input.observationId)P.fail('stale_observation');if(this.monotonic()>=b.deadline)P.fail('expired_ticket');const target=b.rows.find(t=>t.targetId===input.targetId);if(!target)P.fail('target_unavailable');P.range(input.range,this.now());P.options(input.options,input.format);
   const operationId=randomUUID(),outputDir=path.win32.join(b.config.currentExportsDir,'agent-arcade-exports',operationId);P.directory(outputDir);if(outputDir.includes('..')||outputDir.includes('%00'))P.fail('invalid_path');
   const ticket={id:randomUUID(),action:'create',operationId,target,bindingBaseline:b,request:P.createBody(target,input.format,input.range,input.options,outputDir),outputDir,deadline:this.monotonic()+P.LIMITS.ticketTtlMs};s.ticket=ticket;
   return {...this._envelope(s),preview:{kind:'qce-export-preview',action:'create',ticketId:ticket.id,operationId,expiresAt:this.now()+P.LIMITS.ticketTtlMs,target:P.publicTarget(target),format:input.format,range:P.copy(input.range),options:P.copy(input.options),output:{kind:'separate-operation-directory',directoryName:operationId},effects:P.effects('create')}};
  }
  return this._run(s,async check=>{const record=this._record(s,input.operationId),task=await this._task(s,record,check);check();const ticket={id:randomUUID(),action:'cancel',operationId:record.operationId,recordRevision:record.revision,taskId:record.taskId,deadline:this.monotonic()+P.LIMITS.ticketTtlMs};s.ticket=ticket;return {...this._envelope(s),preview:{kind:'qce-export-preview',action:'cancel',ticketId:ticket.id,operationId:ticket.operationId,expiresAt:this.now()+P.LIMITS.ticketTtlMs,task,effects:P.effects('cancel')}};});
 }
 confirm(input){
  P.qceExportRequest(input,'confirm');const s=this._get(input),ticket=s.ticket;if(!ticket||ticket.id!==input.ticketId)P.fail('stale_ticket');s.ticket=null;
  return this._run(s,async(check,epoch)=>{
   let record=null,invoked=false,attempted=false,responded=false,ack;
   try{
    check();await this._verify(s,check);await this._identity(s,check);
    if(ticket.action==='create'){
     const b=ticket.bindingBaseline,config=P.config(await s.client.config(this._options(s,check)));check();if(P.digest(config)!==P.digest(b.config))P.fail('baseline_changed');const page=P.targets(await s.client.targets(b.kind,b.page,this._options(s,check)),b.kind,b.page);check();const observed=page.rows.find(t=>P.digest(t)===P.digest({kind:ticket.target.kind,peer:ticket.target.peer,name:ticket.target.name,number:ticket.target.number}));if(!observed)P.fail('target_unavailable');
     await this._identity(s,check);await this._verify(s,check);check();record=this.jobs.begin(P.scope(s.binding),{operationId:ticket.operationId,request:ticket.request,outputDir:ticket.outputDir});check();
     invoked=true;const raw=await s.client.createTask(ticket.request,{...this._options(s,check),onAttempt:()=>{check();record=this.jobs.change(P.scope(s.binding),record.operationId,record.revision,'attempted');attempted=true;}});responded=true;
     const native=P.createAck(raw,ticket.request,s.binding.pluginVersion);record=this.jobs.change(P.scope(s.binding),record.operationId,record.revision,'acknowledged',native.taskId,native.fileName);
    }else{
     record=this._record(s,ticket.operationId);if(record.revision!==ticket.recordRevision||record.taskId!==ticket.taskId)P.fail('qce_jobs_changed');await this._task(s,record,check);await this._verify(s,check);check();invoked=true;const raw=await s.client.cancelTask(record.taskId,{...this._options(s,check),onAttempt:()=>{attempted=true;}});responded=true;P.cancelAck(raw,record.taskId,record,s.binding.pluginVersion);
    }
    ack={submission:'submitted',bridgeResponse:'received',outcome:'accepted',taskRecorded:record?.taskId!==null};
   }catch(error){
    const notSent=error?.submitted===false||!invoked&&!attempted;let code=P.safeCode(error);
    if(ticket.action==='create'&&record&&['prepared','attempted'].includes(record.submission))try{record=this.jobs.change(P.scope(s.binding),record.operationId,record.revision,notSent?'not_submitted':'unknown');}catch{code='qce_jobs_unknown';}
    ack={submission:notSent?'not_submitted':attempted||responded?'submitted':'unknown',bridgeResponse:responded||error?.bridgeResponse==='received'?'received':'unavailable',outcome:notSent?'not_submitted':'unknown',taskRecorded:!!record?.taskId,code:notSent?code:code==='qce_jobs_unknown'?code:'change_unknown'};
   }
   const change=knownReceipt(ticket.action,ticket,ack);
   if(record?.taskId)try{const observe=()=>{this._assert(s);if(s.epoch!==epoch||s.opAbort.signal.aborted)P.fail('cancelled');};const task=await this._task(s,record,observe);change.observation={state:'available',task};}catch{}
   return {...this._envelope(s),change};
  },{deadline:ticket.deadline});
 }
 observeTask(input){P.qceExportRequest(input,'observe');const s=this._get(input);return this._run(s,async check=>({...this._envelope(s),task:await this._task(s,this._record(s,input.operationId),check)}));}
 download(input){P.qceExportRequest(input,'download');const s=this._get(input);return this._run(s,async check=>{
  let download={operationId:input.operationId,cancelled:false,saved:false,bytes:null,sha256:null,archiveVerified:false,cleanupVerified:true};
  try{const r=this._record(s,input.operationId),task=await this._task(s,r,check);if(!task.downloadAvailable)P.fail('task_not_completed');if(typeof this.saveDownload!=='function')P.fail('download_unavailable');const filePath=path.win32.join(r.outputDir,task.fileName);P.directory(r.outputDir);P.fileName(task.fileName);let called=false;
   const raw=await this.saveDownload({capture:s.binding,signal:s.opAbort.signal,assertCurrent:check,suggestedName:task.fileName,archive:task.zipProduced},async sink=>{if(called)P.fail('invalid_request');called=true;check();await this._verify(s,check);const fresh=await this._task(s,r,check);if(fresh.status!=='completed'||fresh.fileName!==task.fileName||fresh.completedAt!==task.completedAt||fresh.messageCount!==task.messageCount)P.fail('task_binding_changed');check();return s.client.download(filePath,{...this._options(s,check),sink,archive:task.zipProduced});});
   if(raw?.cancelled===true&&!called)download.cancelled=true;
   else if(raw?.saved===true&&called&&P.integer(raw.bytes,P.LIMITS.maxDownloadBytes)&&/^[a-f0-9]{64}$/.test(raw.sha256)&&raw.archiveVerified===task.zipProduced&&raw.cleanupVerified===true)download={...download,saved:true,bytes:raw.bytes,sha256:raw.sha256,archiveVerified:raw.archiveVerified};
   else{download.saved=called?null:false;download.cleanupVerified=false;download.code='file_download_unknown';}
  }catch(e){download={...download,cancelled:e?.code==='cancelled',saved:e?.saved===null?null:e?.saved===true?true:false,bytes:P.integer(e?.bytes,P.LIMITS.maxDownloadBytes)?e.bytes:null,sha256:/^[a-f0-9]{64}$/.test(e?.sha256)?e.sha256:null,cleanupVerified:e?.code!=='file_cleanup_unconfirmed',code:P.safeCode(e)};if(e?.retainedCopy?.location==='chosen-download-folder')try{P.fileName(e.retainedCopy.name);download.retainedCopy={name:e.retainedCopy.name,location:'chosen-download-folder'};}catch{}}
  return {...this._envelope(s),download};
 });}
 forgetJob(input){P.qceExportRequest(input,'forget');const s=this._get(input);this.jobs.forget(P.scope(s.binding),input.operationId,input.revision);if(s.ticket?.operationId===input.operationId)s.ticket=null;return {...this._envelope(s),forgotten:true,operationId:input.operationId};}
 async dismiss(input){P.qceExportRequest(input,'dismiss');const s=this.session;if(sameScope(s,input)){s.ticket=null;++s.epoch;s.opAbort?.abort();const pending=s.pending;await pending?.catch(()=>{});}return {...base(input),dismissed:true};}
 _retire(){const s=this.session;this.session=null;if(!s)return this.retiring;clearInterval(s.timer);s.ticket=null;s.baseline=null;++s.epoch;s.abort.abort();s.client?.close();this.retiringSession=s;const old=this.retiring;this.retiring=(async()=>{await old;await s.pending?.catch(()=>{});if(this.retiringSession===s)this.retiringSession=null;return {closed:true};})();return this.retiring;}
 closeOwned(input){P.qceExportRequest(input,'close');if(!sameScope(this.session,input))return (sameScope(this.retiringSession,input)?this.retiring:Promise.resolve()).then(()=>({...base(input),closed:true}));return this._retire().then(()=>({...base(input),closed:true}));}
 closeCurrent(){return this._retire();}observe(){if(this.session)try{this._assert(this.session);}catch{void this._retire();}}close(){this.closed=true;return this._retire();}
}
async function qceExportResult(input,operation){try{return {ok:true,...await operation()};}catch(e){return {ok:false,...(P.profileId(input?.accountId)?{accountId:input.accountId}:{}),...(P.uuid(input?.panelId)?{panelId:input.panelId}:{}),code:P.safeCode(e)};}}
module.exports={QQQCEExportSession,qceExportRequest:P.qceExportRequest,qceExportResult};
