'use strict';
// Fixed SSQQ 3.5.2 image endpoints only. No cookies, browser headers or QQ bearer.
const {createHash}=require('node:crypto');
const {imageSource}=require('./qq-image-source.cjs');
const {QQImageDownloader}=require('./qq-image-download.cjs');
const HOSTS=Object.freeze(['q1.qlogo.cn','p.qlogo.cn','gchat.qpic.cn','multimedia.nt.qq.com.cn']);
const MAX_ACTIVE=4,MAX_PENDING=64,QUEUE_MS=15000;
const fail=code=>{throw Object.assign(Error('SSQQ image unavailable.'),{code});};
const qq=v=>typeof v==='string'&&/^[1-9]\d{4,14}$/.test(v);
function mediaSource(value){
 if(typeof value!=='string'||value.length>8192||/[\x00-\x20\x7f\\]/.test(value))fail('image_source_unsupported');
 let u;try{u=new URL(value);}catch{fail('image_source_unsupported');}
 if(u.protocol!=='https:'||u.port||u.username||u.password||u.hash||!HOSTS.includes(u.hostname))fail('image_source_unsupported');
 if(['gchat.qpic.cn','multimedia.nt.qq.com.cn'].includes(u.hostname))return imageSource(value);
 let resource;const keys=[...u.searchParams.keys()];
 if(u.hostname==='q1.qlogo.cn'&&u.pathname==='/g'&&keys.length===3&&new Set(keys).size===3&&keys.every(k=>['b','s','nk'].includes(k))&&u.searchParams.get('b')==='qq'&&u.searchParams.get('s')==='0'&&qq(u.searchParams.get('nk')))resource={kind:'qq-avatar',id:u.searchParams.get('nk')};
 else if(u.hostname==='p.qlogo.cn'&&!u.search){const m=/^\/gh\/([1-9]\d{4,14})\/([1-9]\d{4,14})\/0$/.exec(u.pathname);if(m&&m[1]===m[2])resource={kind:'qq-group-avatar',id:m[1]};}
 if(!resource)fail('image_source_unsupported');return Object.freeze({url:u.href,resource:Object.freeze(resource),resourceDigest:createHash('sha256').update(JSON.stringify(resource)).digest('hex')});
}
class QQSSQQMedia{
 constructor({assertCurrent,createDownloader=({onSocket})=>new QQImageDownloader({sourceParser:mediaSource,onSocket})}={}){
  if(typeof assertCurrent!=='function'||typeof createDownloader!=='function')fail('invalid_request');
  this.assertCurrent=assertCurrent;this.createDownloader=createDownloader;this.closed=false;this.active=new Set();this.queue=[];this.sockets=new Set();
 }
 _trackSocket(socket){const record={socket,promise:null};record.promise=new Promise(resolve=>socket.once('close',()=>{this.sockets.delete(record);resolve();}));this.sockets.add(record);}
 _check(){if(this.closed)fail('closed');const r=this.assertCurrent();if(r?.then){r.catch?.(()=>{});fail('invalid_request');}}
 read(url,{signal}={}){
  this._check();const source=mediaSource(url);if(this.active.size+this.queue.length>=MAX_PENDING)fail('busy');
  const controller=new AbortController();let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});
  const job={source,controller,resolve,reject,promise,downloader:null,timer:null,externalAbort:null,queuedAbort:null};
  job.externalAbort=()=>controller.abort();signal?.addEventListener('abort',job.externalAbort,{once:true});
  job.queuedAbort=()=>{const index=this.queue.indexOf(job);if(index>=0){this.queue.splice(index,1);reject(Object.assign(Error('SSQQ image unavailable.'),{code:'cancelled'}));this._release(job,signal);}};
  controller.signal.addEventListener('abort',job.queuedAbort,{once:true});
  job.timer=setTimeout(()=>controller.abort(),QUEUE_MS);this.queue.push(job);if(signal?.aborted)controller.abort();this._drain();
  return promise.finally(()=>this._release(job,signal));
 }
 _release(job,signal){clearTimeout(job.timer);signal?.removeEventListener('abort',job.externalAbort);job.controller.signal.removeEventListener('abort',job.queuedAbort);}
 _drain(){while(!this.closed&&this.active.size<MAX_ACTIVE&&this.queue.length){const job=this.queue.shift();this.active.add(job);void this._run(job);}}
 async _run(job){let answer;try{
  this._check();if(job.controller.signal.aborted)fail('cancelled');const downloader=job.downloader=this.createDownloader({onSocket:socket=>this._trackSocket(socket)});
  if(typeof downloader?.download!=='function'||typeof downloader?.close!=='function')fail('invalid_request');
  answer=await downloader.download(job.source.url,{expectedResourceDigest:job.source.resourceDigest,signal:job.controller.signal,assertCurrent:()=>this._check()});
  this._check();if(job.controller.signal.aborted)fail('cancelled');
  if(!answer||!Buffer.isBuffer(answer.bytes)||!['.png','.jpg'].includes(answer.extension)||answer.resourceDigest!==job.source.resourceDigest)fail('invalid_response');
  job.resolve({bytes:answer.bytes,mimeType:answer.extension==='.png'?'image/png':'image/jpeg'});answer=null;
 }catch(error){answer?.bytes?.fill(0);job.reject(Object.assign(Error('SSQQ image unavailable.'),{code:error?.code||'image_invalid'}));}
 finally{job.downloader?.close();this.active.delete(job);this._drain();}}
 close(){this.closed=true;const pending=[...this.queue,...this.active];for(const job of pending){job.controller.abort();job.downloader?.close();}return Promise.allSettled(pending.map(j=>j.promise)).then(async()=>{const sockets=[...this.sockets];for(const r of sockets)r.socket.destroy();if(sockets.length){let timer;try{await Promise.race([Promise.all(sockets.map(r=>r.promise)),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Object.assign(Error('SSQQ image close unconfirmed.'),{code:'media_close_failed'})),5000);})]);}finally{clearTimeout(timer);}}return {closed:true};});}
}
module.exports={QQSSQQMedia,mediaSource,HOSTS,MAX_ACTIVE,MAX_PENDING};
