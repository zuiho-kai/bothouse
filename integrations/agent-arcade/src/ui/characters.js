'use strict';
// Character library: imported character cards (PNG or JSON). The list is
// fetched on demand so portraits never travel in the periodic snapshot.
//
// The page is split into in-page tabs so a new profile sees only the library:
//   library | groups | settings | lorebooks
// Tabs other than "library" appear once they are relevant (a character exists, a
// group or lorebook exists, or the App conversation already points at one) or
// when something asks for them through window.ArcadeCharactersTabs.open(name).
//
//  window.ArcadeCharactersTabs
//    open(name, {focus})   switch to the characters view, reveal and select the tab -> its panel
//    panel(name)           the panel node other modules mount into
//    current()             selected tab name
//    note(name, count)     another module reports how many items its tab holds
//    refresh()             recompute which tabs are shown
//  window.ArcadeExampleCharacter
//    card                  the bundled example character, chara_card_v2 shape (plain data)
(() => {
  // One original example character so a new owner can try a character without a card.
  // Plain data in the chara_card_v2 shape; it is added through the main process's
  // normal card parser (window.arcade.charactersAddExample), never read here as markup.
  const EXAMPLE_CARD=Object.freeze({spec:'chara_card_v2',spec_version:'2.0',data:{
    name:'禾川',
    description:'禾川，二十八岁，在老街拐角开一间修钟表和小物件的铺子，店名叫“慢半拍”。说话不急，习惯先听完再回答，会记得你上次说到一半的事。手边总有一件修到一半的东西，喜欢泡茶、听收音机里的天气预报。不评判别人，也不讲大道理；你想聊就聊，不想聊可以只是坐一会儿。',
    personality:'沉稳、耐心、观察细致；有一点冷幽默；不催促，不说教；遇到不懂的事会直说不知道。',
    scenario:'傍晚，{{user}} 路过老街，推开“慢半拍”的门。店里很安静，工作台上摊着一只拆开的旧闹钟。',
    first_mes:'门上的铃响了一下。禾川从工作台后面抬起头，把镊子放下。\n\n“来了？外面风有点大吧。水刚烧开，坐一会儿。今天过得怎么样？”',
    mes_example:'<START>\n{{user}}: 我今天什么都没做成。\n{{char}}: 嗯，那先不算账。喝口水，跟我说说，今天最费劲的是哪一件？\n<START>\n{{user}}: 这只表还能修好吗？\n{{char}}: 现在还不知道，得先拆开看。修不好我会直接告诉你，不收钱。',
    creator_notes:'Agent Arcade 自带的示例角色，文字为原创。可以随意修改、导出或移除。',
    system_prompt:'',post_history_instructions:'',
    alternate_greetings:[
      '“你来得正好。”禾川把一只闹钟转过来给你看，“修了三天，刚才它自己响了。先不说它，你呢，今天有什么想讲的？”',
      '下雨天，店里只开了一盏台灯。禾川给你倒了杯热茶，把杯子推过来。“伞放门口就行。不急着说话，等你缓过来。”',
    ],
    character_book:{name:'慢半拍与老街',description:'',scan_depth:4,token_budget:400,recursive_scanning:false,extensions:{},entries:[
      {id:1,name:'慢半拍',comment:'慢半拍',keys:['慢半拍','铺子','店里'],secondary_keys:[],content:'“慢半拍”是禾川的铺子，在老街拐角，门口挂着一只不走的挂钟。店里修钟表、收音机和各种小物件，按件收费，修不好不收钱。',enabled:true,insertion_order:10,case_sensitive:false,selective:false,constant:false,position:'before_char',priority:10,extensions:{}},
      {id:2,name:'老街',comment:'老街',keys:['老街','街上','邻居'],secondary_keys:[],content:'老街两旁种着梧桐，早上有卖豆浆的小摊，傍晚收摊很早。禾川在这条街住了六年，认识大多数邻居。',enabled:true,insertion_order:20,case_sensitive:false,selective:false,constant:false,position:'before_char',priority:10,extensions:{}},
      {id:3,name:'茶',comment:'茶',keys:['茶','泡茶','喝茶'],secondary_keys:[],content:'禾川习惯泡焙茶，味道淡。给客人用的是一只有小缺口的白瓷杯，他自己用搪瓷缸。',enabled:true,insertion_order:30,case_sensitive:false,selective:false,constant:false,position:'before_char',priority:10,extensions:{}},
    ]},
    tags:['示例','日常'],creator:'Agent Arcade',character_version:'1.0',extensions:{},
  }});
  window.ArcadeExampleCharacter=Object.freeze({card:EXAMPLE_CARD});

  const root=el('section','view characters-view');root.id='characters-view';root.hidden=true;document.querySelector('main').append(root);
  const nav=el('button','nav');nav.dataset.view='characters';
  nav.innerHTML='<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="3" width="16" height="18" rx="3"/><circle cx="12" cy="10" r="3"/><path d="M7.5 18a4.5 4.5 0 0 1 9 0"/></svg>';
  const navText=el('span');nav.append(navText);nav.onclick=()=>switchView('characters');
  document.querySelector('nav').insertBefore(nav,document.querySelector('nav [data-view="settings"]'));
  const option=el('option');option.value='characters';$('view-picker').append(option);
  const heading=el('div','page-heading'),title=el('h1',''),intro=el('p','subtitle'),actions=el('div','button-row'),importButton=el('button','primary'),exampleButton=el('button','secondary'),status=el('div','characters-status');
  status.setAttribute('role','status');importButton.type=exampleButton.type='button';importButton.id='characters-import';exampleButton.id='characters-add-example';exampleButton.hidden=true;heading.append(title);actions.append(importButton,exampleButton);
  const grid=el('div','characters-grid'),empty=el('div','characters-empty'),emptyTitle=el('h2',''),emptyText=el('p',''),more=el('button','plain characters-more'),detail=el('article','settings-card characters-detail');detail.hidden=true;detail.tabIndex=-1;
  empty.hidden=true;empty.append(emptyTitle,emptyText);more.type='button';more.id='characters-more';more.hidden=true;
  const booksTitle=el('h2','characters-section-title'),booksIntro=el('p','subtitle'),booksActions=el('div','button-row'),booksImport=el('button','secondary'),booksStatus=el('div','characters-status'),booksList=el('div','sources-list'),booksEmpty=el('p','relationship-empty');booksImport.type='button';booksImport.id='lorebooks-import';booksStatus.setAttribute('role','status');booksActions.append(booksImport);
  const chatLine=el('div','characters-chat-line');chatLine.hidden=true;
  status.id='characters-import-status';booksStatus.id='lorebooks-import-status';

  // ---- in-page tabs ----
  const TABS=[['library','角色','Characters'],['groups','群聊','Group chats'],['settings','对话设定','Conversation settings'],['lorebooks','世界书','Lorebooks']];
  const STORE='arcade.characters.tab';
  const tabRow=el('div','relationship-tabs kit-tabs characters-tabs');tabRow.id='characters-tabs';tabRow.setAttribute('role','tablist');tabRow.hidden=true;
  const panels={},tabButtons={},counts={groups:0},forced=new Set();
  for(const [name] of TABS){
    const panel=el('div','characters-panel'),tab=el('button','');
    panel.id='characters-panel-'+name;panel.dataset.tab=name;panel.setAttribute('role','tabpanel');panel.hidden=name!=='library';
    tab.type='button';tab.id='characters-tab-'+name;tab.setAttribute('role','tab');tab.setAttribute('aria-controls',panel.id);panel.setAttribute('aria-labelledby',tab.id);
    tab.onclick=()=>selectTab(name,true);panels[name]=panel;tabButtons[name]=tab;tabRow.append(tab);
  }
  let chosen='library';
  try{const saved=localStorage.getItem(STORE);if(Object.hasOwn(panels,saved))chosen=saved;}catch{/* storage may be unavailable; the first tab is fine */}
  panels.library.append(intro,empty,actions,more,status,chatLine,grid,detail);
  panels.lorebooks.append(booksTitle,booksIntro,booksActions,booksStatus,booksEmpty,booksList);
  root.append(heading,tabRow,...TABS.map(([name])=>panels[name]));

  let books=null,st=null,stKey='',detailChat=null,latest=null;
  let zh=true,lang='',items=null,loading=false,busy=false,selected='',loadedOnce=false;
  const tr=(a,b)=>zh?a:b,colon=()=>tr('：',': ');
  const changed=()=>document.dispatchEvent(new Event('arcade-library-changed'));
  const explain=error=>window.ArcadeST?.explain(error,zh)||tr('操作没有完成，请稍后再试。','The action did not complete. Please try again.');
  // A group chat as the conversation target takes over: the stored character is then unused.
  const groupId=()=>st?.available?st.settings?.groupId||null:null;
  const chatId=()=>st?.available&&!st.settings?.groupId?st.settings?.characterId||null:null;
  const batchReports=new Map();
  const say=message=>{batchReports.delete(status);status.textContent=message||'';};
  const sayBooks=message=>{batchReports.delete(booksStatus);booksStatus.textContent=message||'';};
  function reportImport(node,results){
    batchReports.set(node,results);
    const isBook=node===booksStatus;
    const reasons={
      too_large:tr('文件超过大小限制。','The file exceeds the size limit.'),
      invalid:isBook?tr('无法识别为世界书 JSON。','This file is not a supported lorebook JSON.'):
        tr('无法识别为角色卡 PNG 或 JSON。','This file is not a supported PNG or JSON character card.'),
      full:isBook?tr('世界书库已满。','The lorebook library is full.'):tr('角色库已满。','The character library is full.'),
      unreadable:tr('无法读取文件。','The file could not be read.'),
      save_failed:tr('未能保存到库中，请检查剩余空间和写入权限。','Could not save to the library. Check available space and write access.')
    };
    const counts={imported:0,skipped:0,failed:0},details=el('ul','characters-import-details');
    for(const row of results){
      if(Object.hasOwn(counts,row.status))counts[row.status]++;
      if(row.status==='failed'){
        const item=el('li','',row.file+colon()+(reasons[row.code]||tr('导入失败。','Import failed.')));
        item.dataset.importFile=row.file;item.dataset.importCode=row.code||'unknown';details.append(item);
      }
      if(row.warnings?.length){
        const item=el('li','',row.file+' · '+tr('注意','Note')+colon()+row.warnings.join(tr('；',' · ')));
        item.dataset.importFile=row.file;item.dataset.importWarning='';details.append(item);
      }
    }
    const {imported,skipped,failed}=counts;
    const summary=el('strong','',tr(`已导入 ${imported} · 已跳过 ${skipped}（库中已有相同内容）· 失败 ${failed}`,`Imported ${imported} · Skipped ${skipped} (identical content already in the library) · Failed ${failed}`));
    summary.dataset.importSummary='';node.replaceChildren(summary);
    if(details.childElementCount)node.append(details);
  }
  // No AI is connected yet: the first-run module decides when it is loaded; otherwise the
  // snapshot says the App conversation is supported but can neither run nor be started.
  function needsAI(){
    if(!latest)return false;
    try{if(typeof window.ArcadeFirstRun?.needed==='function')return !!window.ArcadeFirstRun.needed(latest);}catch{/* fall through to the snapshot */}
    const local=latest.bot?.local;return !!local&&local.supported!==false&&!local.available&&!local.canStart;
  }
  const started=()=>latest?.desktopChat?.kind==='local'&&!!latest?.bot?.local?.available;
  function openAI(){
    try{if(typeof window.ArcadeFirstRun?.open==='function'){window.ArcadeFirstRun.open();return;}}catch{/* fall back to the chat page */}
    switchView('bot');
  }

  function available(name){
    if(name==='library')return true;
    const count=items?.length||0;
    if(name==='groups')return !!panels.groups.firstElementChild&&(forced.has(name)||count>=2||counts.groups>0||!!groupId()||st?.problem==='group_missing'||st?.problem==='group_unreadable');
    if(name==='settings'){const card=document.getElementById('st-settings-card');return !!card&&!card.hidden&&(forced.has(name)||count>=1||!!chatId()||!!groupId()||(books?.length||0)>0||counts.groups>0);}
    return forced.has(name)||count>=1||(books?.length||0)>0;
  }
  function syncTabs(){
    const shown=TABS.filter(([name])=>available(name)).map(([name])=>name);
    const active=shown.includes(chosen)?chosen:'library';
    for(const [name,a,b] of TABS){
      const tab=tabButtons[name],on=name===active,text=tr(a,b);
      if(tab.textContent!==text)tab.textContent=text;
      tab.hidden=!shown.includes(name);tab.setAttribute('aria-selected',String(on));tab.tabIndex=on?0:-1;
      panels[name].hidden=!on;
    }
    tabRow.hidden=shown.length<2;root.dataset.tab=active;
    // Offer the rest of the page while the tabs are still held back.
    const held=TABS.some(([name])=>name!=='library'&&!shown.includes(name)&&(name!=='groups'||panels.groups.firstElementChild)&&(name!=='settings'||(document.getElementById('st-settings-card')&&!document.getElementById('st-settings-card').hidden)));
    more.hidden=!held||!loadedOnce;
    return active;
  }
  function selectTab(name,byUser=false){
    if(!Object.hasOwn(panels,name))return;
    chosen=name;
    if(byUser){try{localStorage.setItem(STORE,name);}catch{/* not remembered; nothing else depends on it */}}
    syncTabs();
  }
  tabRow.addEventListener('keydown',event=>{
    const shown=TABS.map(([name])=>name).filter(name=>!tabButtons[name].hidden),index=shown.findIndex(name=>tabButtons[name]===document.activeElement);if(index<0)return;
    const step={ArrowRight:1,ArrowLeft:-1}[event.key],to=event.key==='Home'?0:event.key==='End'?shown.length-1:step?(index+step+shown.length)%shown.length:-1;
    if(to<0)return;event.preventDefault();selectTab(shown[to],true);tabButtons[shown[to]].focus();
  });
  more.onclick=()=>{for(const [name] of TABS)forced.add(name);syncTabs();(TABS.map(([name])=>tabButtons[name]).find(tab=>!tab.hidden&&tab.getAttribute('aria-selected')!=='true')||importButton).focus({preventScroll:true});};
  window.ArcadeCharactersTabs=Object.freeze({
    open(name,{focus=true}={}){
      if(!Object.hasOwn(panels,name))return null;
      if(document.body.dataset.view!=='characters')switchView('characters');
      forced.add(name);selectTab(name,true);
      const active=syncTabs(),panel=panels[active];
      requestAnimationFrame(()=>{(tabRow.hidden?root:tabRow).scrollIntoView({block:'start'});if(focus&&!tabRow.hidden)tabButtons[active].focus({preventScroll:true});});
      return panel;
    },
    panel:name=>panels[name]||null,
    current:()=>root.dataset.tab||'library',
    embeddedLorebookAction,
    note(name,count){if(counts[name]!==count){counts[name]=count;syncTabs();}},
    refresh:()=>{syncTabs();},
  });

  // Selecting a character retires the running App conversation; it is then
  // started again through the same call the chat page's own buttons use.
  // Returns '' on success, or the reason the conversation did not start.
  async function chatAs(id){
    let problem='';
    await run(async()=>{
      const before=chatId(),group=groupId();
      if(before!==id||group){try{st=await window.arcade.stConfigure(group?{characterId:id,groupId:null}:{characterId:id});}catch(error){problem=`${tr('没有切换','Not switched')}${colon()}${explain(error)}`;return;}drawChat();draw();}
      if(id===null)return;
      const result=await window.ArcadeDesktopConversation?.select('local',true,{force:before!==id||!!group});
      if(result?.ok===false)problem=`${tr('已选好，但还没开始聊','Selected, but the chat has not started')}${colon()}${needsAI()?tr('还没有连接 AI。','no AI is connected yet.'):explain(result)}`;
    });
    // Still on this page (switched back, or the start did not succeed): keep keyboard focus on a live control.
    if(document.body.dataset.view==='characters'&&[document.body,null].includes(document.activeElement)){const target=id===null?importButton:document.getElementById('characters-chat-as');(target&&!target.hidden?target:importButton).focus({preventScroll:true});}
    return problem;
  }
  let lineMessage='';
  function drawChat(){
    const focused=chatLine.contains(document.activeElement);
    if(!st){chatLine.hidden=true;return;}
    if(!st.available){chatLine.hidden=false;chatLine.replaceChildren(el('p','',tr('当前档案不能使用 App 对话，所以这里暂时不能选角色聊天。角色卡仍可导入、查看和导出。','App conversation is not available for the current profile, so a character cannot be chosen for chat here. Cards can still be imported, viewed and exported.')));return;}
    const id=chatId(),group=groupId(),problems={group_missing:tr('为 App 对话选的群聊已经不存在。请在“群聊”里另选一个，或另选一个角色，或改回内置角色。','The group chat chosen for the App conversation no longer exists. Choose another under Group chats, choose a character, or switch back to the built-in character.'),group_unreadable:tr('为 App 对话选的群聊读不出来。可以在“群聊”里重新保存它，或改回内置角色。','The group chat chosen for the App conversation could not be read. Save it again under Group chats, or switch back to the built-in character.'),character_missing:tr('为 App 对话选的角色已不在角色库中。请另选一个角色，或改回内置角色。','The character chosen for the App conversation is no longer in the library. Choose another character, or switch back to the built-in character.'),character_unreadable:tr('为 App 对话选的角色文件读不出来。可以重新导入这张角色卡，或改回内置角色。','The file of the character chosen for the App conversation could not be read. Import the card again, or switch back to the built-in character.')};
    const problem=Object.hasOwn(problems,st.problem)?problems[st.problem]:'';
    // Nothing to say on an empty library that still uses the built-in character.
    if(!problem&&!id&&!group&&!lineMessage&&!(items?.length)){chatLine.hidden=true;chatLine.replaceChildren();return;}
    chatLine.hidden=false;
    const text=el('p','',problem||(group?tr(`App 对话现在是群聊：${st.group?.name||''}`,`The App conversation is now the group chat: ${st.group?.name||''}`):id?tr(`App 对话选的角色：${st.character?.name||''}`,`Character chosen for the App conversation: ${st.character?.name||''}`):tr('App 对话现在用的是内置角色。打开一个角色，可以改用它聊天。','The App conversation uses the built-in character. Open a character to chat as it instead.')));
    const nodes=[text];
    if(id||group){const back=el('button','secondary',tr('改回内置角色','Back to the built-in character'));back.type='button';back.id='characters-chat-builtin';back.disabled=busy;back.onclick=async()=>{lineMessage='';const failed=await chatAs(null);lineMessage=failed||tr('已改回内置角色。到“对话”页就能继续聊。','Switched back to the built-in character. Continue on the Chat page.');drawChat();};nodes.push(back);}
    if(lineMessage){const note=el('p','characters-line-note',lineMessage);note.setAttribute('role','status');nodes.push(note);}
    chatLine.replaceChildren(...nodes);
    if(focused)(chatLine.querySelector('button')||importButton).focus({preventScroll:true});
  }
  async function run(fn,report=say){
    if(busy)return;busy=true;importButton.disabled=booksImport.disabled=exampleButton.disabled=true;drawChat();detailChat?.();
    try{await fn();}catch(error){report(`${tr('没有完成','Not completed')}: ${error.message}`);}
    finally{busy=false;importButton.disabled=booksImport.disabled=exampleButton.disabled=false;drawChat();detailChat?.();}
  }
  async function load(){
    if(loading||typeof window.arcade?.charactersList!=='function')return;loading=true;
    try{items=await window.arcade.charactersList();books=await window.arcade.lorebooksList();loadedOnce=true;draw();drawBooks();drawChat();}catch(error){say(`${tr('角色库无法读取','The library could not be read')}: ${error.message}`);}
    finally{loading=false;}
  }
  function portrait(thumb,name,cls){
    const frame=el('div',cls);
    if(thumb){const image=el('img','');image.src=thumb;image.alt='';frame.append(image);}
    else frame.append(el('span','',(name||'?').trim().slice(0,1)));
    return frame;
  }
  function draw(){
    const rows=items||[],none=loadedOnce&&!rows.length;
    empty.hidden=!none;intro.hidden=none;root.dataset.empty=String(none);
    exampleButton.hidden=!none||typeof window.arcade?.charactersAddExample!=='function';
    grid.replaceChildren(...rows.map(row=>{
      const card=el('button','characters-card');card.type='button';card.dataset.characterId=row.id;card.setAttribute('aria-pressed',String(row.id===selected));
      const body=el('div','characters-card-body');
      if(row.id===chatId())card.append(el('span','characters-badge',started()?tr('App 对话使用中','In App conversation'):tr('已选好','Selected')));
      body.append(el('strong','',row.name),el('span','characters-meta',[row.creator,row.greetings?tr(`${row.greetings} 条开场白`,`${row.greetings} greetings`):'',row.hasBook?tr('含世界书','Lorebook'):''].filter(Boolean).join(' · ')));
      card.append(portrait(row.thumb,row.name,'characters-portrait'),body);card.onclick=()=>open(row.id);return card;
    }));
    if(selected&&!rows.some(row=>row.id===selected)){selected='';detail.hidden=true;detailChat=null;}
    syncTabs();
  }
  function line(label,value){if(!value)return null;const wrap=el('div','characters-field');wrap.append(el('h3','',label),el('p','',value));return wrap;}
  function embeddedLorebookAction(card){
    if(!card?.bookEntries||typeof window.arcade?.lorebooksSaveFromCharacter!=='function')return null;
    const wrap=el('div','characters-field characters-embedded-book'),button=el('button','secondary',tr('保存到世界书库','Save to lorebook library'));
    button.type='button';
    const note=el('p','characters-meta',tr('保存后可在「世界书」查看。QQ 群仍需查看条目并单独批准。',
      'Find saved books under Lorebooks. In QQ Group settings, review the entries and approve the book for that group.'));
    note.setAttribute('role','status');wrap.append(button,note);
    button.onclick=()=>{
      if(busy||button.disabled)return;
      button.disabled=true;
      note.textContent=tr('正在保存世界书…','Saving lorebook…');
      const failed=tr('未能保存世界书，请稍后再试。','Could not save the lorebook. Try again.');
      void run(async()=>{
        const result=await window.arcade.lorebooksSaveFromCharacter(card.id);
        if(!result?.ok){
          const message={character_missing:tr('这个角色已不在角色库中。','This character is no longer in the library.'),
            no_book:tr('这张卡已没有可保存的内嵌世界书。','This card no longer has an embedded lorebook to save.'),
            full:tr('世界书库已满，请移除不用的书后再试。','The lorebook library is full. Remove an unused book and try again.'),
            too_large:tr('这本世界书超过大小上限，无法保存。','This lorebook is too large to save.')}[result?.code];
          note.textContent=message||failed;return;
        }
        const saved=result.list.find(book=>book.id===result.id);
        if(!saved){note.textContent=failed;return;}
        books=result.list;drawBooks();
        if(!result.skipped)changed();
        note.textContent=result.skipped?
          tr(`「${saved.name}」已在「世界书」。QQ 群仍需单独批准。`,`“${saved.name}” is already under Lorebooks. QQ groups still need separate approval.`):
          tr(`「${saved.name}」已保存，可在「世界书」查看。QQ 群仍需单独批准。`,`“${saved.name}” was saved under Lorebooks. QQ groups still need separate approval.`);
      },()=>{note.textContent=failed;}).finally(()=>{button.disabled=false;});
    };
    return wrap;
  }
  async function open(id){
    await run(async()=>{
      const card=await window.arcade.charactersGet(id);if(!card){say(tr('这个角色已不存在。','This character no longer exists.'));await load();return;}
      selected=id;draw();detail.hidden=false;
      const head=el('div','characters-detail-head'),names=el('div','');
      names.append(el('h2','',card.name),el('p','characters-meta',[card.creator&&tr(`作者：${card.creator}`,`By ${card.creator}`),card.characterVersion,card.tags?.slice(0,8).join(' · ')].filter(Boolean).join('　')));
      head.append(portrait(card.thumb,card.name,'characters-portrait characters-portrait-large'),names);
      const facts=[card.alternateGreetings?tr(`另有 ${card.alternateGreetings} 条备选开场白`,`${card.alternateGreetings} alternate greetings`):'',card.bookEntries?tr(`内嵌世界书 ${card.bookEntries} 条`,`Embedded lorebook: ${card.bookEntries} entries`):'',card.hasSystemPrompt?tr('带系统提示词（只影响陪伴对话，不给予任何工具或账号权限）','Has a system prompt (affects companion chat only; grants no tool or account authority)'):'',card.hasPostHistory?tr('带后置指令','Has post-history instructions'):''].filter(Boolean);
      const buttons=el('div','button-row'),exportButton=el('button','secondary',tr('导出角色卡…','Export card…')),removeButton=el('button','plain',tr('从角色库移除','Remove from library'));
      const chatButton=el('button','primary',''),chatNote=el('p','characters-chat-note',''),problemLine=el('div','characters-chat-problem'),problemText=el('p',''),fix=el('button','secondary',''),detailStatus=el('p','characters-chat-note');
      chatButton.type=fix.type='button';chatButton.id='characters-chat-as';fix.id='characters-chat-fix';problemLine.setAttribute('role','status');problemLine.append(problemText,fix);detailStatus.setAttribute('role','status');
      let failure='';
      const tell=message=>{detailStatus.textContent=message||'';detailStatus.hidden=!message;};tell('');
      const qqButton=el('button','secondary');qqButton.id='characters-qq-group-use';qqButton.type='button';
      qqButton.onclick=()=>window.ArcadeGroupCard?.open({id,name:card.name,profileId:latest?.accounts?.selectedId},qqButton);
      chatButton.onclick=async()=>{if(needsAI()){openAI();return;}failure='';tell('');failure=await chatAs(id)||'';detailChat?.();};
      fix.onclick=()=>openAI();
      detailChat=()=>{
        qqButton.hidden=!window.ArcadeGroupCard?.available();qqButton.textContent=tr('用于 QQ 群','Use in QQ group');
        const can=!!st?.available,current=chatId()===id,need=needsAI(),live=current&&started();
        chatButton.hidden=chatNote.hidden=!can;chatButton.disabled=fix.disabled=busy;
        chatButton.textContent=need?tr('先连接 AI，再和它聊','Connect an AI first, then chat'):live?tr('继续和这个角色聊天','Continue chatting as this character'):current?tr('开始和这个角色聊天','Start chatting as this character'):tr('用这个角色聊天','Chat as this character');
        chatNote.textContent=need?tr('还没有连接 AI。填一个 API key 之后，就能用这个角色聊天。','No AI is connected yet. After you add one API key you can chat as this character.'):live?tr('App 对话正在使用这个角色。','The App conversation is using this character.'):current?tr('已选好，但还没开始聊。','Selected, but the chat has not started.'):tr('会把 App 对话切换到这个角色并打开聊天页；每个角色有自己的聊天记录和记忆。','Switches the App conversation to this character and opens the chat page. Each character keeps its own history and memory.');
        // A failed start is reported here, beside the button that caused it, with the way to fix it.
        const show=can&&!!failure&&!live;problemLine.hidden=!show;problemText.textContent=show?failure:'';fix.textContent=need?tr('连接 AI','Connect an AI'):tr('检查 AI 设置','Check the AI settings');
        if(live)failure='';
      };
      exportButton.type=removeButton.type='button';
      exportButton.onclick=()=>run(async()=>{const result=await window.arcade.charactersExport(id,'v2');tell(result?.saved?tr('已导出。','Exported.'):'');},tell);
      let armed=false;
      removeButton.onclick=()=>{
        if(!armed){armed=true;removeButton.textContent=tr('再点一次确认移除','Click again to remove');return;}
        run(async()=>{const result=await window.arcade.charactersRemove(id);if(!result.removed){armed=false;removeButton.textContent=tr('从角色库移除','Remove from library');tell(tr('没有移除：目录里有其他文件。','Not removed: the folder holds other files.'));return;}items=result.list;selected='';detail.hidden=true;detailChat=null;draw();drawChat();changed();say(tr('已移除。','Removed.'));importButton.focus();},tell);
      };
      buttons.append(chatButton,qqButton,exportButton,removeButton);detailChat();
      detail.replaceChildren(...[head,line(tr('简介','Description'),card.description),line(tr('性格','Personality'),card.personality),line(tr('场景','Scenario'),card.scenario),line(tr('开场白','First message'),card.firstMessage),line(tr('作者备注','Creator notes'),card.creatorNotes),facts.length?line(tr('这张卡还包含','This card also has'),facts.join('\n')):null,embeddedLorebookAction(card),buttons,problemLine,chatNote,detailStatus].filter(Boolean));
      if(document.body.dataset.view==='characters'&&!panels.library.hidden){detail.focus({preventScroll:true});detail.scrollIntoView({block:'nearest'});}
    });
  }
  function drawBooks(){
    const rows=books||[];booksEmpty.hidden=rows.length>0;booksEmpty.textContent=loadedOnce?tr('还没有独立世界书。','No standalone lorebooks yet.'):'';
    booksList.replaceChildren(...rows.map(book=>{
      const item=el('div','sources-row characters-book-row'),body=el('div','sources-row-body');
      body.append(el('strong','',book.name),el('span','sources-meta',tr(`${book.entries} 条，其中 ${book.enabledEntries} 条启用`,`${book.entries} entries, ${book.enabledEntries} enabled`)));
      item.append(body,bookDetails(book));return item;
    }));
    syncTabs();
  }
  function bookDetails(book){
    const details=el('details','characters-book-details'),summary=el('summary','',tr('查看条目','View entries'));
    const status=el('p','characters-meta'),list=el('ol','characters-book-entries');status.setAttribute('role','status');
    const remove=el('button','plain',tr('移除这本世界书','Remove this lorebook'));remove.type='button';remove.hidden=true;
    let reading=false,loaded=false,armed=false;
    details.ontoggle=async()=>{
      if(!details.open){armed=false;remove.textContent=tr('移除这本世界书','Remove this lorebook');return;}
      if(reading||loaded)return;
      reading=true;status.textContent=tr('正在读取条目…','Loading entries…');
      try{
        const entries=await window.arcade.lorebooksReadEntries(book.id);
        if(!entries)throw Error('Lorebook unavailable');
        list.replaceChildren(...entries.map(entry=>{
          const row=el('li','');
          const title=el('strong','', [entry.comment,entry.enabled?tr('已启用','Enabled'):tr('已停用','Disabled')].filter(Boolean).join(' · '));
          row.append(title);
          if(entry.keys.length)row.append(el('p','characters-meta',tr(`关键词：${entry.keys.join('、')}`,`Keywords: ${entry.keys.join(', ')}`)));
          if(entry.secondaryKeys.length)row.append(el('p','characters-meta',tr(`次关键词：${entry.secondaryKeys.join('、')}`,`Secondary keywords: ${entry.secondaryKeys.join(', ')}`)));
          row.append(el('p','characters-book-content',entry.content));return row;
        }));
        status.textContent=entries.length?'':tr('没有条目。','No entries.');
        loaded=true;remove.hidden=false;
      }catch{status.textContent=tr('未能读取条目，请合上后重新打开。','Could not read the entries. Close and open them to retry.');}
      finally{reading=false;}
    };
    remove.onclick=()=>{
      if(!loaded||busy)return;
      if(!armed){armed=true;remove.textContent=tr('确认移除这本世界书','Confirm removal of this lorebook');return;}
      void run(async()=>{const result=await window.arcade.lorebooksRemove(book.id);books=result.list;drawBooks();changed();sayBooks(result.removed?tr('世界书已移除。','Lorebook removed.'):tr('没有移除。','Not removed.'));booksImport.focus();},sayBooks);
    };
    details.append(summary,status,list,remove);return details;
  }
  booksImport.onclick=()=>run(async()=>{
    const result=await window.arcade.lorebooksImport();if(!result)return;books=result.list;drawBooks();
    if(result.batch){
      reportImport(booksStatus,result.results);
      if(result.results.some(row=>row.status==='imported'))changed();
      return;
    }
    changed();
    sayBooks(`${tr('已导入世界书','Lorebook imported')}${colon()}${result.name}（${result.entries}）${result.warnings?.length?`　${tr('注意','Note')}: ${result.warnings.slice(0,3).join('；')}`:''}`);
  },sayBooks);
  async function added(result,done){
    if(!result)return;
    if(Array.isArray(result.list))items=result.list;else items=await window.arcade.charactersList();
    draw();drawChat();changed();
    say(`${done}${colon()}${result.name||''}${result.warnings?.length?`　${tr('注意','Note')}: ${result.warnings.slice(0,3).join('；')}`:''}`);
    if(result.id)await open(result.id);
  }
  importButton.onclick=async()=>{
    let single;
    await run(async()=>{
      const result=await window.arcade.charactersImport();
      if(!result?.batch){single=result;return;}
      items=result.list;selected='';detailChat=null;detail.hidden=true;
      draw();drawChat();reportImport(status,result.results);
      if(result.results.some(row=>row.status==='imported'))changed();
    });
    await added(single,tr('已导入','Imported'));
  };
  // The example goes through the main process like any imported card. Without that call the
  // button stays hidden (see draw()).
  exampleButton.onclick=async()=>{
    const add=window.arcade?.charactersAddExample;if(typeof add!=='function')return;
    let result=null;await run(async()=>{result=await add(EXAMPLE_CARD);});await added(result,tr('已添加示例角色','Example character added'));
  };
  window.renderCharacters=data=>{
    if(typeof window.arcade?.charactersList!=='function'){nav.hidden=option.hidden=true;return;}
    latest=data;zh=data.config?.language==='zh';
    if(lang!==data.config?.language){
      lang=data.config?.language;
      for(const [node,results] of batchReports)reportImport(node,results);
      const name=tr('角色库','Characters');navText.textContent=option.textContent=name;nav.title=name;nav.setAttribute('aria-label',name);title.textContent=name;
      tabRow.setAttribute('aria-label',tr('角色页的几个部分','Sections of the characters page'));
      intro.textContent=tr('导入角色卡（PNG 或 JSON，兼容 SillyTavern V1/V2/V3）。卡里的文字只当人设资料用，卡内脚本和扩展不会运行；第三方角色卡和图片的版权归其作者。','Import character cards (PNG or JSON; SillyTavern V1/V2/V3 compatible). Card text is used as persona material only; scripts and extensions inside a card never run. Third-party cards and artwork belong to their authors.');
      importButton.textContent=tr('导入角色卡（可多选）…','Import one or more cards…');exampleButton.textContent=tr('添加一位示例角色','Add an example character');
      emptyTitle.textContent=tr('角色库还是空的','The library is empty');
      emptyText.textContent=tr('导入一张角色卡（PNG 或 JSON，兼容 SillyTavern）就能和它聊天；卡内脚本不会运行。没有角色卡也没关系：在“对话”页可以直接和内置角色聊。','Import a character card (PNG or JSON, SillyTavern compatible) to chat with it; scripts inside a card never run. No card yet? You can chat with the built-in character on the Chat page.');
      more.textContent=tr('显示群聊、对话设定和世界书','Show group chats, conversation settings and lorebooks');
      stKey='';draw();
      booksTitle.textContent=tr('世界书','Lorebooks');booksIntro.textContent=tr('独立的世界书（SillyTavern 世界信息 JSON）。条目按关键词在对话中触发，只作为背景资料。在“对话设定”里选择要用哪几本。','Standalone lorebooks (SillyTavern world info JSON). Entries trigger on keywords during chat and are used as background material only. Choose which ones to use under Conversation settings.');booksImport.textContent=tr('导入世界书（可多选）…','Import one or more lorebooks…');drawBooks();
    }
    const nextSt=data.bot?.st||null,local=data.bot?.local,nextKey=JSON.stringify([nextSt?.available,nextSt?.settings?.characterId,nextSt?.character?.name,nextSt?.problem,nextSt?.settings?.groupId,nextSt?.group?.name,local?.available,local?.canStart,local?.supported,data.desktopChat?.kind,needsAI()]);
    if(!busy&&nextKey!==stKey){stKey=nextKey;st=nextSt;const focusedCard=grid.contains(document.activeElement)?document.activeElement.dataset.characterId:'';draw();if(focusedCard)[...grid.children].find(node=>node.dataset.characterId===focusedCard)?.focus({preventScroll:true});drawChat();detailChat?.();}
    if(!loadedOnce&&document.body.dataset.view==='characters')load();
  };
  new MutationObserver(()=>{if(document.body.dataset.view==='characters')load();}).observe(document.body,{attributes:true,attributeFilter:['data-view']});
})();
