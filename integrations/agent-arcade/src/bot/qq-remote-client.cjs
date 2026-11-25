'use strict';
// Original client for fixed 4.18.42 routes. Secrets and raw response bodies stay here.
const {createHash}=require('node:crypto');
const P=require('./qq-remote-policy.cjs');
class QQRemoteClient{
 constructor({origin,trust={},token,expectedQQ,transport,transportFactory,fileTransport,fileTransportFactory,now=Date.now}={}){this.token=P.token(token);this.expectedQQ=P.qq(expectedQQ);this.transport=transport||(transportFactory?transportFactory({origin,...trust}):new (require('./qq-remote-transport.cjs').QQRemoteTransport)({origin,...trust}));if(!this.transport||typeof this.transport.request!=='function'||typeof this.transport.close!=='function')P.fail('invalid_config');this.fileTransport=fileTransport;this.fileTransportFactory=fileTransportFactory;this.fileEndpoint={origin,...trust};this.now=now;this.credential='';this.authAt=0;this.closed=false;this.abort=new AbortController();}
 _check(options={}){if(this.closed||this.abort.signal.aborted||options.signal?.aborted)P.fail('cancelled');const result=options.assertCurrent?.();if(result?.then){result.catch?.(()=>{});P.fail('invalid_config');}}
 _options(options={}){return {...options,signal:options.signal?AbortSignal.any([options.signal,this.abort.signal]):this.abort.signal,assertCurrent:()=>this._check(options)};}
 async authenticate(options={}){this._check(options);this.credential='';const body={hash:createHash('sha256').update(this.token+'.napcat').digest('hex')};if(options.totpCode!==undefined)body.totpCode=P.otp(options.totpCode);const response=await this.transport.request('login',{...this._options(options),body});this._check(options);if(response?.code!==0)P.fail('unauthorized');const data=response.data;if(data?.require2FA===true){if(data.Credential!==undefined)P.fail('invalid_response');return {challenge:'totp'};}if(!P.plain(data)||typeof data.Credential!=='string'||data.Credential.length<1||data.Credential.length>8192||!/^[A-Za-z0-9+/=_-]+$/.test(data.Credential)||data.require2FA!==undefined&&data.require2FA!==false)P.fail('invalid_response');this.credential=data.Credential;this.authAt=this.now();return {authenticated:true};}
 _authenticated(options){this._check(options);if(!this.credential||this.now()-this.authAt>=45*60*1000)P.fail('unauthorized');}
 async _read(key,options={}){this._authenticated(options);const response=await this.transport.request(key,{...this._options(options),credential:this.credential});this._check(options);if(response?.code!==0)P.fail('request_rejected');return response.data;}
 async _identity(options){const status=await this._read('qqStatus',options);if(!P.plain(status)||typeof status.isLogin!=='boolean'||typeof status.isOffline!=='boolean')P.fail('invalid_response');if(!status.isLogin)return {actualQQ:null,identity:'logged_out'};const info=await this._read('qqInfo',options);const actualQQ=P.qq(info?.uin);if(actualQQ!==this.expectedQQ)P.fail('account_changed');return {actualQQ,identity:'matched'};}
 async read(options={}){const version=await this._read('version',options);if(!P.text(version?.version,64)||!version.version)P.fail('invalid_response');const first=await this._identity(options),network=P.network(await this._read('networkRead',options)),twoFactor=P.twoFactor(await this._read('twoFactorStatus',options)),last=await this._identity(options);if(P.digest(first)!==P.digest(last))P.fail('account_changed');return {...first,version:version.version,network,twoFactor};}
 async generate2FA(options={}){const data=await this._read('twoFactorGenerate',options);if(!P.plain(data)||typeof data.secret!=='string'||!/^[A-Z2-7]{16,128}$/.test(data.secret)||typeof data.qrCodeUrl!=='string'||data.qrCodeUrl.length>1024)P.fail('invalid_response');try{const url=new URL(data.qrCodeUrl);if(url.protocol!=='otpauth:'||url.hostname!=='totp'||url.username||url.password||url.hash||url.searchParams.get('secret')!==data.secret||url.searchParams.get('algorithm')!=='SHA1'||url.searchParams.get('digits')!=='6'||url.searchParams.get('period')!=='30'||[...url.searchParams.keys()].some(k=>!['secret','issuer','algorithm','digits','period'].includes(k))||new Set(url.searchParams.keys()).size!==[...url.searchParams.keys()].length)P.fail('invalid_response');}catch{P.fail('invalid_response');}return {secret:data.secret,otpauthUri:data.qrCodeUrl};}
 async mutate(operation,value,options={}){
  let attempted=false;try{this._authenticated(options);let route,body;
   if(operation==='network'){route='networkWrite';body=P.networkPatch(value.patch);}
   else if(operation==='rotateToken'){P.token(value.newToken);route='rotateToken';body={oldToken:this.token,newToken:value.newToken};}
   else if(operation==='enable2FA'){if(typeof value.secret!=='string'||!/^[A-Z2-7]{16,128}$/.test(value.secret))P.fail('invalid_request');route='twoFactorEnable';body={secret:value.secret,totpCode:P.otp(value.totpCode)};}
   else if(operation==='disable2FA'){route='twoFactorDisable';body={totpCode:P.otp(value.totpCode)};}
   else if(operation==='replaceCertificate'){if(typeof value.cert!=='string'||typeof value.key!=='string'||Buffer.byteLength(value.cert)>P.LIMITS.certificateMaxBytes||Buffer.byteLength(value.key)>P.LIMITS.certificateMaxBytes)P.fail('invalid_request');route='certificateUpload';body={cert:value.cert,key:value.key};}
   else if(operation==='removeCertificate'){route='certificateDelete';body={};}
   else if(operation==='requestRestart'){route='restart';body={};}else P.fail('invalid_request');
   const response=await this.transport.request(route,{...this._options(options),body,credential:this.credential,onAttempt:()=>{attempted=true;options.onAttempt?.();}});
   // Preserve a matched response even if the owning panel closes at this boundary.
   const acknowledged=response?.code===0;return {submission:'submitted',bridgeResponse:'received',outcome:acknowledged?'acknowledged':'unknown',...(acknowledged?{}:{code:'change_unknown'})};
  }catch(error){attempted=typeof error?.submitted==='boolean'?error.submitted:attempted;return {submission:attempted?'unknown':'not_submitted',bridgeResponse:'unavailable',outcome:attempted?'unknown':'rejected',code:attempted?'change_unknown':P.safeCode(error)};}
 }
 async readLogin(options={}){
  const L=require('./qq-remote-login-policy.cjs'),version=await this._read('version',options);
  if(!P.text(version?.version,64)||!version.version)P.fail('invalid_response');
  const firstStatus=L.status(await this._read('qqStatus',options)),firstInfo=L.info(await this._read('qqInfo',options));
  const quickAccounts=L.quickList(await this._read('qqQuickList',options));
  const lastStatus=L.status(await this._read('qqStatus',options)),lastInfo=L.info(await this._read('qqInfo',options));
  return L.observation({version:version.version,firstStatus,firstInfo,lastStatus,lastInfo,quickAccounts},this.expectedQQ);
 }
 async readLoginQRCode(options={}){const data=await this._read('qqQRCode',options);P.keys(data,['qrcode'],[],'invalid_response');return require('./qq-remote-login-policy.cjs').qrURL(data.qrcode);}
 async mutateLogin(operation,options={}){
  let attempted=false;
  try{
   this._authenticated(options);if(!['refreshQR','quickLogin'].includes(operation))P.fail('invalid_request');
   const response=await this.transport.request(operation==='refreshQR'?'qqRefreshQR':'qqQuickLogin',{...this._options(options),body:operation==='refreshQR'?{}:{uin:this.expectedQQ},credential:this.credential,onAttempt:()=>{attempted=true;options.onAttempt?.();}});
   let valid=false,restarting=false;
   if(response?.code===0){
    if(operation==='quickLogin')valid=response.data===null;
    else if(P.plain(response.data)&&Object.keys(response.data).every(k=>['qrcodeurl','restarting'].includes(k))&&typeof response.data.qrcodeurl==='string'&&Buffer.byteLength(response.data.qrcodeurl)<=4096){
     restarting=response.data.restarting===true;
     valid=restarting?response.data.qrcodeurl==='':response.data.restarting===undefined&&response.data.qrcodeurl.length>0;
    }
   }
   return {submission:'attempted',bridgeResponse:'received',outcome:valid?'acknowledged':'unknown',restarting:valid&&restarting,automaticRetry:false,loginVerified:false};
  }catch(error){attempted=typeof error?.submitted==='boolean'?error.submitted:attempted;return {submission:attempted?'attempted':'not_submitted',bridgeResponse:'unavailable',outcome:attempted?'unknown':'not_submitted',restarting:false,automaticRetry:false,loginVerified:false,code:attempted?'change_unknown':P.safeCode(error)};}
 }
 async passkeyOptions(kind,options={}){
  this._check(options);if(!['register','authenticate'].includes(kind))P.fail('invalid_request');if(kind==='register')this._authenticated(options);
  const response=await this.transport.request(kind==='register'?'passkeyRegistrationOptions':'passkeyAuthenticationOptions',{...this._options(options),body:{},...(kind==='register'?{credential:this.credential}:{})});
  this._check(options);if(response?.code!==0)P.fail('request_rejected');return response.data;
 }
 async verifyPasskey(kind,value,options={}){
  let attempted=false;
  try{
   this._check(options);if(!['register','authenticate'].includes(kind))P.fail('invalid_request');if(kind==='register')this._authenticated(options);
   const response=await this.transport.request(kind==='register'?'passkeyRegistrationVerify':'passkeyAuthenticationVerify',{...this._options(options),body:{response:value},...(kind==='register'?{credential:this.credential}:{}),onAttempt:()=>{attempted=true;options.onAttempt?.();}});
   let valid=false;
   if(response?.code===0&&P.plain(response.data)){
    if(kind==='register')valid=Object.keys(response.data).length===1&&response.data.verified===true;
    else valid=Object.keys(response.data).length===1&&typeof response.data.Credential==='string'&&response.data.Credential.length>=1&&response.data.Credential.length<=8192&&/^[A-Za-z0-9+/=_-]+$/.test(response.data.Credential);
   }
   // A late known response remains a fact; only its still-current owner may use the Credential.
   if(valid&&kind==='authenticate')try{this._check(options);this.credential=response.data.Credential;this.authAt=this.now();}catch{}
   return {submission:'attempted',bridgeResponse:'received',outcome:valid?'acknowledged':'unknown',authenticated:valid&&kind==='authenticate',...(valid?{}:{code:'change_unknown'})};
  }catch(error){attempted=typeof error?.submitted==='boolean'?error.submitted:attempted;return {submission:attempted?'attempted':'not_submitted',bridgeResponse:'unavailable',outcome:attempted?'unknown':'not_submitted',authenticated:false,code:attempted?'change_unknown':P.safeCode(error)};}
 }
 _files(options){this._authenticated(options);if(!this.fileTransport)this.fileTransport=this.fileTransportFactory?this.fileTransportFactory(this.fileEndpoint):new (require('./qq-remote-file-transport.cjs').QQRemoteFileTransport)(this.fileEndpoint);if(['json','upload','download','close'].some(k=>typeof this.fileTransport?.[k]!=='function'))P.fail('files_unavailable');return this.fileTransport;}
 async fileIdentity(options={}){const version=await this._read('version',options),identity=await this._identity(options);this._check(options);if(version?.version!==P.VERSION)P.fail('unsupported_version');if(identity.identity!=='matched'||identity.actualQQ!==this.expectedQQ)P.fail('account_unverified');return {version:P.VERSION,...identity};}
 async fileList(remotePath,options={}){const response=await this._files(options).json('fileList',{...this._options(options),credential:this.credential,query:{path:remotePath}});this._check(options);if(response?.code!==0)P.fail('request_rejected');return response.data;}
 async fileRead(remotePath,options={}){const response=await this._files(options).json('fileRead',{...this._options(options),credential:this.credential,query:{path:remotePath}});this._check(options);if(response?.code!==0)P.fail('request_rejected');return response.data;}
 async fileMutate(operation,body,options={}){
  let attempted=false;try{const routes={create:'fileCreate',mkdir:'fileMkdir',write:'fileWrite',rename:'fileRename',move:'fileMove',batchMove:'fileBatchMove',delete:'fileDelete',batchDelete:'fileBatchDelete'},route=routes[operation];if(!route||!P.plain(body)||Buffer.byteLength(JSON.stringify(body))>98304)P.fail('invalid_request');
   const response=await this._files(options).json(route,{...this._options(options),credential:this.credential,body,onAttempt:()=>{attempted=true;options.onAttempt?.();}});const valid=response?.code===0&&response.data===true;
   return {submission:'attempted',bridgeResponse:'received',outcome:valid?'acknowledged':'unknown',...(valid?{}:{code:'change_unknown'})};
  }catch(error){attempted=typeof error?.submitted==='boolean'?error.submitted:attempted;return {submission:attempted?'attempted':'not_submitted',bridgeResponse:'unavailable',outcome:attempted?'unknown':'not_submitted',code:attempted?'change_unknown':P.safeCode(error)};}
 }
 async fileUpload(value,options={}){let attempted=false;try{const response=await this._files(options).upload(value,{...this._options(options),credential:this.credential,onAttempt:()=>{attempted=true;options.onAttempt?.();}});const valid=response?.code===0&&response.data===true;return {submission:'attempted',bridgeResponse:'received',outcome:valid?'acknowledged':'unknown',...(valid?{}:{code:'change_unknown'})};}catch(error){attempted=typeof error?.submitted==='boolean'?error.submitted:attempted;return {submission:attempted?'attempted':'not_submitted',bridgeResponse:'unavailable',outcome:attempted?'unknown':'not_submitted',code:attempted?'change_unknown':P.safeCode(error)};}}
 async fileDownload(value,options={}){return this._files(options).download(value,{...this._options(options),credential:this.credential});}
 close(){this.closed=true;this.abort.abort();this.credential='';this.token='';this.transport.close();this.fileTransport?.close();}
}
module.exports={QQRemoteClient};
