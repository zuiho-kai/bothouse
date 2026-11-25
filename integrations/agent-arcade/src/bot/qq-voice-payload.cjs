'use strict';
// Original bounded PCM16 WAV preparation. No processes, network or audio devices.
// Input bytes must come from a main-process picker or a bounded owned TTS job.
const MAX_BYTES=4*1024*1024,MAX_SECONDS=30,MIN_SECONDS=0.2;
const RATES=new Set([16000,24000,32000,44100,48000]);
const CODES=new Set(['invalid_request','invalid_owner','voice_too_large','voice_invalid','voice_format','voice_duration','voice_not_canonical','unsafe_file','file_changed','file_unavailable','media_unavailable','stale_ticket','expired_ticket','changed','disconnected','account_mismatch','account_changed','account_offline','status_unverified','bridge_unhealthy','group_unavailable','cancelled','operation_in_progress','closed','send_unknown','voice_failed']);
class QQVoiceError extends Error{constructor(code){const fixed=CODES.has(code)?code:'voice_failed';super(`QQ voice operation failed (${fixed}).`);this.code=fixed;this.name=fixed==='cancelled'?'AbortError':'QQVoiceError';}}
const fail=code=>{throw new QQVoiceError(code);};
function canonicalWav(bytes){
  if(!Buffer.isBuffer(bytes)||bytes.length>MAX_BYTES)fail('voice_too_large');
  if(bytes.length<44||bytes.toString('ascii',0,4)!=='RIFF'||bytes.toString('ascii',8,12)!=='WAVE'||bytes.readUInt32LE(4)!==bytes.length-8)fail('voice_invalid');
  let offset=12,format=null,pcm=null,chunks=0;
  while(offset<bytes.length){
    if(++chunks>64||offset+8>bytes.length)fail('voice_invalid');
    const kind=bytes.toString('ascii',offset,offset+4),size=bytes.readUInt32LE(offset+4),start=offset+8,end=start+size,padded=end+(size%2);
    if(!/^[\x20-\x7e]{4}$/.test(kind)||end>bytes.length||padded>bytes.length)fail('voice_invalid');
    if(kind==='fmt '){
      if(format||pcm||size!==16)fail('voice_format');
      const tag=bytes.readUInt16LE(start),channels=bytes.readUInt16LE(start+2),sampleRate=bytes.readUInt32LE(start+4),byteRate=bytes.readUInt32LE(start+8),align=bytes.readUInt16LE(start+12),bits=bytes.readUInt16LE(start+14);
      if(tag!==1||channels!==1||bits!==16||align!==2||!RATES.has(sampleRate)||byteRate!==sampleRate*2)fail('voice_format');
      format={sampleRate,channels,bits};
    }else if(kind==='data'){
      if(!format||pcm||size%2)fail('voice_invalid');pcm=bytes.subarray(start,end);
    }
    // Other bounded chunks are deliberately not retained (LIST/ID3/JUNK/etc).
    offset=padded;
  }
  if(!format||!pcm||offset!==bytes.length)fail('voice_invalid');
  const frames=pcm.length/2,durationSeconds=frames/format.sampleRate;
  if(durationSeconds<MIN_SECONDS||durationSeconds>MAX_SECONDS)fail('voice_duration');
  const output=Buffer.alloc(44+pcm.length);output.write('RIFF');output.writeUInt32LE(output.length-8,4);output.write('WAVEfmt ',8);output.writeUInt32LE(16,16);output.writeUInt16LE(1,20);output.writeUInt16LE(1,22);output.writeUInt32LE(format.sampleRate,24);output.writeUInt32LE(format.sampleRate*2,28);output.writeUInt16LE(2,32);output.writeUInt16LE(16,34);output.write('data',36);output.writeUInt32LE(pcm.length,40);pcm.copy(output,44);
  return {bytes:output,sampleRate:format.sampleRate,channels:1,bits:16,frames,durationSeconds,metadataStripped:true};
}
function canonicalAudibleWav(bytes){
  const checked=canonicalWav(bytes);
  if(!checked.bytes.subarray(44).some(byte=>byte!==0)){
    checked.bytes.fill(0);
    fail('voice_invalid');
  }
  return checked;
}
function recordMessage(canonicalBytes){
  const checked=canonicalWav(canonicalBytes);
  try{
    if(!checked.bytes.equals(canonicalBytes))fail('voice_not_canonical');
    return [{type:'record',data:{file:`base64://${checked.bytes.toString('base64')}`}}];
  }finally{checked.bytes.fill(0);}
}
function ownerRecordParams(ownerId,canonicalBytes){
  if(typeof ownerId!=='string'||!/^[1-9]\d{4,14}$/.test(ownerId)||!Number.isSafeInteger(Number(ownerId)))fail('invalid_owner');
  return {user_id:ownerId,message:recordMessage(canonicalBytes)};
}
function groupRecordParams(groupId,canonicalBytes){
  if(typeof groupId!=='string'||!/^[1-9]\d{4,14}$/.test(groupId)||!Number.isSafeInteger(Number(groupId)))fail('group_unavailable');
  return {group_id:Number(groupId),message:recordMessage(canonicalBytes)};
}
module.exports={canonicalWav,canonicalAudibleWav,ownerRecordParams,groupRecordParams,QQVoiceError,MAX_BYTES,MAX_SECONDS};
