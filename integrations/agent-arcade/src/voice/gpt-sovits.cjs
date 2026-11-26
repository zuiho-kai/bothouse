'use strict';
const fs=require('node:fs');
const path=require('node:path');
const {spawn}=require('node:child_process');
const {EventEmitter}=require('node:events');
const {randomUUID,createHash}=require('node:crypto');
const MAX_RENDER_SAMPLES=960000;
const MAX_FRAME_BYTES=8192;
const MAX_RENDER_FRAMES=512;
const MAX_PROTOCOL_LINE=32768;
function renderText(text){return typeof text==='string'&&text.trim()&&text.length<=240&&[...text].length<=120&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\ud800-\udfff]/u.test(text);}
function wavHeader(frames){const bytes=frames*2,header=Buffer.alloc(44);header.write('RIFF');header.writeUInt32LE(bytes+36,4);header.write('WAVEfmt ',8);header.writeUInt32LE(16,16);header.writeUInt16LE(1,20);header.writeUInt16LE(1,22);header.writeUInt32LE(32000,24);header.writeUInt32LE(64000,28);header.writeUInt16LE(2,32);header.writeUInt16LE(16,34);header.write('data',36);header.writeUInt32LE(bytes,40);return header;}
const interrupted=()=>Object.assign(new Error('Voice operation interrupted.'),{name:'AbortError',code:'voice_interrupted'});
const failure=code=>Object.assign(new Error({voice_closed:'This voice session is closed.',voice_locale:'This local Serena voice currently supports Mandarin.',voice_timeout:'Local voice preparation or playback timed out.',voice_exit_timeout:'The previous local voice process has not confirmed exit; no replacement was started.',voice_output:'The selected Windows output device is unavailable.',voice_assets:'The local Serena runtime or verified voice files are missing.',voice_limit:'This reply exceeds the local voice text or duration limit.'}[code]||'Local Serena synthesis failed. Check the configured voice runtime.'),{code:code||'voice_unavailable'});
const voice=()=>({name:'Serena',locale:'zh-CN',enabled:true});
const renderReadyKeys=['event','outputAvailable','outputDevice','outputChecked','renderAvailable','nonce','pid','parentPid'];
const renderEvents=new Set(['render-start','render-pcm','render-end','error']);
const validPid=value=>Number.isSafeInteger(value)&&value>1&&value<=2147483647;
function workerEnvironment(renderOnly){
  const env=renderOnly?Object.fromEntries(['HOME','PATH','TMPDIR','LANG','LC_ALL','LC_CTYPE']
    .flatMap(key=>{const value=process.env[key];return value&&value.length<=8192&&!/[\0\r\n]/.test(value)?[[key,value]]:[];})):process.env;
  return {...env,PYTHONUTF8:'1',HF_HUB_OFFLINE:'1',TRANSFORMERS_OFFLINE:'1',
    HF_HUB_DISABLE_IMPLICIT_TOKEN:'1',HF_HUB_DISABLE_TELEMETRY:'1',TOKENIZERS_PARALLELISM:'false',
    ...(renderOnly?{PYTHONNOUSERSITE:'1',DO_NOT_TRACK:'1'}:{})};
}
const createRenderProof=options=>new (require('./posix-python-process-proof.cjs').PosixPythonProcessProof)(options);

