'use strict';
// Original fixed-route transport. A verified TLS socket is established before
// any authentication bytes are written. No local QQ/runtime contract changes.
const dns=require('node:dns').promises;
const net=require('node:net');
const tls=require('node:tls');
const http=require('node:http');
const {createHash,X509Certificate}=require('node:crypto');
const MAX_BODY=128*1024,MAX_HEADERS=16*1024,MAX_CA=128*1024;
const ROUTES=Object.freeze(Object.fromEntries(Object.entries({
 login:['POST','/api/auth/login'],check:['POST','/api/auth/check'],logout:['POST','/api/auth/logout'],
 passkeyRegistrationOptions:['POST','/api/auth/passkey/generate-registration-options'],passkeyRegistrationVerify:['POST','/api/auth/passkey/verify-registration'],
 passkeyAuthenticationOptions:['POST','/api/auth/passkey/generate-authentication-options'],passkeyAuthenticationVerify:['POST','/api/auth/passkey/verify-authentication'],
 version:['GET','/api/base/GetNapCatVersion'],qqStatus:['POST','/api/QQLogin/CheckLoginStatus'],qqInfo:['POST','/api/QQLogin/GetQQLoginInfo'],
 qqQRCode:['POST','/api/QQLogin/GetQQLoginQrcode'],qqRefreshQR:['POST','/api/QQLogin/RefreshQRcode'],qqQuickList:['POST','/api/QQLogin/GetQuickLoginList'],qqQuickLogin:['POST','/api/QQLogin/SetQuickLogin'],
 networkRead:['GET','/api/WebUIConfig/GetConfig'],networkWrite:['POST','/api/WebUIConfig/UpdateConfig'],rotateToken:['POST','/api/auth/update_token'],
 twoFactorStatus:['GET','/api/auth/2fa/status'],twoFactorGenerate:['POST','/api/auth/2fa/generate-secret'],twoFactorEnable:['POST','/api/auth/2fa/enable'],twoFactorDisable:['POST','/api/auth/2fa/disable'],
 certificateUpload:['POST','/api/WebUIConfig/UploadSSLCert'],certificateDelete:['POST','/api/WebUIConfig/DeleteSSLCert'],restart:['POST','/api/Process/Restart'],
}).map(([key,value])=>[key,Object.freeze(value)])));
const UNAUTHENTICATED_ROUTES=new Set(['login','passkeyAuthenticationOptions','passkeyAuthenticationVerify']);
const PASSKEY_ROUTES=new Set(['passkeyRegistrationOptions','passkeyRegistrationVerify','passkeyAuthenticationOptions','passkeyAuthenticationVerify']);
const CODES=new Set(['invalid_request','invalid_config','closed','operation_in_progress','cancelled','timeout','connection_failed','dns_failed','address_rejected','tls_untrusted','redirect_rejected','http_error','unauthorized','response_too_large','invalid_response','changed','expired_ticket','login_expired','passkey_expired','passkey_cancelled']);
class QQRemoteTransportError extends Error{
 constructor(code,{submitted=false}={}){const safe=CODES.has(code)?code:'connection_failed';super(`Remote QQ request failed (${safe}).`);this.code=safe;this.submitted=submitted===true;this.name=safe==='cancelled'?'AbortError':'QQRemoteTransportError';}
}
const fail=code=>{throw new QQRemoteTransportError(code);};
const plain=v=>v!==null&&typeof v==='object'&&(Object.getPrototypeOf(v)===Object.prototype||Object.getPrototypeOf(v)===null);
function normalizeAddress(value){
 if(typeof value!=='string'||value.includes('%'))fail('address_rejected');const family=net.isIP(value);if(family===4)return value;if(family!==6)fail('address_rejected');
 const normalized=new URL(`http://[${value}]/`).hostname.slice(1,-1).toLowerCase(),mapped=/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(normalized);
 if(mapped){const a=parseInt(mapped[1],16),b=parseInt(mapped[2],16);return `${a>>>8}.${a&255}.${b>>>8}.${b&255}`;}return normalized;
}
function validateAddress(value){
 const address=normalizeAddress(value);
 if(net.isIP(address)===4){const p=address.split('.').map(Number);if(p[0]===0||p[0]===127||p[0]>=224||p[0]===169&&p[1]===254)fail('address_rejected');}
 else {const first=parseInt(address.split(':')[0]||'0',16);if(address==='::'||/^::(?:[0-9a-f]{1,4}:)?[0-9a-f]{1,4}$/.test(address)||(first&0xff00)===0xff00||(first&0xffc0)===0xfe80)fail('address_rejected');}
 return address;
}
function validateRemoteOrigin(value){
 if(typeof value!=='string'||value.length>2048||/[\x00-\x20\x7f\\]/.test(value))fail('invalid_config');let url;try{url=new URL(value);}catch{fail('invalid_config');}
 if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||url.pathname!=='/'||!url.hostname||url.hostname.endsWith('.')||url.port&&(!Number.isInteger(Number(url.port))||Number(url.port)<1))fail('invalid_config');
 const hostname=url.hostname.replace(/^\[|\]$/g,'');if(net.isIP(hostname))validateAddress(hostname);else if(hostname==='localhost'||hostname.endsWith('.localhost')||hostname.length>253||hostname.split('.').some(label=>!label||label.length>63||!/^([a-z0-9]|[a-z0-9][a-z0-9-]*[a-z0-9])$/.test(label)))fail('invalid_config');
 return url.origin;
}
function validateRemoteTrust(value={}){
 if(!plain(value)||Object.keys(value).some(k=>!['caPem','spkiSha256'].includes(k)))fail('invalid_config');const out={};
 if(value.caPem!==undefined){const pem=value.caPem;if(typeof pem!=='string'||!pem.length||Buffer.byteLength(pem)>MAX_CA||pem.includes('\0'))fail('invalid_config');const blocks=pem.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g);if(!blocks?.length||blocks.length>16||pem.replace(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g,'').trim())fail('invalid_config');try{for(const block of blocks)if(!new X509Certificate(block).ca)fail('invalid_config');}catch{fail('invalid_config');}out.caPem=pem;}
 if(value.spkiSha256!==undefined){if(typeof value.spkiSha256!=='string'||!/^[a-f0-9]{64}$/.test(value.spkiSha256))fail('invalid_config');out.spkiSha256=value.spkiSha256;}
 return Object.freeze(out);
}
function boundedJSON(value,code){
 const pending=[[value,0]],seen=new Set();let nodes=0;
 while(pending.length){const [v,depth]=pending.pop();if(++nodes>8192||depth>32)fail(code);if(v===null||typeof v==='boolean'||typeof v==='string')continue;if(typeof v==='number'){if(!Number.isFinite(v))fail(code);continue;}if(typeof v!=='object'||seen.has(v)||!Array.isArray(v)&&!plain(v))fail(code);seen.add(v);const keys=Object.keys(v);if(keys.length>4096)fail(code);for(const key of keys){if(['__proto__','prototype','constructor'].includes(key))fail(code);const d=Object.getOwnPropertyDescriptor(v,key);if(!d||!Object.hasOwn(d,'value'))fail(code);pending.push([d.value,depth+1]);}}
 return value;
}
function waitFor(promise,signal,late=()=>{}){return new Promise((resolve,reject)=>{let done=false;const finish=(error,value)=>{if(done){if(!error)late(value);return;}done=true;signal.removeEventListener('abort',abort);error?reject(error):resolve(value);},abort=()=>finish(signal.reason);signal.addEventListener('abort',abort,{once:true});Promise.resolve(promise).then(v=>finish(null,v),e=>finish(e));if(signal.aborted)abort();});}
function secure(socket,signal){return new Promise((resolve,reject)=>{let done=false;const finish=failure=>{if(done)return;done=true;socket.removeListener('secureConnect',ready);socket.removeListener('error',onError);socket.removeListener('close',closed);signal.removeEventListener('abort',abort);failure?reject(failure):resolve();},ready=()=>finish(),onError=()=>finish(new QQRemoteTransportError('tls_untrusted')),closed=()=>finish(new QQRemoteTransportError('connection_failed')),abort=()=>finish(signal.reason);socket.once('secureConnect',ready);socket.once('error',onError);socket.once('close',closed);signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();});}
class QQRemoteTransport{
 constructor({origin,caPem,spkiSha256,timeoutMs=15000,lookup=(host,options)=>dns.lookup(host,options),connect=options=>tls.connect(options)}={}){
  this.origin=validateRemoteOrigin(origin);this.trust=validateRemoteTrust({...(caPem===undefined?{}:{caPem}),...(spkiSha256===undefined?{}:{spkiSha256})});if(!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>15000||typeof lookup!=='function'||typeof connect!=='function')fail('invalid_config');
  const url=new URL(this.origin);this.config=Object.freeze({hostname:url.hostname.replace(/^\[|\]$/g,''),host:url.host,port:Number(url.port||443),timeoutMs});this.lookup=lookup;this.connect=connect;this.active=null;this.closed=false;
 }
 async request(routeKey,{body,credential,signal,assertCurrent=()=>{},onAttempt}={}){
  let submitted=false,socket,req,res,operation,timer,externalAbort;
  try{
   if(this.closed)fail('closed');if(this.active)fail('operation_in_progress');if(!Object.hasOwn(ROUTES,routeKey)||typeof assertCurrent!=='function'||onAttempt!==undefined&&typeof onAttempt!=='function'||signal!=null&&(typeof signal.addEventListener!=='function'||typeof signal.removeEventListener!=='function'||typeof signal.aborted!=='boolean'))fail('invalid_request');
   const [method,route]=ROUTES[routeKey];if(method==='GET'&&body!==undefined||body!==undefined&&!plain(body))fail('invalid_request');if(UNAUTHENTICATED_ROUTES.has(routeKey)?credential!==undefined:credential===undefined)fail('invalid_request');if(credential!==undefined&&(typeof credential!=='string'||credential.length<1||credential.length>8192||!/^[A-Za-z0-9+/=_-]+$/.test(credential)))fail('invalid_request');
   const bytes=method==='GET'?Buffer.alloc(0):Buffer.from(JSON.stringify(boundedJSON(body||{},'invalid_request')));if(bytes.length>MAX_BODY)fail('invalid_request');
   const abort=new AbortController();operation={abort};this.active=operation;externalAbort=()=>abort.abort(new QQRemoteTransportError('cancelled'));signal?.addEventListener('abort',externalAbort,{once:true});if(signal?.aborted)externalAbort();timer=setTimeout(()=>abort.abort(new QQRemoteTransportError('timeout')),this.config.timeoutMs);
   const check=()=>{if(abort.signal.aborted)throw abort.signal.reason;if(this.closed||this.active!==operation)fail('closed');const result=assertCurrent();if(result?.then){result.catch?.(()=>{});fail('invalid_request');}if(abort.signal.aborted)throw abort.signal.reason;if(this.closed||this.active!==operation)fail('closed');};
   check();let addresses;try{addresses=net.isIP(this.config.hostname)?[{address:this.config.hostname,family:net.isIP(this.config.hostname)}]:await waitFor(this.lookup(this.config.hostname,{all:true,verbatim:true}),abort.signal);}catch(error){if(abort.signal.aborted)throw abort.signal.reason;fail('dns_failed');}check();
   if(!Array.isArray(addresses)||!addresses.length||addresses.length>16)fail('dns_failed');const checked=addresses.map(row=>{if(!plain(row)||![4,6].includes(row.family)||net.isIP(row.address)!==row.family)fail('dns_failed');return {address:row.address,normalized:validateAddress(row.address),family:row.family};}),target=checked[0];
   socket=this.connect({host:target.address,port:this.config.port,family:target.family,...(!net.isIP(this.config.hostname)?{servername:this.config.hostname}:{}),rejectUnauthorized:true,minVersion:'TLSv1.2',ALPNProtocols:['http/1.1'],...(this.trust.caPem?{ca:this.trust.caPem}:{}),checkServerIdentity:(_name,certificate)=>tls.checkServerIdentity(this.config.hostname,certificate)});
   if(!(socket instanceof tls.TLSSocket)){socket?.destroy?.();fail('tls_untrusted');}socket.on('error',()=>{});
   await secure(socket,abort.signal);check();
   if(socket.destroyed||socket.authorized!==true||normalizeAddress(socket.remoteAddress)!==target.normalized||socket.remotePort!==this.config.port||tls.checkServerIdentity(this.config.hostname,socket.getPeerCertificate(true)))fail('tls_untrusted');
   if(this.trust.spkiSha256){const cert=socket.getPeerX509Certificate(),actual=cert&&createHash('sha256').update(cert.publicKey.export({type:'spki',format:'der'})).digest('hex');if(actual!==this.trust.spkiSha256)fail('tls_untrusted');}
   return await new Promise((resolve,reject)=>{
    let done=false;const finish=(error,value)=>{if(done)return;done=true;abort.signal.removeEventListener('abort',aborted);error?reject(error):resolve(value);},aborted=()=>{finish(abort.signal.reason);req?.destroy();socket?.destroy();};
    abort.signal.addEventListener('abort',aborted,{once:true});
    try{
     // No Agent: createConnection supplies this already-authenticated TLS
     // socket. agent:false would construct an Agent and can bypass that path.
     req=http.request({protocol:'http:',hostname:this.config.hostname,port:this.config.port,path:route,method,createConnection:()=>socket,maxHeaderSize:MAX_HEADERS,setHost:false,headers:{host:this.config.host,connection:'close',accept:'application/json','accept-encoding':'identity',...(PASSKEY_ROUTES.has(routeKey)?{origin:this.origin}:{}),...(method==='POST'?{'content-type':'application/json','content-length':bytes.length}:{}),...(credential?{authorization:`Bearer ${credential}`}:{})}},response=>{
      res=response;if(response.statusCode>=300&&response.statusCode<400){finish(new QQRemoteTransportError('redirect_rejected'));response.destroy();return;}if(response.statusCode!==200){finish(new QQRemoteTransportError([401,403].includes(response.statusCode)?'unauthorized':'http_error'));response.destroy();return;}
      if(!/^application\/json(?:;|$)/i.test(response.headers['content-type']||'')||response.headers['content-encoding']&&response.headers['content-encoding']!=='identity'){finish(new QQRemoteTransportError('invalid_response'));response.destroy();return;}
      const declared=response.headers['content-length'];if(declared!==undefined&&(!/^\d{1,12}$/.test(declared)||Number(declared)>MAX_BODY)){finish(new QQRemoteTransportError('response_too_large'));response.destroy();return;}let length=0;const chunks=[];
      response.on('error',()=>finish(new QQRemoteTransportError('connection_failed')));response.on('aborted',()=>finish(new QQRemoteTransportError('connection_failed')));
      response.on('data',chunk=>{length+=chunk.length;if(length>MAX_BODY){finish(new QQRemoteTransportError('response_too_large'));response.destroy();}else chunks.push(chunk);});
      response.on('end',()=>{try{if(declared!==undefined&&Number(declared)!==length)fail('invalid_response');const value=boundedJSON(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks,length))),'invalid_response');if(!plain(value)||!Number.isSafeInteger(value.code))fail('invalid_response');finish(null,{code:value.code,data:Object.hasOwn(value,'data')?value.data:null});}catch{finish(new QQRemoteTransportError('invalid_response'));}});
     });req.on('error',error=>finish(new QQRemoteTransportError(error?.code==='HPE_HEADER_OVERFLOW'?'response_too_large':'connection_failed')));check();if(socket.destroyed)fail('connection_failed');if(onAttempt){const result=onAttempt();if(result?.then){result.catch?.(()=>{});fail('invalid_request');}}if(abort.signal.aborted)throw abort.signal.reason;submitted=true;req.end(bytes);
    }catch(error){finish(error);req?.destroy();}
   });
  }catch(error){throw new QQRemoteTransportError(error?.code,{submitted});}
  finally{clearTimeout(timer);if(externalAbort)signal?.removeEventListener('abort',externalAbort);res?.destroy();req?.destroy();socket?.destroy();if(this.active===operation)this.active=null;}
 }
 close(){this.closed=true;this.active?.abort.abort(new QQRemoteTransportError('closed'));}
}
module.exports={QQRemoteTransport,QQRemoteTransportError,validateRemoteOrigin,validateRemoteTrust,validateAddress,normalizeAddress,ROUTES,MAX_BODY,MAX_HEADERS,MAX_CA};
