'use strict';

// One saved collection per approved QQ account, group and role. Reading a thumbnail never grants a use.
window.ArcadeQQStickerCollection = {
  create({zh, addButton, onRemove, loadPreview}) {
    const t=(chinese,english)=>zh?chinese:english;
    const make=(tag,text)=>{const node=document.createElement(tag);if(text)node.textContent=text;return node;};
    const section=make('section');section.className='qq-sticker-collection';section.dataset.stickerCollection='';
    const heading=make('h5',t('本群表情偏好','Group sticker preferences'));
    const label=make('label',t('偏好的表情','Preferred stickers')),select=make('select');
    select.dataset.collectionItem='';label.append(select);
    const preview=make('div');preview.className='qq-card-image-selection';
    const image=make('img');image.className='qq-card-image-preview';image.dataset.collectionPreview='';image.hidden=true;
    const detail=make('small'),retry=make('button',t('重试预览','Retry preview'));
    retry.type='button';retry.className='plain';retry.hidden=true;
    const caption=make('div');caption.append(detail,retry);preview.append(image,caption);
    const remove=make('button',t('移除偏好','Remove preference'));
    remove.type='button';remove.className='plain';remove.dataset.collectionRemove='';
    const actions=make('div');actions.className='qq-actions';actions.append(addButton,remove);
    const empty=make('small',t('角色会从表情库自动挑图，可选设偏好。','The companion picks from its library automatically. Preferences are optional.'));
    section.append(heading,empty,label,preview,actions);

    let state=null,listKey='',read=null;
    const selected=()=>state?.items.find(row=>row.id===select.value);
    function renderItem() {
      const item=selected();
      empty.hidden=!!item;
      for(const node of [label,preview,remove])node.hidden=!item;
      if(!item||!state.visible){
        read=null;image.hidden=true;image.removeAttribute('src');detail.textContent='';retry.hidden=true;return;
      }
      const key=JSON.stringify([state.scope,state.revision,item.id,item.sha256]);
      if(read?.key===key)return;
      const token=read={key};image.hidden=true;image.removeAttribute('src');retry.hidden=true;
      detail.textContent=t('正在读取预览…','Loading preview…');
      const current=()=>read===token&&section.isConnected&&selected()?.id===item.id;
      loadPreview(item).then(async result=>{
        if(!current())return;
        if(result?.sha256!==item.sha256||typeof result.dataUrl!=='string'||result.dataUrl.length>710000||
            !/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(result.dataUrl))throw Error('Preview unavailable');
        image.src=result.dataUrl;await image.decode();
        if(!current())return;
        image.alt=item.name;image.hidden=false;detail.textContent=item.name+' · '+item.width+' × '+item.height;
      }).catch(()=>{
        if(!current())return;
        image.hidden=true;image.removeAttribute('src');retry.hidden=false;
        detail.textContent=t('未能读取这张图。','This picture could not be read.');
      });
    }
    select.onchange=event=>{event.stopPropagation();renderItem();};
    remove.onclick=()=>{const item=selected();if(item)onRemove(item);};
    retry.onclick=()=>{read=null;renderItem();};
    return {
      element:section,
      update(next) {
        const sameScope=state?.scope===next.scope;
        state=next;section.hidden=!Array.isArray(next.items);
        if(section.hidden){read=null;image.removeAttribute('src');return;}
        const names=JSON.stringify([next.scope,next.items.map(item=>[item.id,item.name])]);
        if(listKey!==names||next.prefer){
          const prior=sameScope?select.value:'';
          if(listKey!==names)select.replaceChildren(...next.items.map(item=>new Option(item.name,item.id)));
          const desired=next.prefer||prior;
          select.value=next.items.some(item=>item.id===desired)?desired:next.items[0]?.id||'';
          listKey=names;
        }
        const full=next.items.length>=next.limit;
        addButton.disabled=full;addButton.title=full?t('本群已达到命名表情数量上限。','This group has reached its sticker limit.'):'';
        renderItem();
      }
    };
  }
};
