'use strict';

// Independent implementation of QQ's documented official bot protocol.
// Sources and pinned SDK references: docs/QQ_OFFICIAL_PROTOCOL_20261119.md.
// No ordinary QQ login, SDK credential logging, session resume, media download,
// private-chat dispatch or automatic resend is performed here.
const {createHash,randomUUID}=require('node:crypto');
const API_ORIGIN='https://api.bot.qq.com';
const GROUP_INTENT=1<<25;
const MAX_FRAME=256*1024,MAX_HTTP=256*1024,MAX_QUEUE=200,MAX_SEEN=10000,MAX_CONTEXTS=1000;
const REPLY_WINDOW_MS=5*60*1000,MAX_REPLY_ATTEMPTS=5;

class QQOfficialError extends Error{
  constructor(code,platformCode){super(`QQ official bot request failed (${code}).`);this.name=code==='aborted'?'AbortError':'QQOfficialError';this.code=code;if(Number.isSafeInteger(platformCode))this.platformCode=platformCode;}
}
const fail=code=>{throw new QQOfficialError(code);};
function opaqueId(value,max=256){return typeof value==='string'&&value.length>0&&value.length<=max&&/^[\x21-\x7e]+$/.test(value);}
function validateQQOfficialAppId(value){if(typeof value!=='string'||! /^[0-9]{5,32}$/.test(value))fail('invalid_app_id');return value;}
function validateQQOfficialSecret(value){if(typeof value!=='string'||value.length<1||value.length>512||/[\s\p{Cc}\p{Cf}]/u.test(value))fail('invalid_secret');return value;}
function validateQQOfficialGroupIds(value){if(!Array.isArray(value)||value.length>5||value.some(id=>!opaqueId(id)||id==='.'||id==='..')||new Set(value).size!==value.length)fail('invalid_groups');return [...value];}
function validateQQOfficialGateway(value){
  let url;try{url=new URL(value);}catch{fail('invalid_gateway');}
  if(url.protocol!=='wss:'||url.hostname!=='api.bot.qq.com'||url.port||url.username||url.password||url.hash||url.search||!['/websocket','/websocket/'].includes(url.pathname))fail('invalid_gateway');
  return url.href;
}
function positiveCode(value){return Number.isSafeInteger(value)&&value!==0?value:null;}
function hash(value){return createHash('sha256').update(value).digest('hex');}
function boundedMap(map,key,value,max){map.set(key,value);while(map.size>max)map.delete(map.keys().next().value);}

