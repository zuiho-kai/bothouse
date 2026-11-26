'use strict';

const {spawn}=require('node:child_process');
const {isAbsolute,basename,dirname,join}=require('node:path');
const {accessSync,constants,existsSync}=require('node:fs');
const {mkdtemp,readFile,rm,rmdir,stat}=require('node:fs/promises');
const {tmpdir}=require('node:os');
const {validateAiVoice,MAX_AI_CHARS,MAX_AI_SECONDS}=require('./voice-upload.cjs');

const voices=Object.freeze([
  {id:'mandarin-bright',label:'离线机械音 · eSpeak f2',variant:'cmn+f2'},
  {id:'mandarin-soft',label:'离线机械音 · eSpeak f3',variant:'cmn+f3'},
]);
const OUTPUT_LIMIT=44+2*22050*MAX_AI_SECONDS;

// eSpeak writes 22.05 kHz mono PCM. The message contract uses 16 kHz.
function normalize(bytes){
  if(bytes.length<44||bytes.length%2||bytes.toString('ascii',0,4)!=='RIFF'||
     bytes.toString('ascii',8,16)!=='WAVEfmt '||bytes.readUInt32LE(16)!==16||
     bytes.readUInt16LE(20)!==1||bytes.readUInt16LE(22)!==1||bytes.readUInt32LE(24)!==22050||
     bytes.readUInt32LE(28)!==44100||bytes.readUInt16LE(32)!==2||bytes.readUInt16LE(34)!==16||
     bytes.toString('ascii',36,40)!=='data'||bytes.readUInt32LE(4)!==bytes.length-8||
     bytes.readUInt32LE(40)!==bytes.length-44)throw Error('Unexpected speech PCM');
  const frames=Math.floor((bytes.length-44)/2*16000/22050);
  const wav=Buffer.alloc(44+2*frames);
  bytes.copy(wav,0,0,44);
  wav.writeUInt32LE(wav.length-8,4);
  wav.writeUInt32LE(16000,24);
  wav.writeUInt32LE(32000,28);
  wav.writeUInt32LE(wav.length-44,40);
  // Average the source samples covered by a 16 kHz frame.
  let audible=false;
  for(let i=0;i<frames;i++){
    const start=Math.floor(i*22050/16000),end=Math.floor((i+1)*22050/16000);
    let sum=0;
    for(let j=start;j<end;j++)sum+=bytes.readInt16LE(44+2*j);
    const sample=Math.round(sum/(end-start));
    if(Math.abs(sample)>32)audible=true;
    wav.writeInt16LE(sample,44+2*i);
  }
  if(!audible)throw Error('Speech audio is silent');
  validateAiVoice(wav);
  return wav;
}

function createVoiceEngine(executable){
  if(!executable)return;
  if(!isAbsolute(executable))throw Error('SOCIAL_ESPEAK must be an absolute executable path');
  accessSync(executable,constants.X_OK);
  const directory=dirname(executable);
  const dataOption=existsSync(join(directory,'espeak-ng-data'))?['--path='+directory]:[];
  let active=0;
  return {
    voices:voices.map(({id,label})=>({id,label})),
    async render(line,id,signal){
      const voice=voices.find(voice=>voice.id===id);
      if(!voice||!line.trim()||[...line].length>MAX_AI_CHARS||active>=2)throw Error('Speech unavailable');
      const deadline=AbortSignal.timeout(5000);
      const stop=signal?AbortSignal.any([signal,deadline]):deadline;
      stop.throwIfAborted();
      active++;
      let directory;
      try{
        directory=await mkdtemp(join(tmpdir(),'arcade-tts-'));
        const destination=join(directory,'speech.wav');
        await new Promise((resolve,reject)=>{
          const child=spawn(executable,[...dataOption,'--stdin','-w',destination,'-b','1','-v',voice.variant,'-s','180'],{
            signal:stop,windowsHide:true,shell:false,stdio:['pipe','ignore','ignore'],
          });
          let issue;
          child.on('error',error=>{issue=error;});
          child.stdin.on('error',error=>{issue=error;});
          child.once('close',code=>issue||code!==0?reject(issue||Error('Speech engine failed')):resolve());
          child.stdin.end(line,'utf8');
        });
        stop.throwIfAborted();
        if((await stat(destination)).size>OUTPUT_LIMIT)
          throw Object.assign(Error('Speech output exceeds the duration limit'),{code:'speech_too_long'});
        return normalize(await readFile(destination));
      }finally{
        active--;
        if(directory&&dirname(directory)===tmpdir()&&/^arcade-tts-[a-z0-9]{6}$/iu.test(basename(directory))){
          await rm(join(directory,'speech.wav'),{force:true});
          await rmdir(directory);
        }
      }
    },
  };
}

function voiceCatalog(...engines){
  const sources=new Map();
  for(const engine of engines.filter(Boolean))
    for(const voice of engine.voices)sources.set(voice.id,{voice,engine});
  if(!sources.size)return;
  return {
    voices:[...sources.values()].map(({voice})=>voice),
    render(line,id,signal){
      const source=sources.get(id);
      if(!source)throw Error('Voice unavailable');
      return source.engine.render(line,id,signal);
    },
  };
}
module.exports={createVoiceEngine,voiceCatalog};
