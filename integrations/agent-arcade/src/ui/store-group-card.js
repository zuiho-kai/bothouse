'use strict';

const ui=id=>document.getElementById(id);
const card=ui('card'),accept=ui('accept'),cancel=ui('cancel'),notice=ui('notice');
const sharePortrait=ui('share-portrait'),portraitImage=ui('portrait-image');
let version=0,reviewingBook=false,personalReview=false,directReview=false;
sharePortrait.onchange=()=>{accept.textContent=directReview?(sharePortrait.checked?'批准卡面并保存到私聊':reviewingBook?'带回私聊世界书预览':'带回私聊角色预览'):personalReview?'带回公开角色预览':
  sharePortrait.checked?'批准卡面并保存到本群':'将所选内容带到群设置';};
cancel.onclick=()=>window.cardReview.cancel();
document.addEventListener('keydown',event=>{if(event.key==='Escape')cancel.click();});
async function choose(){
  const request=++version,id=card.value;
  ui('preview').hidden=true;
  ui('portrait').hidden=true;
  portraitImage.removeAttribute('src');
  sharePortrait.checked=false;
  sharePortrait.onchange();
  accept.disabled=true;
  notice.textContent='';
  if(!id)return;
  try{
    const details=await window.cardReview.preview(id);
    if(request!==version||!details)return;
    for(const field of ['name','description','examples'])ui(field).textContent=details[field]||'未填写';
    ui('entries').replaceChildren();
    for(const [index,entry] of details.entries.entries()){
      const row=document.createElement('label'),check=document.createElement('input'),content=document.createElement('span');
      row.className='entry';
      check.type='checkbox';
      check.value=String(index);
      if(reviewingBook)check.onchange=()=>{accept.disabled=!ui('entries').querySelector('input:checked');};
      content.textContent=entry.content;
      row.append(check,document.createTextNode(entry.keys.length?'提到 '+entry.keys.join('、'):'每次回答'),content);
      ui('entries').append(row);
    }
    ui('book-info').textContent=(details.entries.length?'只带入勾选的条目，最多 12 条。':'没有可勾选的条目。')+
      (details.omitted?' 另有 '+details.omitted+' 条含特殊规则或超出长度，将留在本机。':'');
    if(details.portrait){
      portraitImage.src='data:image/png;base64,'+details.portrait;
      ui('portrait').hidden=false;
      if(directReview){sharePortrait.checked=true;sharePortrait.onchange();}
    }
    ui('preview').hidden=false;
    accept.disabled=reviewingBook;
  }catch{if(request===version)notice.textContent=reviewingBook?'这本世界书暂时读不到，请重新选择。':'这张卡暂时读不到，请重新选择。';}
}
card.onchange=choose;
accept.onclick=async()=>{
  const indexes=[...ui('entries').querySelectorAll('input:checked')].map(check=>Number(check.value));
  if(indexes.length>12){notice.textContent='最多带入 12 个条目，请减少勾选。';return;}
  accept.disabled=true;
  try{if(await window.cardReview.accept(card.value,indexes,sharePortrait.checked))return;}catch{}
  await choose();
  notice.textContent='本机资料已变化，请核对后重新选择。';
};
async function start(){
  try{
    const {target,cards}=await window.cardReview.list();
    reviewingBook=target.kind==='lorebook';
    personalReview=target.personal===true;
    directReview=personalReview&&target.direct===true;
    if(directReview){
      ui('portrait-permission').textContent='授权在私聊绘制本角色时参考这张卡面';
      ui('portrait-note').textContent='保存后，你或已获准云聊天的好友请它画自己时，好友服务会把这张去除卡内数据的图片交给 Cloudflare Workers AI。可随时更换或关闭。';
    }
    if(reviewingBook){
      document.title=ui('review-title').textContent='选择本机世界书';
      ui('library-label').textContent='本机世界书库';
      card.options[0].textContent='选择一本书';
      ui('card-details').hidden=true;
      ui('entries-title').textContent='可分享的世界书条目';
    }
    ui('target').textContent=directReview
      ? '为你的 AI '+target.roleName+' 选择私聊资料，回到「私聊角色设定」保存后，在获准云聊天的私聊中使用。'
      : target.personal
        ? '为你的 AI '+target.roleName+' 选择公开资料，回到「群聊角色设定」确认后，在它获准加入的群里生效。'
      : target.account+' 将以下内容交给「'+target.groupTitle+'」中的 '+target.roleName+'（'+target.roleId+'）。保存到本群后生效。';
    sharePortrait.onchange();
    for(const row of cards)card.add(new Option(row.name,row.id));
    if(!cards.length)notice.textContent=(reviewingBook?'世界书库是空的。先到「陪伴 → 角色 → 世界书」导入。':
      '角色库是空的。先到「陪伴 → 角色」添加角色。')+(personalReview?' 再回到角色设定。':' 再回到群设置。');
    card.focus();
  }catch{notice.textContent='暂时读不到本机资料库。请取消后重试。';}
}
void start();
