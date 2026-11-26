'use strict';
// Only owner/friend record events; no HTTP, arbitrary path reads or sends.
const {randomUUID}=require('node:crypto');
const {TextDecoder}=require('node:util');
// Deferred lookup lets QQClient normalize a record with this module without
// capturing incomplete exports in a CommonJS cycle.
const validateQQUrl=value=>require('./qq.cjs').validateQQUrl(value);
const validateQQOwner=value=>require('./qq.cjs').validateQQOwner(value);
const {canonicalWav}=require('./qq-voice-payload.cjs');
const MAX_SOURCE_BYTES=1024*1024,MAX_WAV_BYTES=3*1024*1024,MAX_FRAME=4*1024*1024+4096;
const CODES=new Set(['unsupported','wrong_scope','invalid_config','invalid_response','response_too_large','source_too_large','duration_limit','voice_format','cancelled','timeout','disconnected','account_changed','account_offline','status_unverified','action_failed','message_changed','busy','duplicate','asr_unavailable','asr_failed','asr_exit_unconfirmed','asr_cleanup_unconfirmed','transcript_empty','transcript_invalid','journal_unavailable','source_unavailable']);
class InboundVoiceError extends Error{constructor(code){const fixed=CODES.has(code)?code:'invalid_response';super(`Owner voice was not transcribed (${fixed}).`);this.code=fixed;this.name=fixed==='cancelled'?'AbortError':'InboundVoiceError';}}
const failure=code=>new InboundVoiceError(code);
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const signalLike=value=>value==null||(typeof value.aborted==='boolean'&&typeof value.addEventListener==='function'&&typeof value.removeEventListener==='function');
function qq(value){try{return validateQQOwner(value);}catch{throw failure('invalid_response');}}
function messageId(value){if(Number.isSafeInteger(value))return String(value);if(typeof value==='string'&&/^-?\d{1,20}$/.test(value))return value;throw failure('invalid_response');}
function size(value){const n=typeof value==='string'&&/^[1-9]\d{0,7}$/.test(value)?Number(value):value;if(!Number.isInteger(n)||n<1)throw failure('invalid_response');if(n>MAX_SOURCE_BYTES)throw failure('source_too_large');return n;}
function recordSegment(message){
  // Deliberately no mixed text/forwarded/reply segments in the first closure.
  if(!Array.isArray(message)||message.length!==1||message[0]?.type!=='record'||!object(message[0].data))throw failure('unsupported');
  const data=message[0].data;
  // NapCat's record file is a bridge cache key (often a file name), not always
  // a UUID. Exclude every URL/absolute path/traversal form before get_record.
  if(typeof data.file!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(data.file)||data.file.includes('..')||
    (data.magic!==undefined&&![0,'0',false].includes(data.magic)))throw failure('unsupported');
  return {file:data.file,sourceBytes:size(data.file_size)};
}
function captureOwnerVoice(frame,{accountId,ownerId,companion,acceptAfter=0,now=Date.now()}={}){
  if(companion!==true||qq(accountId)===qq(ownerId))throw failure('wrong_scope');
  if(!object(frame)||frame.post_type!=='message'||frame.message_type!=='private'||frame.sub_type!=='friend'||
    String(frame.self_id)!==accountId||String(frame.user_id)!==ownerId||frame.group_id!==undefined)throw failure('wrong_scope');
  const id=messageId(frame.message_id),createdAt=frame.time*1000;
  if(!Number.isSafeInteger(frame.time)||!Number.isSafeInteger(createdAt)||createdAt<acceptAfter||createdAt>now+60000)throw failure('invalid_response');
  return Object.freeze({kind:'qq-owner-voice',accountId,ownerId,id,createdAt,...recordSegment(frame.message)});
}
function verifyMessage(data,voice){
  if(!object(data)||messageId(data.message_id)!==voice.id||data.message_type!=='private'||data.group_id!==undefined||
    String(data.user_id)!==voice.ownerId||String(data.sender?.user_id)!==voice.ownerId||data.time*1000!==voice.createdAt)throw failure('message_changed');
  const observed=recordSegment(data.message);
  if(observed.file!==voice.file||observed.sourceBytes!==voice.sourceBytes)throw failure('message_changed');
}
function decodeRecord(data,voice){
  if(!object(data)||size(data.file_size)!==voice.sourceBytes||typeof data.base64!=='string'||
    data.base64.length>Math.ceil(MAX_WAV_BYTES/3)*4)throw failure('response_too_large');
  const encoded=data.base64;
  if(encoded.length%4||!encoded.length||!/^[A-Za-z0-9+/]*={0,2}$/.test(encoded))throw failure('invalid_response');
  const raw=Buffer.from(encoded,'base64');let normalized;
  try{
    if(raw.toString('base64')!==encoded||raw.length>MAX_WAV_BYTES)throw failure('invalid_response');
    normalized=canonicalWav(raw);
    return {pcm:Buffer.from(normalized.bytes.subarray(44)),sampleRate:normalized.sampleRate,durationSeconds:normalized.durationSeconds};
  }catch(error){if(error instanceof InboundVoiceError)throw error;throw failure(error.code==='voice_duration'?'duration_limit':'voice_format');}
  finally{raw.fill(0);normalized?.bytes.fill(0);}
}
class OwnerRecordReader{
  constructor({WebSocket,timeoutMs=20000}={}){if(!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>30000)throw failure('invalid_config');this.WebSocket=WebSocket;this.timeoutMs=timeoutMs;}
  async read(voice,{url,token,signal}={}){
    let endpoint;
    try{if(typeof url!=='string')throw Error();endpoint=validateQQUrl(url);if(!signalLike(signal)||typeof token!=='string'||!/^[\x21-\x7e]{16,256}$/.test(token)||!object(voice)||voice.kind!=='qq-owner-voice')throw Error();
      captureOwnerVoice({post_type:'message',message_type:'private',sub_type:'friend',self_id:voice.accountId,user_id:voice.ownerId,message_id:voice.id,time:voice.createdAt/1000,message:[{type:'record',data:{file:voice.file,file_size:voice.sourceBytes}}]}, {...voice,companion:true});
    }catch{throw failure('invalid_config');}
    if(signal?.aborted)throw failure('cancelled');
    const WebSocket=this.WebSocket||require('ws');
    return new Promise((resolve,reject)=>{
      let socket,pending=null,settled=false,started=false,frames=0,total=0,audio=null;
      const finish=(error,value)=>{
        if(settled){if(error)audio?.pcm?.fill(0);value?.pcm?.fill(0);return;}settled=true;clearTimeout(timer);signal?.removeEventListener('abort',cancel);
        const p=pending;pending=null;p?.reject(error||failure('cancelled'));
        if(error)audio?.pcm.fill(0);
        if(socket){socket.removeAllListeners('message');socket.removeAllListeners('open');socket.removeAllListeners('close');socket.removeAllListeners('error');socket.on('error',()=>{});try{socket.terminate();}catch{}}
        error?reject(error):resolve(value);
      };
      const cancel=()=>finish(failure('cancelled')),timer=setTimeout(()=>finish(failure('timeout')),this.timeoutMs);
      const request=(action,params={})=>new Promise((yes,no)=>{
        if(settled||signal?.aborted)return no(failure('cancelled'));
        const echo=randomUUID();pending={echo,resolve:yes,reject:no};
        try{socket.send(JSON.stringify({action,params,echo}),error=>{if(error)finish(failure('disconnected'));});}catch{finish(failure('disconnected'));}
      });
      const verify=async()=>{
        const identity=await request('get_login_info');if(!object(identity)||qq(identity.user_id)!==voice.accountId)throw failure('account_changed');
        const status=await request('get_status');if(!object(status)||typeof status.online!=='boolean'||(status.good!==undefined&&typeof status.good!=='boolean'))throw failure('status_unverified');
        if(!status.online||status.good===false)throw failure('account_offline');
      };
      signal?.addEventListener('abort',cancel,{once:true});if(signal?.aborted){cancel();return;}
      try{
        socket=new WebSocket(endpoint,{headers:{Authorization:`Bearer ${token}`},followRedirects:false,perMessageDeflate:false,maxPayload:MAX_FRAME,handshakeTimeout:this.timeoutMs});
        socket.on('error',error=>finish(failure(error?.code==='WS_ERR_UNSUPPORTED_MESSAGE_LENGTH'?'response_too_large':'disconnected')));
        socket.on('unexpected-response',(_req,res)=>{try{res.destroy();}catch{}finish(failure('disconnected'));});
        socket.once('close',()=>finish(failure('disconnected')));
        socket.on('message',(raw,binary)=>{
          if(settled)return;
          try{
            if(binary||!Buffer.isBuffer(raw))throw failure('invalid_response');
            if(++frames>128||raw.length>MAX_FRAME||(total+=raw.length)>MAX_FRAME*2)throw failure('response_too_large');
            const row=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));if(!object(row))throw failure('invalid_response');
            if(Object.hasOwn(row,'post_type')){if(row.self_id!==undefined&&String(row.self_id)!==voice.accountId)throw failure('account_changed');return;}
            if(!pending||row.echo!==pending.echo)return;
            if(row.status!=='ok'||row.retcode!==0)throw failure('action_failed');
            const p=pending;pending=null;p.resolve(row.data);
          }catch(error){finish(error instanceof InboundVoiceError?error:failure('invalid_response'));}
        });
        socket.once('open',()=>{
          if(started||settled)return;started=true;
          (async()=>{
            await verify();verifyMessage(await request('get_msg',{message_id:voice.id}),voice);
            // Only a validated key observed in the current owner's exact event.
            audio=decodeRecord(await request('get_record',{file:voice.file,out_format:'wav'}),voice);
            await verify();if(signal?.aborted)throw failure('cancelled');finish(null,audio);
          })().catch(error=>finish(error instanceof InboundVoiceError?error:failure('invalid_response')));
        });
      }catch{finish(failure('disconnected'));}
    });
  }
}
function bindingEqual(a,b){return b?.companion===true&&a.clientGeneration===b.client?.generation&&a.socket===b.client?.socket&&['accountId','ownerId','scopeId','generation','client','dispatcher','url','token'].every(k=>a[k]===b[k]);}
class ScopedVoicePipeline{
  // claim/disposition are the existing durable journal adapter, not an in-memory
  // substitute. No retry follows an uncertain/failed claimed message.
  constructor({getBinding,reader,createAsr,acquireLease,claim,disposition,keepWarm=false}={},policy){
    if([getBinding,createAsr,acquireLease,claim,disposition].some(f=>typeof f!=='function')||typeof reader?.read!=='function')throw failure('invalid_config');
    if(typeof keepWarm!=='boolean')throw failure('invalid_config');
    Object.assign(this,{getBinding,reader,createAsr,acquireLease,claim,disposition,keepWarm,policy});this.operation=null;this.closed=false;this.idleCleanup=null;
  }
  get busy(){return this.operation!==null;}
  _assertLease(op){
    if(!op.lease||op.released||op.parked)return;
    let result;try{result=op.lease.assertCurrent();}catch{throw failure('wrong_scope');}
    if(result?.then){result.catch?.(()=>{});throw failure('invalid_config');}
    if(result===false)throw failure('wrong_scope');
  }
  _cleanup(op){
    if(op.cleaned)return Promise.resolve();if(op.cleaning)return op.cleaning;
    const work=(async()=>{
      // A successful park transfers ownership to the gate and an exact-lease
      // idle cleanup handle. It never pretends the resident worker exited.
      if(op.parked){op.cleaned=true;return;}
      // cancel is scoped even for a dedicated instance: a future factory cannot
      // accidentally turn a stale close into another account's cancellation.
      if(op.asr){try{if(this.keepWarm&&!op.started)await op.asr.close();else await op.asr.cancel({jobId:op.jobId});}catch{throw failure('asr_exit_unconfirmed');}}
      if(op.lease&&!op.released){try{await op.lease.release();op.released=true;}catch{throw failure('asr_cleanup_unconfirmed');}}
      op.cleaned=true;
    })();
    op.cleaning=work.finally(()=>{op.cleaning=null;});return op.cleaning;
  }
  async _park(op,current){
    if(!this.keepWarm)return;
    if(typeof op.asr?.finish!=='function'||typeof op.asr?.close!=='function'||typeof op.lease?.park!=='function'||typeof op.lease?.closeIdle!=='function'||typeof op.lease.reuseKey!=='string')throw failure('asr_unavailable');
    const result=await op.asr.finish({jobId:op.jobId,keepWarm:true});current();
    if(result?.parked!==true||op.asr.busy!==false||op.asr.closed!==false)throw failure('asr_failed');
    const resource=op.asr,lease=op.lease;
    lease.park({reuseKey:lease.reuseKey,resource,closeIdle:()=>resource.close()});
    op.parked=true;
    // Capture only the old lease; no message, PCM or transcript is retained by
    // the service's idle handle. A later job makes this handle harmless.
    this.idleCleanup=Object.freeze({close:()=>lease.closeIdle()});
  }
  async closeIdle(){const cleanup=this.idleCleanup;if(!cleanup)return;try{await cleanup.close();}catch{throw failure('asr_exit_unconfirmed');}if(this.idleCleanup===cleanup)this.idleCleanup=null;}
  _retainRecovery(op){
    if(op.cleaned||op.released||typeof op.lease?.retainRecovery!=='function')return;
    try{
      // Keep the exact failed job reachable even if its service is removed.
      // Never install recovery for an active job or cancel a later operation.
      op.lease.retainRecovery(()=>this.operation===op&&!op.cleaned?this.close():undefined);
    }catch{/* Preserve the original uncertainty; do not release the lease. */}
  }
  async process(frame,{signal,acceptAfter=0}={}){
    if(!signalLike(signal))throw failure('invalid_config');
    if(this.closed||signal?.aborted)throw failure('cancelled');if(this.operation)throw failure('busy');
    const currentBinding=this.getBinding(),b={...currentBinding,clientGeneration:currentBinding?.client?.generation,socket:currentBinding?.client?.socket};
    if(!b.scopeId||!Number.isSafeInteger(b.generation)||!Number.isSafeInteger(b.clientGeneration)||!b.socket||!b.dispatcher)throw failure('wrong_scope');
    let resolveSettled;const voice=this.policy.capture(frame,b,acceptAfter),op={jobId:randomUUID(),controller:new AbortController(),settled:new Promise(resolve=>{resolveSettled=resolve;}),lease:null,asr:null,cleaned:false};this.operation=op;
    const cancel=()=>op.controller.abort();signal?.addEventListener('abort',cancel,{once:true});let audio,claimed=false,result,error;
    const current=()=>{if(this.closed||op.controller.signal.aborted)throw failure('cancelled');if(!this.policy.matches(b,this.getBinding()))throw failure('account_changed');this._assertLease(op);};
    try{
      current();try{claimed=await this.claim(b.scopeId,voice.id);if(typeof claimed!=='boolean')throw Error();}catch{throw failure('journal_unavailable');}if(!claimed)return {outcome:'duplicate'};current();
      audio=await this.policy.read(this.reader,voice,b,op.controller.signal,current);current();
      // The app supplies one shared ASR gate, also used by microphone capture.
      // It receives no audio, secret, filename or message text.
      op.lease=await this.acquireLease(Object.freeze({scopeId:b.scopeId,accountId:b.accountId,...this.policy.speaker(b),generation:b.generation,clientGeneration:b.clientGeneration,client:b.client,socket:b.socket,dispatcher:b.dispatcher,jobId:op.jobId,signal:op.controller.signal}));
      // A resumed resource belongs to this lease before the awaited acquisition
      // returns. Capture it before any scope check can fail and require cleanup.
      op.asr=op.lease?.resource||null;
      if(!op.lease||typeof op.lease.assertCurrent!=='function'||typeof op.lease.release!=='function')throw failure('invalid_config');current();
      op.asr ||= this.createAsr(Object.freeze({scopeId:b.scopeId,jobId:op.jobId}));
      if(!op.asr||typeof op.asr.transcribe!=='function'||typeof op.asr.cancel!=='function')throw failure('asr_unavailable');current();
      if(this.keepWarm){if(typeof op.lease.attachResource!=='function')throw failure('invalid_config');if(!op.lease.resource)op.lease.attachResource(op.asr);}
      op.started=true;const text=await op.asr.transcribe(audio,{jobId:op.jobId,signal:op.controller.signal,locale:'zh-CN'});current();
      if(typeof text!=='string'||text.length>2000||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\ud800-\udfff]/u.test(text))throw failure('transcript_invalid');
      if(!text.trim())throw failure('transcript_empty');
      // Existing journal state: still received, not forwarded or completed.
      // The integrating service assigns queued/taskId only after enqueue.
      try{await this.disposition(b.scopeId,voice.id,'received');}catch{throw failure('journal_unavailable');}current();
      // Service integration MUST use a companion-only receiveVoice path
      // which bypasses command parsing, publication, memory mutation and tools.
      result={outcome:'transcribed',id:voice.id,text,source:this.policy.source,allowCommands:false,target:this.policy.target,durationSeconds:audio.durationSeconds};
      await this._park(op,current);
    }catch(cause){error=cause instanceof InboundVoiceError?cause:failure(cause?.code);if(op.parked)try{await this.closeIdle();}catch(cleanupError){error=cleanupError;}if(claimed)try{await this.disposition(b.scopeId,voice.id,'rejected');}catch{error=failure('journal_unavailable');}}
    finally{
      audio?.pcm?.fill(0);
      try{await this._cleanup(op);}catch(cause){error=cause;this._retainRecovery(op);}
      signal?.removeEventListener('abort',cancel);
      if(op.cleaned&&this.operation===op)this.operation=null;resolveSettled();
    }
    if(error)throw error;
    try{current();}catch(cause){await this.closeIdle();throw cause;}
    return result;
  }
  async close(){
    this.closed=true;const op=this.operation;if(!op){await this.closeIdle();return;}
    op.controller.abort();
    // Let pending acquisition/creation/reader complete their cancellation path
    // before retrying a previously uncertain close/release.
    await op.settled;await this._cleanup(op);if(this.operation===op)this.operation=null;await this.closeIdle();
  }
}
const ownerVoicePolicy=Object.freeze({
  capture(frame,b,acceptAfter){
    const captured=frame?.kind==='qq-owner-voice'?{post_type:'message',message_type:'private',sub_type:'friend',self_id:frame.accountId,user_id:frame.ownerId,message_id:frame.id,time:frame.createdAt/1000,message:[{type:'record',data:{file:frame.file,file_size:frame.sourceBytes}}]}:frame;
    return captureOwnerVoice(captured,{...b,acceptAfter});
  },
  matches:bindingEqual,
  read:(reader,voice,b,signal)=>reader.read(voice,{url:b.url,token:b.token,signal}),
  speaker:b=>({ownerId:b.ownerId}),
  source:'qq-owner-voice',target:'companion-chat-only',
});
class OwnerVoicePipeline extends ScopedVoicePipeline{
  constructor(options){super(options,ownerVoicePolicy);}
}
module.exports={InboundVoiceError,captureOwnerVoice,recordSegment,decodeRecord,OwnerRecordReader,OwnerVoicePipeline,ScopedVoicePipeline,MAX_FRAME};
