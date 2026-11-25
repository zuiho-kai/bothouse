'use strict';
const fs=require('node:fs');
const path=require('node:path');
const {spawn}=require('node:child_process');
const {EventEmitter}=require('node:events');
const {randomUUID}=require('node:crypto');
const aborted=()=>Object.assign(new Error('Voice operation interrupted.'),{name:'AbortError',code:'voice_interrupted'});
const voiceError=code=>Object.assign(new Error({voice_unavailable:'Windows speech is unavailable. Check the installed speech language and microphone in Windows Settings.',voice_timeout:'The speech device did not respond in time.',voice_listen_timeout:'The listening time limit ended without a completed utterance. Check the default input device and try speaking again.',voice_platform:'Local voice currently requires Windows.',voice_exit_unconfirmed:'Windows speech shutdown has not been confirmed. Retry ending the session.'}[code]||'Local speech failed. Check the microphone, speaker and installed speech language.'),{code});

class WindowsSpeech extends EventEmitter {
  constructor({platform=process.platform,spawnProcess=spawn,now=Date.now,sourcePath=path.join(__dirname,'windows-speech.cs'),exitTimeoutMs=2000,gracefulExitMs=500}={}) {
    super();if(!Number.isInteger(exitTimeoutMs)||exitTimeoutMs<1||exitTimeoutMs>10000||!Number.isInteger(gracefulExitMs)||gracefulExitMs<0||gracefulExitMs>2000)throw voiceError('voice_unavailable');
    this.platform=platform;this.spawnProcess=spawnProcess;this.now=now;this.sourcePath=sourcePath;this.exitTimeoutMs=exitTimeoutMs;this.gracefulExitMs=gracefulExitMs;
    this.child=null;this.host=null;this.startPromise=null;this.pending=new Map();this.listenOperation=null;this.speakOperation=null;this.events=[];this.audioLevels=[];this.listenGeneration=0;this.closed=false;this.closeRequested=false;this.closing=null;
  }
  record(event,id='') {this.events.push({event,id,at:this.now()});this.events=this.events.slice(-200);}
  diagnostics() {return {backend:'windows-system-speech',running:!!this.child,pid:this.child?.pid||null,exitUnconfirmed:!!this.host?.retiring,events:structuredClone(this.events),audioLevels:structuredClone(this.audioLevels)};}
  async start() {
    if(this.closed)throw voiceError('voice_closed');
    if(this.child&&this.ready) return;
    if(this.startPromise) return this.startPromise;
    if(this.host&&!this.host.exited||this.closeRequested)throw voiceError('voice_exit_unconfirmed');
    if(this.platform!=='win32') throw voiceError('voice_platform');
    const source=fs.readFileSync(this.sourcePath,'utf8');
    // The command is exclusively bundled source, never supplied character text.
    const command=`$ErrorActionPreference='Stop'; Add-Type -TypeDefinition @'\n${source}\n'@ -ReferencedAssemblies System.Speech,System.Web.Extensions; [ArcadeVoiceHost]::Run()`;
    const executable=path.join(process.env.SystemRoot||'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe');
    const child=this.spawnProcess(executable,['-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(command,'utf16le').toString('base64')],{windowsHide:true,stdio:['pipe','pipe','pipe']});
    const host={child,pid:child.pid,createdAt:this.now(),spawned:!!child.pid,exited:false,retiring:false,waiters:new Set()};
    this.host=host;this.child=child;this.ready=false;this.record('host-start');
    child.once('spawn',()=>{host.spawned=true;host.pid=child.pid;});
    child.once('exit',()=>this.exited(host));
    child.on('error',()=>{if(!host.spawned&&!child.pid)this.exited(host,'host-spawn-failed');else if(this.host===host)this.destroy();});
    let buffer='';
    this.startPromise=new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{reject(voiceError('voice_timeout'));this.destroy();},20000);timer.unref?.();
      this.startResolve=()=>{clearTimeout(timer);resolve();};
      this.startReject=error=>{clearTimeout(timer);reject(error);};
    }).finally(()=>{this.startPromise=null;this.startResolve=null;this.startReject=null;});
    child.stdout.setEncoding('utf8');child.stdout.on('data',chunk=>{
      if(this.host!==host||host.exited||host.retiring)return;
      buffer+=chunk;if(buffer.length>128*1024){this.destroy();return;}
      let end;
      while((end=buffer.indexOf('\n'))!==-1){const line=buffer.slice(0,end).trim();buffer=buffer.slice(end+1);if(!line)continue;try{this.receive(JSON.parse(line));}catch{this.record('invalid-host-event');}}
    });
    // Drain stderr without retaining possible operating-system details.
    child.stderr.on('data',()=>{if(this.host===host)this.record('host-diagnostic');});
    return this.startPromise;
  }
  unavailable(){this.startReject?.(voiceError('voice_unavailable'));this.ready=false;for(const op of this.pending.values())op.reject(voiceError('voice_unavailable'));this.pending.clear();this.listenOperation=null;this.speakOperation=null;this.emit('unavailable');}
  exited(host,event='host-exit'){
    if(host.exited)return;host.exited=true;for(const done of [...host.waiters])done(true);
    if(this.host!==host)return;this.host=null;this.child=null;this.record(event);this.unavailable();
  }
  destroy(host=this.host){
    if(!host||host.exited||this.host!==host)return;host.retiring=true;this.record('host-termination-requested');this.unavailable();
    // The ChildProcess owns its native handle. Never enumerate or kill by PID,
    // drop this object on a kill request, or mistake killed=true for exit.
    try{host.child.kill();}catch{this.record('host-termination-unconfirmed');}
  }
  waitForExit(host,timeoutMs){
    if(!host||host.exited)return Promise.resolve(true);
    return new Promise(resolve=>{const done=value=>{clearTimeout(timer);host.waiters.delete(done);resolve(value);};const timer=setTimeout(()=>done(false),timeoutMs);host.waiters.add(done);});
  }
  async terminate(host=this.host){this.destroy(host);if(!await this.waitForExit(host,this.exitTimeoutMs)){this.record('host-exit-unconfirmed');throw voiceError('voice_exit_unconfirmed');}}
  receive(row){
    if(!row||typeof row.event!=='string')return;
    if(row.event==='audio-level'){
      if(row.id!==this.listenOperation||!this.pending.has(row.id)||![row.current,row.max,row.count].every(Number.isInteger)||row.current<0||row.current>100||row.max<row.current||row.max>100||row.count<0||row.count>1000000)return;
      const level={current:row.current,max:row.max,count:row.count,at:this.now()};this.audioLevels.push(level);this.audioLevels=this.audioLevels.slice(-120);this.emit('audio-level',level);return;
    }
    this.record(row.event,typeof row.id==='string'?row.id:'');
    if(row.event==='ready'){this.ready=true;this.startResolve?.();return;}
    const op=this.pending.get(row.id);
    if(!op)return; // Late events after interruption never reach the UI/model.
    if(row.event==='error'){op.reject(voiceError('voice_unavailable'));return;}
    if(row.event==='speech-start')this.emit('speech-start',{id:row.id});
    if(row.event==='transcript'&&typeof row.text==='string'&&row.text.length<=2000){this.emit('transcript',{id:row.id,text:row.text,confidence:row.confidence});op.onTranscript?.(row);if(!op.continuous)op.resolve(row);}
    if(row.event==='listening'){op.onListening?.(row);this.emit('listening',row);}
    if(row.event==='unrecognized')this.emit('unrecognized',{id:row.id});
    if(row.event==='playback-start')this.emit('playback-start',{id:row.id});
    if(row.event==='playback-end'){this.emit('playback-end',{id:row.id,cancelled:!!row.cancelled});row.error?op.reject(voiceError('voice_unavailable')):op.resolve(row);}
    if(row.event==='listen-ended'){row.error?op.reject(voiceError('voice_unavailable')):op.resolve(row);}
    if(['capabilities','stopped','interrupted','closed','finishing'].includes(row.event))op.resolve(row);
  }
  async request(op,data={},options={}) {
    if(this.closeRequested&&!['interrupt','close'].includes(op))throw voiceError('voice_closed');
    await this.start();if(options.signal?.aborted)throw aborted();
    if(this.closeRequested&&!['interrupt','close'].includes(op))throw voiceError('voice_closed');
    const id=randomUUID();
    return new Promise((resolve,reject)=>{
      const finish=(error,value)=>{if(!this.pending.has(id))return;this.pending.delete(id);clearTimeout(timer);options.signal?.removeEventListener('abort',cancel);if(this.listenOperation===id)this.listenOperation=null;if(this.speakOperation===id)this.speakOperation=null;error?reject(error):resolve(value);};
      let timer;
      const expireIn=(ms,code=op==='listen'?'voice_listen_timeout':'voice_timeout')=>{clearTimeout(timer);timer=setTimeout(()=>{finish(voiceError(code));if(op==='listen'||op==='speak')this.stopKind(op).catch(()=>{});},ms);timer.unref?.();};
      expireIn(options.timeoutMs||5000);
      const cancel=()=>{finish(aborted());if(op==='listen'||op==='speak')this.stopKind(op).catch(()=>{});};
      this.pending.set(id,{resolve:value=>finish(null,value),reject:error=>finish(error),continuous:options.continuous,onTranscript:options.onTranscript,onListening:options.onListening,expireIn});
      if(op==='listen')this.listenOperation=id;if(op==='speak')this.speakOperation=id;
      options.signal?.addEventListener('abort',cancel,{once:true});
      try{this.child.stdin.write(JSON.stringify({id,op,...data})+'\n');}catch{finish(voiceError('voice_unavailable'));}
    });
  }
  capabilities(){return this.request('capabilities');}
  async finishListening(){
    const listenId=this.listenOperation,operation=this.pending.get(listenId);
    if(!operation)return;
    await this.request('finish-listening',{listenId});
    // The host can finish the last utterance before acknowledging the request.
    // Only the captured operation gets a finalization deadline, never a new mic.
    if(this.pending.get(listenId)===operation)operation.expireIn(5000,'voice_timeout');
  }
  async listen({locale='zh-CN',timeoutMs=30000,signal,continuous=false,onTranscript,onListening}={}) {
    if(!/^[a-z]{2,3}-[A-Z]{2}$/.test(locale))throw voiceError('voice_unavailable');
    if(!Number.isInteger(timeoutMs)||timeoutMs<1000||timeoutMs>600000)throw voiceError('voice_unavailable');
    const generation=++this.listenGeneration;
    await this.stopKind('listen');
    if(generation!==this.listenGeneration)throw aborted();
    try{return await this.request('listen',{locale},{signal,timeoutMs,continuous,onTranscript,onListening});}
    finally{if(generation===this.listenGeneration)await this.stopKind('listen').catch(()=>{});}
  }
  async speak(text,{locale='zh-CN',voice='',signal}={}) {
    if(typeof text!=='string'||!text.trim()||text.length>2000||typeof voice!=='string'||voice.length>120||!/^[-a-zA-Z]{2,20}$/.test(locale))throw voiceError('voice_unavailable');
    await this.stopKind('speak');
    return this.request('speak',{text,locale,voice},{signal,timeoutMs:180000});
  }
  async stopKind(kind){
    const host=this.host;
    const id=kind==='listen'?this.listenOperation:this.speakOperation;
    if(id)this.pending.get(id)?.reject(aborted());
    if(!this.child||!this.ready){if(host?.retiring)await this.terminate(host);return;}
    try{return await this.request(kind==='listen'?'stop-listening':'stop-speaking',{}, {timeoutMs:2000});}
    catch{await this.terminate(host);}
  }
  async interrupt(){
    const host=this.host;
    this.listenGeneration++;
    for(const id of [this.listenOperation,this.speakOperation])if(id)this.pending.get(id)?.reject(aborted());
    if(!this.child||!this.ready){if(host&&!host.exited)await this.terminate(host);return {event:'interrupted'};}
    try{return await this.request('interrupt',{}, {timeoutMs:2000});}catch{await this.terminate(host);return {event:'interrupted',hostStopped:true};}
  }
  close(){
    if(this.closing)return this.closing;if(this.closed)return Promise.resolve();
    this.closeRequested=true;
    const operation=(async()=>{
      const host=this.host;try{await this.interrupt();}catch{/* Still attempt final owned-host cleanup. */}
      if(this.host===host&&host&&!host.exited&&this.ready){try{await this.request('close',{}, {timeoutMs:2000});}catch{}}
      if(!await this.waitForExit(host,this.gracefulExitMs)){
        if(this.host!==host)throw voiceError('voice_exit_unconfirmed');
        await this.terminate(host);
      }
      this.closed=true;
    })();this.closing=operation;
    operation.then(()=>{if(this.closing===operation)this.closing=null;},()=>{if(this.closing===operation)this.closing=null;});return operation;
  }
}
module.exports={WindowsSpeech,aborted};
