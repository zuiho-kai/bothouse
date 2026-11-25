'use strict';
// Connection-owned, bounded friend-request collection. Flags remain in main memory.
// Accepting a request does not change the configured owner or message routing.
const {randomUUID,createHash}=require('node:crypto');
const {performance}=require('node:perf_hooks');
const CODES=new Set(['invalid_request','disconnected','changed','closed','expired','stale_request','operation_in_progress','cancelled','unknown','invalid_response','account_changed','account_offline','status_unverified']);
class QQFriendRequestsError extends Error {
  constructor(code){super('The friend-request operation could not be verified.');this.code=CODES.has(code)?code:'invalid_response';}
}
const fail=code=>{throw new QQFriendRequestsError(code);};
const codeOf=error=>CODES.has(error?.code)?error.code:'invalid_response';
const UUID=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const id=value=>typeof value==='string'&&/^[1-9]\d{4,14}$/.test(value)&&Number.isSafeInteger(Number(value));
function qq(value){if(typeof value==='number'&&!Number.isSafeInteger(value))return null;const result=String(value);return id(result)?result:null;}
const text=value=>value.replace(/[\p{Cc}\p{Cf}\p{Surrogate}\u2028\u2029]/gu,'').slice(0,500).replace(/[\uD800-\uDBFF]$/u,'');
const hash=value=>createHash('sha256').update(value).digest('hex');
function capture(value){
  value=value&&{...value,connectedAt:value.connectedAt??value.client?.connectedAt};
  if(!value||value.status!=='connected'||value.channel!=='qq'||!id(value.accountId)||!id(value.ownerId)||value.accountId===value.ownerId||typeof value.scopeId!=='string'||!value.scopeId||value.scopeId.length>256||!Number.isSafeInteger(value.generation)||!Number.isSafeInteger(value.connectedAt)||value.connectedAt<0||value.connectedAt>8640000000000000)fail('disconnected');
  const client=value.client;if(!client||!client.ready||client.closed||client.socket?.readyState!==1||!Number.isSafeInteger(client.generation)||client.accountId!==value.accountId||client.ownerId!==value.ownerId)fail('disconnected');
  return {client,socket:client.socket,clientGeneration:client.generation,generation:value.generation,scopeId:value.scopeId,accountId:value.accountId,ownerId:value.ownerId,connectedAt:value.connectedAt};
}
const equal=(a,b)=>!!a&&!!b&&Object.keys(a).every(key=>a[key]===b[key]);
function syncGuard(fn){const result=fn?.();if(result&&typeof result.then==='function'){Promise.resolve(result).catch(()=>{});fail('invalid_request');}}
function currentBinding(getBinding,expected,signal,assertCurrent){
  if(signal?.aborted)fail('cancelled');syncGuard(assertCurrent);const actual=capture(getBinding());if(expected&&!equal(expected,actual))fail('changed');return actual;
}

// The client owns protocol preflight, the exact write boundary and void replies.
// Its synchronous assertCurrent callback rechecks this inbox/panel before write.
function submitDecision({binding,flag,approve,signal,assertCurrent}){
  if(typeof binding.client.decideFriendRequest!=='function')fail('invalid_request');
  return binding.client.decideFriendRequest({flag,approve},{signal,assertCurrent});
}

