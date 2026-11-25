'use strict';
(() => {
  const request=window.arcade.desktopCharacterVoice;
  const settings=document.getElementById('bot-setup-panel'),controls=document.getElementById('bot-local-controls');
  if(typeof request!=='function'||!settings||!controls||!window.ArcadeCharacterVoice)return;
  const disclosure=el('details','bot-help'),heading=el('summary'),note=el('p','bot-fine');
  disclosure.id='app-reply-voice';disclosure.hidden=true;note.setAttribute('role','status');
  let snapshot,scope=null,shown=null;
  const tr=(zh,en)=>snapshot?.config.language==='zh'?zh:en;
  async function send({profileId,contextId},patch){
    const result=await request({accountId:profileId,contextId,...patch});
    if(!result?.ok)throw Error(result?.code||'unavailable');
    return result;
  }
  const voice=window.ArcadeCharacterVoice({
    appConversation:true,tr,current:start=>shown===start,
    send:(start,action)=>send(start,{revision:start.v.revision,...action}),
    applied:(start,v)=>{if(shown===start){shown={...start,v};void voice.bind(shown);}}
  });
  disclosure.append(heading,note,voice.panel);controls.append(disclosure);
  function reset(){scope=null;shown=null;voice.clear();voice.panel.hidden=true;}
  async function update(next){
    snapshot=next;
    const app=next?.desktopChat,local=next?.bot?.local;
    disclosure.hidden=app?.kind!=='local'||!!local?.libraryGroupId;
    heading.textContent=tr('App 语音回复','App reply audio');
    if(disclosure.hidden||document.body.dataset.view!=='bot'||!settings.open||!disclosure.open){
      if(scope)reset();
      return;
    }
    if(!app.available||app.selecting||!app.contextId||!next.accounts?.selectedId){
      reset();note.textContent=tr('开始与这位角色聊天后，即可设置音色。','Start chatting with this character to choose a voice.');return;
    }
    if(scope?.profileId===next.accounts.selectedId&&scope.contextId===app.contextId&&scope.language===next.config.language)return;
    reset();
    const start=scope={profileId:next.accounts.selectedId,contextId:app.contextId,language:next.config.language};
    note.textContent=tr('正在读取当前角色的音色…','Reading this character’s voice…');
    try{
      const result=await send(start,{action:'view'});
      if(scope!==start)return;
      const id=local.libraryCharacterId,card=next.bot.st?.character;
      const name=id?(card?.id===id?card.name:''):next.personas?.find(item=>item.id===local.characterId)?.name?.[start.language];
      const guidance=tr('较长的回复或明确索取的语音会在本机生成，可以查看文字。','Longer replies and replies explicitly requested as audio can be spoken locally. Text is still available.');
      note.textContent=name?name+' · '+guidance:guidance;
      shown={...start,v:result.selection};voice.panel.hidden=false;void voice.bind(shown);
    }catch{if(scope===start)note.textContent=tr('暂时无法读取音色设置，请收起后重试。','Could not read voice settings. Close this section and try again.');}
  }
  reset();
  for(const detail of [settings,disclosure])detail.addEventListener('toggle',()=>{if(snapshot)void update(snapshot);});
  addEventListener('pagehide',reset);
  window.ArcadeAppCharacterVoice={update};
})();
