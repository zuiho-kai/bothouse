'use strict';
// Bounded QQ media reads behind fixed image and group voice policies. The
// transport carries no OneBot, management, provider, browser or proxy data.
const dns=require('node:dns').promises,net=require('node:net'),tls=require('node:tls'),http=require('node:http');
const {imageSource}=require('./qq-image-source.cjs');
const {dimensions}=require('./qq-media.cjs');
const MAX_BYTES=8*1024*1024,MAX_VOICE_BYTES=512*1024,MAX_HEADERS=16*1024,MAX_TIME=15000;
const CODES=new Set(['invalid_request','image_source_unsupported','voice_source_unsupported','closed','busy','cancelled','timeout','changed','dns_failed','address_rejected','tls_untrusted','connection_failed','redirect_rejected','http_error','response_too_large','invalid_response','image_invalid','image_format','image_animated','image_too_large']);
class ImageDownloadError extends Error{constructor(code){const safe=CODES.has(code)?code:'connection_failed';super(`QQ image download failed (${safe}).`);this.code=safe;}}
const fail=code=>{throw new ImageDownloadError(code);};
const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&(Object.getPrototypeOf(v)===Object.prototype||Object.getPrototypeOf(v)===null);
const denied4=new net.BlockList(),denied6=new net.BlockList();
for(const [address,prefix]of [['0.0.0.0',8],['10.0.0.0',8],['100.64.0.0',10],['127.0.0.0',8],['169.254.0.0',16],['172.16.0.0',12],['192.0.0.0',24],['192.0.2.0',24],['192.88.99.0',24],['192.168.0.0',16],['198.18.0.0',15],['198.51.100.0',24],['203.0.113.0',24],['224.0.0.0',3]])denied4.addSubnet(address,prefix,'ipv4');
for(const [address,prefix]of [['2001::',23],['2001:db8::',32],['2002::',16],['3fff::',20]])denied6.addSubnet(address,prefix,'ipv6');
function publicAddress(value){
 if(typeof value!=='string'||value.includes('%'))fail('address_rejected');const family=net.isIP(value);
 if(family===4){if(denied4.check(value,'ipv4'))fail('address_rejected');return value;}
 if(family!==6)fail('address_rejected');const normalized=new URL(`http://[${value}]/`).hostname.slice(1,-1),first=parseInt(normalized.split(':')[0],16);
 // Only ordinary global-unicast IPv6; reject mapped, local, translation,
 // documentation and special-purpose forms instead of treating them as v4.
 if(!Number.isFinite(first)||first<0x2000||first>0x3fff||denied6.check(normalized,'ipv6'))fail('address_rejected');return normalized;
}
function wait(promise,signal){return new Promise((resolve,reject)=>{let done=false;const end=(error,value)=>{if(done)return;done=true;signal.removeEventListener('abort',abort);error?reject(error):resolve(value);},abort=()=>end(signal.reason);signal.addEventListener('abort',abort,{once:true});Promise.resolve(promise).then(v=>end(null,v),e=>end(e));if(signal.aborted)abort();});}
function secure(socket,signal){return new Promise((resolve,reject)=>{let done=false;const end=error=>{if(done)return;done=true;socket.removeListener('secureConnect',ready);socket.removeListener('error',failed);socket.removeListener('close',closed);signal.removeEventListener('abort',abort);error?reject(error):resolve();},ready=()=>end(),failed=()=>end(new ImageDownloadError('tls_untrusted')),closed=()=>end(new ImageDownloadError('connection_failed')),abort=()=>end(signal.reason);socket.once('secureConnect',ready);socket.once('error',failed);socket.once('close',closed);signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();});}
class QQMediaDownloader{
 constructor({lookup=(host,options)=>dns.lookup(host,options),connect=options=>tls.connect(options),timeoutMs=MAX_TIME,sourceParser=imageSource,onSocket=()=>{}}={},voice=false){if(typeof lookup!=='function'||typeof connect!=='function'||typeof sourceParser!=='function'||typeof onSocket!=='function'||!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>MAX_TIME)fail('invalid_request');this.lookup=lookup;this.connect=connect;this.sourceParser=sourceParser;this.onSocket=onSocket;this.timeoutMs=timeoutMs;this.active=null;this.closed=false;this.voice=voice;}
 async download(url,options={}){
  let socket,req,res,operation,timer,externalAbort,output;const chunks=[];
  try{
   if(this.closed)fail('closed');if(this.active)fail('busy');
   if(!plain(options)||Object.keys(options).some(k=>!['signal','assertCurrent','expectedResourceDigest'].includes(k)&&!(this.voice&&k==='expectedSourceBytes')))fail('invalid_request');
   const {signal,assertCurrent,expectedResourceDigest,expectedSourceBytes}=options;
   if(this.voice&&(!Number.isSafeInteger(expectedSourceBytes)||expectedSourceBytes<1||expectedSourceBytes>MAX_VOICE_BYTES))fail('invalid_request');
   const limit=this.voice?expectedSourceBytes:MAX_BYTES;
   const accept=this.voice?'application/octet-stream, audio/silk, audio/x-silk':'image/png, image/jpeg, application/octet-stream';
   const validType=this.voice?/^(?:audio\/(?:silk|x-silk)|application\/octet-stream)(?:;|$)/i:/^(?:image\/(?:png|jpeg)|application\/octet-stream)(?:;|$)/i;
   if(typeof assertCurrent!=='function'||typeof expectedResourceDigest!=='string'||!/^[a-f0-9]{64}$/.test(expectedResourceDigest)||signal!=null&&(typeof signal.addEventListener!=='function'||typeof signal.removeEventListener!=='function'||typeof signal.aborted!=='boolean'))fail('invalid_request');
   const source=this.sourceParser(url);if(source.resourceDigest!==expectedResourceDigest||this.voice&&source.sourceBytes!==expectedSourceBytes)fail('changed');const targetURL=new URL(source.url),controller=new AbortController();operation={controller};this.active=operation;
   externalAbort=()=>controller.abort(new ImageDownloadError('cancelled'));signal?.addEventListener('abort',externalAbort,{once:true});if(signal?.aborted)externalAbort();timer=setTimeout(()=>controller.abort(new ImageDownloadError('timeout')),this.timeoutMs);
   const check=()=>{if(controller.signal.aborted)throw controller.signal.reason;if(this.closed||this.active!==operation)fail('closed');const result=assertCurrent();if(result?.then){result.catch?.(()=>{});fail('invalid_request');}if(controller.signal.aborted)throw controller.signal.reason;if(this.closed||this.active!==operation)fail('closed');};
   check();let addresses;try{addresses=await wait(this.lookup(targetURL.hostname,{all:true,verbatim:true}),controller.signal);}catch{if(controller.signal.aborted)throw controller.signal.reason;fail('dns_failed');}check();
   if(!Array.isArray(addresses)||!addresses.length||addresses.length>16)fail('dns_failed');const checked=addresses.map(row=>{if(!plain(row)||![4,6].includes(row.family)||net.isIP(row.address)!==row.family)fail('dns_failed');return {address:row.address,family:row.family,normalized:publicAddress(row.address)};}),target=checked[0];
   socket=this.connect({host:target.address,family:target.family,port:443,servername:targetURL.hostname,rejectUnauthorized:true,minVersion:'TLSv1.2',ALPNProtocols:['http/1.1'],checkServerIdentity:(_host,cert)=>tls.checkServerIdentity(targetURL.hostname,cert)});if(!(socket instanceof tls.TLSSocket)){socket?.destroy?.();fail('tls_untrusted');}socket.on('error',()=>{});this.onSocket(socket);
   await secure(socket,controller.signal);check();if(socket.destroyed||socket.authorized!==true||publicAddress(socket.remoteAddress)!==target.normalized||socket.remotePort!==443||tls.checkServerIdentity(targetURL.hostname,socket.getPeerCertificate(true)))fail('tls_untrusted');
   output=await new Promise((resolve,reject)=>{
    let done=false,length=0;const end=(error,value)=>{if(done){value?.bytes?.fill(0);return;}done=true;controller.signal.removeEventListener('abort',aborted);error?reject(error):resolve(value);},aborted=()=>{end(controller.signal.reason);req?.destroy();socket?.destroy();};controller.signal.addEventListener('abort',aborted,{once:true});
    try{
     req=http.request({protocol:'http:',hostname:targetURL.hostname,port:443,path:targetURL.pathname+targetURL.search,method:'GET',createConnection:()=>socket,maxHeaderSize:MAX_HEADERS,setHost:false,headers:{host:targetURL.hostname,connection:'close',accept,'accept-encoding':'identity'}},response=>{
      res=response;const stop=code=>{end(new ImageDownloadError(code));response.destroy();};
      if(response.statusCode>=300&&response.statusCode<400)return stop('redirect_rejected');if(response.statusCode!==200)return stop('http_error');
      const contentType=response.headers['content-type']||'';
      if(!validType.test(contentType))return stop(!this.voice&&/^image\//i.test(contentType)?'image_format':'invalid_response');
      if(response.headers['content-encoding']&&response.headers['content-encoding']!=='identity')return stop('invalid_response');
      const declared=response.headers['content-length'];if(declared!==undefined&&(!/^\d{1,12}$/.test(declared)||Number(declared)>limit))return stop('response_too_large');
      if(this.voice&&declared!==undefined&&Number(declared)!==expectedSourceBytes)return stop('invalid_response');
      response.on('error',()=>end(new ImageDownloadError('connection_failed')));response.on('aborted',()=>end(new ImageDownloadError('connection_failed')));
      response.on('data',chunk=>{if(done){chunk.fill(0);return;}try{check();length+=chunk.length;if(length>limit){chunk.fill(0);stop('response_too_large');}else chunks.push(chunk);}catch(error){chunk.fill(0);end(error);response.destroy();}});
      response.on('end',()=>{if(done)return;let bytes;try{check();if(declared!==undefined&&Number(declared)!==length||this.voice&&length!==expectedSourceBytes)fail('invalid_response');bytes=Buffer.concat(chunks,length);if(this.voice){end(null,{bytes,resourceDigest:source.resourceDigest});bytes=null;return;}const extension=bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))?'.png':bytes[0]===255&&bytes[1]===216?'.jpg':null;if(!extension)fail('image_format');const size=dimensions(bytes,extension);check();end(null,{bytes,extension,...size,resourceDigest:source.resourceDigest});bytes=null;}catch(error){bytes?.fill(0);end(error);}});
     });req.on('error',error=>end(new ImageDownloadError(error?.code==='HPE_HEADER_OVERFLOW'?'response_too_large':'connection_failed')));check();if(socket.destroyed)fail('connection_failed');req.end();
    }catch(error){end(error);req?.destroy();}
   });check();return output;
  }catch(error){output?.bytes.fill(0);throw new ImageDownloadError(error?.code);}
  finally{clearTimeout(timer);if(externalAbort)options.signal?.removeEventListener('abort',externalAbort);res?.destroy();req?.destroy();socket?.destroy();for(const chunk of chunks)chunk.fill(0);if(this.active===operation)this.active=null;}
 }
 close(){this.closed=true;this.active?.controller.abort(new ImageDownloadError('closed'));}
}
class QQImageDownloader extends QQMediaDownloader{
 constructor(options){super(options);}
}
class QQVoiceDownloader extends QQMediaDownloader{
 constructor(options={}){super({...options,sourceParser:require('./qq-group-voice.cjs').groupVoiceSource},true);}
}
module.exports={QQImageDownloader,QQVoiceDownloader,ImageDownloadError,publicAddress,MAX_BYTES,MAX_VOICE_BYTES,MAX_HEADERS,MAX_TIME};