class FriendRequestInbox {
  constructor({getBinding,now=Date.now,elapsed=()=>performance.now(),submit=submitDecision,timeoutMs=10000}={}){
    if(typeof getBinding!=='function'||typeof now!=='function'||typeof elapsed!=='function'||typeof submit!=='function'||!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>20000)fail('invalid_request');
    Object.assign(this,{getBinding,now,elapsed,submit,timeoutMs});this.binding=null;this.entries=new Map();this.seen=new Map();this.overflow=false;this.closed=false;this.operation=null;
  }
  _clear(){for(const entry of this.entries.values())entry.flag=null;this.entries.clear();this.seen.clear();this.overflow=false;}
  _current(){
    if(this.closed)fail('closed');let value;
    try{value=capture(this.getBinding());}catch(error){this._clear();this.binding=null;this.operation?.controller.abort();throw error;}
    if(!equal(this.binding,value)){this._clear();this.operation?.controller.abort();this.binding=value;}return value;
  }
  _prune(){for(const [key,row]of this.entries)if(this.elapsed()>=row.deadline){row.flag=null;this.entries.delete(key);}}
  receive(event,source){
    let binding;try{binding=this._current();}catch{return false;}
    if(source?.client!==binding.client||source.generation!==binding.clientGeneration||!event||event.post_type!=='request'||event.request_type!=='friend'||event.group_id!==undefined||event.echo!==undefined||qq(event.self_id)!==binding.accountId)return false;
    const applicantId=qq(event.user_id),at=event.time*1000,wall=this.now();
    if(!applicantId||applicantId===binding.accountId||!Number.isSafeInteger(event.time)||!Number.isSafeInteger(at)||at<binding.connectedAt-1000||at>wall+60000||at<wall-5*60*1000||typeof event.comment!=='string'||event.comment.length>2048||typeof event.flag!=='string'||!event.flag||event.flag.length>512||/[\p{Cc}\p{Cf}\p{Surrogate}]/u.test(event.flag))return false;
    this._prune();const key=hash(event.flag),seen=this.seen.get(key);
    if(seen){if(seen.applicantId!==applicantId){for(const [ticket,row]of this.entries)if(row.flagKey===key){row.flag=null;this.entries.delete(ticket);}seen.conflict=true;}return false;}
    if(this.seen.size>=256||this.entries.size>=100){this.overflow=true;return false;}
    const requestId=randomUUID();this.seen.set(key,{applicantId,conflict:false});this.entries.set(requestId,{requestId,applicantId,comment:text(event.comment),flag:event.flag,flagKey:key,receivedAt:new Date(wall).toISOString(),expiresAt:new Date(wall+5*60*1000).toISOString(),deadline:this.elapsed()+5*60*1000,binding});return true;
  }
  list(){
    let binding;try{binding=this._current();}catch{return {source:'current-connection-events',complete:false,available:false,overflow:false,items:[]};}this._prune();
    return {source:'current-connection-events',complete:false,available:true,accountId:binding.accountId,connectedAt:new Date(binding.connectedAt).toISOString(),overflow:this.overflow,busy:!!this.operation,
      items:[...this.entries.values()].map(({requestId,applicantId,comment,receivedAt,expiresAt})=>({requestId,applicantId,comment,receivedAt,expiresAt}))};
  }
  decide(value,{signal,assertCurrent=()=>{}}={}){
    if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join()!=='approve,requestId'||typeof value.approve!=='boolean'||(typeof value.requestId!=='string'||!UUID.test(value.requestId))||typeof assertCurrent!=='function')return Promise.reject(Object.assign(Error('Invalid request'),{code:'invalid_request'}));
    if(this.operation)return Promise.reject(Object.assign(Error('Operation in progress'),{code:'operation_in_progress'}));
    let binding;try{binding=this._current();}catch(error){return Promise.reject(error);}const row=this.entries.get(value.requestId);if(!row)return Promise.reject(Object.assign(Error('Stale request'),{code:'stale_request'}));
    this.entries.delete(row.requestId);const flag=row.flag;row.flag=null;
    const controller=new AbortController(),combined=signal?AbortSignal.any([signal,controller.signal]):controller.signal,op={controller,promise:null};this.operation=op;
    const result=(outcome,code)=>({kind:'friend-request',accountId:binding.accountId,requestId:row.requestId,approve:value.approve,outcome,...(code?{code}:{})}),timer=setTimeout(()=>controller.abort(),this.timeoutMs);
    op.promise=Promise.resolve().then(async()=>{
      let invoked=false;
      try{
        const check=()=>{if(this.closed)fail('closed');if(this.elapsed()>=row.deadline)fail('expired');if(this.seen.get(row.flagKey)?.conflict)fail('changed');currentBinding(this.getBinding,row.binding,combined,assertCurrent);};check();
        invoked=true;const decision=await this.submit({binding,getBinding:this.getBinding,flag,approve:value.approve,signal:combined,assertCurrent:check});
        if(!decision||!['accepted','unknown','not_submitted'].includes(decision.outcome))return result('unknown','unknown');
        return result(decision.outcome,decision.outcome==='accepted'?null:decision.outcome==='unknown'?'unknown':codeOf(decision));
      }catch(error){return invoked?result('unknown','unknown'):result('not_submitted',codeOf(error));}
    }).finally(()=>{clearTimeout(timer);if(this.operation===op)this.operation=null;});return op.promise;
  }
  async close(){this.closed=true;this._clear();this.binding=null;const op=this.operation;if(op){op.controller.abort();await op.promise.catch(()=>{});}return {closed:true};}
}
module.exports={FriendRequestInbox,QQFriendRequestsError,codeOf};
