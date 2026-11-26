'use strict';
const path=require('node:path'),{randomUUID}=require('node:crypto');
const P=require('./qq-qce-schedule-policy.cjs');
const {captured}=require('./qq-qce-session.cjs');
const {QQQCEExportClient}=require('./qq-qce-export-client.cjs');
const same=(a,b)=>Object.keys(a).every(k=>a[k]===b[k]);
// A narrowly shared owned QCE connection for foreground observation and one run.
class QCEScheduleConnection{
 constructor({binding,capture,verifyContext,clientFactory,signal,assertCurrent}){Object.assign(this,{binding,capture,verifyContext,clientFactory,signal,assertCurrent,endpoint:null,client:null});}
 check=()=>{this.assertCurrent();if(this.signal.aborted)P.fail('cancelled');const b=captured(this.capture({accountId:this.binding.accountId,panelId:this.binding.panelId}),this.binding);if(!same(this.binding,b))P.fail('changed');};
 options(){return {signal:this.signal,assertCurrent:this.check};}
 async verify(){
  this.check();if(this.binding.pluginVersion!=='5.5.77')P.fail('qce_version_unsupported');const result=await this.verifyContext(this.binding,this.options());this.check();P.exact(result,['verified','endpoint'],'endpoint_unverified');const e=result.endpoint;P.exact(e,['host','port','token','endpointId','ownershipVerified'],'endpoint_unverified');
  if(result.verified!==true||e.host!=='127.0.0.1'||e.port!==40653||e.ownershipVerified!==true||!P.text(e.endpointId,256)||typeof e.token!=='string'||!/^[A-Za-z0-9]{40}$/.test(e.token))P.fail('endpoint_unverified');if(this.endpoint&&!same(this.endpoint,e))P.fail('changed');this.endpoint={...e};
  if(!this.client){this.client=this.clientFactory({host:e.host,port:e.port,token:e.token});if(!this.client||['system','config','targets','createTask','close'].some(k=>typeof this.client[k]!=='function'))P.fail('invalid_response');this.check();}
 }
 async identity(){this.check();P.identity(await this.client.system(this.options()),this.binding.qqAccountId);this.check();}
 async read(kind,page){await this.verify();await this.identity();const config=P.config(await this.client.config(this.options()));this.check();for(const value of Object.values(config))P.directory(value);const targets=P.targets(await this.client.targets(kind,page,this.options()),kind,page);this.check();await this.identity();return {config,targets};}
 async validate(definition){const v=await this.read(definition.target.kind==='friend'?'friends':'groups',definition.targetPage);if(P.digest(v.config)!==P.digest(definition.configBaseline))P.fail('baseline_changed');if(!v.targets.rows.some(t=>P.digest(t)===P.digest(definition.target)))P.fail('target_unavailable');await this.verify();await this.identity();this.check();}
 close(){this.client?.close();}
}
class QQQCEScheduleRunner{
 constructor({store,jobs,capture,verifyContext,clientFactory=o=>new QQQCEExportClient(o),now=Date.now}={}){
  if(!store||!jobs||[capture,verifyContext,clientFactory,now].some(f=>typeof f!=='function'))P.fail('invalid_request');Object.assign(this,{store,jobs,capture,verifyContext,clientFactory,now});this.startedAt=now();this.initialized=false;this.pending=null;this.active=null;this.closed=false;
 }
 _single(fn){if(this.closed)P.fail('closed');if(this.pending)P.fail('operation_in_progress');const promise=Promise.resolve().then(()=>{if(this.closed)P.fail('closed');return fn();});this.pending=promise;return promise.finally(()=>{if(this.pending===promise)this.pending=null;});}
 tick(){if(this.pending)return Promise.resolve({busy:true});return this._single(async()=>{
  const at=this.now(),plans=this.store.allEnabled();if(!this.initialized){this.initialized=true;for(const p of plans)if(p.nextAt<=this.startedAt)this._advance(p,Math.max(at,this.startedAt));return {initialized:true};}
  for(const p of plans.sort((a,b)=>a.nextAt-b.nextAt)){
   if(p.nextAt>at)continue;if(p.nextAt<=this.startedAt||at-p.nextAt>P.LIMITS.lateWindowMs){this._advance(p,at);continue;}
   const occurrence=P.next(p.definition,p.nextAt-1);if(occurrence.at!==p.nextAt){this._advance(p,at);continue;}
   const nextAt=P.nextOccurrence(p.definition.recurrence,p.nextAt)?.at??null;return {run:await this._execute(p,{kind:'scheduled',scheduledAt:p.nextAt,slotKey:occurrence.slotKey,nextAt})};
  }return {idle:true};
 });}
 _advance(plan,at){const nextAt=P.nextOccurrence(plan.definition.recurrence,Math.max(at,plan.lastScheduledAt||0))?.at??null;this.store.advance(plan.scope,plan.scheduleId,plan.revision,{nextAt,scheduledAt:Math.max(plan.nextAt,at)});}
 isRunActive(runId){return this.active?.runId===runId;}
 runOnce(scope,id,revision,{signal,assertCurrent=()=>{},scheduledAt=this.now()}={}){return this._single(async()=>{assertCurrent();if(signal?.aborted)P.fail('cancelled');const plan=this.store.get(scope,id);if(plan.revision!==revision||!P.sameScope(plan.scope,scope,true))P.fail('qce_schedules_changed');P.windowFor(plan.definition,scheduledAt);return this._execute(plan,{kind:'manual',scheduledAt,nextAt:null},{signal,assertCurrent});});}
 async _execute(original,slot,{signal,assertCurrent=()=>{}}={}){
  const operationId=randomUUID(),claim=this.store.claim(original.scope,original.scheduleId,original.revision,{...slot,slotKey:slot.slotKey||P.digest(operationId),operationId});const plan=claim.plan,run=claim.run,abort=new AbortController();const cancel=()=>abort.abort();signal?.addEventListener('abort',cancel,{once:true});if(signal?.aborted)abort.abort();
  let connection=null,record=null,invoked=false,attempted=false,responded=false,outcome='not_submitted',code=null;this.active={abort,runId:run.runId};
  const check=()=>{if(this.closed||abort.signal.aborted)P.fail('cancelled');assertCurrent();const current=this.store.get(plan.scope,plan.scheduleId);if(current.revision!==plan.revision||slot.kind==='scheduled'&&slot.nextAt!==null&&!current.enabled)P.fail('qce_schedules_changed');};
  try{
   check();const requestBase={accountId:plan.scope.accountId,panelId:run.runId},binding=captured(this.capture(requestBase),requestBase);if(!P.sameScope(binding,plan.scope,true))P.fail('credential_changed');
   connection=new QCEScheduleConnection({binding,capture:this.capture,verifyContext:this.verifyContext,clientFactory:this.clientFactory,signal:abort.signal,assertCurrent:check});await connection.validate(plan.definition);check();
   const outputDir=path.win32.join(plan.definition.configBaseline.currentExportsDir,'agent-arcade-exports',operationId);P.directory(outputDir);const request=P.createBody(plan.definition.target,plan.definition.format,P.windowFor(plan.definition,slot.scheduledAt),plan.definition.options,outputDir);
   record=this.jobs.begin(plan.scope,{operationId,request,outputDir});connection.check();invoked=true;
   const raw=await connection.client.createTask(request,{...connection.options(),onAttempt:()=>{connection.check();record=this.jobs.change(plan.scope,operationId,record.revision,'attempted');attempted=true;}});responded=true;
   const ack=P.createAck(raw,request);record=this.jobs.change(plan.scope,operationId,record.revision,'acknowledged',ack.taskId,ack.fileName);outcome='accepted';
  }catch(e){
   const notSent=e?.submitted===false||!invoked&&!attempted;outcome=notSent?'not_submitted':'unknown';code=notSent?P.safeCode(e):'change_unknown';
   if(record&&['prepared','attempted'].includes(record.submission))try{record=this.jobs.change(plan.scope,operationId,record.revision,notSent?'not_submitted':'unknown');}catch{code='qce_jobs_unknown';}
  }finally{connection?.close();signal?.removeEventListener('abort',cancel);this.active=null;}
  // A late close/scope change must not erase a validated create acknowledgment.
  try{return this.store.done(plan.scope,run.runId,run.revision,{outcome,code});}catch{return {...run,outcome:'unknown',code:'qce_schedules_unknown'};}
 }
 async close(){this.closed=true;this.active?.abort.abort();await this.pending?.catch(()=>{});return {closed:true};}
}
module.exports={QQQCEScheduleRunner,QCEScheduleConnection};
