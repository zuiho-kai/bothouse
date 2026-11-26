'use strict';
// Ordinary QQ group media is scoped to an observed native event. Only a fixed
// OneBot lookup may recover the corresponding QQ CDN URL for a member image.
// A quoted image recently sent by this character instead uses the accepted
// canonical bytes in the current connection. Descriptors carry neither URLs nor file names.
const {createHash}=require('node:crypto');
const {imageSegment,MAX_CAPTION}=require('./qq-inbound-image.cjs');
const {QQImageDownloader,MAX_BYTES}=require('./qq-image-download.cjs');
const {nativeFaceId}=require('./onebot-segments.cjs');

const GROUP_IMAGE_AGE_MS=10*60*1000;
const imageError=code=>Object.assign(Error(`Group image was not read (${code}).`),{code});
const numericId=value=>Number.isSafeInteger(value)?String(value):typeof value==='string'&&/^-?\d{1,20}$/.test(value)?value:null;
const qqId=value=>typeof value==='string'&&/^[1-9]\d{4,14}$/.test(value);
const safeText=value=>typeof value==='string'&&value.isWellFormed()&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value);
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');

function nativeParts(parts,mode='image'){
 if(!Array.isArray(parts)||!parts.length||parts.length>16)throw imageError('unsupported');
 const attachment=mode==='attachment',quote=mode==='quote';
 let quotedId=null,caption='',mentioned=false;const markers=[],imageParts=[];
 for(const part of parts){
  const {type,data}=part||{};
  if(type==='text'&&safeText(data?.text)){
   caption+=data.text;
   if(caption.length>MAX_CAPTION)throw imageError('unsupported');
   markers.push(['text',data.text]);imageParts.push(part);
  }else if(type==='at'&&(data?.qq==='all'||qqId(numericId(data?.qq)))){
   if(attachment&&(mentioned||data.qq==='all'))throw imageError('unsupported');
   mentioned=true;
   markers.push(['at',String(data.qq)]);imageParts.push({type:'text',data:{text:''}});
  }else if(type==='face'&&!attachment){
   const faceId=nativeFaceId(data?.id);
   if(faceId===null)throw imageError('unsupported');
   // Bind the decoration and its position to the exact message, but keep
   // the native ID out of the photo caption and model context.
   markers.push(['face',faceId]);
  }else if(type==='image'&&!quote&&data?.type!=='flash'){
   markers.push(['image']);imageParts.push(part);
  }else if(type==='reply'&&(quote||attachment&&!markers.length)&&!quotedId&&numericId(data?.id)){
   quotedId=numericId(data.id);markers.push(['reply',quotedId]);
  }else throw imageError('unsupported');
 }
 if((quote||attachment)&&!quotedId)throw imageError('unsupported');
 if(quote)return {caption,quotedId,markers,partsDigest:digest(markers)};
 // OneBot 11 does not require file_size for received pictures. A size
 // supplied by the bridge still has to match both exact reads and the bytes.
 const {sourceBytes,resourceDigest,url}=imageSegment(imageParts,{allowMissingSize:true});
 return {caption,sourceBytes,resourceDigest,url,partsDigest:digest(markers),...(attachment?{replyId:quotedId}:{})};
}

function eventScope(frame,{accountId,groupId,senderId,acceptAfter,now}){
 if(!qqId(accountId)||!qqId(groupId)||!qqId(senderId)||accountId===senderId||
    frame?.post_type!=='message'||frame.message_type!=='group'||frame.sub_type!=='normal'||frame.anonymous||
    String(frame.self_id)!==accountId||String(frame.group_id)!==groupId||String(frame.user_id)!==senderId||
    frame.sender?.user_id!==undefined&&String(frame.sender.user_id)!==senderId)throw imageError('wrong_scope');
 const id=numericId(frame.message_id),createdAt=frame.time*1000;
 if(!id||!Number.isSafeInteger(frame.time)||!Number.isSafeInteger(createdAt)||!Number.isSafeInteger(acceptAfter)||!Number.isSafeInteger(now)||
    createdAt<acceptAfter||createdAt>now+60000)throw imageError('invalid_response');
 return {accountId,groupId,senderId,id,createdAt};
}

function captureGroupImage(frame,binding){
 const scope=eventScope(frame,binding);
 const attachment=Array.isArray(frame.message)&&frame.message.some(part=>part?.type==='reply');
 const {url,...parts}=nativeParts(frame.message,attachment?'attachment':'image');
 if(parts.replyId===scope.id)throw imageError('wrong_scope');
 return Object.freeze({kind:'qq-group-image',...scope,...parts});
}

function captureGroupImageQuote(frame,source,binding){
 const scope=eventScope(frame,binding),{caption,quotedId,markers,partsDigest}=nativeParts(frame.message,'quote');
 if(!['qq-group-image','qq-group-sent-image'].includes(source?.kind)||source.accountId!==scope.accountId||source.groupId!==scope.groupId||
    source.id!==quotedId||source.id===scope.id||source.createdAt>scope.createdAt||binding.now-source.createdAt>GROUP_IMAGE_AGE_MS||
    !caption.trim()&&!markers.some(([type,target])=>type==='at'&&target===scope.accountId))throw imageError('wrong_scope');
 return Object.freeze({kind:'qq-group-quote-image',...scope,caption,partsDigest,source});
}

