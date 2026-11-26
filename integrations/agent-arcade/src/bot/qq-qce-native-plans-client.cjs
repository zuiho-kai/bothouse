'use strict';
const http=require('node:http');
const P=require('./qq-qce-native-plans-policy.cjs');
class QQQCENativePlansClient{
 constructor({version='5.5.77',host='127.0.0.1',port=40653,token,request=http.request,timeoutMs=10000,triggerTimeoutMs=300000}={}){if(host!=='127.0.0.1'||port!==40653||typeof token!=='string'||!/^[A-Za-z0-9]{40}$/.test(token)||typeof request!=='function'||!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>10000||!Number.isInteger(triggerTimeoutMs)||triggerTimeoutMs<1||triggerTimeoutMs>300000)P.fail('invalid_request');P.version(version);Object.assign(this,{version,host,port,token,request,timeoutMs,triggerTimeoutMs});this.closed=false;this.pending=null;}
 _call(method,path,body,{signal,assertCurrent=()=>{},onAttempt=()=>{}}={},long=false){
  const early=code=>{const e=new P.QCENativePlansError(code);e.submitted=false;throw e;};if(this.closed)early('closed');if(this.pending)early('operation_in_progress');if(signal?.aborted)early('cancelled');const bytes=body===undefined?null:Buffer.from(JSON.stringify(body));if(bytes&&bytes.length>32768)early('invalid_request');
  let req,res,done=false,timer,abort,submitted=false,received=false;const check=()=>{if(this.closed)P.fail('closed');if(signal?.aborted)P.fail('cancelled');const r=assertCurrent();if(r?.then){r.catch?.(()=>{});P.fail('invalid_request');}};
  const promise=new Promise((resolve,reject)=>{const finish=(error,value)=>{if(done)return;done=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);if(error){req?.destroy();res?.destroy();const e=new P.QCENativePlansError(P.safeCode(error));e.submitted=submitted;e.bridgeResponse=received?'received':'unavailable';reject(e);}else resolve(value);};abort=()=>finish(new P.QCENativePlansError('cancelled'));this.pending={cancel:abort};
   try{check();req=this.request({hostname:this.host,port:this.port,path,method,agent:false,maxHeaderSize:16384,headers:{Authorization:`Bearer ${this.token}`,Accept:'application/json',...(bytes?{'Content-Type':'application/json','Content-Length':bytes.length}:{})}},response=>{res=response;let size=0;const chunks=[];response.on('error',()=>finish(new P.QCENativePlansError('connection_failed')));response.on('aborted',()=>finish(new P.QCENativePlansError('connection_failed')));
    if(response.statusCode>=300&&response.statusCode<400){finish(new P.QCENativePlansError('redirect_rejected'));return;}if(!/^application\/json(?:\s*;|$)/i.test(response.headers['content-type']||'')||response.headers['content-encoding']&&!/^identity$/i.test(response.headers['content-encoding'])){finish(new P.QCENativePlansError('invalid_response'));return;}
    response.on('data',c=>{size+=c.length;if(size>2097152){finish(new P.QCENativePlansError('response_too_large'));return;}chunks.push(c);});response.on('end',()=>{if(done)return;try{const e=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));if(!P.plain(e)||typeof e.success!=='boolean'||!P.iso(e.timestamp)||!P.text(e.requestId,128))P.fail('invalid_response');received=true;if([401,403].includes(response.statusCode))P.fail('unauthorized');if(e.success!==true||response.statusCode!==200)P.fail(e.error?.context?.code==='SCHEDULED_EXPORT_NOT_FOUND'?'native_plan_unavailable':'action_failed');if(!P.plain(e.data))P.fail('invalid_response');finish(null,e.data);}catch(e){finish(e instanceof P.QCENativePlansError?e:new P.QCENativePlansError('invalid_response'));}});
   });req.on('error',()=>finish(new P.QCENativePlansError('connection_failed')));timer=setTimeout(()=>finish(new P.QCENativePlansError('timeout')),long?this.triggerTimeoutMs:this.timeoutMs);signal?.addEventListener('abort',abort,{once:true});check();onAttempt();check();submitted=true;req.end(bytes||undefined);}catch(e){finish(e);}
  });return promise.finally(()=>{this.pending=null;});
 }
 system(o){return this._call('GET','/api/system/info',undefined,o);}
 config(o){return this._call('GET','/api/config',undefined,o).then(P.config);}
 list(o){return this._call('GET','/api/scheduled-exports',undefined,o).then(P.list);}
 plan(id,o){if(!P.nativeId(id))P.fail('invalid_request');return this._call('GET',`/api/scheduled-exports/${encodeURIComponent(id)}`,undefined,o).then(P.record);}
 targets(kind,page,o){if(!['friend','group'].includes(kind)||!P.integer(page,100)||page<1)P.fail('invalid_request');return this._call('GET',`/api/${kind==='friend'?'friends':'groups'}?page=${page}&limit=100`,undefined,o);}
 history(id,limit,o){if(!P.nativeId(id)||!P.integer(limit,100)||limit<1)P.fail('invalid_request');return this._call('GET',`/api/scheduled-exports/${encodeURIComponent(id)}/history?limit=${limit}`,undefined,o);}
 async mutate(command,o){
  const {action,nativePlanId,body}=command;let method,path,long=false;
  if(action==='create'){method='POST';path='/api/scheduled-exports';}
  else if(action==='triggerAll'){method='POST';path='/api/scheduled-exports/trigger-all';}
  else{if(!P.nativeId(nativePlanId))P.fail('invalid_request');path=`/api/scheduled-exports/${encodeURIComponent(nativePlanId)}`;if(['update','enable','disable'].includes(action))method='PUT';else if(action==='remove')method='DELETE';else if(action==='run'){method='POST';path+='/trigger';long=true;}else P.fail('invalid_request');}
  let received=false;try{const data=await this._call(method,path,body===null?undefined:body,o,long);received=true;const checked=P.ack(action,data,command,this.version);return {submission:'submitted',bridgeResponse:'received',outcome:'accepted',...checked};}catch(e){if(e?.submitted===false)return {submission:'not_submitted',bridgeResponse:'unavailable',outcome:'not_submitted',code:P.safeCode(e)};return {submission:received||e?.submitted===true?'submitted':'unknown',bridgeResponse:received||e?.bridgeResponse==='received'?'received':'unavailable',outcome:'unknown',code:'change_unknown'};}
 }
 close(){this.closed=true;this.token='';this.pending?.cancel();return {closed:true};}
}
module.exports={QQQCENativePlansClient};
