'use strict';
// Read attached WAV or an exact group PTT link from both the authenticated
// record event and message readback. Filename caches, converted responses and
// local paths are outside this transport.
const {createHash}=require('node:crypto');
const {canonicalWav}=require('./qq-voice-payload.cjs');
const {QQVoiceDownloader,MAX_VOICE_BYTES}=require('./qq-image-download.cjs');
const {decodeGroupSilk}=require('./qq-silk.cjs');

const MAX_SOURCE_BYTES=1024*1024;
// Leave room for the rest of the bounded OneBot frame and base64 expansion.
const MAX_INLINE_BYTES=512*1024;
const MAX_CAPTION=1900;
// Never publish a bridge-reported OS path in the group descriptor or diagnostics.
const eventCachePaths=new WeakMap();
const voiceError=code=>Object.assign(Error(`Group record was not read (${code}).`),{code});
const numericId=value=>Number.isSafeInteger(value)?String(value):typeof value==='string'&&/^-?\d{1,20}$/.test(value)?value:null;
const messageSeq=value=>{const id=numericId(value);return id&&/^[1-9]\d{0,19}$/.test(id)?id:null;};
const qqId=value=>typeof value==='string'&&/^[1-9]\d{4,14}$/.test(value);
const safeText=value=>typeof value==='string'&&value.isWellFormed()&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value);
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const byteDigest=encoded=>createHash('sha256').update(encoded,'ascii').digest('hex');

// Native group PTT identifiers carry the original digest, length and app ID.
const PTT_BYTE_FIELDS = new Map([[2, 20], [6, 4], [11, 16], [15, 2], [16, 2]]);
const PTT_EXTENDED_FIELDS = [6, 11, 15, 16];
function fileIdInfo(fileId){
 const fail=()=>{throw voiceError('voice_source_unsupported');};
 if(typeof fileId!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(fileId))fail();
 const bytes=Buffer.from(fileId,'base64url');
 if(bytes.toString('base64url')!==fileId)fail();
 let offset=0,sha1,sourceBytes,appid,wideMetadata=false;
 const seen=new Set();
 // A protobuf tag or byte length is a varint too. Reject overlong encodings.
 function varint(max=0xffffffffn){
  let value=0n;
  for(let shift=0n;shift<=63n&&offset<bytes.length;shift+=7n){
   const byte=bytes[offset++];
   value|=BigInt(byte&127)<<shift;
   if(byte<128){
    if((shift>0n&&byte===0)||value>max)fail();
    return value;
   }
  }
  return fail();
 }
 while(offset<bytes.length){
  const tag=Number(varint()),field=Math.floor(tag/8),wire=tag%8;
  if(seen.has(field))fail();
  seen.add(field);
  if(PTT_BYTE_FIELDS.has(field)){
   const length=PTT_BYTE_FIELDS.get(field);
   if(wire!==2||varint()!==BigInt(length)||offset+length>bytes.length)fail();
   if(field===2)sha1=bytes.toString('hex',offset,offset+length);
   offset+=length;
  }else{
   if(wire!==0)fail();
   if(field===3)sourceBytes=Number(varint());
   else if(field===4)appid=Number(varint());
   else if(field===5||field===10){
    if(varint(0xffffffffffffffffn)>0xffffffffn)wideMetadata=true;
   }else fail();
  }
 }
 // Keep the legacy layout. Recognize the additional opaque metadata only as
 // a complete layout; its bytes remain bound by the digest of the full fileid.
 if(wideMetadata||PTT_EXTENDED_FIELDS.some(field=>seen.has(field))){
  if(!seen.has(5)||!seen.has(10)||!PTT_EXTENDED_FIELDS.every(field=>seen.has(field)))fail();
 }
 if(appid!==1403||!sha1||!sourceBytes||sourceBytes>MAX_VOICE_BYTES)fail();
 return {sha1,sourceBytes};
}

