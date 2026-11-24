'use strict';
// Scoped WAV preview and single-use send controller. Owned local
// TTS output may be prepared by main; no synthesis, playback or automatic sends.
const {randomUUID}=require('node:crypto');
const {readSelectedMedia}=require('./qq-media-file.cjs');
const {canonicalWav,QQVoiceError,MAX_BYTES}=require('./qq-voice-payload.cjs');
const fail=code=>{throw new QQVoiceError(code);};
const safe=error=>new QQVoiceError(error?.code==='aborted'?'cancelled':error?.code).code;
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&(Object.getPrototypeOf(value)===Object.prototype||Object.getPrototypeOf(value)===null);
const checkSignal=signal=>{if(signal?.aborted)fail('cancelled');};
async function readVoiceSelection(file,signal){
  try{return await readSelectedMedia(file,{signal,extensions:['.wav'],maxBytes:MAX_BYTES});}
  catch(error){throw new QQVoiceError(({media_format:'voice_format',media_too_large:'voice_too_large'})[error?.code]||error?.code);}
}
function binding(value){
  if(!value||value.status!=='connected'||value.channel!=='qq'||!Number.isSafeInteger(value.generation)||value.generation<0||!value.client)fail('disconnected');
  if(typeof value.scopeId!=='string'||!value.scopeId||value.scopeId.length>256||/[\p{Cc}\p{Cf}]/u.test(value.scopeId))fail('invalid_request');
  const qq=id=>typeof id==='string'&&/^[1-9]\d{4,14}$/.test(id)&&Number.isSafeInteger(Number(id));
  if(!qq(value.accountId)||!qq(value.ownerId)||value.accountId===value.ownerId||value.client.ownerId!==value.ownerId||value.client.accountId!==value.accountId)fail('account_mismatch');
  if(!value.client.ready||value.client.closed||value.client.socket?.readyState!==1)fail('disconnected');
  const current={client:value.client,clientGeneration:value.client.generation,generation:value.generation,
    scopeId:value.scopeId,accountId:value.accountId,ownerId:value.ownerId,
    role:typeof value.role==='string'?value.role.replace(/[\p{Cc}\p{Cf}]/gu,'').slice(0,64):''};
  if(value.groupId===undefined)return current;
  if(!qq(value.groupId)||typeof value.roleId!=='string'||!/^[a-z0-9-]{1,64}$/.test(value.roleId)||
     !current.role||!value.route||value.groupRevision===undefined)fail('group_unavailable');
  return {...current,groupId:value.groupId,roleId:value.roleId,route:value.route,
    groupRevision:value.groupRevision,socket:value.client.socket};
}
function equalBinding(a,b){
  return ['client','clientGeneration','generation','scopeId','accountId','ownerId','role',
    'groupId','roleId','route','groupRevision','socket'].every(key=>a[key]===b[key]);
}
function recipientFor(binding){
  const {accountId,ownerId,groupId,role,roleId}=binding;
  return groupId===undefined?{accountId,ownerId,role}:{accountId,groupId,role,roleId};
}
function request(value){if(!plain(value)||Object.keys(value).length!==1||typeof value.ticketId!=='string'||!/^[a-f0-9-]{36}$/.test(value.ticketId))fail('invalid_request');return value.ticketId;}
class QQOwnerVoice {
  constructor({getBinding,now=Date.now,onChange=()=>{}}={}){if(typeof getBinding!=='function'||typeof now!=='function'||typeof onChange!=='function')fail('invalid_request');this.getBinding=getBinding;this.now=now;this.onChange=onChange;this.ticket=null;this.operation=null;this.closed=false;this.last=null;}
  _notify(){try{this.onChange();}catch{}}
  _current(expected,signal){checkSignal(signal);if(this.closed)fail('closed');const current=binding(this.getBinding());if(expected&&!equalBinding(current,expected))fail('changed');return current;}
  _clear(){this.ticket?.bytes.fill(0);this.ticket=null;}
  snapshot(){if(this.ticket){try{this._current(this.ticket.binding);if(this.now()>=this.ticket.expiresAt)this._clear();}catch{this._clear();}}if(this.last){try{this._current(this.lastBinding);}catch{this.last=null;this.lastBinding=null;}}return {busy:!!this.operation,draft:this.ticket?this._public(this.ticket,{preview:false}):null,last:this.last?{...this.last}:null};}
  _public(ticket,{preview=true}={}){return {ticketId:ticket.id,kind:'voice',sampleRate:ticket.sampleRate,channels:ticket.channels,bits:ticket.bits,durationSeconds:ticket.durationSeconds,bytes:ticket.bytes.length,expiresAt:ticket.expiresAt,...(preview?{preview:ticket.preview}:{}),recipient:recipientFor(ticket.binding)};}
  prepare(bytes,{signal}={}){
    if(this.operation)fail('operation_in_progress');const current=this._current(null,signal);let prepared;
    try{prepared=canonicalWav(bytes);this._current(current,signal);this._clear();this.last=null;this.ticket={...prepared,preview:`data:audio/wav;base64,${prepared.bytes.toString('base64')}`,id:randomUUID(),binding:current,expiresAt:this.now()+5*60*1000};prepared=null;this._notify();return this._public(this.ticket);}
    finally{prepared?.bytes.fill(0);}
  }
  async select(file,{signal}={}){
    if(this.operation)fail('operation_in_progress');const current=this._current(null,signal);this._clear();this.last=null;
    const controller=new AbortController(),combined=signal?AbortSignal.any([signal,controller.signal]):controller.signal,op={controller,promise:null};this.operation=op;
    op.promise=Promise.resolve().then(async()=>{let raw,prepared;try{raw=await readVoiceSelection(file,combined);this._current(current,combined);prepared=canonicalWav(raw);this._current(current,combined);const preview=`data:audio/wav;base64,${prepared.bytes.toString('base64')}`;this.ticket={...prepared,preview,id:randomUUID(),binding:current,expiresAt:this.now()+5*60*1000};prepared=null;return this._public(this.ticket);}catch(error){throw new QQVoiceError(safe(error));}finally{raw?.fill(0);prepared?.bytes.fill(0);if(this.operation===op)this.operation=null;this._notify();}});this._notify();return op.promise;
  }
  async send(value,{signal}={}){
    const id=request(value);if(this.operation)fail('operation_in_progress');if(!this.ticket||this.ticket.id!==id)fail('stale_ticket');
    const ticket=this.ticket;this.ticket=null;const controller=new AbortController(),combined=signal?AbortSignal.any([signal,controller.signal]):controller.signal,op={controller,promise:null};this.operation=op;this.last=null;
    op.promise=Promise.resolve().then(async()=>{
      let submitted=false;
      try{
        if(this.now()>=ticket.expiresAt)fail('expired_ticket');this._current(ticket.binding,combined);
        const {client,groupId,ownerId}=ticket.binding;
        const send=groupId===undefined?client.sendOwnerRecord:client.sendGroupRecord;
        if(typeof send!=='function')fail('disconnected');
        submitted=true;
        const receipt=await send.call(client,groupId??ownerId,ticket.bytes,id,combined,
          {assertCurrent:()=>this._current(ticket.binding,combined)});
        if(!receipt||!['accepted','not_sent','unknown'].includes(receipt.outcome))fail('send_unknown');
        const messageId=typeof receipt.messageId==='string'&&/^-?\d{1,20}$/.test(receipt.messageId)?receipt.messageId:null;
        if(receipt.outcome==='accepted'&&!messageId)fail('send_unknown');
        // A matching accepted receipt stays accepted if the UI/account changes
        // later. It does not establish recipient display/read/delivery.
        const result={ticketId:id,outcome:receipt.outcome,...(receipt.outcome==='accepted'?{messageId}:{code:receipt.outcome==='unknown'?'send_unknown':safe(receipt)}),kind:'voice'};try{this._current(ticket.binding);this.last=result;this.lastBinding=ticket.binding;}catch{}return result;
      }catch(error){const result={ticketId:id,outcome:submitted?'unknown':'not_sent',code:submitted?'send_unknown':safe(error),kind:'voice'};try{this._current(ticket.binding);this.last=result;this.lastBinding=ticket.binding;}catch{}return result;}
      finally{ticket.bytes.fill(0);if(this.operation===op)this.operation=null;this._notify();}
    });this._notify();return op.promise;
  }
  discard(value){const id=request(value);if(this.operation)fail('operation_in_progress');if(!this.ticket||this.ticket.id!==id)fail('stale_ticket');this._clear();this._notify();return {discarded:true};}
  async close(){this.closed=true;this._clear();const op=this.operation;if(op){op.controller.abort();await op.promise.catch(()=>{});}this._notify();return {closed:true};}
}
module.exports={QQOwnerVoice,QQVoiceError,readVoiceSelection};
