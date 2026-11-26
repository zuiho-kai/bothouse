'use strict';
const http = require('node:http');
const P = require('./qq-qce-policy.cjs');
const MAX_RESPONSE=64*1024, MAX_REQUEST=16*1024;
const ROUTES=Object.freeze({system:['GET','/api/system/info'],config:['GET','/api/config'],setConfig:['PUT','/api/config']});
class QQQCEClient {
 constructor({version='5.5.77',host='127.0.0.1',port=40653,token,request=http.request,timeoutMs=10000}={}) {
  if(host!=='127.0.0.1'||port!==40653||typeof token!=='string'||!/^[A-Za-z0-9]{40}$/.test(token)||typeof request!=='function'||!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>10000)P.fail('invalid_request');
  P.version(version);Object.assign(this,{version,host,port,token,request,timeoutMs});this.closed=false;this.pending=null;
 }
 _call(route,body,{signal,assertCurrent=()=>{},onAttempt=()=>{}}={}) {
  const preflight=code=>{const error=new P.QCEError(code);error.submitted=false;throw error;};
  if(this.closed)preflight('closed');if(this.pending)preflight('operation_in_progress');if(signal?.aborted)preflight('cancelled');
  const raw=body===undefined?null:Buffer.from(JSON.stringify(body));if(raw&&raw.length>MAX_REQUEST)P.fail('invalid_request');
  const [method,url]=ROUTES[route];let submitted=false, received=false, req, res, done=false, timer, abort;
  const check=()=>{if(this.closed)P.fail('closed');if(signal?.aborted)P.fail('cancelled');const r=assertCurrent();if(r?.then){r.catch?.(()=>{});P.fail('invalid_request');}};
  const promise=new Promise((resolve,reject)=>{
   const finish=(error,value)=>{if(done)return;done=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);if(error){req?.destroy();res?.destroy();const safe=new P.QCEError(P.safeCode(error));safe.submitted=submitted;safe.bridgeResponse=received?'received':'unavailable';reject(safe);}else resolve(value);};
   abort=()=>finish(new P.QCEError('cancelled'));
   this.pending={cancel:abort};
   try {
    check(); req=this.request({hostname:this.host,port:this.port,path:url,method,agent:false,maxHeaderSize:16384,headers:{Authorization:`Bearer ${this.token}`,Accept:'application/json',...(raw?{'Content-Type':'application/json','Content-Length':raw.length}:{})}},response=>{
     res=response;let length=0;const chunks=[];
     response.on('error',()=>finish(new P.QCEError('connection_failed')));
     response.on('aborted',()=>finish(new P.QCEError('connection_failed')));
     if(response.statusCode>=300&&response.statusCode<400){finish(new P.QCEError('redirect_rejected'));return;}
     if(!/^application\/json(?:\s*;|$)/i.test(response.headers['content-type']||'')||response.headers['content-encoding']&&!/^identity$/i.test(response.headers['content-encoding'])){finish(new P.QCEError('invalid_response'));return;}
     response.on('data',chunk=>{length+=chunk.length;if(length>MAX_RESPONSE){finish(new P.QCEError('response_too_large'));return;}chunks.push(chunk);});
     response.on('end',()=>{
      if(done)return;
      try {
       const bytes=Buffer.concat(chunks),string=new TextDecoder('utf-8',{fatal:true}).decode(bytes),data=JSON.parse(string);
       if(!P.plain(data)||typeof data.success!=='boolean'||!P.text(data.timestamp,64)||!Number.isFinite(Date.parse(data.timestamp))||!P.text(data.requestId,128))P.fail('invalid_response');
       received=true;
       if(response.statusCode===401||response.statusCode===403)P.fail('unauthorized');
       if(data.success!==true||response.statusCode!==200)P.fail('action_failed');
       if(!P.plain(data.data))P.fail('invalid_response');
       finish(null,data.data);
      }catch(error){finish(error instanceof P.QCEError?error:new P.QCEError('invalid_response'));}
     });
    });
    req.on('error',()=>finish(new P.QCEError('connection_failed')));
    timer=setTimeout(()=>finish(new P.QCEError('timeout')),this.timeoutMs);
    signal?.addEventListener('abort',abort,{once:true});
    check();onAttempt();check();submitted=true;req.end(raw||undefined);
   }catch(error){finish(error);}
  });
  return promise.finally(()=>{this.pending=null;});
 }
 system(options){return this._call('system',undefined,options);}
 config(options){return this._call('config',undefined,options).then(P.config);}
 async setConfig(field,value,options={}) {
  if(!P.FIELDS.includes(field))P.fail('invalid_request');P.directory(value);
  let responded=false;
  try{const data=await this._call('setConfig',{[field]:value},options);responded=true;P.config(data);return {submission:'submitted',bridgeResponse:'received',outcome:'accepted'};}
  catch(error){const submitted=error?.submitted;if(submitted===false)return {submission:'not_submitted',bridgeResponse:'unavailable',outcome:'not_submitted',code:P.safeCode(error)};return {submission:responded||submitted===true?'submitted':'unknown',bridgeResponse:responded||error?.bridgeResponse==='received'?'received':'unavailable',outcome:'unknown',code:'change_unknown'};}
 }
 close(){this.closed=true;this.token='';this.pending?.cancel();return {closed:true};}
}
module.exports={QQQCEClient,MAX_RESPONSE,MAX_REQUEST};
