'use strict';

const {publicWebRequest,publicWebSearch,MWMBL_SEARCH_ENDPOINT}=require('../../src/bot/qq-public-lookup.cjs');
const {addressedMediaText,groupMediaCapabilityQuestion}=require('../../src/bot/group-media-request.cjs');
const {publicReactionIntent}=require('./public-reactions.cjs');
const {fail}=require('./store.cjs');
const {markPrivateWebLookup}=require('./web-search-privacy.cjs');

const holdSearch=/(?:别|不要|不用|不必|不许|先不|禁止)\s*(?:联网|上网|接入网络)(?:了|吧)?$/u;

function createConversationWeb(store,fetcher){
  const pending=new Map();
  const setting=chat=>store.webSearchSetting(chat);

  function inspect(message,text,bot){
    text=addressedMediaText(text,undefined,bot.displayName);
    if(groupMediaCapabilityQuestion(text)==='web')return {capability:true};
    if(markPrivateWebLookup(store,message.conversationId,message.id,text))return {private:true};
    if(publicReactionIntent(text))return null;
    const request=publicWebRequest(text,{plainSearch:true});
    if(request&&holdSearch.test(text))return {cancelled:true};
    if(request===false)return {invalid:true};
    return request;
  }

  function save(account,chat,body){
    const conversation=store.conversation(account,chat);
    const previous=conversation.webSearch;
    if(!previous?.canManage||body.expectedAccount!==account)fail(403,'web_search_permission','你不能更改这个会话的公开网页搜索');
    if(typeof body.enabled!=='boolean'||body.revision!==previous.revision)
      fail(409,'web_search_changed','网页搜索设置已变化，请重新打开会话设置');
    if(body.enabled===previous.enabled)return {conversation};
    if(body.enabled&&conversation.type==='direct'&&!conversation.cloudChat?.enabled)
      fail(409,'ai_cloud_off','请先恢复这段 AI 私聊');
    store.run(`INSERT INTO ai_web_search_settings VALUES(?,?,?)
      ON CONFLICT(chat) DO UPDATE SET enabled=excluded.enabled,revision=excluded.revision`,
      chat,Number(body.enabled),previous.revision+1);
    return {conversation:store.conversation(account,chat),cancelWebChat:chat};
  }

  function cancel(chat){
    for(const controller of pending.get(chat)??[])controller.abort();
  }

  async function reply(chat,intent,{signal,assertCurrent,needsMention=false}){
    const before=setting(chat);
    if(intent.capability)return before.enabled?
      '这里可以查公开网页，有结果会附来源链接。我不能直接打开任意网页阅读。':
      '这段会话还没开启公开网页搜索。我不能直接打开任意网页阅读。';
    if(intent.private)return '这涉及会话里的身份或私密内容，我不会拿去搜索。请给我一个公开主题。';
    if(intent.cancelled)return '好，这次先不搜。';
    if(intent.invalid)return '请只给我可公开搜索的主题词。';
    if(!before.enabled)return '这段会话的公开网页搜索还没开启。';
    if(needsMention)return '请在群里点名我，再给我公开搜索的主题。';
    const controller=new AbortController();
    const controllers=pending.get(chat)??new Set();
    pending.set(chat,controllers);
    controllers.add(controller);
    const active=AbortSignal.any([signal,controller.signal]);
    const assertAllowed=()=>{
      active.throwIfAborted();
      assertCurrent();
      if(setting(chat).revision!==before.revision)throw Error('Web search setting changed');
    };
    try{
      const rows=await publicWebSearch(MWMBL_SEARCH_ENDPOINT,intent.query,
        {signal:active,website:intent.website,assertCurrent:assertAllowed,fetcher});
      assertAllowed();
      if(!rows.length)return '这次没找到相关的公开网页。';
      return {sources:rows.map(({title,url})=>({title,url})),
        text:'公开网页搜索结果\n'+rows.map(({title,url})=>title+'\n'+url).join('\n\n')+
          '\n\nMwmbl · CC BY-NC-SA 4.0 · https://creativecommons.org/licenses/by-nc-sa/4.0/'};
    }catch(error){
      assertAllowed();
      if(error.code==='source_busy')return '公开搜索正在忙，稍后再试吧。';
      if(error.code==='source_rate_limited')return '公开搜索暂时限流，稍后再试吧。';
      return '这次没能从公开搜索服务取回结果。';
    }finally{
      controllers.delete(controller);
      if(!controllers.size)pending.delete(chat);
    }
  }

  function send(bot,clientId,result,afterSend){
    if(typeof result==='string')return bot.send({clientId,text:result},afterSend);
    const {text,sources}=result;
    const message=bot.send({clientId,text},row=>{
      afterSend(row);
      store.run('INSERT INTO message_web_results VALUES(?,?)',row.id,JSON.stringify(sources));
    });
    return {...message,webResults:sources};
  }

  return {inspect,save,cancel,reply,send};
}

module.exports={createConversationWeb};
