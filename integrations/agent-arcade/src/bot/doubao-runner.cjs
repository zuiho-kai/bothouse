'use strict';
const {createAPIFileRunner,record}=require('./api-file-runner.cjs');
const {TOOLS,SafeError}=require('./file-tools.cjs');
const generation=require('./generation.cjs');
// Fixed Ark data-plane model; consumer Doubao and Coding Plan logins are separate.
const ENDPOINT='https://ark.cn-beijing.volces.com/api/v3/chat/completions';
const DEFAULT_MODEL='doubao-seed-2-0-lite-260428',MODELS=Object.freeze([DEFAULT_MODEL]);
function parse(data){
  const choice=data.choices?.[0],source=choice?.message;
  if(!Array.isArray(data.choices)||data.choices.length!==1||source?.role!=='assistant'||!(source.content===null||typeof source.content==='string'))throw new SafeError('Doubao returned an unsupported response.');
  if(choice.finish_reason==='length')throw new SafeError('Doubao reached the response token limit. No partial tool call was executed.','limit');
  if(!['stop','tool_calls'].includes(choice.finish_reason))throw new SafeError('Doubao ended without a complete response.');
  if(source.refusal)throw new SafeError('Doubao declined this request. No tool call was executed.');
  const message={role:'assistant',content:source.content},calls=[],ids=new Set();
  if(source.tool_calls!==undefined&&source.tool_calls!==null){
    if(!Array.isArray(source.tool_calls)||source.tool_calls.length>8)throw new SafeError('Doubao returned too many or malformed tool calls.');
    message.tool_calls=source.tool_calls.map(call=>{
      if(!record(call)||call.type!=='function'||typeof call.id!=='string'||!/^[A-Za-z0-9_-]{1,180}$/.test(call.id)||ids.has(call.id)||!record(call.function)||typeof call.function.name!=='string'||typeof call.function.arguments!=='string')throw new SafeError('Doubao returned malformed tool calls.');
      ids.add(call.id);calls.push({id:call.id,name:call.function.name,arguments:call.function.arguments});return {id:call.id,type:'function',function:{name:call.function.name,arguments:call.function.arguments}};
    });
  }
  if((choice.finish_reason==='tool_calls')!==!!calls.length)throw new SafeError('Doubao returned inconsistent tool-call state.');
  if(!calls.length&&!source.content?.trim())throw new SafeError('Doubao returned no reply text.');
  return {message,calls,text:source.content||''};
}
const adapter={label:'Doubao',backend:'doubao',defaultModel:DEFAULT_MODEL,models:MODELS,user:text=>({role:'user',content:text}),
  request:({key,model,system,history,conversationOnly,sampling={}})=>({url:ENDPOINT,headers:{'Content-Type':'application/json',Authorization:`Bearer ${key}`},body:{model,messages:[{role:'system',content:system},...history],tools:conversationOnly?[]:TOOLS,tool_choice:conversationOnly?'none':'auto',thinking:{type:'disabled'},max_tokens:sampling.maxTokens||4096,...(sampling.temperature===undefined?{}:{temperature:sampling.temperature}),...(sampling.topP===undefined?{}:{top_p:sampling.topP}),stream:false}}),parse,
  // OpenAI-style SSE; the request differs from the plain one only in `stream:true`.
  stream:{prepare:prepared=>({...prepared,body:{...prepared.body,stream:true}}),collector:emit=>generation.chatStream('Doubao',emit)},
  results:outputs=>outputs.map(({call,output})=>({role:'tool',tool_call_id:call.id,content:JSON.stringify(output)}))};
const createDoubaoRunner=options=>createAPIFileRunner(adapter,options);
module.exports={createDoubaoRunner,DEFAULT_MODEL,MODELS,ENDPOINT};
