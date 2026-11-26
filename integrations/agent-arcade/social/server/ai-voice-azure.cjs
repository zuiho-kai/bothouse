'use strict';

const {validateAiVoice,MAX_AI_CHARS,MAX_AI_PCM_BYTES}=require('./voice-upload.cjs');
const voices=[
  {id:'azure-xiaoxiao',label:'晓晓 · 普通话（Azure 神经语音）',name:'zh-CN-XiaoxiaoNeural'},
  {id:'azure-xiaoyi',label:'晓伊 · 普通话（Azure 神经语音）',name:'zh-CN-XiaoyiNeural'},
  {id:'azure-yunxi',label:'云希 · 普通话（Azure 神经语音）',name:'zh-CN-YunxiNeural'},
];
const entities={'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'};
const maxBytes=MAX_AI_PCM_BYTES;
const tooLong=()=>Object.assign(Error('Azure Speech output exceeds the duration limit'),{code:'speech_too_long'});

function wrapPcm(pcm){
  if(pcm.length<6400||pcm.length%2||!pcm.some(byte=>byte!==0))throw Error('Azure Speech returned empty or invalid PCM');
  const wav=Buffer.alloc(44+pcm.length);
  wav.write('RIFF',0);wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);
  wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);
  wav.writeUInt32LE(16000,24);wav.writeUInt32LE(32000,28);
  wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);
  wav.write('data',36);wav.writeUInt32LE(pcm.length,40);
  pcm.copy(wav,44);
  validateAiVoice(wav);
  return wav;
}

function createAzureVoice(region,key,{fetchImpl=globalThis.fetch}={}){
  if(!region&&!key)return;
  if(!/^[a-z][a-z0-9]{1,30}$/u.test(region||'')||!key)throw Error('Azure Speech region and key are required');
  const endpoint='https://'+region+'.tts.speech.microsoft.com/cognitiveservices/v1';
  let active=false;
  return {
    voices:voices.map(({id,label})=>({id,label,remote:true})),
    async render(line,id,signal){
      const voice=voices.find(voice=>voice.id===id);
      if(!voice||!line.trim()||[...line].length>MAX_AI_CHARS||/[\p{Cc}\p{Cf}]/u.test(line.replace(/[\r\n]/gu,''))||active)
        throw Error('Speech unavailable');
      active=true;
      const deadline=AbortSignal.timeout(15000);
      const stop=signal?AbortSignal.any([signal,deadline]):deadline;
      const text=line.replace(/[&<>"']/g,c=>entities[c]);
      try{
        const response=await fetchImpl(endpoint,{
          method:'POST',redirect:'error',signal:stop,
          headers:{'Ocp-Apim-Subscription-Key':key,'Content-Type':'application/ssml+xml',
            'X-Microsoft-OutputFormat':'raw-16khz-16bit-mono-pcm','User-Agent':'AgentArcadeSocial'},
          body:`<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="zh-CN"><voice name="${voice.name}">${text}</voice></speak>`,
        });
        const mime=response.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
        if(!response.ok||!response.body||!(mime?.startsWith('audio/')||mime==='application/octet-stream')){
          await response.body?.cancel();
          throw Error('Azure Speech did not return audio');
        }
        if(Number(response.headers.get('content-length'))>maxBytes){
          await response.body.cancel();
          throw tooLong();
        }
        const chunks=[];
        let size=0;
        for await(const chunk of response.body){
          size+=chunk.length;
          if(size>maxBytes)throw tooLong();
          chunks.push(chunk);
        }
        stop.throwIfAborted();
        return wrapPcm(Buffer.concat(chunks,size));
      }finally{active=false;}
    },
  };
}

module.exports={createAzureVoice};
