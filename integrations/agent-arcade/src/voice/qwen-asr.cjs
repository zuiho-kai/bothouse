'use strict';
const fs=require('node:fs');
const path=require('node:path');
const {spawn}=require('node:child_process');
const {EventEmitter}=require('node:events');
const {randomUUID}=require('node:crypto');
const {aborted}=require('./windows-speech.cjs');
const MESSAGES={voice_dependencies:'The local Qwen ASR environment has missing or different dependencies.',voice_model_missing:'The local Qwen ASR model is missing. Complete the separate local installation first.',voice_gpu_unavailable:'The local Qwen ASR provider requires its configured CUDA environment.',voice_capture_limit:'Recording reached its 60-second limit and was discarded. Start again, then choose Finish sooner.',voice_audio_overflow:'The input device dropped audio. Recording was discarded; check the device and try again.',voice_locale:'Choose Chinese or English for this Qwen ASR provider.',voice_timeout:'The local Qwen ASR process did not respond in time.',voice_listen_timeout:'The ten-minute listening limit ended. Start a new voice session to continue.',voice_closed:'This local voice session is closed.',voice_exit_unconfirmed:'The previous local recognition process has not confirmed exit. Voice remains reserved; retry ending the session.'};
const failure=code=>Object.assign(new Error(MESSAGES[code]||'Local Qwen speech failed. Check its environment and default input device.'),{code:MESSAGES[code]?code:'voice_unavailable'});
const EVENTS=new Set(['loading','listening','speech-start','microphone-closed','transcript','listen-ended','unrecognized','error','capabilities','finishing']);

