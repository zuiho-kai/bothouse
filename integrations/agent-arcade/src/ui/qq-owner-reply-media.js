'use strict';
(() => {
  if(typeof window.arcade.botConfigure!=='function')return;
  const open=el('button','secondary');open.type='button';open.id='qq-owner-media-open';open.hidden=true;
  document.querySelector('.bot-heading-actions')?.append(open);
  const dialog=el('dialog','qq-media');dialog.id='qq-owner-media';dialog.setAttribute('aria-labelledby','qq-owner-media-heading');document.body.append(dialog);
  const form=el('form','qq-media-content'),title=el('h2'),note=el('p'),list=el('fieldset'),legend=el('legend'),options=el('div'),extra=el('div','qq-media-actions'),actions=el('div','qq-media-actions');
  const status=el('p');status.setAttribute('role','status');title.id='qq-owner-media-heading';list.append(legend,options);form.append(title,note,list,extra,status,actions);dialog.append(form);
  let latest,shown,busy=false;
  const tr=(zh,en)=>latest?.config?.language==='en'?en:zh;
  const labels={
    'ju-sticker':['橘娘表情图','Ju’s sticker'],'ju-portrait':['橘娘立绘','Ju’s portrait'],'ju-serena':['橘娘语音 · 本机合成这轮台词','Ju’s voice · synthesize the current line'],
    'whale-sticker':['鲸鱼娘表情图','Whale’s sticker'],'whale-portrait':['鲸鱼娘立绘','Whale’s portrait'],'whale-recording':['鲸鱼娘语音 · 只播放选定的固定录音','Whale’s voice · selected recording only'],
    'dragon-speech':['用龙娘所选音色说本轮台词','Speak the current reply in Dragon’s selected voice']
  };
  function button(id,caption,fn){const b=el('button','secondary',caption);b.id=id;b.type='button';b.onclick=fn;return b;}
  function context(data){const v=data?.bot?.social?.ownerMedia;if(!v)return null;return {profileId:data.accounts?.selectedId,expectedMode:data.bot.mode,expectedChannel:'qq',v};}
  const identity=c=>c && [c.profileId,c.expectedMode,c.v.accountId,c.v.ownerId,c.v.roleId].join('|');
  function recipient(v){return {accountId:v.accountId,ownerId:v.ownerId,roleId:v.roleId,revision:v.revision};}
  const groupVoice=button('qq-owner-group-voice-settings','',()=>{
    if(busy||!dialog.open||!shown?.profileId||identity(shown)!==identity(context(latest)))return;
    if(window.openConversationSetup?.({section:'qq-groups',groupVoice:true,profileId:shown.profileId,
      expectedAccountId:shown.v.accountId,returnFocus:groupVoice})!==true)
      status.textContent=tr('群设置暂无法打开，请核对当前搭档后重试。','Group settings could not open. Check the current companion and try again.');
  });
  const voice=typeof window.arcade.botCharacterVoice==='function'&&window.ArcadeCharacterVoice?.({
    tr,send:({v,...profile},request)=>window.arcade.botCharacterVoice({...profile,...recipient(v),...request}),
    current:start=>dialog.open&&shown===start,canStart:()=>!busy,
    commitBusy:value=>{busy=value;list.disabled=value;groupVoice.disabled=value;},
    applied:(start,next)=>{
      if(shown!==start||!next)return;
      const draft=checked().filter(id=>!voiceAsset(id));
      shown={...start,v:next};draw([...draft,...next.selected.filter(voiceAsset)]);
    }
  });
  if(voice){form.insertBefore(voice.panel,list);form.insertBefore(groupVoice,list);}
  const voiceAsset=id=>['ju-serena','whale-recording','whale-speech','dragon-speech'].includes(id);
  function close(){voice?.clear();if(dialog.open)dialog.close();shown=null;window.ArcadeQQNamedStickerPicker?.sync();if(!open.hidden)open.focus();}
  function checked(){const visible=[...options.querySelectorAll('input:checked')].map(input=>input.value);return voice?[...visible,...shown.v.selected.filter(voiceAsset)]:visible;}
  async function apply(operation,item) {
    if(busy||!shown)return;
    const start=shown,{v,...profile}=start;
    const request={...recipient(v),operation},draft=checked();
    if(operation==='select')request.selected=[...draft,...v.selected.filter(id=>id.endsWith('-sticker'))];
    if(operation==='selectSticker')Object.assign(request,{name:item.name,sourceSha256:item.sha256});
    let focusAfterWrite;
    busy=true;form.setAttribute('aria-busy','true');list.disabled=true;groupVoice.disabled=true;for(const b of [...extra.children,...actions.children])b.disabled=true;
    try{
      const state=await window.arcade.botConfigure({...profile,qqOwnerReplyMedia:request});
      if(!dialog.open||shown!==start||identity(context(latest))!==identity(start))return;
      const next=state?.social?.ownerMedia;if(!next||next.accountId!==v.accountId||next.ownerId!==v.ownerId||next.roleId!==v.roleId){close();return;}
      const stickerChange=operation==='selectSticker'||operation==='restoreSticker';
      if(stickerChange&&(next.revision===v.revision||next.selected.some(id=>id.endsWith('-sticker'))||
        (item?next.namedSticker?.name!==item.name||next.namedSticker?.sourceSha256!==item.sha256:next.namedSticker)))throw Error('Selection changed');
      if(operation==='select'&&(next.selected.length!==request.selected.length||request.selected.some(id=>!next.selected.includes(id))))throw Error('Permission changed');
      shown={...profile,v:next};
      const recordingUnchanged=next.revision===v.revision&&operation==='choose';
      const cleared=stickerChange?v.available.find(id=>id.endsWith('-sticker')):'whale-recording';
      draw(operation==='select'?next.selected:recordingUnchanged?draft:draft.filter(id=>id!==cleared));
      if(stickerChange)focusAfterWrite=options.querySelector('#qq-owner-media-library');
      else if(operation==='select')focusAfterWrite=actions.querySelector('#qq-owner-media-save');
      if(operation==='select')status.textContent=tr('已保存，私聊立即生效。','Saved and active in private chat.');
      else if(stickerChange)status.textContent=tr('已更新表情偏好。','Sticker preference updated.');
      else status.textContent=recordingUnchanged?tr('录音和发送权限未更改。','Recording and sending permissions are unchanged.'):tr('录音已更新。保存勾选后，角色才能发送。','Recording updated. Select and save it to allow sending.');
    }catch{if(shown===start)status.textContent=tr('未保存。请关闭后重新核对搭档和素材。','Could not save. Reopen to review the companion and selections.');}
    finally{
      busy=false;form.removeAttribute('aria-busy');list.disabled=false;groupVoice.disabled=false;for(const b of [...extra.children,...actions.children])b.disabled=false;
      if(dialog.open&&focusAfterWrite?.isConnected)focusAfterWrite.focus();
    }
  }
  async function showPreview(start,target,image,hint){
    const sticker=start.v.namedSticker;
    try{
      const result=await window.arcade.botOwnerSelectedStickerPreview({...target,expectedImage:sticker.sha256});
      if(shown!==start||!image.isConnected)return;
      if(result?.sha256!==sticker.sha256||typeof result.dataUrl!=='string'||result.dataUrl.length>710000||
        !/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(result.dataUrl))throw Error('Preview unavailable');
      image.src=result.dataUrl;await image.decode();
      if(shown===start&&image.isConnected)image.hidden=false;
    }catch{if(shown===start&&image.isConnected)hint.textContent=tr('预览读取失败，可重新打开图库选择。','Preview unavailable. Reopen the library to choose a sticker.');}
  }
  function stickerControls(id){
    const start=shown,{v,...profile}=start,sticker=v.namedSticker,target={...profile,...recipient(v)};
    const controls=el('div','owner-sticker-controls'),buttons=el('div','qq-media-actions');
    const choose=button('qq-owner-media-library',tr('从角色表情库选择','Choose from character stickers'),()=>{
      if(busy||shown!==start)return;
      const roleName=v.roleId==='claude-ju'?tr('橘娘','Ju'):tr('鲸鱼娘','Whale');
      window.ArcadeQQNamedStickerPicker.open({audience:'owner',target,roleName,language:latest?.config?.language==='en'?'en':'zh',
        opener:choose,previous:sticker,granted:v.selected.includes(id),
        current:()=>dialog.open&&shown===start&&!busy&&choose.isConnected,apply:item=>apply('selectSticker',item)});
    });
    if(sticker){
      const figure=el('div','owner-sticker-selected'),image=el('img'),hint=el('span','',sticker.width+' × '+sticker.height+' px');
      image.id='qq-owner-sticker-preview';image.alt=sticker.name;image.hidden=true;figure.append(image,hint);controls.append(figure);
      void showPreview(start,target,image,hint);
    }
    buttons.append(choose);
    if(sticker)buttons.append(button('qq-owner-media-restore-sticker',tr('清除偏好','Clear preference'),()=>apply('restoreSticker')));
    controls.append(buttons);return controls;
  }
  function draw(selection=shown.v.selected){
    const v=shown.v;title.textContent=tr('主人私聊素材','Owner chat media');legend.textContent=tr('允许角色自行发送','Allow this companion to send');
    note.textContent=tr('私聊素材用于主人 QQ '+v.ownerId+'。音色可供同角色的群聊使用，每个群须单独允许语音；换了群角色时，请在该群查看语音选项。','Private chat media is for QQ '+v.ownerId+'. Groups using the same role can use its voice once voice is allowed in each group. If a group uses another role, check that group’s voice options.');
    groupVoice.textContent=tr('设置这个搭档的群语音','Set up this companion’s group voice');
    groupVoice.hidden=typeof window.ArcadeQQDailySettings?.open!=='function'||!shown.profileId||
      latest?.bot?.qq?.expectedAccountId!==v.accountId;
    options.replaceChildren();extra.replaceChildren();actions.replaceChildren();
    if(voice)void voice.bind(shown);
    for(const id of v.available){
      if(voice&&voiceAsset(id))continue;
      if(id.endsWith('-sticker')){options.append(stickerControls(id));continue;}
      const line=el('label','social-toggle'),box=el('input');box.type='checkbox';box.value=id;box.checked=selection.includes(id);box.disabled=id==='whale-recording'&&!v.recording;
      const caption=tr(...labels[id]);
      line.append(box,el('span','',caption));options.append(line);
    }
    if(!voice&&v.roleId==='deepseek-whale'){
      extra.append(button('qq-owner-media-wav',tr(v.recording?'更换固定录音':'选择固定录音',v.recording?'Replace recording':'Choose recording'),()=>apply('choose')));
      if(v.recording){extra.append(el('span','',v.recording.durationSeconds.toFixed(1)+' s'),button('qq-owner-media-remove-wav',tr('移除录音','Remove recording'),()=>apply('remove')));}
    }
    actions.append(button('qq-owner-media-save',tr('保存私聊素材','Save for owner chat'),()=>apply('select')),button('qq-owner-media-close',tr('关闭','Close'),close));
  }
  form.onsubmit=e=>{e.preventDefault();void apply('select');};
  open.onclick=()=>{if(busy)return;shown=context(latest);if(!shown)return;dialog.showModal();draw();status.textContent='';};
  dialog.addEventListener('close',()=>{if(!dialog.open){voice?.clear();shown=null;window.ArcadeQQNamedStickerPicker?.sync();}});
  const before=window.renderBot;
  window.renderBot=data=>{
    before?.(data);const previous=context(latest);latest=data;const current=context(data);
    open.hidden=!current?.v.available.length;open.textContent=tr('私聊素材','Owner chat media');
    if(!dialog.open)return;
    if(identity(current)!==identity(shown)||typeof view!=='undefined'&&view!=='bot'){close();return;}
    if(!busy&&previous?.v.revision!==current.v.revision&&current.v.revision!==shown.v.revision){
      shown=current;window.ArcadeQQNamedStickerPicker?.sync();draw();
      status.textContent=tr('素材设置已变更，请核对当前选项。','Media settings changed. Review the current selection.');
    }
  };
  if(typeof data!=='undefined'&&data)window.renderBot(data);
})();