class QQOfficialClient{
  #secret;#token='';#expiresAt=0;#tokenPending=null;
  constructor({appId,secret,groupIds=[],fetchImpl=globalThis.fetch,WebSocketImpl,timeoutMs=15000,pollTimeoutMs=25000,now=Date.now}={}){
    this.appId=validateQQOfficialAppId(appId);this.#secret=validateQQOfficialSecret(secret);this.groupIds=new Set(validateQQOfficialGroupIds(groupIds));
    this.fetch=fetchImpl;this.WebSocket=WebSocketImpl||require('ws');this.timeoutMs=timeoutMs;this.pollTimeoutMs=pollTimeoutMs;this.now=now;
    this.ready=false;this.closed=false;this.accountId=null;this.socket=null;this.generation=0;this.cursor=0;this.queue=[];this.seen=new Map();this.contexts=new Map();this.replyCounters=new Map();this.attempts=new Map();this.controllers=new Set();this.waiter=null;this.pending=null;this.lastError=null;this.heartbeat=null;this.readyFinish=null;this.lifecycle=new AbortController();
    this.capabilities=Object.freeze({text:true,fullGroupEvents:true,receiveAllPermission:'unverified',proactive:false,proactivePermission:'unverified',images:false,voice:false,tools:false,privateChat:false,streaming:false});
  }
  async _http(path,{method='GET',body,auth=true,signal}={}){
    if(this.closed)fail('closed');if(signal?.aborted||this.lifecycle.signal.aborted)fail('aborted');if(this.controllers.size>=20)fail('request_limit');
    const controller=new AbortController();this.controllers.add(controller);let timer;
    const abort=()=>controller.abort(),signals=[signal,this.lifecycle.signal].filter(Boolean);for(const s of signals)s.addEventListener('abort',abort,{once:true});
    const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new QQOfficialError('request_timeout'));},this.timeoutMs);});
    const cancelled=new Promise((_,reject)=>controller.signal.addEventListener('abort',()=>reject(new QQOfficialError(signal?.aborted||this.closed?'aborted':'request_timeout')),{once:true}));
    try{
      const operation=(async()=>{
        const response=await this.fetch(API_ORIGIN+path,{method,redirect:'error',signal:controller.signal,headers:{'Content-Type':'application/json',...(auth?{Authorization:`QQBot ${this.#token}`}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
        if(controller.signal.aborted)fail('aborted');
        if(response.url&&new URL(response.url).origin!==API_ORIGIN)fail('invalid_response_origin');
        const length=Number(response.headers?.get('content-length'));if(length>MAX_HTTP)fail('response_too_large');
        if(!response.body||typeof response.body.getReader!=='function')fail('invalid_response');
        const reader=response.body.getReader(),parts=[];let size=0;
        try{for(;;){const {done,value}=await reader.read();if(done)break;if(controller.signal.aborted)fail('aborted');size+=value.byteLength;if(size>MAX_HTTP)fail('response_too_large');parts.push(Buffer.from(value));}}finally{await reader.cancel().catch(()=>{});}
        let data;try{data=JSON.parse(Buffer.concat(parts).toString('utf8'));}catch{fail('invalid_response');}
        if(!data||typeof data!=='object'||Array.isArray(data))fail('invalid_response');
        for(const field of ['err_code','code'])if(data[field]!==undefined&&!Number.isSafeInteger(data[field]))fail('invalid_response');
        const code=positiveCode(data.err_code)||positiveCode(data.code);
        if(!response.ok||code)throw new QQOfficialError(response.status===429?'rate_limited':response.status===401?'authentication_failed':'platform_rejected',code??undefined);
        if(response.status!==200)fail('delivery_unconfirmed');
        return data;
      })();
      return await Promise.race([operation,timeout,cancelled]);
    }catch(error){if(error instanceof QQOfficialError)throw error;throw new QQOfficialError(signal?.aborted||this.closed?'aborted':'network_unconfirmed');}
    finally{clearTimeout(timer);this.controllers.delete(controller);for(const s of signals)s.removeEventListener('abort',abort);controller.abort();}
  }
  async _accessToken(signal){
    if(this.#token&&this.now()<this.#expiresAt-60000)return;
    if(this.#tokenPending)return this.#tokenPending;
    const operation=(async()=>{const data=await this._http('/app/getAppAccessToken',{method:'POST',body:{appId:this.appId,clientSecret:this.#secret},auth:false,signal});const seconds=Number(data.expires_in);if(!opaqueId(data.access_token,4096)||!Number.isFinite(seconds)||seconds<=0||seconds>86400)fail('invalid_token_response');if(this.closed||signal?.aborted)fail('aborted');this.#token=data.access_token;this.#expiresAt=this.now()+seconds*1000;})();
    this.#tokenPending=operation;try{await operation;}finally{if(this.#tokenPending===operation)this.#tokenPending=null;}
  }
  connect(signal){
    if(this.closed)return Promise.reject(new QQOfficialError('closed'));if(signal?.aborted)return Promise.reject(new QQOfficialError('aborted'));
    if(this.ready)return Promise.resolve({accountId:this.accountId,nickname:'QQ official bot'});if(this.pending)return this.pending;
    const operation=this._connect(signal);this.pending=operation;operation.finally(()=>{if(this.pending===operation)this.pending=null;}).catch(()=>{});return operation;
  }
  async _connect(signal){
    const generation=++this.generation;this.queue.length=0;this.contexts.clear();this.replyCounters.clear();this.lastError=null;this.startedAt=this.now();
    try{
      await this._accessToken(signal);const gateway=await this._http('/gateway',{signal});const url=validateQQOfficialGateway(gateway.url);
      if(this.closed||signal?.aborted||generation!==this.generation)fail('aborted');
      const socket=new this.WebSocket(url,{maxPayload:MAX_FRAME,followRedirects:false,handshakeTimeout:this.timeoutMs});this.socket=socket;
      return await new Promise((resolve,reject)=>{
        let settled=false,hello=false,identified=false;
        const finish=(error)=>{if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);if(this.readyFinish===finish)this.readyFinish=null;error?reject(error):resolve({accountId:this.accountId,nickname:'QQ official bot'});};
        const abort=()=>this._disconnect(new QQOfficialError('aborted'),socket),timer=setTimeout(()=>this._disconnect(new QQOfficialError('handshake_timeout'),socket),this.timeoutMs);this.readyFinish=finish;signal?.addEventListener('abort',abort,{once:true});
        socket.on('error',()=>this._disconnect(new QQOfficialError('connection_failed'),socket));
        socket.on('close',()=>this._disconnect(new QQOfficialError('disconnected'),socket));
        socket.on('message',(raw,isBinary)=>{
          if(this.socket!==socket||this.closed)return;
          try{
            if(isBinary||Buffer.byteLength(raw)>MAX_FRAME)fail('invalid_frame');let frame;try{frame=JSON.parse(String(raw));}catch{fail('invalid_frame');}
            if(!frame||typeof frame!=='object'||!Number.isInteger(frame.op))fail('invalid_frame');
            if(frame.s!==undefined){if(!Number.isSafeInteger(frame.s)||frame.s<0)fail('invalid_sequence');this.sequence=frame.s;}
            if(frame.op===10){
              if(hello)fail('invalid_hello');const interval=frame.d?.heartbeat_interval;if(!Number.isInteger(interval)||interval<1000||interval>120000)fail('invalid_heartbeat');hello=true;identified=true;this.awaitingHeartbeat=false;
              if(!this._write({op:2,d:{token:`QQBot ${this.#token}`,intents:GROUP_INTENT,shard:[0,1],properties:{$os:process.platform,$browser:'Agent Arcade',$device:'Agent Arcade'}}},socket))return;
              this.heartbeat=setInterval(()=>{if(this.socket!==socket)return;if(this.awaitingHeartbeat){this._disconnect(new QQOfficialError('heartbeat_timeout'),socket);return;}this.awaitingHeartbeat=true;this._write({op:1,d:this.sequence??null},socket);},interval);this.heartbeat.unref?.();return;
            }
            if(frame.op===11){this.awaitingHeartbeat=false;return;}
            if(frame.op===1){if(!hello)fail('invalid_frame');this._write({op:1,d:this.sequence??null},socket);return;}
            if(frame.op===7)fail('reconnect_required');if(frame.op===9)fail('authentication_failed');
            if(frame.op!==0)return;
            if(frame.t==='READY'){
              if(!identified||this.ready||!opaqueId(frame.d?.session_id)||!opaqueId(frame.d?.user?.id)||frame.d?.user?.bot!==true)fail('invalid_ready');
              this.accountId=this.appId;this.ready=true;finish();return;
            }
            if(this.ready)this._event(frame);
          }catch(error){this._disconnect(error instanceof QQOfficialError?error:new QQOfficialError('invalid_frame'),socket);}
        });
        if(signal?.aborted)abort();
      });
    }catch(error){if(generation===this.generation)this._disconnect(error instanceof QQOfficialError?error:new QQOfficialError('connection_failed'));throw error instanceof QQOfficialError?error:new QQOfficialError('connection_failed');}
  }
  _write(value,socket=this.socket){try{if(socket!==this.socket||socket?.readyState!==1)fail('disconnected');socket.send(JSON.stringify(value),error=>{if(error)this._disconnect(new QQOfficialError('connection_failed'),socket);});return this.socket===socket;}catch{this._disconnect(new QQOfficialError('connection_failed'),socket);return false;}}
  _disconnect(error,socket=this.socket){
    if(socket&&socket!==this.socket)return;const current=this.socket;this.socket=null;this.ready=false;this.accountId=null;this.lastError=error;this.queue.length=0;this.contexts.clear();this.replyCounters.clear();this.sequence=null;clearInterval(this.heartbeat);this.heartbeat=null;
    for(const controller of this.controllers)controller.abort();this.readyFinish?.(error);this.waiter?.();try{current?.terminate();}catch{}
  }
  _event(frame){
    if(!['GROUP_MESSAGE_CREATE','GROUP_AT_MESSAGE_CREATE'].includes(frame.t))return;
    const data=frame.d;if(!data||!opaqueId(data.group_openid)||!this.groupIds.has(data.group_openid)||!opaqueId(data.author?.member_openid)||!opaqueId(data.id,512)||data.author.bot===true)return;
    if(data.author.bot!==undefined&&typeof data.author.bot!=='boolean')return;
    const timestamp=typeof data.timestamp==='string'?Date.parse(data.timestamp):NaN,now=this.now();
    // A fresh session accepts current events only. Never Resume a missed-event backlog.
    if(!Number.isFinite(timestamp)||timestamp<this.startedAt-1000||timestamp>now+60000||now-timestamp>=REPLY_WINDOW_MS)return;
    const seq=Number.isSafeInteger(data.msg_seq)&&data.msg_seq>=0?data.msg_seq:0,key=hash(JSON.stringify([this.appId,data.group_openid,data.id,seq]));if(this.seen.has(key))return;
    boundedMap(this.seen,key,true,MAX_SEEN);
    if(this.queue.length>=MAX_QUEUE){this._disconnect(new QQOfficialError('queue_overflow'));return;}
    const replyKey=hash(JSON.stringify([this.appId,data.group_openid,data.id])),counter=this.replyCounters.get(replyKey)||{replies:0};boundedMap(this.replyCounters,replyKey,counter,MAX_SEEN);
    const contextToken=randomUUID(),senderId=data.author.member_openid,context={generation:this.generation,groupId:data.group_openid,senderId,rawId:data.id,expiresAt:timestamp+REPLY_WINDOW_MS,counter};boundedMap(this.contexts,contextToken,context,MAX_CONTEXTS);
    const nontext=(data.attachments!==undefined&&(!Array.isArray(data.attachments)||data.attachments.length)||data.ark_data||data.msg_elements!==undefined&&(!Array.isArray(data.msg_elements)||data.msg_elements.length)||data.message_type!==undefined&&data.message_type!==0)||typeof data.content!=='string'||data.content.length>16000||data.content.includes('\0');
    const text=nontext?'':data.content.trim();if(!text&&!nontext)return;
    this.queue.push({id:'qqofficial:'+key,route:'group',accountId:this.appId,groupId:data.group_openid,from:senderId,text,contextToken,...(nontext?{unsupported:'qq_official_nontext'}:{})});this.waiter?.();
  }
  async getUpdates(cursor='',signal){
    if(!(cursor===''||typeof cursor==='string'&&/^\d{1,16}$/.test(cursor)&&Number(cursor)===this.cursor))fail('invalid_cursor');
    await this.connect(signal);
    if(!this.queue.length){if(this.waiter)fail('concurrent_poll');await new Promise(resolve=>{const done=()=>{clearTimeout(timer);signal?.removeEventListener('abort',done);if(this.waiter===done)this.waiter=null;resolve();},timer=setTimeout(done,this.pollTimeoutMs);this.waiter=done;signal?.addEventListener('abort',done,{once:true});if(signal?.aborted||!this.ready)done();});}
    if(signal?.aborted)fail('aborted');if(!this.ready)throw this.lastError||new QQOfficialError('disconnected');
    const messages=this.queue.splice(0,MAX_QUEUE);this.cursor+=messages.length;return {cursor:String(this.cursor),messages};
  }
  async sendGroupText(binding,text,contextToken,clientId=randomUUID(),signal){
    const context=this.contexts.get(contextToken),generation=this.generation;
    const guard=()=>{if(signal?.aborted)fail('aborted');if(!this.ready||this.closed||generation!==this.generation||!context||context.generation!==generation||this.contexts.get(contextToken)!==context||context.groupId!==binding?.groupId||context.senderId!==binding?.senderId||!this.groupIds.has(binding?.groupId)||binding.accountId!==undefined&&binding.accountId!==this.appId)fail('stale_context');if(this.now()>=context.expiresAt)fail('reply_expired');};guard();
    if(typeof text!=='string'||!text.trim()||text.length>16000||text.includes('\0')||!opaqueId(clientId,128))fail('invalid_input');
    const fingerprint=hash(JSON.stringify([contextToken,text])),previous=this.attempts.get(clientId);if(previous){if(previous.fingerprint!==fingerprint)fail('client_id_reused');return previous.promise;}
    const operation=(async()=>{
      await this._accessToken(signal);guard();if(context.counter.replies>=MAX_REPLY_ATTEMPTS)fail('reply_limit');const msgSeq=++context.counter.replies;
      // Reserve before the write. Ambiguous network/HTTP results are never retried.
      const result=await this._http('/v2/groups/'+encodeURIComponent(context.groupId)+'/messages',{method:'POST',body:{msg_type:0,content:text,msg_id:context.rawId,msg_seq:msgSeq},signal});guard();
      if(!opaqueId(result.id,512))fail('invalid_send_receipt');return {id:result.id,clientId};
    })();boundedMap(this.attempts,clientId,{fingerprint,promise:operation},MAX_CONTEXTS);return operation;
  }
  close(){if(this.closed)return;this.closed=true;this.lifecycle.abort();this._disconnect(new QQOfficialError('closed'));this.#secret='';this.#token='';this.#expiresAt=0;this.attempts.clear();}
}
module.exports={QQOfficialClient,QQOfficialError,validateQQOfficialAppId,validateQQOfficialSecret,validateQQOfficialGroupIds,validateQQOfficialGateway};
