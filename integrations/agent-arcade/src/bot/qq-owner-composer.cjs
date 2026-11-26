'use strict';
// Original manual-text boundary. No model, incoming-message context token,
// autonomous-social policy, media parser, or renderer-selected peer is used.
const {createHash}=require('node:crypto');
const {validateQQOwner}=require('./qq.cjs');
const {plain,exact,uuid}=require('./qq-owner-history.cjs');
const LIMITS=Object.freeze({text:4000,submissions:1024});
const CODES=new Set(['invalid_request','invalid_response','unconfigured','changed','cancelled','closed','disconnected','account_changed','account_offline','status_unverified','owner_not_friend','operation_in_progress','timeout','unavailable','unauthorized','connect_failed','connect_timeout','login_required','heartbeat_timeout','submission_conflict','submission_limit','submission_not_found','bridge_refused']);
const aliases=Object.freeze({aborted:'cancelled',action_timeout:'timeout',request_limit:'operation_in_progress',action_failed:'bridge_refused'});
function safeCode(error){const raw=error?.code,code=typeof raw==='string'&&Object.hasOwn(aliases,raw)?aliases[raw]:raw;return CODES.has(code)?code:'unavailable';}
class QQOwnerComposerError extends Error{constructor(code){code=CODES.has(code)?code:'unavailable';super(`QQ owner text unavailable (${code}).`);this.code=code;}}
const fail=code=>{throw new QQOwnerComposerError(code);};
function request(input,query=false){
 exact(input,['accountId','panelId','submissionId',...(query?[]:['text'])]);
 if(typeof input.accountId!=='string'||!/^[a-zA-Z0-9-]{1,64}$/.test(input.accountId)||!uuid(input.panelId)||!uuid(input.submissionId))fail('invalid_request');
 if(!query&&(typeof input.text!=='string'||!input.text.trim()||input.text.length>LIMITS.text||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(input.text)))fail('invalid_request');
 return input;
}
function identity(value){try{return validateQQOwner(value);}catch{fail('invalid_response');}}
function messageId(value){const id=Number.isSafeInteger(value)?String(value):value;if(typeof id!=='string'||!/^(-[1-9]\d{0,9}|0|[1-9]\d{0,9})$/.test(id)||Number(id)<-2147483648||Number(id)>2147483647)fail('invalid_response');return id;}
function guard(binding,signal,assertCurrent){
 if(signal?.aborted)fail('cancelled');const result=assertCurrent();if(result?.then){result.catch?.(()=>{});fail('invalid_request');}
 const c=binding.client;if(c?.accountId!==binding.accountId||c.expectedAccountId!==binding.accountId||c.ownerId!==binding.ownerId)fail('account_changed');
 if(!c.ready||c.closed||c.socket!==binding.socket||c.generation!==binding.clientGeneration||c.socket?.readyState!==1)fail('disconnected');
}
class QQOwnerComposerTransport{
 async send(binding,{text,signal,assertCurrent,onAttempt}){
  if(typeof text!=='string'||!text.trim()||text.length>LIMITS.text||typeof assertCurrent!=='function'||typeof onAttempt!=='function')fail('invalid_request');
  const check=()=>guard(binding,signal,assertCurrent),read=async(action,params)=>{check();const value=await binding.client._request(action,params,signal);check();return value;};
  const login=await read('get_login_info',{});if(!plain(login)||identity(login.user_id)!==binding.accountId)fail('account_changed');
  const status=await read('get_status',{});if(!plain(status)||typeof status.online!=='boolean'||status.good!==undefined&&typeof status.good!=='boolean')fail('status_unverified');if(!status.online||status.good===false)fail('account_offline');
  const friends=await read('get_friend_list',{no_cache:false});if(!Array.isArray(friends)||friends.length>10000)fail('invalid_response');const ids=new Set();for(const friend of friends){if(!plain(friend))fail('invalid_response');const id=identity(friend.user_id);if(ids.has(id))fail('invalid_response');ids.add(id);}if(!ids.has(binding.ownerId))fail('owner_not_friend');
  // Recheck actual identity after the friendship observation. The upstream
  // does not provide an atomic identity+send transaction; do not claim one.
  const latest=await read('get_login_info',{});if(!plain(latest)||identity(latest.user_id)!==binding.accountId)fail('account_changed');
  check();const params={user_id:Number(binding.ownerId),message:[{type:'text',data:{text}}],auto_escape:true};
  // Conservative write boundary immediately before _request. Even an error
  // returned by the bridge may follow a real send; never call it not-submitted.
  const marked=onAttempt();if(marked?.then){marked.catch?.(()=>{});fail('invalid_request');}
  const result=await binding.client._request('send_private_msg',params,signal);
  // A correlated known receipt remains a fact if the panel closes meanwhile.
  // Do not turn a late, valid receipt into a retryable failure.
  if(!plain(result))fail('invalid_response');return {messageId:messageId(result.message_id)};
 }
}
function scope(input,binding){return JSON.stringify([input.accountId,input.panelId,binding.qqAccountId,binding.ownerId]);}
function publicRecord(record){return {kind:'owner-text-submission',submissionId:record.id,outcome:record.outcome,messageId:record.messageId,code:record.code};}
class QQOwnerSubmissionBook{
 constructor(){this.records=new Map();}
 submit(input,binding,run){
  // JSON encoding preserves distinct unpaired UTF-16 code units as escapes;
  // plain UTF-8 hashing would collapse them to the same replacement character.
  request(input);const key=scope(input,binding),digest=createHash('sha256').update(JSON.stringify(input.text),'utf8').digest('hex'),old=this.records.get(input.submissionId);
  if(old){if(old.scope!==key||old.digest!==digest)fail('submission_conflict');return old.promise;}
  if(this.records.size>=LIMITS.submissions)fail('submission_limit');
  const record={id:input.submissionId,scope:key,digest,outcome:'pending',messageId:null,code:null,attempted:false,promise:null};this.records.set(record.id,record);
  // Acquire/attach the owning session synchronously, before close can run.
  record.promise=(async()=>{try{const result=await run(()=>{record.attempted=true;});record.messageId=messageId(result?.messageId);record.outcome='accepted';}catch(error){record.outcome=record.attempted?'unknown':'not_submitted';record.code=safeCode(error);}return publicRecord(record);})();
  return record.promise;
 }
 query(input,binding){request(input,true);const record=this.records.get(input.submissionId);if(!record||record.scope!==scope(input,binding))fail('submission_not_found');return publicRecord(record);}
}
async function ownerComposerResult(input,operation){try{return {ok:true,...await operation()};}catch(error){return {ok:false,...(typeof input?.accountId==='string'&&/^[a-zA-Z0-9-]{1,64}$/.test(input.accountId)?{accountId:input.accountId}:{}),...(uuid(input?.panelId)?{panelId:input.panelId}:{}),...(uuid(input?.submissionId)?{submissionId:input.submissionId}:{}),code:safeCode(error)};}}
module.exports={QQOwnerComposerTransport,QQOwnerSubmissionBook,QQOwnerComposerError,ownerComposerResult,request,LIMITS,safeCode};