class QwenAsr extends EventEmitter {
  constructor({pythonPath,modelPath,spawnProcess=spawn,now=Date.now,sourcePath=path.join(__dirname,'qwen-asr-worker.py'),exitTimeoutMs=5000}={}){
    super();
    if(![pythonPath,modelPath].every(value=>typeof value==='string'&&path.isAbsolute(value)&&!/^[/\\]{2}/.test(value)&&!value.includes('\0')))throw failure('voice_model_missing');
    if(!Number.isInteger(exitTimeoutMs)||exitTimeoutMs<1||exitTimeoutMs>5000)throw failure('voice_unavailable');
    this.pythonPath=pythonPath;this.modelPath=modelPath;this.spawnProcess=spawnProcess;this.now=now;this.sourcePath=sourcePath;
    this.child=null;this.starting=null;this.pending=new Map();this.listenOperation=null;this.generation=0;this.closed=false;this.events=[];this.audioLevels=[];
    this.retiring=new Map();this.exited=new WeakSet();this.exitTimeoutMs=exitTimeoutMs;
  }
  record(event,id=''){this.events.push({event,id,at:this.now()});this.events=this.events.slice(-200);}
  diagnostics(){return {backend:'qwen3-asr-local',running:!!this.child||this.retiring.size>0,pid:this.child?.pid||this.retiring.keys().next().value?.pid||null,retiring:this.retiring.size,recordingRetained:false,handsFree:true,manualReview:true,events:structuredClone(this.events),audioLevels:structuredClone(this.audioLevels)};}
  hasExited(child){return this.exited.has(child)||child.exitCode!=null||child.signalCode!=null;}
  confirmExit(child){
    if(!this.exited.has(child)){this.exited.add(child);this.record('host-exited');}
    const pending=this.retiring.get(child);if(pending){this.retiring.delete(child);pending.resolve();}
  }
  retire(child){
    if(this.hasExited(child)){this.confirmExit(child);return;}
    if(!this.retiring.has(child)){let resolve;const promise=new Promise(done=>{resolve=done;});this.retiring.set(child,{promise,resolve});}
    // A successful kill() only confirms that a signal was sent. Retain the
    // exact ChildProcess until exit/close or a non-null exit/signal code.
    try{child.kill();this.record('host-stop-requested');}catch{this.record('host-stop-unconfirmed');}
    if(this.hasExited(child))this.confirmExit(child);
  }
  async waitForRetiring(){
    for(const child of this.retiring.keys())if(this.hasExited(child))this.confirmExit(child);
    if(!this.retiring.size)return;
    let timer;
    try{await Promise.race([Promise.all([...this.retiring.values()].map(value=>value.promise)),new Promise((_,reject)=>{timer=setTimeout(()=>reject(failure('voice_exit_unconfirmed')),this.exitTimeoutMs);})]);}
    finally{clearTimeout(timer);}
  }
  async start({generation=this.generation,signal}={}){
    if(this.closed)throw failure('voice_closed');
    if(this.retiring.size)await this.waitForRetiring();
    if(this.closed||signal?.aborted||generation!==this.generation)throw aborted();
    if(this.starting)return this.starting.promise;
    if(this.child)return;
    // Reading bundled source works inside app.asar. Python receives no user code or shell command.
    const source=fs.readFileSync(this.sourcePath,'utf8');
    if(source.length>24000)throw failure('voice_unavailable');
    const child=this.spawnProcess(this.pythonPath,['-u','-c',source,this.modelPath],{windowsHide:true,stdio:['pipe','pipe','pipe'],env:{...process.env,PYTHONUTF8:'1',HF_HUB_OFFLINE:'1',TRANSFORMERS_OFFLINE:'1',HF_HUB_DISABLE_TELEMETRY:'1',DO_NOT_TRACK:'1'}});
    this.child=child;this.record('host-start');let buffer='';
    let resolve,reject;
    const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});
    const timer=setTimeout(()=>this.destroy(failure('voice_timeout')),10000);timer.unref?.();
    this.starting={promise,resolve:()=>{clearTimeout(timer);this.starting=null;resolve();},reject:error=>{clearTimeout(timer);this.starting=null;reject(error);}};
    child.stdout.setEncoding('utf8');child.stdout.on('data',chunk=>{
      if(this.child!==child)return;
      buffer+=chunk;if(buffer.length>32768){this.destroy(failure('voice_unavailable'));return;}
      let end;while((end=buffer.indexOf('\n'))!==-1){const line=buffer.slice(0,end);buffer=buffer.slice(end+1);try{this.receive(JSON.parse(line));}catch{this.destroy(failure('voice_unavailable'));return;}}
    });
    child.stderr.on('data',()=>{if(this.child===child)this.record('host-diagnostic');});
    child.stdin.on('error',()=>{if(this.child===child)this.destroy(failure('voice_unavailable'));});
    child.on('error',()=>{if(!child.pid)this.confirmExit(child);if(this.child===child)this.destroy(failure('voice_unavailable'));});
    const exited=()=>{this.confirmExit(child);if(this.child===child)this.destroy(failure('voice_unavailable'));};
    child.once('exit',exited);child.once('close',exited);
    return promise;
  }
  destroy(error=aborted()){
    const child=this.child;this.child=null;this.starting?.reject(error);
    for(const op of [...this.pending.values()])op.reject(error);
    this.listenOperation=null;
    if(child)this.retire(child);
  }
  receive(row){
    if(!row||typeof row.event!=='string')return;
    if(row.event==='ready'){this.record('ready');this.starting?.resolve();return;}
    const op=this.pending.get(row.id);if(!op)return;
    if(row.event==='audio-level'){
      if(row.id!==this.listenOperation||![row.current,row.max,row.count].every(Number.isInteger)||row.current<0||row.current>100||row.max<row.current||row.max>100||row.count<0||row.count>30000)return;
      const level={current:row.current,max:row.max,count:row.count,at:this.now()};this.audioLevels.push(level);this.audioLevels=this.audioLevels.slice(-120);this.emit('audio-level',level);return;
    }
    if(!EVENTS.has(row.event))return;this.record(row.event,row.id);
    if(row.event==='error'){op.reject(failure(row.code));if(op.kind==='listen')this.destroy(failure(row.code));return;}
    if(row.event==='listening'){op.expireIn(op.mode==='hands-free'?605000:65000);op.onListening?.({id:row.id,event:'listening'});this.emit('listening',{id:row.id});}
    if(row.event==='speech-start'&&row.id===this.listenOperation&&row.detector==='webrtcvad'&&row.mode===2){
      const manual=op.mode==='push-to-talk'&&row.voicedFrames===3&&row.windowFrames===5;
      const handsFree=op.mode==='hands-free'&&row.voicedFrames===6&&row.windowFrames===8&&Number.isInteger(row.utteranceId)&&row.utteranceId>op.latestUtterance&&row.utteranceId<=3000;
      if(manual||handsFree){if(handsFree)op.latestUtterance=row.utteranceId;this.emit('speech-start',{id:row.id,detector:'webrtcvad'});}
    }
    if(row.event==='transcript'&&row.id===this.listenOperation){
      if(typeof row.text!=='string'||!row.text.trim()||row.text.length>2000){this.destroy(failure('voice_unavailable'));return;}
      if(op.mode==='hands-free'){
        if(!Number.isInteger(row.utteranceId)||row.utteranceId!==op.latestUtterance||row.utteranceId<=op.lastTranscript)return;
        op.lastTranscript=row.utteranceId;
      }else{
        if(!op.finishing||!op.microphoneClosed){this.destroy(failure('voice_unavailable'));return;}
        if(op.transcriptSeen)return;op.transcriptSeen=true;
      }
      const transcript={id:row.id,text:row.text};op.onTranscript?.(transcript);this.emit('transcript',transcript);
    }
    if(row.event==='microphone-closed'&&row.id===this.listenOperation)op.microphoneClosed=true;
    if(row.event==='unrecognized')this.emit('unrecognized',{id:row.id});
    if(['capabilities','finishing','listen-ended'].includes(row.event))op.resolve(row);
  }
  async request(kind,data={},options={},generation=this.generation){
    await this.start({generation,signal:options.signal});if(this.closed||options.signal?.aborted||generation!==this.generation)throw aborted();
    const id=randomUUID();
    return new Promise((resolve,reject)=>{
      let timer;
      const finish=(error,value)=>{if(!this.pending.has(id))return;this.pending.delete(id);clearTimeout(timer);options.signal?.removeEventListener('abort',cancel);if(this.listenOperation===id)this.listenOperation=null;error?reject(error):resolve(value);};
      const expireIn=ms=>{clearTimeout(timer);timer=setTimeout(()=>{finish(failure('voice_timeout'));this.destroy(failure('voice_timeout'));},ms);timer.unref?.();};
      const cancel=()=>{if(this.pending.has(id))this.destroy(aborted());};
      this.pending.set(id,{kind,mode:data.mode||'push-to-talk',latestUtterance:0,lastTranscript:0,resolve:value=>finish(null,value),reject:error=>finish(error),expireIn,onTranscript:options.onTranscript,onListening:options.onListening,finishing:false,microphoneClosed:false});
      if(kind==='listen')this.listenOperation=id;
      expireIn(kind==='listen'?90000:5000);options.signal?.addEventListener('abort',cancel,{once:true});
      if(options.signal?.aborted){cancel();return;}
      try{this.child.stdin.write(JSON.stringify({id,op:kind,...data})+'\n');}catch{this.destroy(failure('voice_unavailable'));}
    });
  }
  capabilities(){return this.request('capabilities');}
  async listen({locale='zh-CN',mode='push-to-talk',signal,onTranscript,onListening}={}){
    if(!['zh-CN','en-US'].includes(locale))throw failure('voice_locale');
    if(!['push-to-talk','hands-free'].includes(mode))throw failure('voice_unavailable');
    const generation=++this.generation;
    if(this.listenOperation)this.destroy(aborted());
    const cancel=()=>{if(generation===this.generation)this.destroy(aborted());};signal?.addEventListener('abort',cancel,{once:true});
    try{
      if(signal?.aborted)throw aborted();await this.start({generation,signal});
      if(signal?.aborted||generation!==this.generation)throw aborted();
      return await this.request('listen',{locale,mode},{signal,onTranscript,onListening},generation);
    }finally{signal?.removeEventListener('abort',cancel);}
  }
  async finishListening(){
    const id=this.listenOperation,op=this.pending.get(id);if(!op||op.finishing)return;
    if(op.mode!=='push-to-talk')throw failure('voice_unavailable');
    op.finishing=true;
    const row=await this.request('finish-listening',{listenId:id});
    if(row.microphoneClosed!==true||row.listenId!==id){this.destroy(failure('voice_unavailable'));throw failure('voice_unavailable');}
    if(this.pending.get(id)===op){op.microphoneClosed=true;op.expireIn(30000);}
  }
  async stopKind(kind){if(kind==='listen'){this.generation++;if(this.listenOperation||this.starting)this.destroy(aborted());await this.waitForRetiring();}}
  async interrupt(){this.generation++;if(this.listenOperation||this.starting)this.destroy(aborted());await this.waitForRetiring();return {event:'interrupted'};}
  async close(){this.closed=true;this.generation++;const active=this.child;this.destroy(aborted());for(const child of this.retiring.keys())if(child!==active)this.retire(child);await this.waitForRetiring();}
}

