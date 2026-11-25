'use strict';
// One-use manual group transactions. No message consumer, retry or restore.
const {randomUUID}=require('node:crypto');
const {capture}=require('./qq-self-profile.cjs');
const {plain,uuid,groupId,exact}=require('./qq-group-profile.cjs');
const OPS=Object.freeze(['card','ban','whole-ban','admin','kick','leave','dissolve']);
const MEMBER_OPS=new Set(['card','ban','admin','kick']);
const BAN_SECONDS=Object.freeze([0,300,1800,3600,86400]);
const MAX_BAN_SECONDS=2592000;
const CODES=new Set(['invalid_request','invalid_value','original_unsupported','disconnected','changed','cancelled','timeout','operation_in_progress','closed','invalid_response','unavailable','account_mismatch','account_changed','account_offline','status_unverified','bridge_unhealthy','action_failed','baseline_changed','stale_observation','stale_ticket','expired_ticket','change_unknown','group_not_joined','group_changed','role_changed','insufficient_role','response_too_large','member_not_found','target_changed','target_required','group_context_required','self_target_forbidden']);
class GroupAdminError extends Error{constructor(code){const safe=CODES.has(code)?code:'unavailable';super(`QQ group administration failed (${safe}).`);this.code=safe;}}
const fail=code=>{throw new GroupAdminError(code);};
const safeCode=error=>new GroupAdminError(({aborted:'cancelled',action_timeout:'timeout',request_limit:'operation_in_progress',login_required:'account_offline'})[error?.code]||error?.code).code;
const role=value=>['owner','admin','member'].includes(value),privileged=value=>['owner','admin'].includes(value);
const rank=value=>({owner:3,admin:2,member:1})[value];
const scope=row=>({groupId:row.groupId,...(row.memberId?{memberId:row.memberId}:{})});
const acknowledgementFor=operation=>operation==='card'?'bridge-observed-match':['ban','whole-ban'].includes(operation)?'bridge-reported-success':'bridge-action-only';
function card(value){if(typeof value!=='string'||value.length>120||[...value].length>60||/[\p{Cc}\p{Cf}\u2028\u2029]/u.test(value)||/[\uD800-\uDFFF]/u.test(value))fail('invalid_value');return value;}
function inputValue(operation,value){if(!OPS.includes(operation))fail('invalid_request');if(operation==='card')return card(value);if(operation==='ban'){if(!Number.isSafeInteger(value)||value<0||value>MAX_BAN_SECONDS)fail('invalid_value');return value;}if(['whole-ban','admin','kick'].includes(operation)){if(typeof value!=='boolean')fail('invalid_value');return value;}if(value!==undefined)fail('invalid_request');return undefined;}
function previewInput(value){exact(value,['observationId','operation',...(['leave','dissolve'].includes(value?.operation)?[]:['value'])]);if(!uuid(value.observationId))fail('invalid_request');inputValue(value.operation,value.value);}
const display=value=>typeof value==='string'?value.replace(/[\p{Cc}\p{Cf}\u2028\u2029]/gu,'').slice(0,500):'';
function capabilities(row,accountId){
 const result={},target=row.target,reason=(op)=>{
  if(MEMBER_OPS.has(op)&&!target)return 'target_required';if(!MEMBER_OPS.has(op)&&target)return 'group_context_required';
  if(op==='card'){if(target.card===null)return 'original_unsupported';return target.id===accountId||privileged(row.selfRole)?null:'insufficient_role';}
  if(op==='ban'||op==='kick'){if(target.id===accountId)return 'self_target_forbidden';if(!privileged(row.selfRole)||rank(row.selfRole)<=rank(target.role))return 'insufficient_role';if(op==='ban'&&target.muteUntil===null)return 'original_unsupported';return null;}
  if(op==='admin')return row.selfRole==='owner'&&target.id!==accountId&&target.role!=='owner'?null:'insufficient_role';
  if(op==='whole-ban')return !privileged(row.selfRole)?'insufficient_role':row.wholeBan===null?'original_unsupported':null;
  if(op==='leave')return row.selfRole!=='owner'?null:'insufficient_role';if(op==='dissolve')return row.selfRole==='owner'?null:'insufficient_role';return 'invalid_request';
 };for(const op of OPS){const why=reason(op);result[op]=why?{enabled:false,reason:why}:{enabled:true};}return result;
}
function observation(raw,accountId,selected){
 if(!plain(raw)||raw.accountId!==accountId||raw.groupId!==selected.groupId||raw.memberId!==selected.memberId||!role(raw.selfRole)||raw.source!=='bridge-observed'||typeof raw.fetchedAt!=='string'||!Number.isFinite(Date.parse(raw.fetchedAt))||typeof raw.groupName!=='string'||(raw.wholeBan!==null&&typeof raw.wholeBan!=='boolean'))fail('invalid_response');
 let target=null;if(selected.memberId){const t=raw.target;if(!plain(t)||t.id!==selected.memberId||!role(t.role)||typeof t.nickname!=='string'||(t.card!==null&&typeof t.card!=='string')||(t.muteUntil!==null&&(!Number.isSafeInteger(t.muteUntil)||t.muteUntil<0)))fail('invalid_response');if(t.card!==null)try{card(t.card);}catch{fail('invalid_response');}target={id:t.id,nickname:display(t.nickname),role:t.role,card:t.card,muteUntil:t.muteUntil};}else if(raw.target!==null)fail('invalid_response');
 const row={accountId,...scope(selected),groupName:display(raw.groupName),selfRole:raw.selfRole,target,wholeBan:raw.wholeBan,source:'bridge-observed',fetchedAt:raw.fetchedAt,cacheMayBeStale:true};return {...row,capabilities:capabilities(row,accountId),limits:{cardCodePoints:60,cardUtf16:120,banSeconds:[...BAN_SECONDS],maxBanSeconds:MAX_BAN_SECONDS}};
}
function values(row,operation,value){
 if(operation==='card')return {before:{card:row.target.card},after:{card:value}};
 if(operation==='ban')return {before:{muteUntil:row.target.muteUntil},after:{duration:value}};
 if(operation==='whole-ban')return {before:{enabled:row.wholeBan},after:{enabled:value}};
 if(operation==='admin')return {before:{role:row.target.role},after:{role:value?'admin':'member'}};
 if(operation==='kick')return {before:{present:true},after:{present:false,rejectRejoinRequests:value}};
 return {before:{member:true},after:{member:false,dissolve:operation==='dissolve'}};
}
function baseline(row,operation){return JSON.stringify({selfRole:row.selfRole,targetRole:row.target?.role,...values(row,operation,undefined).before});}
function compare(before,after,operation){if(before.selfRole!==after.selfRole||before.target?.role!==after.target?.role)fail('role_changed');if(baseline(before,operation)!==baseline(after,operation))fail('baseline_changed');const cap=after.capabilities[operation];if(!cap?.enabled)fail(cap?.reason||'insufficient_role');}
const BINDING_KEYS=['profile','profileId','generation','characterId','runtime','installation','runtimeEpoch','bridgeRevision','endpointId','client','socket','clientGeneration','accountId'];
class QQGroupAdmin {
 constructor({getBinding,transport,now=Date.now,monotonic=()=>performance.now(),timeoutMs=20000}={}){if(typeof getBinding!=='function'||typeof transport?.read!=='function'||typeof transport?.write!=='function'||typeof transport?.observe!=='function'||typeof now!=='function'||typeof monotonic!=='function'||!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>30000)fail('invalid_request');Object.assign(this,{getBinding,transport,now,monotonic,timeoutMs});this.baseline=null;this.ticket=null;this.operation=null;this.closed=false;}
 _clear(){this.baseline=null;this.ticket=null;}
 _current(expected,signal){if(signal?.aborted)fail('cancelled');if(this.closed)fail('closed');try{const current=capture(this.getBinding());if(expected&&!BINDING_KEYS.every(key=>expected[key]===current[key]))fail('changed');return current;}catch(error){this._clear();throw new GroupAdminError(safeCode(error));}}
 _run(signal,fn){if(this.operation)fail('operation_in_progress');const controller=new AbortController(),combined=signal?AbortSignal.any([signal,controller.signal]):controller.signal,op={controller,promise:null,timedOut:false};this.operation=op;const timer=setTimeout(()=>{op.timedOut=true;controller.abort();},this.timeoutMs);op.promise=Promise.resolve().then(()=>fn(combined,op)).finally(()=>{clearTimeout(timer);if(this.operation===op)this.operation=null;});return op.promise;}
 async read({groupId:target,memberId,signal}={}){if(!groupId(target)||memberId!==undefined&&!groupId(memberId))fail('invalid_request');if(this.operation)fail('operation_in_progress');this._clear();const binding=this._current(null,signal),selected={groupId:target,...(memberId?{memberId}:{})};return this._run(signal,async(combined,op)=>{try{const raw=await this.transport.read(binding,selected,{signal:combined,assertCurrent:()=>this._current(binding,combined)});this._current(binding,combined);const row=observation(raw,binding.accountId,selected),id=randomUUID();this.baseline={id,binding,row,deadline:this.monotonic()+300000};return {kind:'group-admin',observationId:id,...row};}catch(error){this._clear();throw new GroupAdminError(op.timedOut?'timeout':safeCode(error));}});}
 preview(value){previewInput(value);if(this.operation)fail('operation_in_progress');const saved=this.baseline;this.ticket=null;if(!saved||saved.id!==value.observationId)fail('stale_observation');this._current(saved.binding);if(this.monotonic()>=saved.deadline)fail('expired_ticket');const cap=saved.row.capabilities[value.operation];if(!cap.enabled)fail(cap.reason);const id=randomUUID(),pair=values(saved.row,value.operation,value.value);this.ticket={id,binding:saved.binding,row:saved.row,operation:value.operation,value:value.value,deadline:this.monotonic()+300000};return {kind:'group-admin-preview',ticketId:id,accountId:saved.binding.accountId,...scope(saved.row),operation:value.operation,role:saved.row.selfRole,...pair,expiresAt:this.now()+300000,cacheMayBeStale:true,automaticRetry:false,rejectRejoinUnobservable:value.operation==='kick'};}
 async confirm(value,{signal}={}){exact(value,['ticketId']);if(!uuid(value.ticketId))fail('invalid_request');if(this.operation)fail('operation_in_progress');const ticket=this.ticket;if(!ticket||ticket.id!==value.ticketId)fail('stale_ticket');this._clear();return this._run(signal,async(combined,op)=>{
  let invoked=false;const result=(outcome,code,observed={state:'unavailable',source:'bridge-observed'})=>({kind:'group-admin-change',ticketId:ticket.id,accountId:ticket.binding.accountId,...scope(ticket.row),operation:ticket.operation,outcome,...(outcome==='accepted'?{acknowledgement:acknowledgementFor(ticket.operation)}:{code}),observation:observed,automaticRetry:false,automaticRestore:false,rejectRejoinUnobservable:ticket.operation==='kick',...(ticket.operation==='kick'?{rejectRejoinRequests:ticket.value}:{})});
  const current=()=>{this._current(ticket.binding,combined);if(this.monotonic()>=ticket.deadline)fail('expired_ticket');};
  try{current();invoked=true;const receipt=await this.transport.write(ticket.binding,{row:ticket.row,operation:ticket.operation,value:ticket.value},{signal:combined,assertCurrent:current});if(!plain(receipt)||!['accepted','unknown','not_submitted'].includes(receipt.outcome)||receipt.outcome==='accepted'&&receipt.acknowledgement!==acknowledgementFor(ticket.operation))fail('change_unknown');if(receipt.outcome==='not_submitted')return result('not_submitted',op.timedOut?'timeout':safeCode(receipt));if(receipt.outcome==='unknown')return result('unknown','change_unknown');let observed={state:'unavailable',source:'bridge-observed'};try{this._current(ticket.binding,combined);const raw=await this.transport.observe(ticket.binding,{row:ticket.row,operation:ticket.operation,value:ticket.value},{signal:combined,assertCurrent:()=>this._current(ticket.binding,combined)});this._current(ticket.binding,combined);observed=observationProjection(raw,ticket.operation);}catch{}return result('accepted',null,observed);}catch(error){return result(invoked?'unknown':'not_submitted',invoked?'change_unknown':op.timedOut?'timeout':safeCode(error));}
 });}
 discardPreview(){this.ticket=null;}
 dismiss(){this._clear();}
 async close(){this.closed=true;this._clear();const op=this.operation;if(op){op.controller.abort();await op.promise.catch(()=>{});}return {closed:true};}
}
function projectedValue(raw,operation,phase){
 const keys=operation==='card'?['card']:operation==='ban'?[phase==='after'?'duration':'muteUntil']:operation==='whole-ban'?['enabled']:operation==='admin'?['role']:operation==='kick'?(phase==='after'?['present','rejectRejoinRequests']:['present']):(phase==='after'?['member','dissolve']:['member']);exact(raw,keys);
 if(operation==='card')return {card:card(raw.card)};
 if(operation==='ban'){const key=keys[0];if(!Number.isSafeInteger(raw[key])||raw[key]<0||phase==='after'&&raw[key]>MAX_BAN_SECONDS)fail('invalid_response');return {[key]:raw[key]};}
 if(operation==='admin'){if(!role(raw.role))fail('invalid_response');return {role:raw.role};}
 if(keys.some(key=>typeof raw[key]!=='boolean'))fail('invalid_response');return Object.fromEntries(keys.map(key=>[key,raw[key]]));
}
function observationProjection(raw,operation){if(!plain(raw)||raw.source!=='bridge-observed')fail('invalid_response');if(raw.state==='unavailable')return {state:'unavailable',source:'bridge-observed'};if(!['observed_match','observed_different','observed_value'].includes(raw.state)||raw.cacheMayBeStale!==true||typeof raw.fetchedAt!=='string'||!Number.isFinite(Date.parse(raw.fetchedAt)))fail('invalid_response');return {state:raw.state,value:projectedValue(raw.value,operation,'observed'),source:'bridge-observed',cacheMayBeStale:true,fetchedAt:raw.fetchedAt};}
module.exports={QQGroupAdmin,GroupAdminError,safeCode,plain,uuid,groupId,exact,card,inputValue,previewInput,observation,capabilities,values,compare,scope,OPS,acknowledgementFor,projectedValue,observationProjection};
