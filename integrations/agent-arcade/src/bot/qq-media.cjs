'use strict';
// Manual QQ image preparation and single-use send controller.
// File paths enter only from a main-process picker, never a renderer request.
const path=require('node:path');
const {readSelectedMedia}=require('./qq-media-file.cjs');
const {orientNativeImage}=require('./qq-jpeg-orientation.cjs');
const staticImage=require('../core/static-image.cjs');
const {randomUUID}=require('node:crypto');
const MAX_INPUT=8*1024*1024,MAX_OUTPUT=4*1024*1024,OUTPUT_EDGE=2048,PREVIEW_EDGE=480,MAX_PREVIEW=512*1024;
const CODES=new Set(['invalid_request','image_too_large','image_invalid','image_format','image_animated','unsafe_file','file_changed','file_unavailable','decoder_unavailable','media_unavailable','group_unavailable','stale_ticket','expired_ticket','changed','disconnected','account_mismatch','account_changed','account_offline','status_unverified','bridge_unhealthy','cancelled','operation_in_progress','closed','send_rejected','send_unknown','media_failed']);
class QQMediaError extends Error{constructor(code){const fixed=CODES.has(code)?code:'media_failed';super(`QQ image operation failed (${fixed}).`);this.code=fixed;this.name=code==='cancelled'?'AbortError':'QQMediaError';}}
const fail=code=>{throw new QQMediaError(code);};
const safe=error=>CODES.has(error?.code)?error.code:error?.code==='aborted'?'cancelled':'media_failed';
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&(Object.getPrototypeOf(value)===Object.prototype||Object.getPrototypeOf(value)===null);
const checkSignal=signal=>{if(signal?.aborted)fail('cancelled');};
function qqCheck(check,...args){
  try{return check(...args);}catch(error){fail(error.code);}
}
const size=(...args)=>qqCheck(staticImage.size,...args);
const png=(...args)=>qqCheck(staticImage.png,...args);
const dimensions=(...args)=>qqCheck(staticImage.dimensions,...args);
function validateImagePayload(bytes){
  if(!Buffer.isBuffer(bytes)||bytes.length<1||bytes.length>MAX_OUTPUT)fail('image_too_large');const image=png(bytes,{canonical:true});
  if(image.width>OUTPUT_EDGE||image.height>OUTPUT_EDGE||!image.bytes.equals(bytes))fail('image_invalid');return {width:image.width,height:image.height};
}
async function readSelected(file,signal){
  try{return await readSelectedMedia(file,{signal,extensions:['.png','.jpg','.jpeg'],maxBytes:MAX_INPUT});}
  catch(error){throw new QQMediaError(({media_format:'image_format',media_too_large:'image_too_large'})[error?.code]||error?.code);}
}
function decodeImage(bytes,declared,nativeImage){
  if(typeof nativeImage?.createFromBuffer!=='function')fail('decoder_unavailable');
  let image;try{image=nativeImage.createFromBuffer(bytes);}catch{fail('image_invalid');}
  if(!image||image.isEmpty())fail('image_invalid');const actual=image.getSize();size(actual.width,actual.height);if(actual.width!==declared.width||actual.height!==declared.height)fail('image_invalid');
  return image;
}
function fitImage(image,edge){
  const {width,height}=image.getSize(),ratio=Math.min(1,edge/width,edge/height);
  return ratio<1?image.resize({width:Math.max(1,Math.round(width*ratio)),height:Math.max(1,Math.round(height*ratio)),quality:'good'}):image;
}
function boundedPng(image,edge,limit){
  let reducedForBytes=false;
  for(;;){
    const fitted=fitImage(image,edge);
    const encoded=png(fitted.toPNG(),{canonical:true});
    if(encoded.width>edge||encoded.height>edge)fail('image_invalid');
    if(encoded.bytes.length<=limit)return {encoded,image:fitted,reducedForBytes};
    const actualEdge=Math.max(encoded.width,encoded.height);
    if(actualEdge<=1)fail('image_too_large');
    // Estimate a new area from the measured encoding. Always resample from
    // the same original bitmap, including its alpha channel.
    const scale=Math.min(reducedForBytes?0.85:0.98,0.98*Math.sqrt(limit/encoded.bytes.length));
    edge=Math.max(1,Math.floor(actualEdge*scale));
    reducedForBytes=true;
  }
}
function imagePreview(image,edge){
  const {encoded}=boundedPng(image,edge,MAX_PREVIEW);
  return 'data:image/png;base64,'+encoded.bytes.toString('base64');
}
function selectedImagePreview(bytes,expected,nativeImage){
  const shape=validateImagePayload(bytes);
  if(shape.width!==expected.width||shape.height!==expected.height)fail('changed');
  return imagePreview(decodeImage(bytes,shape,nativeImage),320);
}
function canonicalImage(bytes,extension,nativeImage,previewEdge=PREVIEW_EDGE){
  const declared=dimensions(bytes,extension,{includeOrientation:true});
  let image=fitImage(decodeImage(bytes,declared,nativeImage),OUTPUT_EDGE),output,preview;
  try{image=orientNativeImage(image,declared.orientation??1,nativeImage);output=png(image.toPNG(),{canonical:true});preview=imagePreview(image,previewEdge);}catch(error){if(error instanceof QQMediaError)throw error;fail('image_invalid');}
  if(output.bytes.length>MAX_OUTPUT)fail('image_too_large');return {bytes:output.bytes,width:output.width,height:output.height,preview};
}
function canonicalGroupSticker(bytes,nativeImage,{maxEdge=OUTPUT_EDGE}={}){
  if(!Number.isInteger(maxEdge)||maxEdge<1||maxEdge>OUTPUT_EDGE)fail('invalid_request');
  const source=dimensions(bytes,'.png');
  const decoded=decodeImage(bytes,source,nativeImage);
  const {encoded,image,reducedForBytes}=boundedPng(decoded,maxEdge,MAX_OUTPUT);
  return {bytes:encoded.bytes,width:encoded.width,height:encoded.height,preview:imagePreview(image,320),
    sourceWidth:source.width,sourceHeight:source.height,resizedForBytes:reducedForBytes};
}
function binding(value){
  if(!value||value.status!=='connected'||value.channel!=='qq'||!Number.isSafeInteger(value.generation)||value.generation<0||!value.client)fail('disconnected');
  if(typeof value.scopeId!=='string'||!value.scopeId||value.scopeId.length>256||/[\p{Cc}\p{Cf}]/u.test(value.scopeId))fail('invalid_request');
  const qq=id=>typeof id==='string'&&/^[1-9]\d{4,14}$/.test(id)&&Number.isSafeInteger(Number(id));
  if(!qq(value.accountId)||!qq(value.ownerId)||value.accountId===value.ownerId||value.client.ownerId!==value.ownerId||value.client.accountId!==value.accountId)fail('account_mismatch');
  if(!value.client.ready||value.client.closed||value.client.socket?.readyState!==1)fail('disconnected');
  const {groupId,groupRevision,roleId,route}=value;
  if(groupId!==undefined&&(!qq(groupId)||typeof groupRevision!=='string'||!groupRevision||
     typeof roleId!=='string'||!roleId||!route))fail('group_unavailable');
  return {client:value.client,socket:value.client.socket,clientGeneration:value.client.generation,
    generation:value.generation,scopeId:value.scopeId,accountId:value.accountId,ownerId:value.ownerId,
    role:typeof value.role==='string'?value.role.replace(/[\p{Cc}\p{Cf}]/gu,'').slice(0,64):'',
    groupId,groupRevision,roleId,route};
}
const SCOPE_FIELDS=['client','socket','clientGeneration','generation','scopeId','accountId','ownerId','role',
  'groupId','groupRevision','roleId','route'];
