'use strict';

// Browsing is read-only. Only Use changes the sticker for the displayed recipient.
(() => {
  const dialog=document.createElement('dialog');
  dialog.id='qq-group-named-sticker-picker';
  dialog.setAttribute('aria-labelledby','qq-sticker-picker-title');
  dialog.innerHTML=`<h2 id="qq-sticker-picker-title"></h2><p class="qq-picker-target"></p>
    <label for="qq-sticker-picker-list"></label><select id="qq-sticker-picker-list"></select>
    <button type="button" class="plain qq-picker-more" hidden></button>
    <img class="qq-picker-image" hidden><p class="qq-picker-status" role="status"></p>
    <div class="qq-picker-actions"><button type="button" class="secondary qq-picker-close"></button>
    <button type="button" class="primary qq-picker-use" disabled></button></div>`;
  document.body.append(dialog);
  const find=selector=>dialog.querySelector(selector),select=find('select'),image=find('img');
  const status=find('.qq-picker-status'),more=find('.qq-picker-more'),use=find('.qq-picker-use'),cancel=find('.qq-picker-close');
  let session=null;
  const tr=(zh,en)=>session?.language==='zh'?zh:en;
  function close(){
    const s=session;
    session=null;image.removeAttribute('src');image.hidden=true;select.replaceChildren();
    if(dialog.open)dialog.close();
    if(s?.current()&&s.opener.isConnected)s.opener.focus({preventScroll:true});
  }
  function current(s){
    if(session!==s)return false;
    if(s.current())return true;
    close();return false;
  }
  function selected(s){return s.items[select.selectedIndex];}
  async function preview(){
    const s=session,item=s&&selected(s),read={};
    if(!s||!current(s))return;
    s.read=read;s.ready=null;image.hidden=true;image.removeAttribute('src');use.disabled=true;
    if(!item)return;
    const same=()=>current(s)&&s.read===read&&selected(s)===item;
    status.textContent=tr('正在读取这张表情…','Loading this sticker…');
    try{
      const result=await s.previewSticker({...s.target,name:item.name,sourceSha256:item.sha256});
      if(!same())return;
      if(result?.ok!==true||result.sourceSha256!==item.sha256||![result.width,result.height].every(n=>Number.isInteger(n)&&n>0&&n<=2048)||
        typeof result.dataUrl!=='string'||result.dataUrl.length>710000||
        !/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(result.dataUrl))throw Error('Preview unavailable');
      image.src=result.dataUrl;await image.decode();
      if(!same())return;
      image.alt=item.name;image.hidden=false;s.ready=item;
      const already=s.previous?.name===item.name&&s.previous.sourceSha256===item.sha256;
      use.disabled=already;
      const destination=s.owner?tr('私聊发送 ','Sent to the owner at '):tr('本群发送 ','Sent to this group at ');
      const dimensions=destination+result.width+' × '+result.height+' px';
      const original=result.resizedForBytes?tr('图库原图 ','Library original ')+result.sourceWidth+' × '+result.sourceHeight+' px · ':'';
      const detail=already?tr('已设为偏好。','Already preferred.'):
        tr('角色会按聊天内容挑图；这张可设为偏好。','The companion chooses based on the chat. You can mark this sticker as preferred.');
      status.textContent=original+dimensions+' · '+detail;
      if (Array.isArray(s.collection)) {
        const included=s.collection.some(row=>row.name===item.name&&row.sourceSha256===item.sha256);
        use.disabled=included;
        status.textContent=original+dimensions+(included?tr(' · 已设为本群偏好。',' · Already preferred for this group.'):'');
      }
    }catch{
      if(!same())return;
      image.hidden=true;image.removeAttribute('src');
      status.textContent=tr('未能读取这张表情。请重新打开表情库再试。','This sticker could not be read. Reopen the library and try again.');
    }
  }
  async function list(s,after){
    more.disabled=true;
    try{
      const result=await s.listStickers({...s.target,...(after?{after}:{})});
      if(!current(s))return;
      if(result?.ok!==true||!Array.isArray(result.items))throw Error('Library unavailable');
      for(const item of result.items){
        select.add(new Option(item.name,String(s.items.length)));s.items.push(item);
      }
      s.after=result.nextAfter;more.hidden=!s.after;
      if(!s.items.length){
        select.disabled=true;
        status.textContent=tr('这个角色还没有命名表情。可先到 App 对话的角色表情库保存一张。','This character has no named stickers yet. Save one in the App conversation first.');
      }else if(!after){
        select.disabled=false;
        select.selectedIndex=Math.max(0,s.items.findIndex(item=>item.name===s.previous?.name&&item.sha256===s.previous?.sourceSha256));
        await preview();
      }
    }catch{
      if(current(s))status.textContent=tr('未能读取此角色的表情库。请关闭后重试。','Could not read this character’s library. Close and retry.');
    }finally{if(current(s))more.disabled=false;}
  }
  function open(options){
    if(session)close();
    const owner=options.audience==='owner';
    const s={...options,owner,items:[],
      previewSticker:owner?window.arcade.botOwnerNamedStickerPreview:window.arcade.botGroupNamedStickerPreview,
      listStickers:owner?window.arcade.botOwnerNamedStickerList:window.arcade.botGroupNamedStickerList};session=s;
    find('h2').textContent=tr('从角色表情库选择','Choose a character sticker');
    find('.qq-picker-target').textContent=options.roleName+' · '+(owner?tr('主人 QQ ','Owner QQ ')+options.target.ownerId:tr('群 ','Group ')+options.target.groupId);
    find('label').textContent=tr('已保存的表情','Saved stickers');
    more.textContent=tr('加载更多表情','Load more stickers');more.hidden=true;
    cancel.textContent=tr('取消','Cancel');use.textContent=tr('设为偏好','Set as preferred');
    select.disabled=true;use.disabled=true;status.textContent=tr('正在读取表情库…','Loading the library…');
    dialog.showModal();cancel.focus();void list(s);
  }
  select.onchange=preview;
  more.onclick=()=>{if(session?.after&&!more.disabled)void list(session,session.after);};
  cancel.onclick=close;
  use.onclick=()=>{
    const s=session;
    if(!s||!current(s)||use.disabled||!s.ready||s.ready!==selected(s))return;
    const item=s.ready;
    const allowed=Array.isArray(s.collection)?{request:false,reaction:false}:undefined;
    close();s.apply(item,allowed);
  };
  dialog.addEventListener('cancel',event=>{event.preventDefault();close();});
  window.ArcadeQQNamedStickerPicker={open,sync(){if(session)current(session);}};
})();
