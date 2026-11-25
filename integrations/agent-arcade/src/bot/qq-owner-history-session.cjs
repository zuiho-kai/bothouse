'use strict';
const {randomUUID}=require('node:crypto');
const {HistoryImageTransport,HistoryImagePages,request:imageRequest,historyImageResult}=require('./qq-history-image.cjs');
const {QQOwnerComposerTransport,QQOwnerSubmissionBook,ownerComposerResult,request:composerRequest}=require('./qq-owner-composer.cjs');
const {QQClient,validateQQOwner,validateQQUrl}=require('./qq.cjs');
const {openManagementClient}=require('./qq-management-client.cjs');
const {QQOwnerHistoryTransport,QQOwnerHistoryError,LIMITS,safeCode,plain,exact,uuid,fail}=require('./qq-owner-history.cjs');
const profileId=v=>typeof v==='string'&&/^[a-zA-Z0-9-]{1,64}$/.test(v);
const ref=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const correlation=v=>({accountId:v.accountId,panelId:v.panelId});
const KEYS=['profileId','panelId','profile','generation','characterId','runtime','installation','runtimeEpoch','bridgeRevision','qqAccountId','ownerId','url','token','channel','status','endpointId'];
const same=(a,b)=>KEYS.every(key=>a[key]===b[key]);
function request(value,read=false){exact(value,['accountId','panelId',...(read?['cursor']:[])]);if(!profileId(value.accountId)||!uuid(value.panelId)||read&&value.cursor!==null&&!uuid(value.cursor))fail('invalid_request');return value;}
function captured(value,input){
 if(!plain(value)||value.profileId!==input.accountId||value.panelId!==input.panelId||!ref(value.profile)||!ref(value.runtime)||!ref(value.installation)||value.channel!=='qq'||!['connected','disconnected'].includes(value.status))fail('unconfigured');
 if(!Number.isSafeInteger(value.generation)||value.generation<0||!Number.isSafeInteger(value.runtimeEpoch)||value.runtimeEpoch<0||typeof value.characterId!=='string'||!value.characterId||value.characterId.length>128||typeof value.bridgeRevision!=='string'||!value.bridgeRevision||value.bridgeRevision.length>128||typeof value.endpointId!=='string'||!value.endpointId||value.endpointId.length>256)fail('unconfigured');
 let accountId,ownerId,url;try{accountId=validateQQOwner(value.qqAccountId);ownerId=validateQQOwner(value.ownerId);url=validateQQUrl(value.url);}catch{fail('unconfigured');}
 if(accountId===ownerId||typeof value.token!=='string'||!/^[\x21-\x7e]{16,256}$/.test(value.token))fail('unconfigured');
 return Object.freeze(Object.fromEntries(KEYS.map(key=>[key,key==='qqAccountId'?accountId:key==='ownerId'?ownerId:key==='url'?url:value[key]])));
}
class QQOwnerHistorySession {
 constructor({capture,verifyContext,clientFactory=options=>new QQClient(options),transport=new QQOwnerHistoryTransport(),composerTransport=new QQOwnerComposerTransport(),captureSubmission=()=>()=>{},imagePrepare,imageTransport=new HistoryImageTransport({prepare:imagePrepare}),now=Date.now,monotonic=()=>performance.now()}={}){
  if([capture,verifyContext,clientFactory,captureSubmission,now,monotonic].some(f=>typeof f!=='function')||typeof transport?.read!=='function'||typeof composerTransport?.send!=='function')fail('invalid_request');Object.assign(this,{capture,verifyContext,clientFactory,transport,composerTransport,captureSubmission,now,monotonic});this.imageTransport=imageTransport;this.submissions=new QQOwnerSubmissionBook();this.admission=null;this.session=null;this.retiring=Promise.resolve();this.retiringSession=null;this.closed=false;
 }
 _capture(input){if(this.closed)fail('closed');const raw=this.capture(correlation(input));if(raw?.then){raw.catch?.(()=>{});fail('invalid_request');}return captured(raw,input);}
 _assert(s,ready=true){if(this.closed||this.session!==s||s.abort.signal.aborted||!same(s.binding,this._capture(s)))fail('changed');if(ready){const c=s.client;if(!c?.ready||c.closed||c.socket?.readyState!==1||c.socket!==s.socket||c.generation!==s.clientGeneration||c.accountId!==s.binding.qqAccountId||c.expectedAccountId!==s.binding.qqAccountId||c.ownerId!==s.binding.ownerId)fail('disconnected');}}
 async _verify(s,ready=true,signal=s.abort.signal){this._assert(s,ready);if(signal.aborted)fail('cancelled');const raw=await this.verifyContext(s.binding,{signal});if(signal.aborted)fail('cancelled');this._assert(s,ready);if(!plain(raw)||Object.keys(raw).length!==1||raw.verified!==true)fail('changed');}
 _binding(s){this._assert(s);return {accountId:s.binding.qqAccountId,ownerId:s.binding.ownerId,client:s.client,socket:s.socket,clientGeneration:s.clientGeneration};}
 availability(input){request(input);try{const b=this._capture(input);return {...correlation(input),available:true,qqAccountId:b.qqAccountId,ownerId:b.ownerId};}catch(error){return {...correlation(input),available:false,code:safeCode(error)};}}
 _acquire(input,cursor=null){
  const binding=this._capture(input);let s=this.session;if(s?.pending)fail('operation_in_progress');
  const fresh=!s||s.accountId!==input.accountId||s.panelId!==input.panelId||!same(s.binding,binding);if(fresh&&cursor!==null)fail('cursor_session_mismatch');
  let retiring=Promise.resolve();if(fresh){retiring=this._retire();s={...correlation(input),binding,abort:new AbortController(),client:null,socket:null,clientGeneration:null,pending:null,cursors:new Map(),pageCount:0,timer:null};this.session=s;s.images=new HistoryImagePages({assertCurrent:()=>this._assert(s),verify:signal=>this._verify(s,true,signal),binding:()=>this._binding(s),transport:this.imageTransport,monotonic:this.monotonic});}
  return {binding,s,fresh,retiring};
 }
 async _open(s,retiring){if(s.socket){this._assert(s);return;}const binding=s.binding;const c=await openManagementClient({retiring,verify:()=>this._verify(s,false),assertCurrent:()=>this._assert(s,false),clientFactory:this.clientFactory,onCreated:client=>{s.client=client;},options:{url:binding.url,token:binding.token,ownerId:binding.ownerId,expectedAccountId:binding.qqAccountId},signal:s.abort.signal,requiredMethods:['_request']});this._assert(s,false);s.socket=c.socket;s.clientGeneration=c.generation;this._assert(s);c.socket.once('close',()=>{if(this.session===s)void this._retire();});s.timer=setInterval(()=>this.observe(),250);s.timer.unref?.();}
 async read(input){
  request(input,true);const {binding,s,retiring}=this._acquire(input,input.cursor);
  s.images.cancel();s.images.activePage=null;if(input.cursor===null)s.images.pages.clear();
  let anchor=null;if(input.cursor!==null){const record=s.cursors.get(input.cursor);if(!record)fail('cursor_not_found');if(this.monotonic()>=record.deadline)fail('cursor_expired');if(s.pageCount>=LIMITS.pages)fail('history_limit');anchor=record.anchor;}else{s.cursors.clear();s.pageCount=0;}
  const operation=(async()=>{try{
   await this._open(s,retiring);
   await this._verify(s);const page=await this.transport.read(this._binding(s),{anchor,signal:s.abort.signal,assertCurrent:()=>this._assert(s)});this._assert(s);await this._verify(s);this._assert(s);
   const imagePage=s.images.add(page,page.imageDescriptors||[],{reset:input.cursor===null});
   s.pageCount++;if(input.cursor)s.cursors.delete(input.cursor);let nextCursor=null;if(page.anchor&&s.pageCount<LIMITS.pages){nextCursor=randomUUID();s.cursors.set(nextCursor,{anchor:page.anchor,deadline:this.monotonic()+300000});}
   return {...correlation(s),qqAccountId:binding.qqAccountId,ownerId:binding.ownerId,page:{kind:'owner-history',pageId:imagePage.pageId,rows:imagePage.rows,nextCursor,continuation:nextCursor?'available':s.pageCount>=LIMITS.pages?'limit':'unavailable',pageNumber:s.pageCount,source:'bridge-observed',completeHistory:false,mediaLoaded:false,fetchedAt:new Date(this.now()).toISOString()}};
  }catch(error){if(this.session===s)void this._retire();throw new QQOwnerHistoryError(safeCode(error));}})();s.pending=operation;try{return await operation;}finally{if(s.pending===operation)s.pending=null;}
 }
 open(input){
  request(input);const binding=this._capture(input),old=this.admission;
  if(old&&old.accountId===input.accountId&&old.panelId===input.panelId&&same(old.binding,binding))return {...correlation(input),qqAccountId:binding.qqAccountId,ownerId:binding.ownerId,opened:true};
  void this.closeCurrent();this.admission={...correlation(input),binding};
  return {...correlation(input),qqAccountId:binding.qqAccountId,ownerId:binding.ownerId,opened:true};
 }
 async send(input){
  composerRequest(input);const capturedBinding=this._capture(input),admission=this.admission;
  if(!admission||admission.accountId!==input.accountId||admission.panelId!==input.panelId||!same(admission.binding,capturedBinding))fail('changed');
  let record;
  const submission=await this.submissions.submit(input,capturedBinding,async onAttempt=>{
   // Only a fresh submit captures the recorder; replaying a receipt cannot
   // restore metadata removed by a later forget action.
   try{record=this.captureSubmission(capturedBinding);}catch{}
   // The initial send opens the same independent management connection without
   // reading conversation history, starting AI, or accepting a renderer peer.
   const {binding,s,retiring}=this._acquire(input);
   if(!same(binding,capturedBinding))fail('changed');
   const operation=(async()=>{try{await this._open(s,retiring);await this._verify(s);return await this.composerTransport.send(this._binding(s),{text:input.text,signal:s.abort.signal,assertCurrent:()=>this._assert(s),onAttempt});}catch(error){if(this.session===s)void this._retire();throw error;}})();s.pending=operation;
   try{return await operation;}finally{if(s.pending===operation)s.pending=null;}
  });
  // Only fixed captured identity and bounded outcome metadata cross this hook.
  // Never let a local recording failure erase acceptance or trigger a resend.
  try{if(typeof record==='function')record({id:input.submissionId,media:'text',outcome:submission.outcome,messageId:submission.messageId});}catch{}
  return {...correlation(input),qqAccountId:capturedBinding.qqAccountId,ownerId:capturedBinding.ownerId,submission};
 }
 _imageSession(input,kind){imageRequest(input,kind);const s=this.session;if(!s||s.accountId!==input.accountId||s.panelId!==input.panelId)fail('changed');this._assert(s);if(s.pending)fail('operation_in_progress');return s;}
 imagePage(input){const s=this._imageSession(input,'page');return {...correlation(s),qqAccountId:s.binding.qqAccountId,ownerId:s.binding.ownerId,...s.images.select(input.pageId)};}
 async imagePreview(input){const s=this._imageSession(input,'preview');const result=await s.images.preview(input);this._assert(s);return {...correlation(s),qqAccountId:s.binding.qqAccountId,ownerId:s.binding.ownerId,...result};}
 async imageClose(input){imageRequest(input,'close');const s=this.session;if(s&&s.accountId===input.accountId&&s.panelId===input.panelId&&s.images.operation?.pageId===input.pageId)await s.images.cancel(input.requestId);return {...correlation(input),closed:true};}
 querySend(input){composerRequest(input,true);const binding=this._capture(input);return {...correlation(input),qqAccountId:binding.qqAccountId,ownerId:binding.ownerId,submission:this.submissions.query(input,binding)};}
 _retire(){const s=this.session;this.session=null;if(!s)return this.retiring;clearInterval(s.timer);s.cursors.clear();const images=s.images.close();s.abort.abort();try{s.client?.close();}catch{}this.retiringSession=s;const pending=Promise.allSettled([this.retiring,s.pending,images]).then(()=>({closed:true})).finally(()=>{if(this.retiringSession===s)this.retiringSession=null;});this.retiring=pending;return pending;}
 closeOwned(input){request(input);if(this.admission?.accountId===input.accountId&&this.admission?.panelId===input.panelId)this.admission=null;const s=this.session;if(!s||s.accountId!==input.accountId||s.panelId!==input.panelId){const old=this.retiringSession;return(old&&old.accountId===input.accountId&&old.panelId===input.panelId?this.retiring:Promise.resolve()).then(()=>({...correlation(input),closed:true}));}return this._retire().then(()=>({...correlation(input),closed:true}));}
 closeCurrent(){this.admission=null;return this._retire();}
 observe(){try{if(this.admission&&!same(this.admission.binding,this._capture(this.admission)))fail('changed');if(this.session)this._assert(this.session,!!this.session.socket);}catch{void this.closeCurrent();}}
 close(){this.closed=true;this.admission=null;return this._retire();}
}
async function ownerHistoryResult(input,operation){try{return {ok:true,...await operation()};}catch(error){return {ok:false,...(profileId(input?.accountId)?{accountId:input.accountId}:{}),...(uuid(input?.panelId)?{panelId:input.panelId}:{}),code:safeCode(error)};}}
module.exports={QQOwnerHistorySession,ownerHistoryResult,ownerComposerResult,historyImageResult,request};
