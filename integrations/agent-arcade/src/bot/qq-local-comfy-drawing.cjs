'use strict';

const {randomUUID,randomInt}=require('node:crypto');
const {setTimeout:delay}=require('node:timers/promises');

const COMFY_MODEL_LABEL='NoobAI-XL';
const checkpoint='NoobAI-XL-v1.1.safetensors';
const origin='http://127.0.0.1:8188';
const folder='agent_arcade_qq';
const maxJson=256*1024,maxImage=8*1024*1024;
let running=false,waiting=false;
const fail=code=>Object.assign(Error(code),{code});

function workflow(prompt,id){
  // Fixed SDXL graph from the approved local NoobAI workflow. User text
  // supplies only the positive conditioning. The prompt never names files.
  return {
    '1':{class_type:'CheckpointLoaderSimple',inputs:{ckpt_name:checkpoint}},
    '2':{class_type:'CLIPTextEncode',inputs:{text:prompt,clip:['1',1]}},
    '3':{class_type:'CLIPTextEncode',inputs:{text:'worst quality, low quality, lowres, bad anatomy, bad hands, extra digits, fewer digits, jpeg artifacts, signature, watermark, username, blurry',clip:['1',1]}},
    '4':{class_type:'EmptyLatentImage',inputs:{width:832,height:1216,batch_size:1}},
    '5':{class_type:'KSampler',inputs:{model:['1',0],seed:randomInt(2**32),steps:28,cfg:5,sampler_name:'euler_ancestral',
      scheduler:'normal',positive:['2',0],negative:['3',0],latent_image:['4',0],denoise:1}},
    '6':{class_type:'VAEDecode',inputs:{samples:['5',0],vae:['1',2]}},
    '7':{class_type:'SaveImage',inputs:{images:['6',0],filename_prefix:folder+'/'+id}}
  };
}

async function readResponse(response,type,limit,signal){
  if(response.headers.get('content-type')?.split(';')[0].trim()!==type||!response.body||
    Number(response.headers.get('content-length'))>limit){
    await response.body?.cancel().catch(()=>{});
    throw fail('image_invalid_response');
  }
  const chunks=[];
  let size=0;
  for await(const chunk of response.body){
    signal.throwIfAborted();
    size+=chunk.byteLength;
    if(size>limit)throw fail(type==='image/png'?'image_too_large':'image_invalid_response');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks,size);
}

async function withLocalComfySlot(operation,{
  fetcher=globalThis.fetch,signal,assertCurrent=()=>{},prepareService,waitMs=45000,pollMs=750
}={}){
  if(signal?.aborted)throw fail('image_cancelled');
  if(waiting)throw fail('local_drawing_busy');
  const timeout=AbortSignal.timeout(waitMs),active=signal?AbortSignal.any([signal,timeout]):timeout;
  const check=()=>{active.throwIfAborted();assertCurrent();};
  const pause=()=>delay(pollMs,undefined,{signal:active});
  let ownsSlot=false;
  waiting=true;
  try{
    while(running){check();await pause();}
    check();running=ownsSlot=true;
    const verifyWarmService=await prepareService?.(active);
    for(;;){
      check();
      const connect=AbortSignal.any([active,AbortSignal.timeout(3000)]);
      let response;
      try{
        response=await fetcher(origin+'/prompt',{signal:connect,redirect:'error',cache:'no-store',credentials:'omit'});
      }catch(error){if(active.aborted)throw error;throw fail('local_drawing_offline');}
      if(!response.ok){await response.body?.cancel().catch(()=>{});throw fail('local_drawing_offline');}
      let queue;
      try{queue=JSON.parse(await readResponse(response,'application/json',maxJson,connect));}
      catch(error){if(active.aborted||error.code)throw error;throw fail('image_invalid_response');}
      const count=queue?.exec_info?.queue_remaining;
      if(!Number.isSafeInteger(count)||count<0)throw fail('image_invalid_response');
      if(count===0)break;
      await pause();
    }
    await verifyWarmService?.();
    check();
  }catch(error){
    if(ownsSlot)running=false;
    if(signal?.aborted||error?.code==='group_drawing_changed')throw fail('image_cancelled');
    if(timeout.aborted)throw fail('local_drawing_wait_timeout');
    throw error;
  }finally{waiting=false;}
  try{return await operation();}finally{running=false;}
}

