'use strict';
// A single resource owned by the app's ASR gate; no pool,
// microphone, account lookup, implicit restart, or worker reuse after failure.
const fs=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process'),{randomUUID}=require('node:crypto');
const VERSION=1,MAX_JOBS=128,MAX_OUTPUT=16384;
const UUID=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const CODES=new Set(['invalid_config','voice_format','duration_limit','transcript_invalid','invalid_response','busy','wrong_scope','cancelled','timeout','asr_unavailable','asr_failed','asr_exit_unconfirmed']);
const failure=code=>Object.assign(new Error(`Local file recognition failed (${CODES.has(code)?code:'asr_failed'}).`),{code:CODES.has(code)?code:'asr_failed'});
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});promise.catch(()=>{});return {promise,resolve,reject};};
const local=value=>typeof value==='string'&&path.isAbsolute(value)&&!/^[/\\]{2}/.test(value)&&!/[\0\r\n]/.test(value);
const signalLike=value=>value==null||(typeof value.aborted==='boolean'&&typeof value.addEventListener==='function'&&typeof value.removeEventListener==='function');
const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&keys.every(k=>Object.hasOwn(value,k));
const isMac=process.platform==='darwin';
function createProcessProof(options){
  if(isMac)return new (require('./posix-python-process-proof.cjs').PosixPythonProcessProof)(options);
  return new (require('./python-process-proof.cjs').PythonProcessProof)(options);
}
function workerEnvironment(){
  const env=isMac?Object.fromEntries(['HOME','PATH','TMPDIR','LANG','LC_ALL','LC_CTYPE'].filter(key=>process.env[key]!==undefined).map(key=>[key,process.env[key]])):process.env;
  return {...env,PYTHONUTF8:'1',HF_HUB_OFFLINE:'1',TRANSFORMERS_OFFLINE:'1',HF_HUB_DISABLE_TELEMETRY:'1',DO_NOT_TRACK:'1',...(isMac?{PYTHONNOUSERSITE:'1'}:{})};
}
class QwenWarmFileAsr{
  constructor({pythonPath,modelPath,spawnProcess=spawn,proofFactory=createProcessProof,onVerification=()=>{},timeoutMs=120000}={}){
    if(!local(pythonPath)||!local(modelPath)||typeof spawnProcess!=='function'||typeof proofFactory!=='function'||typeof onVerification!=='function'||!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>180000)throw failure('invalid_config');
    Object.assign(this,{pythonPath,modelPath,spawnProcess,proofFactory,onVerification,timeoutMs});
    this.child=null;this.proof=null;this.bound=false;this.job=null;this.lastJobId=null;this.closed=false;this.closing=false;this.closePromise=null;this.proving=null;this.ready=null;this.readySeen=false;this.buffer='';this.outputBytes=0;this.seen=new Set();this.nonce=randomUUID();this.failure=null;
  }
  get busy(){return !!this.job||this.closing&&!this.closed;}
  _current(op){if(this.closed||this.closing||this.job!==op)throw failure(this.failure?.code||'cancelled');if(op.signal?.aborted)throw failure('cancelled');if(this.failure)throw this.failure;}
  _reject(code){
    if(!this.failure){
      this.failure=failure(code);
      if(isMac&&this.failure.code!=='cancelled')this.onVerification(false);
    }
    this.buffer='';if(this.job){this.job.text=null;this.job.reply.reject(this.failure);}this.ready?.reject(this.failure);
  }
  _fault(code){
    if(this.closed)return;this._reject(code);
    // Event-driven failures must close idle hosts too. The promise remains
    // reachable for the gate's close/recovery path; no replacement is spawned.
    this._shutdown().catch(()=>{});
  }
  _row(row){
    if(row?.version!==VERSION||row.nonce!==this.nonce)throw failure('invalid_response');
    if(row.event==='ready'){
      if(this.readySeen||!exact(row,['version','nonce','event','pid','parentPid','modelLoaded'])||!Number.isSafeInteger(row.pid)||row.pid<1||!Number.isSafeInteger(row.parentPid)||row.parentPid<1||row.modelLoaded!==false)throw failure('invalid_response');
      this.readySeen=true;
      this.proving=Promise.resolve().then(()=>this.proof.proveReady({pid:row.pid,parentPid:row.parentPid})).then(value=>{
        if(this.closing||this.closed||this.failure)throw failure(this.failure?.code||'cancelled');
        if(value?.verified!==true)throw failure('asr_exit_unconfirmed');this.ready.resolve();
      }).catch(error=>{this._fault(error?.code==='asr_exit_unconfirmed'?'asr_exit_unconfirmed':'asr_failed');});return;
    }
    const op=this.job;if(!op||op.phase!=='sent'||row.id!==op.id)throw failure('invalid_response');
    if(row.event==='error'){
      if(!exact(row,['version','nonce','event','id','code'])||!CODES.has(row.code))throw failure('invalid_response');this._fault(row.code);return;
    }
    if(row.event==='transcript'){
      if(!exact(row,['version','nonce','event','id','text'])||op.text!==null||typeof row.text!=='string'||row.text.length>2000||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\ud800-\udfff]/u.test(row.text))throw failure('invalid_response');op.text=row.text;return;
    }
    if(row.event!=='job-clean'||!exact(row,['version','nonce','event','id'])||op.text===null)throw failure('invalid_response');
    const text=op.text;op.text=null;op.phase='succeeded';this.outputBytes=0;
    // Abort/failure in the same data delivery turn must win over returned text.
    queueMicrotask(()=>{try{this._current(op);if(this.buffer.length)throw failure('invalid_response');op.reply.resolve(text);}catch(error){this._fault(error.code);op.reply.reject(error);}});
  }
  _data(chunk){
    if(this.closing||this.closed)return;
    try{if(typeof chunk!=='string'||(this.outputBytes+=Buffer.byteLength(chunk))>MAX_OUTPUT)throw failure('invalid_response');this.buffer+=chunk;let at;
      while((at=this.buffer.indexOf('\n'))>=0){const line=this.buffer.slice(0,at);this.buffer=this.buffer.slice(at+1);this._row(JSON.parse(line));}
      if(Buffer.byteLength(this.buffer)>MAX_OUTPUT)throw failure('invalid_response');
    }catch{this._fault('invalid_response');}
  }
  async _start(op){
    this._current(op);this.proof=this.proofFactory({pythonPath:this.pythonPath,parentPid:process.pid});
    if(!this.proof||['bind','proveReady','close'].some(name=>typeof this.proof[name]!=='function'))throw failure('asr_unavailable');
    this._current(op);const source=fs.readFileSync(path.join(__dirname,'qwen-warm-file-worker.py'),'utf8');if(source.length>16000)throw failure('asr_unavailable');
    this.ready=deferred();const startedAt=Date.now();
    this.child=this.spawnProcess(this.pythonPath,['-u','-c',source,this.modelPath,this.nonce,'--resident'],{windowsHide:true,shell:false,detached:isMac,stdio:['pipe','pipe','pipe'],env:workerEnvironment()});
    const child=this.child;child.stdout.setEncoding('utf8');child.stdout.on('data',chunk=>this._data(chunk));child.stderr.on('data',()=>{});child.stdin.on('error',()=>{if(!this.closing)this._fault('asr_failed');});
    child.once('error',()=>this._fault(child.pid?'asr_failed':'asr_unavailable'));
    child.once('close',()=>{if(!this.closing)this._fault('asr_failed');});
    if(!Number.isSafeInteger(child.pid)||child.pid<1){this.child=null;this.proof=null;throw failure('asr_unavailable');}
    this.proof.bind({pid:child.pid,startedAt,...(isMac?{child}:{})});this.bound=true;
    await this.ready.promise;this._current(op);
  }
  transcribe(audio,{jobId,signal,locale='zh-CN'}={}){
    if(typeof jobId!=='string'||!UUID.test(jobId)||!signalLike(signal)||!['zh-CN','en-US'].includes(locale))return Promise.reject(failure('invalid_config'));
    if(this.closed||this.closing)return Promise.reject(failure(this.closed?'asr_unavailable':'asr_exit_unconfirmed'));if(this.job)return Promise.reject(failure('busy'));if(this.seen.has(jobId))return Promise.reject(failure('invalid_config'));if(signal?.aborted)return Promise.reject(failure('cancelled'));
    const pcm=audio?.pcm,rate=audio?.sampleRate;if(!Buffer.isBuffer(pcm)||![16000,24000,32000,44100,48000].includes(rate)||pcm.length%2||pcm.length<rate*2*.2||pcm.length>rate*2*30)return Promise.reject(failure('voice_format'));
    const op={id:jobId,signal,reply:deferred(),phase:'starting',text:null};this.job=op;
    const cancel=()=>this._fault('cancelled');op.cancel=cancel;signal?.addEventListener('abort',cancel,{once:true});
    op.timer=setTimeout(()=>this._fault('timeout'),this.timeoutMs);
    const task=(async()=>{
      try{
        this._current(op);if(this.seen.size>=MAX_JOBS)throw failure('asr_unavailable');this.seen.add(jobId);
        if(!this.child)await this._start(op);this._current(op);op.phase='sent';
        this.child.stdin.write(JSON.stringify({version:VERSION,nonce:this.nonce,event:'transcribe',id:jobId,pcm:pcm.toString('base64'),sampleRate:rate,locale})+'\n',error=>{if(error)this._fault('asr_failed');});
        const text=await op.reply.promise;this._current(op);clearTimeout(op.timer);
        if(isMac&&text.trim())this.onVerification(true);
        return text;
      }catch(error){this._reject(error?.code);try{await this._shutdown();}catch{throw failure('asr_exit_unconfirmed');}throw failure(error?.code);}
      finally{if(op.phase!=='succeeded'||this.closed){clearTimeout(op.timer);signal?.removeEventListener('abort',cancel);op.text=null;}}
    })();op.task=task;return task;
  }
  async finish({jobId,keepWarm}={}){
    if(typeof jobId!=='string'||!UUID.test(jobId)||keepWarm!==true)throw failure('invalid_config');const op=this.job;
    if(!op||op.id!==jobId)throw failure('wrong_scope');this._current(op);if(op.phase!=='succeeded')throw failure('busy');
    clearTimeout(op.timer);op.signal?.removeEventListener('abort',op.cancel);op.text=null;this.lastJobId=op.id;this.job=null;return {parked:true};
  }
  async _shutdown(){
    if(this.closed)return {closed:true};if(this.closePromise)return this.closePromise;
    this.closing=true;this._reject(this.failure?.code||'cancelled');
    const work=(async()=>{
      if(this.proving)await this.proving.catch(()=>{});
      if(this.child&&!this.bound)throw failure('asr_exit_unconfirmed');
      if(this.bound){let value;try{value=await this.proof.close();}catch{throw failure('asr_exit_unconfirmed');}if(value?.closed!==true)throw failure('asr_exit_unconfirmed');}
      this.closed=true;const op=this.job;this.job=null;if(op){clearTimeout(op.timer);op.signal?.removeEventListener('abort',op.cancel);op.text=null;}
      this.buffer='';this.ready=null;this.lastJobId=null;this.seen.clear();
      try{this.child?.stdin.destroy();this.child?.stdout.destroy();this.child?.stderr.destroy();}catch{/* Process absence was independently confirmed. */}
      this.child=null;return {closed:true};
    })();this.closePromise=work;
    try{return await work;}finally{if(this.closePromise===work)this.closePromise=null;}
  }
  async cancel({jobId}={}){
    if(typeof jobId!=='string'||!UUID.test(jobId))throw failure('invalid_config');if(this.closed)return {cancelled:true};const current=this.job?.id||this.lastJobId;if(current&&current!==jobId)throw failure('wrong_scope');
    this._reject('cancelled');await this._shutdown();return {cancelled:true};
  }
  close(){return this._shutdown();}
}
module.exports={QwenWarmFileAsr};