function verifyGroupMessage(data,descriptor){
 if(numericId(data?.message_id)!==descriptor.id||data?.message_type!=='group'||String(data.group_id)!==descriptor.groupId||
    data.post_type!==undefined&&data.post_type!=='message'||
    data.sub_type!==undefined&&data.sub_type!=='normal'||data.anonymous||String(data.sender?.user_id)!==descriptor.senderId||
    data.user_id!==undefined&&String(data.user_id)!==descriptor.senderId||
    data.self_id!==undefined&&String(data.self_id)!==descriptor.accountId||
    !Number.isSafeInteger(data.time)||data.time*1000!==descriptor.createdAt)throw imageError('message_changed');
 const quote=descriptor.kind==='qq-group-quote-image';
 let parts;try{parts=nativeParts(data.message,quote?'quote':descriptor.replyId?'attachment':'image');}catch{throw imageError('message_changed');}
 if(parts.partsDigest!==descriptor.partsDigest||parts.caption!==descriptor.caption)throw imageError('message_changed');
 if(quote){
  if(parts.quotedId!==descriptor.source.id)throw imageError('message_changed');
 }else if(parts.replyId!==descriptor.replyId||parts.resourceDigest!==descriptor.resourceDigest||parts.sourceBytes!==descriptor.sourceBytes)throw imageError('message_changed');
 return parts.url;
}

async function cancellableDownload(downloader,url,options){
 const {signal}=options;
 const pending=Promise.resolve().then(()=>{options.assertCurrent();return downloader.download(url,options);});
 let cancel;
 const cancelled=new Promise((_,reject)=>{
  cancel=()=>reject(imageError('cancelled'));
  signal.addEventListener('abort',cancel,{once:true});
  if(signal.aborted)cancel();
 });
 try{return await Promise.race([pending,cancelled]);}
 finally{
  signal.removeEventListener('abort',cancel);
  if(signal.aborted)void pending.then(result=>{if(Buffer.isBuffer(result?.bytes))result.bytes.fill(0);},()=>{});
 }
}

class GroupImageReader{
 constructor({createDownloader=()=>new QQImageDownloader()}={}){
  if(typeof createDownloader!=='function')throw imageError('invalid_config');
  this.createDownloader=createDownloader;
 }
 async read(client,message,{signal,assertCurrent,sentScopeId}={}){
  if(typeof assertCurrent!=='function'||typeof client?.bindGroupImageRead!=='function')throw imageError('invalid_config');
  const descriptor=message?.image,deadline=AbortSignal.timeout(20000);
  const readSignal=signal?AbortSignal.any([signal,deadline]):deadline;
  const binding=client.bindGroupImageRead(message,readSignal,{sentScopeId});
  const check=()=>{
   binding.assertCurrent();const current=assertCurrent();
   if(current?.then){current.catch?.(()=>{});throw imageError('invalid_config');}
  };
  let downloader,bytes;
  try{
   check();await binding.verify();check();
   const source=descriptor.source||descriptor;
   if(source.kind==='qq-group-sent-image'){
    const quoted=await binding.getMessage(descriptor.id);
    check();verifyGroupMessage(quoted,descriptor);
    bytes=binding.readSentImage();
    check();
    const image=bytes;bytes=null;return image;
   }
   const lookup=async id=>{
    try{return await binding.getMessage(id);}
    catch{check();throw imageError('message_changed');}
   };
   const readExact=async()=>{
    if(descriptor.source){const quoted=await lookup(descriptor.id);check();verifyGroupMessage(quoted,descriptor);}
    const original=await lookup(source.id);check();
    return verifyGroupMessage(original,source);
   };
   const url=await readExact();check();
   downloader=this.createDownloader();
   if(typeof downloader?.download!=='function'||typeof downloader?.close!=='function')throw imageError('invalid_config');
   const result=await cancellableDownload(downloader,url,{expectedResourceDigest:source.resourceDigest,signal:binding.signal,assertCurrent:check});
   bytes=result?.bytes;check();
   if(Buffer.isBuffer(bytes)&&bytes.length>MAX_BYTES)throw imageError('source_too_large');
   if(!Buffer.isBuffer(bytes)||!bytes.length||source.sourceBytes!==null&&bytes.length!==source.sourceBytes||
      result.resourceDigest!==source.resourceDigest)throw imageError('download_mismatch');
   await binding.verify();check();await readExact();check();
   const image=bytes;bytes=null;return image;
  }finally{
   if(Buffer.isBuffer(bytes))bytes.fill(0);
   try{downloader?.close?.();}catch{/* The downloader's abort signal is retired as well. */}
   binding.release();
  }
 }
}

module.exports={GroupImageReader,GROUP_IMAGE_AGE_MS,captureGroupImage,captureGroupImageQuote,verifyGroupMessage};
