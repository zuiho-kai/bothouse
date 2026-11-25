'use strict';
// Main-only bounded PCM inference. No disk audio or audio-device access. Each
// cancellation names the original job; stale account cleanup cannot kill a new one.
const fs=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process');
const {InboundVoiceError}=require('../bot/qq-inbound-voice.cjs');
const fail=code=>new InboundVoiceError(code);
const job=value=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
class QwenFileAsr{
  constructor({pythonPath,modelPath,spawnProcess=spawn,timeoutMs=120000,exitTimeoutMs=5000}={}){
    if(![pythonPath,modelPath].every(x=>typeof x==='string'&&path.isAbsolute(x)&&!/^[/\\]{2}/.test(x)&&!x.includes('\0'))||!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>180000||!Number.isInteger(exitTimeoutMs)||exitTimeoutMs<1||exitTimeoutMs>5000)throw fail('invalid_config');
    Object.assign(this,{pythonPath,modelPath,spawnProcess,timeoutMs,exitTimeoutMs});this.operation=null;
  }
  get busy(){return !!this.operation;}
  transcribe(audio,{jobId,signal,locale='zh-CN'}={}){
    if(!job(jobId)||(signal!=null&&(typeof signal.aborted!=='boolean'||typeof signal.addEventListener!=='function'||typeof signal.removeEventListener!=='function')))return Promise.reject(fail('invalid_config'));
    if(this.operation)return Promise.reject(fail('busy'));if(signal?.aborted)return Promise.reject(fail('cancelled'));
    const pcm=audio?.pcm,sampleRate=audio?.sampleRate;
    if(!Buffer.isBuffer(pcm)||![16000,24000,32000,44100,48000].includes(sampleRate)||pcm.length%2||pcm.length<sampleRate*2*.2||pcm.length>sampleRate*2*30||!['zh-CN','en-US'].includes(locale))return Promise.reject(fail('voice_format'));
    let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});
    const op={id:jobId,child:null,result:null,error:null,exited:false,exitWaiters:[],buffer:'',bytes:0,resolve,reject};this.operation=op;
    const wipe=()=>{op.buffer='';op.result=null;};
    const finish=()=>{
      if(op.settled)return;op.settled=true;clearTimeout(op.timer);clearTimeout(op.exitTimer);signal?.removeEventListener('abort',cancel);
      if(op.exited&&this.operation===op)this.operation=null;
      const text=op.result;wipe();if(op.error)reject(op.error);else if(signal?.aborted)reject(fail('cancelled'));else if(typeof text!=='string')reject(fail('asr_failed'));else resolve(text);
    };
    const stop=code=>{
      op.error ||= fail(code);wipe();if(op.exited){finish();return;}
      try{op.child?.kill();}catch{}
      if(op.exited)return;
      if(!op.exitTimer)op.exitTimer=setTimeout(()=>{op.error=fail('asr_exit_unconfirmed');finish();for(const waiter of op.exitWaiters.splice(0))waiter.reject(op.error);},this.exitTimeoutMs);
    };
    op.stop=stop;
    const cancel=()=>stop('cancelled');signal?.addEventListener('abort',cancel,{once:true});
    try{
      if(signal?.aborted){op.exited=true;stop('cancelled');return promise;}
      const source=fs.readFileSync(path.join(__dirname,'qwen-file-worker.py'),'utf8');if(source.length>12000)throw fail('asr_unavailable');
      op.child=this.spawnProcess(this.pythonPath,['-u','-c',source,this.modelPath],{windowsHide:true,stdio:['pipe','pipe','pipe'],env:{...process.env,PYTHONUTF8:'1',HF_HUB_OFFLINE:'1',TRANSFORMERS_OFFLINE:'1',HF_HUB_DISABLE_TELEMETRY:'1',DO_NOT_TRACK:'1'}});
      op.timer=setTimeout(()=>stop('timeout'),this.timeoutMs);
      op.child.stdout.setEncoding('utf8');op.child.stdout.on('data',chunk=>{
        if(op.exited||op.settled||op.error)return;
        try{
          op.bytes+=Buffer.byteLength(chunk);if(op.bytes>16384)throw fail('invalid_response');op.buffer+=chunk;
          let index;while((index=op.buffer.indexOf('\n'))!==-1){const line=op.buffer.slice(0,index);op.buffer=op.buffer.slice(index+1);const row=JSON.parse(line);
            if(op.result!==null||row.id!==op.id)throw fail('invalid_response');
            if(row.event==='error'){stop(row.code);return;}
            if(row.event!=='transcript'||typeof row.text!=='string'||row.text.length>2000)throw fail('invalid_response');op.result=row.text;
          }
        }catch{stop('invalid_response');}
      });
      // Third-party model logs must not enter receipts or the UI.
      op.child.stderr.on('data',()=>{});op.child.stdin.on('error',()=>stop('asr_failed'));
      op.child.once('error',()=>{if(!op.child.pid){op.exited=true;op.error=fail('asr_unavailable');for(const waiter of op.exitWaiters.splice(0))waiter.resolve();finish();}else stop('asr_failed');});
      op.child.once('close',(code)=>{
        op.exited=true;clearTimeout(op.exitTimer);if(op.buffer.trim()||code!==0)op.error ||= fail('asr_failed');
        for(const waiter of op.exitWaiters.splice(0))waiter.resolve();finish();if(this.operation===op)this.operation=null;
      });
      op.child.stdin.end(JSON.stringify({id:op.id,pcm:pcm.toString('base64'),sampleRate,locale})+'\n');
    }catch{op.exited=!op.child;stop('asr_unavailable');}
    return promise;
  }
  async cancel({jobId}={}){
    if(!job(jobId))throw fail('invalid_config');
    const op=this.operation;if(!op)return {cancelled:true};if(op.id!==jobId)throw fail('wrong_scope');
    op.stop('cancelled');if(op.exited)return {cancelled:true};
    await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{const i=op.exitWaiters.indexOf(waiter);if(i>=0)op.exitWaiters.splice(i,1);reject(fail('asr_exit_unconfirmed'));},this.exitTimeoutMs);
      const waiter={resolve:()=>{clearTimeout(timer);resolve();},reject:error=>{clearTimeout(timer);reject(error);}};op.exitWaiters.push(waiter);
      if(op.exited)waiter.resolve();
    });return {cancelled:true};
  }
}
module.exports={QwenFileAsr};
