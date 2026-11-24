'use strict';
const {randomUUID}=require('node:crypto');
const P=require('./qq-qce-schedule-policy.cjs');
const {captured}=require('./qq-qce-session.cjs');
const {QQQCEExportClient}=require('./qq-qce-export-client.cjs');
const {QCEScheduleConnection}=require('./qq-qce-schedule-runner.cjs');
const base=v=>({accountId:v.accountId,panelId:v.panelId}),samePanel=(a,b)=>a?.accountId===b.accountId&&a?.panelId===b.panelId;
const LOCAL=['accountId','panelId','qqAccountId','workScope','credentialRevision','contextKey','profile','runtime','installation'];
const same=(a,b)=>Object.keys(a).every(k=>a[k]===b[k]);
class QQQCEScheduleSession{
 constructor({captureLocal,captureNetwork,verifyContext,store,runner,clientFactory=o=>new QQQCEExportClient(o),now=Date.now,monotonic=()=>performance.now()}={}){
  if([captureLocal,captureNetwork,verifyContext,clientFactory,now,monotonic].some(f=>typeof f!=='function')||!store||!runner)P.fail('invalid_request');Object.assign(this,{captureLocal,captureNetwork,verifyContext,store,runner,clientFactory,now,monotonic});this.session=null;this.retiring=Promise.resolve({closed:true});this.retiringSession=null;this.closed=false;
 }
 get accountId(){return this.session?.accountId||null;}get panelId(){return this.session?.panelId||null;}
 _capture(input){if(this.closed)P.fail('closed');const v=this.captureLocal(base(input));P.localScope(v);if(v?.then||!samePanel(v,input)||v.credentialRevision!==null&&!P.uuid(v.credentialRevision)||!P.text(v.contextKey,256)||!v.profile||!v.runtime||!v.installation)P.fail('changed');return Object.fromEntries(LOCAL.map(k=>[k,v[k]]));}
 _assert(s){if(this.closed||this.session!==s||s.abort.signal.aborted||!same(s.binding,this._capture(s)))P.fail('changed');}
 _get(input){const s=this.session;if(!samePanel(s,input))P.fail('changed');this._assert(s);if(s.pending)P.fail('operation_in_progress');return s;}
 _envelope(s){return {...base(s),qqAccountId:s.binding.qqAccountId};}
 _record(s,id,revision,full=false){const p=this.store.get(P.localScope(s.binding),id);if(revision!==undefined&&p.revision!==revision||full&&!P.sameScope(p.scope,s.binding,true))P.fail('qce_schedules_changed');return p;}
 _run(s,fn,deadline=null){
  if(s.pending)P.fail('operation_in_progress');const epoch=s.epoch,abort=new AbortController(),cancel=()=>abort.abort();s.opAbort=abort;s.abort.signal.addEventListener('abort',cancel,{once:true});
  const check=()=>{this._assert(s);if(s.epoch!==epoch||abort.signal.aborted)P.fail('cancelled');if(deadline!==null&&this.monotonic()>=deadline)P.fail('expired_ticket');};
  const promise=Promise.resolve().then(()=>{check();return fn(check);});s.pending=promise;return promise.finally(()=>{s.abort.signal.removeEventListener('abort',cancel);if(s.pending===promise)s.pending=null;if(s.opAbort===abort)s.opAbort=null;});
 }
 _open(input,fn){const binding=this._capture(input);let s=this.session;if(s?.pending)P.fail('operation_in_progress');let retiring=Promise.resolve();if(!samePanel(s,input)||!same(s.binding,binding)){retiring=this._retire();s={...base(input),binding,abort:new AbortController(),pending:null,opAbort:null,epoch:0,ticket:null,baseline:null,connections:new Set()};this.session=s;}return this._run(s,async check=>{await retiring;check();return fn(s,check);});}
 async _network(s,check,fn){
  check();const binding=captured(this.captureNetwork(base(s)),s);if(!P.sameScope(binding,s.binding,true))P.fail('credential_changed');const connection=new QCEScheduleConnection({binding,capture:this.captureNetwork,verifyContext:this.verifyContext,clientFactory:this.clientFactory,signal:s.opAbort.signal,assertCurrent:check});s.connections.add(connection);
  try{return await fn(connection,binding);}finally{connection.close();s.connections.delete(connection);}
 }
 list(input){P.qceScheduleRequest(input,'list');return this._open(input,async(s,check)=>{check();return {...this._envelope(s),plans:this.store.list(P.localScope(s.binding)).map(p=>P.publicPlan(p,s.binding)),credentialAvailable:s.binding.credentialRevision!==null,source:'local-encrypted-schedule-store',limits:{...P.LIMITS}};});}
 read(input){P.qceScheduleRequest(input,'read');return this._open(input,async(s,check)=>{s.ticket=null;s.baseline=null;return this._network(s,check,async connection=>{const {config,targets}=await connection.read(input.kind,input.page);check();const rows=targets.rows.map(t=>({...t,targetId:randomUUID()})),id=randomUUID();s.baseline={id,kind:input.kind,page:input.page,config,rows,deadline:this.monotonic()+P.LIMITS.ticketTtlMs};return {...this._envelope(s),profile:{kind:'qce-schedule-targets',observationId:id,fetchedAt:new Date(this.now()).toISOString(),version:'5.5.77',targetKind:input.kind,page:input.page,pageSize:100,totalCount:targets.totalCount,totalPages:targets.totalPages,targets:rows.map(t=>({targetId:t.targetId,...P.publicTarget(t)})),scope:{kind:'shared-os-user',accountIsolated:false},limits:{...P.LIMITS}}};});});}
 preview(input){
  P.qceScheduleRequest(input,'preview');const s=this._get(input);s.ticket=null;const {action}=input;
  return this._run(s,async check=>{
   const plan=action==='create'?null:this._record(s,input.scheduleId,input.revision,!['disable','remove'].includes(action));let definition=plan?.definition,after=null,scheduledAt=null,nextAt=null;
   if(['create','edit'].includes(action)){
    const b=s.baseline;if(!b||b.id!==input.observationId)P.fail('stale_observation');if(this.monotonic()>=b.deadline)P.fail('expired_ticket');const row=b.rows.find(t=>t.targetId===input.targetId);if(!row)P.fail('target_unavailable');const {targetId,...target}=row;definition=P.validateDefinition({...P.settings(input),target,targetPage:b.page,configBaseline:b.config});after={...P.summary(definition),enabled:false,nextAt:null};
   }else if(['enable','run'].includes(action)){
    await this._network(s,check,c=>c.validate(definition));check();this._record(s,plan.scheduleId,plan.revision,true);
    if(action==='enable'){nextAt=P.next(definition,Math.max(this.now(),plan.lastScheduledAt||0)).at;after={enabled:true,nextAt};}
    else{scheduledAt=this.now();after={scheduledAt,range:P.windowFor(definition,scheduledAt),format:definition.format,options:P.copy(definition.options),target:P.publicTarget(definition.target)};}
   }else if(action==='disable')after={enabled:false,nextAt:null};
   check();const ticket={id:randomUUID(),action,plan,definition,scheduledAt,nextAt,deadline:this.monotonic()+P.LIMITS.ticketTtlMs};s.ticket=ticket;
   return {...this._envelope(s),preview:{kind:'qce-schedule-preview',action,ticketId:ticket.id,expiresAt:this.now()+P.LIMITS.ticketTtlMs,scheduleId:plan?.scheduleId||null,before:plan?P.publicPlan(plan,s.binding):null,after,effects:P.effects(action,definition)}};
  });
 }
 confirm(input){
  P.qceScheduleRequest(input,'confirm');const s=this._get(input),t=s.ticket;if(!t||t.id!==input.ticketId)P.fail('stale_ticket');s.ticket=null;
  return this._run(s,async check=>{
   let plan=null,run=null,outcome='saved',code=null;const {action}=t;
   if(t.plan)this._record(s,t.plan.scheduleId,t.plan.revision,!['disable','remove'].includes(action));
   if(['create','edit','enable'].includes(action))await this._network(s,check,c=>c.validate(t.definition));check();
   if(t.plan)this._record(s,t.plan.scheduleId,t.plan.revision,!['disable','remove'].includes(action));
   if(action==='create')plan=this.store.create(P.fullScope(s.binding),t.definition);
   else if(action==='edit')plan=this.store.update(P.fullScope(s.binding),t.plan.scheduleId,t.plan.revision,t.definition);
   else if(action==='enable'){if(t.nextAt<=this.now())P.fail('stale_ticket');plan=this.store.setEnabled(P.fullScope(s.binding),t.plan.scheduleId,t.plan.revision,true,t.nextAt);}
   else if(action==='disable')plan=this.store.setEnabled(P.localScope(s.binding),t.plan.scheduleId,t.plan.revision,false,null);
   else if(action==='remove'){this.store.remove(P.localScope(s.binding),t.plan.scheduleId,t.plan.revision);outcome='removed';}
   else{run=await this.runner.runOnce(P.fullScope(s.binding),t.plan.scheduleId,t.plan.revision,{signal:s.opAbort.signal,assertCurrent:check,scheduledAt:t.scheduledAt});outcome=run.outcome;code=run.code;try{plan=this.store.get(P.localScope(s.binding),t.plan.scheduleId);}catch{}}
   return {...this._envelope(s),change:{kind:'qce-schedule-change',action,ticketId:t.id,scheduleId:plan?.scheduleId||t.plan?.scheduleId||null,outcome,plan:plan?P.publicPlan(plan,s.binding):null,run:run?this._publicRun(run,s):null,code,automaticRetry:false}};
  },t.deadline);
 }
 _publicRun(r,s){return {...P.publicRun(r,s.binding),canForget:!this.runner.isRunActive(r.runId)};}
 runs(input){P.qceScheduleRequest(input,'runs');return this._open(input,async(s,check)=>{check();return {...this._envelope(s),runs:this.store.runs(P.localScope(s.binding),input.scheduleId||undefined).map(r=>this._publicRun(r,s)),source:'local-encrypted-schedule-store'};});}
 forgetRun(input){P.qceScheduleRequest(input,'forgetRun');const s=this._get(input),scope=P.localScope(s.binding);if(this.runner.isRunActive(input.runId))P.fail('operation_in_progress');const r=this.store.runs(scope).find(r=>r.runId===input.runId);if(!r||r.revision!==input.revision)P.fail('qce_schedules_changed');const record=r.outcome==='claimed'?this.store.settleInterrupted(scope,r.runId,r.revision):r;this.store.forgetRun(scope,record.runId,record.revision);return {...this._envelope(s),forgotten:true,runId:input.runId};}
 async dismiss(input){P.qceScheduleRequest(input,'dismiss');const s=this.session;if(samePanel(s,input)){s.ticket=null;++s.epoch;s.opAbort?.abort();await s.pending?.catch(()=>{});}return {...base(input),dismissed:true};}
 _retire(){const s=this.session;this.session=null;if(!s)return this.retiring;s.ticket=null;s.baseline=null;++s.epoch;s.abort.abort();for(const c of s.connections)c.close();this.retiringSession=s;const before=this.retiring;this.retiring=(async()=>{await before;await s.pending?.catch(()=>{});if(this.retiringSession===s)this.retiringSession=null;return {closed:true};})();return this.retiring;}
 closeOwned(input){P.qceScheduleRequest(input,'close');if(!samePanel(this.session,input))return (samePanel(this.retiringSession,input)?this.retiring:Promise.resolve()).then(()=>({...base(input),closed:true}));return this._retire().then(()=>({...base(input),closed:true}));}
 closeCurrent(){return this._retire();}observe(){if(this.session)try{this._assert(this.session);}catch{void this._retire();}}close(){this.closed=true;return this._retire();}
}
async function qceScheduleResult(input,operation){try{return {ok:true,...await operation()};}catch(e){return {ok:false,...(P.profileId(input?.accountId)?{accountId:input.accountId}:{}),...(P.uuid(input?.panelId)?{panelId:input.panelId}:{}),code:P.safeCode(e)};}}
module.exports={QQQCEScheduleSession,qceScheduleRequest:P.qceScheduleRequest,qceScheduleResult};
