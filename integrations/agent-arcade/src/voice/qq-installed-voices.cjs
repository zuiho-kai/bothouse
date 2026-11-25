'use strict';
const fs=require('node:fs');
const path=require('node:path');
const {execFile}=require('node:child_process');
const {canonicalAudibleWav}=require('../bot/qq-voice-payload.cjs');

const failure=code=>Object.assign(Error(code),{code});
const windowsId=id=>typeof id==='string'&&/^win-[a-f0-9]{24}$/.test(id);
const {validLine}=require('./qq-spoken-line.cjs');
let script;

// WinRT returns standard PCM WAVEFORMATEX with a zero-length extension.
// Convert that exact header to canonical PCM before using the common validator.
function windowsWav(buffer) {
  if(buffer.length>=46 && buffer.toString('ascii',0,4)==='RIFF' && buffer.readUInt32LE(4)===buffer.length-8 &&
     buffer.toString('ascii',8,16)==='WAVEfmt ' && buffer.readUInt32LE(16)===18 &&
     buffer.readUInt16LE(20)===1 && buffer.readUInt16LE(36)===0) {
    const converted=Buffer.concat([buffer.subarray(0,36),buffer.subarray(38)]);
    converted.writeUInt32LE(converted.length-8,4);
    converted.writeUInt32LE(16,16);
    try{return canonicalAudibleWav(converted).bytes;}finally{converted.fill(0);}
  }
  return canonicalAudibleWav(buffer).bytes;
}

function run(request,signal) {
  if(process.platform!=='win32')return Promise.reject(failure('voice_render_unavailable'));
  if(!script)script=Buffer.from(fs.readFileSync(path.join(__dirname,'windows-installed-voices.ps1'),'utf8'),'utf16le').toString('base64');
  const exe=path.join(process.env.SystemRoot,'System32','WindowsPowerShell','v1.0','powershell.exe');
  return new Promise((resolve,reject)=>{
    const child=execFile(exe,['-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand',script],
      {windowsHide:true,timeout:30000,maxBuffer:6*1024*1024,signal},(err,stdout)=>{
        if(err)return reject(failure(signal?.aborted?'cancelled':'voice_render_unavailable'));
        resolve(stdout.trim());
      });
    child.stdin.on('error',()=>{});
    child.stdin.end(JSON.stringify(request),'utf8');
  });
}
async function listWindowsVoices() {
  if(process.platform!=='win32')return [];
  const rows=JSON.parse(await run({action:'list'}));
  if(!Array.isArray(rows)||rows.length>256)throw failure('voice_render_unavailable');
  return rows.filter(v=>windowsId(v?.id)&&typeof v.name==='string'&&v.name.length<=128&&
    typeof v.locale==='string'&&/^[a-zA-Z0-9-]{2,32}$/.test(v.locale))
    .sort((a,b)=>a.locale.localeCompare(b.locale)||a.name.localeCompare(b.name));
}
async function renderWindowsVoice(id,text,{signal,assertCurrent}={}) {
  if(!windowsId(id)||!validLine(text))throw failure('voice_render_limit');
  assertCurrent?.();
  const request={action:'render',id,text:text.trim()};
  for(const compact of [false,true]){
    const source=Buffer.from(await run({...request,compact},signal),'base64');
    try{
      assertCurrent?.();
      return windowsWav(source);
    }catch(error){
      // One modest speaking-rate change can fit a complete explanation into
      // the same 30-second message. Never drop or cut any part of the text.
      const seconds=source.length>=44 ? (source.length-44)/source.readUInt32LE(28) : 0;
      if(error.code!=='voice_duration'||compact||seconds<=30||seconds>41)throw error;
    }finally{source.fill(0);}
  }
}
module.exports={listWindowsVoices,renderWindowsVoice,windowsId,validLine};
