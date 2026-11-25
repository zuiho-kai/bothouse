'use strict';
window.ArcadeCharacterVoice = function createVoiceControl({tr,send,current,canStart=()=>true,commitBusy=()=>{},applied,appConversation=false,groupCard=false}) {
  const panel=el('fieldset','qq-role-voice'),legend=el('legend'),active=el('p'),choices=el('select');
  const selectLabel=el('label'),textLabel=el('label'),text=el('textarea'),buttons=el('div','qq-media-actions');
  const preview=el('button','secondary'),use=el('button','primary'),stop=el('button','secondary'),sound=el('audio'),status=el('p');
  const prefix=appConversation?'app':groupCard?'qq-group':'qq';
  choices.id=prefix+'-character-voice-choice';text.id=prefix+'-character-voice-line';text.rows=2;text.maxLength=300;
  selectLabel.htmlFor=choices.id;textLabel.htmlFor=text.id;status.setAttribute('role','status');
  preview.type=use.type=stop.type='button';sound.controls=true;sound.preload='none';sound.hidden=true;
  buttons.append(preview,use,stop);panel.append(legend,active,selectLabel,choices,textLabel,text,buttons,sound,status);
  let state,identity,stamp,loading=false,requesting=false,sample=null,known=[],listed=false;
  function resetSample(){sample=null;sound.pause();sound.removeAttribute('src');sound.hidden=true;}
  function label(v){
    const names={'Microsoft Huihui':'慧慧','Microsoft Kangkang':'康康','Microsoft Yaoyao':'瑶瑶'};
    return v.id==='serena'?tr('Serena · 本机神经语音','Serena · local neural speech'):
      tr(names[v.name]||v.name,v.name)+' · '+v.locale;
  }
  function update(){
    const selected=state.v.selected||[],prior=state.v.selectedVoice,legacy=selected.includes('ju-serena');
    if(groupCard){
      const missing=listed&&!known.some(v=>v.id===(prior?.id||'serena'));
      const choice=prior?label(prior):tr('Serena（默认）','Serena (default)');
      const permission=selected.includes('card-recording')?tr('本群只允许播放固定录音','This group allows the fixed recording only'):
        selected.includes('card-speech')?tr('本群已允许朗读','Spoken replies allowed in this group'):
        tr('本群尚未允许朗读','Spoken replies are off in this group');
      active.textContent=choice+(missing?tr('（本机暂不可用）',' (currently unavailable)'):'')+' · '+permission;
      stop.hidden=stop.disabled=true;
    }else{
      const enabled=appConversation?!!prior:selected.some(id=>['ju-serena','whale-speech','whale-recording','dragon-speech'].includes(id));
      const choice=prior?label(prior):legacy?'Serena':selected.includes('whale-recording')?tr('原先选定的录音','Previously selected recording'):'';
      const missing=!loading&&(prior||legacy)&&!known.some(v=>v.id===(prior?.id||'serena'));
      active.textContent=choice?tr('当前音色：','Current voice: ')+choice+(missing?tr('（本机暂不可用）',' (currently unavailable)'):'')+
        (!enabled?tr(' · 私聊语音已关闭',' · private voice off'):''):tr('尚未选择角色音色。','Choose a character voice.');
      stop.hidden=!enabled;stop.disabled=requesting;
    }
    choices.disabled=loading||requesting||!known.length;text.disabled=requesting;
    preview.disabled=use.disabled=choices.disabled||!choices.value||!text.value.trim();
  }
  async function bind(next){
    const key=appConversation?[next.profileId,next.contextId].join('|'):[next.profileId,next.v.accountId,next.v.groupId??next.v.ownerId,next.v.roleId].join('|');
    const changed=key!==identity;state=next;
    legend.textContent=groupCard?tr('本群角色音色','Character voice in this group'):tr('角色音色','Character voice');selectLabel.textContent=tr('声音','Voice');
    textLabel.textContent=tr('试听台词','Preview line');
    preview.textContent=tr('试听','Preview');use.textContent=groupCard?tr('为这张群卡保存音色','Save voice for this group card'):tr('生成并使用这个声音','Generate and use this voice');
    stop.textContent=appConversation?tr('关闭 App 语音回复','Turn off App reply audio'):tr('关闭私聊语音','Turn off private voice');
    if(!changed&&stamp===next.v.revision){update();return;}
    identity=key;stamp=next.v.revision;
    if(changed){resetSample();text.value=tr('晚上好，今天有什么想聊的？','Good evening. What would you like to talk about?');status.textContent='';}
    const wanted=state.v.selectedVoice?.id||(groupCard||state.v.selected?.includes('ju-serena')?'serena':'');
    listed=false;loading=true;update();
    try{
      const result=await send(next,{action:'list'});if(state!==next||!current(next))return;
      known=result.choices;listed=true;choices.replaceChildren();
      for(const v of known){const opt=el('option','',label(v));opt.value=v.id;choices.append(opt);}
      if(known.some(v=>v.id===wanted))choices.value=wanted;
      else if(wanted){const opt=el('option','',tr('请选择可用的音色','Choose an available voice'));opt.value='';opt.disabled=true;choices.prepend(opt);choices.value='';}
      if(!known.length)status.textContent=tr('没有可用的本机音色。可在 Windows 语言设置安装语音后，重新打开此页。','No local voice is available. Install a voice in Windows language settings and reopen this page.');
    }catch{if(state===next){known=[];status.textContent=tr('读取音色失败，请重新打开此页。','Could not load voices. Reopen this page.');}}
    finally{if(state===next){loading=false;update();}}
  }
  async function act(action){
    const start=state;if(!current(start)||requesting||!canStart())return;
    requesting=true;commitBusy(true);update();
    try{
      if(action==='stop'){
        const result=await send(start,{action:'stop'});
        if(current(start)){
          if(appConversation)resetSample();
          applied(start,appConversation?result.selection:result.ownerMedia);
          status.textContent=appConversation?tr('App 语音回复已关闭。','App reply audio turned off.'):tr('私聊语音已关闭。','Private voice turned off.');
        }
        return;
      }
      const id=choices.value,line=text.value.trim();
      status.textContent=tr('正在本机生成…','Generating locally…');
      if(!sample||sample.id!==id||sample.line!==line||sample.revision!==start.v.revision){
        const result=await send(start,{action:'preview',id,text:line});
        if(!current(start))return;
        if(typeof result.dataUrl!=='string'||!result.dataUrl.startsWith('data:audio/wav;base64,')||typeof result.ticket!=='string')throw Error();
        sound.src=result.dataUrl;sound.hidden=false;sample={id,line,revision:start.v.revision,ticket:result.ticket};
      }
      if(action==='use'){
        const result=await send(start,{action:'use',ticket:sample.ticket});
        if(current(start)){
          applied(start,groupCard?result.groupVoice:appConversation?result.selection:result.ownerMedia);
          status.textContent=groupCard?tr('音色已保存。朗读权限由本群素材设置控制。','Voice saved. Group media settings control permission to speak.'):
            appConversation?tr('音色已保存，适合朗读的新回复会提供语音。','Voice saved. New replies suited to speech will include audio.'):
            tr('已使用此声音。私聊和已允许语音的同角色群聊会用它说当轮台词。','Voice saved for this character in private chat and groups that already allow voice.');
        }
      }else{
        status.textContent=tr('已生成。可播放试听，满意后使用。','Preview generated. Listen, then use this voice.');
        await sound.play().catch(()=>{});
      }
    }catch{if(current(start)){sample=null;status.textContent=tr('未完成，请确认音色在本机可用，缩短台词后重试。','Could not finish. Check voice availability or try a shorter line.');}}
    finally{requesting=false;commitBusy(false);if(state)update();}
  }
  choices.onchange=text.oninput=()=>{resetSample();status.textContent='';update();};
  preview.onclick=()=>act('preview');use.onclick=()=>act('use');stop.onclick=()=>act('stop');
  return {panel,bind,clear(){state=null;stamp=null;identity=null;known=[];listed=false;loading=false;resetSample();}};
};
