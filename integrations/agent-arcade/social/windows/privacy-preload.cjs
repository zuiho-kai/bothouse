'use strict';

const {ipcRenderer}=require('electron');
if(process.isMainFrame&&location.pathname==='/'&&!location.search){
  if(process.argv.includes('--arcade-friend-visits')){
    require('electron').contextBridge.exposeInMainWorld('arcadeWorldVisit',{
      open:({account,number})=>ipcRenderer.invoke('arcade:visitFriend',{account,number}),
    });
  }
  const versionArgument='--arcade-feedback-desktop-version=';
  const desktopVersion=process.argv.find(arg=>arg.startsWith(versionArgument))?.slice(versionArgument.length);
  document.addEventListener('DOMContentLoaded',()=>{
    document.documentElement.dataset.arcadeGroupCardPicker='available';
    document.documentElement.dataset.arcadeGroupLorebookPicker='available';
    document.documentElement.dataset.arcadePersonalCardPicker='direct-portrait';
    if(process.argv.includes('--arcade-chat-crop'))document.documentElement.dataset.arcadeChatCrop='available';
    if(desktopVersion)document.documentElement.dataset.arcadeFeedbackDesktopVersion=desktopVersion;
  },{once:true});
  let snipRequest=0;
  document.addEventListener('click',async event=>{
    const screenshot=event.target?.closest?.('button#chat-screenshot');
    if(screenshot && event.isTrusted && event.button===0 && !screenshot.disabled && !screenshot.hidden){
      const request=String(++snipRequest),address=location.href;
      screenshot.dataset.arcadeSnipRequest=request;
      let started=false;
      try{started=await ipcRenderer.invoke('arcade:startChatSnip')===true;}catch{}
      // Let the initiating click open its preview even if IPC resolves immediately.
      setTimeout(()=>{
        if(screenshot.isConnected&&location.href===address)
          screenshot.dispatchEvent(new CustomEvent('arcade-chat-snip-result',{detail:JSON.stringify({request,started})}));
      },0);
      return;
    }
    const crop=event.target?.closest?.('button[data-chat-crop]');
    if(crop && event.isTrusted && event.button===0 && !crop.disabled && !crop.hidden &&
        process.argv.includes('--arcade-chat-crop')){
      const dialog=crop.closest('dialog[open]'), input=crop.form?.querySelector('input[type=file]');
      if(!dialog || !input)return;
      const address=location.href;
      const current=()=>location.href===address && crop.isConnected && dialog.open && crop.form?.contains(input);
      const observer=new MutationObserver(()=>{
        if(!current())ipcRenderer.send('arcade:cancelChatCrop');
      });
      observer.observe(dialog,{attributes:true,attributeFilter:['open'],childList:true,subtree:true});
      crop.disabled=true;
      try{
        const bytes=await ipcRenderer.invoke('arcade:pickChatCrop');
        if(bytes?.length && current()){
          const transfer=new DataTransfer();
          transfer.items.add(new File([bytes],'截图.png',{type:'image/png'}));
          input.files=transfer.files;
          input.dispatchEvent(new Event('change',{bubbles:true}));
        }
      }catch{
        if(current())crop.dispatchEvent(new Event('arcade-crop-failed'));
      }finally{observer.disconnect();crop.disabled=false;}
      return;
    }
    const button=event.target?.closest?.('button[data-arcade-group-card-picker]');
    if(!button||!event.isTrusted||event.button!==0||button.disabled)return;
    const {groupId,roleId,roleRevision,kind,cardScope}=button.dataset;
    const personal=cardScope==='personal'||cardScope==='personal-direct', address=location.href;
    const current=()=>button.isConnected&&button.dataset.groupId===groupId&&button.dataset.roleId===roleId&&
      location.pathname==='/'&&!location.search&&location.href===address&&(personal||location.hash==='#chat/'+groupId);
    if(!current())return;
    let card=null;
    try{card=await ipcRenderer.invoke('arcade:pickGroupCard',{groupId,roleId,roleRevision,
      ...(personal&&{scope:cardScope}),...(kind==='lorebook'&&{kind})});}catch{}
    if(current())button.dispatchEvent(new CustomEvent('arcade-group-card-picked',{bubbles:true,detail:JSON.stringify({groupId,roleId,card})}));
  },{capture:true});
}
const onPrivacyPage=()=>process.isMainFrame&&location.pathname==='/privacy.html'&&!location.search&&(!location.hash||location.hash==='#privacy-contact');
if(onPrivacyPage()){
  document.addEventListener('DOMContentLoaded',()=>{
    document.documentElement.dataset.arcadePrivacyLink='https';
  },{once:true});
  document.addEventListener('click',async event=>{
    const link=event.target?.closest?.('a#open-privacy-contact');
    if(!onPrivacyPage()||!event.isTrusted||event.button!==0||link?.protocol!=='https:'||link.hidden)return;
    event.preventDefault();
    let opened=false;
    try { opened=await ipcRenderer.invoke('arcade:openPrivacySupport',link.href); } catch {}
    const status=document.querySelector('#privacy-copy-status');
    if(status)status.textContent=opened?'已请求用系统浏览器打开。':'未能打开支持网页，可复制联系方式。';
  },{capture:true});
}
