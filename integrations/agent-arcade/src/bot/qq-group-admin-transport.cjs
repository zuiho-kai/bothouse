'use strict';
// Fixed 4.18.42 action surface; underlying cache observations are not CAS.
const {validateQQOwner}=require('./qq.cjs');
const {guard,membership,ownRole}=require('./qq-group-profile-transport.cjs');
const {QQGroupProfileTransport}=require('./qq-group-profile-transport.cjs');
const {GroupAdminError,safeCode,plain,groupId,card,inputValue,observation,compare,acknowledgementFor}=require('./qq-group-admin.cjs');
const fail=code=>{throw new GroupAdminError(code);};
const id=value=>{try{return validateQQOwner(value);}catch{fail('invalid_response');}};
function members(raw,group){if(!Array.isArray(raw)||raw.length>10000)fail(Array.isArray(raw)?'response_too_large':'invalid_response');const found=new Map();for(const row of raw){if(!plain(row)||id(row.group_id)!==group)fail('invalid_response');const key=id(row.user_id);if(found.has(key)||!['owner','admin','member'].includes(row.role))fail('invalid_response');found.set(key,row);}return found;}
function target(raw,group,user){const role=ownRole(raw,user,group);let value=null;try{value=card(raw.card);}catch{}return {id:user,nickname:typeof raw.nickname==='string'?raw.nickname:'',role,card:value,muteUntil:Number.isSafeInteger(raw.shut_up_timestamp)&&raw.shut_up_timestamp>=0?raw.shut_up_timestamp:null};}
function listedSelf(list,accountId,selfRole){if(!list.has(accountId))fail('invalid_response');if(list.get(accountId).role!==selfRole)fail('role_changed');}
function whole(raw,group){if(!plain(raw)||id(raw.group_id)!==group||raw.groupCode!==undefined&&id(raw.groupCode)!==group)fail('invalid_response');if(!Number.isSafeInteger(raw.shutUpAllTimestamp)||raw.shutUpAllTimestamp<0||raw.group_all_shut!==(raw.shutUpAllTimestamp>0?-1:0))return null;return raw.shutUpAllTimestamp>0;}
class QQGroupAdminTransport {
 constructor({now=Date.now}={}){if(typeof now!=='function')fail('invalid_request');this.now=now;this.identity=new QQGroupProfileTransport({now});}
 async read(binding,selected,{signal,assertCurrent}={}){
  if(!plain(selected)||!groupId(selected.groupId)||selected.memberId!==undefined&&!groupId(selected.memberId))fail('invalid_request');const check=guard(binding,signal,assertCurrent),g=selected.groupId,m=selected.memberId;
  const request=async(action,params)=>{check();const raw=await binding.client._request(action,params,signal);check();return raw;};
  try{await this.identity._identity(binding,signal,check);check();const name=membership(await request('get_group_list',{no_cache:true}),g,false),params={group_id:g,user_id:binding.accountId,no_cache:true};const selfRole=ownRole(await request('get_group_member_info',params),binding.accountId,g);let t=null,wholeBan=null;
   if(m){const list=members(await request('get_group_member_list',{group_id:g,no_cache:true}),g);listedSelf(list,binding.accountId,selfRole);if(!list.has(m))fail('member_not_found');t=target(await request('get_group_member_info',{group_id:g,user_id:m,no_cache:true}),g,m);if(list.get(m).role!==t.role||m===binding.accountId&&t.role!==selfRole)fail('role_changed');const again=members(await request('get_group_member_list',{group_id:g,no_cache:true}),g);listedSelf(again,binding.accountId,selfRole);if(!again.has(m))fail('target_changed');if(again.get(m).role!==t.role)fail('role_changed');if(typeof list.get(m).card==='string'&&list.get(m).card!==t.card||typeof again.get(m).card==='string'&&again.get(m).card!==t.card){if(t.card!==null)fail('baseline_changed');}const last=target(await request('get_group_member_info',{group_id:g,user_id:m,no_cache:true}),g,m);if(last.role!==t.role)fail('role_changed');if(last.card!==t.card||last.muteUntil!==t.muteUntil)fail('baseline_changed');t=last;
   }else {try{wholeBan=whole(await request('get_group_detail_info',{group_id:g}),g);}catch(error){check();if(error.code!=='action_failed')throw error;wholeBan=null;}}
   if(membership(await request('get_group_list',{no_cache:true}),g,true)!==name)fail('baseline_changed');if(ownRole(await request('get_group_member_info',params),binding.accountId,g)!==selfRole)fail('role_changed');await this.identity._identity(binding,signal,check);check();return {accountId:binding.accountId,...selected,groupName:name,selfRole,target:t,wholeBan,source:'bridge-observed',fetchedAt:new Date(this.now()).toISOString()};
  }catch(error){throw new GroupAdminError(safeCode(error));}
 }
 async write(binding,{row,operation,value},{signal,assertCurrent}={}){
  let submitted=false;try{inputValue(operation,value);const check=guard(binding,signal,assertCurrent);check();const selected={groupId:row.groupId,...(row.memberId?{memberId:row.memberId}:{})},before=observation(await this.read(binding,selected,{signal,assertCurrent:check}),binding.accountId,selected);check();compare(row,before,operation);let action,params={group_id:row.groupId};
   if(operation==='card'){action='set_group_card';Object.assign(params,{user_id:row.memberId,card:value});}
   else if(operation==='ban'){action='set_group_ban';Object.assign(params,{user_id:row.memberId,duration:value});}
   else if(operation==='whole-ban'){action='set_group_whole_ban';params.enable=value;}
   else if(operation==='admin'){action='set_group_admin';Object.assign(params,{user_id:row.memberId,enable:value});}
   else if(operation==='kick'){action='set_group_kick';Object.assign(params,{user_id:row.memberId,reject_add_request:value});}
   else {action='set_group_leave';params.is_dismiss=operation==='dissolve';}
   // No await between the final identity/expiry guard and the one fixed action.
   check();submitted=true;const data=await binding.client._request(action,params,signal);if(data!==null)fail('change_unknown');return {outcome:'accepted',acknowledgement:acknowledgementFor(operation)};
  }catch(error){return {outcome:submitted?'unknown':'not_submitted',code:submitted?'change_unknown':safeCode(error)};}
 }
 async observe(binding,{row,operation,value},{signal,assertCurrent}={}){
  const check=guard(binding,signal,assertCurrent),g=row.groupId;let observed,state;
  const request=async(action,params)=>{check();const raw=await binding.client._request(action,params,signal);check();return raw;};
  await this.identity._identity(binding,signal,check);check();
  if(['leave','dissolve'].includes(operation)){const raw=await request('get_group_list',{no_cache:true});let present=true;try{membership(raw,g,false);}catch(error){if(error.code==='group_not_joined')present=false;else throw error;}observed={member:present};state=present?'observed_different':'observed_match';}
  else {membership(await request('get_group_list',{no_cache:true}),g,false);
   if(operation==='kick'){const present=members(await request('get_group_member_list',{group_id:g,no_cache:true}),g).has(row.memberId);observed={present};state=present?'observed_different':'observed_match';}
   else if(operation==='whole-ban'){const enabled=whole(await request('get_group_detail_info',{group_id:g}),g);if(enabled===null)fail('original_unsupported');observed={enabled};state=enabled===value?'observed_match':'observed_different';}
   else {const member=target(await request('get_group_member_info',{group_id:g,user_id:row.memberId,no_cache:true}),g,row.memberId);if(operation==='card'){if(member.card===null)fail('original_unsupported');observed={card:member.card};state=member.card===value?'observed_match':'observed_different';}else if(operation==='admin'){observed={role:member.role};state=member.role===(value?'admin':'member')?'observed_match':'observed_different';}else{if(member.muteUntil===null)fail('original_unsupported');observed={muteUntil:member.muteUntil};state=value===0?(member.muteUntil===0?'observed_match':'observed_different'):'observed_value';}}
   membership(await request('get_group_list',{no_cache:true}),g,true);
  }
  await this.identity._identity(binding,signal,check);check();return {state,value:observed,source:'bridge-observed',cacheMayBeStale:true,fetchedAt:new Date(this.now()).toISOString()};
 }
}
module.exports={QQGroupAdminTransport,members,target,whole};
