'use strict';
const {canonicalAudibleWav}=require('./qq-voice-payload.cjs');
const {SPOKEN_REPLY_CHARS,needsWrittenReply}=require('./companion-reply-preference.cjs');
const wantsSpeech=text=>/(?:用|发|来|回|给我)(?:一[条段])?语音|语音(?:说|回|答)|\b(?:voice reply|voice message|read it aloud)\b/iu.test(text);
const {randomUUID}=require('node:crypto');
const {validateImagePayload}=require('./qq-media.cjs');
const MAX_PREVIEW=512*1024,PREVIEW_EDGE=480;
const CODES=new Set(['unavailable','changed','busy','invalid_text','invalid_request','duplicate','prepare_failed','reply_failed','cancelled','unsupported','credentials_missing','credentials_locked','credentials_busy','storage_unavailable','stopping','start_failed','stop_failed','image_too_large','invalid_image','image_read_failed','image_unsupported','stale_attachment','scope_limit']);
const fail=code=>Object.assign(Error(`Desktop conversation unavailable (${CODES.has(code)?code:'reply_failed'}).`),{code:CODES.has(code)?code:'reply_failed'});
const id=value=>typeof value==='string'&&/^[\w-]{1,100}$/.test(value);
const fields=['accountId','service','dispatcher','scope','character','settings','generation','client','clientGeneration','socket','owner','self','kind','imageSupported','voiceRole'];
const same=(a,b)=>!!a&&!!b&&fields.every(key=>a[key]===b[key]);
const valid=(value,keys)=>value&&Object.prototype.toString.call(value)==='[object Object]'&&Object.keys(value).every(key=>keys.includes(key));

// Why an App reply failed, as one of six classes. The runners in this folder end a failed
// turn with {outcome,text} where text is one of their own fixed English sentences; that
// sentence is matched here and never leaves the main process. Provider text, status
// bodies and keys are not part of it.
//   auth     the provider rejected the key, or the key may not use the model
//   quota    rate limit or insufficient balance
//   network  the request did not get an HTTP answer, or the service answered with an unlisted status
//   refused  the provider declined to answer
//   limit    the runner ended the turn with outcome 'limit' (token, size, step or time limit)
//   other    everything else, including sentences this table does not know
const path=require('node:path');
const FAILURES=new Set(['auth','quota','network','refused','limit','other']);
const FAILURE_SENTENCES=[
  ['auth',/ rejected the API key\.$/],
  ['auth',/ access was denied\. Check the key, model access and supported region\.$/],
  ['auth',/^This OpenAI account is not allowed to use this model\.$/],
  ['auth',/ model is unavailable (?:for this|to the) account\.$/],
  ['quota',/ account credit is insufficient\.$/],
  ['quota',/ rate limit reached\. Try again later\.$/],
  ['quota',/ rate or credit limit reached\. Check the provider console before trying again\.$/],
  ['quota',/^OpenAI quota or rate limit reached\. Check billing and retry later\.$/],
  ['network',/^Could not reach Anthropic\. Check your connection\.$/],
  ['network',/ could not complete this request\. Check its service and your connection\.$/],
  // The fetch-based runners reach this sentence only when the request threw before any HTTP status was read.
  ['network',/^(?:DeepSeek|OpenAI|Gemini|Doubao) could not finish\. Check the API key, /],
  ['refused',/^Claude declined to answer this message\.$/],
  ['refused',/^Doubao declined this request\. /],
  ['refused',/^Gemini blocked this request\. /],
  ['refused',/^OpenAI returned both a refusal and tool calls\. /],
];
function classifyFailure(result){
  if(!result||typeof result!=='object')return 'other';
  if(result.outcome==='limit')return 'limit';
  const text=typeof result.text==='string'?result.text.slice(0,400):'';
  for(const [failure,sentence] of FAILURE_SENTENCES)if(sentence.test(text))return failure;
  return 'other';
}
// The App conversation's runner is created by the profile's service with
// {conversationOnly:true, configDir:<profile root>/local-companion/agent}. Only that runner
// is observed; every other runner the service creates is returned untouched.
const lastFailure=new Map(),observedServices=new WeakSet();
const profileKey=root=>typeof root==='string'&&root?path.resolve(root).toLowerCase():'';
const localProfile=options=>{
  const dir=options?.conversationOnly===true&&typeof options.configDir==='string'?path.resolve(options.configDir):'';
  return dir&&path.basename(dir)==='agent'&&path.basename(path.dirname(dir))==='local-companion'?profileKey(path.dirname(path.dirname(dir))):'';
};
function observeLocalRunner(factory){
  return function observedRunnerFactory(options,...rest){
    const execute=factory.call(this,options,...rest),key=localProfile(options);
    if(!key||typeof execute!=='function')return execute;
    return new Proxy(execute,{apply(target,self,args){
      const run=Reflect.apply(target,self,args);
      Promise.resolve(run).then(result=>{if(result?.outcome==='reply_ended')lastFailure.delete(key);else if(result?.outcome!=='cancelled')lastFailure.set(key,classifyFailure(result));},()=>{lastFailure.set(key,'other');});
      return run;
    }});
  };
}
const RUNNER_FACTORIES=['runnerFactory','claudeProgramRunnerFactory','deepseekRunnerFactory','gptRunnerFactory','geminiRunnerFactory','doubaoRunnerFactory'];
function observeLocalRunners(service){
  if(!service||typeof service!=='object'||observedServices.has(service))return;
  observedServices.add(service);
  for(const name of RUNNER_FACTORIES)if(typeof service[name]==='function')service[name]=observeLocalRunner(service[name]);
}
const failureOf=service=>lastFailure.get(profileKey(service?.root))||'other';

