'use strict';
// QQ-only, explicit rendering. One active job or one clean 30-second idle host;
// never selects a recipient, plays audio, downloads models, or retains text.
const {canonicalWav}=require('../bot/qq-voice-payload.cjs');
const {IDLE_MS}=require('./asr-gate.cjs');
const CODES=new Set(['voice_render_unavailable','voice_render_busy','voice_render_limit','voice_render_timeout','voice_render_failed','voice_render_exit_unconfirmed','cancelled','changed','disconnected']);
const failure=code=>Object.assign(Error('Local QQ voice rendering did not complete.'),{code:CODES.has(code)?code:'voice_render_failed'});
const wipe=value=>{if(Buffer.isBuffer(value))value.fill(0);};
const SCOPE=['accountId','panelId','service','generation','scopeId','client','socket','clientGeneration','qqAccountId','ownerId','role'];
function validText(text){return typeof text==='string'&&!!text.trim()&&text.length<=240&&[...text].length<=120&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\ud800-\udfff]/u.test(text);}
function safeError(error){
 if(CODES.has(error?.code))return failure(error.code);
 if(error?.code==='voice_exit_timeout')return failure('voice_render_exit_unconfirmed');
 if(error?.code==='voice_timeout')return failure('voice_render_timeout');
 if(['voice_limit','voice_too_large','voice_duration'].includes(error?.code))return failure('voice_render_limit');
 if(['voice_assets','voice_render_unavailable'].includes(error?.code))return failure('voice_render_unavailable');
 if(error?.name==='AbortError'||error?.code==='voice_interrupted')return failure('cancelled');return failure('voice_render_failed');
}
function captured(value){
 if(!value||['accountId','panelId','scopeId','qqAccountId','ownerId','role'].some(k=>typeof value[k]!=='string'||!value[k]||value[k].length>512)||['service','client','socket'].some(k=>!value[k]||typeof value[k]!=='object')||!Number.isSafeInteger(value.generation)||!Number.isSafeInteger(value.clientGeneration))throw failure('voice_render_unavailable');
 return Object.freeze(Object.fromEntries(SCOPE.map(k=>[k,value[k]])));
}
class QQVoiceRenderer{
 constructor({createSpeech,captureRuntime,now=()=>performance.now(),schedule=setTimeout,unschedule=clearTimeout}={}){
  if(typeof createSpeech!=='function'||captureRuntime!==undefined&&typeof captureRuntime!=='function'||[now,schedule,unschedule].some(f=>typeof f!=='function'))throw failure('voice_render_unavailable');Object.assign(this,{createSpeech,captureRuntime,now,schedule,unschedule});this.operation=null;this.idle=null;
 }
 get busy(){return !!(this.operation||this.idle?.closing||this.idle?.closeError);}
 _revision(){const value=this.captureRuntime();if(typeof value!=='string'||!/^[a-f0-9]{64}$/.test(value))throw failure('voice_render_unavailable');return value;}
 _check(op){if(this.operation!==op||op.controller.signal.aborted)throw failure('cancelled');if(op.scope){const value=op.assertCurrent();if(value?.then){value.catch?.(()=>{});throw failure('voice_render_unavailable');}if(this._revision()!==op.revision)throw failure('voice_render_unavailable');}}
 progress(){
  const op=this.operation;if(!op)return {stage:this.idle?.closeError?'stop_unconfirmed':this.idle?.closing?'stopping':'idle'};
  if(op.entry?.closeError)return {stage:'stop_unconfirmed'};if(op.controller.signal.aborted)return {stage:'stopping'};
  if(op.stage==='preparing'&&typeof op.entry?.speech?.diagnostics==='function')try{const events=op.entry.speech.diagnostics()?.events;if(Array.isArray(events)&&events.length<=200&&events.some(r=>r?.event==='render-start'&&!op.eventIds.has(r.id)))op.stage='generating';}catch{}
  return {stage:op.stage};
 }
 render(text,{signal,scope,assertCurrent}={}){
  if(!validText(text))return Promise.reject(failure('voice_render_limit'));if(this.operation||this.idle?.closeError)return Promise.reject(failure('voice_render_busy'));if(signal?.aborted)return Promise.reject(failure('cancelled'));
  let binding=null,revision=null;try{if(this.captureRuntime){binding=captured(scope);if(typeof assertCurrent!=='function')throw failure('voice_render_unavailable');revision=this._revision();}}catch(error){return Promise.reject(safeError(error));}
  const controller=new AbortController();let rejectAbort;const aborted=new Promise((_,reject)=>{rejectAbort=reject;});
  const op={controller,aborted,entry:null,stage:'preparing',scope:binding,revision,assertCurrent,eventIds:new Set()};this.operation=op;
  const cancel=()=>controller.abort();signal?.addEventListener('abort',cancel,{once:true});controller.signal.addEventListener('abort',()=>rejectAbort(failure('cancelled')),{once:true});aborted.catch(()=>{});
  op.promise=Promise.resolve().then(()=>this._run(op,text)).finally(()=>signal?.removeEventListener('abort',cancel));return op.promise;
 }
 _clear(entry){if(entry?.timer!==null){this.unschedule(entry.timer);entry.timer=null;}}
 async _acquire(op){
  this._check(op);const old=this.idle;
  if(old){this._clear(old);op.entry=old;const reuse=op.scope&&!old.closed&&!old.closing&&!old.closeError&&old.deadline>this.now()&&old.revision===op.revision&&SCOPE.every(k=>old.scope[k]===op.scope[k]);
   if(!reuse){await this._close(old);this._check(op);}if(this.idle===old)this.idle=null;if(!reuse)op.entry=null;
  }
  if(!op.entry){const speech=this.createSpeech();op.entry={speech,closed:false,closing:null,closeError:null,timer:null,deadline:null};if(!speech||typeof speech.render!=='function'||typeof speech.close!=='function')throw failure('voice_render_unavailable');}
  this._check(op);try{op.eventIds=new Set((op.entry.speech.diagnostics?.()?.events||[]).filter(r=>r.event==='render-start').map(r=>r.id));}catch{}return op.entry;
 }
 async _run(op,text){
  let source,wav,error,cleaned=false;
  try{
   const entry=await this._acquire(op);this._check(op);
   const generated=Promise.resolve(entry.speech.render(text,{locale:'zh-CN',voice:'Serena',signal:op.controller.signal,...(op.scope?{clean:true}:{})})).then(value=>{if(op.controller.signal.aborted||this.operation!==op||entry.closed){wipe(value?.wav);throw failure('cancelled');}return value;});
   const result=await Promise.race([generated,op.aborted]);source=result?.wav;this._check(op);op.stage='finalizing';if(!Buffer.isBuffer(source))throw failure('voice_render_failed');
   const prepared=canonicalWav(source);wav=prepared.bytes;if(prepared.sampleRate!==32000||prepared.channels!==1||prepared.bits!==16||!wav.subarray(44).some(v=>v!==0))throw failure('voice_render_failed');cleaned=result.cleaned===true;
   if(op.scope&&!cleaned)throw failure('voice_render_failed');
  }catch(cause){error=safeError(cause);}finally{wipe(source);}
  if(!error&&op.scope&&cleaned){try{this._check(op);const entry=op.entry;entry.scope=op.scope;entry.revision=op.revision;entry.assertCurrent=op.assertCurrent;entry.deadline=this.now()+IDLE_MS;this.idle=entry;this.operation=null;
    const idleGeneration=entry.idleGeneration=(entry.idleGeneration||0)+1;
    entry.timer=this.schedule(()=>{if(this.idle===entry&&entry.idleGeneration===idleGeneration){void this._close(entry).then(()=>{if(this.idle===entry)this.idle=null;}).catch(()=>{});}},IDLE_MS);entry.timer?.unref?.();return wav;
   }catch(cause){error=safeError(cause);}}
  try{await this._close(op.entry);}catch{error=failure('voice_render_exit_unconfirmed');}
  if((!op.entry||op.entry.closed)&&this.operation===op)this.operation=null;if(op.entry?.closed&&this.idle===op.entry)this.idle=null;
  if(error||op.controller.signal.aborted){wipe(wav);throw error||failure('cancelled');}return wav;
 }
 _close(entry,{retry=false}={}){
  if(!entry||entry.closed)return Promise.resolve();this._clear(entry);if(entry.closing)return entry.closing;if(entry.closeError&&!retry)return Promise.reject(entry.closeError);
  if(!entry.speech){entry.closed=true;return Promise.resolve();}
  const closing=Promise.resolve().then(()=>entry.speech.close()).then(()=>{entry.closed=true;entry.closeError=null;entry.scope=null;entry.assertCurrent=null;}).catch(()=>{entry.closeError=failure('voice_render_exit_unconfirmed');throw entry.closeError;}).finally(()=>{if(entry.closing===closing)entry.closing=null;});entry.closing=closing;return closing;
 }
 observe(){const entry=this.idle;if(!entry||entry.closing||entry.closeError)return;try{const value=entry.assertCurrent();if(value?.then){value.catch?.(()=>{});throw failure('voice_render_unavailable');}if(this._revision()!==entry.revision||this.now()>=entry.deadline)throw failure('voice_render_unavailable');}catch{void this._close(entry).then(()=>{if(this.idle===entry)this.idle=null;}).catch(()=>{});}}
 async cancel(){const op=this.operation,entry=op?.entry||this.idle;op?.controller.abort();await this._close(entry,{retry:!!entry?.closeError});if(this.operation===op)this.operation=null;if(this.idle===entry)this.idle=null;return {cancelled:true};}
}
module.exports={QQVoiceRenderer};
