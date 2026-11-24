'use strict';
// Each avatar panel owns a request-only socket; the AI connection is never lent.
const path=require('node:path');
const {randomUUID,createHash}=require('node:crypto');
const {QQClient,validateQQOwner,validateQQUrl}=require('./qq.cjs');
const {readSelected,canonicalImage}=require('./qq-media.cjs');
const {QQAvatarUploadStore}=require('./qq-avatar-store.cjs');
const {LIMITS,codeOf,fail,plain,uuid,identity,submitAvatar}=require('./qq-avatar.cjs');
const id=value=>typeof value==='string'&&/^[a-zA-Z0-9-]{1,64}$/.test(value);
const KEYS=['profileId','panelId','profile','generation','characterId','runtime','installation','runtimeEpoch','bridgeRevision','qqAccountId','ownerId','url','token','channel','status','endpointId'];
const same=(a,b)=>KEYS.every(key=>a[key]===b[key]);
const correlation=value=>({accountId:value.accountId,panelId:value.panelId});
function request(value,confirm=false){const keys=['accountId','panelId',...(confirm?['ticketId']:[])];if(!plain(value)||Object.keys(value).sort().join('|')!==keys.sort().join('|')||!id(value.accountId)||!uuid(value.panelId)||confirm&&!uuid(value.ticketId))fail('invalid_request');return value;}
function captured(value,input){
 if(!plain(value)||value.profileId!==input.accountId||value.panelId!==input.panelId||!plain(value.profile)||!plain(value.runtime)||!plain(value.installation)||value.channel!=='qq'||!['connected','disconnected'].includes(value.status))fail('unconfigured');
 if(!Number.isSafeInteger(value.generation)||value.generation<0||!Number.isSafeInteger(value.runtimeEpoch)||value.runtimeEpoch<0||typeof value.characterId!=='string'||!value.characterId||value.characterId.length>128||typeof value.bridgeRevision!=='string'||!value.bridgeRevision||value.bridgeRevision.length>128||typeof value.endpointId!=='string'||!value.endpointId||value.endpointId.length>256)fail('unconfigured');
 let accountId,ownerId,url;try{accountId=validateQQOwner(value.qqAccountId);ownerId=validateQQOwner(value.ownerId);url=validateQQUrl(value.url);}catch{fail('unconfigured');}
 if(accountId===ownerId||typeof value.token!=='string'||!/^[\x21-\x7e]{16,256}$/.test(value.token))fail('unconfigured');return Object.freeze(Object.fromEntries(KEYS.map(key=>[key,key==='qqAccountId'?accountId:key==='ownerId'?ownerId:key==='url'?url:value[key]])));
}
class QQAvatarSession{
 constructor({capture,verifyContext,clientFactory=options=>new QQClient(options),nativeImage,uploadRoot,uploadStore,now=Date.now,monotonic=()=>performance.now()}={}){
  if([capture,verifyContext,clientFactory,now,monotonic].some(v=>typeof v!=='function'))fail('invalid_request');Object.assign(this,{capture,verifyContext,clientFactory,nativeImage,uploadRoot,uploadStore,now,monotonic});this.session=null;this.retiring=Promise.resolve();this.retiringSession=null;this.closed=false;
 }
 _store(){return this.uploadStore||(this.uploadStore=new QQAvatarUploadStore({root:this.uploadRoot,now:this.now}));}
 _capture(input){if(this.closed)fail('closed');const value=this.capture(correlation(input));if(value?.then){value.catch?.(()=>{});fail('invalid_request');}return captured(value,input);}
 _assert(s,ready=true){if(this.closed||this.session!==s||s.abort.signal.aborted||!same(s.binding,this._capture(s)))fail('changed');if(ready){const c=s.client;if(!c?.ready||c.closed||c.socket?.readyState!==1||c.accountId!==s.binding.qqAccountId||c.ownerId!==s.binding.ownerId||c.expectedAccountId!==s.binding.qqAccountId||c.generation!==s.clientGeneration||c.socket!==s.socket)fail('disconnected');}}
 _binding(s){this._assert(s);return {accountId:s.binding.qqAccountId,client:s.client,clientGeneration:s.clientGeneration,socket:s.socket};}
 async _verify(s,ready=true){this._assert(s,ready);const result=await this.verifyContext(s.binding,{signal:s.abort.signal});this._assert(s,ready);if(!plain(result)||Object.keys(result).length!==1||result.verified!==true)fail('changed');}
 _envelope(s){return {...correlation(s),qqAccountId:s.binding.qqAccountId,kind:'qq-avatar'};}
 _scope(s){return createHash('sha256').update(JSON.stringify([s.accountId,s.binding.qqAccountId])).digest('hex');}
 _clear(s){s.ticket?.bytes.fill(0);s.ticket=null;s.selectionEpoch++;}
 _get(input){const s=this.session;if(!s||s.accountId!==input.accountId||s.panelId!==input.panelId)fail('changed');if(s.pending)fail('operation_in_progress');this._assert(s);return s;}
 async _run(s,operation){const promise=Promise.resolve().then(operation);s.pending=promise;try{return await promise;}finally{if(s.pending===promise)s.pending=null;}}
 async read(input){
  request(input);const binding=this._capture(input);let s=this.session;if(s?.pending)fail('operation_in_progress');const fresh=!s||s.accountId!==input.accountId||s.panelId!==input.panelId||!same(s.binding,binding);let retiring=Promise.resolve();
  if(fresh){retiring=this._retire();s={...correlation(input),binding,abort:new AbortController(),client:null,socket:null,clientGeneration:null,pending:null,ticket:null,selectionEpoch:0,timer:null};this.session=s;}
  return this._run(s,async()=>{try{
   if(fresh){await retiring;this._assert(s,false);await this._verify(s,false);this._assert(s,false);const c=this.clientFactory({url:binding.url,token:binding.token,ownerId:binding.ownerId,expectedAccountId:binding.qqAccountId,receiveOwnerMessages:false,allowOwnerVoice:false});s.client=c;
    if(!c||c.receiveOwnerMessages!==false||typeof c.connect!=='function'||typeof c.close!=='function'||typeof c._request!=='function')fail('invalid_response');await c.connect(s.abort.signal);this._assert(s,false);s.clientGeneration=c.generation;s.socket=c.socket;this._assert(s);c.socket.once('close',()=>{if(this.session===s)void this._retire();});s.timer=setInterval(()=>this.observe(),250);s.timer.unref?.();
   }
   this._clear(s);await this._verify(s);this._assert(s);await identity(this._binding(s),{signal:s.abort.signal,assertCurrent:()=>this._assert(s)});this._assert(s);this._store().cleanup(this._scope(s),{expiredOnly:true});const counts=this._store().summary(this._scope(s));
   return {...this._envelope(s),profile:{capabilities:{choose:true,submit:true,currentAvatar:false},currentAvatar:{state:'unavailable',reason:'readback_unavailable'},limits:{...LIMITS},...counts}};
  }catch(error){if(this.session===s)void this._retire();throw Object.assign(Error('QQ avatar management did not open.'),{code:codeOf(error)});}});
 }
 select(input,{pickFile,file}={}){
  request(input);const s=this._get(input);if((typeof pickFile!=='function')===(typeof file!=='string'))fail('invalid_request');this._clear(s);const epoch=s.selectionEpoch;
  return this._run(s,async()=>{let raw,prepared;try{
   this._assert(s);const selected=pickFile?await pickFile({signal:s.abort.signal}):file;this._assert(s);if(epoch!==s.selectionEpoch)fail('changed');if(selected===null)return {...this._envelope(s),cancelled:true};if(typeof selected!=='string')fail('invalid_request');
   raw=await readSelected(selected,s.abort.signal);this._assert(s);if(epoch!==s.selectionEpoch)fail('changed');prepared=canonicalImage(raw,path.extname(selected).toLowerCase(),this.nativeImage);if(prepared.width!==prepared.height)fail('image_not_square');this._assert(s);if(epoch!==s.selectionEpoch)fail('changed');
   const ticket={...prepared,id:randomUUID(),expiresAt:this.now()+300000,deadline:this.monotonic()+300000};s.ticket=ticket;prepared=null;
   return {...this._envelope(s),draft:{ticketId:ticket.id,expiresAt:ticket.expiresAt,width:ticket.width,height:ticket.height,bytes:ticket.bytes.length,preview:ticket.preview}};
  }catch(error){throw Object.assign(Error('QQ avatar selection did not complete.'),{code:codeOf(error)});}finally{raw?.fill(0);prepared?.bytes.fill(0);}});
 }
 confirm(input){
  request(input,true);const s=this._get(input),ticket=s.ticket;if(!ticket||ticket.id!==input.ticketId)fail('stale_ticket');s.ticket=null;s.selectionEpoch++;
  return this._run(s,async()=>{let upload,outcome='not_submitted',code,acknowledgement,temporaryFile='none',cleanupIssue;
   try{if(this.monotonic()>=ticket.deadline)fail('expired_ticket');await this._verify(s);this._assert(s);const binding=this._binding(s);await identity(binding,{signal:s.abort.signal,assertCurrent:()=>this._assert(s)});this._assert(s);if(this.monotonic()>=ticket.deadline)fail('expired_ticket');
    upload=this._store().create(ticket.bytes,this._scope(s));const result=await submitAvatar(binding,upload,{signal:s.abort.signal,assertCurrent:()=>{this._assert(s);if(this.monotonic()>=ticket.deadline)fail('expired_ticket');}});outcome=result.outcome;code=result.code;acknowledgement=result.acknowledgement;
   }catch(error){code=codeOf(error);}finally{
    ticket.bytes.fill(0);
    if(upload){if(outcome==='unknown'){upload.retain();temporaryFile='retained';}else{if(outcome==='accepted')try{upload.markSettled();}catch{}const cleaned=upload.discard();temporaryFile=cleaned.removed?'removed':'retained';if(!cleaned.removed)cleanupIssue='cleanup_incomplete';}}
   }
   // Never reassert the current panel after a real ack: navigation cannot undo it.
   return {...this._envelope(s),change:{ticketId:ticket.id,outcome,...(acknowledgement?{acknowledgement}:{}),...(code?{code}:{}),visibleResult:'unverified',temporaryFile,...(cleanupIssue?{cleanupIssue}:{}),automaticRetry:false,automaticRestore:false}};
  });
 }
 dismiss(input){request(input);const s=this.session;if(s&&s.accountId===input.accountId&&s.panelId===input.panelId){this._clear(s);return {...this._envelope(s),dismissed:true};}return {...correlation(input),dismissed:true};}
 cleanup(input){request(input);const s=this._get(input);this._assert(s);const store=this._store(),scope=this._scope(s),cleanup=store.cleanup(scope);return {...this._envelope(s),cleanup,...store.summary(scope)};}
 _retire(){const s=this.session;this.session=null;if(!s)return this.retiring;clearInterval(s.timer);this._clear(s);s.abort.abort();try{s.client?.close();}catch{}this.retiringSession=s;const pending=Promise.allSettled([this.retiring,s.pending]).then(()=>({closed:true})).finally(()=>{if(this.retiringSession===s)this.retiringSession=null;});this.retiring=pending;return pending;}
 closeOwned(input){request(input);const s=this.session;if(!s||s.accountId!==input.accountId||s.panelId!==input.panelId){const old=this.retiringSession;return (old&&old.accountId===input.accountId&&old.panelId===input.panelId?this.retiring:Promise.resolve()).then(()=>({...correlation(input),closed:true}));}return this._retire().then(()=>({...correlation(input),closed:true}));}
 closeCurrent(){return this._retire();}
 observe(){if(this.session)try{this._assert(this.session,!!this.session.clientGeneration);}catch{void this._retire();}}
 close(){this.closed=true;return this._retire();}
}
async function avatarResult(input,operation){const envelope=plain(input)&&id(input.accountId)&&uuid(input.panelId)?correlation(input):{};try{return {ok:true,...await operation()};}catch(error){return {ok:false,...envelope,code:codeOf(error),error:'QQ avatar operation did not complete.'};}}
module.exports={QQAvatarSession,avatarResult,codeOf};
