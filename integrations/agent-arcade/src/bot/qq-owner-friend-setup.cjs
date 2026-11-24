'use strict';
// Main-process temporary management session. No AI startup, model, message polling,
// account login, durable inbox or arbitrary renderer action.
const {randomUUID}=require('node:crypto');
const {QQClient,validateQQOwner,validateQQUrl}=require('./qq.cjs');
const {FriendRequestInbox}=require('./qq-friend-requests.cjs');
const CODES=new Set(['invalid_request','unconfigured','account_connected','account_offline','status_unverified','changed','operation_in_progress','disconnected','closed','unknown','invalid_response','cancelled','expired','stale_request','account_changed','account_mismatch','bridge_unhealthy','heartbeat_timeout','unauthorized','connect_failed','connect_timeout','login_required']);
const error=code=>Object.assign(new Error('The fixed-owner management connection is unavailable.'),{code:CODES.has(code)?code:'invalid_response'});
const safeCode=value=>value?.code==='aborted'?'cancelled':CODES.has(value?.code)?value.code:'invalid_response';
const object=value=>value&&typeof value==='object'&&!Array.isArray(value);
const id=value=>typeof value==='string'&&/^[a-zA-Z0-9-]{1,64}$/.test(value);
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
const correlation=value=>({accountId:value.accountId,panelId:value.panelId});
function request(value,decide=false){
  const keys=['accountId','panelId',...(decide?['requestId','approve']:[])];
  if(!object(value)||Object.keys(value).length!==keys.length||keys.some(key=>!Object.hasOwn(value,key))||!id(value.accountId)||!uuid(value.panelId)||decide&&(!uuid(value.requestId)||typeof value.approve!=='boolean'))throw error('invalid_request');return value;
}
function normalized(value,input){
  if(!object(value)||value.profileId!==input.accountId||!object(value.profile)||!object(value.runtime)||!object(value.installation)||value.channel!=='qq')throw error('unconfigured');
  if(value.status!=='disconnected')throw error('account_connected');
  if(!Number.isSafeInteger(value.generation)||value.generation<0||!Number.isSafeInteger(value.runtimeEpoch)||value.runtimeEpoch<0||typeof value.characterId!=='string'||!value.characterId||value.characterId.length>128||typeof value.bridgeRevision!=='string'||!value.bridgeRevision||value.bridgeRevision.length>128)throw error('unconfigured');
  let accountId,ownerId,url;
  try{accountId=validateQQOwner(value.qqAccountId);ownerId=validateQQOwner(value.ownerId);url=validateQQUrl(value.url);}catch{throw error('unconfigured');}
  if(accountId===ownerId||typeof value.token!=='string'||!/^[\x21-\x7e]{16,256}$/.test(value.token))throw error('unconfigured');
  return {...value,qqAccountId:accountId,ownerId,url};
}
const KEYS=['profileId','profile','generation','characterId','runtime','installation','runtimeEpoch','bridgeRevision','qqAccountId','ownerId','url','token','channel','status'];
const equal=(a,b)=>KEYS.every(key=>a[key]===b[key]);
class OwnerFriendSetup{
  constructor({capture,verifyContext,clientFactory=options=>new QQClient(options),now=Date.now}={}){
    if([capture,verifyContext,clientFactory,now].some(value=>typeof value!=='function'))throw error('invalid_request');
    Object.assign(this,{capture,verifyContext,clientFactory,now});this.session=null;this.retiringSession=null;this.retiring=Promise.resolve();this.closed=false;
  }
  _capture(input){if(this.closed)throw error('closed');const value=this.capture(correlation(input));if(value?.then){value.catch?.(()=>{});throw error('invalid_request');}return normalized(value,input);}
  _assert(session,{ready=false}={}){
    if(this.closed||this.session!==session||session.abort.signal.aborted)throw error('changed');
    const current=this._capture(session);if(!equal(session.binding,current))throw error('changed');
    if(ready&&(!session.client?.ready||session.client.closed||session.client.socket?.readyState!==1||session.client.accountId!==session.binding.qqAccountId||session.client.ownerId!==session.binding.ownerId||session.client.generation!==session.clientGeneration||session.client.socket!==session.socket))throw error('disconnected');
    return current;
  }
  _binding(session){
    this._assert(session,{ready:true});if(session.state!=='listening')throw error('disconnected');
    return {status:'connected',channel:'qq',generation:session.binding.generation,scopeId:session.scopeId,accountId:session.binding.qqAccountId,ownerId:session.binding.ownerId,client:session.client,connectedAt:session.client.connectedAt};
  }
  async _verify(session){this._assert(session);const result=await this.verifyContext(session.binding,{signal:session.abort.signal});this._assert(session);if(!object(result)||Object.keys(result).length!==1||result.verified!==true)throw error('changed');}
  availability(input){
    request(input);try{const b=this._capture(input),s=this.session,live=s&&s.accountId===input.accountId&&s.panelId===input.panelId&&equal(s.binding,b)&&s.state==='listening'&&s.client.ready&&!s.client.closed;
      return {...correlation(input),available:true,qqAccountId:b.qqAccountId,ownerId:b.ownerId,status:live?'listening':'not_started'};
    }catch(cause){return {...correlation(input),available:false,reason:safeCode(cause),status:'not_started'};}
  }
  _read(session){
    this._assert(session,{ready:true});const inbox=session.inbox.list();if(!inbox.available)throw error('disconnected');
    return {...correlation(session),kind:'owner-friend-setup',status:'listening',qqAccountId:session.binding.qqAccountId,ownerId:session.binding.ownerId,inbox};
  }
  async start(input){
    request(input);const binding=this._capture(input);if(this.session?.opening||this.session?.deciding)throw error('operation_in_progress');
    if(this.session&&this.session.accountId===input.accountId&&this.session.panelId===input.panelId){this._assert(this.session,{ready:true});return this._read(this.session);}
    const retiring=this._retire(),session={...correlation(input),binding,scopeId:`owner-friend-setup:${randomUUID()}`,abort:new AbortController(),client:null,clientGeneration:null,socket:null,inbox:null,state:'starting',opening:null,deciding:null,timer:null};this.session=session;
    const operation=(async()=>{
      try{
        await retiring;this._assert(session);await this._verify(session);this._assert(session);
        session.inbox=new FriendRequestInbox({getBinding:()=>this._binding(session),now:this.now});
        session.client=this.clientFactory({url:binding.url,token:binding.token,ownerId:binding.ownerId,expectedAccountId:binding.qqAccountId,receiveOwnerMessages:false,allowOwnerVoice:false,now:this.now,
          onFriendRequest:(event,source)=>{let applicant;try{applicant=validateQQOwner(event?.user_id);}catch{return;}if(applicant===binding.ownerId)session.inbox?.receive(event,source);}
        });
        if(!session.client||session.client.receiveOwnerMessages!==false||typeof session.client.connect!=='function'||typeof session.client.close!=='function'||typeof session.client.decideFriendRequest!=='function')throw error('invalid_response');
        await session.client.connect(session.abort.signal);this._assert(session);
        session.clientGeneration=session.client.generation;session.socket=session.client.socket;this._assert(session,{ready:true});
        session.socket.once('close',()=>{if(this.session===session)void this._retire();});
        await this._verify(session);session.state='listening';
        session.timer=setInterval(()=>this.observe(),250);session.timer.unref?.();return this._read(session);
      }catch(cause){
        if(this.session===session)this.session=null;session.abort.abort();clearInterval(session.timer);session.client?.close();await session.inbox?.close();throw error(safeCode(cause));
      }
    })();session.opening=operation;try{return await operation;}finally{if(session.opening===operation)session.opening=null;}
  }
  read(input){request(input);const s=this.session;if(!s||s.accountId!==input.accountId||s.panelId!==input.panelId)throw error('disconnected');if(s.opening||s.deciding)throw error('operation_in_progress');return this._read(s);}
  async decide(input){
    request(input,true);const s=this.session;if(!s||s.accountId!==input.accountId||s.panelId!==input.panelId)throw error('stale_request');if(s.opening||s.deciding)throw error('operation_in_progress');this._assert(s,{ready:true});
    const base={...correlation(s),kind:'friend-request',qqAccountId:s.binding.qqAccountId,ownerId:s.binding.ownerId,requestId:input.requestId,approve:input.approve};
    const operation=(async()=>{let invoked=false;try{
      await this._verify(s);this._assert(s,{ready:true});invoked=true;
      const receipt=await s.inbox.decide({requestId:input.requestId,approve:input.approve},{signal:s.abort.signal,assertCurrent:()=>this._assert(s,{ready:true})});
      if(receipt?.kind!=='friend-request'||receipt.accountId!==base.qqAccountId||receipt.requestId!==input.requestId||receipt.approve!==input.approve||!['accepted','unknown','not_submitted'].includes(receipt.outcome))return {...base,outcome:'unknown',code:'unknown'};
      return {...base,outcome:receipt.outcome,...(receipt.outcome==='accepted'?{}:{code:receipt.outcome==='unknown'?'unknown':safeCode(receipt)})};
    }catch(cause){return {...base,outcome:invoked?'unknown':'not_submitted',code:invoked?'unknown':safeCode(cause)};}})();
    s.deciding=operation;try{return await operation;}finally{if(s.deciding===operation)s.deciding=null;}
  }
  _retire(){
    const s=this.session;this.session=null;if(!s)return this.retiring;
    clearInterval(s.timer);s.abort.abort();try{s.client?.close();}catch{}
    this.retiringSession=s;const closing=Promise.allSettled([this.retiring,s.opening,s.deciding,s.inbox?.close()]).then(()=>({closed:true})).finally(()=>{if(this.retiringSession===s)this.retiringSession=null;});this.retiring=closing;return closing;
  }
  closeOwned(input){request(input);const s=this.session;if(!s||s.accountId!==input.accountId||s.panelId!==input.panelId){const old=this.retiringSession;return (old&&old.accountId===input.accountId&&old.panelId===input.panelId?this.retiring:Promise.resolve()).then(()=>({...correlation(input),closed:true}));}return this._retire().then(()=>({...correlation(input),closed:true}));}
  observe(){const s=this.session;if(s)try{this._assert(s,{ready:s.state==='listening'});}catch{void this._retire();}}
  close(){this.closed=true;return this._retire().then(()=>({closed:true}));}
}
module.exports={OwnerFriendSetup,safeCode};