// One provider belongs to one account/panel. It never discovers keys or downloads assets.
class GptSovitsSpeech extends EventEmitter {
  constructor({pythonPath,repoPath,referencePath,spawnProcess=spawn,now=Date.now,workerPath=path.join(__dirname,'gpt-sovits-worker.py'),exitTimeoutMs=5000,renderOnly=false,proofFactory=createRenderProof}={}) {
    super();
    if(![pythonPath,repoPath,referencePath].every(item=>typeof item==='string'&&path.isAbsolute(item)&&!item.includes('\0')&&!/^[/\\]{2}/.test(item)))throw failure('voice_assets');
    if(!Number.isInteger(exitTimeoutMs)||exitTimeoutMs<10||exitTimeoutMs>5000)throw failure('voice_assets');
    if(typeof renderOnly!=='boolean'||renderOnly&&typeof proofFactory!=='function')throw failure('voice_assets');
    Object.assign(this,{pythonPath,repoPath,referencePath,spawnProcess,now,workerPath,exitTimeoutMs,renderOnly,proofFactory});
    this.retiring=new Map();
    this.renderWorker=null;
    this.child=null;this.starting=null;this.pending=new Map();this.events=[];this.hostDiagnostics={chunks:0,firstAt:null,lastAt:null};this.generation=0;this.closed=false;this.speakOperation=null;this.warmPromise=null;this.capability=null;
  }
  record(event,id='',values={}){this.events.push({event,id,at:this.now(),...values});this.events=this.events.slice(-200);}
  diagnostics(){return {backend:'gpt-sovits-v2proplus-local',running:!!this.child,pid:this.child?.pid||null,events:structuredClone(this.events),hostDiagnostics:{...this.hostDiagnostics},audioRetained:[...this.pending.values()].some(op=>op.pcm?.length>0),retiringWorkers:this.retiring.size,outputDevice:this.capability?.outputDevice||null};}
  async start({signal,generation=this.generation}={}){
    if(this.closed)throw failure('voice_closed');
    if(signal?.aborted||generation!==this.generation)throw interrupted();
    if(this.retiring.size)await this.waitRetired();
    if(this.closed)throw failure('voice_closed');
    if(signal?.aborted||generation!==this.generation)throw interrupted();
    if(this.starting)return this.starting.promise;
    if(this.child)return;
    const source=fs.readFileSync(this.workerPath,'utf8');if(source.length>24000)throw failure('voice_assets');
    let worker=null;
    const args=['-u','-c',source,this.repoPath,this.referencePath];
    if(this.renderOnly){
      let proof;
      try{proof=this.proofFactory({pythonPath:this.pythonPath,parentPid:process.pid});}catch{throw failure('voice_assets');}
      if(!proof||['bind','proveReady','close'].some(key=>typeof proof[key]!=='function'))throw failure('voice_assets');
      worker={proof,nonce:randomUUID(),bound:false,verified:false,proving:null};
      args.push(worker.nonce,'--render-only');
    }
    const startedAt=Date.now();
    const child=this.spawnProcess(this.pythonPath,args,{windowsHide:true,stdio:['pipe','pipe','pipe'],
      ...(worker?{shell:false,detached:true}:{}),env:workerEnvironment(this.renderOnly)});
    this.renderWorker=worker;
    this.child=child;this.record('host-start');let buffer='',resolve,reject;
    const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});
    const timer=setTimeout(()=>{if(this.child===child)this.destroy(failure('voice_timeout'));},10000);timer.unref?.();
    const starting={promise,resolve:()=>{clearTimeout(timer);if(this.starting===starting)this.starting=null;resolve();},reject:error=>{clearTimeout(timer);if(this.starting===starting)this.starting=null;reject(error);}};this.starting=starting;
    child.stdout.setEncoding('utf8');child.stdout.on('data',chunk=>{
      if(this.child!==child)return;
      // Bound the individual unfinished line, not a pipe chunk containing many
      // valid frames. Do not join an unbounded burst into a second full string.
      let offset=0;
      while(offset<chunk.length){
        if(this.child!==child)return;
        const end=chunk.indexOf('\n',offset),stop=end===-1?chunk.length:end;
        if(buffer.length+stop-offset>MAX_PROTOCOL_LINE){this.destroy(failure());return;}
        buffer+=chunk.slice(offset,stop);offset=stop+1;
        if(end===-1)break;
        const line=buffer;buffer='';try{this.receive(JSON.parse(line));}catch{this.destroy(failure());return;}
      }
    });
    // Upstream progress output can be very frequent and can contain text. Drain
    // it without retaining content or displacing the useful phase timestamps.
    child.stderr.on('data',()=>{if(this.child===child){const at=this.now();this.hostDiagnostics.chunks=Math.min(1000000,this.hostDiagnostics.chunks+1);this.hostDiagnostics.firstAt??=at;this.hostDiagnostics.lastAt=at;}});
    child.stdin.on('error',()=>{if(this.child===child)this.destroy(failure());});
    child.on('exit',()=>{
      child.arcadeExited=true;
      const retiring=this.retiring.get(child);
      if(retiring&&!retiring.worker){clearTimeout(retiring.timer);this.retiring.delete(child);retiring.resolve(true);}
      if(this.child===child)this.destroy(failure());
    });
    child.on('error',()=>{
      // A failed spawn has no OS process and emits error/close rather than exit.
      // Do not retain a phantom worker; errors after a real PID still require exit.
      if(!Number.isInteger(child.pid)||child.pid<=0)child.arcadeExited=true;
      if(this.child===child)this.destroy(failure());
    });
    if(worker){
      if(!validPid(child.pid))this.destroy(failure());
      else try{worker.proof.bind({pid:child.pid,startedAt,child});worker.bound=true;}
      catch{this.destroy(failure('voice_exit_timeout'));}
    }
    return promise;
  }
  async waitRetired({retry=false}={}){
    const settled=await Promise.all([...this.retiring].map(([child,item])=>
      item.worker?this.confirmRenderExit(child,item,retry):item.promise));
    if(settled.some(value=>value!==true)||this.retiring.size)throw failure('voice_exit_timeout');
  }
  confirmRenderExit(child,item,retry){
    if(item.promise&&(!retry||item.active))return item.promise;
    item.active=true;
    const {worker}=item;
    item.promise=Promise.resolve().then(async()=>{
      if(!worker.bound)return false;
      await worker.proving;
      if((await worker.proof.close())?.closed!==true)return false;
      this.retiring.delete(child);
      try{child.stdin.destroy();child.stdout.destroy();child.stderr.destroy();}catch{/* The owned process group has already exited. */}
      return true;
    }).catch(()=>false).finally(()=>{item.active=false;});
    return item.promise;
  }
  retire(child,worker){
    if(worker){
      if(!validPid(child.pid)||this.retiring.has(child))return;
      const item={worker,active:false,promise:null};
      this.retiring.set(child,item);
      this.confirmRenderExit(child,item,false);
      return;
    }
    if(child.arcadeExited||this.retiring.has(child))return;
    let resolve;const promise=new Promise(yes=>{resolve=yes;});
    const timer=setTimeout(()=>resolve(false),this.exitTimeoutMs);
    this.retiring.set(child,{promise,resolve,timer});
    try{child.kill();}catch{clearTimeout(timer);resolve(false);}
  }
  destroy(error=interrupted()){
    const child=this.child,worker=this.renderWorker;
    this.child=null;this.renderWorker=null;this.starting?.reject(error);
    if(worker)this.capability=null;
    for(const [id,op] of [...this.pending]){if(op.kind==='speak'&&op.playing){this.record('playback-cancelled',id);this.emit('playback-end',{id,cancelled:true});}op.reject(error);}
    if(child){this.retire(child,worker);this.record('host-stop-requested');}
  }
  markReady(row){
    this.capability={backend:'gpt-sovits-v2proplus-local',voices:[voice()],outputAvailable:row.outputAvailable,outputDevice:row.outputDevice,outputChecked:row.outputChecked===true,renderAvailable:row.renderAvailable===true,local:true,audioRetained:false};
    this.record('ready');this.starting.resolve();
  }
  proveRenderReady(row){
    const worker=this.renderWorker,starting=this.starting;
    if(!worker?.bound||!starting||worker.proving||Object.keys(row).length!==renderReadyKeys.length||
       !renderReadyKeys.every(key=>Object.hasOwn(row,key))||row.nonce!==worker.nonce||
       !validPid(row.pid)||!validPid(row.parentPid)||row.outputAvailable!==false||row.outputDevice!==''||
       row.outputChecked!==false||row.renderAvailable!==true)throw failure();
    worker.proving=Promise.resolve().then(()=>worker.proof.proveReady({pid:row.pid,parentPid:row.parentPid})).then(result=>{
      if(this.renderWorker!==worker||this.starting!==starting)return;
      if(result?.verified!==true)throw failure();
      worker.verified=true;this.markReady(row);
    }).catch(()=>{if(this.renderWorker===worker)this.destroy(failure());});
  }
  receive(row){
    if(!row||typeof row.event!=='string')throw failure();
    if(row.event==='ready'){
      if(this.renderOnly){this.proveRenderReady(row);return;}
      if(!this.starting)return;
      if(typeof row.outputAvailable!=='boolean'||typeof row.outputDevice!=='string'||row.outputDevice.length>240)throw failure();
      this.markReady(row);return;
    }
    const op=this.pending.get(row.id);
    if(this.renderOnly&&(!this.renderWorker?.verified||!renderEvents.has(row.event)||!op))throw failure();
    if(!op)return;
    if(row.event==='output-ready'){
      if(op.kind!=='speak'||op.outputChecked||op.segment||op.playing||row.outputAvailable!==true||typeof row.outputDevice!=='string'||row.outputDevice.length>240||/[\u0000-\u001f\u007f]/.test(row.outputDevice))throw failure();
      op.outputChecked=true;this.capability={...this.capability,outputChecked:true,outputAvailable:true,outputDevice:row.outputDevice};
      this.record('output-ready',row.id);return;
    }
    if(row.event==='render-start'){
      if(op.kind!=='render'||op.renderStarted||row.sampleRate!==32000||row.channels!==1||row.bits!==16)throw failure();
      op.renderStarted=true;this.record('render-start',row.id);return;
    }
    if(row.event==='render-pcm'){
      if(op.kind!=='render'||!op.renderStarted||row.seq!==op.seq+1||row.seq>MAX_RENDER_FRAMES||!Number.isInteger(row.samples)||row.samples<1||row.samples>MAX_FRAME_BYTES/2||typeof row.data!=='string'||row.data.length>10924||!/^([A-Za-z0-9+/]{4})*([A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(row.data)||op.samples+row.samples>MAX_RENDER_SAMPLES)throw failure();
      const bytes=Buffer.from(row.data,'base64');
      if(bytes.length!==row.samples*2||bytes.toString('base64')!==row.data){bytes.fill(0);throw failure();}
      op.seq=row.seq;op.samples+=row.samples;op.pcm.push(bytes);op.hash.update(bytes);return;
    }
    if(row.event==='render-end'){
      if(op.requireClean&&row.cleaned!==true)throw failure();
      if(op.kind!=='render'||!op.renderStarted||!op.seq||row.frames!==op.seq||row.samples!==op.samples||op.samples<6400||typeof row.sha256!=='string'||!/^[a-f0-9]{64}$/.test(row.sha256)||row.sha256!==op.hash.digest('hex'))throw failure();
      const wav=Buffer.concat([wavHeader(op.samples),...op.pcm],44+op.samples*2);
      if(!wav.subarray(44).some(value=>value!==0)){wav.fill(0);throw failure();}
      this.record('render-complete',row.id,{samples:op.samples,sampleRate:32000});
      op.resolve({wav,sampleRate:32000,channels:1,bits:16,frames:op.samples,durationSeconds:op.samples/32000,...(op.requireClean?{cleaned:true}:{})});return;
    }
    if(row.event==='error'){const allowed=['voice_assets','voice_output','voice_limit','voice_locale'];this.destroy(failure(allowed.includes(row.code)?row.code:'voice_unavailable'));return;}
    if(row.event==='warm'){if(op.kind!=='warmup')throw failure();this.record('model-ready',row.id);op.resolve({event:'warm'});return;}
    if(row.event==='synthesis-start'){
      if(op.kind!=='speak'||!Number.isInteger(row.segment)||row.segment!==op.segment+1||!Number.isInteger(row.segments)||row.segments<1||row.segments>40||row.segment>row.segments||(op.segments&&op.segments!==row.segments)||(op.segment&&!op.pcmReady)||!Number.isInteger(row.characters)||row.characters<1||row.characters>120)throw failure();
      op.segment=row.segment;op.segments=row.segments;op.pcmReady=false;
      this.record('synthesis-start',row.id,{segment:row.segment,segments:row.segments,characters:row.characters});return;
    }
    if(row.event==='pcm-ready'){
      if(op.kind!=='speak'||!op.segment||row.segment!==op.segment||op.pcmReady||row.sampleRate!==32000||!Number.isInteger(row.samples)||row.samples<1||row.samples>1280000)throw failure();
      op.pcmReady=true;this.record('pcm-ready',row.id,{segment:row.segment,sampleRate:row.sampleRate,samples:row.samples});return;
    }
    if(row.event==='playback-start'){
      if(op.kind!=='speak'||op.playing||(op.segment&&!op.pcmReady))throw failure();op.playing=true;this.record('playback-start',row.id);this.emit('playback-start',{id:row.id});return;
    }
    if(row.event==='playback-end'){
      if(op.kind!=='speak'||!op.playing||row.cancelled!==false||(op.segment&&(!op.pcmReady||op.segment!==op.segments)))throw failure();this.record('playback-end',row.id);this.emit('playback-end',{id:row.id,cancelled:false});op.resolve({event:'playback-end',id:row.id,cancelled:false});return;
    }
    throw failure();
  }
  async capabilities(){await this.start();return structuredClone(this.capability);}
  async request(kind,data={},signal,generation=this.generation){
    if(this.renderOnly){
      if(kind!=='render'||!data||Object.keys(data).some(key=>!['text','clean'].includes(key)))throw failure();
      if(!renderText(data.text))throw failure('voice_limit');
      data={text:data.text,clean:true};
    }
    await this.start({signal,generation});if(this.closed||signal?.aborted||generation!==this.generation)throw interrupted();
    const id=randomUUID();return new Promise((resolve,reject)=>{
      let timer;
      const finish=(error,value)=>{if(!this.pending.has(id))return;const op=this.pending.get(id);for(const buffer of op.pcm||[])buffer.fill(0);if(op.pcm)op.pcm.length=0;this.pending.delete(id);clearTimeout(timer);signal?.removeEventListener('abort',cancel);if(this.speakOperation===id)this.speakOperation=null;error?reject(error):resolve(value);};
      const cancel=()=>{if(this.pending.has(id))this.destroy(interrupted());};
      this.pending.set(id,{kind,requireClean:kind==='render'&&data.clean===true,playing:false,segment:0,segments:0,pcmReady:false,renderStarted:false,seq:0,samples:0,pcm:[],hash:kind==='render'?createHash('sha256'):null,resolve:value=>finish(null,value),reject:error=>finish(error)});if(kind==='speak'||kind==='render')this.speakOperation=id;
      timer=setTimeout(()=>this.destroy(failure('voice_timeout')),kind==='speak'?240000:90000);timer.unref?.();signal?.addEventListener('abort',cancel,{once:true});
      if(signal?.aborted){cancel();return;}
      try{if(kind==='speak')this.record('synthesis-request',id);this.child.stdin.write(JSON.stringify({id,op:kind,...data})+'\n');}catch{this.destroy(failure());}
    });
  }
  warmup({signal}={}){
    if(this.renderOnly)return Promise.reject(failure());
    if(this.closed)return Promise.reject(failure('voice_closed'));
    if(signal?.aborted)return Promise.reject(interrupted());
    const generation=this.generation;
    const cancel=()=>{if(generation===this.generation)this.destroy(interrupted());};signal?.addEventListener('abort',cancel,{once:true});
    if(!this.warmPromise){const promise=this.request('warmup',{},signal).finally(()=>{if(this.warmPromise===promise)this.warmPromise=null;});this.warmPromise=promise;}
    return this.warmPromise.finally(()=>signal?.removeEventListener('abort',cancel));
  }
  async speak(text,{locale='zh-CN',voice:voiceName='',signal}={}){
    if(this.renderOnly)throw failure();
    if(typeof text!=='string'||!text.trim()||text.length>2000)throw failure('voice_limit');
    if(locale!=='zh-CN'||(voiceName&&voiceName!==voice().name))throw failure('voice_locale');
    if(this.closed)throw failure('voice_closed');
    const generation=++this.generation;
    if(this.speakOperation||this.pending.size||this.starting)this.destroy(interrupted());
    const cancel=()=>{if(generation===this.generation)this.destroy(interrupted());};signal?.addEventListener('abort',cancel,{once:true});
    try{
      if(signal?.aborted)throw interrupted();await this.start({signal,generation});
      if(generation!==this.generation||signal?.aborted||this.closed)throw interrupted();
      return await this.request('speak',{text},signal,generation);
    }finally{signal?.removeEventListener('abort',cancel);}
  }
  async render(text,{locale='zh-CN',voice:voiceName='',signal,clean=false}={}){
    if(typeof clean!=='boolean')throw failure('voice_limit');
    if(!renderText(text))throw failure('voice_limit');
    if(locale!=='zh-CN'||(voiceName&&voiceName!=='Serena'))throw failure('voice_locale');
    if(this.closed)throw failure('voice_closed');
    const generation=++this.generation;
    if(this.speakOperation||this.pending.size||this.starting)this.destroy(interrupted());
    const cancel=()=>{if(generation===this.generation)this.destroy(interrupted());};signal?.addEventListener('abort',cancel,{once:true});
    try{
      if(signal?.aborted)throw interrupted();await this.start({signal,generation});
      if(generation!==this.generation||signal?.aborted||this.closed)throw interrupted();
      const worker=this.renderWorker;
      const result=await this.request('render',{text,...(clean?{clean:true}:{})},signal,generation);
      if(generation!==this.generation||signal?.aborted||this.closed||this.renderOnly&&this.renderWorker!==worker){result.wav.fill(0);throw interrupted();}
      return result;
    }catch(error){await this.waitRetired();throw error;}
    finally{signal?.removeEventListener('abort',cancel);}
  }
  async stopKind(kind){if(!['speak','render'].includes(kind)||this.renderOnly&&kind!=='render')return;this.generation++;if(this.speakOperation||this.starting||this.pending.size)this.destroy(interrupted());await this.waitRetired();}
  async interrupt(){this.generation++;if(this.speakOperation||this.starting||this.pending.size)this.destroy(interrupted());await this.waitRetired();return {event:'interrupted'};}
  async close(){this.closed=true;this.generation++;this.destroy(interrupted());await this.waitRetired({retry:true});}
}
module.exports={GptSovitsSpeech};