function groupVoiceSource(value){
 const fail=()=>{throw voiceError('voice_source_unsupported');};
 if(typeof value!=='string'||value.length>4096||/[\\\x00-\x20\x7f]/.test(value)||
    !value.startsWith('https://multimedia.nt.qq.com.cn/download?'))fail();
 let url;try{url=new URL(value);}catch{fail();}
 if(url.origin!=='https://multimedia.nt.qq.com.cn'||url.pathname!=='/download'||url.username||url.password||url.hash)fail();
 const entries=url.search.slice(1).split('&'),pairs=entries.map(row=>[row.split('=',1)[0],row.slice(row.indexOf('=')+1)]),raw=new Map(pairs);
 const {searchParams:query}=url,fileId=query.get('fileid'),rkey=query.get('rkey');
 const format=raw.get('format');
 if(raw.size!==entries.length||entries.length!==(format===undefined?3:4)||format!==undefined&&format!=='amr'||
    raw.get('appid')!=='1403'||raw.get('fileid')!==fileId||!raw.has('rkey')||
    !rkey||!/^[A-Za-z0-9_.~+\/=\-]{1,2048}$/.test(rkey))fail();
 const source=fileIdInfo(fileId);
 const identity=['qq-group-ptt',1403,fileId];
 if(format!==undefined)identity.push(format);
 return {...source,url:url.href,resourceDigest:digest(identity)};
}

function recordEvidence(data){
 const size=data?.file_size;
 const sourceBytes=typeof size==='string'&&/^[1-9]\d{0,7}$/.test(size)?Number(size):size;
 if(!Number.isSafeInteger(sourceBytes)||sourceBytes<1||sourceBytes>MAX_SOURCE_BYTES)throw voiceError('invalid_response');
 if(![undefined,0,'0',false].includes(data.magic))throw voiceError('unsupported');
 // The filename is diagnostic evidence only; the path is never consulted.
 const name=data.file;
 if(name!==undefined&&(typeof name!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(name)||name.includes('..')))throw voiceError('unsupported');
 const encoded=data.base64;
 let sourceDigest=null,resource=null;
 if(encoded!==undefined){
  if(sourceBytes>MAX_INLINE_BYTES||typeof encoded!=='string'||encoded.length!==Math.ceil(sourceBytes/3)*4||
     !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded))throw voiceError('invalid_response');
  const padding=encoded.endsWith('==')?2:encoded.endsWith('=')?1:0;
  if(encoded.length/4*3-padding!==sourceBytes)throw voiceError('invalid_response');
  sourceDigest=byteDigest(encoded);
 }else if(typeof data.url==='string'){
  try{const matched=groupVoiceSource(data.url);if(matched.sourceBytes===sourceBytes)resource=matched;}
  catch{/* Out-of-contract bridge URLs leave metadata only. */}
 }
 return {sourceBytes,sourceDigest,fileDigest:name===undefined?null:digest(name),encoded,resource,nativePath:data.path};
}

function recordParts(parts){
 if(!Array.isArray(parts)||!parts.length||parts.length>16)throw voiceError('unsupported');
 let record=null,caption='';const markers=[];
 for(const part of parts){
  const {type,data}=part||{};
  if(type==='text'&&safeText(data?.text)){
   caption+=data.text;if(caption.length>MAX_CAPTION)throw voiceError('unsupported');
   markers.push(['text',data.text]);
  }else if(type==='at'&&(data?.qq==='all'||qqId(numericId(data?.qq)))){
   markers.push(['at',String(data.qq)]);
  }else if(type==='record'&&!record){
   record=recordEvidence(data);markers.push(['record']);
  }else throw voiceError('unsupported');
 }
 if(!record)throw voiceError('unsupported');
 return {...record,caption,partsDigest:digest(markers)};
}

function captureGroupVoice(frame,{accountId,groupId,senderId,acceptAfter,now}){
 if(!qqId(accountId)||!qqId(groupId)||!qqId(senderId)||accountId===senderId||frame?.post_type!=='message'||
    frame.message_type!=='group'||frame.sub_type!=='normal'||frame.anonymous||String(frame.self_id)!==accountId||
    String(frame.group_id)!==groupId||String(frame.user_id)!==senderId||
    frame.sender?.user_id!==undefined&&String(frame.sender.user_id)!==senderId)throw voiceError('wrong_scope');
 const id=numericId(frame.message_id),createdAt=frame.time*1000;
 if(!id||!Number.isSafeInteger(frame.time)||!Number.isSafeInteger(createdAt)||!Number.isSafeInteger(acceptAfter)||
    !Number.isSafeInteger(now)||createdAt<acceptAfter||createdAt>now+60000)throw voiceError('invalid_response');
 const {encoded,resource,nativePath,...evidence}=recordParts(frame.message),sequence=messageSeq(frame.message_seq);
 const descriptor=Object.freeze({kind:'qq-group-voice',accountId,groupId,senderId,id,createdAt,...evidence,
  resourceDigest:sequence?resource?.resourceDigest||null:null,sequence});
 if(resource&&nativePath!==undefined&&nativePath!=='')eventCachePaths.set(descriptor,
  typeof nativePath==='string'&&nativePath.length<=4096?digest(nativePath):null);
 return descriptor;
}

