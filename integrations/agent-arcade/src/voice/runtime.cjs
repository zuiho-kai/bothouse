'use strict';
const fs=require('node:fs');
const path=require('node:path');
const {WindowsSpeech}=require('./windows-speech.cjs');
const {QwenAsr,QwenSpeech}=require('./qwen-asr.cjs');

const BACKENDS=['windows','local-neural'];
const renderUnavailable=()=>Object.assign(Error('Local voice rendering is not configured.'),{code:'voice_render_unavailable'});
function readRenderRuntime(root){
  try{
    const file=path.join(root,'local-voice.json');
    if(fs.statSync(file).size>8192)throw Error();
    const value=JSON.parse(fs.readFileSync(file,'utf8'));
    if(value.version!==1)throw Error();
    const paths=['ttsPython','ttsRepository','referenceAudio'];
    if(paths.some(key=>typeof value[key]!=='string'||!path.isAbsolute(value[key])||/^[\\/]{2}/.test(value[key])||value[key].includes('\0')))throw Error();
    for(const key of paths){const stat=fs.statSync(value[key]);if(key==='ttsRepository'?!stat.isDirectory():!stat.isFile())throw Error();}
    return Object.fromEntries(paths.map(key=>[key,value[key]]));
  }catch{throw renderUnavailable();}
}
function voiceRenderRevision({root}={}){
  try{
    const local=readRenderRuntime(root),base=path.join(local.ttsRepository,'GPT_SoVITS');
    const files=[path.join(root,'local-voice.json'),local.ttsPython,local.referenceAudio,path.join(base,'TTS_infer_pack/TTS.py'),...['s1v3.ckpt','v2Pro/s2Gv2ProPlus.pth','sv/pretrained_eres2netv2w24s4ep4.ckpt','chinese-hubert-base/pytorch_model.bin','chinese-roberta-wwm-ext-large/pytorch_model.bin'].map(p=>path.join(base,'pretrained_models',p)),path.join(base,'text/G2PWModel/g2pW.onnx')];
    const stamps=files.map(file=>{const s=fs.statSync(file);if(!s.isFile())throw Error();return [file,s.dev,s.ino,s.size,s.mtimeMs,s.ctimeMs];});
    // Coherence for reuse, not a substitute for the worker's fixed asset hashes.
    return require('node:crypto').createHash('sha256').update(JSON.stringify([local,stamps])).digest('hex');
  }catch{throw renderUnavailable();}
}
function voiceRenderAvailability({root,platform=hostPlatform()}={}){
  // This is a synchronous configuration check, not a model/device readiness
  // claim. Rendering does not depend on ASR or start a worker during discovery.
  try{
    if(platform==='darwin')voiceRenderRevision({root});
    else readRenderRuntime(root);
    return {available:true};
  }
  catch{return {available:false,reason:'voice_render_unavailable'};}
}
function createVoiceRenderRuntime({root,platform=hostPlatform()}={}){
  try{
    const local=readRenderRuntime(root);
    const {GptSovitsSpeech}=require('./gpt-sovits.cjs');
    return new GptSovitsSpeech({
      pythonPath:local.ttsPython,repoPath:local.ttsRepository,referencePath:local.referenceAudio,
      ...(platform==='darwin'?{renderOnly:true}:{}),
    });
  }catch{throw renderUnavailable();}
}
function readRuntime(root){
  const file=path.join(root,'local-voice.json');
  if(!fs.existsSync(file))return null;
  try{
    if(fs.statSync(file).size>8192)throw Error();
    const value=JSON.parse(fs.readFileSync(file,'utf8'));
    if(value.version!==1)throw Error();
    const paths=['asrPython','asrModel','ttsPython','ttsRepository','referenceAudio'];
    if(paths.some(key=>typeof value[key]!=='string'||!path.isAbsolute(value[key])||/^[\\/]{2}/.test(value[key])||value[key].includes('\0')))throw Error();
    for(const key of paths){const stat=fs.statSync(value[key]);if(['asrModel','ttsRepository'].includes(key)?!stat.isDirectory():!stat.isFile())throw Error();}
    return Object.fromEntries(paths.map(key=>[key,value[key]]));
  }catch{throw Error('本机神经语音的安装配置不完整。请检查 local-voice.json，或选择 Windows 语音。');}
}
// Windows speech drives the System.Speech host through PowerShell. On another
// platform it is reported as unavailable before anything is constructed.
const WINDOWS_SPEECH_UNAVAILABLE='Windows speech is only available on Windows. This platform has no system speech backend yet.';
// Read lazily and without assuming a `process` global, so an isolated loader
// that supplies none keeps the original (Windows) behaviour.
const hostPlatform=()=>typeof process==='object'&&process!==null&&typeof process.platform==='string'?process.platform:'win32';
function voiceBackendAvailability({platform=hostPlatform()}={}){
  return {windows:platform==='win32'?{available:true}:{available:false,reason:'voice_platform',message:WINDOWS_SPEECH_UNAVAILABLE}};
}
function createVoiceRuntime({root,characterId,backend,acquireAsrLease,platform=hostPlatform()}={}){
  if(backend!==undefined&&!BACKENDS.includes(backend))throw Error('Choose an available speech provider.');
  // An explicitly chosen Windows fallback must remain usable even when the
  // optional neural installation has been moved or is incomplete.
  const local=backend==='windows'?null:readRuntime(root);
  const selected=backend||(local&&characterId==='claude-ju'?'local-neural':'windows');
  if(selected==='windows'){
    if(platform!=='win32')throw Object.assign(Error(WINDOWS_SPEECH_UNAVAILABLE),{code:'voice_platform'});
    return {backend:selected,speech:new WindowsSpeech()};
  }
  if(!local)throw Error('本机神经语音尚未安装。请选择 Windows 语音，或完成本地模型安装。');
  const {GptSovitsSpeech}=require('./gpt-sovits.cjs');
  const lease=acquireAsrLease?.();let speech;
  try{speech=new QwenSpeech({
    asr:new QwenAsr({pythonPath:local.asrPython,modelPath:local.asrModel}),
    playback:new GptSovitsSpeech({pythonPath:local.ttsPython,repoPath:local.ttsRepository,referencePath:local.referenceAudio}),
  });}catch(error){lease?.release();throw error;}
  if(lease){
    const close=speech.close.bind(speech);
    // Provider close must confirm its exact ASR host exited. Keep the lease
    // after an uncertain exit; an abort or child.kill() alone is insufficient.
    speech.close=async()=>{try{await close();lease.release();}catch(error){lease.retainRecovery?.(()=>speech.close());throw error;}};
  }
  return {backend:selected,speech};
}
async function voiceCapabilities({root,characterId,backend,acquireAsrLease,closeRuntime,platform=hostPlatform()}={}){
  const runtime=createVoiceRuntime({root,characterId,backend,acquireAsrLease,platform});
  try{return {...await runtime.speech.capabilities(),selectedBackend:runtime.backend,
    backends:[{id:'local-neural',name:'Qwen 识别 · 温柔女声'},...(platform==='win32'?[{id:'windows',name:'Windows 语音'}]:[])]};}
  finally{await (closeRuntime?closeRuntime(runtime.speech):runtime.speech.close());}
}
module.exports={voiceRenderRevision,readRuntime,createVoiceRuntime,voiceCapabilities,voiceRenderAvailability,createVoiceRenderRuntime,voiceBackendAvailability};
