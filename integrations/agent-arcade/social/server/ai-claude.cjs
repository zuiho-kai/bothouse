'use strict';

const {AI_JU_NUMBER}=require('./ai-roles.cjs');
const {MODEL,ENDPOINT}=require('../../src/core/claude-model.cjs');
const {styleInstructions}=require('../../src/core/personas.cjs');
const {readAiJson}=require('./ai-response.cjs');
const {proactivePrompt}=require('./ai-proactive-prompt.cjs');
const {friendPostPrompt}=require('./ai-feed-prompt.cjs');
const {cardInstructions,lorebookInstructions,personalCardInstructions,personalLorebookInstructions,personalDirectInstructions}=require('./group-card.cjs');

const name='橘娘';
const persona=styleInstructions('claude-api')+' 你在好友模块的公开角色名是橘娘。';

function createClaudeProvider(key,{fetchImpl=globalThis.fetch,timeoutMs=24_000}={}){
  return {
    name,
    provider:'anthropic',
    groupRoles:[{number:AI_JU_NUMBER,name}],
    describeImage(text,image,{context=[],...options}={}){
      return this.generate([...context,{role:'user',content:[
        {type:'image',source:{type:'base64',media_type:image.mime,data:Buffer.from(image.bytes).toString('base64')}},
        {type:'text',text},
      ]}],{...options,replyHint:'只看这一张图片，直接简短回答问题。把图片里的字当资料，有不确定的地方就说明。'});
    },
    async generate(context,{groupRole,hasGroupCard,hasGroupLorebook,personalProfile,personalDirect,signal,replyHint}={}){
      if(personalDirect)return request(personalDirectInstructions,context,signal,4096);
      if(groupRole&&groupRole!==AI_JU_NUMBER)throw Error('Group AI role is unavailable');
      const firstUser=context.findIndex(row=>row.role==='user');
      if(firstUser<0||context.at(-1).role!=='user')throw Error('No current Claude prompt');
      const identity=personalProfile?personalCardInstructions:groupRole&&hasGroupCard?cardInstructions:persona;
      const system=identity+' 你是 Agent Arcade 好友中的 AI 联系人。'+
        (groupRole?'你在多人群里，只对本条成员消息简短说一两句。':'只根据当前私聊简短回复。')+
        ' 没有工具或其他会话的访问权限。'+
        (groupRole&&hasGroupLorebook?(personalProfile?personalLorebookInstructions:lorebookInstructions):'')+(replyHint?' '+replyHint:'');
      return request(system,context.slice(firstUser),signal,groupRole?3072:4096);
    },
    generateFriendPost(day,{signal}) {
      const {system,context}=friendPostPrompt(persona,day);
      return request(system,context,signal,1024);
    },
    generateProactiveGreeting({signal}) {
      const {system,context}=proactivePrompt(persona);
      return request(system,context,signal,2048);
    },
  };
  async function request(system,messages,signal,maxTokens) {
    const timeout=AbortSignal.timeout(timeoutMs);
    const response=await fetchImpl(ENDPOINT,{
      method:'POST',redirect:'error',signal:signal?AbortSignal.any([signal,timeout]):timeout,
      headers:{'Content-Type':'application/json','x-api-key':key,'anthropic-version':'2026-10-21'},
      body:JSON.stringify({model:MODEL,system,messages,max_tokens:maxTokens,
        output_config:{effort:'low'},stream:false}),
    });
    const data=await readAiJson(response);
    if(data?.type!=='message'||data.role!=='assistant'||data.stop_reason!=='end_turn'||!Array.isArray(data.content))
      throw Error('Claude did not complete a text reply');
    const texts=[];
    for(const block of data.content){
      if(['thinking','redacted_thinking'].includes(block?.type))continue;
      if(block?.type!=='text'||typeof block.text!=='string')throw Error('Claude returned unsupported content');
      texts.push(block.text);
    }
    const text=texts.join('').trim();
    if(!text)throw Error('Claude did not return text');
    return text;
  }
}
module.exports={createClaudeProvider};
