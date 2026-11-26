'use strict';
const {createAPIFileRunner,record}=require('./api-file-runner.cjs');
const {TOOLS,SafeError}=require('./file-tools.cjs');
const generation=require('./generation.cjs');
// GenerateContent keeps app-owned, bounded histories. No hosted conversation,
// grounding, code execution, file search or automatic SDK function execution.
const ENDPOINT='https://generativelanguage.googleapis.com/v1beta/models/';
const DEFAULT_MODEL='gemini-3.6-flash',MODELS=Object.freeze([DEFAULT_MODEL]);
const declarations=TOOLS.map(({function:f})=>({name:f.name,description:f.description,parametersJsonSchema:f.parameters}));
function parse(data){
  if(data.promptFeedback?.blockReason)throw new SafeError('Gemini blocked this request. No tool call was executed.');
  const candidate=data.candidates?.[0],source=candidate?.content;
  if(!Array.isArray(data.candidates)||data.candidates.length!==1)throw new SafeError('Gemini returned an unsupported response.');
  if(candidate.finishReason==='MAX_TOKENS')throw new SafeError('Gemini reached the response token limit. No partial tool call was executed.','limit');
  if(candidate.finishReason!=='STOP')throw new SafeError('Gemini ended without a complete response. No tool call was executed.');
  if(source?.role!=='model'||!Array.isArray(source.parts)||!source.parts.length||source.parts.length>32)throw new SafeError('Gemini returned malformed content.');
  const calls=[],ids=new Set(),texts=[];
  const parts=source.parts.map(part=>{
    if(!record(part)||Object.keys(part).some(key=>!['text','thought','thoughtSignature','functionCall'].includes(key))||typeof part.thought!=='undefined'&&typeof part.thought!=='boolean'||part.thoughtSignature!==undefined&&(typeof part.thoughtSignature!=='string'||part.thoughtSignature.length>131072))throw new SafeError('Gemini returned unsupported content.');
    if(Object.hasOwn(part,'text')===Object.hasOwn(part,'functionCall'))throw new SafeError('Gemini returned malformed content.');
    if(Object.hasOwn(part,'text')){if(typeof part.text!=='string')throw new SafeError('Gemini returned malformed text.');if(part.thought!==true)texts.push(part.text);}
    else{
      const call=part.functionCall;
      if(!record(call)||Object.keys(call).some(key=>!['id','name','args'].includes(key))||typeof call.name!=='string'||!record(call.args)||part.thought===true)throw new SafeError('Gemini returned malformed tool calls.');
      if(call.id!==undefined&&(typeof call.id!=='string'||!/^[A-Za-z0-9_-]{1,180}$/.test(call.id)||ids.has(call.id)))throw new SafeError('Gemini returned malformed tool identifiers.');
      if(call.id)ids.add(call.id);calls.push({id:call.id,name:call.name,arguments:JSON.stringify(call.args)});
    }
    // Preserve signed parts and their order exactly for subsequent function rounds.
    return part;
  });
  if(calls.length>8)throw new SafeError('Gemini returned too many tool calls.');
  const text=texts.join('');if(!calls.length&&!text.trim())throw new SafeError('Gemini returned no reply text.');
  return {message:{role:'model',parts},calls,text};
}
// streamGenerateContent: every event is a partial GenerateContentResponse. Parts are gathered in
// order (adjacent plain text parts joined) and handed to parse() as one response, so a stream
// without a finishReason fails exactly like an incomplete plain response.
function collector(emit){
  const parts=[];let seen=false,finish,feedback;
  const plain=part=>Object.keys(part).every(key=>key==='text'||key==='thought')&&typeof part.text==='string';
  return {
    data(payload){
      const value=generation.sseJSON(payload,'Gemini');
      if(value.error)throw new SafeError('Gemini could not complete this request. Check its service and your connection.');
      if(value.promptFeedback?.blockReason)feedback=value.promptFeedback;
      if(value.candidates===undefined)return false;
      if(!Array.isArray(value.candidates)||value.candidates.length!==1||!record(value.candidates[0]))throw new SafeError('Gemini returned an unsupported response.');
      const candidate=value.candidates[0],content=candidate.content;
      if(content!==undefined){
        if(!record(content)||content.role!==undefined&&content.role!=='model'||content.parts!==undefined&&!Array.isArray(content.parts))throw new SafeError('Gemini returned malformed content.');
        seen=true;
        for(const part of content.parts||[]){
          if(!record(part))throw new SafeError('Gemini returned unsupported content.');
          const last=parts.at(-1);
          if(plain(part)&&last&&plain(last)&&(last.thought===true)===(part.thought===true))last.text+=part.text;
          else{if(parts.length>=64)throw new SafeError('Gemini returned malformed content.');parts.push({...part});}
          if(typeof part.text==='string'&&part.thought!==true)emit(part.text);
        }
      }
      if(typeof candidate.finishReason==='string')finish=candidate.finishReason;
      return false;
    },
    result:()=>({...(feedback?{promptFeedback:feedback}:{}),candidates:[{...(seen?{content:{role:'model',parts}}:{}),...(finish?{finishReason:finish}:{})}]}),
  };
}
const adapter={label:'Gemini',backend:'gemini',defaultModel:DEFAULT_MODEL,models:MODELS,user:text=>({role:'user',parts:[{text}]}),
  request:({key,model,system,history,conversationOnly,sampling={}})=>({url:`${ENDPOINT}${model}:generateContent`,headers:{'Content-Type':'application/json','x-goog-api-key':key},body:{systemInstruction:{parts:[{text:system}]},contents:history,tools:conversationOnly?[]:[{functionDeclarations:declarations}],toolConfig:{functionCallingConfig:{mode:conversationOnly?'NONE':'AUTO'}},generationConfig:{maxOutputTokens:sampling.maxTokens||8192,...(sampling.temperature===undefined?{}:{temperature:sampling.temperature}),...(sampling.topP===undefined?{}:{topP:sampling.topP}),thinkingConfig:{thinkingLevel:'low',includeThoughts:false}},store:false}}),parse,
  stream:{prepare:prepared=>({...prepared,url:prepared.url.replace(/:generateContent$/,':streamGenerateContent?alt=sse')}),collector},
  results:outputs=>[{role:'user',parts:outputs.map(({call,output})=>({functionResponse:{...(call.id?{id:call.id}:{}),name:call.name,response:output}}))}]};
const createGeminiRunner=options=>createAPIFileRunner(adapter,options);
module.exports={createGeminiRunner,DEFAULT_MODEL,MODELS,ENDPOINT};
