'use strict';
const {randomUUID}=require('node:crypto');
const {QQQCESession}=require('./qq-qce-session.cjs');
const {QQQCESecurityClient}=require('./qq-qce-security-client.cjs');
const P=require('./qq-qce-security-policy.cjs');
const {qceSecurityRequest}=P;
const base=v=>({accountId:v.accountId,panelId:v.panelId});
const sameScope=(a,b)=>a?.accountId===b.accountId&&a?.panelId===b.panelId;
const details=()=>({scope:{...P.SCOPE},effects:{...P.EFFECTS}});
const unavailable=()=>({state:'unavailable',source:'qce-security-projection'});
function receipt(raw){
 if(!P.plain(raw)||!['not_submitted','submitted','unknown'].includes(raw.submission)||!['received','unavailable'].includes(raw.bridgeResponse)||!['accepted','unknown','not_submitted'].includes(raw.outcome))P.fail('invalid_response');
 if(raw.outcome==='accepted'&&(raw.submission!=='submitted'||raw.bridgeResponse!=='received')||raw.outcome==='not_submitted'&&(raw.submission!=='not_submitted'||raw.bridgeResponse!=='unavailable')||raw.outcome==='unknown'&&raw.submission==='not_submitted')P.fail('invalid_response');
 return {submission:raw.submission,bridgeResponse:raw.bridgeResponse,outcome:raw.outcome,...(raw.outcome==='accepted'?{}:{code:raw.outcome==='unknown'?'change_unknown':P.safeCode(raw)})};
}
// Share only the existing owned endpoint/context retirement mechanism. Security
// DTOs and mutation policy remain separate from directory settings.
class QQQCESecuritySession extends QQQCESession{
 constructor(options={}){super({...options,clientFactory:options.clientFactory||((value)=>new QQQCESecurityClient(value))});}
 get panelId(){return this.session?.panelId||null;}
 async _security(s,check){
  const options={signal:s.abort.signal,assertCurrent:check};check();P.identity(await s.client.system(options),s.binding.qqAccountId,s.binding.pluginVersion);check();
  const list=await s.client.whitelist(options);check();
  const info=s.binding.pluginVersion==='6.4.2'?await s.client.authenticate(options):await s.client.status(options);check();
  if(s.binding.pluginVersion==='6.4.2'){const repeated=await s.client.whitelist(options);check();if(P.digest(repeated)!==P.digest(list))P.fail('baseline_changed');}
  const value=P.combine(list,info,s.binding.pluginVersion);
  P.identity(await s.client.system(options),s.binding.qqAccountId,s.binding.pluginVersion);check();return value;
 }
 async read(input){
  qceSecurityRequest(input);const binding=this._capture(input);let s=this.session;if(s?.pending)P.fail('operation_in_progress');
  const fresh=!sameScope(s,input)||Object.keys(binding).some(k=>s.binding[k]!==binding[k]);let retiring=Promise.resolve();
  if(fresh){retiring=this._retire();s={...base(input),binding,abort:new AbortController(),endpoint:null,client:null,pending:null,baseline:null,ticket:null,epoch:0,timer:null};this.session=s;}
  s.baseline=null;s.ticket=null;const epoch=++s.epoch,check=()=>{this._assert(s);if(s.epoch!==epoch)P.fail('cancelled');};
  const operation=(async()=>{try{
   if(fresh){await retiring;check();const endpoint=await this._verify(s,check);check();s.client=this.clientFactory({host:endpoint.host,port:endpoint.port,token:endpoint.token,version:s.binding.pluginVersion});if(!s.client||['system','whitelist','status','mutate','close',...(s.binding.pluginVersion==='6.4.2'?['authenticate']:[])].some(k=>typeof s.client[k]!=='function'))P.fail('invalid_response');check();s.timer=setInterval(()=>this.observe(),250);s.timer.unref?.();}
   else{await this._verify(s,check);check();}
   const value=await this._security(s,check);check();const id=randomUUID(),ids=value.rules.map(()=>randomUUID());s.baseline={id,value,ids,hash:P.digest(value),deadline:this.monotonic()+P.LIMITS.ticketTtlMs};
   return {...this._envelope(s),profile:{kind:'qce-access-rules',observationId:id,fetchedAt:new Date(this.now()).toISOString(),version:s.binding.pluginVersion,source:'qce-security-projection',state:P.project(value,ids),...details(),limits:{...P.LIMITS}}};
  }catch(error){s.baseline=null;s.ticket=null;if(this.session===s)void this._retire();throw new P.QCESecurityError(P.safeCode(error));}})();
  s.pending=operation;try{return await operation;}finally{if(s.pending===operation)s.pending=null;}
 }
 preview(input){
  qceSecurityRequest(input,'preview');const s=this._get(input),saved=s.baseline;s.ticket=null;++s.epoch;
  if(!saved||saved.id!==input.observationId)P.fail('stale_observation');if(this.monotonic()>=saved.deadline)P.fail('expired_ticket');
  const mutation=P.mutation(saved,input.action,input.value,s.binding.pluginVersion),id=randomUUID();s.ticket={id,action:input.action,...mutation,hash:saved.hash,deadline:this.monotonic()+P.LIMITS.ticketTtlMs};
  return {...this._envelope(s),preview:{kind:'qce-access-rules-preview',ticketId:id,observationId:saved.id,action:input.action,before:mutation.before,after:mutation.after,expiresAt:this.now()+P.LIMITS.ticketTtlMs,scope:{...P.SCOPE},effects:mutation.effects}};
 }
 async confirm(input){
  qceSecurityRequest(input,'confirm');const s=this._get(input),ticket=s.ticket;if(!ticket||ticket.id!==input.ticketId)P.fail('stale_ticket');s.ticket=null;s.baseline=null;
  const epoch=s.epoch;let invoked=false,attempted=false;const check=()=>{this._assert(s);if(s.epoch!==epoch)P.fail('cancelled');if(this.monotonic()>=ticket.deadline)P.fail('expired_ticket');};
  const operation=(async()=>{
   let ack;try{
    check();await this._verify(s,check);check();const current=await this._security(s,check);check();if(P.digest(current)!==ticket.hash)P.fail('baseline_changed');await this._verify(s,check);check();invoked=true;
    ack=receipt(await s.client.mutate(ticket.command,{signal:s.abort.signal,assertCurrent:check,onAttempt:()=>{attempted=true;}}));
   }catch(error){const noSend=error?.submitted===false||!invoked&&!attempted;ack=noSend?{submission:'not_submitted',bridgeResponse:'unavailable',outcome:'not_submitted',code:P.safeCode(error)}:{submission:attempted?'submitted':'unknown',bridgeResponse:error?.bridgeResponse==='received'?'received':'unavailable',outcome:'unknown',code:'change_unknown'};}
   let observation=unavailable();if(ack.outcome!=='not_submitted')try{const checkObservation=()=>{this._assert(s);if(s.epoch!==epoch)P.fail('cancelled');};checkObservation();await this._verify(s,checkObservation);checkObservation();const current=await this._security(s,checkObservation);observation={state:P.digest(current)===P.digest(ticket.expected)?'match':'different',source:'qce-security-projection'};}catch{}
   return {...this._envelope(s),change:{kind:'qce-access-rules-change',ticketId:ticket.id,action:ticket.action,scope:{...P.SCOPE},effects:ticket.effects,...ack,observation,automaticRetry:false,automaticRestore:false}};
  })();s.pending=operation;try{return await operation;}finally{if(s.pending===operation)s.pending=null;}
 }
 dismiss(input){qceSecurityRequest(input,'dismiss');const s=this.session;if(sameScope(s,input)){s.ticket=null;++s.epoch;}return {...base(input),...(sameScope(s,input)?{qqAccountId:s.binding.qqAccountId}:{}),dismissed:true};}
}
async function qceSecurityResult(input,operation){try{return {ok:true,...await operation()};}catch(error){return {ok:false,...(P.profileId(input?.accountId)?{accountId:input.accountId}:{}),...(P.uuid(input?.panelId)?{panelId:input.panelId}:{}),code:P.safeCode(error)};}}
module.exports={QQQCESecuritySession,qceSecurityRequest,qceSecurityResult};
