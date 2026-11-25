'use strict';

async function readAiJson(response){
  if(!response.ok){
    await response.body?.cancel();
    throw Error('AI provider refused the request');
  }
  const chunks=[];
  let size=0;
  for await(const chunk of response.body){
    size+=chunk.length;
    if(size>64*1024)throw Error('AI provider response is too large');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
module.exports={readAiJson};
