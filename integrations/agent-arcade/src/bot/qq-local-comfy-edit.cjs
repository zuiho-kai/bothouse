'use strict';

const {randomInt,randomUUID}=require('node:crypto');
const {setTimeout:delay}=require('node:timers/promises');
const {validateImagePayload}=require('./qq-media.cjs');

const endpoint='http://127.0.0.1:8188';
const inputDir='agent-arcade-reference';
const model='qwen_image_edit_2509_fp8_e4m3fn.safetensors';
const clip='qwen_2.5_vl_7b_fp8_scaled.safetensors';
const vae='qwen_image_vae.safetensors';
const models=[['UNETLoader','unet_name',model],['CLIPLoader','clip_name',clip],['VAELoader','vae_name',vae]];
const fail=code=>{throw Object.assign(Error(code),{code});};

function workflow(input,prefix,prompt){
  const node=(class_type,inputs)=>({class_type,inputs});
  const text=prompt.trim();
  return {
    1:node('UNETLoader',{unet_name:model,weight_dtype:'default'}),
    2:node('ModelSamplingAuraFlow',{model:['1',0],shift:3.1}),
    3:node('CLIPLoader',{clip_name:clip,type:'qwen_image',device:'default'}),
    4:node('VAELoader',{vae_name:vae}),
    5:node('LoadImage',{image:input}),
    6:node('FluxKontextImageScale',{image:['5',0]}),
    7:node('TextEncodeQwenImageEditPlus',{clip:['3',0],vae:['4',0],image1:['6',0],
      prompt:'Keep the same character identity, facial features, hairstyle, outfit and markings from the reference. Change only what the scene requires.\n'+text}),
    8:node('TextEncodeQwenImageEditPlus',{clip:['3',0],vae:['4',0],image1:['6',0],prompt:''}),
    9:node('VAEEncode',{pixels:['6',0],vae:['4',0]}),
    10:node('KSampler',{model:['2',0],seed:randomInt(2**40),steps:50,cfg:4,sampler_name:'euler',scheduler:'simple',
      positive:['7',0],negative:['8',0],latent_image:['9',0],denoise:1}),
    11:node('VAEDecode',{samples:['10',0],vae:['4',0]}),
    12:node('SaveImage',{images:['11',0],filename_prefix:prefix}),
  };
}

async function responseBytes(response,type,limit,signal,errorCode){
  const mime=response.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
  if(!response.ok||!response.body||mime!==type||Number(response.headers.get('content-length'))>limit){
    await response.body?.cancel().catch(()=>{});
    fail(errorCode);
  }
  const chunks=[];
  let size=0;
  for await(const chunk of response.body){
    signal.throwIfAborted();
    size+=chunk.byteLength;
    if(size>limit)fail(errorCode);
    chunks.push(chunk);
  }
  if(!size)fail(errorCode);
  return Buffer.concat(chunks,size);
}

async function generateComfyEdit({prompt,reference,signal},{fetcher=globalThis.fetch,assertCurrent}={}){
  if(typeof assertCurrent!=='function'||typeof prompt!=='string'||!prompt.trim()||prompt.length>2200)
    fail('image_provider_failed');
  if(!Buffer.isBuffer(reference))fail('local_drawing_reference_failed');
  try{validateImagePayload(reference);}catch{fail('local_drawing_reference_failed');}
  const deadline=AbortSignal.timeout(300000);
  const active=signal?AbortSignal.any([signal,deadline]):deadline;
  const check=()=>{
    active.throwIfAborted();
    try{assertCurrent();}catch{fail('image_cancelled');}
    active.throwIfAborted();
  };
  const request=async(route,options,errorCode)=>{
    check();
    try{
      return await fetcher(endpoint+route,{...options,signal:active,redirect:'error',credentials:'omit',cache:'no-store'});
    }catch{
      active.throwIfAborted();
      return fail(errorCode);
    }
  };
  const json=async(route,options,errorCode='image_provider_failed',httpError=errorCode)=>{
    const response=await request(route,options,errorCode);
    const raw=await responseBytes(response,'application/json',512*1024,active,httpError);
    try{return JSON.parse(raw);}catch{fail('image_invalid_response');}
  };
  const ensureIdle=async()=>{
    const queue=await json('/queue',{},'local_drawing_offline');
    if(!Array.isArray(queue?.queue_running)||!Array.isArray(queue.queue_pending))fail('image_invalid_response');
    if(queue.queue_running.length||queue.queue_pending.length)fail('local_drawing_busy');
  };
  const nonce=randomUUID().replaceAll('-',''),name='reference_'+nonce+'.png',prefix='arcade_edit_'+nonce;
  try{
    await ensureIdle();
    for(const [type,key,weight] of models){
      const info=await json('/object_info/'+type,{},'local_drawing_offline','local_drawing_model_missing');
      const choices=info?.[type]?.input?.required?.[key];
      const values=Array.isArray(choices?.[0])?choices[0]:choices?.[1]?.options;
      if(!Array.isArray(values)||!values.includes(weight))fail('local_drawing_model_missing');
    }
    const upload=new FormData();
    upload.set('image',new Blob([reference],{type:'image/png'}),name);
    upload.set('subfolder',inputDir);
    upload.set('type','input');
    upload.set('overwrite','false');
    const uploaded=await json('/upload/image',{method:'POST',body:upload},'local_drawing_reference_failed');
    if(uploaded?.name!==name||uploaded.subfolder!==inputDir||uploaded.type!=='input')fail('local_drawing_reference_failed');
    await ensureIdle();
    const graph=workflow(inputDir+'/'+name,prefix,prompt);
    const submitted=await json('/prompt',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({prompt:graph,client_id:randomUUID()})});
    const id=submitted?.prompt_id;
    if(typeof id!=='string'||!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u.test(id))fail('image_invalid_response');
    for(;;){
      const history=await json('/history/'+id,{});
      if(!history||typeof history!=='object'||Array.isArray(history))fail('image_invalid_response');
      const item=Object.hasOwn(history,id)?history[id]:null;
      if(item?.status?.status_str==='error')fail('image_provider_failed');
      if(item?.status?.completed===true){
        const images=item.outputs?.['12']?.images;
        if(!Array.isArray(images)||images.length!==1)fail('image_invalid_response');
        const [image]=images;
        if(image?.type!=='output'||image.subfolder!==''||typeof image.filename!=='string'||
           !new RegExp('^'+prefix+'_[0-9]{5,}_[.]png$','u').test(image.filename))fail('image_invalid_response');
        const args=new URLSearchParams({filename:image.filename,subfolder:'',type:'output'});
        const result=await request('/view?'+args,{},'image_provider_failed');
        const png=await responseBytes(result,'image/png',8*1024*1024,active,'image_invalid_response');
        if(png.length<45||png.subarray(0,8).toString('hex')!=='89504e470d0a1a0a'||
           png.toString('ascii',12,16)!=='IHDR'||[png.readUInt32BE(16),png.readUInt32BE(20)].some(size=>size<1||size>2048))
          fail('image_invalid_response');
        check();
        return png;
      }
      await delay(350,undefined,{signal:active});
    }
  }catch(error){
    if(signal?.aborted)fail('image_cancelled');
    if(deadline.aborted)fail('image_timeout');
    if(error?.code?.startsWith?.('image_')||error?.code?.startsWith?.('local_drawing_'))throw error;
    fail('image_provider_failed');
  }
}

module.exports={generateComfyEdit};
