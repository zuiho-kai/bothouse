'use strict';
const {randomUUID}=require('node:crypto');
const {QQQCESession}=require('./qq-qce-session.cjs');
const {QQQCENativePlansClient}=require('./qq-qce-native-plans-client.cjs');
const P=require('./qq-qce-native-plans-policy.cjs'),E=require('./qq-qce-export-policy.cjs');
const {qceNativePlansRequest}=P;
const base=v=>({accountId:v.accountId,panelId:v.panelId}),sameScope=(a,b)=>a?.accountId===b.accountId&&a?.panelId===b.panelId;
const details=()=>({scope:{...P.SCOPE},effects:{...P.EFFECTS},timing:{...P.TIMING},limits:{...P.LIMITS}});
const unavailable=()=>({state:'unavailable',source:'qce-native-memory'});
function equivalent(a,b){const value=r=>{r=P.copy(r);for(const k of ['createdAt','updatedAt','lastRun','nextRun'])delete r[k];return P.digest(r);};return value(a)===value(b);}
function checkedReceipt(r){if(!P.plain(r)||!['not_submitted','submitted','unknown'].includes(r.submission)||!['received','unavailable'].includes(r.bridgeResponse)||!['accepted','unknown','not_submitted'].includes(r.outcome)||r.outcome==='accepted'&&(r.submission!=='submitted'||r.bridgeResponse!=='received')||r.outcome==='not_submitted'&&(r.submission!=='not_submitted'||r.bridgeResponse!=='unavailable')||r.outcome==='unknown'&&r.submission==='not_submitted')P.fail('invalid_response');return r;}
class QQQCENativePlansSession extends QQQCESession{
 constructor(options={}){super({...options,clientFactory:options.clientFactory||((v)=>new QQQCENativePlansClient(v))});}
 get panelId(){return this.session?.panelId||null;}
 _retire(){const s=this.session;if(s){s.list=null;s.detail=null;s.targets=null;}return super._retire();}
 _check(s,epoch){this._assert(s);if(s.epoch!==epoch)P.fail('cancelled');}
 _saved(s,id,planId=null){const saved=s.detail?.id===id?s.detail:s.list?.id===id?s.list:null;if(!saved)P.fail('stale_observation');if(this.monotonic()>=saved.deadline)P.fail('expired_ticket');const raw=planId===null?null:saved.records.get(planId);if(planId!==null&&!raw)P.fail('native_plan_unavailable');return {saved,raw};}
 async _job(s,fn){const operation=fn();s.pending=operation;try{return await operation;}finally{if(s.pending===operation)s.pending=null;}}
 async _network(s,check,fn){check();await this._verify(s,check);check();const o={signal:s.abort.signal,assertCurrent:check};P.identity(await s.client.system(o),s.binding.qqAccountId,s.binding.pluginVersion);check();const result=await fn(o);check();P.identity(await s.client.system(o),s.binding.qqAccountId,s.binding.pluginVersion);check();return result;}
 async read(input){
  qceNativePlansRequest(input);const binding=this._capture(input);let s=this.session;if(s?.pending)P.fail('operation_in_progress');const fresh=!sameScope(s,input)||Object.keys(binding).some(k=>binding[k]!==s.binding[k]);let retiring=Promise.resolve();
  if(fresh){retiring=this._retire();s={...base(input),binding,abort:new AbortController(),endpoint:null,client:null,pending:null,baseline:null,ticket:null,list:null,detail:null,targets:null,epoch:0,timer:null};this.session=s;}
  s.ticket=null;s.list=null;s.detail=null;s.targets=null;const epoch=++s.epoch,check=()=>this._check(s,epoch);
  return this._job(s,async()=>{try{if(fresh){await retiring;check();const e=await this._verify(s,check);check();s.client=this.clientFactory({host:e.host,port:e.port,token:e.token,version:s.binding.pluginVersion});if(!s.client||['system','config','list','plan','targets','history','mutate','close'].some(k=>typeof s.client[k]!=='function'))P.fail('invalid_response');check();s.timer=setInterval(()=>this.observe(),250);s.timer.unref?.();}
   const {config,rows}=await this._network(s,check,async o=>({config:await s.client.config(o),rows:await s.client.list(o)}));check();const records=new Map(rows.map(r=>[randomUUID(),r])),id=randomUUID();s.list={id,config,records,deadline:this.monotonic()+P.LIMITS.ticketTtlMs};
   return {...this._envelope(s),profile:{kind:'qce-native-plans',observationId:id,fetchedAt:new Date(this.now()).toISOString(),version:s.binding.pluginVersion,source:'qce-native-memory',plans:[...records].map(([id,r])=>P.summary(r,id,config,s.binding.pluginVersion)),...details()}};
  }catch(e){if(this.session===s)void this._retire();throw new P.QCENativePlansError(P.safeCode(e));}});
 }
 async inspect(input){
  qceNativePlansRequest(input,'inspect');const s=this._get(input),{raw}=this._saved(s,input.observationId,input.planId);s.ticket=null;const epoch=++s.epoch,check=()=>this._check(s,epoch);
  return this._job(s,async()=>{const {config,current}=await this._network(s,check,async o=>({config:await s.client.config(o),current:await s.client.plan(raw.id,o)}));if(current.id!==raw.id)P.fail('invalid_response');const id=randomUUID();s.detail={id,config,records:new Map([[input.planId,current]]),deadline:this.monotonic()+P.LIMITS.ticketTtlMs};let definition=null;try{definition=P.definition(current,config,null,s.binding.pluginVersion);}catch{}const supported=definition!==null;
   return {...this._envelope(s),detail:{kind:'qce-native-plan-detail',observationId:id,plan:P.summary(current,input.planId,config,s.binding.pluginVersion),definition,reported:Object.fromEntries(['createdAt','updatedAt','lastRun','nextRun'].map(k=>[k,P.iso(current[k])?current[k]:null])),capabilities:{canUpdate:supported,canEnable:supported&&!current.enabled,canDisable:current.enabled,canRemove:true,canRun:supported,canHistory:true},...details()}};
  });
 }
 async targets(input){
  qceNativePlansRequest(input,'targets');const s=this._get(input);s.ticket=null;const epoch=++s.epoch,check=()=>this._check(s,epoch);
  return this._job(s,async()=>{const v=await this._network(s,check,o=>s.client.targets(input.kind,input.page,o)),parsed=E.targets(v,input.kind==='friend'?'friends':'groups',input.page),id=randomUUID(),rows=new Map(parsed.rows.map(r=>[randomUUID(),r]));s.targets={id,kind:input.kind,page:input.page,rows,deadline:this.monotonic()+P.LIMITS.ticketTtlMs};
   return {...this._envelope(s),targets:{kind:'qce-native-targets',observationId:id,requestedKind:input.kind,page:input.page,hasMore:input.page<parsed.totalPages,items:[...rows].map(([targetId,t])=>({targetId,...E.publicTarget(t)})),fetchedAt:new Date(this.now()).toISOString()}};
  });
 }
 _target(s,draft){if(draft.target===null)return null;const saved=s.targets;if(!saved||saved.id!==draft.target.observationId||this.monotonic()>=saved.deadline)P.fail('stale_observation');const row=saved.rows.get(draft.target.targetId);if(!row)P.fail('target_unavailable');return {row:P.copy(row),kind:saved.kind,page:saved.page};}
 preview(input){
  qceNativePlansRequest(input,'preview');const s=this._get(input),{saved,raw}=this._saved(s,input.observationId,input.planId),action=input.action;let body=null,target=null,before=null,after=null,output=null;
  if(raw)try{before=P.definition(raw,saved.config,null,s.binding.pluginVersion);}catch{}
  if(['create','update'].includes(action)){if(action==='update'&&!before)P.fail('native_plan_unsupported');target=this._target(s,input.draft);body=P.bodyFromDraft(input.draft,raw,target?.row,s.binding.pluginVersion);after=P.projectedAfter(body,raw,saved.config,target?.row,s.binding.pluginVersion);output={mode:input.draft.output.mode,path:input.draft.output.mode==='custom'?input.draft.output.path:null,effectivePath:after.output.effectivePath};}
  else if(action==='enable'||action==='disable'){if(action==='enable'&&!before)P.fail('native_plan_unsupported');const enabled=action==='enable';if(raw.enabled===enabled)P.fail('no_changes');body={enabled};after=before;}
  else if(action==='run'){if(!before)P.fail('native_plan_unsupported');body={};after=before;}
  else if(action==='triggerAll')body={...input.draft};
  if(action==='triggerAll'&&saved!==s.list)P.fail('stale_observation');
  const triggerAll=action==='triggerAll'?{selection:'all-eligible-at-server-receipt',includeDisabled:input.draft.includeDisabled,observedCount:[...saved.records.values()].filter(r=>input.draft.includeDisabled||r.enabled).length}:null;
  const ticketId=randomUUID(),effects=P.effects(action);s.ticket={id:ticketId,action,planId:input.planId,raw,config:saved.config,body,target,after,effects,deadline:this.monotonic()+P.LIMITS.ticketTtlMs};++s.epoch;
  return {...this._envelope(s),preview:{kind:'qce-native-plan-preview',ticketId,observationId:saved.id,action,plan:raw?P.summary(raw,input.planId,saved.config,s.binding.pluginVersion):null,before,after,enabledBefore:raw?.enabled??null,enabledAfter:action==='remove'?null:['create','update','disable'].includes(action)?false:action==='enable'?true:raw?.enabled??null,triggerAll,output,expiresAt:this.now()+P.LIMITS.ticketTtlMs,scope:{...P.SCOPE},effects,timing:{...P.TIMING}}};
 }
 async confirm(input){
  qceNativePlansRequest(input,'confirm');const s=this._get(input),t=s.ticket;if(!t||t.id!==input.ticketId)P.fail('stale_ticket');s.ticket=null;const epoch=s.epoch;let invoked=false,attempted=false;const check=()=>{this._check(s,epoch);if(this.monotonic()>=t.deadline)P.fail('expired_ticket');};
  return this._job(s,async()=>{
   let ack;try{
    await this._network(s,check,async o=>{const config=await s.client.config(o);check();if(P.digest(config)!==P.digest(t.config))P.fail('baseline_changed');if(t.raw){const current=await s.client.plan(t.raw.id,o);check();if(P.fingerprint(current)!==P.fingerprint(t.raw))P.fail('baseline_changed');}else await s.client.list(o);
     if(t.target){const parsed=E.targets(await s.client.targets(t.target.kind,t.target.page,o),t.target.kind==='friend'?'friends':'groups',t.target.page);if(!parsed.rows.some(r=>P.digest(r)===P.digest(t.target.row)))P.fail('target_unavailable');}
    });check();await this._verify(s,check);check();invoked=true;ack=checkedReceipt(await s.client.mutate({action:t.action,nativePlanId:t.raw?.id??null,body:t.body},{signal:s.abort.signal,assertCurrent:check,onAttempt:()=>{attempted=true;}}));
   }catch(e){const noSend=e?.submitted===false||!invoked&&!attempted;ack=noSend?{submission:'not_submitted',bridgeResponse:'unavailable',outcome:'not_submitted',code:P.safeCode(e)}:{submission:attempted?'submitted':'unknown',bridgeResponse:e?.bridgeResponse==='received'?'received':'unavailable',outcome:'unknown',code:'change_unknown'};}
   let observation=unavailable(),planId=t.planId;if(t.action==='create')planId=ack.outcome==='accepted'&&ack.raw?randomUUID():null;
   if(ack.outcome!=='not_submitted'&&t.action!=='triggerAll'&&(t.raw||ack.raw))try{const observe=()=>this._check(s,epoch);await this._network(s,observe,async o=>{
    if(t.action==='run'){if(!ack.nativeHistoryId)return;const data=await s.client.history(t.raw.id,100,o);if(!P.plain(data)||!Array.isArray(data.history)||data.history.length>100)P.fail('invalid_response');observation={state:data.history.some(r=>r.id===ack.nativeHistoryId&&r.scheduledExportId===t.raw.id)?'match':'different',source:'qce-native-memory'};return;}
    let current;try{current=await s.client.plan(t.raw?.id||ack.raw.id,o);}catch(e){if(P.safeCode(e)==='native_plan_unavailable'){observation={state:'absent',source:'qce-native-memory'};return;}throw e;}
    const expected=t.action==='create'?ack.raw:{...t.raw,...t.body};observation={state:t.action==='remove'?'different':equivalent(expected,current)?'match':'different',source:'qce-native-memory'};
   });}catch{observation=unavailable();}
   return {...this._envelope(s),change:{kind:'qce-native-plan-change',ticketId:t.id,action:t.action,submission:ack.submission,bridgeResponse:ack.bridgeResponse,outcome:ack.outcome,planId,execution:ack.outcome==='accepted'?ack.execution||null:null,queue:ack.outcome==='accepted'?ack.queue||null:null,observation,scope:{...P.SCOPE},effects:t.effects,automaticRetry:false,...(ack.outcome==='accepted'?{}:{code:ack.outcome==='unknown'?'change_unknown':P.safeCode(ack)})}};
  });
 }
 async history(input){
  qceNativePlansRequest(input,'history');const s=this._get(input),{raw}=this._saved(s,input.observationId,input.planId);s.ticket=null;const epoch=++s.epoch,check=()=>this._check(s,epoch);
  return this._job(s,async()=>{const data=await this._network(s,check,o=>s.client.history(raw.id,input.limit,o));if(!P.plain(data)||!Array.isArray(data.history)||data.history.length>input.limit)P.fail('invalid_response');return {...this._envelope(s),history:{kind:'qce-native-plan-history',planId:input.planId,observationId:input.observationId,limit:input.limit,items:data.history.map(r=>P.historyItem(r,raw.id)),source:'qce-native-history',hasPagination:false,scope:{...P.SCOPE}}};});
 }
 dismiss(input){qceNativePlansRequest(input,'dismiss');const s=this.session;if(sameScope(s,input)){s.ticket=null;++s.epoch;}return {...base(input),...(sameScope(s,input)?{qqAccountId:s.binding.qqAccountId}:{}),dismissed:true};}
}
async function qceNativePlansResult(input,operation){try{return {ok:true,...await operation()};}catch(e){return {ok:false,...(P.profileId(input?.accountId)?{accountId:input.accountId}:{}),...(P.uuid(input?.panelId)?{panelId:input.panelId}:{}),code:P.safeCode(e)};}}
module.exports={QQQCENativePlansSession,qceNativePlansRequest,qceNativePlansResult};
