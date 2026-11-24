'use strict';
const {randomUUID}=require('node:crypto');
const {QQQCEClient}=require('./qq-qce-client.cjs');
const P=require('./qq-qce-policy.cjs');
const {qceRequest}=P;
const base=value=>({accountId:value.accountId,panelId:value.panelId});
const sameScope=(a,b)=>a?.accountId===b.accountId&&a?.panelId===b.panelId;
const BINDING_KEYS=['accountId','panelId','qqAccountId','contextKey','credentialRevision','workScope','profile','runtime','installation','componentVersion','pluginVersion','pluginStatus'];
function captured(value,input){
 if(!P.plain(value)||value.accountId!==input.accountId||value.panelId!==input.panelId||!P.qq(value.qqAccountId)||!P.text(value.contextKey,256)||!P.uuid(value.credentialRevision)||!P.text(value.workScope,256)||!value.profile||!value.runtime||!value.installation)P.fail('changed');
 if(value.componentVersion!=='4.18.42'||!P.VERSIONS.includes(value.pluginVersion)||value.pluginStatus!=='active')P.fail('qce_version_unsupported');
 return Object.fromEntries(BINDING_KEYS.map(key=>[key,value[key]]));
}
const same=(a,b)=>BINDING_KEYS.every(key=>a[key]===b[key]);
const details=()=>({scope:{...P.SCOPE},effects:{...P.EFFECTS}});
function changeBase(ticket){return {kind:'qce-settings-change',ticketId:ticket.id,field:ticket.field,...details(),automaticRetry:false,automaticRestore:false};}
const unavailable=()=>({state:'unavailable',source:'qce-config-projection'});
function receipt(raw){
 if(!P.plain(raw)||!['not_submitted','submitted','unknown'].includes(raw.submission)||!['received','unavailable'].includes(raw.bridgeResponse)||!['accepted','unknown','not_submitted'].includes(raw.outcome))P.fail('invalid_response');
 if(raw.outcome==='accepted'&&(raw.submission!=='submitted'||raw.bridgeResponse!=='received')||raw.outcome==='not_submitted'&&(raw.submission!=='not_submitted'||raw.bridgeResponse!=='unavailable')||raw.outcome==='unknown'&&raw.submission==='not_submitted')P.fail('invalid_response');
 return {submission:raw.submission,bridgeResponse:raw.bridgeResponse,outcome:raw.outcome,...(raw.outcome==='accepted'?{}:{code:raw.outcome==='unknown'?'change_unknown':P.safeCode(raw)})};
}
class QQQCESession {
 constructor({capture,verifyContext,clientFactory=options=>new QQQCEClient(options),now=Date.now,monotonic=()=>performance.now()}={}){
  if([capture,verifyContext,clientFactory,now,monotonic].some(fn=>typeof fn!=='function'))P.fail('invalid_request');
  Object.assign(this,{capture,verifyContext,clientFactory,now,monotonic});this.session=null;this.retiringSession=null;this.retiring=Promise.resolve({closed:true});this.closed=false;
 }
 get accountId(){return this.session?.accountId||null;}
 _capture(input){if(this.closed)P.fail('closed');const value=this.capture(base(input));if(value?.then){value.catch?.(()=>{});P.fail('invalid_request');}return captured(value,input);}
 _assert(s){if(this.closed||this.session!==s||s.abort.signal.aborted||!same(s.binding,this._capture(s)))P.fail('changed');}
 async _verify(s,check=()=>this._assert(s)){
  check();const value=await this.verifyContext(s.binding,{signal:s.abort.signal,assertCurrent:check});check();
  P.exact(value,['verified','endpoint'],'endpoint_unverified');const e=value.endpoint;
  P.exact(e,['host','port','token','endpointId','ownershipVerified'],'endpoint_unverified');
  if(value.verified!==true||e.host!=='127.0.0.1'||e.port!==40653||e.ownershipVerified!==true||!P.text(e.endpointId,256)||typeof e.token!=='string'||!/^[A-Za-z0-9]{40}$/.test(e.token))P.fail('endpoint_unverified');
  if(s.endpoint&&Object.keys(s.endpoint).some(key=>s.endpoint[key]!==e[key]))P.fail('changed');if(!s.endpoint)s.endpoint={...e};return s.endpoint;
 }
 _get(input){const s=this.session;if(!sameScope(s,input))P.fail('changed');if(s.pending)P.fail('operation_in_progress');this._assert(s);return s;}
 _envelope(s){return {...base(s),qqAccountId:s.binding.qqAccountId};}
 async _paths(s,check){
  const options={signal:s.abort.signal,assertCurrent:check};check();P.identity(await s.client.system(options),s.binding.qqAccountId,s.binding.pluginVersion);check();
  const value=P.config(await s.client.config(options));check();P.identity(await s.client.system(options),s.binding.qqAccountId,s.binding.pluginVersion);check();return value;
 }
 async read(input){
  qceRequest(input);const binding=this._capture(input);let s=this.session;if(s?.pending)P.fail('operation_in_progress');
  const fresh=!sameScope(s,input)||!same(s.binding,binding);let retiring=Promise.resolve();
  if(fresh){retiring=this._retire();s={...base(input),binding,abort:new AbortController(),endpoint:null,client:null,pending:null,baseline:null,ticket:null,epoch:0,timer:null};this.session=s;}
  s.baseline=null;s.ticket=null;const epoch=++s.epoch;
  const check=()=>{this._assert(s);if(s.epoch!==epoch)P.fail('cancelled');};
  const operation=(async()=>{
   try{
    if(fresh){await retiring;check();const endpoint=await this._verify(s,check);check();s.client=this.clientFactory({host:endpoint.host,port:endpoint.port,token:endpoint.token,version:s.binding.pluginVersion});if(!s.client||['system','config','setConfig','close'].some(k=>typeof s.client[k]!=='function'))P.fail('invalid_response');check();s.timer=setInterval(()=>this.observe(),250);s.timer.unref?.();}
    else{await this._verify(s,check);check();}
    const paths=await this._paths(s,check);check();const id=randomUUID();s.baseline={id,paths,hash:P.digest(paths),deadline:this.monotonic()+P.LIMITS.ticketTtlMs};
    return {...this._envelope(s),profile:{kind:'qce-settings',observationId:id,fetchedAt:new Date(this.now()).toISOString(),version:s.binding.pluginVersion,source:'qce-config-projection',paths:P.copy(paths),...details(),limits:{...P.LIMITS}}};
   }catch(error){s.baseline=null;s.ticket=null;if(this.session===s)void this._retire();throw new P.QCEError(P.safeCode(error));}
  })();s.pending=operation;try{return await operation;}finally{if(s.pending===operation)s.pending=null;}
 }
 preview(input){
  qceRequest(input,'preview');const s=this._get(input),saved=s.baseline;s.ticket=null;++s.epoch;
  if(!saved||saved.id!==input.observationId)P.fail('stale_observation');if(this.monotonic()>=saved.deadline)P.fail('expired_ticket');
  if(saved.paths[input.field]===input.value)P.fail('no_changes');const id=randomUUID();s.ticket={id,field:input.field,value:input.value,hash:saved.hash,deadline:this.monotonic()+P.LIMITS.ticketTtlMs};
  return {...this._envelope(s),preview:{kind:'qce-settings-preview',ticketId:id,observationId:saved.id,field:input.field,before:saved.paths[input.field],after:input.value,expiresAt:this.now()+P.LIMITS.ticketTtlMs,...details(),automaticRetry:false,automaticRestore:false}};
 }
 async confirm(input){
  qceRequest(input,'confirm');const s=this._get(input),ticket=s.ticket;if(!ticket||ticket.id!==input.ticketId)P.fail('stale_ticket');s.ticket=null;s.baseline=null;
  const epoch=s.epoch;let invoked=false,attempted=false;
  const check=()=>{this._assert(s);if(s.epoch!==epoch)P.fail('cancelled');if(this.monotonic()>=ticket.deadline)P.fail('expired_ticket');};
  const operation=(async()=>{
   let ack;
   try{
    check();await this._verify(s,check);check();const current=await this._paths(s,check);check();if(P.digest(current)!==ticket.hash)P.fail('baseline_changed');
    await this._verify(s,check);check();invoked=true;
    ack=receipt(await s.client.setConfig(ticket.field,ticket.value,{signal:s.abort.signal,assertCurrent:check,onAttempt:()=>{attempted=true;}}));
   }catch(error){
    const noSend=error?.submitted===false||!invoked&&!attempted;
    ack=noSend?{submission:'not_submitted',bridgeResponse:'unavailable',outcome:'not_submitted',code:P.safeCode(error)}:{submission:attempted?'submitted':'unknown',bridgeResponse:error?.bridgeResponse==='received'?'received':'unavailable',outcome:'unknown',code:'change_unknown'};
   }
   let observation=unavailable();
   if(ack.outcome!=='not_submitted')try{const observe=()=>{this._assert(s);if(s.epoch!==epoch)P.fail('cancelled');};observe();await this._verify(s,observe);observe();const paths=await this._paths(s,observe);observation={state:paths[ticket.field]===ticket.value?'match':'different',source:'qce-config-projection'};}catch{}
   return {...this._envelope(s),change:{...changeBase(ticket),...ack,observation}};
  })();s.pending=operation;try{return await operation;}finally{if(s.pending===operation)s.pending=null;}
 }
 dismiss(input){qceRequest(input,'dismiss');const s=this.session;if(sameScope(s,input)){s.ticket=null;++s.epoch;}return {...base(input),dismissed:true};}
 _retire(){
  const s=this.session;this.session=null;if(!s)return this.retiring;
  clearInterval(s.timer);s.ticket=null;s.baseline=null;++s.epoch;s.abort.abort();s.client?.close();this.retiringSession=s;
  const old=this.retiring;this.retiring=(async()=>{await old;await s.pending?.catch(()=>{});if(this.retiringSession===s)this.retiringSession=null;return {closed:true};})();return this.retiring;
 }
 closeOwned(input){qceRequest(input,'close');if(!sameScope(this.session,input))return (sameScope(this.retiringSession,input)?this.retiring:Promise.resolve()).then(()=>({...base(input),closed:true}));return this._retire().then(()=>({...base(input),closed:true}));}
 closeCurrent(){return this._retire();}
 observe(){if(this.session)try{this._assert(this.session);}catch{void this._retire();}}
 close(){this.closed=true;return this._retire();}
}
async function qceResult(input,operation){try{return {ok:true,...await operation()};}catch(error){return {ok:false,...(P.profileId(input?.accountId)?{accountId:input.accountId}:{}),...(P.uuid(input?.panelId)?{panelId:input.panelId}:{}),code:P.safeCode(error)};}}
module.exports={QQQCESession,qceRequest,qceResult,captured,changeBase};
