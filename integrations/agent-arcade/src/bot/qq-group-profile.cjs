'use strict';
// Original, private group-name transaction. No message/AI/restore path.
const {randomUUID}=require('node:crypto');
const {capture}=require('./qq-self-profile.cjs');
const BINDING_KEYS=['profile','profileId','generation','characterId','runtime','installation','runtimeEpoch','bridgeRevision','endpointId','client','socket','clientGeneration','accountId'];
const CODES=new Set(['invalid_request','invalid_value','original_unsupported','disconnected','changed','cancelled','timeout','operation_in_progress','closed','invalid_response','unavailable','account_mismatch','account_changed','account_offline','status_unverified','bridge_unhealthy','action_failed','baseline_changed','stale_observation','stale_ticket','expired_ticket','change_unknown','group_not_joined','group_changed','role_changed','insufficient_role','response_too_large']);
class GroupProfileError extends Error{constructor(code){const safe=CODES.has(code)?code:'unavailable';super(`QQ group profile operation failed (${safe}).`);this.code=safe;}}
const fail=code=>{throw new GroupProfileError(code);};
const safeCode=error=>new GroupProfileError(({aborted:'cancelled',action_timeout:'timeout',request_limit:'operation_in_progress',login_required:'account_offline'})[error?.code]||error?.code).code;
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&(Object.getPrototypeOf(value)===Object.prototype||Object.getPrototypeOf(value)===null);
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(value);
const groupId=value=>typeof value==='string'&&/^[1-9]\d{4,14}$/.test(value)&&Number.isSafeInteger(Number(value));
const role=value=>['owner','admin','member'].includes(value),privileged=value=>['owner','admin'].includes(value);
const same=(a,b)=>BINDING_KEYS.every(key=>a[key]===b[key]);
function exact(value,keys){if(!plain(value)||Object.keys(value).sort().join('|')!==[...keys].sort().join('|'))fail('invalid_request');}
function groupName(value){if(typeof value!=='string'||!value.trim()||value.length>120||[...value].length>60||/[\p{Cc}\p{Cf}\u2028\u2029]/u.test(value)||/[\uD800-\uDFFF]/u.test(value))fail('invalid_value');return value;}
function observation(raw,accountId,selectedGroup){
 if(!plain(raw)||raw.accountId!==accountId||raw.groupId!==selectedGroup||!role(raw.selfRole)||raw.source!=='bridge-observed'||typeof raw.fetchedAt!=='string'||!Number.isFinite(Date.parse(raw.fetchedAt))||!plain(raw.name)||typeof raw.name.supported!=='boolean')fail('invalid_response');
 let name=null;if(raw.name.supported){try{name=groupName(raw.name.value);}catch{fail('invalid_response');}}else if(raw.name.value!==undefined||raw.name.reason!=='original_unsupported')fail('invalid_response');
 return {accountId,groupId:selectedGroup,name,selfRole:raw.selfRole,capabilities:{readName:raw.name.supported,editName:raw.name.supported&&privileged(raw.selfRole)},source:'bridge-observed',fetchedAt:raw.fetchedAt,cacheMayBeStale:true};
}
class QQGroupProfile {
 constructor({getBinding,transport,now=Date.now,monotonic=()=>performance.now(),timeoutMs=20000}={}){
  if(typeof getBinding!=='function'||typeof transport?.read!=='function'||typeof transport?.write!=='function'||typeof now!=='function'||typeof monotonic!=='function'||!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>30000)fail('invalid_request');
  Object.assign(this,{getBinding,transport,now,monotonic,timeoutMs});this.baseline=null;this.ticket=null;this.operation=null;this.closed=false;
 }
 _clear(){this.baseline=null;this.ticket=null;}
 _current(expected,signal){if(signal?.aborted)fail('cancelled');if(this.closed)fail('closed');try{const value=capture(this.getBinding());if(expected&&!same(value,expected))fail('changed');return value;}catch(error){this._clear();throw new GroupProfileError(safeCode(error));}}
 _run(signal,fn){
  if(this.operation)fail('operation_in_progress');const controller=new AbortController(),combined=signal?AbortSignal.any([signal,controller.signal]):controller.signal,op={controller,timedOut:false,promise:null};this.operation=op;
  const timer=setTimeout(()=>{op.timedOut=true;controller.abort();},this.timeoutMs);
  op.promise=Promise.resolve().then(()=>fn(combined,op)).finally(()=>{clearTimeout(timer);if(this.operation===op)this.operation=null;});return op.promise;
 }
 snapshot(){let available=true;try{this._current(this.ticket?.binding||this.baseline?.binding);}catch{this._clear();available=false;}return {busy:!!this.operation,available};}
 async read({groupId:target,signal}={}){
  if(!groupId(target))fail('invalid_request');if(this.operation)fail('operation_in_progress');this._clear();const binding=this._current(null,signal);
  return this._run(signal,async(combined,op)=>{try{
   const raw=await this.transport.read(binding,target,{signal:combined,assertCurrent:()=>this._current(binding,combined)});this._current(binding,combined);
   const row=observation(raw,binding.accountId,target),id=randomUUID();this.baseline={id,binding,row,deadline:this.monotonic()+300000};return {kind:'group-profile',observationId:id,...row};
  }catch(error){this._clear();throw new GroupProfileError(op.timedOut?'timeout':safeCode(error));}});
 }
 preview(value){
  exact(value,['observationId','field','value']);if(!uuid(value.observationId)||value.field!=='name')fail('invalid_request');if(this.operation)fail('operation_in_progress');const before=this.baseline;this.ticket=null;
  if(!before||before.id!==value.observationId)fail('stale_observation');this._current(before.binding);if(this.monotonic()>=before.deadline)fail('expired_ticket');
  if(!before.row.capabilities.readName)fail('original_unsupported');if(!before.row.capabilities.editName)fail('insufficient_role');const target=groupName(value.value),id=randomUUID();
  this.ticket={id,binding:before.binding,groupId:before.row.groupId,role:before.row.selfRole,before:before.row.name,target,deadline:this.monotonic()+300000};
  return {kind:'group-profile-preview',ticketId:id,accountId:before.binding.accountId,groupId:before.row.groupId,field:'name',role:this.ticket.role,before:this.ticket.before,after:target,expiresAt:this.now()+300000,cacheMayBeStale:true,automaticRetry:false};
 }
 async confirm(value,{signal}={}){
  exact(value,['ticketId']);if(!uuid(value.ticketId))fail('invalid_request');if(this.operation)fail('operation_in_progress');const ticket=this.ticket;if(!ticket||ticket.id!==value.ticketId)fail('stale_ticket');this._clear();
  return this._run(signal,async(combined,op)=>{
   let invoked=false;
   const result=(outcome,code,observed={state:'unavailable',source:'bridge-observed'})=>({kind:'group-profile-change',ticketId:ticket.id,accountId:ticket.binding.accountId,groupId:ticket.groupId,field:'name',outcome,...(outcome==='accepted'?{acknowledgement:'bridge-reported-success'}:{}),...(code?{code}:{}),observation:observed,automaticRetry:false,automaticRestore:false});
   try{
    if(this.monotonic()>=ticket.deadline)fail('expired_ticket');this._current(ticket.binding,combined);
    invoked=true;const receipt=await this.transport.write(ticket.binding,{groupId:ticket.groupId,value:ticket.target,expectedValue:ticket.before,expectedRole:ticket.role},{signal:combined,assertCurrent:()=>this._current(ticket.binding,combined)});
    if(!plain(receipt)||!['accepted','unknown','not_submitted'].includes(receipt.outcome)||receipt.outcome==='accepted'&&receipt.acknowledgement!=='bridge-reported-success')fail('change_unknown');
    if(receipt.outcome==='not_submitted')return result('not_submitted',op.timedOut?'timeout':safeCode(receipt));
    if(receipt.outcome==='unknown')return result('unknown','change_unknown');
    // The bridge acknowledgement survives later navigation. Observation is a
    // separate bounded cache read, never an automatic write/restore/retry.
    let observed={state:'unavailable',source:'bridge-observed'};
    try{this._current(ticket.binding,combined);const raw=await this.transport.read(ticket.binding,ticket.groupId,{signal:combined,assertCurrent:()=>this._current(ticket.binding,combined)});this._current(ticket.binding,combined);const row=observation(raw,ticket.binding.accountId,ticket.groupId);if(row.capabilities.readName)observed={state:row.name===ticket.target?'observed_match':'observed_different',value:row.name,selfRole:row.selfRole,source:'bridge-observed',fetchedAt:row.fetchedAt,cacheMayBeStale:true};}catch{}
    return result('accepted',null,observed);
   }catch(error){return result(invoked?'unknown':'not_submitted',invoked?'change_unknown':op.timedOut?'timeout':safeCode(error));}
  });
 }
 discardPreview(){this.ticket=null;}
 dismiss(){this._clear();}
 async close(){this.closed=true;this._clear();const op=this.operation;if(op){op.controller.abort();await op.promise.catch(()=>{});}return {closed:true};}
}
module.exports={QQGroupProfile,GroupProfileError,groupName,groupId,safeCode,observation,privileged,exact,uuid,plain};
