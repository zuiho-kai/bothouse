'use strict';
// Original fixed-owner contact editor. Private baselines stay in memory; a
// bridge-cache comparison is not a remote atomic compare-and-set guarantee.
const {randomUUID}=require('node:crypto');
const CODES=new Set(['invalid_request','invalid_remark','original_unsupported','owner_not_found','invalid_response','response_too_large','account_mismatch','account_changed','account_offline','status_unverified','bridge_unhealthy','disconnected','changed','cancelled','timeout','operation_in_progress','stale_ticket','expired_ticket','baseline_changed','restore_unavailable','change_unknown','action_failed','unavailable','closed']);
class QQOwnerRemarkError extends Error {
  constructor(code){code=CODES.has(code)?code:'unavailable';super(`QQ owner remark operation failed (${code}).`);this.name=code==='cancelled'?'AbortError':'QQOwnerRemarkError';this.code=code;}
}
const fail=code=>{throw new QQOwnerRemarkError(code);};
function validateRemark(value){
  if(typeof value!=='string'||value.length>120||[...value].length>60||/[\p{Cc}\p{Cf}\u2028\u2029]/u.test(value)||/[\uD800-\uDFFF]/u.test(value))fail('invalid_remark');
  return value;
}
function safeCode(error){return new QQOwnerRemarkError(({aborted:'cancelled',action_timeout:'timeout',invalid_frame:'invalid_response',invalid_login_info:'invalid_response',login_required:'account_offline',request_limit:'operation_in_progress'})[error?.code]||error?.code).code;}
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&(Object.getPrototypeOf(value)===Object.prototype||Object.getPrototypeOf(value)===null);
const qq=id=>typeof id==='string'&&/^[1-9]\d{4,14}$/.test(id)&&Number.isSafeInteger(Number(id));
function capture(value){
  if(!value||value.status!=='connected'||value.channel!=='qq'||!Number.isSafeInteger(value.generation)||value.generation<0||!value.client)fail('disconnected');
  const client=value.client;
  if(typeof value.scopeId!=='string'||!value.scopeId||value.scopeId.length>256||/[\p{Cc}\p{Cf}]/u.test(value.scopeId))fail('invalid_request');
  if(!qq(value.accountId)||!qq(value.ownerId)||value.accountId===value.ownerId||client.ownerId!==value.ownerId||client.accountId!==value.accountId)fail('account_mismatch');
  if(!client.ready||client.closed||client.socket?.readyState!==1||!Number.isSafeInteger(client.generation))fail('disconnected');
  return {client,clientGeneration:client.generation,generation:value.generation,scopeId:value.scopeId,accountId:value.accountId,ownerId:value.ownerId,role:typeof value.role==='string'?value.role.replace(/[\p{Cc}\p{Cf}]/gu,'').slice(0,64):''};
}
const equal=(a,b)=>a.client===b.client&&a.clientGeneration===b.clientGeneration&&a.generation===b.generation&&a.scopeId===b.scopeId&&a.accountId===b.accountId&&a.ownerId===b.ownerId&&a.role===b.role;
function request(value,edit){
  const keys=edit?['ticketId','remark']:['ticketId'];
  if(!plain(value)||Object.keys(value).length!==keys.length||keys.some(k=>!Object.hasOwn(value,k))||typeof value.ticketId!=='string'||!/^[a-f0-9-]{36}$/.test(value.ticketId))fail('invalid_request');
  if(edit)validateRemark(value.remark);return value.ticketId;
}
const unavailable=()=>({state:'unavailable',source:'bridge-cache'});
function observation(row,current){
  if(!plain(row)||row.accountId!==current.accountId||row.ownerId!==current.ownerId||row.source!=='bridge-cache'||typeof row.nickname!=='string'||row.nickname.length>128||typeof row.fetchedAt!=='string'||!Number.isFinite(Date.parse(row.fetchedAt)))fail('invalid_response');
  if(row.supported===false&&row.reason==='original_unsupported'&&row.remark===undefined)return {nickname:row.nickname,fetchedAt:row.fetchedAt,source:'bridge-cache',withheld:true};
  try{validateRemark(row.remark);}catch{fail('invalid_response');}
  return {nickname:row.nickname,remark:row.remark,fetchedAt:row.fetchedAt,source:'bridge-cache'};
}
class QQOwnerRemark {
  constructor({getBinding,now=Date.now,monotonic=()=>performance.now(),onChange=()=>{},readTimeoutMs=10000,writeTimeoutMs=20000}={}){
    if(typeof getBinding!=='function'||typeof now!=='function'||typeof monotonic!=='function'||typeof onChange!=='function'||![readTimeoutMs,writeTimeoutMs].every(n=>Number.isSafeInteger(n)&&n>=1&&n<=30000))fail('invalid_request');
    Object.assign(this,{getBinding,now,monotonic,onChange,readTimeoutMs,writeTimeoutMs});this.ticket=null;this.lastChange=null;this.operation=null;this.closed=false;
  }
  _notify(){try{this.onChange();}catch{}}
  _expired(ticket){return this.now()>=ticket.expiresAt||this.monotonic()>=ticket.deadline;}
  _current(expected,signal){
    if(signal?.aborted)fail('cancelled');if(this.closed)fail('closed');
    let current;try{current=capture(this.getBinding());if(expected&&!equal(current,expected))fail('changed');}
    catch(error){this.ticket=null;this.lastChange=null;throw new QQOwnerRemarkError(safeCode(error));}
    return current;
  }
  _prune(){
    try{const current=this._current();if(this.ticket&&(!equal(this.ticket.binding,current)||this._expired(this.ticket)))this.ticket=null;if(this.lastChange&&!equal(this.lastChange.binding,current))this.lastChange=null;return true;}
    catch{this.ticket=null;this.lastChange=null;return false;}
  }
  snapshot(){return {busy:!!this.operation,available:this._prune()};}
  _run(signal,ms,fn){
    if(this.operation)fail('operation_in_progress');
    const controller=new AbortController(),combined=signal?AbortSignal.any([signal,controller.signal]):controller.signal,op={controller,promise:null,timedOut:false};this.operation=op;
    const timer=setTimeout(()=>{op.timedOut=true;controller.abort();},ms);
    op.promise=Promise.resolve().then(()=>fn(combined,op)).finally(()=>{clearTimeout(timer);if(this.operation===op)this.operation=null;this._notify();});this._notify();return op.promise;
  }
  async read({signal}={}){
    if(this.operation)fail('operation_in_progress');this._prune();this.ticket=null;const current=this._current(null,signal);
    return this._run(signal,this.readTimeoutMs,async(combined,op)=>{
      try{
        if(typeof current.client.readOwnerRemark!=='function')fail('unavailable');
        const row=await current.client.readOwnerRemark(combined,{assertCurrent:()=>this._current(current,combined)});this._current(current,combined);
        const observed=observation(row,current),editable=!observed.withheld,restore={available:false};
        let ticket;
        if(editable){
          const change=this.lastChange,canRestore=!!change&&equal(change.binding,current)&&observed.remark===change.target&&change.before!==change.target;
          ticket={id:randomUUID(),binding:current,remark:observed.remark,expiresAt:this.now()+5*60*1000,deadline:this.monotonic()+5*60*1000,restoreChange:canRestore?change:null};
          this.ticket=ticket;if(canRestore){restore.available=true;restore.value=change.before;}
        }
        return {kind:'owner-remark',recipient:{accountId:current.accountId,ownerId:current.ownerId,role:current.role},editable,...(ticket?{ticketId:ticket.id,expiresAt:ticket.expiresAt}:{reason:'original_unsupported'}),observed,restore};
      }catch(error){throw new QQOwnerRemarkError(op.timedOut?'timeout':safeCode(error));}
    });
  }
  set(value,options){return this._write(value,options,false);}
  restore(value,options){return this._write(value,options,true);}
  async _write(value,{signal}={},restore){
    const id=request(value,!restore);if(this.operation)fail('operation_in_progress');if(!this.ticket||this.ticket.id!==id)fail('stale_ticket');
    const ticket=this.ticket;this.ticket=null;
    return this._run(signal,this.writeTimeoutMs,async(combined,op)=>{
      let invoked=false,receipt,target;
      const result=(outcome,code,observed=unavailable())=>({kind:'owner-remark',ticketId:id,outcome,...(code?{code}:{}),observation:observed});
      const remember=()=>{try{this._current(ticket.binding);this.lastChange={binding:ticket.binding,before:ticket.remark,target,outcome:receipt.outcome};}catch{}};
      try{
        const assertCurrent=()=>{if(this._expired(ticket))fail('expired_ticket');return this._current(ticket.binding,combined);};
        assertCurrent();
        if(restore){if(!ticket.restoreChange||ticket.restoreChange!==this.lastChange||ticket.remark!==this.lastChange.target)fail('restore_unavailable');target=this.lastChange.before;}
        else target=value.remark;
        validateRemark(target);const client=ticket.binding.client;if(typeof client.setOwnerRemark!=='function')fail('unavailable');
        invoked=true;receipt=await client.setOwnerRemark(target,combined,{expectedRemark:ticket.remark,assertCurrent});
        if(!plain(receipt)||!['accepted','unknown','not_submitted'].includes(receipt.outcome))fail('change_unknown');
        if(receipt.outcome==='not_submitted')return result('not_submitted',op.timedOut?'timeout':safeCode(receipt));
        remember();if(receipt.outcome==='unknown')return result('unknown','change_unknown');
        // Preserve accepted even if context changed or the cache read fails.
        let observed=unavailable();try{
          this._current(ticket.binding,combined);
          const row=await client.readOwnerRemark(combined,{assertCurrent:()=>this._current(ticket.binding,combined)});this._current(ticket.binding,combined);
          const after=observation(row,ticket.binding);if(!after.withheld)observed={state:after.remark===target?'observed_match':'observed_different',remark:after.remark,fetchedAt:after.fetchedAt,source:'bridge-cache'};
        }catch{}
        return result('accepted',null,observed);
      }catch(error){
        if(invoked){receipt={outcome:'unknown'};remember();return result('unknown','change_unknown');}
        return result('not_submitted',op.timedOut?'timeout':safeCode(error));
      }
    });
  }
  async close(){this.closed=true;this.ticket=null;this.lastChange=null;const op=this.operation;if(op){op.controller.abort();await op.promise.catch(()=>{});}this._notify();return {closed:true};}
}
module.exports={QQOwnerRemark,QQOwnerRemarkError,validateRemark,safeCode};
