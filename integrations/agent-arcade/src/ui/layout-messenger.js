'use strict';
// Messenger layout: a conversation list on the left, the conversation in the middle and a
// collapsible details panel on the right, built around the existing chat DOM (bot.js and
// desktop-chat.js keep producing it). Nodes that are moved in on mount are moved back on unmount,
// ids stay the same, and nothing here runs unless this layout is mounted.
//
// Switching the conversation target follows the character page ("chat as this character") and
// the group list ("start the group chat"): stConfigure, then ArcadeDesktopConversation.select.
(() => {
  if(!window.ArcadeLayouts)return;
  const theme=window.ArcadeTheme,shell=window.ArcadeShell;
  const DETAILS_KEY='arcade.messenger.details';
  // Presentation memory only; unavailable storage simply means no memory.
  const remember=value=>{try{if(value===undefined)return localStorage.getItem(DETAILS_KEY);localStorage.setItem(DETAILS_KEY,value);}catch{}return null;};
  const wide=window.matchMedia('(min-width:1200px)'),narrow=window.matchMedia('(max-width:719px)');
  const hueOf=text=>{let n=2166136261;for(const ch of String(text||'?')){n^=ch.codePointAt(0);n=Math.imul(n,16777619);}return (n>>>0)%360;};
  const initial=text=>(String(text||'').trim()||'?').slice(0,1).toUpperCase();
  const validData=url=>typeof url==='string'&&/^data:image\//.test(url);

  let mounted=false,latest=null,context=null,zh=true;
  const tr=(a,b)=>zh?a:b,colon=()=>tr('：',': ');
  // Fetched lists (never part of the periodic snapshot).
  let characters=[],groups=[],conversations=new Map(),version=0,loading=null,again=false,stale=true,loadedOnce=false,lastView='';
  let busy=false,message='',messageError=false,lastTarget='';
  let prefOpen=remember()!=='0',overlayOpen=false,listOpen=false;
  let listKey='',detailsKey='',detailsToken=0,switcherHome=null;
  const cards=new Map();

  // ---- left: conversation list ----
  const list=el('aside','msg-list');list.id='msg-list';
  const listHead=el('div','msg-list-head'),filterLabel=el('label','sr-only'),filter=el('input','msg-filter');
  filter.type='search';filter.id='msg-filter';filter.autocomplete='off';filter.spellcheck=false;filter.maxLength=60;filterLabel.htmlFor=filter.id;listHead.append(filterLabel,filter);
  const listScroll=el('div','msg-list-scroll'),listEmpty=el('p','msg-list-empty');listEmpty.setAttribute('role','status');
  const SECTIONS=['persona','character','group'];
  const sections=Object.fromEntries(SECTIONS.map(kind=>{
    const box=el('section','msg-section'),title=el('h2','msg-section-title'),rows=el('ul','msg-rows'),note=el('p','msg-section-note');
    title.id='msg-section-'+kind;rows.setAttribute('aria-labelledby',title.id);box.dataset.kind=kind;box.append(title,rows,note);listScroll.append(box);
    return [kind,{box,title,rows,note}];
  }));
  listScroll.append(listEmpty);
  const status=el('p','msg-status');status.setAttribute('role','status');status.hidden=true;
  const listFoot=el('div','msg-list-foot'),importButton=el('button','msg-foot-button'),newGroupButton=el('button','msg-foot-button'),profiles=el('div','msg-profiles');
  importButton.type=newGroupButton.type='button';importButton.id='msg-import';newGroupButton.id='msg-new-group';
  importButton.append(shell.icon(['M12 5v14','M5 12h14'],'0 0 24 24',16),el('span',''));newGroupButton.append(shell.icon([['circle',{cx:9,cy:9,r:3}],'M3.5 18.5a5.5 5.5 0 0 1 11 0','M17 8v6','M14 11h6'],'0 0 24 24',16),el('span',''));
  const footRow=el('div','msg-foot-row');footRow.append(importButton,newGroupButton);listFoot.append(footRow,profiles);
  list.append(listHead,listScroll,status,listFoot);

  // ---- right: details ----
  const details=el('aside','msg-details');details.id='msg-details';
  const detailsHead=el('div','msg-details-head'),detailsTitle=el('h2','msg-details-title'),detailsClose=el('button','msg-toggle');
  detailsClose.type='button';detailsClose.id='msg-details-close';detailsClose.append(shell.icon(['m6 6 12 12','M18 6 6 18'],'0 0 24 24',18));detailsHead.append(detailsTitle,detailsClose);
  const detailsBody=el('div','msg-details-body');details.append(detailsHead,detailsBody);

  // ---- header toggles and the scrim behind an overlay panel ----
  const listToggle=el('button','msg-toggle msg-list-toggle'),detailsToggle=el('button','msg-toggle msg-details-toggle'),scrim=el('div','msg-scrim');
  listToggle.type=detailsToggle.type='button';listToggle.id='msg-list-toggle';detailsToggle.id='msg-details-toggle';
  listToggle.setAttribute('aria-controls',list.id);detailsToggle.setAttribute('aria-controls',details.id);
  listToggle.append(shell.icon(['M4 6h16','M4 12h16','M4 18h16'],'0 0 24 24',18));
  detailsToggle.append(shell.icon([['rect',{x:3.5,y:4.5,width:17,height:15,rx:2.5}],'M14.5 4.5v15'],'0 0 24 24',18));
  scrim.setAttribute('aria-hidden','true');

  const botView=()=>document.getElementById('bot-view');
  const setupPanel=()=>document.getElementById('bot-setup-panel');
  const isCompact=()=>document.body.classList.contains('compact');
  const listIsDrawer=()=>narrow.matches||isCompact();
  const detailsIsOverlay=()=>!wide.matches||isCompact();
  const detailsWanted=()=>detailsIsOverlay()?overlayOpen:prefOpen;
  const label=(node,text)=>{if(node.getAttribute('aria-label')!==text)node.setAttribute('aria-label',text);if(node.title!==text)node.title=text;};
  const setText=(node,text)=>{if(node&&node.textContent!==text)node.textContent=text;};

  function sync(){
    const view=botView();if(!view||!mounted)return;
    const open=detailsWanted()&&!setupPanel()?.open,drawer=listIsDrawer()&&listOpen;
    if(view.dataset.msgDetails!==(open?'open':'closed'))view.dataset.msgDetails=open?'open':'closed';
    if(view.dataset.msgList!==(drawer?'open':'closed'))view.dataset.msgList=drawer?'open':'closed';
    details.hidden=!open;
    detailsToggle.setAttribute('aria-expanded',String(open));listToggle.setAttribute('aria-expanded',String(drawer));
    label(detailsToggle,open?tr('收起资料栏','Hide details'):tr('显示资料栏','Show details'));
    label(listToggle,drawer?tr('收起会话列表','Hide the conversation list'):tr('会话列表','Conversation list'));
  }
  function setDetails(open,focus){
    if(open&&setupPanel()?.open)document.getElementById('bot-settings-close')?.click();
    if(detailsIsOverlay())overlayOpen=open;else{prefOpen=open;remember(open?'1':'0');}
    if(open&&listIsDrawer())listOpen=false;
    sync();if(latest&&context)drawDetails(latest);
    if(focus)(open?detailsClose:detailsToggle).focus({preventScroll:true});
  }
  function setList(open,focus){
    listOpen=open;if(open)overlayOpen=false;sync();
    if(focus)(open?filter:listToggle).focus({preventScroll:true});
  }
  detailsToggle.onclick=()=>setDetails(detailsToggle.getAttribute('aria-expanded')!=='true',false);
  detailsClose.onclick=()=>setDetails(false,true);
  listToggle.onclick=()=>setList(!listOpen,true);
  scrim.onclick=()=>{if(listIsDrawer()&&listOpen)setList(false,false);if(detailsIsOverlay()&&overlayOpen)setDetails(false,false);};
  const onEscape=event=>{
    if(!mounted||event.key!=='Escape'||event.defaultPrevented)return;
    if(listIsDrawer()&&listOpen&&list.contains(event.target)){event.stopPropagation();setList(false,true);}
    else if(detailsIsOverlay()&&overlayOpen&&details.contains(event.target)){event.stopPropagation();setDetails(false,true);}
  };
  list.addEventListener('keydown',onEscape);details.addEventListener('keydown',onEscape);
  for(const query of [wide,narrow])query.addEventListener('change',()=>{if(!mounted)return;sync();if(latest&&context)drawDetails(latest);});
  new MutationObserver(()=>{if(mounted)sync();}).observe(document.body,{attributes:true,attributeFilter:['class']});

  // ---- data ----
  const safe=promise=>Promise.resolve(promise).catch(()=>null);
  async function load(){
    if(loading){again=true;return;}
    const api=window.arcade;if(!api)return;
    const request={},profileId=latest?.accounts?.selectedId;
    loading=request;stale=false;
    try{
      const [rows,sets,talks]=await Promise.all([typeof api.charactersList==='function'?safe(api.charactersList()):null,typeof api.groupsList==='function'?safe(api.groupsList()):null,profileId&&typeof api.stConversations==='function'?safe(api.stConversations(profileId)):null]);
      if(loading!==request)return;
      if(Array.isArray(rows))characters=rows.filter(row=>row&&typeof row.id==='string');
      if(Array.isArray(sets))groups=sets.filter(row=>row&&typeof row.id==='string');
      if(Array.isArray(talks)){conversations=new Map();for(const row of talks){if(!row)continue;const key=typeof row.groupId==='string'?'group:'+row.groupId:typeof row.characterId==='string'?'character:'+row.characterId:'';if(key)conversations.set(key,{messages:Number(row.messages)||0,branches:Number(row.branches)||0});}}
      loadedOnce=true;version++;
    }finally{if(loading===request)loading=null;}
    if(mounted&&latest&&context){drawList(latest);drawDetails(latest);}
    if(again){again=false;void load();}
  }
  document.addEventListener('arcade-library-changed',()=>{cards.clear();stale=true;if(mounted&&document.body.dataset.view==='bot')void load();});
  function card(id){
    if(!id||typeof window.arcade?.charactersGet!=='function')return Promise.resolve(null);
    if(!cards.has(id)){if(cards.size>40)cards.delete(cards.keys().next().value);cards.set(id,Promise.resolve(window.arcade.charactersGet(id)).catch(()=>{cards.delete(id);return null;}));}
    return cards.get(id);
  }
  const explain=error=>window.ArcadeST?.explain?.(error,zh)||tr('操作没有完成，请稍后再试。','The action did not complete. Please try again.');
  const say=(text,error=false)=>{message=text||'';messageError=!!error;setText(status,message);status.hidden=!message;status.dataset.error=String(messageError);};
  const personaOf=data=>{const local=data.bot?.local,app=data.desktopChat?.kind==='local';return (app?(data.personas||[]).find(item=>item.id===local?.characterId):null)||data.persona||{id:'sprout',name:{zh:'小芽',en:'Sprout'},portrait:'portraits/sprout-anime.png'};};
  const pick=(value)=>value&&typeof value==='object'?value[zh?'zh':'en']||value.en||value.zh||'':typeof value==='string'?value:'';

  // ---- switching the conversation target ----
  async function choose(item){
    if(busy||!latest||!context)return;
    const who=context.target,active=item.kind===who.kind&&(item.kind==='persona'||item.id===who.id);
    const done=()=>{if(listIsDrawer()&&listOpen){setList(false,false);(document.getElementById('desktop-chat-input')||listToggle).focus({preventScroll:true});}};
    const st=latest.bot?.st,group=st?.available?st.settings?.groupId||null:null,character=st?.available&&!group?st.settings?.characterId||null:null;
    // While a chat channel's conversation is shown, the built-in companion is the target even if a
    // character or group is already chosen for the App conversation: its row then undoes that choice.
    if(active&&(item.kind!=='persona'||!(character||group))){done();return;}
    if(item.kind!=='persona'&&!st?.available)return;
    busy=true;say('');drawList(latest);
    let ok=false;
    try{
      const api=window.arcade,select=(force)=>window.ArcadeDesktopConversation?.select('local',true,{force});
      if(item.kind==='character'){
        if(character!==item.id||group){try{await api.stConfigure(group?{characterId:item.id,groupId:null}:{characterId:item.id});}catch(error){say(`${tr('没有切换','Not switched')}${colon()}${explain(error)}`,true);return;}}
        const result=await select(character!==item.id||!!group);
        if(result?.ok===false)say(`${tr('角色已选好，但对话没有开始','The character is selected, but the conversation did not start')}${colon()}${explain(result)}`,true);else ok=true;
      }else if(item.kind==='group'){
        if(group!==item.id){try{await api.stConfigure({groupId:item.id});}catch(error){say(`${tr('没有切换','Not switched')}${colon()}${explain(error)}`,true);return;}}
        const result=await select(group!==item.id);
        if(result?.ok===false)say(`${tr('群聊已选好，但对话没有开始','The group chat is selected, but the conversation did not start')}${colon()}${explain(result)}`,true);else ok=true;
      }else{
        const changed=!!(character||group||st?.available&&(st.settings?.characterId||st.settings?.groupId)),app=latest.desktopChat?.kind==='local';
        if(changed){try{await api.stConfigure({characterId:null,groupId:null});}catch(error){say(`${tr('没有切换','Not switched')}${colon()}${explain(error)}`,true);return;}}
        // Like "Back to the built-in companion" on the characters page; the App conversation is
        // started again only when it is the one on screen.
        if(!app){say(tr('已改回内置搭档。App 对话下次开始时会用它。','Switched back to the built-in companion. The App conversation will use it when it next starts.'));ok=true;}
        else{
          const result=await select(changed);
          if(result?.ok===false)say(`${tr('已改回内置角色，但对话没有开始','Switched back to the built-in character, but the conversation did not start')}${colon()}${explain(result)}`,true);else ok=true;
        }
      }
    }catch(error){say(`${tr('没有完成','Not completed')}${colon()}${explain(error)}`,true);}
    finally{busy=false;stale=true;if(mounted&&latest){listKey='';drawList(latest);void load();}if(ok)done();}
  }

  // ---- drawing: list ----
  function avatar(item,cls){
    const box=el('span',cls);box.setAttribute('aria-hidden','true');
    const faces=item.kind==='group'?(item.faces||[]).slice(0,2):[];
    if(faces.length===2){box.classList.add('msg-avatar-duo');for(const face of faces)box.append(avatar({kind:'character',id:face.id,name:face.name,image:face.image},'msg-avatar-face'));return box;}
    if(item.image){const image=el('img','');image.alt='';image.decoding='async';image.src=item.image;box.append(image);if(item.kind==='persona')box.classList.add('msg-avatar-contain');}
    else{box.append(el('span','',initial(item.name)));box.style.setProperty('--av-h',String(hueOf(item.name||item.id)));box.classList.add('msg-avatar-initial');}
    return box;
  }
  const countLine=(kind,id,live)=>{
    const known=conversations.get(kind+':'+id),messages=Math.max(known?.messages||0,live||0),branches=known?.branches||0;
    if(!messages)return tr('还没聊过','No messages yet');
    return tr(`${messages} 条消息`,messages===1?'1 message':`${messages} messages`)+(branches>1?tr(` · ${branches} 个分支`,` · ${branches} branches`):'');
  };
  const liveCount=(data,kind,id)=>{const local=data.bot?.local,app=data.desktopChat?.kind==='local';if(!app||!Array.isArray(local?.history))return 0;const match=kind==='group'?local.libraryGroupId===id:kind==='character'?!local.libraryGroupId&&local.libraryCharacterId===id:!local.libraryGroupId&&!local.libraryCharacterId;return match?local.history.length:0;};
  function itemsOf(data){
    const who=context.target,st=data.bot?.st,persona=personaOf(data),anime=(data.config?.portrait||'anime')==='anime',thumbs=new Map(characters.map(row=>[row.id,validData(row.thumb)?row.thumb:'']));
    const personaName=who.kind==='persona'&&who.name?who.name:pick(persona.name)||tr('搭档','Companion');
    const out={persona:[{kind:'persona',id:persona.id,name:personaName,sub:pick(persona.tagline)||tr('当前档案的搭档','This profile’s companion'),image:anime?persona.portrait||'':''}],character:[],group:[]};
    out.character=characters.map(row=>({kind:'character',id:row.id,name:row.name||tr('未命名角色','Unnamed character'),sub:countLine('character',row.id,liveCount(data,'character',row.id)),image:thumbs.get(row.id)||''}));
    if(who.kind==='character'&&!out.character.some(row=>row.id===who.id))out.character.unshift({kind:'character',id:who.id,name:who.name||st?.character?.name||tr('角色','Character'),sub:countLine('character',who.id,liveCount(data,'character',who.id)),image:''});
    const faces=members=>(Array.isArray(members)?members:[]).filter(member=>member&&typeof member.id==='string').map(member=>({id:member.id,name:member.name||'',image:thumbs.get(member.id)||''}));
    out.group=groups.map(row=>({kind:'group',id:row.id,name:row.name||tr('未命名群聊','Unnamed group chat'),sub:countLine('group',row.id,liveCount(data,'group',row.id)),faces:faces(row.members),locked:(row.members||[]).some(member=>member?.missing)}));
    if(who.kind==='group'&&!out.group.some(row=>row.id===who.id))out.group.unshift({kind:'group',id:who.id,name:who.name||tr('群聊','Group chat'),sub:countLine('group',who.id,liveCount(data,'group',who.id)),faces:faces(who.members)});
    // Chosen for the App conversation while another conversation is on screen.
    const chosenGroup=st?.available?st.settings?.groupId||null:null,chosenCharacter=st?.available&&!chosenGroup?st.settings?.characterId||null:null;
    const chosen=who.kind==='persona'?out.group.find(row=>row.id===chosenGroup)||out.character.find(row=>row.id===chosenCharacter):null;
    if(chosen){chosen.sub=`${tr('已为 App 对话选好','Chosen for the App conversation')} · ${chosen.sub}`;chosen.chosen=true;}
    return out;
  }
  function drawList(data){
    const who=context.target,st=data.bot?.st,can=!!st?.available,query=filter.value.trim().toLowerCase(),persona=personaOf(data),local=data.bot?.local;
    const key=JSON.stringify([version,loadedOnce,zh,query,busy,can,who.kind,who.id,who.name,who.members.length,persona.id,data.config?.portrait,data.desktopChat?.kind,Array.isArray(local?.history)?local.history.length:0,st?.character?.name,st?.group?.name,st?.settings?.characterId,st?.settings?.groupId]);
    if(key===listKey)return;listKey=key;
    const held=listScroll.contains(document.activeElement)?document.activeElement.closest('.msg-row'):null,wanted=held?[held.dataset.kind,held.dataset.id]:null;
    const all=itemsOf(data);let shown=0;
    for(const kind of SECTIONS){
      const part=sections[kind],rows=all[kind].filter(item=>!query||item.name.toLowerCase().includes(query));shown+=rows.length;
      part.rows.replaceChildren(...rows.map(item=>{
        const li=el('li',''),b=el('button','msg-row'),text=el('span','msg-row-text'),active=item.kind===who.kind&&(item.kind==='persona'||item.id===who.id),off=busy||item.kind!=='persona'&&(!can||item.locked);
        b.type='button';b.dataset.kind=item.kind;b.dataset.id=item.id;
        if(active)b.setAttribute('aria-current','true');
        if(off&&!active)b.setAttribute('aria-disabled','true');
        const sub=item.locked?tr('有成员已不在角色库','A member is no longer in the library'):item.sub;
        text.append(el('strong','msg-row-name',item.name),el('span','msg-row-sub',sub));
        b.append(avatar(item,'msg-avatar'),text);
        if(active){const mark=el('span','sr-only',tr('（当前会话）',' (current conversation)'));b.append(mark);}
        b.onclick=()=>{if(b.getAttribute('aria-disabled')==='true')return;void choose(item);};
        li.append(b);return li;
      }));
      // Section notes: only where there is something to say that a row does not.
      let note='';
      if(!query&&kind==='character'&&loadedOnce&&!all.character.length)note=tr('还没有导入角色。点下方“导入角色…”开始。','No characters yet. Choose “Import a character…” below to begin.');
      else if(!query&&kind==='group'&&loadedOnce&&!all.group.length)note=all.character.length>=2?tr('还没有群聊。点下方“新建群聊…”把几位角色放进同一段对话。','No group chats yet. Choose “New group chat…” below to put several characters into one conversation.'):tr('还没有群聊。导入至少两位角色后可以新建。','No group chats yet. Import at least two characters to create one.');
      else if(!query&&kind!=='persona'&&!can&&all[kind].length)note=tr('当前档案不能使用 App 对话，暂时不能选角色或群聊。','App conversation is not available for this profile, so characters and group chats cannot be chosen yet.');
      setText(part.note,note);part.note.hidden=!note;
      part.box.hidden=!!query&&!rows.length;
    }
    setText(listEmpty,query&&!shown?tr(`没有名字里带“${filter.value.trim()}”的会话。`,`No conversation has “${filter.value.trim()}” in its name.`):'');listEmpty.hidden=!(query&&!shown);
    if(wanted&&[document.body,null].includes(document.activeElement))[...listScroll.querySelectorAll('.msg-row')].find(node=>node.dataset.kind===wanted[0]&&node.dataset.id===wanted[1])?.focus({preventScroll:true});
  }
  filter.addEventListener('input',()=>{if(mounted&&latest&&context)drawList(latest);});
  // Arrow keys walk the rows; ArrowDown from the filter enters the list.
  list.addEventListener('keydown',event=>{
    if(event.key!=='ArrowDown'&&event.key!=='ArrowUp')return;
    const rows=[...listScroll.querySelectorAll('.msg-row')].filter(node=>node.offsetParent),at=rows.indexOf(document.activeElement);
    if(!rows.length||at<0&&event.target!==filter)return;
    if(event.target===filter&&event.key!=='ArrowDown')return;
    event.preventDefault();
    const next=at<0?rows[0]:event.key==='ArrowDown'?rows[Math.min(rows.length-1,at+1)]:at===0?filter:rows[at-1];
    next.focus();
  });

  // ---- navigation into the characters page ----
  function jump(find,act){
    shell.open('characters');let tries=0;
    const step=()=>{
      if(!mounted||document.body.dataset.view!=='characters')return;
      const node=find();
      if(!node||node.hidden||!node.offsetParent){if(++tries<90)requestAnimationFrame(step);return;}
      if(act){act(node);return;}
      node.scrollIntoView({block:'start'});
      let target=node.matches('button,summary,input,select,textarea,[tabindex]')?node:node.querySelector('button:not(:disabled),summary,input:not(:disabled),select,textarea');
      for(let next=node.nextElementSibling,i=0;!target&&next&&i<4;next=next.nextElementSibling,i++)target=next.matches('button:not(:disabled)')?next:next.querySelector('button:not(:disabled),summary,input:not(:disabled)');
      target?.focus({preventScroll:true});
    };
    requestAnimationFrame(step);
  }
  // The characters page is split into in-page tabs: select the right one before jumping.
  const tab=name=>{window.ArcadeCharactersTabs?.open(name,{focus:false});};
  const toCharacter=id=>{tab('library');jump(()=>document.querySelector(`#characters-view .characters-card[data-character-id="${CSS.escape(id)}"]`),node=>node.click());};
  const toSettings=()=>{tab('settings');jump(()=>document.getElementById('st-settings-card'));};
  const toLorebooks=()=>{tab('lorebooks');jump(()=>document.querySelector('#characters-panel-lorebooks .characters-section-title')||document.querySelector('#characters-view>h2.characters-section-title'));};
  const toGroups=()=>{tab('groups');jump(()=>document.getElementById('groups-section'));};
  importButton.onclick=()=>{tab('library');jump(()=>document.getElementById('characters-import')||document.querySelector('#characters-view .button-row>.primary'),node=>node.focus({preventScroll:true}));};
  newGroupButton.onclick=()=>{tab('groups');jump(()=>document.getElementById('groups-new'),node=>{node.scrollIntoView({block:'center'});node.focus({preventScroll:true});});};

  // ---- drawing: details ----
  function fact(term,value){if(!value)return null;const row=el('div','msg-fact');row.append(el('dt','',term),el('dd','',value));return row;}
  function shortcut(text,run){const b=el('button','msg-shortcut');b.type='button';b.append(el('span','',text),shell.icon(['m9 6 6 6-6 6'],'0 0 24 24',16));b.onclick=run;return b;}
  function drawDetails(data){
    if(details.hidden)return;
    const who=context.target,st=data.bot?.st,persona=personaOf(data),anime=(data.config?.portrait||'anime')==='anime',app=data.desktopChat?.kind==='local';
    const branch=who.kind==='character'&&st?.character?.id===who.id?[st.branch?.name||'',Number(st.branchCount)||0]:null;
    const members=who.kind==='group'?(st?.group?.id===who.id&&Array.isArray(st.group.members)?st.group.members:who.members).map(member=>[member.id,member.name||'',!!member.muted]):[];
    const lines=[countLine(who.kind,who.id,liveCount(data,who.kind,who.id))];
    const key=JSON.stringify([version,zh,who.kind,who.id,who.name,persona.id,anime,app,branch,members,lines,st?.character?.hasBook,st?.available]);
    if(key===detailsKey)return;detailsKey=key;const mine=++detailsToken;
    const figure=el('div','msg-figure'),name=el('h3','msg-details-name'),kicker=el('p','msg-details-kicker'),body=[figure,name,kicker],facts=el('dl','msg-facts'),links=el('div','msg-shortcuts');
    const held=detailsBody.contains(document.activeElement)?[...detailsBody.querySelectorAll('button')].indexOf(document.activeElement):-1;
    figure.dataset.kind=who.kind;let extra=null;
    if(who.kind==='persona'){
      const title=who.name||pick(persona.name);name.textContent=title;kicker.textContent=tr('内置搭档','Built-in companion');
      if(anime&&persona.portrait){const image=el('img','');image.alt='';image.src=persona.portrait;figure.append(image);}else figure.append(avatar({kind:'character',id:persona.id,name:title},'msg-figure-initial'));
      const tagline=pick(persona.tagline);if(tagline)body.push(el('p','msg-details-desc',tagline));
      facts.append(...[fact(tr('对话位置','Conversation'),app?tr('App 对话（只在这台电脑上）','App conversation (this computer only)'):tr('聊天渠道的对话','Channel conversation')),app?fact(tr('消息','Messages'),lines[0]):null].filter(Boolean));
      links.append(shortcut(tr('相处与记忆','Together & memory'),()=>shell.open('relationship')),shortcut(tr('对话设定','Conversation settings'),toSettings),shortcut(tr('换一位角色聊天','Chat with a library character'),()=>shell.open('characters')));
    }else if(who.kind==='character'){
      const title=who.name||st?.character?.name||tr('角色','Character');name.textContent=title;kicker.textContent=tr('角色库角色','Library character');
      const initialBox=avatar({kind:'character',id:who.id,name:title},'msg-figure-initial');figure.append(initialBox);
      const show=url=>{if(mine!==detailsToken||!url)return;let image=figure.querySelector('img');if(!image){image=el('img','');image.alt='';figure.replaceChildren(image);}image.src=url;};
      theme.thumb(who.id).then(url=>{if(!figure.querySelector('img'))show(url);});theme.portrait(who.id,720).then(show);
      const description=el('p','msg-details-desc',''),more=el('dl','msg-facts msg-facts-card');description.hidden=true;body.push(description);
      facts.append(...[fact(tr('消息','Messages'),lines[0]),branch?fact(tr('当前分支','Current branch'),`${branch[0]||tr('主线','Main line')}${branch[1]>1?tr(`（共 ${branch[1]} 个）`,` (${branch[1]} in all)`):''}`):null].filter(Boolean));
      card(who.id).then(info=>{
        if(mine!==detailsToken||!info)return;
        const text=(info.description||info.personality||info.scenario||'').trim();if(text){description.textContent=text.length>280?text.slice(0,280).trimEnd()+'…':text;description.hidden=false;}
        const by=[info.creator&&tr(`作者：${info.creator}`,`By ${info.creator}`),Array.isArray(info.tags)&&info.tags.length?info.tags.slice(0,4).join(' · '):''].filter(Boolean).join('　');if(by)kicker.textContent=by;
        const greetings=(info.firstMessage?1:0)+(Number(info.alternateGreetings)||0);
        more.append(...[fact(tr('开场白','Greetings'),greetings?tr(`${greetings} 条`,String(greetings)):tr('没有','None')),fact(tr('世界书','Lorebook'),info.bookEntries?tr(`内嵌 ${info.bookEntries} 条`,`${info.bookEntries} embedded entries`):tr('这张卡没有内嵌世界书','None embedded in this card'))].filter(Boolean));
        const saveLorebook=window.ArcadeCharactersTabs?.embeddedLorebookAction(info);
        if(saveLorebook)more.after(saveLorebook);
      });
      extra=more;
      links.append(shortcut(tr('角色资料','Character profile'),()=>toCharacter(who.id)),shortcut(tr('对话设定','Conversation settings'),toSettings),shortcut(tr('世界书','Lorebooks'),toLorebooks));
    }else{
      name.textContent=who.name||tr('群聊','Group chat');kicker.textContent=tr(`群聊 · ${members.length} 位成员`,`Group chat · ${members.length} members`);
      const roster=el('ul','msg-members');roster.setAttribute('aria-label',tr('群聊成员','Group chat members'));
      for(const [id,title,muted] of members){
        const li=el('li','msg-member'),face=avatar({kind:'character',id,name:title,image:(characters.find(row=>row.id===id)||{}).thumb||''},'msg-avatar'),text=el('span','msg-row-text');
        text.append(el('strong','msg-row-name',title||tr('未命名角色','Unnamed character')));if(muted)text.append(el('span','msg-row-sub',tr('已静音','Muted')));
        li.append(face,text);roster.append(li);
        if(!face.querySelector('img'))theme.thumb(id).then(url=>{if(mine!==detailsToken||!url||face.querySelector('img'))return;const image=el('img','');image.alt='';image.src=url;face.classList.remove('msg-avatar-initial');face.replaceChildren(image);});
      }
      body.splice(0,3,name,kicker,roster);
      facts.append(...[fact(tr('消息','Messages'),lines[0]),fact(tr('对话位置','Conversation'),tr('只在 App 对话里，不会发到 QQ 或微信','App conversation only; nothing is sent to QQ or WeChat'))].filter(Boolean));
      links.append(shortcut(tr('群聊设置','Group chat settings'),toGroups),shortcut(tr('对话设定','Conversation settings'),toSettings),shortcut(tr('世界书','Lorebooks'),toLorebooks));
    }
    const linksTitle=el('h3','msg-details-sub',tr('前往','Go to'));
    detailsBody.replaceChildren(...body,facts,...(extra?[extra]:[]),linksTitle,links);
    if(held>=0&&[document.body,null].includes(document.activeElement))detailsBody.querySelectorAll('button')[held]?.focus({preventScroll:true});
  }

  // ---- messages: consecutive lines from one speaker share one avatar and name ----
  const GAP=10*60*1000;let grouping=false;
  function groupMessages(){
    grouping=false;if(!mounted)return;
    const box=document.getElementById('bot-messages');if(!box)return;
    let previous='',previousAt=0;
    for(const row of box.children){
      if(!row.classList.contains('bot-message')){previous='';continue;}
      const user=row.classList.contains('from-user'),stamp=Date.parse(row.querySelector(':scope>.message-meta time')?.dateTime||'')||0;
      const key=user?'user':'agent:'+(row.querySelector(':scope>.message-meta .message-author')?.textContent||'');
      const cont=key===previous&&(!stamp||!previousAt||Math.abs(stamp-previousAt)<=GAP);
      if((row.dataset.msgCont==='true')!==cont){if(cont)row.dataset.msgCont='true';else delete row.dataset.msgCont;}
      previous=key;previousAt=stamp||previousAt;
    }
  }
  const scheduleGrouping=()=>{if(!mounted||grouping)return;grouping=true;requestAnimationFrame(groupMessages);};
  const messagesObserver=new MutationObserver(scheduleGrouping);

  function copy(){
    list.setAttribute('aria-label',tr('会话列表','Conversations'));details.setAttribute('aria-label',tr('当前会话的资料','About this conversation'));
    setText(filterLabel,tr('按名字筛选会话','Filter conversations by name'));filter.placeholder=tr('筛选会话','Filter conversations');
    setText(sections.persona.title,tr('内置搭档','Built-in companion'));setText(sections.character.title,tr('角色','Characters'));setText(sections.group.title,tr('群聊','Group chats'));
    setText(importButton.querySelector('span'),tr('导入角色…','Import a character…'));importButton.title=tr('打开角色库，在那里导入角色卡','Open the character library to import a card');
    setText(newGroupButton.querySelector('span'),tr('新建群聊…','New group chat…'));newGroupButton.title=tr('打开角色库的群聊部分','Open the group chats section of the character library');
    setText(detailsTitle,tr('资料','Details'));label(detailsClose,tr('收起资料栏','Hide details'));
  }

  window.ArcadeLayouts.register('messenger',{
    mount(){
      const view=botView();if(!view)return;
      mounted=true;listKey='';detailsKey='';stale=true;lastView='';listOpen=false;overlayOpen=false;prefOpen=remember()!=='0';
      view.prepend(list);view.append(details,scrim);
      view.querySelector('.chat-identity')?.prepend(listToggle);view.querySelector('.bot-heading-actions')?.append(detailsToggle);
      const bar=document.getElementById('companion-switcher');
      if(bar){switcherHome=document.createComment('companion-switcher');bar.before(switcherHome);profiles.append(bar);}
      const box=document.getElementById('bot-messages');if(box)messagesObserver.observe(box,{childList:true,subtree:true,characterData:true});
      setupPanel()?.addEventListener('toggle',sync);
    },
    unmount(){
      mounted=false;detailsToken++;messagesObserver.disconnect();setupPanel()?.removeEventListener('toggle',sync);
      const bar=document.getElementById('companion-switcher'),view=botView();
      if(bar&&switcherHome?.parentNode)switcherHome.replaceWith(bar);switcherHome=null;
      list.remove();details.remove();scrim.remove();listToggle.remove();detailsToggle.remove();
      if(view){delete view.dataset.msgDetails;delete view.dataset.msgList;}
      for(const row of document.querySelectorAll('#bot-messages [data-msg-cont]'))delete row.dataset.msgCont;
    },
    render(data,ctx){
      if(!mounted)return;
      if(latest?.accounts?.selectedId!==data.accounts?.selectedId){
        loading=null;again=false;stale=true;conversations.clear();version++;
      }
      latest=data;context=ctx;
      if(zh!==ctx.zh){zh=ctx.zh;listKey='';detailsKey='';if(message)say('');}
      if(ctx.view!==lastView){if(ctx.view==='bot')stale=true;lastView=ctx.view;}
      if(ctx.view!=='bot')return;
      // A note about the last switch stops applying once the conversation on screen is another one.
      const targetKey=`${ctx.target.kind}:${ctx.target.id}`;if(targetKey!==lastTarget){if(lastTarget&&!busy&&message)say('');lastTarget=targetKey;}
      copy();sync();
      if(stale)void load();
      drawList(data);drawDetails(data);scheduleGrouping();
    },
  });
  if(typeof data!=='undefined'&&data)render();
})();
