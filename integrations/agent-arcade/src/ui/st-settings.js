'use strict';
// "Conversation settings" card on the character library page: the owner's
// persona, lorebooks, author's note, generation limits and preset used by the
// App conversation of an imported character. Keep edits across snapshots of
// the same profile. A different profile gets its own controls and confirmations.
(() => {
  const view=document.getElementById('characters-view');
  if(!view)return;
  const card=el('article','settings-card st-card');card.id='st-settings-card';card.hidden=true;
  // The characters page keeps these settings under their own in-page tab.
  const tabPanel=window.ArcadeCharactersTabs?.panel('settings');
  if(tabPanel)tabPanel.append(card);else view.insertBefore(card,view.querySelector('.characters-section-title'));
  const SECTIONS={main:['主提示词','Main prompt'],worldInfoBefore:['世界书（角色设定之前）','Lorebook entries (before the character)'],personaDescription:['你的人设','Your persona'],charDescription:['角色简介','Character description'],charPersonality:['角色性格','Character personality'],scenario:['场景','Scenario'],enhanceDefinitions:['补充角色设定的提示','Enhance-definitions prompt'],nsfw:['辅助提示词','Auxiliary prompt'],worldInfoAfter:['世界书（角色设定之后）','Lorebook entries (after the character)'],dialogueExamples:['对话示例','Chat examples'],chatHistory:['聊天记录','Chat history'],jailbreak:['后置指令','Post-history instructions']};
  const USED={policy:['应用规则','App rules'],guard:['边界说明','Boundary note'],injections:['按深度插入的内容（作者注释等）','Depth injections (author\'s note etc.)']};
  const CODES={busy:['正在回复或处理上一项操作，请等它结束后再试。','A reply or another action is still running. Try again when it ends.'],invalid_request:['有内容不符合要求，请检查后再试。','Something entered is not valid. Check it and try again.'],invalid_text:['文字为空或超过长度上限。','The text is empty or longer than allowed.'],character_missing:['这个角色已不在角色库中。','This character is no longer in the library.'],unavailable:['当前档案暂时不能使用 App 对话。','App conversation is not available for this profile right now.'],storage_unavailable:['本机聊天记录暂时无法打开，请稍后再试。','Local chat history could not be opened. Please try again.'],scope_limit:['已保存 20 段对话，达到上限。请先在“已保存的角色对话”里清除一段。','20 conversations are stored, which is the limit. Clear one under “Saved character conversations” first.'],unsupported:['当前 AI 方式不支持这个操作。','The current AI method does not support this action.'],changed:['对话刚刚发生变化，请再试一次。','The conversation just changed. Please try again.'],credentials_missing:['还没有保存 AI 凭据，请先到对话设置里保存。','No AI credentials are saved yet. Save them in the chat settings first.'],start_failed:['没能开始对话，请检查 AI 设置后再试。','The conversation could not start. Check the AI settings and try again.'],group_not_found:['这个群聊已经不存在。','This group chat no longer exists.'],group_branch_unsupported:['群聊不能使用分支。','Branches are not available in a group chat.'],speaker_unavailable:['这个成员现在不能发言：它已静音，或已不在群聊或角色库中。','This member cannot speak right now: it is muted, or no longer in the group chat or the library.']};
  let zh=true,lang='',st=null,profile=null,busy=false,books=null,scripts=null,defaultPreset=null,built=false,revision=-1,lastKey='';
  const tr=(a,b)=>zh?a:b;
  const codeOf=error=>typeof error?.code==='string'?error.code:/\(([a-z_]+)\)\.?$/.exec(error?.message||'')?.[1]||'';
  const explain=(error,useZh=zh)=>{const code=codeOf(error);return Object.hasOwn(CODES,code)?CODES[code][useZh?0:1]:(useZh?'操作没有完成，请稍后再试。':'The action did not complete. Please try again.');};
  window.ArcadeST={explain,codeOf,showConversations(){if(window.ArcadeCharactersTabs)window.ArcadeCharactersTabs.open('settings',{focus:false});else switchView('characters');requestAnimationFrame(()=>requestAnimationFrame(()=>{const target=ui.saved;if(!target)return;target.scrollIntoView({block:'start'});(target.querySelector('button')||target).focus({preventScroll:true});}));}};
  const groups=[];let ui={};
  const controls=()=>[...card.querySelectorAll('input,textarea,select,button')];
  function sync(){for(const node of controls())node.disabled=busy||node.dataset.locked==='true';ui.syncOrder?.();ui.syncBooks?.();ui.syncRegex?.();}
  function field(labelText,control,id,hint){
    const wrap=el('label','st-field');control.id=id;wrap.htmlFor=id;wrap.append(el('span','',labelText),control);
    if(hint){const note=el('small','st-hint',hint);note.id=id+'-hint';control.setAttribute('aria-describedby',note.id);wrap.append(note);}
    return wrap;
  }
  function check(labelText,id){const wrap=el('label','st-check'),box=el('input','');box.type='checkbox';box.id=id;wrap.htmlFor=id;wrap.append(box,el('span','',labelText));return {wrap,box};}
  function number(id,min,max,step){const input=el('input','');input.type='number';input.min=min;input.max=max;input.step=step;input.inputMode=step<1?'decimal':'numeric';return input;}
  // {value} or null after reporting the problem on the group.
  function read(group,input,name,{min,max,integer=true,optional=false}){
    const raw=input.value.trim();
    if(!raw&&optional)return {value:null};
    const value=Number(raw);
    if(!raw||!Number.isFinite(value)||value<min||value>max||integer&&!Number.isInteger(value)){group.say(tr(`“${name}”请填 ${min} 到 ${max} 之间的${integer?'整数':'数'}。`,`“${name}” must be ${integer?'a whole number':'a number'} from ${min} to ${max}.`),true);input.focus();return null;}
    return {value};
  }
  function group(titleText,noteText){
    const box=el('section','st-group'),title=el('h3','',titleText),status=el('span','st-status'),row=el('div','st-save-row'),save=el('button','secondary',tr('保存','Save'));
    status.setAttribute('role','status');save.type='button';row.append(save,status);box.append(title);if(noteText)box.append(el('p','st-note',noteText));
    const g={profile,box,row,save,status,dirty:false,key:'',fill(){},say(text,error=false){status.textContent=text||'';status.dataset.error=String(!!error);}};
    box.addEventListener('input',()=>{g.dirty=true;});box.addEventListener('change',()=>{g.dirty=true;});
    save.setAttribute('aria-label',`${tr('保存','Save')}${tr('：',': ')}${titleText}`);
    groups.push(g);return g;
  }
  async function apply(g,partial,done){
    if(busy||g.profile!==profile)return;busy=true;sync();g.say(tr('正在保存…','Saving…'));
    try{
      const result=await window.arcade.stConfigure({...partial,profileId:g.profile.id});
      if(g.profile!==profile)return;
      st=result;g.dirty=false;g.key='';fill();g.say(done||tr('已保存。','Saved.'));
    }
    catch(error){g.say(`${tr('没有保存','Not saved')}${tr('：',': ')}${explain(error)}`,true);}
    finally{if(g.profile===profile){busy=false;sync();}}
  }
  function twoClick(button,armedText,run){
    const idle=button.textContent;let armed=false;
    const reset=()=>{armed=false;button.textContent=idle;};
    button.addEventListener('blur',reset);
    button.onclick=()=>{if(!card.contains(button))return;if(!armed){armed=true;button.textContent=armedText;return;}reset();run();};
  }
  function build(){
    const owner=profile;
    groups.length=0;ui={};
    const title=el('h2','',tr('对话设定','Conversation settings')),intro=el('p','st-note',tr('用于角色库角色的 App 对话（包括群聊）；流式显示开关也适用于内置角色，其余设定仅用于角色库。QQ 和微信对话不受影响。每一组改完后点各自的“保存”。','For App conversations with library characters, including groups. The streaming switch also applies to built-in companions; other settings apply only to library characters. QQ and WeChat conversations are unaffected. Save each group with its own button.')),problem=el('p','st-problem');
    problem.setAttribute('role','status');ui.problem=problem;

    // Persona
    const persona=group(tr('你的人设','Your persona'),tr('角色会把你当作这个人。卡里的 {{user}} 会换成这个名字。','The character treats you as this person. {{user}} in a card becomes this name.'));
    const userName=el('input',''),userDescription=el('textarea','');userName.type='text';userName.maxLength=40;userDescription.maxLength=2000;userDescription.rows=3;
    persona.box.append(field(tr('名字（最多 40 字）','Name (up to 40 characters)'),userName,'st-user-name'),field(tr('介绍（最多 2000 字，可留空）','Description (up to 2000 characters, optional)'),userDescription,'st-user-description'),persona.row);
    persona.fill=s=>{userName.value=s.user.name;userDescription.value=s.user.description;};persona.keyOf=s=>s.user;
    persona.save.onclick=()=>{const name=userName.value.trim();if(!name){persona.say(tr('名字不能为空。','The name cannot be empty.'),true);userName.focus();return;}apply(persona,{user:{name,description:userDescription.value}});};

    // Greeting
    const greeting=group(tr('开场白','Greeting'),tr('对话里还只有开场白时，保存后会换成所选的这一条；已经聊过的对话不会改动。','While the conversation holds only the greeting, saving replaces it with the chosen one. A conversation that has already started is left as it is.'));
    const greetingSelect=el('select','');greeting.box.append(field(tr('使用哪一条开场白','Which greeting to use'),greetingSelect,'st-greeting'),greeting.row);
    greeting.fill=s=>{const count=st.character?.greetings||0;greeting.box.hidden=count<2;greetingSelect.replaceChildren(...Array.from({length:Math.max(count,1)},(_,i)=>{const o=el('option','',tr(`开场白 ${i+1}`,`Greeting ${i+1}`));o.value=String(i);return o;}));greetingSelect.value=String(Math.min(s.greeting,Math.max(count,1)-1));};
    greeting.keyOf=s=>[s.greeting,st.character?.id,st.character?.greetings];
    greeting.save.onclick=()=>apply(greeting,{greeting:Number(greetingSelect.value)||0});

    // Lorebooks
    const lore=group(tr('世界书','Lorebooks'),tr('条目在对话里出现关键词时才会加入，只作为背景资料。','Entries are added only when their keywords appear in the chat, as background material.'));
    const useBook=check(tr('使用角色自带世界书','Use the character\'s own lorebook'),'st-use-character-book'),bookList=el('fieldset','st-books'),bookLegend=el('legend','',tr('另外使用角色库里的世界书（最多 10 本）','Also use lorebooks from the library (up to 10)')),bookItems=el('div','st-book-items'),numbers=el('div','st-fields');
    const budget=number('st-budget',500,12000,100),depth=number('st-scan-depth',1,20,1),recursive=check(tr('条目内容可以再触发其他条目','Entry text may trigger further entries'),'st-recursive');
    bookList.append(bookLegend,bookItems);numbers.append(field(tr('世界书字数上限（500–12000 字符）','Lorebook budget (500–12000 characters)'),budget,'st-budget'),field(tr('扫描最近几条消息（1–20）','Messages scanned (1–20)'),depth,'st-scan-depth'));
    lore.box.append(useBook.wrap,bookList,numbers,recursive.wrap,lore.row);
    let chosen=new Set();
    const drawBooks=()=>{
      const rows=books||[],focused=bookItems.contains(document.activeElement)?document.activeElement.id:'';
      bookItems.replaceChildren(...(rows.length?rows.map(book=>{const item=check(`${book.name}（${tr(`${book.enabledEntries}/${book.entries} 条启用`,`${book.enabledEntries}/${book.entries} enabled`)}）`,'st-book-'+book.id);item.box.checked=chosen.has(book.id);item.box.dataset.bookId=book.id;item.box.onchange=()=>{if(item.box.checked)chosen.add(book.id);else chosen.delete(book.id);ui.syncBooks();};return item.wrap;}):[el('p','st-note',books?tr('角色库里还没有独立世界书，可在下方导入。','No standalone lorebooks yet. Import one below.'):tr('正在读取…','Loading…'))]));
      ui.syncBooks();if(focused)document.getElementById(focused)?.focus({preventScroll:true});
    };
    ui.syncBooks=()=>{const known=new Set((books||[]).map(book=>book.id)),count=[...chosen].filter(id=>known.has(id)).length;for(const box of bookItems.querySelectorAll('input'))box.disabled=busy||!box.checked&&count>=10;};
    ui.drawBooks=drawBooks;
    lore.ownerOf=s=>JSON.stringify([s.groupId,s.characterId,s.builtinPersonaId]);
    lore.fill=s=>{useBook.box.checked=s.useCharacterBook;chosen=new Set(s.lorebookIds);budget.value=s.worldInfo.budgetChars;depth.value=s.worldInfo.scanDepth;recursive.box.checked=s.worldInfo.recursive;drawBooks();};
    lore.keyOf=s=>[s.useCharacterBook,s.lorebookIds,s.worldInfo];
    lore.save.onclick=()=>{
      const a=read(lore,budget,tr('世界书字数上限','Lorebook budget'),{min:500,max:12000});if(!a)return;const b=read(lore,depth,tr('扫描最近几条消息','Messages scanned'),{min:1,max:20});if(!b)return;
      const known=new Set((books||[]).map(book=>book.id));
      apply(lore,{expectedLorebookTarget:lore.owner,useCharacterBook:useBook.box.checked,lorebookIds:[...chosen].filter(id=>known.has(id)).slice(0,10),worldInfo:{budgetChars:a.value,scanDepth:b.value,recursive:recursive.box.checked}});
    };

    // Author's note
    const note=group(tr('作者注释','Author\'s note'),tr('一段始终插在聊天记录靠后位置的提示，例如文风或当前场景。留空则不使用。','A short instruction kept near the end of the chat history, such as style or the current scene. Leave empty to use none.'));
    const noteText=el('textarea',''),noteDepth=number('st-note-depth',0,100,1),noteRole=el('select',''),noteRow=el('div','st-fields');noteText.maxLength=2000;noteText.rows=3;
    noteRole.append(...[['system',tr('作为系统提示','As a system note')],['user',tr('作为你说的话','As your message')],['assistant',tr('作为角色说的话','As the character\'s message')]].map(([value,text])=>{const o=el('option','',text);o.value=value;return o;}));
    noteRow.append(field(tr('插入深度（0–100，0 表示最末尾）','Depth (0–100; 0 is the very end)'),noteDepth,'st-note-depth'),field(tr('插入方式','Inserted as'),noteRole,'st-note-role'));
    note.box.append(field(tr('注释内容（最多 2000 字）','Note text (up to 2000 characters)'),noteText,'st-note-text'),noteRow,note.row);
    note.fill=s=>{noteText.value=s.authorsNote.text;noteDepth.value=s.authorsNote.depth;noteRole.value=s.authorsNote.role;};note.keyOf=s=>s.authorsNote;
    note.save.onclick=()=>{const d=read(note,noteDepth,tr('插入深度','Depth'),{min:0,max:100});if(!d)return;apply(note,{authorsNote:{text:noteText.value,depth:d.value,role:noteRole.value}});};

    // Generation
    const gen=group(tr('生成参数','Generation'),tr('温度和 Top-P 只对 DeepSeek、Gemini、豆包生效；Claude 和 GPT 只接受回复长度上限。','Temperature and top-p only apply to DeepSeek, Gemini and Doubao. Claude and GPT only accept the reply cap.'));
    const context=number('st-context',4000,24000,1000),temperature=number('st-temperature',0,2,0.05),topP=number('st-top-p',0,1,0.05),maxTokens=number('st-max-tokens',64,8192,1),genRow=el('div','st-fields'),blank=tr('留空＝使用服务默认值','Empty = provider default');
    temperature.placeholder=topP.placeholder=maxTokens.placeholder=tr('默认','Default');
    genRow.append(field(tr('上下文长度（4000–24000 字符）','Context size (4000–24000 characters)'),context,'st-context',tr('越大每轮发送的文字越多，费用也越高。','Larger sends more text each turn and costs more.')),field(tr('温度（0–2）','Temperature (0–2)'),temperature,'st-temperature',blank),field('Top-P（0–1）',topP,'st-top-p',blank),field(tr('回复长度上限（64–8192 tokens）','Reply cap (64–8192 tokens)'),maxTokens,'st-max-tokens',blank));
    const streaming=check(tr('流式显示回复（角色的回复边生成边显示）','Show replies as they are generated'),'st-streaming');
    gen.box.append(genRow,streaming.wrap,gen.row);
    gen.fill=s=>{streaming.box.checked=s.streaming===true;context.value=s.contextChars;temperature.value=s.sampling.temperature??'';topP.value=s.sampling.topP??'';maxTokens.value=s.sampling.maxTokens??'';};gen.keyOf=s=>[s.contextChars,s.sampling,s.streaming===true];
    gen.save.onclick=()=>{
      const c=read(gen,context,tr('上下文长度','Context size'),{min:4000,max:24000});if(!c)return;const t=read(gen,temperature,tr('温度','Temperature'),{min:0,max:2,integer:false,optional:true});if(!t)return;
      const p=read(gen,topP,'Top-P',{min:0,max:1,integer:false,optional:true});if(!p)return;const m=read(gen,maxTokens,tr('回复长度上限','Reply cap'),{min:64,max:8192,optional:true});if(!m)return;
      apply(gen,{contextChars:c.value,sampling:{temperature:t.value,topP:p.value,maxTokens:m.value},streaming:streaming.box.checked});
    };

    // Preset
    const preset=group(tr('预设','Preset'),tr('预设决定提示词各部分的内容和先后顺序。预设文字只作为提示词资料，不会运行其中的脚本。','A preset decides the text and order of the prompt parts. Preset text is prompt material only; nothing in it is run as a script.'));
    const presetName=el('p','st-preset-name'),truncated=el('p','st-problem'),mainPrompt=el('textarea',''),postHistory=el('textarea',''),preferSystem=check(tr('优先使用角色卡自带的系统提示词','Prefer the card\'s own system prompt'),'st-prefer-system'),preferPost=check(tr('优先使用角色卡自带的后置指令','Prefer the card\'s own post-history instructions'),'st-prefer-post'),orderTitle=el('h4','',tr('各部分的顺序与开关','Order and switches of the parts')),orderList=el('ol','st-order'),tools=el('div','button-row'),importButton=el('button','secondary',tr('导入 SillyTavern 预设…','Import a SillyTavern preset…')),restore=el('button','plain',tr('恢复默认预设','Restore the default preset')),warnings=el('ul','st-warnings');
    mainPrompt.maxLength=postHistory.maxLength=8000;mainPrompt.rows=4;postHistory.rows=3;importButton.type=restore.type='button';tools.append(importButton,restore);
    preset.box.append(presetName,truncated,field(tr('主提示词（最多 8000 字）','Main prompt (up to 8000 characters)'),mainPrompt,'st-main-prompt'),field(tr('后置指令（最多 8000 字，可留空）','Post-history instructions (up to 8000 characters, optional)'),postHistory,'st-post-history'),preferSystem.wrap,preferPost.wrap,orderTitle,orderList,preset.row,tools,warnings);
    let order=[],enabled={},locked=false;
    const drawOrder=focus=>{
      orderList.replaceChildren(...order.map((id,index)=>{
        const name=tr(...(SECTIONS[id]||[id,id])),item=el('li','st-order-row'),box=el('input',''),label=el('label','st-order-label'),up=el('button','plain st-move',tr('上移','Up')),down=el('button','plain st-move',tr('下移','Down'));
        item.dataset.sectionId=id;box.type='checkbox';box.id='st-section-'+id;box.checked=id==='main'||enabled[id]!==false;box.dataset.locked=String(id==='main');label.htmlFor=box.id;label.append(box,el('span','',id==='main'?`${name}${tr('（始终启用）',' (always on)')}`:name));
        box.onchange=()=>{enabled[id]=box.checked;preset.dirty=true;};
        up.type=down.type='button';up.dataset.move='up';down.dataset.move='down';up.setAttribute('aria-label',`${tr('上移','Move up')}${tr('：',': ')}${name}`);down.setAttribute('aria-label',`${tr('下移','Move down')}${tr('：',': ')}${name}`);up.title=tr('上移','Move up');down.title=tr('下移','Move down');
        up.dataset.locked=String(index===0);down.dataset.locked=String(index===order.length-1);
        const move=step=>{const to=index+step;if(to<0||to>=order.length)return;[order[index],order[to]]=[order[to],order[index]];preset.dirty=true;drawOrder({id,move:step<0?'up':'down'});};
        up.onclick=()=>move(-1);down.onclick=()=>move(1);item.append(label,up,down);return item;
      }));
      ui.syncOrder();
      if(focus){const row=[...orderList.children].find(item=>item.dataset.sectionId===focus.id),first=row?.querySelector(`[data-move="${focus.move}"]`),other=row?.querySelector(`[data-move="${focus.move==='up'?'down':'up'}"]`);(first&&!first.disabled?first:other)?.focus({preventScroll:true});}
    };
    ui.syncOrder=()=>{for(const node of orderList.querySelectorAll('input,button'))node.disabled=busy||node.dataset.locked==='true';};
    preset.fill=s=>{
      const p=s.preset;locked=!!(st.presetTruncated?.mainPrompt||st.presetTruncated?.postHistory);
      presetName.textContent=`${tr('当前预设','Current preset')}${tr('：',': ')}${p.name}`;
      truncated.hidden=!locked;truncated.textContent=locked?tr('这份预设的提示词比这里显示的更长（只显示前 2000 字）。为避免把截短的副本存回去，下面两段文字只能查看；顺序、开关和两个“优先使用角色卡”选项仍可修改并保存。要改文字请导入新的预设，或恢复默认预设。','This preset\'s prompt text is longer than shown here (first 2000 characters only). To avoid saving a shortened copy, the two text boxes below are read-only; the order, the switches and the two “prefer the card” options can still be changed and saved. To change the text, import another preset or restore the default.'):'';
      mainPrompt.value=p.mainPrompt;postHistory.value=p.postHistory;mainPrompt.readOnly=postHistory.readOnly=locked;
      preferSystem.box.checked=p.preferCardSystemPrompt;preferPost.box.checked=p.preferCardPostHistory;
      order=[...p.order];enabled=Object.fromEntries(Object.entries(p.sections).map(([id,value])=>[id,value.enabled!==false]));drawOrder();
    };
    preset.keyOf=s=>[s.preset,st.presetTruncated];
    preset.save.onclick=()=>{
      // Order, switches and the two checkboxes are sent as a partial update that carries no prompt text.
      // The full preset is sent only when the text itself was changed, which a shortened (read-only) copy never allows.
      const current=st.settings.preset,patch={order:[...order],sections:Object.fromEntries(order.map(id=>[id,{enabled:id==='main'||enabled[id]!==false}])),preferCardSystemPrompt:preferSystem.box.checked,preferCardPostHistory:preferPost.box.checked};
      const textChanged=!locked&&(mainPrompt.value!==current.mainPrompt||postHistory.value!==current.postHistory);
      apply(preset,textChanged?{preset:{name:current.name,...patch,mainPrompt:mainPrompt.value,postHistory:postHistory.value,sampling:{...current.sampling}}}:{presetPatch:patch});
    };
    const showWarnings=list=>{warnings.replaceChildren(...(list||[]).slice(0,20).map(text=>el('li','',String(text).slice(0,300))));warnings.hidden=!warnings.childElementCount;};
    showWarnings([]);
    importButton.onclick=async()=>{
      if(busy||profile!==owner)return;busy=true;sync();preset.say(tr('正在等待选择文件…','Waiting for a file…'));
      try{const result=await window.arcade.stImportPreset(owner.id);if(profile!==owner)return;if(!result){preset.say('');return;}st=result.snapshot;preset.dirty=false;preset.key='';fill();showWarnings(result.warnings);preset.say(result.warnings?.length?tr(`已导入并启用。有 ${result.warnings.length} 条说明，见下方。`,`Imported and applied. ${result.warnings.length} note(s) below.`):tr('已导入并启用。','Imported and applied.'));}
      catch(error){preset.say(`${tr('没有导入','Not imported')}${tr('：',': ')}${codeOf(error)?explain(error):tr('这个文件不是可用的预设，或内容超出限制。','This file is not a usable preset, or it exceeds the limits.')}`,true);}
      finally{if(profile===owner){busy=false;sync();importButton.focus({preventScroll:true});}}
    };
    twoClick(restore,tr('再点一次确认恢复默认','Click again to restore the default'),async()=>{
      try{defaultPreset=defaultPreset||await window.arcade.stDefaultPreset();}catch{preset.say(tr('没有读到默认预设，请稍后再试。','The default preset could not be read. Please try again.'),true);return;}
      showWarnings([]);await apply(preset,{preset:defaultPreset},tr('已恢复默认预设。','Default preset restored.'));restore.focus({preventScroll:true});
    });

    // Regex scripts: text find-and-replace rules. Every change here applies at once.
    const REGEX_CODES={regex_script_invalid:['这个文件里没有可用的正则脚本，或内容超出限制。','This file holds no usable regex script, or it exceeds the limits.'],regex_library_full:['正则脚本已有 100 个，达到上限。请先移除不用的脚本。','100 regex scripts are stored, which is the limit. Remove ones you no longer use first.'],regex_library_too_large:['正则脚本合计超过 1 MiB，没有保存。','The regex scripts would exceed 1 MiB in total. Nothing was saved.'],regex_library_corrupt:['已保存的正则脚本读不出来，请检查本机存储后重试。','The stored regex scripts could not be read. Check local storage and try again.'],regex_script_not_found:['这个脚本已经不存在。','This script no longer exists.'],regex_script_update_invalid:['这项修改不符合要求，没有保存。','This change is not valid. Nothing was saved.'],regex_script_order_invalid:['脚本列表刚刚发生变化，顺序没有保存，请再试一次。','The script list just changed, so the order was not saved. Please try again.'],regex_file_too_large:['这个文件超过 1 MiB，没有导入。','This file is larger than 1 MiB. Nothing was imported.']};
    const PLACES={user_input:['你发的消息','your messages'],ai_output:['角色的回复','the character\'s replies'],world_info:['世界书条目','lorebook entries'],reasoning:['思考内容','reasoning text']};
    const regexBox=el('section','st-group'),regexEnable=check(tr('启用正则脚本','Use regex scripts'),'st-regex-enabled'),regexItems=el('ol','st-order st-regex'),regexRow=el('div','st-save-row'),regexImport=el('button','secondary',tr('导入正则脚本…','Import regex scripts…')),regexStatus=el('span','st-status'),regexWarnings=el('ul','st-warnings');
    regexBox.id='st-regex-group';regexBox.hidden=typeof window.arcade?.regexList!=='function';regexImport.type='button';regexStatus.setAttribute('role','status');regexWarnings.hidden=true;regexRow.append(regexImport,regexStatus);
    regexBox.append(el('h3','',tr('正则脚本','Regex scripts')),el('p','st-note',tr('正则脚本按下面的顺序对消息文字做查找替换，例如隐藏某种标记或统一格式。脚本只改写文字，不会运行任何代码；只在角色库角色的 App 对话里生效。这里的每项改动都会立即保存。','Regex scripts find and replace message text in the order below, for example to hide a kind of tag or tidy formatting. A script only rewrites text and never runs code. Scripts apply to App conversations with a library character only. Every change here is saved at once.')),regexEnable.wrap,regexItems,regexRow,regexWarnings);
    const regexSay=(text,error=false)=>{regexStatus.textContent=text||'';regexStatus.dataset.error=String(!!error);};
    const regexProblem=error=>{const code=codeOf(error);return Object.hasOwn(REGEX_CODES,code)?tr(...REGEX_CODES[code]):explain(error);};
    // The regex calls answer with the new list, or {ok:false,code}; a thrown error is treated the same.
    const regexRun=async(pending,call,done,focus,failed=tr('没有保存','Not saved'),fallback='')=>{
      if(busy||profile!==owner)return;busy=true;sync();regexSay(pending);let result=null;
      try{result=await call();if(result?.ok===false)throw result;if(Array.isArray(result?.list))scripts=result.list;regexSay(typeof done==='function'?done(result):done);}
      catch(error){result=null;regexSay(`${failed}${tr('：',': ')}${codeOf(error)||!fallback?regexProblem(error):fallback}`,true);try{const list=await window.arcade.regexList();if(Array.isArray(list))scripts=list;else if(Array.isArray(list?.list))scripts=list.list;}catch{}}
      finally{if(profile===owner){busy=false;ui.drawRegex(focus);sync();}else if(built){void loadRegex();}}
      return result;
    };
    const regexSummary=script=>{
      const places=(Array.isArray(script.placement)?script.placement:[]).filter(id=>Object.hasOwn(PLACES,id)).map(id=>tr(...PLACES[id])),parts=[places.length?`${tr('用于','Applies to')}${tr('：',': ')}${places.join(tr('、',', '))}`:tr('没有指定用在哪里，不会生效','No target chosen, so it has no effect')];
      parts.push(script.markdownOnly&&script.promptOnly?tr('只改显示和发给 AI 的文字，不改保存的原文','changes what is shown and what is sent to the AI, not the stored text'):script.markdownOnly?tr('只改显示，不改保存的原文','changes the display only, not the stored text'):script.promptOnly?tr('只改发给 AI 的文字，不改保存的原文','changes what is sent to the AI only, not the stored text'):tr('直接改写保存的文字','rewrites the stored text'));
      if(script.runOnEdit)parts.push(tr('编辑消息时也会运行','also runs when a message is edited'));
      const min=Number.isInteger(script.minDepth)?script.minDepth:null,max=Number.isInteger(script.maxDepth)?script.maxDepth:null;
      if(min!==null||max!==null)parts.push(tr(`只对倒数第 ${min??0} 到 ${max??'∞'} 条消息`,`only messages ${min??0} to ${max??'∞'} from the end`));
      return parts.join(tr('；','; '));
    };
    ui.syncRegex=()=>{for(const node of regexItems.querySelectorAll('input,button'))node.disabled=busy||node.dataset.locked==='true';};
    ui.drawRegex=focus=>{
      const rows=scripts||[],held=regexItems.contains(document.activeElement)?document.activeElement:null,wanted=focus||(held?{id:held.closest('li')?.dataset.scriptId,act:held.dataset.act}:null);
      regexItems.replaceChildren(...(rows.length?rows.map((script,index)=>{
        const name=script.scriptName||tr('（未命名脚本）','(unnamed script)'),item=el('li','st-order-row st-regex-row'),body=el('div','st-regex-body'),label=el('label','st-order-label'),box=el('input',''),buttons=el('div','st-regex-actions'),up=el('button','plain st-move',tr('上移','Up')),down=el('button','plain st-move',tr('下移','Down')),remove=el('button','plain',tr('移除','Remove')),find=el('code','st-regex-find',String(script.findRegex||''));
        item.dataset.scriptId=script.id;box.type='checkbox';box.id='st-regex-'+script.id;box.checked=!script.disabled;box.dataset.act='enable';label.htmlFor=box.id;label.append(box,el('span','',name));box.setAttribute('aria-label',`${tr('启用','Enable')}${tr('：',': ')}${name}`);
        find.title=String(script.findRegex||'');find.setAttribute('aria-label',`${tr('查找','Find')}${tr('：',': ')}${String(script.findRegex||'')}`);
        body.append(label,el('span','st-regex-summary',regexSummary(script)),find);
        box.onchange=()=>{const on=box.checked;regexRun(tr('正在保存…','Saving…'),()=>window.arcade.regexUpdate(script.id,{disabled:!on}),on?tr(`已启用“${name}”。`,`“${name}” is on.`):tr(`已停用“${name}”。`,`“${name}” is off.`),{id:script.id,act:'enable'});};
        up.type=down.type=remove.type='button';up.dataset.act='up';down.dataset.act='down';remove.dataset.act='remove';
        up.setAttribute('aria-label',`${tr('上移','Move up')}${tr('：',': ')}${name}`);down.setAttribute('aria-label',`${tr('下移','Move down')}${tr('：',': ')}${name}`);up.title=tr('上移','Move up');down.title=tr('下移','Move down');remove.setAttribute('aria-label',`${tr('移除','Remove')}${tr('：',': ')}${name}`);
        up.dataset.locked=String(index===0);down.dataset.locked=String(index===rows.length-1);
        const move=step=>{const ids=rows.map(row=>row.id),to=index+step;if(to<0||to>=ids.length)return;[ids[index],ids[to]]=[ids[to],ids[index]];regexRun(tr('正在保存顺序…','Saving the order…'),()=>window.arcade.regexReorder(ids),tr('顺序已保存。','Order saved.'),{id:script.id,act:step<0?'up':'down'});};
        up.onclick=()=>move(-1);down.onclick=()=>move(1);
        twoClick(remove,tr('再点一次确认移除','Click again to remove'),()=>regexRun(tr('正在移除…','Removing…'),()=>window.arcade.regexRemove(script.id),result=>result?.removed===false?tr('没有移除。','Not removed.'):tr(`已移除“${name}”。`,`Removed “${name}”.`),{id:rows[index+1]?.id||rows[index-1]?.id,act:'remove'},tr('没有移除','Not removed')));
        buttons.append(up,down,remove);item.append(body,buttons);return item;
      }):[el('li','st-note st-regex-empty',scripts?tr('还没有正则脚本。可以导入 SillyTavern 导出的正则脚本 JSON。','No regex scripts yet. Import a regex script JSON exported from SillyTavern.'):tr('正在读取…','Loading…'))]));
      ui.syncRegex();
      if(wanted&&[document.body,null].includes(document.activeElement)){const row=[...regexItems.children].find(item=>item.dataset.scriptId===wanted.id),first=row?.querySelector(`[data-act="${wanted.act}"]`),other={up:'down',down:'up'}[wanted.act],target=first&&!first.disabled?first:other&&row?.querySelector(`[data-act="${other}"]:not(:disabled)`)||row?.querySelector('button:not(:disabled),input:not(:disabled)')||regexImport;target.focus({preventScroll:true});}
    };
    ui.fillRegex=()=>{if(!busy)regexEnable.box.checked=st.settings.regex?.enabled!==false;};
    regexEnable.box.onchange=async()=>{
      if(busy||profile!==owner)return;const on=regexEnable.box.checked;busy=true;sync();regexSay(tr('正在保存…','Saving…'));
      try{const result=await window.arcade.stConfigure({profileId:owner.id,regex:{enabled:on}});if(profile!==owner)return;st=result;regexSay(on?tr('已启用正则脚本。','Regex scripts are on.'):tr('已停用全部正则脚本。','All regex scripts are off.'));}
      catch(error){regexSay(`${tr('没有保存','Not saved')}${tr('：',': ')}${explain(error)}`,true);}
      finally{if(profile===owner){busy=false;fill();sync();regexEnable.box.focus({preventScroll:true});}}
    };
    const showRegexWarnings=list=>{regexWarnings.replaceChildren(...(list||[]).slice(0,20).map(text=>el('li','',String(text).slice(0,300))));regexWarnings.hidden=!regexWarnings.childElementCount;};
    regexImport.onclick=async()=>{
      showRegexWarnings([]);
      const result=await regexRun(tr('正在等待选择文件…','Waiting for a file…'),()=>window.arcade.regexImport(),got=>!got||got.cancelled===true?'':got.warnings?.length?tr(`已导入 ${Number(got.added)||0} 个脚本。有 ${got.warnings.length} 条说明，见下方。`,`Imported ${Number(got.added)||0} script(s). ${got.warnings.length} note(s) below.`):tr(`已导入 ${Number(got.added)||0} 个脚本。`,`Imported ${Number(got.added)||0} script(s).`),null,tr('没有导入','Not imported'),tr('这个文件不是可用的正则脚本，或内容超出限制。','This file is not a usable regex script, or it exceeds the limits.'));
      if(result)showRegexWarnings(result.warnings);
      regexImport.focus({preventScroll:true});
    };

    // What the last reply used
    const last=el('details','st-last'),lastSummary=el('summary','',tr('上次回复用了什么','What the last reply used')),lastBody=el('div','st-last-body');last.append(lastSummary,lastBody);
    ui.drawLast=()=>{
      const used=st.lastUsed,nodes=[];
      if(!used)nodes.push(el('p','st-note',tr('这次运行里还没有角色回复。发出一条消息后，这里会显示各部分用了多少字。','No character reply in this run yet. After one message, this shows how many characters each part used.')));
      else{
        nodes.push(el('p','',tr(`共发送 ${used.flat} 字符，上限 ${used.limit}。`,`${used.flat} characters sent; the limit is ${used.limit}.`)));
        const list=el('ul','st-used');for(const [id,value] of Object.entries(used)){if(['system','messages','flat','limit'].includes(id)||!value)continue;const names=SECTIONS[id]||USED[id]||[id,id],li=el('li','');li.append(el('span','',tr(...names)),el('span','st-count',String(value)));list.append(li);}
        nodes.push(list);
      }
      if(st.activatedEntries?.length){nodes.push(el('h4','',tr('触发的世界书条目','Lorebook entries triggered')));const list=el('ul','st-plain-list');for(const entry of st.activatedEntries)list.append(el('li','',entry.comment||tr('（未命名条目）','(unnamed entry)')));nodes.push(list);}
      if(st.wikiPages?.length){nodes.push(el('h4','',tr('用到的笔记页','Note pages used')));const list=el('ul','st-plain-list st-wiki-pages');for(const item of st.wikiPages)list.append(el('li','',`${item.page} › ${Number.isInteger(item.line)?tr(`第 ${item.line} 行起`,`from line ${item.line}`):String(item.line??'')}`));nodes.push(list);}
      if(st.lastWarnings?.length){nodes.push(el('h4','',tr('提示','Notes')));const list=el('ul','st-plain-list');for(const text of st.lastWarnings)list.append(el('li','',String(text)));nodes.push(list);}
      lastBody.replaceChildren(...nodes);
    };

    // Saved conversations
    const saved=el('section','st-group'),savedStatus=el('span','st-status'),savedList=el('div','sources-list st-conversations');savedStatus.setAttribute('role','status');
    saved.append(el('h3','',tr('已保存的角色对话','Saved character conversations')),el('p','st-note',tr('每个角色和每个群聊有自己的对话和记忆，最多保存 20 段。清除会删掉这一段的聊天记录、记忆和世界书状态，不能恢复。','Each character and each group chat has its own conversation and memory; up to 20 are stored. Clearing deletes that conversation\'s chat history, memory and lorebook state and cannot be undone.')),savedList,savedStatus);
    ui.drawConversations=focusFallback=>{
      const rows=owner.conversations||[];
      savedList.replaceChildren(...(rows.length?rows.map(row=>{
        const item=el('div','sources-row st-conversation-row'),body=el('div','sources-row-body'),clear=el('button','plain',tr('清除对话与记忆','Clear conversation and memory'));
        // A row is a character's conversation, or a group chat's ({groupId}). An active group takes over from the stored character.
        const isGroup=typeof row.groupId==='string',activeGroup=st?.settings?.groupId||null,selected=isGroup?row.groupId===activeGroup:!activeGroup&&row.characterId===st?.settings?.characterId;
        body.append(el('strong','',row.name),el('span','sources-meta',`${isGroup?tr('群聊 · ','Group chat · '):''}${tr(`${row.messages} 条消息`,`${row.messages} messages`)}${selected?tr(' · 当前选用',' · currently selected'):''}`));
        clear.type='button';clear.setAttribute('aria-label',`${tr('清除对话与记忆','Clear conversation and memory')}${tr('：',': ')}${row.name}`);
        twoClick(clear,tr('再点一次确认清除','Click again to clear'),async()=>{
          if(busy||profile!==owner)return;busy=true;sync();
          const target=isGroup?{groupId:row.groupId}:{characterId:row.characterId};
          try{const result=await window.arcade.stClearConversation({profileId:owner.id,...target});savedStatus.dataset.error='false';savedStatus.textContent=result?.cleared?tr(`已清除“${row.name}”的对话与记忆。`,`Cleared the conversation and memory of “${row.name}”.`):tr('没有可清除的内容。','Nothing to clear.');}
          catch(error){savedStatus.dataset.error='true';savedStatus.textContent=`${tr('没有清除','Not cleared')}${tr('：',': ')}${explain(error)}`;}
          finally{if(profile===owner){busy=false;sync();await loadConversations(true);}}
        });
        item.append(body,clear);return item;
      }):[el('p','st-note',owner.readError?explain(owner.readError):owner.conversations?tr('还没有保存的角色对话。','No saved character conversations yet.'):tr('正在读取…','Loading…'))]));
      sync();if(focusFallback)(savedList.querySelector('button')||ui.focusHome)?.focus({preventScroll:true});
    };
    ui.focusHome=lastSummary;ui.saved=saved;saved.id='st-saved-conversations';saved.tabIndex=-1;
    card.replaceChildren(title,intro,problem,...groups.map(g=>g.box),regexBox,last,saved);built=true;
  }
  function fill(force=false){
    if(!st?.settings)return;
    for(const g of groups){
      const key=JSON.stringify(g.keyOf(st.settings)),owner=g.ownerOf?.(st.settings);
      if(!force&&owner===g.owner&&(key===g.key||g.dirty))continue;
      g.owner=owner;g.key=key;g.dirty=false;g.fill(st.settings);
    }
    ui.problem.hidden=!String(st.problem||'').startsWith('settings_');
    ui.problem.textContent=st.problem==='settings_invalid'?tr('已保存的对话设定格式不对，现在显示的是默认值。保存任意一组会用新的设定替换原文件。','The saved conversation settings are not valid, so defaults are shown. Saving any group replaces the stored file.'):st.problem==='settings_unreadable'?tr('已保存的对话设定读不出来，现在显示的是默认值。请检查本机存储后重试。','The saved conversation settings could not be read, so defaults are shown. Check local storage and try again.'):'';
    ui.fillRegex?.();ui.drawLast();sync();
  }
  async function loadConversations(focus=false){
    const owner=profile;
    if(!owner||typeof window.arcade?.stConversations!=='function')return;
    const request=++owner.request;
    let rows=null,readError=null;
    try{rows=await window.arcade.stConversations(owner.id);}catch(error){readError=error;}
    if(owner!==profile||request!==owner.request)return;
    owner.conversations=rows;owner.readError=readError;ui.drawConversations(focus);
  }
  async function loadBooks(){
    if(typeof window.arcade?.lorebooksList!=='function')return;
    try{books=await window.arcade.lorebooksList();}catch{books=books||[];}
    if(built)ui.drawBooks();
  }
  async function loadRegex(focus){
    if(typeof window.arcade?.regexList!=='function')return;
    try{const result=await window.arcade.regexList();if(result?.ok===false)throw result;scripts=Array.isArray(result)?result:Array.isArray(result?.list)?result.list:[];}catch{scripts=scripts||[];}
    if(built)ui.drawRegex(focus);
  }
  const refresh=()=>{if(document.body.dataset.view==='characters'&&st?.available){loadBooks();loadConversations();loadRegex();}};
  window.renderSTSettings=data=>{
    const next=data.bot?.st,profileId=data.accounts?.selectedId;
    if(typeof window.arcade?.stConfigure!=='function'||typeof profileId!=='string'||!profileId||!next?.available||!next.settings){
      if(!card.hidden){card.hidden=true;card.replaceChildren();groups.length=0;ui={};window.ArcadeCharactersTabs?.refresh();}
      st=null;profile=null;busy=false;built=false;return;
    }
    zh=data.config?.language==='zh';
    const first=card.hidden;card.hidden=false;if(first)window.ArcadeCharactersTabs?.refresh();
    const key=JSON.stringify(next);
    const rebuild=profile?.id!==profileId||lang!==data.config?.language;
    if(rebuild){
      profile={id:profileId,request:0,conversations:null};busy=false;
      lang=data.config?.language;st=next;lastKey=key;build();fill(true);ui.drawConversations();ui.drawBooks();ui.drawRegex();
    }
    else if(key!==lastKey&&!busy){st=next;lastKey=key;fill();if(profile.conversations)ui.drawConversations();}
    const nextRevision=data.bot?.local?.historyRevision??-1;
    if(first||rebuild||nextRevision!==revision){revision=nextRevision;refresh();}
  };
  document.addEventListener('arcade-library-changed',refresh);
  new MutationObserver(refresh).observe(document.body,{attributes:true,attributeFilter:['data-view']});
})();
