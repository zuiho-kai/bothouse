'use strict';
// Fixed requests over the production echo-matched QQClient. Never calls
// group chat, member management, leave/join, restoration, or arbitrary actions.
const {validateQQOwner}=require('./qq.cjs');
const {GroupProfileError,groupName,groupId,safeCode,privileged,plain,exact}=require('./qq-group-profile.cjs');
const fail=code=>{throw new GroupProfileError(code);};
const id=value=>{try{return validateQQOwner(value);}catch{fail('invalid_response');}};
function guard(binding,signal,assertCurrent){
 if(typeof assertCurrent!=='function'||!binding?.client||typeof binding.client._request!=='function')fail('invalid_request');
 return ()=>{if(signal?.aborted)fail('cancelled');const result=assertCurrent();if(result?.then){result.catch?.(()=>{});fail('invalid_request');}const c=binding.client;
  if(c.accountId!==binding.accountId||c.expectedAccountId!==binding.accountId)fail('account_changed');
  if(c.socket!==binding.socket||c.generation!==binding.clientGeneration||!c.ready||c.closed||c.socket?.readyState!==1)fail('disconnected');};
}
function membership(raw,target,after){
 if(!Array.isArray(raw))fail('invalid_response');if(raw.length>10000)fail('response_too_large');const seen=new Set();let found;
 for(const row of raw){if(!plain(row))fail('invalid_response');const current=id(row.group_id);if(seen.has(current))fail('invalid_response');seen.add(current);if(current===target)found=row;}
 if(!found)fail(after?'group_changed':'group_not_joined');if(typeof found.group_name!=='string')fail('invalid_response');return found.group_name;
}
function ownRole(raw,accountId,target){if(!plain(raw)||id(raw.group_id)!==target||id(raw.user_id)!==accountId||!['owner','admin','member'].includes(raw.role))fail('invalid_response');return raw.role;}
class QQGroupProfileTransport {
 constructor({now=Date.now}={}){if(typeof now!=='function')fail('invalid_request');this.now=now;}
 async _identity(binding,signal,check){
  check();const login=await binding.client._request('get_login_info',{},signal);check();if(!plain(login)||id(login.user_id)!==binding.accountId)fail('account_changed');
  const status=await binding.client._request('get_status',{},signal);check();if(!plain(status)||typeof status.online!=='boolean'||(status.good!==undefined&&typeof status.good!=='boolean'))fail('status_unverified');if(!status.online)fail('account_offline');if(status.good===false)fail('bridge_unhealthy');
 }
 async read(binding,target,{signal,assertCurrent}={}){
  if(!groupId(target))fail('invalid_request');const check=guard(binding,signal,assertCurrent);
  try{
   await this._identity(binding,signal,check);
   const beforeName=membership(await binding.client._request('get_group_list',{no_cache:true},signal),target,false);check();
   // Pinned get_group_info has no no_cache parameter; do not pretend otherwise.
   const info=await binding.client._request('get_group_info',{group_id:target},signal);check();if(!plain(info)||id(info.group_id)!==target||typeof info.group_name!=='string')fail('invalid_response');
   const params={group_id:target,user_id:binding.accountId,no_cache:true};
   const beforeRole=ownRole(await binding.client._request('get_group_member_info',params,signal),binding.accountId,target);check();
   const afterName=membership(await binding.client._request('get_group_list',{no_cache:true},signal),target,true);check();
   if(beforeName!==info.group_name||afterName!==info.group_name)fail('baseline_changed');
   const afterRole=ownRole(await binding.client._request('get_group_member_info',params,signal),binding.accountId,target);check();if(beforeRole!==afterRole)fail('role_changed');
   await this._identity(binding,signal,check);check();let name;try{name={supported:true,value:groupName(info.group_name)};}catch{name={supported:false,reason:'original_unsupported'};}
   return {accountId:binding.accountId,groupId:target,name,selfRole:afterRole,source:'bridge-observed',fetchedAt:new Date(this.now()).toISOString()};
  }catch(error){throw new GroupProfileError(safeCode(error));}
 }
 async write(binding,value,{signal,assertCurrent}={}){
  let submitted=false;
  try{
   exact(value,['groupId','value','expectedValue','expectedRole']);if(!groupId(value.groupId)||!privileged(value.expectedRole))fail('invalid_request');groupName(value.value);groupName(value.expectedValue);
   const check=guard(binding,signal,assertCurrent);check();const before=await this.read(binding,value.groupId,{signal,assertCurrent:check});check();
   if(before.selfRole!==value.expectedRole)fail('role_changed');if(!privileged(before.selfRole))fail('insufficient_role');if(!before.name.supported)fail('original_unsupported');if(before.name.value!==value.expectedValue)fail('baseline_changed');
   // No await after the last synchronous application scope guard. Observed
   // owner/admin and name are not an atomic remote privilege/CAS guarantee.
   check();submitted=true;const data=await binding.client._request('set_group_name',{group_id:value.groupId,group_name:value.value},signal);
   // Pinned handler returns exactly null after native result===0. It can retry
   // internally for result 1287; one application action is not one native call.
   if(data!==null)fail('change_unknown');return {outcome:'accepted',acknowledgement:'bridge-reported-success'};
  }catch(error){return {outcome:submitted?'unknown':'not_submitted',code:submitted?'change_unknown':safeCode(error)};}
 }
}
module.exports={QQGroupProfileTransport,membership,ownRole,guard};
