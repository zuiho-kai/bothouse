'use strict';
// Open the controls already owned by Conversation settings. This module only
// navigates; the controls keep their existing save, permission and lock rules.
(() => {
  const sections={ai:null,qq:'qq-groups',bridge:'channel',backend:'advanced'};
  const qqKinds=new Set(['qq','bridge']);
  const byId=id=>document.getElementById(id);
  let visit=null;

  function release(){
    visit?.listeners.abort();
    visit=null;
  }
  function focusField(target,panel){
    if(!target)return;
    for(let node=target.parentElement;node&&node!==panel;node=node.parentElement){
      if(node.tagName==='DETAILS')node.open=true;
    }
    target.scrollIntoView({block:'center'});target.focus({preventScroll:true});
  }
  function sync(data,view){
    if(!visit)return;
    if(view!==visit.view||visit.profileId!==data?.accounts?.selectedId||visit.channel!==data?.bot?.channel||
        (qqKinds.has(visit.kind)&&visit.qqAccount!==data.bot.qq?.expectedAccountId))release();
  }
  function open(kind,{data,returnToSettings}={}){
    if(!Object.hasOwn(sections,kind)||!data?.bot||typeof returnToSettings!=='function'||typeof window.openConversationSetup!=='function')return false;
    const panel=byId('bot-setup-panel'),profileId=data.accounts?.selectedId;
    const daily=kind==='qq'&&window.ArcadeQQDailySettings?byId('qq-daily-group-settings'):null;
    // The daily dialog supplies an explicit profile picker when the current
    // profile has no ordinary QQ account; legacy controls require that account.
    if(qqKinds.has(kind)&&daily?.tagName!=='DIALOG'){
      const selected=data.accounts?.accounts?.find(row=>row.id===profileId);
      if(!selected||selected.channel!=='qq'||data.bot.channel!=='qq')return false;
    }
    const mode=byId('bot-mode'),bridge=byId('bot-qq-advanced');
    if(kind==='ai'&&!mode||kind==='bridge'&&!bridge)return false;

    release();
    // The daily editor remains over Settings and restores the caller's focus
    // itself. Its close must not reset the current settings category or take
    // navigation back from its own "Open companion connection settings" link.
    if(kind==='qq'&&window.ArcadeQQDailySettings){
      const returnFocus=byId('settings-nav-qq');
      if(daily?.tagName!=='DIALOG'||!returnFocus?.isConnected||document.body.dataset.view!=='settings')return false;
      const opened=window.openConversationSetup({section:'qq-groups',returnFocus});
      return opened===true&&daily.open;
    }
    if(!panel)return false;
    const fromSettings=document.body.dataset.view==='settings';
    if(kind==='ai')window.openConversationSetup();
    else window.openConversationSetup({section:sections[kind]});
    const listeners=new AbortController(),{signal}=listeners;
    const current={listeners,kind,profileId,channel:data.bot.channel,qqAccount:data.bot.qq?.expectedAccountId,view:document.body.dataset.view};
    if(current.view!=='bot'||!panel.open)return false;
    visit=current;
    // A status update or a different destination can also close this details
    // element. Only the user's own close, summary toggle or Escape returns.
    let userClosed=false;
    document.addEventListener('click',event=>{
      const control=event.target.closest('button,summary');
      userClosed=panel.open&&(control===byId('bot-settings-close')||control===byId('bot-settings-toggle')||control===panel.querySelector(':scope > summary'));
    },{capture:true,signal});
    panel.addEventListener('keydown',event=>{
      if(event.key==='Escape'&&!event.defaultPrevented)userClosed=true;
    },{capture:true,signal});
    if(fromSettings)document.addEventListener('keydown',event=>{
      if(event.key!=='Escape'||event.defaultPrevented||visit!==current||document.body.dataset.view!=='bot'||!panel.open||!panel.isConnected)return;
      // Disabling a focused Save button can leave keyboard focus on the page.
      const focus=document.activeElement;
      if((focus!==document.body&&focus!==document.documentElement)||(event.target!==document.body&&event.target!==document.documentElement)||document.querySelector('dialog[open]'))return;
      const close=byId('bot-settings-close');
      if(!close?.isConnected||close.disabled)return;
      event.preventDefault();
      close.click();
    },{signal});
    panel.addEventListener('toggle',()=>{
      if(visit!==current||panel.open)return;
      release();
      if(userClosed&&document.body.dataset.view==='bot')returnToSettings();
    },{signal});

    if(kind==='ai'){
      const target=mode.disabled?document.querySelector('label[for="bot-mode"]'):mode;
      if(target&&mode.disabled)target.tabIndex=-1;
      focusField(target,panel);
    }
    if(kind==='bridge'){
      bridge.open=true;
      const url=byId('bot-qq-url'),target=url&&!url.disabled?url:bridge.querySelector('summary');
      focusField(target,panel);
    }
    return true;
  }
  window.ArcadeSettingsDestinations=Object.freeze({open,sync});
})();
