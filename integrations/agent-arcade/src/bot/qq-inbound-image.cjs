'use strict';
// Exact owner/friend single-image event -> same-message URL download. Neither
// the filename cache nor an arbitrary local file is an image source.
const {randomUUID}=require('node:crypto');
const quoted=require('./qq-quoted-image.cjs');
const {imageSource}=require('./qq-image-source.cjs'),{QQImageDownloader,MAX_BYTES}=require('./qq-image-download.cjs');
const validateQQUrl=value=>require('./qq.cjs').validateQQUrl(value);
const validateQQOwner=value=>require('./qq.cjs').validateQQOwner(value);
const MAX_FRAME=1024*1024,MAX_CAPTION=1900;
const CODES=new Set(['unsupported','wrong_scope','invalid_config','invalid_response','response_too_large','source_too_large','cancelled','timeout','disconnected','account_changed','account_offline','status_unverified','action_failed','message_changed','busy','image_source_unsupported','image_invalid','image_format','image_animated','image_too_large','dns_failed','address_rejected','tls_untrusted','connection_failed','redirect_rejected','http_error','changed','closed']);
class InboundImageError extends Error{constructor(code){const safe=CODES.has(code)?code:'invalid_response';super(`Owner image was not read (${safe}).`);this.code=safe;this.name=safe==='cancelled'?'AbortError':'InboundImageError';}}
const failure=code=>new InboundImageError(code),object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x),signalLike=x=>x==null||typeof x.aborted==='boolean'&&typeof x.addEventListener==='function'&&typeof x.removeEventListener==='function';
function qq(value){try{return validateQQOwner(value);}catch{throw failure('invalid_response');}}
function messageId(value){if(Number.isSafeInteger(value))return String(value);if(typeof value==='string'&&/^-?\d{1,20}$/.test(value))return value;throw failure('invalid_response');}
function size(value){const n=typeof value==='string'&&/^[1-9]\d{0,7}$/.test(value)?Number(value):value;if(!Number.isSafeInteger(n)||n<1)throw failure('invalid_response');if(n>MAX_BYTES)throw failure('source_too_large');return n;}
function imageSegment(message,{allowMissingSize=false}={}){
 if(!Array.isArray(message)||!message.length||message.length>16)throw failure('unsupported');let image=null,caption='';
 for(let index=0;index<message.length;index++){const segment=message[index];if(!object(segment)||!object(segment.data))throw failure('unsupported');if(segment.type==='text'){if(typeof segment.data.text!=='string'||!segment.data.text.isWellFormed()||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(segment.data.text))throw failure('unsupported');caption+=segment.data.text;if(caption.length>MAX_CAPTION)throw failure('unsupported');}
  else if(segment.type==='image'&&!image){
   const source=imageSource(segment.data.url);
   const sourceBytes=allowMissingSize&&!Object.hasOwn(segment.data,'file_size')?null:size(segment.data.file_size);
   image={segmentIndex:index,sourceBytes,resourceDigest:source.resourceDigest,url:source.url};
  }
  else throw failure('unsupported');
 }
 if(!image)throw failure('unsupported');return {...image,segmentCount:message.length,caption};
}
function captureOwnerImage(frame,{accountId,ownerId,companion,acceptAfter=0,now=Date.now()}={}){
 if(companion!==true||qq(accountId)===qq(ownerId))throw failure('wrong_scope');
 if(!object(frame)||frame.post_type!=='message'||frame.message_type!=='private'||frame.sub_type!=='friend'||String(frame.self_id)!==accountId||String(frame.user_id)!==ownerId||frame.group_id!==undefined||frame.sender?.user_id!==undefined&&String(frame.sender.user_id)!==ownerId)throw failure('wrong_scope');
 const id=messageId(frame.message_id),createdAt=frame.time*1000;if(!Number.isSafeInteger(frame.time)||!Number.isSafeInteger(createdAt)||createdAt<0||!Number.isSafeInteger(acceptAfter)||!Number.isSafeInteger(now)||createdAt<acceptAfter||createdAt>now+60000)throw failure('invalid_response');
 const {url,...image}=imageSegment(frame.message);return Object.freeze({kind:'qq-owner-image',accountId,ownerId,id,createdAt,...image});
}
function validateDescriptor(v){
 const keys=['kind','accountId','ownerId','id','createdAt','segmentIndex','sourceBytes','resourceDigest','segmentCount','caption'];
 if(!object(v)||Object.keys(v).length!==keys.length||Object.keys(v).some(k=>!keys.includes(k))||v.kind!=='qq-owner-image'||qq(v.accountId)===qq(v.ownerId)||messageId(v.id)!==v.id||!Number.isSafeInteger(v.createdAt)||v.createdAt<0||v.createdAt%1000!==0||!Number.isSafeInteger(v.segmentCount)||v.segmentCount<1||v.segmentCount>16||!Number.isSafeInteger(v.segmentIndex)||v.segmentIndex<0||v.segmentIndex>=v.segmentCount||size(v.sourceBytes)!==v.sourceBytes||typeof v.resourceDigest!=='string'||!/^[a-f0-9]{64}$/.test(v.resourceDigest)||typeof v.caption!=='string'||v.caption.length>MAX_CAPTION||!v.caption.isWellFormed()||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(v.caption))throw failure('invalid_config');return Object.freeze({...v});
}
function verifyMessage(data,descriptor){
 if(!object(data)||messageId(data.message_id)!==descriptor.id||data.message_type!=='private'||data.group_id!==undefined||String(data.user_id)!==descriptor.ownerId||String(data.sender?.user_id)!==descriptor.ownerId||data.self_id!==undefined&&String(data.self_id)!==descriptor.accountId||data.time*1000!==descriptor.createdAt)throw failure('message_changed');
 let observed;try{observed=imageSegment(data.message);}catch{throw failure('message_changed');}
 if(['segmentIndex','segmentCount','sourceBytes','resourceDigest','caption'].some(k=>observed[k]!==descriptor[k]))throw failure('message_changed');return observed.url;
}
class OwnerImageReader{
 constructor({WebSocket,createDownloader=()=>new QQImageDownloader(),timeoutMs=20000}={}){if(!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>30000||typeof createDownloader!=='function')throw failure('invalid_config');this.WebSocket=WebSocket;this.createDownloader=createDownloader;this.timeoutMs=timeoutMs;}
 async read(input,{url,token,signal,assertCurrent,assertImageAllowed=()=>{}}={}){
  let endpoint,descriptor;try{endpoint=validateQQUrl(url);if(!signalLike(signal)||typeof token!=='string'||!/^[\x21-\x7e]{16,256}$/.test(token)||typeof assertCurrent!=='function'||typeof assertImageAllowed!=='function')throw Error();descriptor=input?.kind==='qq-owner-quote'?quoted.validateQuote(input):validateDescriptor(input);}catch{throw failure('invalid_config');}
  if(signal?.aborted)throw failure('cancelled');const WebSocket=this.WebSocket||require('ws');
  return new Promise((resolve,reject)=>{
   let socket,pending=null,settled=false,started=false,frames=0,total=0,result=null,downloader=null;const controller=new AbortController();
   const finish=(error,value)=>{if(settled){if(Buffer.isBuffer(value))value.fill(0);return;}settled=true;clearTimeout(timer);signal?.removeEventListener('abort',cancel);controller.abort();try{downloader?.close();}catch{}const p=pending;pending=null;p?.reject(error||failure('cancelled'));if(error&&Buffer.isBuffer(result?.bytes))result.bytes.fill(0);if(socket){socket.removeAllListeners('message');socket.removeAllListeners('open');socket.removeAllListeners('close');socket.removeAllListeners('error');socket.on('error',()=>{});try{socket.terminate();}catch{}}error?reject(error):resolve(value);};
   const current=()=>{if(settled||signal?.aborted||controller.signal.aborted)throw failure('cancelled');const value=assertCurrent();if(value?.then){value.catch?.(()=>{});throw failure('invalid_config');}if(settled||signal?.aborted||controller.signal.aborted)throw failure('cancelled');};
   const cancel=()=>finish(failure('cancelled')),timer=setTimeout(()=>finish(failure('timeout')),this.timeoutMs);
   const request=(action,params={})=>new Promise((yes,no)=>{try{current();const echo=randomUUID();pending={echo,resolve:yes,reject:no};socket.send(JSON.stringify({action,params,echo}),error=>{if(error)finish(failure('disconnected'));});}catch(error){no(error);}});
   const verify=async()=>{const identity=await request('get_login_info');current();if(!object(identity)||qq(identity.user_id)!==descriptor.accountId)throw failure('account_changed');const status=await request('get_status');current();if(!object(status)||typeof status.online!=='boolean'||(status.good!==undefined&&typeof status.good!=='boolean'))throw failure('status_unverified');if(!status.online||status.good===false)throw failure('account_offline');};
   signal?.addEventListener('abort',cancel,{once:true});if(signal?.aborted){cancel();return;}
   try{
    current();socket=new WebSocket(endpoint,{headers:{Authorization:`Bearer ${token}`},followRedirects:false,perMessageDeflate:false,maxPayload:MAX_FRAME,handshakeTimeout:this.timeoutMs});
    socket.on('error',error=>finish(failure(error?.code==='WS_ERR_UNSUPPORTED_MESSAGE_LENGTH'?'response_too_large':'disconnected')));socket.on('unexpected-response',(_req,res)=>{try{res.destroy();}catch{}finish(failure('disconnected'));});socket.once('close',()=>finish(failure('disconnected')));
    socket.on('message',(raw,binary)=>{if(settled)return;try{current();if(binary||!Buffer.isBuffer(raw))throw failure('invalid_response');if(++frames>128||raw.length>MAX_FRAME||(total+=raw.length)>MAX_FRAME*2)throw failure('response_too_large');const row=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));if(!object(row))throw failure('invalid_response');if(Object.hasOwn(row,'post_type')){if(row.self_id!==undefined&&String(row.self_id)!==descriptor.accountId)throw failure('account_changed');return;}if(!pending||row.echo!==pending.echo)return;if(row.status!=='ok'||row.retcode!==0)throw failure('action_failed');const p=pending;pending=null;p.resolve(row.data);}catch(error){finish(error instanceof InboundImageError?error:failure(error?.code));}});
    socket.once('open',()=>{if(started||settled)return;started=true;(async()=>{
     await verify();const observed=await request('get_msg',{message_id:descriptor.id});current();
     let imageURL,resourceDigest=descriptor.resourceDigest,reference;
     const resolveReference=async()=>{const friends=await request('get_friend_list',{no_cache:false});current();quoted.verifyFriends(friends,descriptor);const raw=await request('get_friend_msg_history',quoted.historyParams(descriptor));current();return quoted.target(raw,descriptor);};
     if(descriptor.kind==='qq-owner-quote'){
      quoted.verifyQuote(observed,descriptor);reference=await resolveReference();current();
      if(reference.kind==='text-reference'){await verify();current();const again=await request('get_msg',{message_id:descriptor.id});current();quoted.verifyQuote(again,descriptor);const next=await resolveReference();current();if(next.kind!=='text-reference'||next.fingerprint!==reference.fingerprint)throw failure('message_changed');finish(null,Object.freeze({kind:'qq-quoted-text'}));return;}
      imageURL=reference.source.url;resourceDigest=reference.source.resourceDigest;
     }else imageURL=verifyMessage(observed,descriptor);
     const permission=assertImageAllowed();if(permission?.then){permission.catch?.(()=>{});throw failure('invalid_config');}current();
     downloader=this.createDownloader();if(typeof downloader?.download!=='function'||typeof downloader?.close!=='function')throw failure('invalid_config');
     result=await downloader.download(imageURL,{expectedResourceDigest:resourceDigest,assertCurrent:current,signal:controller.signal});current();
     if(!result||!Buffer.isBuffer(result.bytes)||result.bytes.length<1||result.bytes.length>MAX_BYTES||result.resourceDigest!==resourceDigest)throw failure('invalid_response');
     await verify();current();
     if(reference){const fresh=await request('get_msg',{message_id:descriptor.id});current();quoted.verifyQuote(fresh,descriptor);const next=await resolveReference();current();if(next.kind!=='image'||next.fingerprint!==reference.fingerprint||next.source.resourceDigest!==resourceDigest)throw failure('message_changed');}
     finish(null,result.bytes);
    })().catch(error=>{if(settled)result?.bytes?.fill(0);else finish(error instanceof InboundImageError?error:failure(error?.code));});});
   }catch(error){finish(failure(error?.code||'disconnected'));}
  });
 }
}
module.exports={InboundImageError,captureOwnerImage,imageSegment,verifyMessage,OwnerImageReader,MAX_FRAME,MAX_CAPTION};
