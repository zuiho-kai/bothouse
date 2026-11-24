'use strict';
// Original protocol adapter over the existing QQClient's bounded, echo-matched
// transport. No lifecycle, connection, arbitrary action, or target API.
const {SelfProfileError,valueFor,safeCode}=require('./qq-self-profile.cjs');
const {validateQQOwner}=require('./qq.cjs');
const fail=code=>{throw new SelfProfileError(code);};
const plain=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
function checkedGuard(binding,signal,assertCurrent){
 if(typeof assertCurrent!=='function'||!binding?.client||typeof binding.client._request!=='function')fail('invalid_request');
 return ()=>{
  if(signal?.aborted)fail('cancelled');
  const result=assertCurrent();if(result&&typeof result.then==='function'){result.catch(()=>{});fail('invalid_request');}
  const c=binding.client;if(c.accountId!==binding.accountId||c.expectedAccountId!==binding.accountId)fail('account_changed');
  if(c.socket!==binding.socket||c.generation!==binding.clientGeneration||!c.ready||c.closed||c.socket?.readyState!==1)fail('disconnected');
 };
}
class QQSelfProfileTransport {
 constructor({now=Date.now}={}){if(typeof now!=='function')fail('invalid_request');this.now=now;}
 async _identity(binding,signal,check){
  check();const login=await binding.client._request('get_login_info',{},signal);check();let accountId;
  try{accountId=validateQQOwner(login?.user_id);}catch{fail('invalid_response');}if(accountId!==binding.accountId)fail('account_changed');
  const status=await binding.client._request('get_status',{},signal);check();if(!plain(status)||typeof status.online!=='boolean')fail('status_unverified');if(!status.online)fail('account_offline');if(status.good===false)fail('bridge_unhealthy');
 }
 async read(binding,{signal,assertCurrent}={}){
  const check=checkedGuard(binding,signal,assertCurrent);
  try{
   await this._identity(binding,signal,check);
   const raw=await binding.client._request('get_stranger_info',{user_id:binding.accountId,no_cache:true},signal);check();let accountId;
   try{accountId=validateQQOwner(raw?.user_id);}catch{fail('invalid_response');}if(accountId!==binding.accountId)fail('account_changed');
   if(!plain(raw))fail('invalid_response');
   const supported=(field,value)=>{try{return {supported:true,value:valueFor(field,value)};}catch{return {supported:false,reason:'original_unsupported'};}};
   const nickname=supported('nickname',raw.nickname),signature=supported('signature',raw.long_nick);
   await this._identity(binding,signal,check);check();
   return {accountId:binding.accountId,nickname,signature,source:'bridge-observed',fetchedAt:new Date(this.now()).toISOString()};
  }catch(error){throw new SelfProfileError(safeCode(error));}
 }
 async write(binding,value,{signal,assertCurrent}={}){
  let submitted=false;
  try{
   if(!plain(value)||!['nickname','signature'].includes(value.field)||Object.keys(value).sort().join('|')!==(value.field==='nickname'?'expectedSignature|expectedValue|field|value':'expectedValue|field|value'))fail('invalid_request');
   valueFor(value.field,value.value);valueFor(value.field,value.expectedValue);if(value.field==='nickname')valueFor('signature',value.expectedSignature);const check=checkedGuard(binding,signal,assertCurrent);check();
   const before=await this.read(binding,{signal,assertCurrent:check});check();
   if(!before[value.field].supported)fail('original_unsupported');if(before[value.field].value!==value.expectedValue)fail('baseline_changed');
   if(value.field==='nickname'){
    if(!before.signature.supported)fail('signature_unavailable');if(before.signature.value!==value.expectedSignature)fail('baseline_changed');
    // The bridge additionally saves its own read-time signature, sex and
    // birthday. Never reconstruct those fields from the public projection.
    // The observed signature gate is not proof of the bridge's internal cache.
    check();submitted=true;const native=await binding.client._request('set_qq_profile',{nickname:value.value},signal);
    if(!plain(native)||!Number.isSafeInteger(native.result))return {outcome:'unknown',code:'change_unknown'};
    if(native.result!==0)return {outcome:'rejected',code:'profile_rejected'};
    return {outcome:'accepted',acknowledgement:'bridge-reported-success'};
   }
   // No await between the final synchronous scope/identity guard and the sole
   // fixed signature mutation, whose native return contract remains unknown.
   check();submitted=true;await binding.client._request('set_self_longnick',{longNick:value.value},signal);
   // Pinned handler returns Promise<unknown>; even null/omitted/native object
   // only proves the matched outer bridge action completed without throwing.
   // Never expose its raw data, or invent a native profile-success contract.
   return {outcome:'accepted',acknowledgement:'bridge-action-only'};
  }catch(error){return {outcome:submitted?'unknown':'not_submitted',code:submitted?'change_unknown':safeCode(error)};}
 }
}
module.exports={QQSelfProfileTransport,checkedGuard};