// A present status must be normal, including on the final lookup. For a
// bridge that omits it, require the complete event identity on both lookups.
function nativeRecordStatusMatches(data, descriptor){
 if(Object.hasOwn(data,'status'))return data.status==='normal';
 return data.post_type==='message'&&data.sub_type==='normal'&&
  numericId(data.self_id)===descriptor.accountId&&numericId(data.user_id)===descriptor.senderId&&
  numericId(data.sender?.user_id)===descriptor.senderId;
}

function verifiedRecord(data,descriptor){
 if(numericId(data?.message_id)!==descriptor.id||data?.message_type!=='group'||String(data.group_id)!==descriptor.groupId||
    data.status!==undefined&&data.status!=='normal'||data.post_type!==undefined&&data.post_type!=='message'||
    descriptor.resourceDigest&&(!nativeRecordStatusMatches(data,descriptor)||messageSeq(data.message_seq)!==descriptor.sequence||messageSeq(data.real_id)!==descriptor.sequence)||
    data.sub_type!==undefined&&data.sub_type!=='normal'||data.anonymous||String(data.sender?.user_id)!==descriptor.senderId||
    data.user_id!==undefined&&String(data.user_id)!==descriptor.senderId||data.self_id!==undefined&&String(data.self_id)!==descriptor.accountId||
    !Number.isSafeInteger(data.time)||data.time*1000!==descriptor.createdAt)throw voiceError('message_changed');
 let parts;try{parts=recordParts(data.message);}catch{throw voiceError('message_changed');}
 if(['sourceBytes','fileDigest','caption','partsDigest'].some(key=>parts[key]!==descriptor[key]))throw voiceError('message_changed');
 if(descriptor.resourceDigest){
  if(!parts.resource)throw voiceError('source_unavailable');
  if(parts.resource.resourceDigest!==descriptor.resourceDigest)throw voiceError('message_changed');
  return {...parts.resource,nativePath:parts.nativePath};
 }
 if(!parts.sourceDigest)throw voiceError('source_unavailable');
 if(parts.sourceDigest!==descriptor.sourceDigest)throw voiceError('message_changed');
 const raw=Buffer.from(parts.encoded,'base64');
 if(raw.length===descriptor.sourceBytes&&raw.toString('base64')===parts.encoded)return raw;
 raw.fill(0);throw voiceError('invalid_response');
}

// Dispose a late result even if an injected transport or local codec ignores
// cancellation. The live reader never receives audio after the turn ends.
async function cancellable(start,signal,dispose){
 const pending=Promise.resolve().then(()=>{if(signal.aborted)throw voiceError('cancelled');return start();});
 let cancel;
 const aborted=new Promise((_,reject)=>{
  cancel=()=>reject(voiceError('cancelled'));signal.addEventListener('abort',cancel,{once:true});
  if(signal.aborted)cancel();
 });
 try{return await Promise.race([pending,aborted]);}
 finally{signal.removeEventListener('abort',cancel);if(signal.aborted)void pending.then(dispose,()=>{});}
}

