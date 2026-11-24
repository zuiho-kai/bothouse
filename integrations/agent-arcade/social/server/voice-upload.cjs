'use strict';

const {fail}=require('./store.cjs');
const {readAttachment}=require('./image-upload.cjs');
const SAMPLE_RATE=16_000;
const MAX_BYTES=44+2*SAMPLE_RATE*30;
const MAX_AI_SECONDS=120;
const MAX_AI_CHARS=600;
const MAX_AI_PCM_BYTES=2*SAMPLE_RATE*MAX_AI_SECONDS;

function validate(bytes,maxBytes){
  // Both sources use a fixed-layout PCM WAV for the same player.
  if(bytes.length<44||bytes.length>maxBytes||bytes.length%2||
     bytes.toString('ascii',0,4)!=='RIFF'||bytes.readUInt32LE(4)!==bytes.length-8||
     bytes.toString('ascii',8,16)!=='WAVEfmt '||bytes.readUInt32LE(16)!==16||
     bytes.readUInt16LE(20)!==1||bytes.readUInt16LE(22)!==1||bytes.readUInt32LE(24)!==SAMPLE_RATE||
     bytes.readUInt32LE(28)!==SAMPLE_RATE*2||bytes.readUInt16LE(32)!==2||bytes.readUInt16LE(34)!==16||
     bytes.toString('ascii',36,40)!=='data'||bytes.readUInt32LE(40)!==bytes.length-44)
    fail(422,'voice_invalid','语音格式不符，请重新录制');
  const durationMs=Math.floor((bytes.length-44)*1000/(SAMPLE_RATE*2));
  if(durationMs<200)fail(422,'voice_duration','语音太短，请重新录制');
  return {durationMs};
}
const validateVoice=bytes=>validate(bytes,MAX_BYTES);
const validateAiVoice=bytes=>validate(bytes,44+MAX_AI_PCM_BYTES);

function readVoiceUpload(req){
  return readAttachment(req,{formats:['audio/wav'],maxBytes:MAX_BYTES,kind:'voice',
    formatError:'请用聊天里的录音按钮录制语音',sizeError:'语音最长 30 秒',validate:validateVoice});
}
module.exports={readVoiceUpload,validateVoice,validateAiVoice,MAX_AI_SECONDS,MAX_AI_CHARS,MAX_AI_PCM_BYTES};
