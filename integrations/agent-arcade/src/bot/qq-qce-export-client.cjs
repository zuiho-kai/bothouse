'use strict';
const http=require('node:http'),path=require('node:path');
const P=require('./qq-qce-export-policy.cjs');
const MIME=Object.freeze({'.json':'application/json','.txt':'text/plain','.html':'text/html','.xlsx':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','.zip':'application/zip'});
class QQQCEExportClient{
 constructor({version='5.5.77',host='127.0.0.1',port=40653,token,request=http.request,timeoutMs=10000,downloadTimeoutMs=120000}={}){if(host!=='127.0.0.1'||port!==40653||typeof token!=='string'||!/^[A-Za-z0-9]{40}$/.test(token)||typeof request!=='function'||!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>10000||!Number.isSafeInteger(downloadTimeoutMs)||downloadTimeoutMs<1||downloadTimeoutMs>120000)P.fail('invalid_request');P.version(version);Object.assign(this,{version,host,port,token,request,timeoutMs,downloadTimeoutMs});this.closed=false;this.pending=null;}
 _call(method,url,body,{signal,assertCurrent=()=>{},onAttempt=()=>{},sink=null,archive=false,mime=null}={}){
  const early=code=>{const e=new P.QCEExportError(code);e.submitted=false;throw e;};if(this.closed)early('closed');if(this.pending)early('operation_in_progress');if(signal?.aborted)early('cancelled');
  const raw=body===undefined?null:Buffer.from(JSON.stringify(body));if(raw&&raw.length>16384)early('invalid_request');
  let req,res,timer,abort,done=false,submitted=false,received=false,consuming=false,deferredError=null;
  const check=()=>{if(deferredError)throw deferredError;if(this.closed)P.fail('closed');if(signal?.aborted)P.fail('cancelled');const r=assertCurrent();if(r?.then){r.catch?.(()=>{});P.fail('invalid_request');}};
  const promise=new Promise((resolve,reject)=>{
   const finish=(error,value)=>{if(done)return;if(error&&sink&&consuming){if(!deferredError){deferredError=error;clearTimeout(timer);req?.destroy();res?.destroy();}return;}done=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);if(error){req?.destroy();res?.destroy();const e=new P.QCEExportError(P.safeCode(error));e.submitted=submitted;e.bridgeResponse=received?'received':'unavailable';for(const k of ['saved','bytes','sha256','retainedCopy'])if(Object.hasOwn(error,k))e[k]=error[k];reject(e);}else resolve(value);};
   abort=()=>finish(new P.QCEExportError('cancelled'));this.pending={cancel:abort};
   try{check();req=this.request({hostname:this.host,port:this.port,path:url,method,agent:false,maxHeaderSize:16384,headers:{Authorization:`Bearer ${this.token}`,Accept:mime||'application/json',...(raw?{'Content-Type':'application/json','Content-Length':raw.length}:{})}},response=>{
    res=response;response.on('error',()=>finish(new P.QCEExportError('connection_failed')));response.on('aborted',()=>finish(new P.QCEExportError('connection_failed')));
    consuming=!!sink;(async()=>{try{
     if(response.statusCode>=300&&response.statusCode<400)P.fail('redirect_rejected');if([401,403].includes(response.statusCode))P.fail('unauthorized');
     const type=(response.headers['content-type']||'').split(';')[0].trim().toLowerCase();if(response.headers['content-encoding']&&!/^identity$/i.test(response.headers['content-encoding']))P.fail('invalid_response');
     if(sink){if(response.statusCode!==200)P.fail('action_failed');if(type!==mime)P.fail('invalid_response');const count=response.headers['content-length'];if(typeof count!=='string'||!/^\d+$/.test(count)||!P.integer(Number(count),P.LIMITS.maxDownloadBytes))P.fail('file_transfer_too_large');let bytes=0;received=true;
      for await(const chunk of response){if(done)return;check();bytes+=chunk.length;if(bytes>Number(count)||bytes>P.LIMITS.maxDownloadBytes)P.fail('file_transfer_too_large');await sink.write(chunk,{signal,assertCurrent:check});}
      if(done)return;check();if(bytes!==Number(count))P.fail('invalid_response');const result=await sink.finish({archive,signal,assertCurrent:check});consuming=false;finish(result?.saved===true?null:deferredError,result);return;
     }
     if(type!=='application/json')P.fail('invalid_response');let size=0;const chunks=[];for await(const chunk of response){if(done)return;size+=chunk.length;if(size>2*1024*1024)P.fail('response_too_large');chunks.push(chunk);}
     if(done)return;const envelope=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));if(!P.plain(envelope)||typeof envelope.success!=='boolean'||!P.iso(envelope.timestamp)||!P.text(envelope.requestId,128))P.fail('invalid_response');received=true;
     if(envelope.success!==true||response.statusCode!==200)P.fail('action_failed');if(!P.plain(envelope.data))P.fail('invalid_response');finish(null,envelope.data);
    }catch(e){consuming=false;finish(Object.hasOwn(e,'saved')?e:deferredError||e);}})();
   });req.on('error',()=>finish(new P.QCEExportError('connection_failed')));timer=setTimeout(()=>finish(new P.QCEExportError('timeout')),sink?this.downloadTimeoutMs:this.timeoutMs);signal?.addEventListener('abort',abort,{once:true});check();onAttempt();check();submitted=true;req.end(raw||undefined);
   }catch(e){finish(e);}
  });return promise.finally(()=>{this.pending=null;});
 }
 system(o){return this._call('GET','/api/system/info',undefined,o);}
 config(o){return this._call('GET','/api/config',undefined,o).then(P.config);}
 targets(kind,page,o){if(!['friends','groups'].includes(kind)||!Number.isInteger(page)||page<1||page>100)P.fail('invalid_request');return this._call('GET',`/api/${kind}?page=${page}&limit=100`,undefined,o);}
 createTask(body,o){return this._call('POST','/api/messages/export',body,o);}
 task(id,o){if(!P.taskId(id))P.fail('invalid_request');return this._call('GET',`/api/tasks/${id}`,undefined,o);}
 cancelTask(id,o){if(!P.taskId(id))P.fail('invalid_request');return this._call('POST',`/api/tasks/${id}/cancel`,{},o);}
 download(file,{sink,archive=false,...o}={}){P.directory(path.win32.dirname(file));P.fileName(path.win32.basename(file));const mime=MIME[path.win32.extname(file).toLowerCase()];if(!mime||!sink||typeof sink.write!=='function'||typeof sink.finish!=='function'||archive!==(mime==='application/zip'))P.fail('invalid_request');return this._call('GET',`/api/download-file?path=${encodeURIComponent(file)}`,undefined,{...o,sink,archive,mime});}
 close(){this.closed=true;this.token='';this.pending?.cancel();return {closed:true};}
}
module.exports={QQQCEExportClient,MIME};
