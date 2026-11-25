'use strict';
// Original explicit history-picture reader. An owner-scoped history query is
// the peer authority; a self-sent get_msg response has no recipient field.
const {randomUUID,createHash}=require('node:crypto');
const {imageSource}=require('./qq-image-source.cjs');
const {QQImageDownloader,MAX_BYTES}=require('./qq-image-download.cjs');
const {validateImagePayload}=require('./qq-media.cjs');
const CODES=new Set(['invalid_request','invalid_response','response_too_large','changed','cancelled','closed','disconnected','account_changed','account_offline','status_unverified','owner_not_friend','operation_in_progress','timeout','unconfigured','unauthorized','connect_failed','connect_timeout','login_required','heartbeat_timeout','unavailable','image_unavailable','image_changed','image_expired','image_unsupported','image_too_large','image_invalid','image_format','image_animated','image_source_unsupported','dns_failed','address_rejected','tls_untrusted','connection_failed','redirect_rejected','http_error','decoder_unavailable']);
const aliases={aborted:'cancelled',action_timeout:'timeout',request_limit:'operation_in_progress',action_failed:'image_unavailable',source_too_large:'image_too_large'};
const codeOf=e=>{const c=Object.hasOwn(aliases,e?.code)?aliases[e.code]:e?.code;return CODES.has(c)?c:'unavailable';};
class HistoryImageError extends Error{constructor(code){super('QQ history picture unavailable.');this.code=CODES.has(code)?code:'unavailable';}}
const fail=c=>{throw new HistoryImageError(c);};
const object=v=>v&&typeof v==='object'&&!Array.isArray(v)&&(Object.getPrototypeOf(v)===Object.prototype||Object.getPrototypeOf(v)===null);
const uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(v);
const qq=v=>typeof v==='string'&&/^[1-9]\d{4,11}$/.test(v);
const digest=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const size=v=>{if(typeof v==='string'&&/^[1-9]\d{0,7}$/.test(v))v=Number(v);if(!Number.isSafeInteger(v)||v<1||v>MAX_BYTES)fail('image_unsupported');return v;};
function request(v,kind){
 const keys=['accountId','panelId','pageId',...(kind==='page'?[]:kind==='preview'?['imageId','requestId']:['requestId'])];
 if(!object(v)||Object.keys(v).sort().join('|')!==keys.sort().join('|')||typeof v.accountId!=='string'||!/^[a-zA-Z0-9-]{1,64}$/.test(v.accountId)||!uuid(v.panelId)||!uuid(v.pageId)||kind!=='page'&&!uuid(v.requestId)||kind==='preview'&&!uuid(v.imageId))fail('invalid_request');return v;
}
function capture(row,{accountId,ownerId}){
 if(!qq(accountId)||!qq(ownerId)||accountId===ownerId||!object(row)||row.message_type!=='private'||row.sub_type!=='friend'||row.group_id!==undefined||String(row.self_id)!==accountId||!object(row.sender))fail('image_unsupported');
 const sender=String(row.sender.user_id),id=String(row.message_id);
 if(![accountId,ownerId].includes(sender)||String(row.user_id)!==sender||!/^(-[1-9]\d{0,9}|[1-9]\d{0,9})$/.test(id)||Number(id)<-2147483648||Number(id)>2147483647||typeof row.real_seq!=='string'||! /^[1-9]\d{0,19}$/.test(row.real_seq)||!Number.isSafeInteger(row.time)||row.time<0||row.time>253402300799||!Array.isArray(row.message)||row.message.length<1||row.message.length>64)fail('image_unsupported');
 let imageIndex=-1,sourceBytes=0,textUnits=0;const parts=[];
 for(const [index,part] of row.message.entries()){
  if(!object(part)||!object(part.data))fail('image_unsupported');
  if(part.type==='text'){if(typeof part.data.text!=='string'||(textUnits+=part.data.text.length)>16000)fail('image_unsupported');parts.push(['text',part.data.text]);}
  else if(part.type==='image'&&imageIndex<0){const d=part.data;sourceBytes=size(d.file_size);if(typeof d.file!=='string'||!d.file||d.file.length>1024||d.summary!==undefined&&(typeof d.summary!=='string'||d.summary.length>1000)||d.sub_type!==undefined&&!Number.isSafeInteger(d.sub_type))fail('image_unsupported');imageIndex=index;parts.push(['image',d.file,sourceBytes,d.sub_type??null,d.summary??null]);}
  else fail('image_unsupported');
 }
 if(imageIndex<0)fail('image_unsupported');
 return Object.freeze({messageId:id,sequence:row.real_seq,time:row.time,sender,imageIndex,sourceBytes,fingerprint:digest(parts)});
}
function capturePageImages(raw,page,binding){
 const selected=new Set(page.rows.map(row=>row.messageId)),found=[];
 for(const row of raw.messages){if(!selected.has(String(row.message_id)))continue;try{found.push(capture(row,binding));}catch{/* Unsupported media stays a placeholder; history is still readable. */}}
 return found;
}
function equal(a,b){return ['messageId','sequence','time','sender','imageIndex','sourceBytes','fingerprint'].every(key=>a[key]===b[key]);}
function extract(raw,descriptor,binding){
 if(!object(raw)||!Array.isArray(raw.messages)||raw.messages.length>20)fail('invalid_response');
 const matches=raw.messages.filter(row=>object(row)&&String(row.message_id)===descriptor.messageId);if(matches.length!==1)fail('image_changed');
 let observed;try{observed=capture(matches[0],binding);}catch{fail('image_changed');}if(!equal(observed,descriptor))fail('image_changed');
 const source=imageSource(matches[0].message[observed.imageIndex].data.url);return source;
}
class HistoryImageTransport{
 constructor({createDownloader=()=>new QQImageDownloader(),prepare}={}){this.createDownloader=createDownloader;this.prepare=prepare;}
 async _source(binding,descriptor,signal,check){
  check();const login=await binding.client._request('get_login_info',{},signal);check();if(!object(login)||String(login.user_id)!==binding.accountId)fail('account_changed');
  const status=await binding.client._request('get_status',{},signal);check();if(!object(status)||typeof status.online!=='boolean'||status.good!==undefined&&typeof status.good!=='boolean')fail('status_unverified');if(!status.online)fail('account_offline');if(status.good===false)fail('status_unverified');
  const friends=await binding.client._request('get_friend_list',{no_cache:false},signal);check();if(!Array.isArray(friends)||friends.length>10000)fail('invalid_response');const ids=new Set();for(const f of friends){const id=String(f?.user_id);if(!object(f)||!qq(id)||ids.has(id))fail('invalid_response');ids.add(id);}if(!ids.has(binding.ownerId))fail('owner_not_friend');
  const raw=await binding.client._request('get_friend_msg_history',{user_id:binding.ownerId,count:20,message_seq:descriptor.messageId,reverse_order:true,reverseOrder:true,disable_get_url:false,parse_mult_msg:false,quick_reply:false},signal);check();return extract(raw,descriptor,binding);
 }
 async preview(binding,{descriptor,signal,assertCurrent}){
  let downloader,downloaded,prepared;
  const check=()=>{if(signal.aborted)fail('cancelled');const r=assertCurrent();if(r?.then){r.catch?.(()=>{});fail('invalid_request');}const c=binding.client;if(c.accountId!==binding.accountId||c.expectedAccountId!==binding.accountId||c.ownerId!==binding.ownerId)fail('account_changed');if(c.socket!==binding.socket||c.generation!==binding.clientGeneration||!c.ready||c.closed||c.socket?.readyState!==1)fail('disconnected');};
  try{
   check();if(typeof this.prepare!=='function')fail('decoder_unavailable');const source=await this._source(binding,descriptor,signal,check);check();
   downloader=this.createDownloader();if(typeof downloader?.download!=='function'||typeof downloader?.close!=='function')fail('invalid_request');
   downloaded=await downloader.download(source.url,{signal,assertCurrent:check,expectedResourceDigest:source.resourceDigest});check();
   if(!downloaded||!Buffer.isBuffer(downloaded.bytes)||downloaded.bytes.length<1||downloaded.bytes.length>MAX_BYTES||downloaded.resourceDigest!==source.resourceDigest||!['.png','.jpg'].includes(downloaded.extension))fail('invalid_response');
   const after=await this._source(binding,descriptor,signal,check);check();if(after.resourceDigest!==source.resourceDigest)fail('image_changed');
   prepared=await this.prepare(downloaded.bytes,downloaded.extension);check();if(!prepared||!Buffer.isBuffer(prepared.bytes))fail('image_invalid');const shape=validateImagePayload(prepared.bytes);if(shape.width!==prepared.width||shape.height!==prepared.height)fail('image_invalid');
   check();return {mimeType:'image/png',dataUrl:'data:image/png;base64,'+prepared.bytes.toString('base64'),width:shape.width,height:shape.height,bytes:prepared.bytes.length};
  }catch(error){throw new HistoryImageError(codeOf(error));}
  finally{downloaded?.bytes?.fill(0);prepared?.bytes?.fill(0);downloader?.close();}
 }
}
class HistoryImagePages{
 constructor({assertCurrent,verify,binding,transport,monotonic=()=>performance.now()}={}){Object.assign(this,{assertCurrent,verify,binding,transport,monotonic});this.pages=new Map();this.activePage=null;this.operation=null;this.retired=false;this.retiring=Promise.resolve();}
 _current(){if(this.retired)fail('closed');this.assertCurrent();}
 add(page,descriptors,{reset=false}={}){
  this._current();this.cancel();if(reset)this.pages.clear();const pageId=randomUUID(),images=new Map(),byMessage=new Map(descriptors.map(d=>[d.messageId,d]));
  const rows=page.rows.map(row=>{const d=byMessage.get(row.messageId);if(!d)return row;const imageId=randomUUID();images.set(imageId,d);return {...row,parts:row.parts.map((part,index)=>part.kind==='image'&&index===d.imageIndex?{...part,imageId}:part)};});
  this.pages.set(pageId,{images,deadline:this.monotonic()+300000,requests:new Set()});this.activePage=pageId;return {pageId,rows};
 }
 select(pageId){this._current();if(!this.pages.has(pageId))fail('changed');this.cancel();this.activePage=pageId;return {pageId,selected:true};}
 cancel(requestId){const op=this.operation;if(requestId&&op?.requestId!==requestId)return Promise.resolve();if(op){this.operation=null;op.abort.abort();}return this.retiring;}
 preview(input){
  this._current();const page=this.pages.get(input.pageId),descriptor=page?.images.get(input.imageId);if(!page||this.activePage!==input.pageId||!descriptor)fail('changed');if(this.monotonic()>=page.deadline)fail('image_expired');if(this.operation)fail('operation_in_progress');if(page.requests.has(input.requestId)||page.requests.size>=100)fail('invalid_request');page.requests.add(input.requestId);
  const op={pageId:input.pageId,requestId:input.requestId,abort:new AbortController()};this.operation=op;
  const check=()=>{this._current();if(this.operation!==op||op.abort.signal.aborted||this.activePage!==input.pageId||this.pages.get(input.pageId)!==page)fail('cancelled');};
  const previous=this.retiring;
  const operation=(async()=>{try{check();await previous;check();await this.verify(op.abort.signal);check();const preview=await this.transport.preview(this.binding(),{descriptor,signal:op.abort.signal,assertCurrent:check});check();await this.verify(op.abort.signal);check();return {pageId:input.pageId,imageId:input.imageId,requestId:input.requestId,preview};}finally{if(this.operation===op)this.operation=null;op.abort.abort();}})();
  this.retiring=Promise.allSettled([previous,operation]).then(()=>{});return operation;
 }
 close(){this.retired=true;this.cancel();this.pages.clear();this.activePage=null;return this.retiring;}
}
async function historyImageResult(input,operation){try{return {ok:true,...await operation()};}catch(error){return {ok:false,...(typeof input?.accountId==='string'&&/^[a-zA-Z0-9-]{1,64}$/.test(input.accountId)?{accountId:input.accountId}:{}),...Object.fromEntries(['panelId','pageId','imageId','requestId'].filter(k=>uuid(input?.[k])).map(k=>[k,input[k]])),code:codeOf(error)};}}
module.exports={HistoryImageError,HistoryImageTransport,HistoryImagePages,capturePageImages,capture,extract,request,historyImageResult,codeOf,CODES};