class GroupRecordReader{
 constructor({createDownloader=()=>new QQVoiceDownloader(),decodeSilk=decodeGroupSilk,getWindowsDocuments}={}){
  if(typeof createDownloader!=='function'||typeof decodeSilk!=='function')throw voiceError('invalid_config');
  this.createDownloader=createDownloader;this.decodeSilk=decodeSilk;this.getWindowsDocuments=getWindowsDocuments;
 }
 async read(client,message,{signal,assertCurrent}={}){
  if(typeof assertCurrent!=='function'||typeof client?.bindGroupVoiceRead!=='function')throw voiceError('invalid_config');
  const descriptor=message?.voice,deadline=AbortSignal.timeout(20000);
  const binding=client.bindGroupVoiceRead(message,signal?AbortSignal.any([signal,deadline]):deadline);
  const check=()=>{
   binding.assertCurrent();const current=assertCurrent();
   if(current?.then){current.catch?.(()=>{});throw voiceError('invalid_config');}
   if(current===false)throw voiceError('wrong_scope');
  };
  let raw,normalized,downloader,audio;
  try{
   check();if(!descriptor.sourceDigest&&!descriptor.resourceDigest)throw voiceError('source_unavailable');
   await binding.verify();check();
   const observed=await binding.getMessage(descriptor.id);check();
   const source=verifiedRecord(observed,descriptor);
   if(descriptor.resourceDigest){
    const nativeShape=process.platform==='win32'&&this.getWindowsDocuments&&!Object.hasOwn(observed,'status')&&
     (source.nativePath!==undefined&&source.nativePath!==''||eventCachePaths.has(descriptor));
    const cacheAccount=nativeShape?await binding.windowsPttAccount():null;check();
    if(cacheAccount!==null){
     if(cacheAccount!==descriptor.accountId)throw voiceError('wrong_scope');
     if(typeof source.nativePath!=='string'||!source.nativePath||source.nativePath.length>4096||
        eventCachePaths.has(descriptor)&&eventCachePaths.get(descriptor)!==digest(source.nativePath))throw voiceError('message_changed');
     const {selectCachePath,readCacheFile}=require('./qq-group-ptt-windows.cjs');
     const target=selectCachePath(this.getWindowsDocuments(),cacheAccount,source.nativePath);
     raw=await cancellable(()=>readCacheFile(target,{sourceBytes:source.sourceBytes,sha1:source.sha1,signal:binding.signal}),
      binding.signal,result=>{if(Buffer.isBuffer(result))result.fill(0);});
    }else{
     downloader=this.createDownloader();
     if(typeof downloader?.download!=='function'||typeof downloader?.close!=='function')throw voiceError('invalid_config');
     const got=await cancellable(()=>downloader.download(source.url,{signal:binding.signal,assertCurrent:check,
      expectedResourceDigest:descriptor.resourceDigest,expectedSourceBytes:descriptor.sourceBytes}),binding.signal,
      result=>{if(Buffer.isBuffer(result?.bytes))result.bytes.fill(0);});
     raw=got?.bytes;if(got?.resourceDigest!==descriptor.resourceDigest)throw voiceError('message_changed');
    }
    check();
    if(!Buffer.isBuffer(raw)||raw.length!==descriptor.sourceBytes||
       createHash('sha1').update(raw).digest('hex')!==source.sha1)throw voiceError('message_changed');
    // Re-read the native message before decode. A local cache path must still
    // identify precisely the same original that was read from the held handle.
    await binding.verify();check();
    const final=verifiedRecord(await binding.getMessage(descriptor.id),descriptor);check();
    if(cacheAccount!==null&&final.nativePath!==source.nativePath)throw voiceError('message_changed');
    audio=await cancellable(()=>this.decodeSilk(raw,{signal:binding.signal}),binding.signal,
     result=>{if(Buffer.isBuffer(result?.pcm))result.pcm.fill(0);});
    check();
    const {pcm,sampleRate,durationSeconds}=audio||{};
    if(!Buffer.isBuffer(pcm)||!pcm.length||pcm.length%2||![16000,24000,32000,44100,48000].includes(sampleRate)||
       durationSeconds!==pcm.length/(2*sampleRate)||durationSeconds<.2||durationSeconds>30)throw voiceError('voice_format');
    audio=null;return {pcm,sampleRate,durationSeconds};
   }
   raw=source;
   try{normalized=canonicalWav(raw);}
   catch(error){throw voiceError(error.code==='voice_duration'?'duration_limit':'voice_format');}
   await binding.verify();check();
   return {pcm:Buffer.from(normalized.bytes.subarray(44)),sampleRate:normalized.sampleRate,durationSeconds:normalized.durationSeconds};
  }finally{
   if(Buffer.isBuffer(raw))raw.fill(0);
   if(Buffer.isBuffer(audio?.pcm))audio.pcm.fill(0);
   normalized?.bytes.fill(0);
   try{downloader?.close?.();}catch{/* The scoped abort also retires the transport. */}
   binding.release();
  }
 }
}

module.exports={captureGroupVoice,groupVoiceSource,GroupRecordReader};