// Owns a foreground local text turn, never a messaging destination or provider.
class DesktopChat {
  #image=null;
  #reply=null;
  // A confirmed failure or missing outcome belongs to the observed
  // conversation, including when its renderer replaces the input panel.
  turnIssue=null;
  constructor({getContext,isSelecting=()=>false,prepare=async()=>{},onChange=()=>{},chooseImage=null,onReply=()=>{},renderReplyAudio=null}={}){
    if(typeof getContext!=='function'||typeof isSelecting!=='function'||typeof prepare!=='function'||typeof onChange!=='function'||typeof onReply!=='function'||chooseImage!==null&&typeof chooseImage!=='function')throw fail('invalid_request');
    this.isSelecting=isSelecting;this.selecting=false;
    Object.assign(this,{getContext,prepare,onChange,chooseImage,onReply,renderReplyAudio});this.context=null;this.contextId=null;this.session=null;
  }
  observe(){
    let next;try{next=this.getContext();}catch{next=null;}
    const selecting=this.isSelecting();
    // Even a failed switch back to this same room must invalidate any context
    // ID seen while admission was closed.
    if(!same(this.context,next)||this.selecting!==selecting){
      this.closeCurrent();this.turnIssue=null;this.context=next;this.contextId=next?randomUUID():null;
      this.selecting=selecting;
    }
    return this.context;
  }
  _imageSupported(context=this.context){return context?.kind==='local'&&context.imageSupported===true&&typeof this.chooseImage==='function';}
  snapshot(){this.observe();return {available:!!this.context,contextId:this.contextId,imageSupported:this._imageSupported(),selecting:this.selecting};}
  open(value){
    this.observe();
    if(!valid(value,['accountId','contextId','panelId'])||!id(value.panelId))throw fail('invalid_request');
    if(this.selecting)throw fail('busy');
    if(!this.context)throw fail('unavailable');
    if(value.accountId!==this.context.accountId||value.contextId!==this.contextId)throw fail('changed');
    const interrupted=this.closeCurrent();const s={id:randomUUID(),panelId:value.panelId,context:this.context,contextId:this.contextId,seen:new Set(),active:null};this.session=s;
    if(interrupted)this.onChange();
    return {sessionId:s.id,contextId:s.contextId};
  }
  _session(value){
    this.observe();const s=this.session;
    if(this.selecting)throw fail('busy');
    if(!s||value?.sessionId!==s.id||value?.contextId!==s.contextId||!same(s.context,this.context))throw fail('changed');
    return s;
  }
  _dropImage(session){if(this.#image?.session===session){this.#image.bytes.fill(0);this.#image=null;}}
  get currentReply(){return this.#reply?.event??null;}
  claimReplyNotice(event){
    this.observe();const receipt=this.#reply,context=receipt?.session?receipt.session.context:receipt?.context;
    if(!receipt||receipt.claimed||receipt.event!==event||this.session!==receipt.session||!same(context,this.context)||receipt.session?.active&&receipt.session.active!==receipt.operation)return false;
    receipt.claimed=true;return true;
  }
  // A companion-initiated message (owner-enabled source notice) was stored in
  // the current local conversation. Mints the same content-free receipt as a
  // finished turn so the existing reply notice applies; never during a turn.
  localNotice(service){
    this.observe();const context=this.context,s=this.session;
    if(!context||context.kind!=='local'||!service||context.service!==service||s?.active)return false;
    const event=Object.freeze({id:randomUUID(),accountId:context.accountId,character:context.character,sourceKind:'local',contextId:this.contextId,completedAt:Date.now()});
    this.#reply={event,session:s,context,operation:null};
    try{const notified=this.onReply(event);notified?.catch?.(()=>{});}catch{/* Notification failure cannot change a stored message. */}
    return true;
  }
  async selectImage(value){
    if(!valid(value,['sessionId','contextId']))throw fail('invalid_request');
    const s=this._session(value);if(!this._imageSupported(s.context))throw fail('image_unsupported');
    if(s.active||s.picking)throw fail('busy');
    const controller=new AbortController();s.picking=controller;this.onChange();let selected;
    const check=()=>{if(controller.signal.aborted)throw fail('cancelled');if(this._session(value)!==s)throw fail('changed');};
    try{
      selected=await this.chooseImage({signal:controller.signal});check();
      if(selected===null)return {cancelled:true};
      if(!selected||!Buffer.isBuffer(selected.bytes))throw fail('invalid_image');
      let dimensions;
      try{dimensions=validateImagePayload(selected.bytes);}catch(error){throw fail(error?.code==='image_too_large'?'image_too_large':'invalid_image');}
      if(selected.width!==dimensions.width||selected.height!==dimensions.height||typeof selected.preview!=='string'||selected.preview.length>Math.ceil(MAX_PREVIEW/3)*4+22||!/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(selected.preview))throw fail('invalid_image');
      const preview=Buffer.from(selected.preview.slice(22),'base64');
      try{const size=validateImagePayload(preview);if(preview.length>MAX_PREVIEW||size.width>PREVIEW_EDGE||size.height>PREVIEW_EDGE)throw fail('invalid_image');}catch{throw fail('invalid_image');}finally{preview.fill(0);}
      check();this._dropImage(s);
      const attachmentId=randomUUID();this.#image={session:s,id:attachmentId,bytes:selected.bytes};
      const result={attachmentId,preview:selected.preview,width:selected.width,height:selected.height,bytes:selected.bytes.length};selected=null;return result;
    }catch(error){throw fail(error?.code);}
    finally{if(Buffer.isBuffer(selected?.bytes))selected.bytes.fill(0);if(s.picking===controller)s.picking=null;controller.abort();this.onChange();}
  }
  removeImage(value){
    if(!valid(value,['sessionId','contextId','attachmentId'])||!id(value.attachmentId))throw fail('invalid_request');
    const s=this._session(value);if(s.active||s.picking)throw fail('busy');
    if(this.#image?.session!==s||this.#image.id!==value.attachmentId)throw fail('stale_attachment');
    this._dropImage(s);return {removed:true};
  }
  async send(value){
    if(!valid(value,['sessionId','contextId','requestId','text','attachmentId'])||!id(value.requestId)||Object.hasOwn(value,'attachmentId')&&!id(value.attachmentId))throw fail('invalid_request');
    const s=this._session(value);
    if(typeof value.text!=='string'||!value.text.trim()||value.text.length>2000||/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value.text))throw fail('invalid_text');
    if(s.active||s.picking)throw fail('busy');if(s.seen.has(value.requestId)||s.seen.size>=1000)throw fail('duplicate');
    let image;
    if(value.attachmentId){
      if(!this._imageSupported(s.context))throw fail('image_unsupported');
      if(this.#image?.session!==s||this.#image.id!==value.attachmentId)throw fail('stale_attachment');
      image=this.#image;this.#image=null;
    }
    const op={requestId:value.requestId,controller:new AbortController(),started:false};this.#reply=null;this.turnIssue=null;s.active=op;s.seen.add(value.requestId);this.onChange();
    const release=()=>{image?.bytes.fill(0);};op.controller.signal.addEventListener('abort',release,{once:true});
    const check=()=>{
      if(op.controller.signal.aborted)throw fail('cancelled');
      if(this._session(value)!==s)throw fail('changed');
    };
    let issue='failed';
    try{
      check();
      try{await this.prepare(s.context,op.controller.signal);}catch{check();throw fail('prepare_failed');}
      check();op.started=true;
      if(s.context.kind==='local')lastFailure.delete(profileKey(s.context.service?.root));
      const result=await (s.context.kind==='local'?s.context.service.localReply(value.text,{signal:op.controller.signal,...(image?{image:{mimeType:'image/png',bytes:image.bytes}}:{})}):s.context.service.socialReply(value.text,{signal:op.controller.signal}));
      check();
      if(result?.outcome==='cancelled')return {outcome:'cancelled',started:true};
      if(result?.outcome!=='reply_ended'){
        // Only an explicit negative result establishes failure. A lost or
        // unrecognised terminal receipt leaves this request's outcome unknown.
        if(!['error','failed','limit'].includes(result?.outcome))issue='unknown';
        throw Object.assign(fail('reply_failed'),s.context.kind==='local'?{failure:failureOf(s.context.service)}:{});
      }
      let audio;
      if(s.context.kind==='local'){
        audio=await this._replyAudio(s.context,value.text,result.text,op.controller.signal,check);
        check();
        // Only a successful current main-owned turn can mint this receipt. No
        // request text, model output, renderer nonce or pixels enter the event.
        const event=Object.freeze({id:randomUUID(),accountId:s.context.accountId,character:s.context.character,sourceKind:'local',contextId:s.contextId,completedAt:Date.now()});
        this.#reply={event,session:s,operation:op};
        try{const notified=this.onReply(event);notified?.catch?.(()=>{});}catch{/* Notification failure cannot change an already completed reply. */}
      }
      return {outcome:'reply_ended',started:true,...(audio&&{audio})};
    }catch(error){
      if(op.controller.signal.aborted||error?.code==='cancelled'||error?.code==='changed')return {outcome:'cancelled',started:op.started};
      this.turnIssue=issue;
      const failed=fail(error?.code==='unsupported_model'?'image_unsupported':error?.code==='too_large'?'image_too_large':error?.code);
      if(failed.code==='reply_failed'&&FAILURES.has(error?.failure))failed.failure=error.failure;
      throw failed;
    }finally{
      if(s.active===op)s.active=null;op.controller.abort();release();image=null;this.onChange();
    }
  }
  async _replyAudio(context,input,reply,signal,check){
    if(!this.renderReplyAudio||typeof reply!=='string'||!reply.trim())return;
    const spoken=reply.trim().replace(/\s+/gu,' ');
    const length=[...spoken].length;
    if(length>SPOKEN_REPLY_CHARS||(length<=120&&!wantsSpeech(input))||needsWrittenReply(input,spoken))return;
    let raw,canonical;
    try{
      const latest=()=>context.dispatcher.store?.history(context.scope,1).at(-1);
      const row=latest();
      if(row?.role!=='assistant'||row.text!==reply||typeof row.id!=='string')return;
      raw=await this.renderReplyAudio(context,spoken,{signal,assertCurrent:check});
      check();
      const current=latest();
      if(!Buffer.isBuffer(raw)||current?.id!==row.id||current.text!==row.text)return;
      const wav=canonicalAudibleWav(raw);canonical=wav.bytes;
      return {messageId:row.id,text:row.text,durationSeconds:wav.durationSeconds,
        dataUrl:'data:audio/wav;base64,'+canonical.toString('base64')};
    }catch{return undefined;}
    finally{if(Buffer.isBuffer(raw))raw.fill(0);canonical?.fill(0);}
  }
  cancel(value){
    if(!valid(value,['sessionId','contextId','requestId']))throw fail('invalid_request');
    const s=this.session;
    // An old Stop is harmless to a new panel or a later QQ/local turn.
    if(s?.id!==value.sessionId||s.contextId!==value.contextId||s.active?.requestId!==value.requestId)return {cancelled:false};
    if(!s.active.controller.signal.aborted){s.active.controller.abort();this.onChange();}
    return {cancelled:true};
  }
  close(value){
    if(!valid(value,['sessionId','contextId']))throw fail('invalid_request');
    if(this.session?.id===value.sessionId&&this.session.contextId===value.contextId){
      const interrupted=this.closeCurrent();
      if(interrupted)this.onChange();
    }
    return {closed:true};
  }
  closeCurrent(){
    const previous=this.session;this.session=null;this.#reply=null;
    previous?.active?.controller.abort();previous?.picking?.abort();this._dropImage(previous);previous?.seen.clear();
    return !!previous?.active;
  }
  // A different foreground intent invalidates renderer admission even when
  // the account itself is unchanged. Ordinary observations/open do not.
  retire({lostRenderer=false}={}){
    const observable=!!this.context||!!this.session||this.selecting,op=this.session?.active;
    if(!lostRenderer)this.turnIssue=null;
    else if(op?.started&&!op.controller.signal.aborted)this.turnIssue='unknown';
    this.closeCurrent();
    if(this.context)this.contextId=randomUUID();
    if(observable)this.onChange();
  }
}
async function desktopChatResult(operation){try{return {ok:true,...await operation()};}catch(error){return {ok:false,code:CODES.has(error?.code)?error.code:'reply_failed',...(FAILURES.has(error?.failure)?{failure:error.failure}:{})};}}
module.exports={DesktopChat,desktopChatResult,classifyFailure,observeLocalRunner,observeLocalRunners};