function equalBinding(a,b){return SCOPE_FIELDS.every(key=>a[key]===b[key]);}
function request(value){
  if(!plain(value)||Object.keys(value).some(key=>!['ticketId','groupId'].includes(key))||
     typeof value.ticketId!=='string'||!/^[a-f0-9-]{36}$/.test(value.ticketId)||
     (Object.hasOwn(value,'groupId')&&(typeof value.groupId!=='string'||!/^[1-9]\d{4,14}$/.test(value.groupId))))fail('invalid_request');
  return value.ticketId;
}
class QQOwnerImage {
  constructor({nativeImage,getBinding,now=Date.now,onChange=()=>{}}={}){if(typeof getBinding!=='function'||typeof now!=='function'||typeof onChange!=='function')fail('invalid_request');this.nativeImage=nativeImage;this.getBinding=getBinding;this.now=now;this.onChange=onChange;this.ticket=null;this.operation=null;this.closed=false;this.last=null;}
  _notify(){try{this.onChange();}catch{}}
  _current(expected,signal){checkSignal(signal);if(this.closed)fail('closed');const current=binding(this.getBinding());if(expected&&!equalBinding(current,expected))fail('changed');return current;}
  _clear(){this.ticket?.bytes.fill(0);this.ticket=null;}
  snapshot(){if(this.ticket){try{this._current(this.ticket.binding);if(this.now()>=this.ticket.expiresAt)this._clear();}catch{this._clear();}}if(this.last){try{this._current(this.lastBinding);}catch{this.last=null;this.lastBinding=null;}}return {busy:!!this.operation,draft:this.ticket?this._public(this.ticket,{preview:false}):null,last:this.last?{...this.last}:null};}
  _public(ticket,{preview=true}={}){
    const {accountId,role,ownerId,groupId,roleId}=ticket.binding;
    const target=groupId===undefined?{ownerId}:{groupId,roleId,...(ticket.groupName?{groupName:ticket.groupName}:{})};
    return {ticketId:ticket.id,kind:'image',width:ticket.width,height:ticket.height,bytes:ticket.bytes.length,
      expiresAt:ticket.expiresAt,...(preview?{preview:ticket.preview}:{}),recipient:{accountId,role,...target}};
  }
  async select(file,{signal,groupId,groupName}={}){
    if(this.operation)fail('operation_in_progress');
    const current=this._current(null,signal);
    if(current.groupId!==groupId)fail('changed');
    const label=groupId!==undefined&&typeof groupName==='string'&&groupName.length<=80&&
      !/[\p{Cc}\p{Cf}]/u.test(groupName)?groupName:'';
    this._clear();this.last=null;
    const controller=new AbortController(),combined=signal?AbortSignal.any([signal,controller.signal]):controller.signal,op={controller,promise:null};this.operation=op;
    op.promise=Promise.resolve().then(async()=>{let raw;try{
      raw=await readSelected(file,combined);this._current(current,combined);
      const image=canonicalImage(raw,path.extname(file).toLowerCase(),this.nativeImage);this._current(current,combined);
      this.ticket={...image,id:randomUUID(),binding:current,groupName:label,expiresAt:this.now()+5*60*1000};
      return this._public(this.ticket);
    }catch(error){throw new QQMediaError(safe(error));}
    finally{raw?.fill(0);if(this.operation===op)this.operation=null;this._notify();}});
    this._notify();return op.promise;
  }
  async send(value,{signal}={}){
    const id=request(value);if(this.operation)fail('operation_in_progress');if(!this.ticket||this.ticket.id!==id||this.ticket.binding.groupId!==value.groupId)fail('stale_ticket');
    const ticket=this.ticket;this.ticket=null;const controller=new AbortController(),combined=signal?AbortSignal.any([signal,controller.signal]):controller.signal,op={controller,promise:null};this.operation=op;this.last=null;
    op.promise=Promise.resolve().then(async()=>{
      let submitted=false;
      try{
        if(this.now()>=ticket.expiresAt)fail('expired_ticket');this._current(ticket.binding,combined);const {client}=ticket.binding;
        const {groupId,ownerId}=ticket.binding;
        const send=groupId===undefined?client.sendOwnerImage:client.sendGroupImage;
        if(typeof send!=='function')fail('disconnected');
        submitted=true;
        const receipt=await send.call(client,groupId??ownerId,ticket.bytes,id,combined,{
          assertCurrent:()=>this._current(ticket.binding,combined),
          ...(groupId===undefined?{}:{scopeId:ticket.binding.scopeId}),
        });
        if(!receipt||!['accepted','not_sent','unknown'].includes(receipt.outcome))fail('send_unknown');
        const messageId=typeof receipt.messageId==='string'&&/^-?\d{1,20}$/.test(receipt.messageId)?receipt.messageId:null;
        if(receipt.outcome==='accepted'&&!messageId)fail('send_unknown');
        // A matching accepted receipt stays accepted if the UI/account changes
        // later. It does not establish recipient display/read/delivery.
        const result={ticketId:id,outcome:receipt.outcome,...(receipt.outcome==='accepted'?{messageId}:{code:receipt.outcome==='unknown'?'send_unknown':safe(receipt)}),kind:'image'};try{this._current(ticket.binding);this.last=result;this.lastBinding=ticket.binding;}catch{}return result;
      }catch(error){const result={ticketId:id,outcome:submitted?'unknown':'not_sent',code:submitted?'send_unknown':safe(error),kind:'image'};try{this._current(ticket.binding);this.last=result;this.lastBinding=ticket.binding;}catch{}return result;}
      finally{ticket.bytes.fill(0);if(this.operation===op)this.operation=null;this._notify();}
    });this._notify();return op.promise;
  }
  discard(value){const id=request(value);if(this.operation)fail('operation_in_progress');if(!this.ticket||this.ticket.id!==id||this.ticket.binding.groupId!==value.groupId)fail('stale_ticket');this._clear();this._notify();return {discarded:true};}
  async close(){this.closed=true;this._clear();const op=this.operation;if(op){op.controller.abort();await op.promise.catch(()=>{});}this._notify();return {closed:true};}
}
module.exports={QQOwnerImage,QQMediaError,canonicalImage,canonicalGroupSticker,dimensions,readSelected,validateImagePayload,selectedImagePreview};
