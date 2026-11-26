'use strict';
// Minimal layout: the shell becomes a left rail (CSS only) and this file adds the keyboard side:
// a command palette (Ctrl+K / Cmd+K), single-key navigation ("g" then a letter, "/" and "?")
// and a shortcuts sheet. Existing nodes are never moved; everything created here is inserted in
// mount() and removed again in unmount(), together with every listener.
(() => {
  if(!window.ArcadeLayouts)return;
  const shell=window.ArcadeShell,theme=window.ArcadeTheme;
  // appearance.js records the host platform on <html>; the browser check remains the fallback.
  const mac=document.documentElement.dataset.platform?document.documentElement.dataset.platform==='darwin':/Mac|iPhone|iPad/.test(navigator.platform||'');
  const LABELS={bot:['对话','Chat'],characters:['角色','Characters'],relationship:['相处','Together'],notices:['提醒','Notices'],notes:['笔记','Notes'],tasks:['任务','Tasks'],scene:['会话','Sessions'],work:['工作与结果','Work & results'],connections:['渠道','Channels'],accounts:['搭档与账号','Companions'],'qq-runtime':['QQ 账号','QQ accounts'],settings:['设置','Settings']};
  const LAYOUTS=[['immersive','沉浸','Immersive'],['messenger','聊天','Messenger'],['minimal','简洁','Minimal']];
  const PRESET_NAMES=[['橘','Orange'],['珊瑚红','Coral'],['粉','Pink'],['紫','Violet'],['蓝','Blue'],['青','Teal'],['绿','Green'],['灰','Grey']];
  const GROUPS={go:['前往','Go to'],chat:['聊天对象','Chat with'],layout:['布局','Layout'],accent:['强调色','Accent colour'],look:['外观','Appearance'],toggle:['开关','Toggles'],library:['角色页','Characters page'],help:['帮助','Help']};
  const GROUP_ORDER=['go','chat','layout','accent','look','toggle','library','help'];
  const CHORD={c:'bot',r:'characters',m:'relationship',b:'notes',n:'notices',s:'settings'};
  const KEY_OF={bot:'G C',characters:'G R',relationship:'G M',notes:'G B',notices:'G N',settings:'G S'};
  const LIMIT=50,CHAT_IDLE_LIMIT=8,CACHE_MS=20000,CHORD_MS=1500;
  let mounted=false,latest=null,zh=true,view='',workspace='companion';
  const tr=(a,b)=>zh?a:b;
  const pair=value=>tr(value[0],value[1]),other=value=>tr(value[1],value[0]);
  const setText=(node,text)=>{if(node.textContent!==text)node.textContent=text;};
  const byId=id=>document.getElementById(id);
  const kbd=text=>el('kbd','min-kbd',text);
  const explain=error=>window.ArcadeST?.explain?.(error,zh)||tr('操作没有完成，请稍后再试。','The action did not complete. Please try again.');

  // ---- nodes owned by this layout ----
  const actions=el('div','min-actions');
  const openButton=el('button','min-open'),openText=el('span','min-open-text'),openKey=kbd(mac?'⌘K':'Ctrl K');
  openButton.type='button';openButton.id='min-palette-open';openButton.setAttribute('aria-haspopup','dialog');openButton.setAttribute('aria-keyshortcuts',mac?'Meta+K':'Control+K');openButton.append(openText,openKey);
  const helpButton=el('button','min-help-open','?');helpButton.type='button';helpButton.id='min-help-open';helpButton.setAttribute('aria-haspopup','dialog');
  actions.append(openButton,helpButton);
  const live=el('div','sr-only');live.setAttribute('role','status');live.id='min-live';

  const palette=el('dialog','min-dialog min-palette');palette.id='min-palette';
  const field=el('div','min-palette-field'),prompt=el('span','min-palette-prompt','›'),input=el('input','min-palette-input'),escKey=kbd('Esc');
  prompt.setAttribute('aria-hidden','true');
  input.type='text';input.id='min-palette-input';input.autocomplete='off';input.spellcheck=false;input.maxLength=80;
  for(const [k,v] of Object.entries({role:'combobox','aria-expanded':'true','aria-controls':'min-palette-list','aria-autocomplete':'list','aria-haspopup':'listbox'}))input.setAttribute(k,v);
  field.append(prompt,input,escKey);
  const list=el('div','min-palette-list');list.id='min-palette-list';list.setAttribute('role','listbox');list.tabIndex=-1;
  const foot=el('div','min-palette-foot'),footKeys=el('span','min-palette-keys'),count=el('span','min-palette-count');count.setAttribute('role','status');
  foot.append(footKeys,count);palette.append(field,list,foot);

  const help=el('dialog','min-dialog min-help');help.id='min-help';help.setAttribute('aria-labelledby','min-help-title');
  const helpTitle=el('h2','min-help-title'),helpList=el('dl','min-help-list'),helpClose=el('button','min-help-close');helpTitle.id='min-help-title';helpClose.type='button';
  help.append(helpTitle,helpList,helpClose);

  // ---- commands ----
  let library={at:0,characters:null,groups:null},loading=false,shown=[],active=-1,total=0;
  const stState=()=>{const st=latest?.bot?.st;return st?.available&&st.settings&&typeof window.arcade?.stConfigure==='function'?st:null;};
  async function fetchLibrary(){
    if(loading||library.characters&&Date.now()-library.at<CACHE_MS)return;
    if(typeof window.arcade?.charactersList!=='function')return;
    loading=true;
    try{
      const [characters,groups]=await Promise.all([window.arcade.charactersList(),typeof window.arcade.groupsList==='function'?window.arcade.groupsList():[]]);
      library={at:Date.now(),characters:Array.isArray(characters)?characters:[],groups:Array.isArray(groups)?groups:[]};
    }catch{library={at:0,characters:null,groups:null};}
    finally{loading=false;if(mounted&&palette.open)draw(true);}
  }
  const forgetLibrary=()=>{library={at:0,characters:null,groups:null};};
  // Same steps as chatAs() in characters.js: store the choice, then start the App conversation
  // through the call the chat page's own buttons use. Failures are reported, never hidden.
  async function chatAs(id){
    const st=stState();if(!st)return;
    const group=st.settings.groupId||null,before=group?null:st.settings.characterId||null;
    if(before!==id||group){try{await window.arcade.stConfigure(group?{characterId:id,groupId:null}:{characterId:id});}catch(error){toast(`${tr('没有切换','Not switched')}${tr('：',': ')}${explain(error)}`);return;}}
    if(id===null){toast(tr('已改回内置搭档。下次在 App 对话里点“开始聊天”即可继续。','Switched back to the built-in companion. Choose Start chatting in the App conversation to continue.'));return;}
    const result=await window.ArcadeDesktopConversation?.select('local',true,{force:before!==id||!!group});
    if(result?.ok===false)toast(`${tr('角色已选好，但对话没有开始','The character is selected, but the conversation did not start')}${tr('：',': ')}${explain(result)}`);
  }
  // Same steps as start() in groups.js.
  async function startGroup(id){
    const st=stState();if(!st)return;
    const before=st.settings.groupId||null;
    if(before!==id){try{await window.arcade.stConfigure({groupId:id});}catch(error){toast(`${tr('没有切换','Not switched')}${tr('：',': ')}${explain(error)}`);return;}}
    const result=await window.ArcadeDesktopConversation?.select('local',true,{force:before!==id});
    if(result?.ok===false)toast(`${tr('群聊已选好，但对话没有开始','The group chat is selected, but the conversation did not start')}${tr('：',': ')}${explain(result)}`);
  }
  // Open the characters page at one of its sections and put focus on that section's first control.
  // The characters page is split into in-page tabs: select the right one before scrolling to a section.
  const tab=name=>{window.ArcadeCharactersTabs?.open(name,{focus:false});};
  function section(find){
    shell.open('characters');
    requestAnimationFrame(()=>requestAnimationFrame(()=>{
      const target=find();if(!target||target.hidden)return;
      target.scrollIntoView({block:'start'});
      let node=target;const pick=n=>n.matches?.('button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled])')?n:n.querySelector?.('button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled])');
      let control=pick(node);for(let i=0;!control&&i<3&&node.nextElementSibling;i++){node=node.nextElementSibling;control=pick(node);}
      control?.focus({preventScroll:true});
    }));
  }
  function setAppearance(value){
    // The Settings radios own saving and its feedback; choose the radio the way a click would.
    const radio=document.querySelector(`input[name="appearance"][value="${value}"]`);
    if(!radio||radio.disabled)return;
    if(radio.checked)return;
    radio.checked=true;radio.dispatchEvent(new Event('change',{bubbles:true}));
  }
  function focusComposer(){
    const area=byId('desktop-chat-input');
    if(!area||area.disabled||!area.offsetParent)return false;
    area.focus({preventScroll:true});return true;
  }
  function commands(){
    const out=[],config=latest?.config||{},bar=shell.bar;
    const add=(group,label,alt,hint,run,extra)=>out.push({group,label,alt:alt||'',hint:hint||'',run,...extra});
    const current=tr('当前','Current');
    // Go to: every navigation entry that is currently offered, in both workspaces.
    const wsName={companion:tr('陪伴','Companion'),work:tr('工作','Work')};
    const go=(name,hint)=>{const text=pair(LABELS[name]||[name,name]);add('go',tr(`前往：${text}`,`Go to ${text}`),`${other(LABELS[name]||[name,name])} ${name}`,name===view?current:KEY_OF[name]||hint,()=>shell.open(name));};
    for(const button of bar.querySelectorAll('.shell-nav [data-view]')){
      const name=button.dataset.view,ws=button.dataset.ws;
      if(button.hidden||!['companion','work'].includes(ws))continue;
      go(name,wsName[ws]);
      if(name==='connections'){
        if(latest?.accounts)go('accounts',wsName.work);
        const qq=bar.querySelector('.shell-nav [data-view="qq-runtime"]');if(qq&&!qq.hidden)go('qq-runtime',wsName.work);
      }
    }
    const settings=bar.querySelector('.shell-tools [data-view="settings"]');if(settings&&!settings.hidden)go('settings','');
    for(const name of ['companion','work'])add('go',tr(`切换工作区：${wsName[name]}`,`Switch workspace: ${wsName[name]}`),name==='work'?'工作 work workspace':'陪伴 companion workspace',name===workspace?current:'G W',()=>shell.setWorkspace(name));
    // Chat with: library characters, group chats, and the way back to the built-in companion.
    const st=stState();
    if(st){
      const group=st.settings.groupId||null,character=group?null:st.settings.characterId||null;
      for(const item of library.characters||[]){if(!item?.id)continue;const name=String(item.name||item.id);add('chat',tr(`和「${name}」聊天`,`Chat as ${name}`),name,item.id===character?current:tr('角色','Character'),()=>chatAs(item.id),{kind:'library'});}
      for(const item of library.groups||[]){if(!item?.id)continue;const name=String(item.name||item.id);add('chat',tr(`开始群聊「${name}」`,`Start group chat: ${name}`),name,item.id===group?current:tr('群聊','Group'),()=>startGroup(item.id),{kind:'library'});}
      if(group||character)add('chat',tr('改回内置角色','Back to the built-in character'),'built-in companion character 内置 搭档 角色',tr('内置角色','Built-in'),()=>chatAs(null));
    }
    if(byId('bot-settings-toggle'))add('chat',tr('打开对话页的连接设置','Open connection settings on the chat page'),'connection settings 连接 设置','',()=>{shell.open('bot');requestAnimationFrame(()=>{const toggle=byId('bot-settings-toggle');if(toggle&&toggle.getAttribute('aria-expanded')!=='true')toggle.click();});});
    // Layout
    const layoutNow=document.documentElement.dataset.layout;
    for(const [id,a,b] of LAYOUTS)add('layout',tr(`布局：${a}`,`Layout: ${b}`),`${tr(b,a)} layout 布局 ${id}`,id===layoutNow?current:'',()=>{if(latest?.config?.layout!==id)return savePreference('layout',id);});
    // Accent
    const accentNow=typeof config.accent==='string'&&config.accent!=='auto'?config.accent.toLowerCase():'auto';
    add('accent',tr('强调色：跟随角色','Accent: follow the character'),'accent auto follow character 强调色 跟随 颜色 colour color',accentNow==='auto'?current:'',()=>savePreference('accent','auto'));
    (theme?.PRESETS||[]).forEach((hex,index)=>{const name=PRESET_NAMES[index]||['预设','Preset'];add('accent',tr(`强调色：${name[0]}`,`Accent: ${name[1]}`),`accent ${other(name)} 强调色 颜色 colour color ${hex}`,accentNow===hex?current:'',()=>savePreference('accent',hex),{swatch:hex});});
    // Appearance (day / night / system), through the Settings radios.
    if(document.querySelector('input[name="appearance"]')){
      const now=config.appearance||'system';
      for(const [value,a,b] of [['light','日间','Day'],['dark','夜间','Night'],['system','跟随系统','Follow system']])add('look',tr(`外观：${a}`,`Appearance: ${b}`),`${tr(b,a)} appearance theme 外观 明暗 ${value}`,value===now?current:'',()=>setAppearance(value));
    }
    // Toggles: press the real controls so their handlers stay the single source of behaviour.
    add('toggle',tr(config.quiet?'关闭免打扰':'开启免打扰',config.quiet?'Turn quiet mode off':'Turn quiet mode on'),'quiet mode 免打扰 notifications 通知',tr(config.quiet?'已开启':'已关闭',config.quiet?'On':'Off'),()=>byId('quiet')?.click());
    add('toggle',tr('切换语言：English','切换语言：中文 (Switch language)'),'language 语言 english 中文 chinese','',()=>byId('language')?.click());
    add('toggle',tr(config.compact?'返回完整视图':'紧凑视图',config.compact?'Full view':'Compact view'),'compact mini 紧凑 迷你 完整 full',tr(config.compact?'已开启':'已关闭',config.compact?'On':'Off'),()=>byId('compact')?.click());
    // Sections of the characters page
    if(byId('characters-view')){
      if(byId('st-settings-card')&&st)add('library',tr('对话设置（预设、提示词、正则）','Conversation settings (presets, prompts, regex)'),'conversation settings presets 对话 设置 预设',pair(LABELS.characters),()=>{tab('settings');section(()=>byId('st-settings-card'));});
      if(byId('groups-section'))add('library',tr('群聊','Group chats'),'groups group chats 群聊',pair(LABELS.characters),()=>{tab('groups');section(()=>byId('groups-section'));});
      add('library',tr('世界书','Lorebooks'),'lorebooks world info 世界书 设定集',pair(LABELS.characters),()=>{tab('lorebooks');section(()=>document.querySelector('#characters-panel-lorebooks .characters-section-title')||document.querySelector('#characters-view>.characters-section-title'));});
    }
    if(view==='bot')add('help',tr('把光标放到输入框','Focus the message box'),'composer input 输入框 focus','/',()=>requestAnimationFrame(focusComposer));
    add('help',tr('键盘快捷键','Keyboard shortcuts'),'shortcuts keys help 快捷键 帮助','?',()=>openHelp());
    return out;
  }
  // prefix (3) > substring (2) > subsequence (1). Subsequence applies to the label only and to
  // Latin input only: with Chinese it produces matches nobody meant, so Chinese is a plain substring.
  const cjk=/[぀-ヿ㐀-鿿豈-﫿]/;
  function scoreText(term,text,loose){
    if(!text)return 0;
    const at=text.indexOf(term);
    if(at===0)return 3;
    if(at>0)return /[\s：:「（(/·\-]/.test(text[at-1])?2.5:2;
    if(!loose||term.length<2||cjk.test(term))return 0;
    let i=0;for(const ch of text){if(ch===term[i])i++;if(i===term.length)return 1;}
    return 0;
  }
  function scoreCommand(terms,command){
    let sum=0;
    for(const term of terms){
      const s=Math.max(scoreText(term,command.labelLower,true),scoreText(term,command.altLower)-0.25,scoreText(term,command.groupLower)-0.5);
      if(s<=0)return 0;sum+=s;
    }
    return sum/terms.length;
  }
  function draw(keep){
    const previous=keep&&shown[active]?shown[active].label:null;
    const all=commands();for(const c of all){c.labelLower=c.label.toLowerCase();c.altLower=c.alt.toLowerCase();c.groupLower=pair(GROUPS[c.group]).toLowerCase();}
    const terms=input.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
    let matched;
    if(terms.length){matched=all.map((c,order)=>({c,order,s:scoreCommand(terms,c)})).filter(x=>x.s>0).sort((a,b)=>b.s-a.s||a.order-b.order);}
    else{let idle=0;matched=all.filter(c=>c.kind!=='library'||idle++<CHAT_IDLE_LIMIT).map((c,order)=>({c,order,s:0}));}
    total=matched.length;matched=matched.slice(0,LIMIT);
    // Groups keep their usual order when browsing and follow their best match when searching.
    const groups=new Map();for(const x of matched){if(!groups.has(x.c.group))groups.set(x.c.group,[]);groups.get(x.c.group).push(x.c);}
    const order=terms.length?[...groups.keys()]:GROUP_ORDER.filter(key=>groups.has(key));
    shown=[];const nodes=[];
    for(const key of order){
      const box=el('div','min-palette-group'),title=el('div','min-palette-group-label',pair(GROUPS[key]));title.id=`min-palette-group-${key}`;
      box.setAttribute('role','group');box.setAttribute('aria-labelledby',title.id);box.append(title);
      for(const command of groups.get(key)){
        const row=el('div','min-palette-option'),index=shown.length;row.id=`min-palette-option-${index}`;row.setAttribute('role','option');row.setAttribute('aria-selected','false');row.dataset.index=String(index);
        if(command.swatch){const dot=el('span','min-palette-swatch');dot.style.setProperty('--swatch',command.swatch);dot.setAttribute('aria-hidden','true');row.append(dot);}
        row.append(el('span','min-palette-label',command.label));
        if(command.hint)row.append(el('span','min-palette-hint',command.hint));
        box.append(row);shown.push(command);
      }
      nodes.push(box);
    }
    if(!shown.length)nodes.push(el('p','min-palette-empty',tr('没有匹配的命令。换个词试试，例如“布局”“角色”或一位角色的名字。','No matching command. Try another word, such as “layout”, “characters” or a character’s name.')));
    list.replaceChildren(...nodes);
    const again=previous?shown.findIndex(c=>c.label===previous):-1;
    select(again>=0?again:shown.length?0:-1,!keep);
    const more=!terms.length&&all.length>total?tr('；输入名字可以找到更多角色','; type a name to find more characters'):total>LIMIT?tr(`；只显示前 ${LIMIT} 条`,`; showing the first ${LIMIT}`):'';
    setText(count,(loading&&!library.characters?tr('正在读取角色库… ','Reading the library… '):'')+tr(`${shown.length} 条命令${more}`,`${shown.length} command${shown.length===1?'':'s'}${more}`));
  }
  function select(index,scroll=true){
    const rows=list.querySelectorAll('.min-palette-option');
    if(rows[active])rows[active].setAttribute('aria-selected','false');
    active=index;
    const row=rows[active];
    if(row){row.setAttribute('aria-selected','true');input.setAttribute('aria-activedescendant',row.id);if(scroll)row.scrollIntoView({block:'nearest'});}
    else input.removeAttribute('aria-activedescendant');
  }
  function execute(index){
    const command=shown[index];if(!command)return;
    closePalette();
    setText(live,'');
    action(async()=>{const result=await command.run();if(mounted&&result!==false)setText(live,command.label);});
  }
  const foreignModal=()=>[...document.querySelectorAll('dialog[open]')].some(node=>node!==palette&&node!==help&&node.matches(':modal'));
  function openPalette(){
    if(!mounted||palette.open||foreignModal())return;
    if(help.open)help.close();
    input.value='';draw(false);
    palette.showModal();input.focus({preventScroll:true});list.scrollTop=0;
    openButton.setAttribute('aria-expanded','true');
    fetchLibrary();
  }
  function closePalette(){if(palette.open)palette.close();}
  palette.addEventListener('close',()=>openButton.setAttribute('aria-expanded','false'));
  palette.addEventListener('click',event=>{if(event.target===palette)closePalette();});
  input.addEventListener('input',()=>draw(false));
  input.addEventListener('keydown',event=>{
    if(event.isComposing||event.keyCode===229)return;
    const last=shown.length-1,move=to=>{event.preventDefault();if(shown.length)select(to);};
    if(event.key==='ArrowDown')move(active>=last?0:active+1);
    else if(event.key==='ArrowUp')move(active<=0?last:active-1);
    else if(event.key==='Home')move(0);
    else if(event.key==='End')move(last);
    else if(event.key==='PageDown')move(Math.min(last,active+8));
    else if(event.key==='PageUp')move(Math.max(0,active-8));
    else if(event.key==='Enter'){event.preventDefault();execute(active);}
    else if(event.key==='Tab')event.preventDefault(); // the field is the only stop; options are reached with the arrow keys
  });
  list.addEventListener('mousemove',event=>{const row=event.target.closest?.('.min-palette-option');if(row&&Number(row.dataset.index)!==active)select(Number(row.dataset.index),false);});
  list.addEventListener('mousedown',event=>event.preventDefault()); // keep focus in the field
  list.addEventListener('click',event=>{const row=event.target.closest?.('.min-palette-option');if(row)execute(Number(row.dataset.index));});
  openButton.addEventListener('click',openPalette);

  // ---- shortcuts sheet ----
  function drawHelp(){
    setText(helpTitle,tr('键盘快捷键','Keyboard shortcuts'));setText(helpClose,tr('关闭','Close'));
    const rows=[
      [[mac?'⌘':'Ctrl','K'],tr('打开命令面板','Open the command palette')],
      [['G','C'],tr('前往对话','Go to Chat')],
      [['G','R'],tr('前往角色','Go to Characters')],
      [['G','M'],tr('前往相处','Go to Together')],
      [['G','B'],tr('前往笔记','Go to Notes')],
      [['G','N'],tr('前往提醒','Go to Notices')],
      [['G','S'],tr('前往设置','Go to Settings')],
      [['G','W'],tr('切换工作区（陪伴 / 工作）','Switch workspace (Companion / Work)')],
      [['/'],tr('把光标放到输入框（对话页）','Focus the message box (chat page)')],
      [['?'],tr('显示这份列表','Show this list')],
      [['Esc'],tr('关闭面板或弹出层','Close the palette or a popover')],
    ];
    helpList.replaceChildren(...rows.flatMap(([keys,text])=>{const dt=el('dt',''),dd=el('dd','',text);keys.forEach((key,index)=>{if(index)dt.append(el('span','min-help-then',keys[0]==='G'?tr('再按','then'):'+'));dt.append(kbd(key));});return [dt,dd];}));
    helpList.append(el('p','min-help-note',tr('在输入框里打字时，单键快捷键不会触发。','Single-key shortcuts never fire while you are typing in a field.')));
  }
  function openHelp(){
    if(!mounted||help.open||foreignModal())return;
    closePalette();drawHelp();help.showModal();helpClose.focus({preventScroll:true});helpButton.setAttribute('aria-expanded','true');
  }
  help.addEventListener('close',()=>helpButton.setAttribute('aria-expanded','false'));
  help.addEventListener('click',event=>{if(event.target===help)help.close();});
  helpClose.addEventListener('click',()=>help.close());
  helpButton.addEventListener('click',openHelp);

  // ---- global keys (registered in mount, removed in unmount) ----
  let chordAt=0,chordTimer=0;
  const clearChord=()=>{chordAt=0;clearTimeout(chordTimer);delete shell.bar.dataset.minChord;};
  const typing=node=>{
    if(!node||node===document.body)return false;
    if(node.isContentEditable)return true;
    const tag=node.tagName;
    if(tag==='TEXTAREA'||tag==='SELECT')return true;
    if(tag==='INPUT')return !['checkbox','radio','button','submit','reset','range','color','file','image'].includes(node.type);
    return !!node.closest?.('[role=textbox],[role=combobox],[role=searchbox],[role=listbox],[role=menu],[role=tablist],[role=slider]');
  };
  function onKey(event){
    if(!mounted||event.defaultPrevented)return;
    const key=event.key;
    if((event.ctrlKey||event.metaKey)&&!event.altKey&&!event.shiftKey&&typeof key==='string'&&key.toLowerCase()==='k'){
      if(foreignModal())return;
      event.preventDefault();clearChord();if(palette.open)closePalette();else openPalette();return;
    }
    if(event.ctrlKey||event.metaKey||event.altKey||event.isComposing||event.keyCode===229)return;
    if(['Shift','Control','Alt','Meta','CapsLock'].includes(key))return;
    if(document.querySelector('dialog[open]')||typing(event.target)||typing(document.activeElement)){clearChord();return;}
    const letter=typeof key==='string'&&key.length===1?key.toLowerCase():'';
    if(chordAt&&Date.now()-chordAt<=CHORD_MS){
      clearChord();
      if(event.shiftKey||!letter)return;
      if(letter==='w'){event.preventDefault();const next=workspace==='work'?'companion':'work';shell.setWorkspace(next);setText(live,tr(`工作区：${next==='work'?'工作':'陪伴'}`,`Workspace: ${next==='work'?'Work':'Companion'}`));}
      else if(CHORD[letter]){
        const name=CHORD[letter],button=shell.bar.querySelector(`[data-view="${name}"]`);
        if(!button||button.hidden)return;
        event.preventDefault();shell.open(name);setText(live,pair(LABELS[name]));
      }
      return;
    }
    clearChord();
    if(letter==='g'&&!event.shiftKey){chordAt=Date.now();shell.bar.dataset.minChord='g';chordTimer=setTimeout(clearChord,CHORD_MS);return;}
    if(key==='/'&&view==='bot'){if(focusComposer())event.preventDefault();return;}
    if(key==='?'){event.preventDefault();openHelp();}
  }

  window.ArcadeLayouts.register('minimal',{
    mount(context){
      mounted=true;zh=context.zh;
      const bar=shell.bar,ws=bar.querySelector('.shell-ws');
      if(ws)ws.after(actions);else bar.prepend(actions);
      bar.append(live);document.body.append(palette,help);
      document.addEventListener('keydown',onKey);
      document.addEventListener('arcade-library-changed',forgetLibrary);
    },
    unmount(){
      mounted=false;clearChord();
      document.removeEventListener('keydown',onKey);
      document.removeEventListener('arcade-library-changed',forgetLibrary);
      if(palette.open)palette.close();if(help.open)help.close();
      actions.remove();live.remove();palette.remove();help.remove();
      forgetLibrary();shown=[];active=-1;latest=null;
    },
    render(data,context){
      if(!mounted)return;
      const languageChanged=zh!==context.zh;
      latest=data;zh=context.zh;view=context.view;workspace=context.workspace;
      setText(openText,tr('搜索命令…','Commands…'));
      const openLabel=tr('打开命令面板','Open the command palette');if(openButton.getAttribute('aria-label')!==openLabel){openButton.setAttribute('aria-label',openLabel);openButton.title=`${openLabel} (${mac?'⌘K':'Ctrl+K'})`;}
      const helpLabel=tr('键盘快捷键','Keyboard shortcuts');if(helpButton.getAttribute('aria-label')!==helpLabel){helpButton.setAttribute('aria-label',helpLabel);helpButton.title=`${helpLabel} (?)`;}
      const paletteLabel=tr('命令面板','Command palette');if(palette.getAttribute('aria-label')!==paletteLabel){palette.setAttribute('aria-label',paletteLabel);list.setAttribute('aria-label',tr('命令','Commands'));}
      const hint=tr('输入命令、页面或角色名','Type a command, a page or a character name');if(input.placeholder!==hint){input.placeholder=hint;input.setAttribute('aria-label',hint);}
      if(!footKeys.childNodes.length||languageChanged)footKeys.replaceChildren(kbd('↑'),kbd('↓'),el('span','',tr('选择','select')),kbd('Enter'),el('span','',tr('执行','run')),kbd('Esc'),el('span','',tr('关闭','close')));
      if(palette.open&&languageChanged)draw(true);
      if(help.open&&languageChanged)drawHelp();
    },
  });
  if(typeof data!=='undefined'&&data)render();
})();
