'use strict';
// Bounded Tencent SILK v3 to local mono PCM. The bridge bytes have already
// been verified against an observed group message and its exact media identity.
const {decode}=require('silk-wasm');
const HEADER=Buffer.from('#!SILK_V3','ascii');
const SAMPLE_RATE=16000,MAX_BYTES=512*1024,MAX_PACKETS=1500,MAX_PACKET_BYTES=1250;
const formatError=code=>Object.assign(Error('The group voice codec rejected the recording.'),{code});

function checkSilk(bytes){
 if(!Buffer.isBuffer(bytes)||bytes.length>MAX_BYTES||bytes.length<=HEADER.length+2)throw formatError('voice_format');
 const start=bytes[0]===2?1:0;
 if(!bytes.subarray(start,start+HEADER.length).equals(HEADER))throw formatError('voice_format');
 let offset=start+HEADER.length,packets=0;
 while(offset+2<=bytes.length){
  const size=bytes.readUInt16LE(offset);
  offset+=2;
  if(size===0xffff&&offset===bytes.length)break;
  if(!size||size>MAX_PACKET_BYTES||offset+size>bytes.length)throw formatError('voice_format');
  if(++packets>MAX_PACKETS)throw formatError('duration_limit');
  offset+=size;
 }
 if(!packets||offset!==bytes.length)throw formatError('voice_format');
}

async function decodeGroupSilk(bytes,{signal}={}){
 if(signal?.aborted)throw formatError('cancelled');
 checkSilk(bytes);
 let output;
 try{
  try{output=(await decode(bytes,SAMPLE_RATE)).data;}
  catch{throw formatError('voice_format');}
  if(signal?.aborted)throw formatError('cancelled');
  if(!(output instanceof Uint8Array)||output.length%2)throw formatError('voice_format');
  const durationSeconds=output.length/(2*SAMPLE_RATE);
  if(durationSeconds<.2||durationSeconds>30)throw formatError('duration_limit');
  return {pcm:Buffer.from(output),sampleRate:SAMPLE_RATE,durationSeconds};
 }finally{output?.fill(0);}
}

module.exports={decodeGroupSilk};
