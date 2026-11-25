'use strict';
// Main-owned, request-only management session. It owns the new socket;
// never borrows an AI connection, subscribes to chat, starts QQ or reconnects.
const {QQClient,validateQQOwner,validateQQUrl}=require('./qq.cjs');
const {QQGroupProfile,groupName,groupId,safeCode,plain,uuid,exact}=require('./qq-group-profile.cjs');
const {QQGroupProfileTransport}=require('./qq-group-profile-transport.cjs');
const EXTRA=new Set(['unconfigured','unauthorized','connect_failed','connect_timeout','login_required','heartbeat_timeout']);
const codeOf=error=>EXTRA.has(error?.code)?error.code:safeCode(error);
const fail=code=>{throw Object.assign(Error('QQ group management is unavailable.'),{code:codeOf({code})});};
const id=value=>typeof value==='string'&&/^[a-zA-Z0-9-]{1,64}$/.test(value);
const reference=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const correlation=value=>({accountId:value.accountId,panelId:value.panelId,groupId:value.groupId});
function request(value,action='read'){
 const keys=['accountId','panelId','groupId',...(action==='preview'?['observationId','field','value']:action==='confirm'?['ticketId']:[])];
 exact(value,keys);if(!id(value.accountId)||!uuid(value.panelId)||!groupId(value.groupId))fail('invalid_request');
 if(action==='preview'){if(!uuid(value.observationId)||value.field!=='name')fail('invalid_request');groupName(value.value);}if(action==='confirm'&&!uuid(value.ticketId))fail('invalid_request');return value;
}
const KEYS=['profileId','panelId','groupId','profile','generation','characterId','runtime','installation','runtimeEpoch','bridgeRevision','qqAccountId','ownerId','url','token','channel','status','endpointId'];
const same=(a,b)=>KEYS.every(key=>a[key]===b[key]);
function captured(value,input){
 if(!plain(value)||value.profileId!==input.accountId||value.panelId!==input.panelId||value.groupId!==input.groupId||!reference(value.profile)||!reference(value.runtime)||!reference(value.installation)||value.channel!=='qq'||!['connected','disconnected'].includes(value.status))fail('unconfigured');
 if(!Number.isSafeInteger(value.generation)||value.generation<0||!Number.isSafeInteger(value.runtimeEpoch)||value.runtimeEpoch<0||typeof value.characterId!=='string'||!value.characterId||value.characterId.length>128||typeof value.bridgeRevision!=='string'||!value.bridgeRevision||value.bridgeRevision.length>128||typeof value.endpointId!=='string'||!value.endpointId||value.endpointId.length>256)fail('unconfigured');
 let accountId,ownerId,url;try{accountId=validateQQOwner(value.qqAccountId);ownerId=validateQQOwner(value.ownerId);url=validateQQUrl(value.url);}catch{fail('unconfigured');}
 if(accountId===ownerId||typeof value.token!=='string'||!/^[\x21-\x7e]{16,256}$/.test(value.token))fail('unconfigured');
 return Object.freeze(Object.fromEntries(KEYS.map(key=>[key,key==='qqAccountId'?accountId:key==='ownerId'?ownerId:key==='url'?url:value[key]])));
}
function profileProjection(raw,qqAccountId,target){
 if(!plain(raw)||raw.kind!=='group-profile'||raw.accountId!==qqAccountId||raw.groupId!==target||!uuid(raw.observationId)||!['owner','admin','member'].includes(raw.selfRole)||!plain(raw.capabilities)||typeof raw.capabilities.readName!=='boolean'||typeof raw.capabilities.editName!=='boolean'||raw.source!=='bridge-observed'||raw.cacheMayBeStale!==true||typeof raw.fetchedAt!=='string'||!Number.isFinite(Date.parse(raw.fetchedAt)))fail('invalid_response');
 const readName=raw.capabilities.readName,editName=readName&&['owner','admin'].includes(raw.selfRole);if(raw.capabilities.editName!==editName||!readName&&raw.name!==null)fail('invalid_response');
 return {kind:'group-profile',observationId:raw.observationId,groupId:target,name:readName?groupName(raw.name):null,selfRole:raw.selfRole,capabilities:{readName,editName},source:'bridge-observed',cacheMayBeStale:true,fetchedAt:raw.fetchedAt};
}
function previewProjection(raw,qqAccountId,target){
 if(!plain(raw)||raw.kind!=='group-profile-preview'||raw.accountId!==qqAccountId||raw.groupId!==target||raw.field!=='name'||!['owner','admin'].includes(raw.role)||!uuid(raw.ticketId)||!Number.isSafeInteger(raw.expiresAt)||raw.automaticRetry!==false||raw.cacheMayBeStale!==true)fail('invalid_response');
 return {kind:'group-profile-preview',ticketId:raw.ticketId,groupId:target,field:'name',role:raw.role,before:groupName(raw.before),after:groupName(raw.after),expiresAt:raw.expiresAt,cacheMayBeStale:true,automaticRetry:false};
}
function changeProjection(raw,qqAccountId,target,ticketId){
 if(!plain(raw)||raw.kind!=='group-profile-change'||raw.accountId!==qqAccountId||raw.groupId!==target||raw.ticketId!==ticketId||raw.field!=='name'||!['accepted','unknown','not_submitted'].includes(raw.outcome)||raw.automaticRetry!==false||raw.automaticRestore!==false||raw.outcome==='accepted'&&raw.acknowledgement!=='bridge-reported-success')fail('invalid_response');
 const observation={state:'unavailable',source:'bridge-observed'},row=raw.observation;
 if(['observed_match','observed_different'].includes(row?.state)){if(raw.outcome!=='accepted'||row.source!=='bridge-observed'||row.cacheMayBeStale!==true||!['owner','admin','member'].includes(row.selfRole)||typeof row.fetchedAt!=='string'||!Number.isFinite(Date.parse(row.fetchedAt)))fail('invalid_response');Object.assign(observation,{state:row.state,value:groupName(row.value),selfRole:row.selfRole,fetchedAt:row.fetchedAt,cacheMayBeStale:true});}else if(row?.state!=='unavailable'||row.source!=='bridge-observed')fail('invalid_response');
 return {kind:'group-profile-change',ticketId,groupId:target,field:'name',outcome:raw.outcome,...(raw.outcome==='accepted'?{acknowledgement:'bridge-reported-success'}:{code:raw.outcome==='unknown'?'change_unknown':codeOf(raw)}),observation,automaticRetry:false,automaticRestore:false};
}
class QQGroupProfileSession {
 constructor({capture,verifyContext,clientFactory=options=>new QQClient(options),controllerFactory=options=>new QQGroupProfile({...options,transport:new QQGroupProfileTransport()})}={}){
  if([capture,verifyContext,clientFactory,controllerFactory].some(value=>typeof value!=='function'))fail('invalid_request');Object.assign(this,{capture,verifyContext,clientFactory,controllerFactory});this.session=null;this.retiringSession=null;this.retiring=Promise.resolve();this.closed=false;
 }
 _capture(input){if(this.closed)fail('closed');const result=this.capture(correlation(input));if(result?.then){result.catch?.(()=>{});fail('invalid_request');}return captured(result,input);}
 _assert(session,ready=true){if(this.closed||this.session!==session||session.abort.signal.aborted||!same(session.binding,this._capture(session)))fail('changed');if(ready){const c=session.client;if(!c?.ready||c.closed||c.socket?.readyState!==1||c.accountId!==session.binding.qqAccountId||c.ownerId!==session.binding.ownerId||c.expectedAccountId!==session.binding.qqAccountId||c.generation!==session.clientGeneration||c.socket!==session.socket)fail('disconnected');}}
 _binding(session){this._assert(session);return {...session.binding,accountId:session.binding.qqAccountId,client:session.client};}
 async _verify(session,ready=true){this._assert(session,ready);const result=await this.verifyContext(session.binding,{signal:session.abort.signal});this._assert(session,ready);if(!plain(result)||Object.keys(result).length!==1||result.verified!==true)fail('changed');}
 _envelope(session){return {...correlation(session),qqAccountId:session.binding.qqAccountId};}
 _get(input){const session=this.session;if(!session||session.accountId!==input.accountId||session.panelId!==input.panelId||session.groupId!==input.groupId)fail('changed');if(session.pending)fail('operation_in_progress');this._assert(session);return session;}
 async read(input){
  request(input);const binding=this._capture(input);let session=this.session;if(session?.pending)fail('operation_in_progress');
  const fresh=!session||session.accountId!==input.accountId||session.panelId!==input.panelId||session.groupId!==input.groupId||!same(session.binding,binding);
  let retiring=Promise.resolve();if(fresh){retiring=this._retire();session={...correlation(input),binding,abort:new AbortController(),client:null,controller:null,clientGeneration:null,socket:null,timer:null,pending:null,previewId:null};this.session=session;}
  const operation=(async()=>{try{
   if(fresh){await retiring;this._assert(session,false);await this._verify(session,false);this._assert(session,false);session.client=this.clientFactory({url:binding.url,token:binding.token,ownerId:binding.ownerId,expectedAccountId:binding.qqAccountId,receiveOwnerMessages:false,allowOwnerVoice:false});
    const c=session.client;if(!c||c.receiveOwnerMessages!==false||typeof c.connect!=='function'||typeof c.close!=='function'||typeof c._request!=='function')fail('invalid_response');
    await c.connect(session.abort.signal);this._assert(session,false);session.clientGeneration=c.generation;session.socket=c.socket;this._assert(session);c.socket.once('close',()=>{if(this.session===session)void this._retire();});
    session.controller=this.controllerFactory({getBinding:()=>this._binding(session)});session.timer=setInterval(()=>this.observe(),250);session.timer.unref?.();
   }
   await this._verify(session);session.previewId=null;const raw=await session.controller.read({groupId:session.groupId,signal:session.abort.signal});this._assert(session);return {...this._envelope(session),profile:profileProjection(raw,session.binding.qqAccountId,session.groupId)};
  }catch(error){if(this.session===session)void this._retire();throw Object.assign(Error('QQ group read did not complete.'),{code:codeOf(error)});}})();session.pending=operation;
  try{return await operation;}finally{if(session.pending===operation)session.pending=null;}
 }
 preview(input){request(input,'preview');const session=this._get(input);session.previewId=null;const raw=session.controller.preview({observationId:input.observationId,field:'name',value:input.value}),preview=previewProjection(raw,session.binding.qqAccountId,session.groupId);this._assert(session);session.previewId=preview.ticketId;return {...this._envelope(session),preview};}
 async confirm(input){
  request(input,'confirm');const session=this._get(input);if(session.previewId!==input.ticketId)fail('stale_ticket');session.previewId=null;
  const outcome=(state,code)=>({kind:'group-profile-change',ticketId:input.ticketId,groupId:session.groupId,field:'name',outcome:state,code,observation:{state:'unavailable',source:'bridge-observed'},automaticRetry:false,automaticRestore:false});
  const operation=(async()=>{let invoked=false;try{await this._verify(session);this._assert(session);invoked=true;const raw=await session.controller.confirm({ticketId:input.ticketId},{signal:session.abort.signal});return {...this._envelope(session),change:changeProjection(raw,session.binding.qqAccountId,session.groupId,input.ticketId)};}catch(error){session.controller?.discardPreview();return {...this._envelope(session),change:outcome(invoked?'unknown':'not_submitted',invoked?'change_unknown':codeOf(error))};}})();session.pending=operation;
  try{return await operation;}finally{if(session.pending===operation)session.pending=null;}
 }
 dismiss(input){request(input);const session=this.session;if(session&&session.accountId===input.accountId&&session.panelId===input.panelId&&session.groupId===input.groupId){session.previewId=null;session.controller?.discardPreview();}return {...correlation(input),dismissed:true};}
 _retire(){const session=this.session;this.session=null;if(!session)return this.retiring;clearInterval(session.timer);session.previewId=null;session.abort.abort();try{session.client?.close();}catch{}
  this.retiringSession=session;const retiring=Promise.allSettled([this.retiring,session.pending,session.controller?.close()]).then(()=>({closed:true})).finally(()=>{if(this.retiringSession===session)this.retiringSession=null;});this.retiring=retiring;return retiring;
 }
 closeOwned(input){request(input);const session=this.session;if(!session||session.accountId!==input.accountId||session.panelId!==input.panelId||session.groupId!==input.groupId){const old=this.retiringSession;return (old&&old.accountId===input.accountId&&old.panelId===input.panelId&&old.groupId===input.groupId?this.retiring:Promise.resolve()).then(()=>({...correlation(input),closed:true}));}return this._retire().then(()=>({...correlation(input),closed:true}));}
 closeCurrent(){return this._retire();}
 observe(){if(this.session)try{this._assert(this.session,!!this.session.controller);}catch{void this._retire();}}
 close(){this.closed=true;return this._retire();}
}
async function groupProfileResult(input,operation){
 try{return {ok:true,...await operation()};}catch(error){return {ok:false,...(id(input?.accountId)?{accountId:input.accountId}:{}),...(uuid(input?.panelId)?{panelId:input.panelId}:{}),...(groupId(input?.groupId)?{groupId:input.groupId}:{}),code:codeOf(error)};}
}
module.exports={QQGroupProfileSession,groupProfileResult,codeOf,profileProjection,previewProjection,changeProjection};
