'use strict';
// Fixed-owner management-session ownership adapter. Reuses the fixed-owner production panel and
// controller; never borrows an AI client or accepts a recipient/action from UI.
const {QQClient,validateQQOwner,validateQQUrl}=require('./qq.cjs');
const {openManagementClient}=require('./qq-management-client.cjs');
const {QQOwnerRemarkPanel}=require('./qq-owner-remark-panel.cjs');
const {QQOwnerRemarkError,validateRemark,safeCode}=require('./qq-owner-remark.cjs');
const fail=code=>{throw new QQOwnerRemarkError(code);};
const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&(Object.getPrototypeOf(v)===Object.prototype||Object.getPrototypeOf(v)===null);
const reference=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const profileId=v=>typeof v==='string'&&/^[a-zA-Z0-9-]{1,64}$/.test(v);
const uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(v);
const text=(v,max)=>typeof v==='string'&&v.length>0&&v.length<=max&&!/[\p{Cc}\p{Cf}\uD800-\uDFFF]/u.test(v);
const correlation=v=>({accountId:v.accountId,panelId:v.panelId});
const recipient=v=>({accountId:v.qqAccountId,ownerId:v.ownerId,role:v.role});
function request(value,kind='read'){
  const keys=['accountId','panelId',...(['set','restore'].includes(kind)?['ticketId']:[]),...(kind==='set'?['remark']:[])];
  if(!plain(value)||Object.keys(value).sort().join('|')!==keys.sort().join('|')||!profileId(value.accountId)||!uuid(value.panelId))fail('invalid_request');
  if(['set','restore'].includes(kind)&&!uuid(value.ticketId))fail('invalid_request');
  if(kind==='set')validateRemark(value.remark);
  return value;
}
const KEYS=['profileId','panelId','profile','generation','characterId','role','runtime','installation','runtimeEpoch','bridgeRevision','endpointId','qqAccountId','ownerId','url','token','channel','status'];
const same=(a,b)=>KEYS.every(k=>a[k]===b[k]);
function captured(raw,input){
  if(!plain(raw)||raw.profileId!==input.accountId||raw.panelId!==input.panelId||!reference(raw.profile)||!reference(raw.runtime)||!reference(raw.installation)||raw.channel!=='qq'||!['disconnected','connected'].includes(raw.status))fail('unavailable');
  if(!Number.isSafeInteger(raw.generation)||raw.generation<0||!Number.isSafeInteger(raw.runtimeEpoch)||raw.runtimeEpoch<0||!text(raw.characterId,128)||!text(raw.role,64)||!text(raw.bridgeRevision,128)||!text(raw.endpointId,256))fail('unavailable');
  let qqAccountId,ownerId,url;
  try{qqAccountId=validateQQOwner(raw.qqAccountId);ownerId=validateQQOwner(raw.ownerId);url=validateQQUrl(raw.url);}catch{fail('unavailable');}
  if(qqAccountId===ownerId||typeof raw.token!=='string'||!/^[\x21-\x7e]{16,256}$/.test(raw.token))fail('unavailable');
  return Object.freeze(Object.fromEntries(KEYS.map(k=>[k,k==='qqAccountId'?qqAccountId:k==='ownerId'?ownerId:k==='url'?url:raw[k]])));
}
class QQOwnerRemarkSession {
  constructor({capture,verifyContext,clientFactory=options=>new QQClient(options),panelFactory=options=>new QQOwnerRemarkPanel(options)}={}){
    if([capture,verifyContext,clientFactory,panelFactory].some(v=>typeof v!=='function'))fail('invalid_request');
    Object.assign(this,{capture,verifyContext,clientFactory,panelFactory});
    this.session=null;this.retiringSession=null;this.retiring=Promise.resolve();this.closed=false;
  }
  _capture(input){
    if(this.closed)fail('closed');const raw=this.capture(correlation(input));
    if(raw?.then){raw.catch?.(()=>{});fail('invalid_request');}
    return captured(raw,input);
  }
  _assert(session,ready=true){
    if(this.closed||this.session!==session||session.abort.signal.aborted||!same(session.binding,this._capture(session)))fail('changed');
    if(ready){const c=session.client,b=session.binding;
      if(!c?.ready||c.closed||c.socket?.readyState!==1||c.socket!==session.socket||c.generation!==session.clientGeneration||c.accountId!==b.qqAccountId||c.expectedAccountId!==b.qqAccountId||c.ownerId!==b.ownerId)fail('disconnected');
    }
  }
  async _verify(session,ready=true){
    this._assert(session,ready);const result=await this.verifyContext(session.binding,{signal:session.abort.signal});this._assert(session,ready);
    if(!plain(result)||Object.keys(result).length!==1||result.verified!==true)fail('changed');
  }
  _panelCapture(session){
    this._assert(session);const b=session.binding,c=session.client;
    const scopeId=`owner-remark:${b.profileId}:${b.characterId}`;
    const binding={status:'connected',channel:'qq',generation:b.generation,scopeId,accountId:b.qqAccountId,ownerId:b.ownerId,role:b.role,client:c};
    return {...correlation(session),service:b.profile,generation:b.generation,scopeId,client:c,clientGeneration:c.generation,
      qqAccountId:b.qqAccountId,ownerId:b.ownerId,role:b.role,runtime:b.runtime,console:b.runtime,epoch:b.runtimeEpoch,binding};
  }
  availability(input){
    request(input);try{const b=this._capture(input);return {...correlation(input),available:true,recipient:recipient(b)};}
    catch(error){return {...correlation(input),available:false,reason:safeCode(error)};}
  }
  async read(input){
    request(input);const binding=this._capture(input);let s=this.session;if(s?.pending)fail('operation_in_progress');
    const fresh=!s||s.accountId!==input.accountId||s.panelId!==input.panelId||!same(s.binding,binding);
    let retiring=Promise.resolve();
    if(fresh){retiring=this._retire();s={...correlation(input),binding,abort:new AbortController(),client:null,socket:null,clientGeneration:null,panel:null,pending:null,ticketId:null,timer:null};this.session=s;}
    const operation=(async()=>{try{
      if(fresh){
        const c=await openManagementClient({retiring,verify:()=>this._verify(s,false),assertCurrent:()=>this._assert(s,false),clientFactory:this.clientFactory,onCreated:client=>{s.client=client;},options:{url:binding.url,token:binding.token,ownerId:binding.ownerId,expectedAccountId:binding.qqAccountId},signal:s.abort.signal,requiredMethods:['readOwnerRemark','setOwnerRemark']});
        this._assert(s,false);s.socket=c.socket;s.clientGeneration=c.generation;this._assert(s);
        c.socket.once('close',()=>{if(this.session===s)void this._retire();});
        s.panel=this.panelFactory({capture:()=>this._panelCapture(s)});
        if(!s.panel||['read','set','restore','close'].some(k=>typeof s.panel[k]!=='function'))fail('invalid_response');
        s.timer=setInterval(()=>this.observe(),250);s.timer.unref?.();
      }
      await this._verify(s);s.ticketId=null;const result=await s.panel.read(correlation(s));this._assert(s);
      if(result.accountId!==s.accountId||result.panelId!==s.panelId||result.recipient?.accountId!==binding.qqAccountId||result.recipient?.ownerId!==binding.ownerId||result.recipient?.role!==binding.role)fail('invalid_response');
      s.ticketId=result.editable&&uuid(result.ticketId)?result.ticketId:null;
      return result;
    }catch(error){if(this.session===s)void this._retire();throw new QQOwnerRemarkError(safeCode(error));}})();
    s.pending=operation;try{return await operation;}finally{if(s.pending===operation)s.pending=null;}
  }
  _get(input){
    const s=this.session;if(!s||s.accountId!==input.accountId||s.panelId!==input.panelId)fail('stale_ticket');
    if(s.pending)fail('operation_in_progress');this._assert(s);return s;
  }
  async _write(input,restore){
    request(input,restore?'restore':'set');const s=this._get(input);
    if(s.ticketId!==input.ticketId)fail('stale_ticket');s.ticketId=null;
    const uncertain=(outcome,code)=>({...correlation(s),recipient:recipient(s.binding),kind:'owner-remark',ticketId:input.ticketId,outcome,code,observation:{state:'unavailable',source:'bridge-cache'}});
    const operation=(async()=>{let invoked=false;try{
      await this._verify(s);this._assert(s);invoked=true;
      const result=await s.panel[restore?'restore':'set']({...correlation(s),ticketId:input.ticketId,...(!restore?{remark:input.remark}:{})});
      // Production panel projects fixed captured outcomes and intentionally
      // preserves an acknowledgement even after the owned context is closed.
      return {...result,recipient:recipient(s.binding)};
    }catch(error){return uncertain(invoked?'unknown':'not_submitted',invoked?'change_unknown':safeCode(error));}})();
    s.pending=operation;try{return await operation;}finally{if(s.pending===operation)s.pending=null;}
  }
  set(input){return this._write(input,false);}
  restore(input){return this._write(input,true);}
  _retire(){
    const s=this.session;this.session=null;if(!s)return this.retiring;
    clearInterval(s.timer);s.ticketId=null;s.abort.abort();try{s.client?.close();}catch{}
    this.retiringSession=s;
    const operation=Promise.allSettled([this.retiring,s.pending,s.panel?.close()]).then(()=>({closed:true})).finally(()=>{if(this.retiringSession===s)this.retiringSession=null;});
    this.retiring=operation;return operation;
  }
  closeOwned(input){
    request(input);const s=this.session;
    if(!s||s.accountId!==input.accountId||s.panelId!==input.panelId){const old=this.retiringSession;return (old&&old.accountId===input.accountId&&old.panelId===input.panelId?this.retiring:Promise.resolve()).then(()=>({...correlation(input),closed:true}));}
    return this._retire().then(()=>({...correlation(input),closed:true}));
  }
  closeCurrent(){return this._retire();}
  observe(){if(this.session)try{this._assert(this.session,!!this.session.panel);}catch{void this._retire();}}
  close(){this.closed=true;return this._retire();}
}
module.exports={QQOwnerRemarkSession};