async function generateComfyImage({prompt,signal},{fetcher=globalThis.fetch,assertCurrent=()=>{},timeoutMs=180000,pollMs=750}={}){
  if(signal?.aborted)throw fail('image_cancelled');
  if(typeof prompt!=='string'||!prompt||prompt.length>3000)throw fail('image_request_rejected');
  const timeout=AbortSignal.timeout(timeoutMs);
  const active=signal?AbortSignal.any([signal,timeout]):timeout;
  const connect=AbortSignal.any([active,AbortSignal.timeout(3000)]);
  const check=()=>{active.throwIfAborted();assertCurrent();};
  const request=async(route,{body,type='application/json',guard=active}={})=>{
    check();
    let response;
    try{
      response=await fetcher(origin+route,{signal:guard,redirect:'error',cache:'no-store',credentials:'omit',
        ...(body&&{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})});
    }catch(error){
      if(active.aborted)throw error;
      throw fail('local_drawing_offline');
    }
    if(!response.ok){
      await response.body?.cancel().catch(()=>{});
      throw fail(body&&response.status===400?'image_request_rejected':'local_drawing_offline');
    }
    const bytes=await readResponse(response,type,type==='image/png'?maxImage:maxJson,guard);
    check();
    if(type==='image/png')return bytes;
    try{return JSON.parse(bytes);}catch{throw fail('image_invalid_response');}
  };
  try{
    const info=await request('/object_info/CheckpointLoaderSimple',{guard:connect});
    const models=info?.CheckpointLoaderSimple?.input?.required?.ckpt_name?.[0];
    if(!Array.isArray(models)||!models.includes(checkpoint))throw fail('local_drawing_model_missing');
    const queue=await request('/prompt',{guard:connect});
    const count=queue?.exec_info?.queue_remaining;
    if(!Number.isSafeInteger(count)||count<0)throw fail('image_invalid_response');
    if(count>0)throw fail('local_drawing_busy');
    const id=randomUUID();
    const accepted=await request('/prompt',{body:{prompt_id:id,prompt:workflow(prompt,id)}});
    if(accepted?.prompt_id!==id)throw fail('image_invalid_response');
    for(;;){
      const history=await request('/history/'+id);
      if(!history||typeof history!=='object'||Array.isArray(history))throw fail('image_invalid_response');
      const own=Object.hasOwn(history,id)?history[id]:null;
      if(own){
        if(own.status?.status_str==='error')throw fail('image_provider_failed');
        if(own.status?.status_str!=='success'||own.status.completed!==true)throw fail('image_invalid_response');
        const images=own.outputs?.['7']?.images;
        if(!Array.isArray(images)||images.length!==1)throw fail('image_invalid_response');
        const [{filename,subfolder,type}]=images;
        if(subfolder!==folder||type!=='output'||typeof filename!=='string'||!filename.startsWith(id)||
          !/^_\d{5}_\.png$/u.test(filename.slice(id.length)))throw fail('image_invalid_response');
        return await request('/view?'+new URLSearchParams({filename,subfolder,type}),{type:'image/png'});
      }
      await delay(pollMs,undefined,{signal:active});
    }
  }catch(error){
    if(signal?.aborted||error?.code==='group_drawing_changed')throw fail('image_cancelled');
    if(timeout.aborted)throw fail('image_timeout');
    if(connect.aborted&&!error?.code)throw fail('local_drawing_offline');
    throw error;
  }
}

module.exports={generateComfyImage,withLocalComfySlot,COMFY_MODEL_LABEL};
