'use strict';
// Original self-profile transaction. No caller supplies a QQ target.
const {randomUUID}=require('node:crypto');
const FIELDS=Object.freeze(['nickname','signature']);
const CODES=new Set(['invalid_request','invalid_value','original_unsupported','signature_unavailable','profile_rejected','field_unavailable','disconnected','changed','cancelled','timeout','operation_in_progress','closed','invalid_response','unavailable','account_mismatch','account_changed','account_offline','status_unverified','bridge_unhealthy','action_failed','baseline_changed','stale_observation','stale_ticket','expired_ticket','change_unknown']);
class SelfProfileError extends Error{constructor(code){const safe=CODES.has(code)?code:'unavailable';super(`QQ self profile operation failed (${safe}).`);this.code=safe;}}
const fail=code=>{throw new SelfProfileError(code);};
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&(Object.getPrototypeOf(value)===Object.prototype||Object.getPrototypeOf(value)===null);
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(value);
const qq=value=>typeof value==='string'&&/^[1-9]\d{4,14}$/.test(value)&&Number.isSafeInteger(Number(value));
function safeCode(error){return new SelfProfileError(({aborted:'cancelled',action_timeout:'timeout',request_limit:'operation_in_progress',login_required:'account_offline'})[error?.code]||error?.code).code;}
function valueFor(field,value){
  const max=field==='nickname'?60:field==='signature'?120:0;
  if(!max||typeof value!=='string'||value.length>max*2||[...value].length>max||/[\p{Cc}\p{Cf}\u2028\u2029]/u.test(value)||/[\uD800-\uDFFF]/u.test(value)||(field==='nickname'&&!value.trim()))fail('invalid_value');
  return value; // No truncation, normalization, or whitespace rewriting.
}
const BINDING_KEYS=['profile','profileId','generation','characterId','runtime','installation','runtimeEpoch','bridgeRevision','endpointId','client','socket','clientGeneration','accountId'];
function capture(value){
  if(!plain(value)||!value.profile||!value.runtime||!value.installation||!value.client||!qq(value.accountId)||typeof value.profileId!=='string'||!value.profileId||typeof value.characterId!=='string'||!value.characterId||typeof value.bridgeRevision!=='string'||!value.bridgeRevision||typeof value.endpointId!=='string'||!value.endpointId||!Number.isSafeInteger(value.generation)||value.generation<0||!Number.isSafeInteger(value.runtimeEpoch)||value.runtimeEpoch<0)fail('changed');
  const client=value.client;
  if(client.accountId!==value.accountId||client.expectedAccountId!==value.accountId)fail('account_mismatch');
  if(!client.ready||client.closed||client.socket?.readyState!==1||!Number.isSafeInteger(client.generation))fail('disconnected');
  return Object.freeze(Object.fromEntries(BINDING_KEYS.map(key=>[key,key==='socket'?client.socket:key==='clientGeneration'?client.generation:value[key]])));
}
const same=(a,b)=>BINDING_KEYS.every(key=>a[key]===b[key]);
const acknowledgementFor=field=>field==='nickname'?'bridge-reported-success':'bridge-action-only';
const disclosureFor=field=>field==='nickname'?{mutationScope:'profile-save',preservedFieldsSource:'bridge-read-at-submit',preservationGuaranteed:false}:{};
function exactKeys(value,keys){if(!plain(value)||Object.keys(value).sort().join('|')!==[...keys].sort().join('|'))fail('invalid_request');}
function observation(raw,accountId){
  if(!plain(raw)||raw.accountId!==accountId||raw.source!=='bridge-observed'||typeof raw.fetchedAt!=='string'||!Number.isFinite(Date.parse(raw.fetchedAt)))fail('invalid_response');
  const values={},capabilities={};
  for(const field of FIELDS){const row=raw[field];if(!plain(row)||typeof row.supported!=='boolean')fail('invalid_response');if(row.supported){try{values[field]=valueFor(field,row.value);}catch{fail('invalid_response');}capabilities[field]=true;}else{if(row.value!==undefined||row.reason!=='original_unsupported')fail('invalid_response');values[field]=null;capabilities[field]=false;}}
  const nicknameEditable=capabilities.nickname&&capabilities.signature;
  return {accountId,values,capabilities:{readable:{...capabilities,avatar:false},editable:{nickname:nicknameEditable,signature:capabilities.signature,avatar:false}},...(!nicknameEditable?{nicknameUnavailableReason:!capabilities.nickname?'original_unsupported':'signature_unavailable'}:{}),source:'bridge-observed',fetchedAt:raw.fetchedAt,cacheMayBeStale:true};
}
class QQSelfProfile {
  constructor({getBinding,transport={read:(binding,options)=>binding.client.readSelfProfile(options.signal,{assertCurrent:options.assertCurrent}),write:(binding,change,options)=>change.field==='nickname'?binding.client.setSelfNickname(change.value,options.signal,{expectedValue:change.expectedValue,expectedSignature:change.expectedSignature,assertCurrent:options.assertCurrent}):binding.client.setSelfSignature(change.value,options.signal,{expectedValue:change.expectedValue,assertCurrent:options.assertCurrent})},now=Date.now,monotonic=()=>performance.now(),timeoutMs=20000}={}){
    if(typeof getBinding!=='function'||typeof transport?.read!=='function'||typeof transport?.write!=='function'||typeof now!=='function'||typeof monotonic!=='function'||!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>30000)fail('invalid_request');
    Object.assign(this,{getBinding,transport,now,monotonic,timeoutMs});this.baseline=null;this.ticket=null;this.operation=null;this.closed=false;
  }
  _current(expected,signal){
    if(signal?.aborted)fail('cancelled');if(this.closed)fail('closed');
    try{const current=capture(this.getBinding());if(expected&&!same(current,expected))fail('changed');return current;}catch(error){this._clear();throw new SelfProfileError(safeCode(error));}
  }
  _clear(){this.baseline=null;this.ticket=null;}
  _run(signal,fn){
    if(this.operation)fail('operation_in_progress');const controller=new AbortController(),combined=signal?AbortSignal.any([signal,controller.signal]):controller.signal,op={controller,timedOut:false,promise:null};this.operation=op;
    const timer=setTimeout(()=>{op.timedOut=true;controller.abort();},this.timeoutMs);
    op.promise=Promise.resolve().then(()=>fn(combined,op)).finally(()=>{clearTimeout(timer);if(this.operation===op)this.operation=null;});return op.promise;
  }
  snapshot(){let available=true;try{this._current(this.ticket?.binding||this.baseline?.binding);}catch{this._clear();available=false;}return {busy:!!this.operation,available};}
  async read({signal}={}){
    if(this.operation)fail('operation_in_progress');this._clear();const binding=this._current(null,signal);
    return this._run(signal,async(combined,op)=>{try{
      const raw=await this.transport.read(binding,{signal:combined,assertCurrent:()=>this._current(binding,combined)});this._current(binding,combined);
      const row=observation(raw,binding.accountId),id=randomUUID();this.baseline={id,binding,row,deadline:this.monotonic()+300000};
      return {kind:'self-profile',observationId:id,...row};
    }catch(error){this._clear();throw new SelfProfileError(op.timedOut?'timeout':safeCode(error));}});
  }
  preview(value){
    exactKeys(value,['observationId','field','value']);if(!uuid(value.observationId)||!FIELDS.includes(value.field))fail('invalid_request');
    if(this.operation)fail('operation_in_progress');const before=this.baseline;this.ticket=null;
    if(!before||before.id!==value.observationId)fail('stale_observation');this._current(before.binding);if(this.monotonic()>=before.deadline)fail('expired_ticket');
    if(!before.row.capabilities.readable[value.field])fail('original_unsupported');if(!before.row.capabilities.editable[value.field])fail(value.field==='nickname'?'signature_unavailable':'field_unavailable');const target=valueFor(value.field,value.value),id=randomUUID();
    this.ticket={id,binding:before.binding,field:value.field,before:before.row.values[value.field],expectedSignature:before.row.values.signature,target,deadline:this.monotonic()+300000};
    return {kind:'self-profile-preview',ticketId:id,accountId:before.binding.accountId,field:value.field,before:this.ticket.before,after:target,expiresAt:this.now()+300000,cacheMayBeStale:true,automaticRetry:false,...disclosureFor(value.field)};
  }
  async confirm(value,{signal}={}){
    exactKeys(value,['ticketId']);if(!uuid(value.ticketId))fail('invalid_request');if(this.operation)fail('operation_in_progress');
    const ticket=this.ticket;if(!ticket||ticket.id!==value.ticketId)fail('stale_ticket');this._clear();
    return this._run(signal,async(combined,op)=>{
      let invoked=false;
      const result=(outcome,code,observed={state:'unavailable',source:'bridge-observed'})=>({kind:'self-profile-change',ticketId:ticket.id,accountId:ticket.binding.accountId,field:ticket.field,outcome,...(outcome==='accepted'?{acknowledgement:acknowledgementFor(ticket.field)}:{}),...(code?{code}:{}),observation:observed,automaticRetry:false,...disclosureFor(ticket.field)});
      try{
        if(this.monotonic()>=ticket.deadline)fail('expired_ticket');this._current(ticket.binding,combined);
        invoked=true;const receipt=await this.transport.write(ticket.binding,{field:ticket.field,value:ticket.target,expectedValue:ticket.before,...(ticket.field==='nickname'?{expectedSignature:ticket.expectedSignature}:{})},{signal:combined,assertCurrent:()=>this._current(ticket.binding,combined)});
        if(!plain(receipt)||!['accepted','unknown','not_submitted','rejected'].includes(receipt.outcome)||receipt.outcome==='accepted'&&receipt.acknowledgement!==acknowledgementFor(ticket.field)||receipt.outcome==='rejected'&&(ticket.field!=='nickname'||receipt.code!=='profile_rejected'))fail('change_unknown');
        if(receipt.outcome==='not_submitted')return result('not_submitted',op.timedOut?'timeout':safeCode(receipt));
        if(receipt.outcome==='unknown')return result('unknown','change_unknown');
        if(receipt.outcome==='rejected')return result('rejected','profile_rejected');
        // A real acceptance survives later close/navigation. Readback is separate
        // and bounded to one request, with no automatic write or reconciliation.
        let observed={state:'unavailable',source:'bridge-observed'};
        try{this._current(ticket.binding,combined);const raw=await this.transport.read(ticket.binding,{signal:combined,assertCurrent:()=>this._current(ticket.binding,combined)});this._current(ticket.binding,combined);const row=observation(raw,ticket.binding.accountId);if(row.capabilities.readable[ticket.field])observed={state:row.values[ticket.field]===ticket.target?'observed_match':'observed_different',value:row.values[ticket.field],source:'bridge-observed',fetchedAt:row.fetchedAt,cacheMayBeStale:true};}catch{}
        return result('accepted',null,observed);
      }catch(error){return result(invoked?'unknown':'not_submitted',invoked?'change_unknown':op.timedOut?'timeout':safeCode(error));}
    });
  }
  discardPreview(){this.ticket=null;}
  dismiss(){this._clear();}
  async close(){this.closed=true;this._clear();const op=this.operation;if(op){op.controller.abort();await op.promise.catch(()=>{});}return {closed:true};}
}
module.exports={QQSelfProfile,SelfProfileError,valueFor,safeCode,capture,observation,acknowledgementFor,disclosureFor};
