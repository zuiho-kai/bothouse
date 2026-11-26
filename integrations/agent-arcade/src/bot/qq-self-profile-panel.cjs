'use strict';
// A panel owns a separate request-only socket. It never borrows an AI socket,
// starts QQ, reconnects, polls owner messages, or broadcasts observed fields.
const {QQClient,validateQQOwner,validateQQUrl}=require('./qq.cjs');
const {QQSelfProfile,valueFor,safeCode,acknowledgementFor,disclosureFor}=require('./qq-self-profile.cjs');
const EXTRA=new Set(['unconfigured','status_unverified','unauthorized','connect_failed','connect_timeout','login_required','heartbeat_timeout']);
const codeOf=error=>EXTRA.has(error?.code)?error.code:safeCode(error);
const fail=code=>{throw Object.assign(Error('QQ self profile management is unavailable.'),{code:codeOf({code})});};
const plain=value=>value&&typeof value==='object'&&!Array.isArray(value);
const id=value=>typeof value==='string'&&/^[a-zA-Z0-9-]{1,64}$/.test(value);
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
const correlation=value=>({accountId:value.accountId,panelId:value.panelId});
function request(value,action='read'){
 const keys=['accountId','panelId',...(action==='preview'?['observationId','field','value']:action==='confirm'?['ticketId']:[])];
 if(!plain(value)||Object.keys(value).sort().join('|')!==keys.sort().join('|')||!id(value.accountId)||!uuid(value.panelId))fail('invalid_request');
 if(action==='preview'){if(!uuid(value.observationId)||!['nickname','signature'].includes(value.field))fail('invalid_request');valueFor(value.field,value.value);}
 if(action==='confirm'&&!uuid(value.ticketId))fail('invalid_request');return value;
}
const KEYS=['profileId','panelId','profile','generation','characterId','runtime','installation','runtimeEpoch','bridgeRevision','qqAccountId','ownerId','url','token','channel','status','endpointId'];
const same=(a,b)=>KEYS.every(key=>a[key]===b[key]);
function captured(value,input){
 if(!plain(value)||value.profileId!==input.accountId||value.panelId!==input.panelId||!uuid(value.panelId)||!plain(value.profile)||!plain(value.runtime)||!plain(value.installation)||value.channel!=='qq'||!['connected','disconnected'].includes(value.status))fail('unconfigured');
 if(!Number.isSafeInteger(value.generation)||value.generation<0||!Number.isSafeInteger(value.runtimeEpoch)||value.runtimeEpoch<0||typeof value.characterId!=='string'||!value.characterId||value.characterId.length>128||typeof value.bridgeRevision!=='string'||!value.bridgeRevision||value.bridgeRevision.length>128||typeof value.endpointId!=='string'||!value.endpointId||value.endpointId.length>256)fail('unconfigured');
 let accountId,ownerId,url;try{accountId=validateQQOwner(value.qqAccountId);ownerId=validateQQOwner(value.ownerId);url=validateQQUrl(value.url);}catch{fail('unconfigured');}
 if(accountId===ownerId||typeof value.token!=='string'||!/^[\x21-\x7e]{16,256}$/.test(value.token))fail('unconfigured');
 return Object.freeze(Object.fromEntries(KEYS.map(key=>[key,key==='qqAccountId'?accountId:key==='ownerId'?ownerId:key==='url'?url:value[key]])));
}
function profileProjection(raw,accountId){
 if(!plain(raw)||raw.kind!=='self-profile'||raw.accountId!==accountId||!uuid(raw.observationId)||!plain(raw.values)||!plain(raw.capabilities?.readable)||!plain(raw.capabilities?.editable)||raw.source!=='bridge-observed'||raw.cacheMayBeStale!==true||typeof raw.fetchedAt!=='string'||!Number.isFinite(Date.parse(raw.fetchedAt)))fail('invalid_response');
 const values={},readable={},editable={nickname:false,signature:false,avatar:false};
 for(const field of ['nickname','signature']){if(typeof raw.capabilities.readable[field]!=='boolean')fail('invalid_response');readable[field]=raw.capabilities.readable[field];values[field]=readable[field]?valueFor(field,raw.values[field]):null;if(!readable[field]&&raw.values[field]!==null)fail('invalid_response');}
 editable.nickname=readable.nickname&&readable.signature;editable.signature=readable.signature;
 const reason=editable.nickname?undefined:!readable.nickname?'original_unsupported':'signature_unavailable';
 if(raw.capabilities.readable.avatar!==false||raw.capabilities.editable.avatar!==false||raw.capabilities.editable.nickname!==editable.nickname||raw.capabilities.editable.signature!==editable.signature||raw.nicknameUnavailableReason!==reason)fail('invalid_response');readable.avatar=false;
 return {kind:'self-profile',observationId:raw.observationId,values,capabilities:{readable,editable},...(reason?{nicknameUnavailableReason:reason}:{}),source:'bridge-observed',cacheMayBeStale:true,fetchedAt:raw.fetchedAt};
}
function previewProjection(raw,accountId){
 if(!plain(raw)||raw.kind!=='self-profile-preview'||raw.accountId!==accountId||!['nickname','signature'].includes(raw.field)||!uuid(raw.ticketId)||!Number.isSafeInteger(raw.expiresAt)||raw.automaticRetry!==false||raw.cacheMayBeStale!==true)fail('invalid_response');
 const disclosure=disclosureFor(raw.field);if(Object.keys(disclosure).some(key=>raw[key]!==disclosure[key]))fail('invalid_response');
 return {kind:'self-profile-preview',ticketId:raw.ticketId,field:raw.field,before:valueFor(raw.field,raw.before),after:valueFor(raw.field,raw.after),expiresAt:raw.expiresAt,cacheMayBeStale:true,automaticRetry:false,...disclosure};
}
function changeProjection(raw,accountId,ticketId,field){
 if(!plain(raw)||raw.kind!=='self-profile-change'||raw.accountId!==accountId||raw.ticketId!==ticketId||!['nickname','signature'].includes(raw.field)||(field!==undefined&&raw.field!==field)||!['accepted','unknown','not_submitted','rejected'].includes(raw.outcome)||raw.automaticRetry!==false||raw.outcome==='accepted'&&raw.acknowledgement!==acknowledgementFor(raw.field)||raw.outcome==='rejected'&&(raw.field!=='nickname'||raw.code!=='profile_rejected'))fail('invalid_response');
 const disclosure=disclosureFor(raw.field);if(Object.keys(disclosure).some(key=>raw[key]!==disclosure[key]))fail('invalid_response');
 const observation={state:'unavailable',source:'bridge-observed'},row=raw.observation;
 if(['observed_match','observed_different'].includes(row?.state)){if(raw.outcome!=='accepted'||row.source!=='bridge-observed'||row.cacheMayBeStale!==true||typeof row.fetchedAt!=='string'||!Number.isFinite(Date.parse(row.fetchedAt)))fail('invalid_response');Object.assign(observation,{state:row.state,value:valueFor(raw.field,row.value),fetchedAt:row.fetchedAt,cacheMayBeStale:true});}else if(row?.state!=='unavailable'||row.source!=='bridge-observed')fail('invalid_response');
 return {kind:'self-profile-change',ticketId,field:raw.field,outcome:raw.outcome,...(raw.outcome==='accepted'?{acknowledgement:acknowledgementFor(raw.field)}:{code:raw.outcome==='unknown'?'change_unknown':codeOf(raw)}),observation,automaticRetry:false,...disclosure};
}
class QQSelfProfilePanel {
 constructor({capture,verifyContext,clientFactory=options=>new QQClient(options),controllerFactory=options=>new QQSelfProfile(options)}={}){
  if([capture,verifyContext,clientFactory,controllerFactory].some(value=>typeof value!=='function'))fail('invalid_request');Object.assign(this,{capture,verifyContext,clientFactory,controllerFactory});this.session=null;this.retiringSession=null;this.retiring=Promise.resolve();this.closed=false;
 }
 _capture(input){if(this.closed)fail('closed');const result=this.capture(correlation(input));if(result?.then){result.catch?.(()=>{});fail('invalid_request');}return captured(result,input);}
 _assert(session,ready=true){
  if(this.closed||this.session!==session||session.abort.signal.aborted)fail('changed');if(!same(session.binding,this._capture(session)))fail('changed');
  if(ready){const c=session.client;if(!c?.ready||c.closed||c.socket?.readyState!==1||c.accountId!==session.binding.qqAccountId||c.ownerId!==session.binding.ownerId||c.expectedAccountId!==session.binding.qqAccountId||c.generation!==session.clientGeneration||c.socket!==session.socket)fail('disconnected');}
 }
 _binding(session){this._assert(session);return {...session.binding,accountId:session.binding.qqAccountId,client:session.client};}
 async _verify(session,ready=true){this._assert(session,ready);const result=await this.verifyContext(session.binding,{signal:session.abort.signal});this._assert(session,ready);if(!plain(result)||Object.keys(result).length!==1||result.verified!==true)fail('changed');}
 _envelope(session){return {...correlation(session),qqAccountId:session.binding.qqAccountId};}
 _get(input){const session=this.session;if(!session||session.accountId!==input.accountId||session.panelId!==input.panelId)fail('changed');if(session.pending)fail('operation_in_progress');this._assert(session);return session;}
 async read(input){
  request(input);const binding=this._capture(input);let session=this.session;
  if(session?.pending)fail('operation_in_progress');
  const fresh=!session||session.accountId!==input.accountId||session.panelId!==input.panelId||!same(session.binding,binding);
  let retiring=Promise.resolve();if(fresh){retiring=this._retire();session={...correlation(input),binding,abort:new AbortController(),client:null,controller:null,clientGeneration:null,socket:null,timer:null,pending:null,previewId:null,previewField:null};this.session=session;}
  const operation=(async()=>{try{
   if(fresh){await retiring;this._assert(session,false);await this._verify(session,false);this._assert(session,false);session.client=this.clientFactory({url:binding.url,token:binding.token,ownerId:binding.ownerId,expectedAccountId:binding.qqAccountId,receiveOwnerMessages:false,allowOwnerVoice:false});
    const c=session.client;if(!c||c.receiveOwnerMessages!==false||typeof c.connect!=='function'||typeof c.close!=='function'||typeof c.readSelfProfile!=='function'||typeof c.setSelfSignature!=='function'||typeof c.setSelfNickname!=='function')fail('invalid_response');
    await c.connect(session.abort.signal);this._assert(session,false);session.clientGeneration=c.generation;session.socket=c.socket;this._assert(session);c.socket.once('close',()=>{if(this.session===session)void this._retire();});
    session.controller=this.controllerFactory({getBinding:()=>this._binding(session)});session.timer=setInterval(()=>this.observe(),250);session.timer.unref?.();
   }
   await this._verify(session);session.previewId=null;session.previewField=null;const raw=await session.controller.read({signal:session.abort.signal});this._assert(session);return {...this._envelope(session),profile:profileProjection(raw,session.binding.qqAccountId)};
  }catch(error){if(this.session===session)void this._retire();throw Object.assign(Error('QQ self profile read did not complete.'),{code:codeOf(error)});}})();session.pending=operation;
  try{return await operation;}finally{if(session.pending===operation)session.pending=null;}
 }
 preview(input){request(input,'preview');const session=this._get(input);session.previewId=null;session.previewField=null;const raw=session.controller.preview({observationId:input.observationId,field:input.field,value:input.value}),preview=previewProjection(raw,session.binding.qqAccountId);if(preview.field!==input.field)fail('invalid_response');this._assert(session);session.previewId=preview.ticketId;session.previewField=preview.field;return {...this._envelope(session),preview};}
 async confirm(input){
  request(input,'confirm');const session=this._get(input);if(session.previewId!==input.ticketId)fail('stale_ticket');const field=session.previewField;session.previewId=null;session.previewField=null;
  const unknown=(outcome,code)=>({kind:'self-profile-change',ticketId:input.ticketId,field,outcome,code,observation:{state:'unavailable',source:'bridge-observed'},automaticRetry:false,...disclosureFor(field)});
  const operation=(async()=>{let invoked=false;try{await this._verify(session);this._assert(session);invoked=true;const raw=await session.controller.confirm({ticketId:input.ticketId},{signal:session.abort.signal});return {...this._envelope(session),change:changeProjection(raw,session.binding.qqAccountId,input.ticketId,field)};}catch(error){session.controller?.discardPreview();return {...this._envelope(session),change:unknown(invoked?'unknown':'not_submitted',invoked?'change_unknown':codeOf(error))};}})();session.pending=operation;
  try{return await operation;}finally{if(session.pending===operation)session.pending=null;}
 }
 dismiss(input){request(input);const session=this.session;if(session&&session.accountId===input.accountId&&session.panelId===input.panelId){session.previewId=null;session.previewField=null;session.controller?.discardPreview();}return {...correlation(input),dismissed:true};}
 _retire(){
  const session=this.session;this.session=null;if(!session)return this.retiring;clearInterval(session.timer);session.previewId=null;session.previewField=null;session.abort.abort();try{session.client?.close();}catch{}
  this.retiringSession=session;const retiring=Promise.allSettled([this.retiring,session.pending,session.controller?.close()]).then(()=>({closed:true})).finally(()=>{if(this.retiringSession===session)this.retiringSession=null;});this.retiring=retiring;return retiring;
 }
 closeOwned(input){request(input);const session=this.session;if(!session||session.accountId!==input.accountId||session.panelId!==input.panelId){const old=this.retiringSession;return (old&&old.accountId===input.accountId&&old.panelId===input.panelId?this.retiring:Promise.resolve()).then(()=>({...correlation(input),closed:true}));}return this._retire().then(()=>({...correlation(input),closed:true}));}
 closeCurrent(){return this._retire();}
 observe(){if(this.session)try{this._assert(this.session,!!this.session.controller);}catch{void this._retire();}}
 close(){this.closed=true;return this._retire();}
}
async function selfProfileResult(input,operation){
 const identity=plain(input)&&id(input.accountId)&&uuid(input.panelId)?correlation(input):{};
 try{return {ok:true,...await operation()};}catch(error){return {ok:false,...identity,code:codeOf(error),error:'QQ profile operation did not complete.'};}
}
module.exports={QQSelfProfilePanel,selfProfileResult,codeOf,profileProjection,previewProjection,changeProjection};
