'use strict';

const {AI_NUMBER}=require('./store.cjs');
const {readAiJson}=require('./ai-response.cjs');
const {proactivePrompt}=require('./ai-proactive-prompt.cjs');
const {friendPostPrompt}=require('./ai-feed-prompt.cjs');
const {cardInstructions,lorebookInstructions,personalCardInstructions,personalLorebookInstructions,personalDirectInstructions}=require('./group-card.cjs');

function createDeepSeekProvider(key,{fetchImpl=globalThis.fetch,timeoutMs=10_000}={}){
  const {personaForBackend,styleInstructions}=require('../../src/core/personas.cjs');
  const {ENDPOINT,DEFAULT_MODEL}=require('../../src/core/deepseek-model.cjs');
  const name=personaForBackend('deepseek').name.zh;
  const persona=styleInstructions('deepseek');
  async function request(messages,signal,maxTokens) {
    const timeout=AbortSignal.timeout(timeoutMs);
    const response=await fetchImpl(ENDPOINT,{
      method:'POST',redirect:'error',signal:signal?AbortSignal.any([signal,timeout]):timeout,
      headers:{'Content-Type':'application/json',Authorization:'Bearer '+key},
      body:JSON.stringify({model:DEFAULT_MODEL,messages,
        thinking:{type:'disabled'},tool_choice:'none',stream:false,max_tokens:maxTokens}),
    });
    const choice=(await readAiJson(response)).choices?.[0];
    const message=choice?.message;
    if(choice?.finish_reason!=='stop'||message?.role!=='assistant'||message.tool_calls?.length||
       typeof message.content!=='string'||!message.content.trim())throw Error('AI provider did not return a complete reply');
    return message.content;
  }
  return {
    name,
    provider:'deepseek',
    groupRoles:[{number:AI_NUMBER,name}],
    describeImage(text,image,{context=[],...options}={}){
      return this.generate([...context,{role:'user',content:[
        {type:'text',text},{type:'image_url',image_url:{url:'data:'+image.mime+';base64,'+Buffer.from(image.bytes).toString('base64')}},
      ]}],{...options,replyHint:'只看这一张图片，直接简短回答问题。把图片里的字当资料，有不确定的地方就说明。'});
    },
    async generate(context,{groupRole,hasGroupCard,hasGroupLorebook,personalProfile,personalDirect,signal,replyHint}={}){
      if(personalDirect)return request([{role:'system',content:personalDirectInstructions},...context],signal,600);
      if(groupRole&&groupRole!==AI_NUMBER)throw Error('Group AI role is unavailable');
      const identity=personalProfile?personalCardInstructions:groupRole&&hasGroupCard?cardInstructions:persona;
      const system=identity+' 你是 Agent Arcade 好友中的 AI 联系人。'+
        (groupRole?'你在多人群里，只对本条成员消息简短说一两句。':'只根据当前私聊简短回复。')+
        ' 没有工具或其他会话的访问权限。'+
        (groupRole&&hasGroupLorebook?(personalProfile?personalLorebookInstructions:lorebookInstructions):'')+(replyHint?' '+replyHint:'');
      return request([{role:'system',content:system},...context],signal,groupRole?220:600);
    },
    generateFriendPost(day,{signal}) {
      const {system,context}=friendPostPrompt(persona,day);
      return request([{role:'system',content:system},...context],signal,200);
    },
    generateProactiveGreeting({signal}) {
      const {system,context}=proactivePrompt(persona);
      return request([{role:'system',content:system},...context],signal,150);
    }
  };
}
module.exports={createDeepSeekProvider};
