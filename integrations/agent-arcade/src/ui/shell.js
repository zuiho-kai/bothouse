'use strict';
// Application shell shared by every layout: the top bar (logo, workspace switch, navigation,
// quiet / language / compact / layout / accent / settings), the channel sub-navigation, the
// Notices page and the Interface settings card. Presentation only: views are still switched by
// app.js switchView(), and every legacy control keeps its id and handler.
//
//  window.ArcadeShell
//    WORKSPACE_OF            view name -> 'companion' | 'work' (settings belongs to neither)
//    open(view)              switch view (and with it, the workspace)
//    setWorkspace(name)      switch workspace, return to its last view, remember the choice
//    layoutChoice(large)     -> {node, sync(data)}   the three-layout picker
//    accentControl()         -> {node, sync(data)}   follow-character / presets / custom colour
//    icon(paths, box)        small inline SVG built with DOM APIs
//  Layout modules receive a context from renderShell:
//    {view, workspace, language, zh, tr(zh,en), target, bar, main}
(() => {
  const NS='http://www.w3.org/2000/svg';
  const WORKSPACE_OF={bot:'companion',characters:'companion',relationship:'companion',notices:'companion',notes:'companion',tasks:'work',scene:'work',work:'work',connections:'work',accounts:'work','qq-runtime':'work'};
  const ORDER={companion:['bot','characters','relationship','notes','notices'],work:['scene','tasks','work','connections']};
  const CHANNEL=['connections','accounts','qq-runtime'];
  const LABELS={bot:['对话','Chat'],characters:['角色','Characters'],relationship:['相处','Together'],notices:['提醒','Notices'],notes:['笔记','Notes'],tasks:['任务','Tasks'],scene:['会话','Sessions'],work:['工作与结果','Work & results'],connections:['渠道','Channels'],accounts:['搭档与账号','Companions'],'qq-runtime':['QQ 账号','QQ accounts'],settings:['设置','Settings']};
  const LAYOUTS=[
    {id:'immersive',name:['沉浸','Immersive'],note:['角色立绘铺满舞台，对话在右侧的玻璃栏里。','Character art fills the stage; the conversation sits in a glass column.']},
    {id:'messenger',name:['聊天','Messenger'],note:['左边是会话列表，像平时用的聊天软件。','A conversation list on the left, like a familiar messenger.']},
    {id:'minimal',name:['简洁','Minimal'],note:['居中的单栏，只留下文字。','One centred column that keeps to the text.']},
  ];
  const PRESET_NAMES=[['橘','Orange'],['珊瑚红','Coral'],['粉','Pink'],['紫','Violet'],['蓝','Blue'],['青','Teal'],['绿','Green'],['灰','Grey']];
  let zh=true,currentWs=null,lastConfigWs=null,latest=null;
  const remembered={companion:'bot',work:'scene'};
  const tr=(a,b)=>zh?a:b;
  const pair=value=>tr(value[0],value[1]);
  function icon(shapes,box='0 0 24 24',size=18){
    const svg=document.createElementNS(NS,'svg');
    for(const [k,v] of Object.entries({viewBox:box,width:size,height:size,fill:'none',stroke:'currentColor','stroke-width':'1.65','stroke-linecap':'round','stroke-linejoin':'round','aria-hidden':'true'}))svg.setAttribute(k,v);
    for(const shape of shapes){const [tag,attributes]=typeof shape==='string'?['path',{d:shape}]:shape,node=document.createElementNS(NS,tag);for(const [k,v] of Object.entries(attributes))node.setAttribute(k,String(v));svg.append(node);}
    return svg;
  }
  const setText=(node,text)=>{if(node&&node.textContent!==text)node.textContent=text;};
  const label=(node,text)=>{if(!node)return;if(node.getAttribute('aria-label')!==text)node.setAttribute('aria-label',text);if(node.title!==text)node.title=text;};

  // ---- bar ----
  const bar=el('div','shell-bar');bar.id='shell-bar';bar.setAttribute('role','banner');
  const sidebar=document.querySelector('aside.sidebar'),nav=document.querySelector('nav'),main=document.querySelector('main');
  const brand=document.querySelector('.brand')||el('div','brand');brand.classList.add('shell-brand');
  const ws=el('div','shell-ws');ws.setAttribute('role','group');
  const wsButtons={};
  for(const name of ['companion','work']){const b=el('button','shell-ws-button');b.type='button';b.id='ws-'+name;b.dataset.workspace=name;b.onclick=()=>setWorkspace(name);wsButtons[name]=b;ws.append(b);}
  const storeSocial=window.arcade?.storeSocial;
  let socialActive=false, socialEpoch=0;
  let socialButton, socialStatus, socialCopy, socialRetry, socialMore, socialMenu, imageReturn, imageFeedbackReturn;
  let supportData, supportPanel, supportLabel, supportAddress, supportCopy, supportStatus;
  const socialTools=[];
  let bothouseActive=false,bothouseEpoch=0,bothousePanel,bothouseBack,bothouseCopy,bothouseRetry,bothouseChoose;
  let worldActive=false,residentStrip,residentButton,residentRetry,residentNote,residentState,residentBusy=false;
  const residentMessages={
    ready:['访客可见本账号已获准角色的名称、形象和活动。','Visitors can see the names, appearances and activity of your authorized AI.'],
    home:['请先回到自己的星球。','Land on your own planet first.'],
    connected:['已连接，返回聊天后仍会同步。','Connected. Sync continues while you chat.'],
    disconnected:['已从本星球移除这组居民。','These residents have been removed from this planet.'],
    paused:['居民同步已暂停。','Resident sync is paused.'],
    roles:['请先在通讯录连接可用的 Bothouse 角色。','Connect an authorized Bothouse role in Contacts first.'],
    other:['这个账号或星球已有其他连接，请在原档案核对。','A different connection exists. Check the original profile.'],
    unavailable:['暂时连不上居民发布服务，请重试。','Could not reach the resident publisher. Try again.'],
    configuration:['请让主机管理员核对本世界的居民发布配置。','Ask the host to check publishing for this world.'],
    login:['好友账号已变，请返回消息后重开。','The Friends account changed. Return to messages and reopen.'],
    session:['请在游戏中进入自己的星球后再试。','Enter your planet in the game and try again.'],
    capacity:['发布服务正忙，请稍后重试。','The publisher is busy. Try again shortly.'],
    busy:['正在同步…','Syncing…']
  };
  function drawResidents(){
    if(!residentStrip||residentStrip.hidden)return;
    const {state,connected}=residentState;
    residentButton.textContent=connected?tr('断开我的 AI','Disconnect my AI'):tr('连接我的 AI','Connect my AI');
    residentButton.disabled=residentBusy;
    residentRetry.textContent=tr('恢复同步','Resume sync');
    residentRetry.hidden=!connected||state==='connected';
    residentRetry.disabled=residentBusy;
    setText(residentNote,pair(residentMessages[residentBusy?'busy':state]||residentMessages.unavailable));
  }
  async function residentsAction(action){
    if(residentBusy||!worldActive||!bothouseActive)return;
    const visit=bothouseEpoch;
    residentBusy=true;drawResidents();
    try{
      const value=await window.arcade.storeBothouse({action:'residents-'+action});
      if(visit===bothouseEpoch&&bothouseActive&&worldActive && value?.state!=='closed'){
        residentState=value?.state?value:{state:'unavailable',connected:residentState.connected};
      }
    }catch{if(visit===bothouseEpoch)residentState={state:'unavailable',connected:residentState.connected};}
    finally{if(visit===bothouseEpoch){residentBusy=false;drawResidents();}}
  }
  const worldMessage={
    loading:['正在打开小星球…','Opening Little Worlds…'],
    login:['请先返回消息，登录好友账号后再进入小星球。','Return to messages and sign in before opening Little Worlds.'],
    'friends-offline':['暂时无法核对好友账号。请确认好友服务可用，再重试。','Could not verify your Friends account. Check the Friends service and retry.'],
    config:['尚未配置可用的小星球地址。','A valid Little Worlds address has not been configured.'],
    offline:['暂时打不开小星球。请确认世界服务已运行，再重试。','Little Worlds is unavailable. Check the world service and retry.'],
  };
  const bothouseMessage={
    loading:['正在核对本机 Bothouse…','Checking local Bothouse…'],
    config:['请选择已有的 Bothouse TOML 配置。管理服务须已开启，并写明回环地址和端口。','Choose an existing Bothouse TOML configuration with management enabled and an explicit loopback address and port.'],
    offline:['连不上本机 Bothouse。请确认它已运行，再重试。','Local Bothouse is unavailable. Check that it is running, then retry.'],
    identity:['本机监听程序与绑定不符。核对安装后，可重新选择配置。','The local listener does not match the trusted installation. Check the installation before choosing a configuration again.'],
    dashboard:['此服务未提供可登录的 Bothouse 管理界面。请检查安装与管理认证。','This service did not provide a sign-in dashboard. Check the Bothouse installation and management authentication.'],
    cancelled:['已取消打开 Bothouse。','Opening Bothouse was cancelled.'],
  };
  function paintBothouse(state){
    const messages=worldActive?worldMessage:bothouseMessage;
    const text=messages[state] || messages.offline;
    bothousePanel.hidden=state==='ready';
    bothouseCopy.textContent=pair(text);
    bothouseRetry.hidden=state==='loading'||state==='ready';
    bothouseChoose.hidden=worldActive||bothouseRetry.hidden;
  }
  async function showBothouse(action='open'){
    toggleSocialMenu(false,{focus:false});
    leaveSocial();
    bothouseActive=true;worldActive=action==='world';
    residentStrip.hidden=true;residentBusy=false;delete bar.dataset.worldResidents;
    const visit=++bothouseEpoch;
    document.documentElement.dataset.storeSocial='open';
    document.documentElement.dataset.storeBothouse='open';
    main.inert=true;
    bothouseBack.hidden=false;
    bothouseBack.focus({preventScroll:true});
    paintBothouse('loading');
    let state='offline';
    try{state=await window.arcade.storeBothouse({action,headerBottom:bar.getBoundingClientRect().bottom});}catch{}
    if(bothouseActive&&visit===bothouseEpoch){
      paintBothouse(state);
      if(worldActive&&state==='ready'){
        residentState={state:'ready',connected:false};
        residentStrip.hidden=false;bar.dataset.worldResidents='open';
        void residentsAction('open');
      }
    }
  }
  function leaveBothouse(){
    if(!bothouseActive)return;
    bothouseActive=false;++bothouseEpoch;
    residentStrip.hidden=true;residentBusy=false;delete bar.dataset.worldResidents;
    delete document.documentElement.dataset.storeBothouse;
    delete document.documentElement.dataset.storeSocial;
    main.inert=false;
    bothouseBack.hidden=true;bothousePanel.hidden=true;
    void window.arcade.storeBothouse({action:'close'}).catch(()=>{});
  }
  function paintSocialButtons(){
    for(const [name,button] of Object.entries(wsButtons))
      button.setAttribute('aria-pressed',String(!socialActive&&name===currentWs));
    socialButton?.setAttribute('aria-pressed',String(socialActive));
  }
  function socialState(state){
    socialStatus.hidden=state==='ready'||!socialActive;
    socialRetry.hidden=state!=='error';
    socialCopy.textContent=state==='error'
      ? tr('暂时无法连接好友服务。','Could not reach the Friends service.')
      : tr('正在打开消息…','Opening messages…');
    supportStatus.textContent='';
    drawSupport();
  }
  function drawSupport(){
    if(!supportPanel)return;
    const contact=supportData?.mode==='store'?supportData.contact:null;
    const test=supportData?.mode==='test';
    supportPanel.hidden=socialStatus.hidden||socialRetry.hidden||!(contact||test);
    supportLabel.textContent=test
      ? tr('如果重试仍失败，请联系发放此试用包的人。','If retrying fails, contact the person who gave you this test build.')
      : contact?tr('联系支持：','Support: ')+contact.name:'';
    supportAddress.setAttribute('aria-label',tr('公开支持联系方式','Public support contact'));
    supportAddress.value=contact?.label||'';
    supportCopy.textContent=tr('复制联系方式','Copy support contact');
    supportAddress.hidden=supportCopy.hidden=!contact;
  }
  function socialHeaderBottom(){return Math.max(bar.getBoundingClientRect().bottom,socialMenu?.getBoundingClientRect().bottom||0);}
  function fitSocial(){
    if(socialActive&&socialRetry.hidden)void storeSocial({active:true,headerBottom:socialHeaderBottom()}).catch(()=>{});
  }
  function toggleSocialMenu(open,{focus=true}={}){
    if(!socialMenu||socialMenu.hidden===!open)return;
    socialMenu.hidden=!open;
    socialMore.setAttribute('aria-expanded',String(open));
    fitSocial();
    if(focus)(open?socialTools[0].button:socialMore).focus({preventScroll:true});
  }
  function openLocalTool(destination){
    toggleSocialMenu(false,{focus:false});
    leaveSocial();
    destination();
    if(document.querySelector('dialog[open]'))return;
    const heading=main.querySelector('section.view:not([hidden]) :is(h1,h2)');
    const target=heading?.getClientRects().length?heading:main;
    target.tabIndex=-1;
    target.focus({preventScroll:true});
  }
  if(storeSocial){
    document.documentElement.dataset.storeShell='';
    socialButton=el('button','shell-ws-button');
    socialButton.type='button';socialButton.id='ws-social';socialButton.onclick=()=>void showSocial(true);
    socialMore=el('button','shell-ws-button');
    socialMore.type='button';socialMore.id='store-more';
    socialMore.setAttribute('aria-expanded','false');socialMore.setAttribute('aria-controls','store-local-tools');
    socialMore.setAttribute('aria-keyshortcuts','Control+Shift+M');
    socialMore.onclick=()=>toggleSocialMenu(socialMenu.hidden);
    socialMenu=el('section','store-local-tools');socialMenu.id='store-local-tools';socialMenu.hidden=true;
    socialMenu.setAttribute('role','group');
    function add(label,button,destination){
      button.type='button';
      button.onclick=()=>openLocalTool(destination);
      socialTools.push({label,button});socialMenu.append(button);
    }
    add(['陪伴','Companion'],wsButtons.companion,()=>open('bot'));
    add(['创作与图库','Create & gallery'],el('button','shell-ws-button'),()=>{
      open('bot');
      if(!window.ArcadeCharacterSticker?.openFromChat())open('characters');
    });
    add(['工作','Work'],wsButtons.work,()=>open('scene'));
    add(['设备','Devices'],el('button','shell-ws-button'),()=>{open('settings');settingsPage.choose('pets');});
    add(['渠道与账号','Channels & accounts'],el('button','shell-ws-button'),()=>open('connections'));
    add(['应用设置','App settings'],el('button','shell-ws-button'),()=>open('settings'));
    if(window.arcade.storeBothouse){
      const entry=el('button','shell-ws-button');entry.type='button';entry.id='store-bothouse';
      entry.onclick=()=>void showBothouse();
      socialTools.push({label:['Bothouse 管理','Bothouse management'],button:entry});
      socialMenu.append(entry);
      const world=el('button','shell-ws-button');world.type='button';world.id='store-world';
      world.onclick=()=>void showBothouse('world');
      socialTools.push({label:['小星球','Little Worlds'],button:world});socialMenu.append(world);
      bothouseBack=el('button','shell-ws-button');bothouseBack.type='button';bothouseBack.id='store-bothouse-back';
      bothouseBack.hidden=true;bothouseBack.onclick=()=>void showSocial(true);ws.append(bothouseBack);
      residentStrip=el('div','store-resident-controls');residentStrip.hidden=true;
      residentButton=el('button','shell-ws-button');residentButton.type='button';residentButton.id='store-residents';
      residentButton.onclick=()=>void residentsAction(residentState.connected?'disconnect':'connect');
      residentRetry=el('button','shell-ws-button');residentRetry.type='button';
      residentRetry.onclick=()=>void residentsAction('connect');
      residentNote=el('span','store-resident-note');residentNote.id='store-resident-status';residentNote.setAttribute('role','status');
      residentButton.setAttribute('aria-describedby',residentNote.id);
      residentStrip.append(residentButton,residentRetry,residentNote);bar.append(residentStrip);
      new ResizeObserver(()=>{if(!residentStrip.hidden&&bothouseActive&&worldActive){
        void window.arcade.storeBothouse({action:'world-layout',headerBottom:bar.getBoundingClientRect().bottom}).catch(()=>{});
      }}).observe(bar);
      bothousePanel=el('section','shell-social-status');bothousePanel.id='store-bothouse-panel';bothousePanel.hidden=true;
      bothouseCopy=el('p','');bothouseCopy.setAttribute('role','status');
      bothouseRetry=el('button','shell-ws-button');bothouseRetry.type='button';bothouseRetry.onclick=()=>void showBothouse(worldActive?'world':'open');
      bothouseChoose=el('button','shell-ws-button');bothouseChoose.type='button';bothouseChoose.onclick=()=>void showBothouse('choose');
      bothousePanel.append(bothouseCopy,bothouseRetry,bothouseChoose);document.body.append(bothousePanel);
      window.arcade.onStoreBothouseUnavailable?.(()=>{if(bothouseActive){residentStrip.hidden=true;delete bar.dataset.worldResidents;paintBothouse('offline');}});
      window.arcade.onStoreBothouseReturn?.(()=>{if(bothouseActive)void showSocial(true);});
    }
    imageReturn=el('button','shell-ws-button');
    imageReturn.type='button';imageReturn.id='store-image-feedback-return';imageReturn.hidden=true;
    imageReturn.onclick=()=>{
      const resume=imageFeedbackReturn;
      imageFeedbackReturn=undefined;
      leaveSocial();
      imageReturn.hidden=true;
      socialMore.hidden=false;
      resume?.();
    };
    ws.append(socialButton,imageReturn,socialMore);
    bar.append(socialMenu);
    bar.addEventListener('keydown',event=>{
      if(event.key==='Escape'&&!socialMenu.hidden){
        event.stopPropagation();event.preventDefault();toggleSocialMenu(false);
      }else if(event.key==='Escape'&&socialActive&&event.target===socialMore&&socialStatus.hidden){
        event.preventDefault();
        void storeSocial({active:true,headerBottom:socialHeaderBottom(),focus:true}).catch(()=>{});
      }
    });
    document.addEventListener('pointerdown',event=>{
      if(!socialMenu.contains(event.target)&&!socialMore.contains(event.target))toggleSocialMenu(false,{focus:false});
    });
    bar.addEventListener('focusout',event=>{
      if(event.relatedTarget&&!socialMenu.contains(event.relatedTarget)&&event.relatedTarget!==socialMore)
        toggleSocialMenu(false,{focus:false});
    });
    socialStatus=el('section','shell-social-status');
    socialStatus.hidden=true;
    socialCopy=el('p','');
    socialCopy.setAttribute('role','status');
    socialRetry=el('button','shell-ws-button','Retry');
    socialRetry.type='button';socialRetry.hidden=true;socialRetry.onclick=()=>void showSocial(true);
    supportPanel=el('div','shell-social-support');supportPanel.hidden=true;
    supportLabel=el('p','');
    supportAddress=el('textarea','');supportAddress.readOnly=true;supportAddress.rows=2;supportAddress.dir='ltr';
    supportCopy=el('button','shell-ws-button');supportCopy.type='button';
    supportStatus=el('p','');supportStatus.setAttribute('role','status');
    supportCopy.onclick=async()=>{
      try{
        await window.arcade.copyText(supportAddress.value);
        supportStatus.textContent=tr('已复制联系方式。','Support contact copied.');
      }catch{
        if(supportPanel.hidden)return;
        supportAddress.focus();supportAddress.select();
        supportStatus.textContent=tr('已选中联系方式，请按 Ctrl+C 复制。','Support contact selected. Press Ctrl+C to copy.');
      }
    };
    supportPanel.append(supportLabel,supportAddress,supportCopy,supportStatus);
    socialStatus.append(socialCopy,socialRetry,supportPanel);
    document.body.append(socialStatus);
    if(typeof window.arcade.storeSupport==='function')void window.arcade.storeSupport()
      .then(value=>{supportData=value;drawSupport();}).catch(()=>{});
    window.arcade.onStoreSocialUnavailable(()=>{ if(socialActive){++socialEpoch;socialState('error');} });
    window.arcade.onStoreSocialFocus(()=>toggleSocialMenu(false,{focus:false}));
    window.arcade.onStoreToolsRequested(()=>{if(socialActive&&!imageFeedbackReturn)toggleSocialMenu(true);});
    const resize=new ResizeObserver(()=>{if(socialStatus.hidden)fitSocial();});
    resize.observe(bar);
    resize.observe(socialMenu);
  }
  async function showSocial(focus=false){
    leaveBothouse();
    toggleSocialMenu(false,{focus:false});
    const epoch=++socialEpoch;
    socialActive=true;
    imageReturn.hidden=!imageFeedbackReturn;
    socialMore.hidden=!!imageFeedbackReturn;
    document.documentElement.dataset.storeSocial='open';
    main.inert=true;
    paintSocialButtons();
    socialState('loading');
    let loaded=false;
    try{loaded=await storeSocial({active:true,headerBottom:socialHeaderBottom(),focus,...(imageFeedbackReturn&&{imageFeedback:true})});}catch{}
    if(epoch===socialEpoch){
      socialState(loaded?'ready':'error');
      if(focus&&!loaded)socialRetry.focus({preventScroll:true});
    }
  }
  function leaveSocial(){
    if(!socialActive)return;
    socialActive=false;++socialEpoch;
    delete document.documentElement.dataset.storeSocial;
    main.inert=false;
    socialStatus.hidden=true;
    paintSocialButtons();
    void storeSocial({active:false}).catch(()=>{});
  }
  nav.classList.add('shell-nav');
  const observer=document.querySelector('.connection')||el('div','connection');observer.classList.add('shell-observer');
  const version=observer.querySelector('.version');
  const tools=el('div','shell-tools');
  const picker=$('view-picker'),quiet=$('quiet'),language=$('language'),legacyCompact=$('compact');
  // Quiet becomes an icon toggle; app.js keeps aria-pressed in sync and still owns the click.
  delete quiet.dataset.i18n;quiet.className='shell-tool';quiet.replaceChildren(icon(['M6 16v-5a6 6 0 0 1 9.2-5.1','M18 11v5l1.5 2H8','M10 20a2 2 0 0 0 4 0','M4 4l16 16']));
  language.className='shell-tool shell-tool-text';
  // The legacy Compact button keeps its id, text and handler; this one presses it.
  legacyCompact.hidden=true;
  const compact=el('button','shell-tool');compact.type='button';compact.id='shell-compact';compact.append(icon(['M9 4v5H4','M15 20v-5h5','M20 9h-5V4','M4 15h5v5']));compact.onclick=()=>legacyCompact.click();
  const settings=nav.querySelector('[data-view="settings"]');settings.classList.add('shell-tool');settings.classList.remove('nav');
  // App settings use a gear; the sliders icon stays with the conversation settings on the chat page.
  const GEAR=['M10 2.5h4l.5 2.5 1.5.9 2.5-.8 2 3.5-1.9 1.8v2.8l1.9 1.8-2 3.5-2.5-.8-1.5.9-.5 2.5h-4L9.5 19l-1.5-.9-2.5.8-2-3.5 1.9-1.8v-2.8L3.5 9l2-3.5 2.5.8 1.5-.9Z',['circle',{cx:12,cy:12,r:3}]];
  settings.querySelector('svg')?.replaceWith(icon(GEAR));
  const pops=[];
  function popover(button,panel,name){
    const wrap=el('div','shell-pop');wrap.dataset.pop=name;panel.classList.add('shell-pop-panel');panel.hidden=true;panel.setAttribute('role','dialog');
    button.setAttribute('aria-haspopup','dialog');button.setAttribute('aria-expanded','false');
    const close=focus=>{if(panel.hidden)return;panel.hidden=true;button.setAttribute('aria-expanded','false');if(focus)button.focus({preventScroll:true});};
    button.addEventListener('click',()=>{const opening=panel.hidden;for(const other of pops)other(false);if(opening){panel.hidden=false;button.setAttribute('aria-expanded','true');}});
    wrap.addEventListener('keydown',event=>{if(event.key==='Escape'&&!panel.hidden){event.stopPropagation();close(true);}});
    wrap.addEventListener('focusout',event=>{if(event.relatedTarget&&!wrap.contains(event.relatedTarget))close(false);});
    document.addEventListener('pointerdown',event=>{if(!wrap.contains(event.target))close(false);});
    pops.push(close);wrap.append(button,panel);return wrap;
  }

  // ---- layout picker ----
  const SCHEMATIC={
    immersive:[['rect',{x:1.5,y:1.5,width:33,height:21,rx:4}],['circle',{cx:10,cy:10,r:3}],'M4.5 20.5c.8-3.6 2.9-5 5.5-5s4.7 1.4 5.5 5',['rect',{x:20,y:5,width:11.5,height:14,rx:2,class:'schematic-fill'}]],
    messenger:[['rect',{x:1.5,y:1.5,width:33,height:21,rx:4}],'M12.5 1.5v21','M4.5 7h5M4.5 12h5M4.5 17h5',['rect',{x:16,y:5.5,width:9,height:4.5,rx:2,class:'schematic-fill'}],['rect',{x:22,y:13.5,width:9,height:4.5,rx:2}]],
    minimal:[['rect',{x:1.5,y:1.5,width:33,height:21,rx:4}],'M11 8h14M11 12h14M11 16h9'],
  };
  function layoutChoice(large=false){
    const node=el('div',large?'layout-choice layout-choice-large':'layout-choice');node.setAttribute('role','group');
    const rows=LAYOUTS.map(item=>{
      const b=el('button','layout-option');b.type='button';b.dataset.layout=item.id;
      const name=el('strong',''),note=el('span','layout-option-note'),text=el('span','layout-option-text');text.append(name,note);
      b.append(icon(SCHEMATIC[item.id],'0 0 36 24',large?72:36),text);
      b.onclick=()=>{if(latest?.config?.layout!==item.id)savePreference('layout',item.id);};
      node.append(b);return {item,b,name,note};
    });
    return {node,sync(data){
      node.setAttribute('aria-label',tr('界面布局','Interface layout'));
      const chosen=document.documentElement.dataset.layout;
      for(const row of rows){setText(row.name,pair(row.item.name));setText(row.note,pair(row.item.note));row.b.setAttribute('aria-pressed',String(row.item.id===chosen));}
    }};
  }
  // ---- accent control ----
  function accentControl(){
    const node=el('div','accent-control'),auto=el('button','accent-auto'),swatches=el('div','accent-swatches'),custom=el('label','accent-custom'),customText=el('span',''),input=el('input','');
    auto.type='button';swatches.setAttribute('role','group');input.type='color';
    const set=value=>savePreference('accent',value);
    auto.onclick=()=>set('auto');
    const buttons=(window.ArcadeTheme?.PRESETS||[]).map((hex,index)=>{const b=el('button','accent-swatch');b.type='button';b.dataset.accent=hex;b.style.setProperty('--swatch',hex);b.onclick=()=>set(hex);swatches.append(b);return {b,hex,index};});
    const customValue=()=>latest?.config?.accent&&latest.config.accent!=='auto'?latest.config.accent:window.ArcadeTheme?.accent()||'#b45a86';
    input.onchange=()=>savePreferenceControl(input,'accent','value',customValue);
    custom.append(customText,input);node.append(auto,swatches,custom);
    return {node,sync(data){
      const chosen=typeof data.config?.accent==='string'&&data.config.accent!=='auto'?data.config.accent.toLowerCase():'auto';
      setText(auto,tr('跟随角色','Follow the character'));auto.setAttribute('aria-pressed',String(chosen==='auto'));
      auto.title=tr('每位角色用自己的颜色','Each character brings its own colour');
      swatches.setAttribute('aria-label',tr('预设颜色','Preset colours'));
      for(const {b,hex,index} of buttons){label(b,pair(PRESET_NAMES[index]||['预设','Preset']));b.setAttribute('aria-pressed',String(chosen===hex));}
      setText(customText,tr('自定义','Custom'));
      const value=customValue();if(document.activeElement!==input&&input.value!==value)input.value=value;
      custom.dataset.active=String(chosen!=='auto'&&!buttons.some(row=>row.hex===chosen));
    }};
  }
  const layoutButton=el('button','shell-tool');layoutButton.type='button';layoutButton.id='shell-layout';
  const layoutPanel=el('div','');const layoutTitle=el('p','shell-pop-title');const barLayouts=layoutChoice(false);layoutPanel.append(layoutTitle,barLayouts.node);
  const accentButton=el('button','shell-tool');accentButton.type='button';accentButton.id='shell-accent';accentButton.append(el('span','accent-dot'));
  const accentPanel=el('div','');const accentTitle=el('p','shell-pop-title');const barAccent=accentControl();accentPanel.append(accentTitle,barAccent.node);
  tools.append(picker,quiet,language,compact,popover(layoutButton,layoutPanel,'layout'),popover(accentButton,accentPanel,'accent'),settings);
  bar.append(brand,ws,nav,observer,tools);
  document.body.insertBefore(bar,document.body.firstChild);
  if(sidebar)sidebar.hidden=true;

  // ---- navigation order and grouping ----
  const navButton=name=>nav.querySelector(`[data-view="${name}"]`);
  for(const name of [...ORDER.companion,...ORDER.work]){const b=navButton(name);if(b){b.dataset.ws=WORKSPACE_OF[name];nav.append(b);}}
  const qqNav=navButton('qq-runtime');if(qqNav)qqNav.dataset.ws='sub';
  if(!picker.querySelector('option[value="accounts"]')){const option=el('option','');option.value='accounts';picker.append(option);}
  const subnav=el('div','shell-subnav');subnav.id='shell-subnav';subnav.setAttribute('role','group');subnav.hidden=true;
  const subButtons={};
  for(const name of CHANNEL){const b=el('button','shell-subnav-button');b.type='button';b.dataset.target=name;b.onclick=()=>open(name);subButtons[name]=b;subnav.append(b);}
  main.insertBefore(subnav,main.querySelector('section.view'));

  function open(view){
    if(view==='accounts'&&typeof window.openCompanionManager==='function')window.openCompanionManager();
    else if(view==='qq-runtime'&&navButton('qq-runtime')?.hidden)switchView('connections');
    else switchView(view);
  }
  function setWorkspace(name){
    if(!ORDER[name])return;
    leaveSocial();
    const view=document.body.dataset.view;
    if(WORKSPACE_OF[view]!==name){currentWs=name;open(remembered[name]||ORDER[name][0]);}
    if(latest?.config?.workspace!==name)savePreference('workspace',name);
  }

  // ---- Notices: recent events get their own block above the sources card ----
  const parts=window.ArcadeSourcesParts,notices=$('notices-content');
  const recentCard=el('article','settings-card notices-recent'),recentTitle=el('h2',''),recentEmpty=el('p','fine notices-empty');
  if(notices){recentCard.append(recentTitle,recentEmpty);if(parts?.recent){parts.recentTitle.remove();recentCard.append(parts.recent);}notices.prepend(recentCard);}

  // ---- Settings: Interface card (layout, accent, day/night) ----
  const grid=document.querySelector('#settings-view .settings-grid'),oldAppearance=grid?.querySelector('.appearance-card');
  const face=el('article','settings-card interface-card'),faceTitle=el('h2',''),layoutHead=el('h3',''),accentHead=el('h3',''),accentNote=el('p',''),schemeHead=el('h3','');
  const cardLayouts=layoutChoice(true),cardAccent=accentControl();
  face.id='interface-card';schemeHead.dataset.i18n='appearanceTitle';
  face.append(faceTitle,schemeHead);
  if(oldAppearance){for(const node of [oldAppearance.querySelector('#appearance-note'),oldAppearance.querySelector('.appearance-options'),oldAppearance.querySelector('#appearance-status')])if(node)face.append(node);oldAppearance.remove();}
  // Language: the same switch as the top-bar button, where people look for it.
  const languageHead=el('h3',''),languageRow=el('div','language-choice');languageRow.setAttribute('role','group');
  const languageButtons=[['zh','中文'],['en','English']].map(([id,text])=>{const b=el('button','accent-auto',text);b.type='button';b.id='settings-language-'+id;b.lang=id==='zh'?'zh-CN':'en';b.onclick=()=>{if((latest?.config?.language==='zh'?'zh':'en')!==id)language.click();};languageRow.append(b);return {id,b};});
  face.append(languageHead,languageRow,layoutHead,cardLayouts.node,accentHead,accentNote,cardAccent.node);
  grid?.prepend(face);
  const heading=document.querySelector('#settings-view .page-heading');
  const settingsPage=window.mountGlobalSettings({grid,heading,gear:settings,openView:open,tr});
  function openAI(){
    if(document.body.dataset.view!=='settings')switchView('settings');
    settingsPage.choose('ai');
  }
  function openObserver(){
    if(document.body.dataset.view!=='settings')switchView('settings');
    settingsPage.choose('observer');
    $('install')?.focus({preventScroll:true});
  }
  $('connect')?.addEventListener('click',openObserver);
  if(heading&&version){const holder=el('span','settings-version');holder.append(version);heading.append(holder);}

  window.ArcadeShell=Object.freeze({WORKSPACE_OF,ORDER,CHANNEL,open,setWorkspace,layoutChoice,accentControl,icon,bar,main,openObserver,openAI,...(storeSocial&&{reportImage(resume){
    imageFeedbackReturn=resume;
    void showSocial(true);
  }})});
  // Compact view picker: the current workspace's views in the bar's order, then Settings.
  let pickerKey='';
  function syncPicker(view,data){
    const qqHidden=!qqNav||qqNav.hidden,sub=CHANNEL.includes(view)&&view!=='connections'&&!(view==='qq-runtime'&&qqHidden)?view:'';
    const order=[...ORDER[currentWs]||[],...(sub?[sub]:[]),'settings'].filter(name=>navButton(name)||name==='settings'||name===sub);
    const key=`${currentWs}|${sub}|${order.join(',')}`;
    for(const option of picker.options){const name=option.value;if(LABELS[name])setText(option,pair(LABELS[name]));option.dataset.ws=WORKSPACE_OF[name]||'all';const show=order.includes(name)&&!(navButton(name)?.hidden&&name!==sub);if(option.hidden===show)option.hidden=!show;if(option.disabled===show)option.disabled=!show;}
    if(key===pickerKey)return;pickerKey=key;
    const byName=new Map([...picker.options].map(option=>[option.value,option])),value=picker.value;
    for(const name of order){const option=byName.get(name);if(option)picker.append(option);}
    for(const option of byName.values())if(!order.includes(option.value))picker.append(option);
    picker.value=value;
  }

  let socialStarted=false;
  window.renderShell=data=>{
    latest=data;zh=data.config?.language==='zh';
    const root=document.documentElement,view=document.body.dataset.view||'scene',preferred=data.config?.workspace==='work'?'work':'companion';
    if(lastConfigWs===null){lastConfigWs=preferred;currentWs=WORKSPACE_OF[view]||preferred;}
    else if(preferred!==lastConfigWs){lastConfigWs=preferred;if((WORKSPACE_OF[view]||currentWs)!==preferred){currentWs=preferred;open(remembered[preferred]||ORDER[preferred][0]);return;}}
    if(WORKSPACE_OF[view]){currentWs=WORKSPACE_OF[view];remembered[currentWs]=view;}
    if(root.dataset.workspace!==currentWs)root.dataset.workspace=currentWs;
    // Workspace switch
    ws.setAttribute('aria-label',tr('工作区','Workspace'));
    setText(wsButtons.companion,tr('陪伴','Companion'));setText(wsButtons.work,tr('工作','Work'));
    if(socialButton){
      setText(socialButton,tr('返回消息','Back to messages'));setText(socialMore,tr('更多','More'));
      if(bothouseBack){
        drawResidents();
        setText(bothouseBack,tr('返回消息','Back to messages'));
        setText(bothouseRetry,tr('重试','Retry'));
        setText(bothouseChoose,tr('选择 Bothouse 配置…','Choose Bothouse configuration…'));
        bothouseBack.setAttribute('aria-keyshortcuts','Alt+ArrowLeft');
      }
      setText(imageReturn,tr('返回这张图','Back to this image'));
      socialMore.title=tr('更多（Ctrl+Shift+M）','More (Ctrl+Shift+M)');
      setText(socialRetry,tr('重试','Retry'));
      socialMenu.setAttribute('aria-label',tr('更多功能','More features'));
      for(const item of socialTools)setText(item.button,pair(item.label));
      drawSupport();
    }
    paintSocialButtons();
    if(socialButton&&!socialStarted){socialStarted=true;void showSocial();}
    // Navigation: labels, grouping, current page
    nav.setAttribute('aria-label',tr(currentWs==='work'?'工作':'陪伴',currentWs==='work'?'Work':'Companion'));
    const group=CHANNEL.includes(view)?'connections':view;
    for(const b of nav.querySelectorAll('[data-view]')){
      const name=b.dataset.view,text=pair(LABELS[name]||[name,name]);setText(b.querySelector('span'),text);label(b,text);
      const active=name===group;b.classList.toggle('active',active);if(active)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');
    }
    label(settings,pair(LABELS.settings));settings.classList.toggle('active',view==='settings');if(view==='settings')settings.setAttribute('aria-current','page');else settings.removeAttribute('aria-current');
    syncPicker(view,data);
    // Channel sub-navigation
    subnav.hidden=!CHANNEL.includes(view);subnav.setAttribute('aria-label',pair(LABELS.connections));
    setText(subButtons.connections,tr('连接向导','Connection guide'));setText(subButtons.accounts,pair(LABELS.accounts));setText(subButtons['qq-runtime'],pair(LABELS['qq-runtime']));
    subButtons.accounts.hidden=!data.accounts;subButtons['qq-runtime'].hidden=!qqNav||qqNav.hidden;
    for(const [name,b] of Object.entries(subButtons)){const active=name===view;b.setAttribute('aria-pressed',String(active));}
    // Tools
    label(quiet,tr(data.config?.quiet?'免打扰：已开启':'免打扰：已关闭',data.config?.quiet?'Quiet mode: on':'Quiet mode: off'));
    label(language,tr('Switch to English','切换到中文'));
    label(compact,tr(data.config?.compact?'返回完整视图':'紧凑视图',data.config?.compact?'Full view':'Compact view'));compact.setAttribute('aria-pressed',String(!!data.config?.compact));
    label(layoutButton,tr('界面布局','Interface layout'));
    const chosenLayout=root.dataset.layout;if(layoutButton.dataset.layout!==chosenLayout){layoutButton.dataset.layout=chosenLayout;layoutButton.replaceChildren(icon(SCHEMATIC[chosenLayout]||SCHEMATIC.immersive,'0 0 36 24',24));}
    label(accentButton,tr('强调色','Accent colour'));
    setText(layoutTitle,tr('界面布局','Interface layout'));setText(accentTitle,tr('强调色','Accent colour'));
    barLayouts.sync(data);barAccent.sync(data);cardLayouts.sync(data);cardAccent.sync(data);
    // Observer state (Work workspace)
    const state=data.lastEventAt?'connected':data.installed?'installed':'off';if(observer.dataset.state!==state)observer.dataset.state=state;
    // The observer only matters on the pages that show what it reports. The title doubles as the
    // tooltip when the label is hidden at narrow widths and only the dot is left.
    const observerText=`${tr('观察器','Observer')} · ${$('connection-label')?.textContent||''}`,observerShown=view==='scene';
    if(observer.hidden===observerShown)observer.hidden=!observerShown;
    label(observer,observerText);if(observer.getAttribute('role')!=='img')observer.setAttribute('role','img');
    settingsPage.sync(data,view);
    setText(languageHead,tr('语言','Language'));languageRow.setAttribute('aria-label',tr('语言','Language'));
    for(const row of languageButtons)row.b.setAttribute('aria-pressed',String(row.id===(zh?'zh':'en')));
    // Notices and Settings copy
    setText(recentTitle,tr('最近的动静','Recent activity'));setText(recentEmpty,tr('还没有新的动静。添加数据源后，日历、文件夹和网页的更新会出现在这里。','Nothing new yet. After you add a source, calendar, folder and web updates appear here.'));
    setText(faceTitle,tr('界面','Interface'));setText(layoutHead,tr('布局','Layout'));setText(accentHead,tr('强调色','Accent colour'));
    setText(accentNote,tr('默认跟随当前角色；也可以固定成一个你喜欢的颜色。文字和按钮会自动保持清晰。','Follows the current character by default, or stays on a colour you pick. Text and buttons keep readable contrast automatically.'));
    window.ArcadeLayouts?.render(data,{view,workspace:currentWs,language:zh?'zh':'en',zh,tr,target:window.ArcadeTheme?.target(data),bar,main});
  };
  if(typeof data!=='undefined'&&data)render();
})();
