'use strict';
const {randomUUID}=require('node:crypto');
const {WindowsSpeech}=require('./windows-speech.cjs');

// One instance belongs to one explicitly selected account/character scope.
// Audio is neither recorded nor uploaded; only recognized text enters respond().
class VoiceConversation {
  constructor({speech=new WindowsSpeech(),respond,scope,onChange=()=>{},now=Date.now}={}) {
    if(typeof respond!=='function'||typeof scope!=='string'||!scope)throw Error('A selected companion and response function are required.');
    this.speech=speech;this.respond=respond;this.scope=scope;this.onChange=onChange;this.now=now;
    this.epoch=0;this.session=null;this.reply=null;this.draft=null;this.closed=false;this.mode='push-to-talk';this.locale='zh-CN';this.voice='';
    this.state={status:'idle',mode:this.mode,transcript:'',reply:'',error:'',reason:'',turnId:null,draftId:null,reviewed:false,scope,listeningSince:0,speechDetectedAt:0,audioLevel:null};this.events=[];
    this.onSpeechStart=()=>{
      if(this.session&&!this.closed)this.update({speechDetectedAt:this.now()});
      if(this.mode!=='hands-free'||!this.session||this.closed)return;
      if(this.reply){this.epoch++;this.reply.controller.abort();this.reply=null;this.speech.stopKind('speak').catch(()=>{});this.record('speech-interruption');}
      this.update({status:'listening'});
    };
    this.onPlaybackStart=()=>{if(this.reply)this.update({status:'speaking'});};
    this.onAudioLevel=level=>{if(this.session&&!this.closed)this.update({audioLevel:level});};
    this.speech.on('speech-start',this.onSpeechStart);this.speech.on('playback-start',this.onPlaybackStart);
    this.speech.on('audio-level',this.onAudioLevel);
  }
  snapshot(){return structuredClone(this.state);}
  update(patch){Object.assign(this.state,patch);this.onChange(this.snapshot());}
  record(event,extra={}){this.events.push({event,at:this.now(),...extra});this.events=this.events.slice(-200);}
  diagnostics(){return {scope:this.scope,mode:this.mode,events:structuredClone(this.events),speech:this.speech.diagnostics()};}
  capabilities(){return this.speech.capabilities();}
  async startListening({mode='push-to-talk',locale='zh-CN',voice='',headphonesConfirmed=false}={}) {
    if(this.closed)throw Error('This voice session is closed.');
    if(!['push-to-talk','hands-free'].includes(mode))throw Error('Choose a supported voice mode.');
    if(mode==='hands-free'&&headphonesConfirmed!==true)throw Error('Use headphones for hands-free conversation to avoid the speaker being recognized as your voice.');
    const requestedEpoch=this.epoch+1;
    await this.interrupt();
    if(this.closed||requestedEpoch!==this.epoch)return this.snapshot();
    this.mode=mode;this.locale=locale;this.voice=voice;this.state.mode=mode;
    const controller=new AbortController(),session={controller,promise:null,finishing:false,text:''};this.session=session;
    this.record('microphone-request',{mode});this.update({status:'starting',error:'',reason:'',transcript:'',reply:'',draftId:null,reviewed:false,listeningSince:0,speechDetectedAt:0,audioLevel:null});
    session.promise=this.speech.listen({mode,locale,signal:controller.signal,continuous:true,timeoutMs:600000,
      onListening:()=>{if(this.session===session){this.record('microphone-listening');this.update({status:'listening',listeningSince:this.now()});}},
      onTranscript:row=>{
        if(this.session!==session||controller.signal.aborted)return;
        if(mode==='hands-free')this.accept(row.text).catch(()=>{});
        else if(typeof row.text==='string'){
          session.text=(session.text?`${session.text} ${row.text}`:row.text).slice(0,2000);
          this.update({transcript:session.text});
          if(session.text.length>=2000)this.update({reason:'text-limit'});
        }
      },
    }).then(async result=>{
      if(this.session!==session||controller.signal.aborted)return;
      this.session=null;this.record('microphone-ended');
      if(mode==='push-to-talk'&&session.finishing&&session.text.trim()){
        this.draft={id:randomUUID(),text:session.text};this.record('transcript-awaiting-review');
        this.update({status:'reviewing',reason:'',transcript:session.text,draftId:this.draft.id});
      }
      else if(!this.reply)this.update({status:mode==='push-to-talk'&&session.finishing?'unrecognized':'idle',reason:mode==='push-to-talk'&&session.finishing?'no-words':'listening-ended'});
    }).catch(async error=>{
      if(this.session!==session)return;
      this.session=null;
      if(error.name!=='AbortError'){
        // Losing the listener also removes spoken interruption. Stop the owned
        // reply now; a late model result must not start uninterruptible playback.
        const epoch=++this.epoch;session.controller.abort();this.reply?.controller.abort();this.reply=null;
        await this.speech.stopKind('speak').catch(()=>{});
        if(this.closed||this.epoch!==epoch||this.session)return;
        const timedOut=error.code==='voice_listen_timeout';this.record(timedOut?'listening-timeout':'microphone-error',{code:error.code||'voice_error'});this.update({status:timedOut?'idle':'error',reason:timedOut?'listening-timeout':'microphone-error',error:timedOut?'':error.message});
      }
    });
    // Starting the microphone is not a blocking UI call. Errors/events are state.
    return this.snapshot();
  }
  finishListening(){
    const session=this.session;
    if(this.closed||!session||this.mode!=='push-to-talk'||session.finishing)return this.snapshot();
    session.finishing=true;this.record('microphone-finish-requested');this.update({status:'recognizing',reason:''});
    this.speech.finishListening().catch(async error=>{
      if(this.session!==session||this.closed)return;
      const epoch=this.epoch;session.controller.abort();this.session=null;await this.speech.stopKind('listen').catch(()=>{});
      if(!this.closed&&!this.session&&this.epoch===epoch){this.record('microphone-error',{code:error.code||'voice_error'});this.update({status:'error',reason:'microphone-error',error:error.message});}
    });
    return this.snapshot();
  }
  confirmTranscript({draftId,text}={}){
    if(this.closed||!this.draft||this.state.status!=='reviewing'||draftId!==this.draft.id)throw Error('This transcript changed. Review the current transcript before sending.');
    if(typeof text!=='string'||!text.trim()||text.length>2000)throw Error('Enter between 1 and 2,000 characters.');
    const edited=text!==this.draft.text;this.draft=null;
    this.record('transcript-confirmed',{edited});this.update({status:'thinking',draftId:null,transcript:text,reviewed:true,reason:''});
    const pending=this.accept(text),epoch=this.epoch;
    pending.catch(error=>{if(!this.closed&&this.epoch===epoch){this.record('turn-error',{code:error.code||'voice_error'});this.update({status:'error',error:error.message||'Voice conversation failed.'});}});
    return this.snapshot();
  }
  async accept(text){
    if(this.closed||typeof text!=='string'||!text.trim())return;
    if(/^(停止|停一下|别说了|暂停|stop)[。.!！\s]*$/i.test(text.trim())){
      this.epoch++;this.reply?.controller.abort();this.reply=null;await this.speech.stopKind('speak');
      this.record('spoken-stop');this.update({status:this.session?'listening':'idle',transcript:text,reply:''});return;
    }
    const epoch=++this.epoch;this.reply?.controller.abort();await this.speech.stopKind('speak');
    if(this.closed||epoch!==this.epoch)return;
    const turnId=randomUUID(),controller=new AbortController(),turn={controller,turnId};this.reply=turn;
    this.record('turn-start',{turnId});this.update({status:'thinking',transcript:text,reply:'',error:'',turnId});
    try{
      const result=await this.respond(text,{signal:controller.signal,turnId,voice:true});
      if(controller.signal.aborted||epoch!==this.epoch||this.closed)return;
      const reply=typeof result==='string'?result:result?.outcome==='reply_ended'?result.text:'';
      if(!reply||typeof reply!=='string'){this.record('turn-no-reply',{turnId});return;}
      this.record('response-ready',{turnId});
      this.update({reply:reply.slice(0,2000)});
      await this.speech.speak(reply.slice(0,2000),{locale:this.locale,voice:this.voice,signal:controller.signal});
      if(controller.signal.aborted||epoch!==this.epoch||this.closed)return;
      this.record('turn-played',{turnId});
    }catch(error){
      if(controller.signal.aborted||epoch!==this.epoch||this.closed)return;
      this.record('turn-error',{turnId,code:error.code||'voice_error'});this.update({status:'error',error:error.message||'Voice conversation failed.'});
    }finally{
      if(this.reply===turn){this.reply=null;if(this.state.status!=='error')this.update({status:this.session?'listening':'idle'});}
    }
  }
  async interrupt(reason='manual-interruption'){
    this.epoch++;this.session?.controller.abort();this.reply?.controller.abort();this.session=null;this.reply=null;this.draft=null;
    this.record('interruption',{reason});await this.speech.interrupt();if(!this.closed)this.update({status:'idle',reason,draftId:null});
    return this.snapshot();
  }
  async close(reason='manual-close'){
    if(this.closing)return this.closing;
    this.closed=true;
    const operation=(async()=>{
      // Interrupt may time out while its owned child is still retiring. The
      // provider's close must nevertheless run: it owns lease recovery and is
      // the only authority that can confirm termination and release resources.
      try{await this.interrupt(reason);}catch{this.record('close-interruption-unconfirmed',{reason});}
      this.speech.removeListener('speech-start',this.onSpeechStart);this.speech.removeListener('playback-start',this.onPlaybackStart);
      this.speech.removeListener('audio-level',this.onAudioLevel);
      try{await this.speech.close();}
      catch(error){this.record('session-close-unconfirmed',{reason});this.update({status:'error',reason,draftId:null,error:'Voice shutdown has not been confirmed. Retry ending the session.'});throw error;}
      this.record('session-closed',{reason});this.update({status:'closed',reason,draftId:null,error:''});
    })();
    this.closing=operation;
    try{return await operation;}finally{if(this.closing===operation)this.closing=null;}
  }
}
module.exports={VoiceConversation};