// Playback is supplied by the caller: WindowsSpeech today, another local voice later.
// Neither component silently selects another recognition or synthesis provider.
class QwenSpeech extends EventEmitter {
  constructor({asr,playback}={}){
    super();if(!asr||!playback)throw Error('Explicit ASR and playback providers are required.');
    this.asr=asr;this.playback=playback;this.listeners=[];this.listenGeneration=0;
    for(const [provider,names] of [[asr,['speech-start','listening','transcript','unrecognized','audio-level','unavailable']],[playback,['playback-start','playback-end']]])for(const name of names){const listener=row=>this.emit(name,row);provider.on(name,listener);this.listeners.push([provider,name,listener]);}
  }
  async capabilities(){
    const [asr,playback]=await Promise.all([this.asr.capabilities(),this.playback.capabilities()]);
    const voices=playback.voices||[],locales=new Set(voices.filter(voice=>voice.enabled!==false).map(voice=>voice.locale));
    return {...asr,recognizers:(asr.recognizers||[]).filter(item=>locales.has(item.locale)),voices,playbackBackend:playback.backend,handsFree:asr.handsFree===true,manualReview:true};
  }
  async listen(options={}){
    const generation=++this.listenGeneration;
    const controller=new AbortController(),abort=()=>controller.abort();
    options.signal?.addEventListener('abort',abort,{once:true});if(options.signal?.aborted)controller.abort();
    let warmed=false,pendingTranscript=null;
    const clearPending=()=>{pendingTranscript=null;};this.asr.on('speech-start',clearPending);
    try{
      const ready=Promise.resolve().then(()=>this.playback.warmup?.({signal:controller.signal})).then(()=>{
        warmed=true;if(pendingTranscript&&!controller.signal.aborted&&generation===this.listenGeneration)options.onTranscript?.(pendingTranscript);pendingTranscript=null;
      });
      const [result]=await Promise.all([this.asr.listen({...options,signal:controller.signal,onTranscript:row=>{
        if(controller.signal.aborted||generation!==this.listenGeneration)return;
        if(warmed)options.onTranscript?.(row);else pendingTranscript=row;
      }}),ready]);
      return result;
    }catch(error){controller.abort();if(generation===this.listenGeneration)await this.asr.stopKind('listen').catch(()=>{});throw error;}
    finally{options.signal?.removeEventListener('abort',abort);this.asr.removeListener('speech-start',clearPending);pendingTranscript=null;}
  }
  finishListening(){return this.asr.finishListening();}
  speak(text,options){return this.playback.speak(text,options);}
  stopKind(kind){if(kind==='listen')this.listenGeneration++;return kind==='listen'?this.asr.stopKind(kind):this.playback.stopKind(kind);}
  async interrupt(){this.listenGeneration++;await Promise.all([this.asr.interrupt(),this.playback.interrupt()]);}
  diagnostics(){return {...this.asr.diagnostics(),playback:this.playback.diagnostics()};}
  async close(){this.listenGeneration++;try{await Promise.all([this.asr.close(),this.playback.close()]);}finally{for(const [provider,name,listener] of this.listeners)provider.removeListener(name,listener);this.listeners=[];}}
}
module.exports={QwenAsr,QwenSpeech};
