'use strict';
const fs=require('node:fs'),path=require('node:path');
const unavailable=()=>Object.assign(Error('本机 QQ 语音识别尚未配置。请先安装并配置 Qwen 识别模型。'),{code:'asr_unavailable'});
function readFileAsrRuntime(root){
  try{
    const file=path.join(root,'local-voice.json');if(fs.statSync(file).size>8192)throw Error();
    const value=JSON.parse(fs.readFileSync(file,'utf8'));if(value.version!==1)throw Error();
    for(const key of ['asrPython','asrModel']){
      const item=value[key];if(typeof item!=='string'||!path.isAbsolute(item)||/^[\\/]{2}/.test(item)||item.includes('\0'))throw Error();
      const stat=fs.statSync(item);if(key==='asrModel'?!stat.isDirectory():!stat.isFile())throw Error();
    }
    return {pythonPath:value.asrPython,modelPath:value.asrModel};
  }catch{throw unavailable();}
}
function fileAsrAvailability({root}={}){try{readFileAsrRuntime(root);return {available:true};}catch{return {available:false,reason:'asr_unavailable'};}}
function createFileAsr({root}={}){const options=readFileAsrRuntime(root);const {QwenFileAsr}=require('./qwen-file-asr.cjs');return new QwenFileAsr(options);}
module.exports={readFileAsrRuntime,fileAsrAvailability,createFileAsr};
