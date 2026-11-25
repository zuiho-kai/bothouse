'use strict';
// Original, fixed self-avatar protocol. No arbitrary targets, URLs or actions.
const {validateQQOwner}=require('./qq.cjs');
const LIMITS=Object.freeze({maxInputBytes:8388608,maxPixels:16777216,maxOutputBytes:4194304,maxEdge:2048,squareOnly:true});
const CODES=new Set(['invalid_request','unconfigured','changed','cancelled','closed','disconnected','operation_in_progress','invalid_response','account_changed','account_mismatch','account_offline','status_unverified','bridge_unhealthy','connect_failed','connect_timeout','unauthorized','timeout','stale_ticket','expired_ticket','change_unknown','image_too_large','image_invalid','image_format','image_animated','image_not_square','unsafe_file','file_changed','file_unavailable','decoder_unavailable','upload_store_full','upload_store_unavailable','upload_file_changed','cleanup_incomplete','avatar_unavailable']);
class QQAvatarError extends Error{constructor(code){const fixed=CODES.has(code)?code:'avatar_unavailable';super(`QQ avatar operation failed (${fixed}).`);this.code=fixed;}}
const codeOf=error=>new QQAvatarError(({aborted:'cancelled',action_timeout:'timeout'})[error?.code]||error?.code).code;
const fail=code=>{throw new QQAvatarError(code);};
const plain=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
function guard(binding,signal,assertCurrent){
 if(typeof assertCurrent!=='function'||!binding?.client||typeof binding.client._request!=='function')fail('invalid_request');
 return ()=>{if(signal?.aborted)fail('cancelled');const result=assertCurrent();if(result?.then){result.catch?.(()=>{});fail('invalid_request');}const c=binding.client;if(c.accountId!==binding.accountId||c.expectedAccountId!==binding.accountId)fail('account_changed');if(c.generation!==binding.clientGeneration||c.socket!==binding.socket||!c.ready||c.closed||c.socket?.readyState!==1)fail('disconnected');};
}
async function identity(binding,{signal,assertCurrent}={}){
 const check=guard(binding,signal,assertCurrent);check();const login=await binding.client._request('get_login_info',{},signal);check();let actual;
 try{actual=validateQQOwner(login?.user_id);}catch{fail('invalid_response');}if(actual!==binding.accountId)fail('account_changed');
 const status=await binding.client._request('get_status',{},signal);check();if(!plain(status)||typeof status.online!=='boolean')fail('status_unverified');if(!status.online)fail('account_offline');if(status.good===false)fail('bridge_unhealthy');
 return {accountId:actual};
}
async function submitAvatar(binding,upload,{signal,assertCurrent}={}){
 let submitted=false;
 try{
  const check=guard(binding,signal,assertCurrent);check();
  // The store capability, not a renderer path, owns the file. Marking attempted
  // is durable before the request; a crash in this interval remains uncertain.
  upload.assertIntact();upload.markAttempted();upload.assertIntact();check();
  submitted=true;const receipt=await binding.client._request('set_qq_avatar',{file:upload.file},signal);
  // This pinned handler explicitly returns null AFTER checking native result=0.
  // Unlike void handlers, an omitted data field is not an accepted receipt.
  if(receipt!==null)fail('change_unknown');
  return {outcome:'accepted',acknowledgement:'bridge-reported-success'};
 }catch(error){return {outcome:submitted?'unknown':'not_submitted',code:submitted?'change_unknown':codeOf(error)};}
}
module.exports={QQAvatarError,LIMITS,codeOf,fail,plain,uuid,identity,submitAvatar};
