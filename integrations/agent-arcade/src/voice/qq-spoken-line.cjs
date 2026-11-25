'use strict';
const {canonicalAudibleWav}=require('../bot/qq-voice-payload.cjs');
const MAX_CHARS=300;
const validLine=text=>typeof text==='string' && !!text.trim() && [...text].length<=MAX_CHARS && !/[\p{Cc}\p{Cf}]/u.test(text);
const limit=()=>Object.assign(Error('The speech exceeds the QQ voice limit'),{code:'voice_render_limit'});

// Only the optional neural worker limits an individual request to 120 characters.
// Send the bridge one canonical WAV after all segments are generated and verified.
async function renderNeuralLine(text,render,assertCurrent=()=>{}) {
  if(!validLine(text))throw limit();
  const parts=[],characters=[...text.trim()];
  while(characters.length>120){
    const prefix=characters.slice(0,120);
    let cut=prefix.findLastIndex(c=>/[。！？；，、.!?,;\s]/u.test(c))+1;
    if(cut<40)cut=120;
    parts.push(characters.splice(0,cut).join(''));
  }
  if(characters.length)parts.push(characters.join(''));
  const chunks=[];
  try{
    let rate=0,total=0;
    for(const part of parts){
      assertCurrent();
      const source=await render(part);
      let checked;
      try{checked=canonicalAudibleWav(source);}finally{source.fill(0);}
      chunks.push(checked.bytes);
      if(rate&&rate!==checked.sampleRate)throw limit();
      rate=checked.sampleRate;total+=checked.frames;
      if(total>30*rate)throw Object.assign(Error('The generated recording exceeds 30 seconds'),{code:'voice_duration'});
    }
    assertCurrent();
    const out=Buffer.concat([chunks[0].subarray(0,44),...chunks.map(chunk=>chunk.subarray(44))]);
    out.writeUInt32LE(out.length-8,4);out.writeUInt32LE(out.length-44,40);
    return out;
  }finally{for(const chunk of chunks)chunk.fill(0);}
}
module.exports={MAX_CHARS,validLine,renderNeuralLine};
