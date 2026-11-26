'use strict';
const http=require('node:http');
const P=require('./qq-qce-security-policy.cjs');
const MAX_RESPONSE=64*1024,MAX_REQUEST=16*1024;
const ROUTES=Object.freeze({system:['GET','/api/system/info'],whitelist:['GET','/api/security/ip-whitelist'],status:['GET','/security-status'],authenticate:['POST','/auth'],addRule:['POST','/api/security/ip-whitelist'],removeRule:['DELETE','/api/security/ip-whitelist'],setDisabled:['PUT','/api/security/ip-whitelist/toggle'],setDisplayHost:['POST','/api/server/host']});
class QQQCESecurityClient{
 constructor({version='5.5.77',host='127.0.0.1',port=40653,token,request=http.request,timeoutMs=10000}={}){
  if(host!=='127.0.0.1'||port!==40653||typeof token!=='string'||!/^[A-Za-z0-9]{40}$/.test(token)||typeof request!=='function'||!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>10000)P.fail('invalid_request');P.version(version);Object.assign(this,{version,host,port,token,request,timeoutMs});this.closed=false;this.pending=null;
 }
 _call(route,body,{signal,assertCurrent=()=>{},onAttempt=()=>{}}={}){
  const noSend=code=>{const error=new P.QCESecurityError(code);error.submitted=false;throw error;};
  if(this.closed)noSend('closed');if(this.pending)noSend('operation_in_progress');if(signal?.aborted)noSend('cancelled');if(!Object.hasOwn(ROUTES,route)||route==='authenticate'&&this.version!=='6.4.2')noSend('invalid_request');
  const raw=body===undefined?null:Buffer.from(JSON.stringify(body));if(raw&&raw.length>MAX_REQUEST)noSend('invalid_request');const [method,path]=ROUTES[route];let submitted=false,received=false,req,res,done=false,timer,abort;
  const check=()=>{if(this.closed)P.fail('closed');if(signal?.aborted)P.fail('cancelled');const r=assertCurrent();if(r?.then){r.catch?.(()=>{});P.fail('invalid_request');}};
  const promise=new Promise((resolve,reject)=>{
   const finish=(error,value)=>{if(done)return;done=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);if(error){req?.destroy();res?.destroy();const safe=new P.QCESecurityError(P.safeCode(error));safe.submitted=submitted;safe.bridgeResponse=received?'received':'unavailable';reject(safe);}else resolve(value);};
   abort=()=>finish(new P.QCESecurityError('cancelled'));this.pending={cancel:abort};
   try{
    check();req=this.request({hostname:this.host,port:this.port,path,method,agent:false,maxHeaderSize:16384,headers:{Authorization:`Bearer ${this.token}`,Accept:'application/json',...(raw?{'Content-Type':'application/json','Content-Length':raw.length}:{})}},response=>{
     res=response;let length=0;const chunks=[];response.on('error',()=>finish(new P.QCESecurityError('connection_failed')));response.on('aborted',()=>finish(new P.QCESecurityError('connection_failed')));
     if(response.statusCode>=300&&response.statusCode<400){finish(new P.QCESecurityError('redirect_rejected'));return;}
     if(!/^application\/json(?:\s*;|$)/i.test(response.headers['content-type']||'')||response.headers['content-encoding']&&!/^identity$/i.test(response.headers['content-encoding'])){finish(new P.QCESecurityError('invalid_response'));return;}
     response.on('data',chunk=>{length+=chunk.length;if(length>MAX_RESPONSE){finish(new P.QCESecurityError('response_too_large'));return;}chunks.push(chunk);});
     response.on('end',()=>{if(done)return;try{
      const data=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));
      if(!P.plain(data)||typeof data.success!=='boolean'||!P.text(data.timestamp,64)||!Number.isFinite(Date.parse(data.timestamp))||!P.text(data.requestId,128))P.fail('invalid_response');received=true;
      if(response.statusCode===401||response.statusCode===403){const code=data.error?.context?.code;P.fail(code==='IP_NOT_ALLOWED'?'ip_not_allowed':code==='TOKEN_EXPIRED'?'token_expired':'unauthorized');}
      if(data.success!==true||response.statusCode!==200)P.fail('action_failed');if(!P.plain(data.data))P.fail('invalid_response');finish(null,data.data);
     }catch(error){finish(error instanceof P.QCESecurityError?error:new P.QCESecurityError('invalid_response'));}});
    });
    req.on('error',()=>finish(new P.QCESecurityError('connection_failed')));timer=setTimeout(()=>finish(new P.QCESecurityError('timeout')),this.timeoutMs);signal?.addEventListener('abort',abort,{once:true});check();onAttempt();check();submitted=true;req.end(raw||undefined);
   }catch(error){finish(error);}
  });return promise.finally(()=>{this.pending=null;});
 }
 system(options){return this._call('system',undefined,options);}
 whitelist(options){return this._call('whitelist',undefined,options).then(value=>P.whitelist(value,this.version));}
 status(options){return this._call('status',undefined,options).then(value=>P.status(value,this.version));}
 authenticate(options){return this._call('authenticate',{token:this.token},options).then(P.authentication);}
 async mutate(command,options={}){
  P.exact(command,['action','value']);let body;
  if(command.action==='addRule'){body={ip:P.rule(command.value)};}
  else if(command.action==='removeRule'){if(typeof command.value!=='string'||command.value.length===0||command.value.length>P.LIMITS.maxRuleLength)P.fail('invalid_request');body={ip:command.value};}
  else if(command.action==='setDisabled'){if(typeof command.value!=='boolean')P.fail('invalid_request');body={disabled:command.value};}
  else if(command.action==='setDisplayHost'){body={host:P.host(command.value,this.version)};}
  else P.fail('invalid_request');
  let responded=false;
  try{const data=await this._call(command.action,body,options);responded=true;P.acknowledged(command,data);return {submission:'submitted',bridgeResponse:'received',outcome:'accepted'};}
  catch(error){if(error?.submitted===false)return {submission:'not_submitted',bridgeResponse:'unavailable',outcome:'not_submitted',code:P.safeCode(error)};return {submission:responded||error?.submitted===true?'submitted':'unknown',bridgeResponse:responded||error?.bridgeResponse==='received'?'received':'unavailable',outcome:'unknown',code:'change_unknown'};}
 }
 close(){this.closed=true;this.token='';this.pending?.cancel();return {closed:true};}
}
module.exports={QQQCESecurityClient,MAX_RESPONSE,MAX_REQUEST};
