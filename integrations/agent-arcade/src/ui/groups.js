'use strict';
// Group chats on the character library page: several library characters in one
// App conversation. The list is fetched on demand. The form keeps its state in
// this file and is redrawn only by the owner's own actions, so the periodic
// snapshot never interrupts typing.
(() => {
  const view=document.getElementById('characters-view');
  if(!view||typeof window.arcade?.groupsList!=='function'||typeof window.arcade?.groupSave!=='function')return;
  const section=el('section','groups-section');section.id='groups-section';
  // The characters page keeps group chats under their own in-page tab.
  const tabPanel=window.ArcadeCharactersTabs?.panel('groups');
  if(tabPanel)tabPanel.append(section);else view.insertBefore(section,document.getElementById('st-settings-card')||view.querySelector('.characters-section-title'));
  const title=el('h2','characters-section-title'),intro=el('p','subtitle'),actions=el('div','button-row'),create=el('button','secondary'),status=el('div','characters-status'),empty=el('p','relationship-empty'),list=el('div','sources-list groups-list'),formCard=el('article','settings-card st-card groups-form');
  create.type='button';create.id='groups-new';status.setAttribute('role','status');formCard.id='groups-form';formCard.hidden=true;actions.append(create);
  section.append(title,intro,actions,status,empty,list,formCard);
  const CODES={group_not_found:['这个群聊已经不存在。','This group chat no longer exists.'],group_active:['这个群聊正在用于 App 对话，不能删除。请先改回内置角色，或改用别的角色或群聊。','This group chat is in use by the App conversation and cannot be deleted. Switch back to the built-in character, or to another character or group chat, first.'],group_invalid:['群聊内容不符合要求：需要名称（最多 60 字）和 2 到 8 个不重复的成员。','The group chat is not valid: it needs a name (up to 60 characters) and 2 to 8 different members.'],group_limit:['群聊已有 100 个，达到上限。请先删除不用的群聊。','100 group chats are stored, which is the limit. Delete ones you no longer use first.'],character_missing:['有成员已不在角色库中。请先把它移出群聊。','A member is no longer in the character library. Remove it from the group chat first.'],group_missing:['为 App 对话选的群聊已经不存在。','The group chat chosen for the App conversation no longer exists.'],group_unreadable:['为 App 对话选的群聊读不出来。','The group chat chosen for the App conversation could not be read.']};
  const STRATEGIES=[['natural','自然','Natural','被提到名字的先说，其余按健谈程度决定要不要接话。','Whoever is named speaks first; the others join in according to their talkativeness.','自然发言（被提到名字的先说）','Natural (whoever is named speaks first)'],['list','按顺序','In order','每次回复时，每个成员按下面的顺序依次说一句。','On each reply every member speaks once, in the order below.','每人按顺序依次发言','Everyone speaks in order'],['pooled','轮流','Take turns','还没说过话的成员先说；都说过之后再重新开始。','Members who have not spoken yet go first; once all have, it starts over.','轮流发言（还没说过的人先说）','Take turns (those who have not spoken go first)'],['manual','手动','Manual','没有人会自动回复。由你在聊天页点名让谁发言。','Nobody replies automatically. You pick who speaks on the chat page.','手动点名，不会自动回复','Manual: nobody replies until you pick a speaker']];
  const MODES=[['swap','只用发言者自己的设定','Only the speaker\'s own card'],['join','合并所有成员的设定','Combine every member\'s card']];
  let zh=true,lang='',st=null,stKey='',groups=null,characters=null,busy=false,loading=false,loadedOnce=false,form=null,ownChange=false,dispatch=null,dispatchForm=null,dispatchNote={text:'',error:false};
  const tr=(a,b)=>zh?a:b,colon=()=>tr('：',': ');
  const say=(text,error=false)=>{status.textContent=text||'';status.dataset.error=String(!!error);};
  const codeOf=error=>window.ArcadeST?.codeOf?.(error)||(typeof error?.code==='string'?error.code:'');
  const explain=error=>{const code=codeOf(error);return Object.hasOwn(CODES,code)?tr(...CODES[code]):window.ArcadeST?.explain?.(error,zh)||tr('操作没有完成，请稍后再试。','The action did not complete. Please try again.');};
  const activeId=()=>st?.available?st.settings?.groupId||null:null;
  const strategy=id=>STRATEGIES.find(row=>row[0]===id)||STRATEGIES[0];
  const changed=()=>{ownChange=true;try{document.dispatchEvent(new Event('arcade-library-changed'));}finally{ownChange=false;}};
  function syncBusy(){for(const node of section.querySelectorAll('button,input,select'))node.disabled=busy||node.dataset.locked==='true';}
  async function run(fn){
    if(busy)return;busy=true;syncBusy();let after=null;
    try{after=await fn();}catch(error){say(`${tr('没有完成','Not completed')}${colon()}${explain(error)}`,true);}
    finally{busy=false;syncBusy();}
    // Focus moves only once the controls are enabled again.
    if(typeof after==='function')after();
  }
  async function load(){
    if(loading)return;loading=true;
    try{const [rows,cards]=await Promise.all([window.arcade.groupsList(),window.arcade.charactersList(),loadDispatcher()]);groups=Array.isArray(rows)?rows:[];characters=Array.isArray(cards)?cards:[];loadedOnce=true;window.ArcadeCharactersTabs?.note('groups',groups.length);draw();if(form)drawForm();}
    catch{say(tr('群聊列表无法读取，请稍后再试。','The group chats could not be read. Please try again.'),true);}
    finally{loading=false;}
  }
  // Switching retires the running App conversation; it is then started again
  // through the same call the chat page's own buttons use.
  async function start(group){
    await run(async()=>{
      const before=activeId();
      if(before!==group.id){try{st=await window.arcade.stConfigure({groupId:group.id});}catch(error){say(`${tr('没有切换','Not switched')}${colon()}${explain(error)}`,true);return;}draw();}
      const result=await window.ArcadeDesktopConversation?.select('local',true,{force:before!==group.id});
      if(result?.ok===false)say(`${tr('群聊已选好，但对话没有开始','The group chat is selected, but the conversation did not start')}${colon()}${explain(result)}`,true);
      else say('');
    });
    if(document.body.dataset.view==='characters'&&[document.body,null].includes(document.activeElement))focusRow(group.id,'start');
  }
  function focusRow(id,act){
    const row=[...list.children].find(item=>item.dataset.groupId===id),target=row?.querySelector(`[data-act="${act}"]:not(:disabled)`)||row?.querySelector('button:not(:disabled)')||create;
    target.focus({preventScroll:true});
  }
  function draw(){
    const rows=groups||[],held=list.contains(document.activeElement)?document.activeElement:null,wanted=held?[held.closest('.groups-row')?.dataset.groupId,held.dataset.act]:null,active=activeId(),can=!!st?.available;
    empty.hidden=rows.length>0;empty.textContent=loadedOnce?tr('还没有群聊。','No group chats yet.'):'';
    list.replaceChildren(...rows.map(group=>{
      const item=el('div','sources-row groups-row'),body=el('div','sources-row-body'),head=el('div','groups-row-head'),buttons=el('div','groups-row-actions'),members=Array.isArray(group.members)?group.members:[],missing=members.some(member=>member.missing),current=group.id===active;
      item.dataset.groupId=group.id;head.append(el('strong','',group.name));
      if(current)head.append(el('span','groups-badge',tr('正在用于 App 对话','In use by the App conversation')));
      const names=el('span','groups-members',members.map(member=>member.missing&&!member.name?tr('一个已不在角色库的角色','a character no longer in the library'):`${member.name||tr('未命名角色','Unnamed character')}${member.missing?tr('（已不在角色库）',' (no longer in the library)'):member.muted?tr('（已静音）',' (muted)'):''}`).join(tr('、',', ')));
      body.append(head,names,el('span','groups-meta',`${tr(`${members.length} 位成员`,`${members.length} members`)} · ${tr(strategy(group.activationStrategy)[5],strategy(group.activationStrategy)[6])}${group.dispatcher?.enabled===true?tr(' · 由小模型判断谁接话',' · a small model decides who answers'):''}`));
      const act=(name,cls,text)=>{const b=el('button',cls,text);b.type='button';b.dataset.act=name;b.setAttribute('aria-label',`${text}${colon()}${group.name}`);return b;};
      const go=act('start','secondary',current?tr('继续群聊','Continue the group chat'):tr('开始群聊','Start the group chat')),edit=act('edit','plain',tr('编辑','Edit')),removeText=tr('删除（连同群聊记录）','Delete (with its chat history)'),remove=act('remove','plain',removeText);
      go.hidden=!can;
      if(missing){const problem=el('p','groups-row-problem',tr('有成员已不在角色库。请先点“编辑”把它移出群聊，才能开始。','A member is no longer in the library. Choose Edit and remove it from the group chat before starting.'));problem.id='groups-problem-'+group.id;body.append(problem);go.dataset.locked='true';go.setAttribute('aria-describedby',problem.id);}
      go.onclick=()=>void start(group);
      edit.onclick=()=>openForm(group);
      let armed=false;const disarm=()=>{armed=false;remove.textContent=removeText;remove.setAttribute('aria-label',`${removeText}${colon()}${group.name}`);};
      remove.addEventListener('blur',()=>{if(remove.isConnected)disarm();});
      remove.onclick=()=>{
        if(group.id===activeId()){say(tr(...CODES.group_active),true);return;}
        if(!armed){armed=true;remove.textContent=tr('再点一次确认删除','Click again to delete');remove.setAttribute('aria-label',`${tr('再点一次确认删除','Click again to delete')}${colon()}${group.name}`);return;}
        disarm();
        void run(async()=>{
          const index=rows.indexOf(group),next=rows[index+1]?.id||rows[index-1]?.id||'',result=await window.arcade.groupRemove(group.id);
          if(result?.ok!==true){say(`${tr('没有删除','Not deleted')}${colon()}${explain(result)}`,true);return;}
          if(form?.id===group.id)closeForm(false);
          say(result.removed===false?tr('没有删除。','Not deleted.'):tr(`已删除群聊“${group.name}”和它的聊天记录。`,`Deleted the group chat “${group.name}” and its chat history.`));
          await load();changed();return ()=>focusRow(next,'remove');
        });
      };
      buttons.append(go,edit,remove);item.append(body,buttons);return item;
    }));
    syncBusy();
    if(wanted&&[document.body,null].includes(document.activeElement))focusRow(wanted[0],wanted[1]);
  }

  // Create / edit form. `form` holds everything the owner has entered.
  function openForm(group){
    const members=(group?.members||[]).filter(member=>member&&typeof member.id==='string');
    form={id:group?.id||null,title:group?.name||'',name:group?.name||'',order:members.map(member=>member.id),muted:new Set(members.filter(member=>member.muted).map(member=>member.id)),talk:new Map(members.map(member=>[member.id,Math.round((Number.isFinite(member.talkativeness)?member.talkativeness:0.5)*100)])),stored:new Map(members.map(member=>[member.id,member.name||''])),strategy:strategy(group?.activationStrategy)[0],self:group?.allowSelfResponses===true,mode:group?.generationMode==='join'?'join':'swap',dispatch:group?.dispatcher?.enabled===true,message:'',error:false};
    formCard.hidden=false;drawForm();
    document.getElementById('groups-name')?.focus({preventScroll:true});formCard.scrollIntoView({block:'nearest'});
  }
  function closeForm(focus=true){
    const id=form?.id;form=null;formCard.hidden=true;formCard.replaceChildren();
    if(focus){if(id)focusRow(id,'edit');else create.focus({preventScroll:true});}
  }
  function field(labelText,control,id,hint){
    const wrap=el('label','st-field');control.id=id;wrap.htmlFor=id;wrap.append(el('span','',labelText),control);
    if(hint){hint.id=id+'-hint';control.setAttribute('aria-describedby',hint.id);wrap.append(hint);}
    return wrap;
  }
  function check(labelText,id){const wrap=el('label','st-check'),box=el('input','');box.type='checkbox';box.id=id;wrap.htmlFor=id;wrap.append(box,el('span','',labelText));return {wrap,box};}
  function drawForm(focus){
    if(!form)return;
    const f=form,known=new Map((characters||[]).map(row=>[row.id,row])),nameOf=id=>known.get(id)?.name||f.stored.get(id)||tr('（已移除的角色）','(removed character)'),gone=id=>!known.has(id),present=()=>f.order.filter(id=>!gone(id));
    const held=formCard.contains(document.activeElement)?document.activeElement:null,wanted=focus||(held?.id?{id:held.id}:held?.dataset.act?{member:held.closest('li')?.dataset.memberId,act:held.dataset.act}:null);
    const heading=el('h2','',f.id?`${tr('编辑群聊','Edit group chat')}${colon()}${f.title}`:tr('新建群聊','New group chat')),note=el('p','st-note',tr('群聊只在 App 对话里进行，不会发到 QQ 或微信。改动在点“保存”后生效。','A group chat happens in the App conversation only; nothing is sent to QQ or WeChat. Changes apply when you choose Save.'));
    const name=el('input','');name.type='text';name.maxLength=60;name.value=f.name;name.autocomplete='off';name.oninput=()=>{f.name=name.value;if(f.error)tell('');};
    // Member picker
    const picker=el('fieldset','st-books groups-picker'),legend=el('legend','',tr('成员（从角色库里选 2 到 8 个）','Members (choose 2 to 8 from the library)')),count=el('p','st-note groups-count'),items=el('div','st-book-items');
    const library=characters||[];
    count.id='groups-count';count.textContent=library.length<2?tr(`群聊至少需要两个已导入的角色，角色库里现在有 ${library.length} 个。请先在本页上方导入角色卡。`,`A group chat needs at least two imported characters; the library has ${library.length}. Import character cards at the top of this page first.`):tr(`已选 ${present().length} 个，需要 2 到 8 个。`,`${present().length} chosen; 2 to 8 are needed.`);
    for(const row of library){
      const item=check(row.name,'groups-pick-'+row.id);item.box.checked=f.order.includes(row.id);item.box.dataset.locked=String(!item.box.checked&&f.order.length>=8);
      item.box.onchange=()=>{if(item.box.checked){if(f.order.length<8)f.order.push(row.id);}else{f.order=f.order.filter(id=>id!==row.id);f.muted.delete(row.id);}f.message='';drawForm({id:item.box.id});};
      items.append(item.wrap);
    }
    picker.append(legend,count,items);
    // Chosen members: speaking order, mute, talkativeness
    const orderTitle=el('h4','',tr('发言顺序与每个成员的设置','Speaking order and per-member settings')),orderNote=el('p','st-note',f.strategy==='natural'?tr('健谈程度越高，没被点到名字时越容易主动接话。静音的成员不会发言。','The higher the talkativeness, the more readily a member joins in when not named. A muted member does not speak.'):tr('“按顺序”时按这里的先后发言。静音的成员不会发言。','With “In order”, members speak in the order shown here. A muted member does not speak.')),order=el('ol','st-order groups-order');
    order.append(...f.order.map((id,index)=>{
      const label=nameOf(id),item=el('li','st-order-row groups-member-row'),main=el('div','groups-member-main'),options=el('div','groups-member-options');item.dataset.memberId=id;
      main.append(el('span','groups-member-index',`${index+1}.`),el('span','groups-member-name',label));
      if(gone(id)){
        const out=el('button','plain',tr('移出群聊','Remove from the group chat'));out.type='button';out.dataset.act='out';out.setAttribute('aria-label',`${tr('移出群聊','Remove from the group chat')}${colon()}${label}`);
        out.onclick=()=>{const next=f.order[index+1]||f.order[index-1];f.order=f.order.filter(member=>member!==id);f.muted.delete(id);f.message='';drawForm(next?{member:next,act:'up'}:{id:'groups-name'});};
        main.append(el('span','groups-member-gone',tr('已不在角色库','No longer in the library')));item.append(main,out);return item;
      }
      const up=el('button','plain st-move',tr('上移','Up')),down=el('button','plain st-move',tr('下移','Down'));
      up.type=down.type='button';up.dataset.act='up';down.dataset.act='down';up.title=tr('上移','Move up');down.title=tr('下移','Move down');up.setAttribute('aria-label',`${tr('上移','Move up')}${colon()}${label}`);down.setAttribute('aria-label',`${tr('下移','Move down')}${colon()}${label}`);
      up.dataset.locked=String(index===0);down.dataset.locked=String(index===f.order.length-1);
      const move=step=>{const to=index+step;if(to<0||to>=f.order.length)return;[f.order[index],f.order[to]]=[f.order[to],f.order[index]];drawForm({member:id,act:step<0?'up':'down'});};
      up.onclick=()=>move(-1);down.onclick=()=>move(1);
      const mute=check(tr('静音（不发言）','Muted (does not speak)'),'groups-mute-'+id);mute.box.checked=f.muted.has(id);mute.box.setAttribute('aria-label',`${tr('静音','Mute')}${colon()}${label}`);mute.box.onchange=()=>{if(mute.box.checked)f.muted.add(id);else f.muted.delete(id);};
      options.append(mute.wrap);
      if(f.strategy==='natural'){
        const talk=el('label','groups-talk'),range=el('input',''),value=f.talk.get(id)??50,shown=el('output','groups-talk-value',`${value}%`);
        range.type='range';range.min='0';range.max='100';range.step='5';range.value=String(value);range.id='groups-talk-'+id;talk.htmlFor=range.id;shown.htmlFor=range.id;
        range.setAttribute('aria-label',`${tr('健谈程度','Talkativeness')}${colon()}${label}`);range.setAttribute('aria-valuetext',`${value}%`);
        range.oninput=()=>{const next=Number(range.value)||0;f.talk.set(id,next);shown.textContent=`${next}%`;range.setAttribute('aria-valuetext',`${next}%`);};
        talk.append(el('span','',tr('健谈程度','Talkativeness')),range,shown);options.append(talk);
      }
      item.append(main,up,down,options);return item;
    }));
    if(!f.order.length)order.append(el('li','st-note groups-order-empty',tr('还没有选成员。','No members chosen yet.')));
    // Strategy and options
    const select=el('select',''),hint=el('small','st-hint',tr(strategy(f.strategy)[3],strategy(f.strategy)[4]));
    select.append(...STRATEGIES.map(row=>{const o=el('option','',tr(row[1],row[2]));o.value=row[0];return o;}));select.value=f.strategy;
    select.onchange=()=>{f.strategy=select.value;f.message='';drawForm({id:'groups-strategy'});};
    const self=check(tr('允许同一角色连续发言','Allow the same character to speak twice in a row'),'groups-self');self.box.checked=f.self;self.box.onchange=()=>{f.self=self.box.checked;};
    const mode=el('select',''),modeHint=el('small','st-hint',tr('决定每次回复时发给 AI 的角色设定：只有正在发言的那个角色，或所有成员的合在一起（文字更多，费用更高）。','Decides which character cards are sent to the AI for each reply: only the one speaking, or all members combined (more text, higher cost).'));
    mode.append(...MODES.map(row=>{const o=el('option','',tr(row[1],row[2]));o.value=row[0];return o;}));mode.value=f.mode;mode.onchange=()=>{f.mode=mode.value;};
    // Model-assisted speaker choice: offered only once the dispatcher model is configured.
    const canDispatch=typeof window.arcade.dispatcherStatus==='function',ready=dispatch?.ready===true,dispatchBox=check(tr('由小模型判断谁接话','Let a small model decide who answers'),'groups-dispatch'),dispatchHint=el('small','st-hint groups-dispatch-hint');
    dispatchBox.box.checked=f.dispatch;dispatchBox.box.dataset.locked=String(!ready&&!f.dispatch);dispatchBox.box.onchange=()=>{f.dispatch=dispatchBox.box.checked;};
    dispatchHint.id='groups-dispatch-hint';dispatchBox.box.setAttribute('aria-describedby',dispatchHint.id);
    dispatchHint.textContent=ready||f.dispatch?`${tr(`开启后，每一轮会把最近 6 条消息（截短）和成员名字发到你配置的调度模型端点一次，每天最多 ${dispatch?.dailyCap||500} 次。你在消息里点到名字的成员仍然优先。它只在“自然”和“轮流”两种方式下起作用；出任何问题都会退回上面选的方式。`,`When on, the last 6 messages (shortened) and the member names are sent to your dispatcher endpoint once per turn, at most ${dispatch?.dailyCap||500} times a day. A member you mention by name still wins. It only acts with “Natural” and “Take turns”, and any failure falls back to the choice above.`)}${ready?'':tr(' 现在调度模型没有就绪，所以实际不会调用；可以在这里把它关掉。',' The dispatcher model is not ready right now, so no call is made; you can switch this off here.')}`
      :tr('请先保存调度模型，并确认所选服务已配置。','Save the dispatcher configuration and check that the chosen provider is set up first.');
    const dispatchWrap=el('div','groups-dispatch');dispatchWrap.append(dispatchBox.wrap,dispatchHint);dispatchWrap.hidden=!canDispatch;
    const row=el('div','st-save-row'),save=el('button','primary',tr('保存','Save')),cancel=el('button','secondary',tr('取消','Cancel')),message=el('span','st-status',f.message);
    save.type=cancel.type='button';save.id='groups-save';cancel.id='groups-cancel';message.setAttribute('role','status');message.dataset.error=String(f.error);save.setAttribute('aria-label',`${tr('保存','Save')}${colon()}${tr('群聊','group chat')}`);
    const tell=(text,error=false)=>{f.message=text||'';f.error=!!error;message.textContent=f.message;message.dataset.error=String(f.error);};
    cancel.onclick=()=>closeForm(true);
    save.onclick=()=>{
      const text=f.name.trim();
      if(!text){tell(tr('请先填写群聊名称。','Enter a name for the group chat first.'),true);name.focus();return;}
      if(/[\u0000-\u001f\u007f]/.test(text)){tell(tr('名称里不能有换行或控制字符。','The name cannot hold line breaks or control characters.'),true);name.focus();return;}
      if(f.order.some(gone)){tell(tr(...CODES.character_missing),true);order.querySelector('[data-act="out"]')?.focus();return;}
      if(f.order.length<2||f.order.length>8){tell(tr(`现在选了 ${f.order.length} 个成员，需要 2 到 8 个。`,`${f.order.length} members are chosen; 2 to 8 are needed.`),true);(items.querySelector('input:not(:disabled)')||name).focus();return;}
      void run(async()=>{
        tell(tr('正在保存…','Saving…'));
        const result=await window.arcade.groupSave({...(f.id?{id:f.id}:{}),name:text,members:[...f.order],mutedMembers:f.order.filter(id=>f.muted.has(id)),talkativeness:Object.fromEntries(f.order.map(id=>[id,(f.talk.get(id)??50)/100])),activationStrategy:f.strategy,allowSelfResponses:f.self,generationMode:f.mode,...(canDispatch?{dispatcher:{enabled:f.dispatch}}:{})});
        if(result?.ok!==true){tell(`${tr('没有保存','Not saved')}${colon()}${explain(result)}`,true);if(codeOf(result)==='character_missing'||codeOf(result)==='group_not_found')await load();return;}
        const saved=result.group?.id||f.id;form=null;formCard.hidden=true;formCard.replaceChildren();
        say(tr(`已保存群聊“${text}”。`,`Saved the group chat “${text}”.`));await load();changed();return ()=>focusRow(saved,'start');
      });
    };
    row.append(save,cancel,message);
    formCard.replaceChildren(heading,note,field(tr('群聊名称（最多 60 字）','Group chat name (up to 60 characters)'),name,'groups-name'),picker,orderTitle,orderNote,order,field(tr('谁来发言','Who speaks'),select,'groups-strategy',hint),dispatchWrap,self.wrap,field(tr('发给 AI 的角色设定','Character cards sent to the AI'),mode,'groups-mode',modeHint),row);
    syncBusy();
    if(wanted&&[document.body,null].includes(document.activeElement)){
      let target=wanted.id?document.getElementById(wanted.id):null;
      if(!target&&wanted.member){const item=[...order.children].find(li=>li.dataset.memberId===wanted.member),other={up:'down',down:'up'}[wanted.act];target=item?.querySelector(`[data-act="${wanted.act}"]:not(:disabled)`)||(other&&item?.querySelector(`[data-act="${other}"]:not(:disabled)`))||item?.querySelector('button:not(:disabled),input:not(:disabled)');}
      (target&&!target.disabled?target:name).focus({preventScroll:true});
    }
  }

  // Dispatcher model: an optional small model that decides which member answers. Configured once,
  // then switched on per group chat in the form above. The card is redrawn only by the owner's
  // own actions; what is typed lives in `dispatchForm`.
  const dispatchCard=el('article','settings-card st-card groups-dispatcher');dispatchCard.id='groups-dispatcher';dispatchCard.hidden=typeof window.arcade.dispatcherStatus!=='function';
  // Optional and off by default: folded until it is configured or the owner opens it.
  const dispatchWrap=el('details','groups-dispatcher-wrap'),dispatchSummary=el('summary','');dispatchWrap.id='groups-dispatcher-wrap';dispatchWrap.hidden=dispatchCard.hidden;dispatchWrap.append(dispatchSummary,dispatchCard);section.append(dispatchWrap);
  let dispatchWrapSeen=false;
  function syncDispatchWrap(){
    dispatchSummary.textContent=tr('调度模型（可选，默认不使用）','Dispatcher model (optional, off by default)');
    if(!dispatchWrapSeen&&dispatch){dispatchWrapSeen=true;if(dispatch.configured)dispatchWrap.open=true;}
  }
  const SLOTS=[['','不带密钥（本机或自建端点）','No key (local or self-hosted endpoint)',''],['key','用应用里已保存的 Anthropic 密钥','The Anthropic key saved in the app','api.anthropic.com'],['openaiKey','用应用里已保存的 OpenAI 密钥','The OpenAI key saved in the app','api.openai.com'],['deepseekKey','用应用里已保存的 DeepSeek 密钥','The DeepSeek key saved in the app','api.deepseek.com'],['geminiKey','用应用里已保存的 Gemini 密钥','The Gemini key saved in the app','generativelanguage.googleapis.com'],['doubaoKey','用应用里已保存的豆包密钥','The Doubao key saved in the app','ark.cn-beijing.volces.com']];
  const DISPATCH_CODES={invalid_endpoint:['端点地址不可用。需要 https:// 开头的地址；不带密钥时也可以填本机的 http://127.0.0.1 地址。','The endpoint cannot be used. It needs an https:// address; without a key, a local http://127.0.0.1 address also works.'],invalid_model:['模型名为空或不可用。','The model name is empty or cannot be used.'],invalid_key_slot:['密钥来源不可用。','The key source cannot be used.'],key_host_mismatch:['选了已保存的密钥时，端点必须是那个服务自己的地址，这样密钥不会被发到别处。','With a saved key, the endpoint must be that provider’s own host, so the key is never sent anywhere else.'],invalid_request:['有内容不符合要求，请检查后再试。','Something entered is not valid. Check it and try again.'],storage_unavailable:['设置没能保存到本机，请稍后再试。','The setting could not be saved on this computer. Please try again.'],unavailable:['现在不能使用，请稍后再试。','Not available right now. Please try again.']};
  const dispatchWhy=code=>Object.hasOwn(DISPATCH_CODES,code)?tr(...DISPATCH_CODES[code]):tr(...DISPATCH_CODES.unavailable);
  async function loadDispatcher(){
    if(dispatchCard.hidden)return;
    const before=JSON.stringify(dispatch);
    try{const result=await window.arcade.dispatcherStatus();if(result?.ok===false)throw result;dispatch=result;if(!dispatchForm)dispatchForm={endpoint:result.endpoint||'',model:result.model||'',keySlot:result.keySlot||''};}
    catch(error){dispatch=null;dispatchNote={text:`${tr('调度模型的状态没有读到','The dispatcher status could not be read')}${colon()}${dispatchWhy(codeOf(error))}`,error:true};}
    // The list is re-read whenever this page is shown again; the card is left alone while nothing changed or a field is being typed in.
    const typing=dispatchCard.contains(document.activeElement)&&['INPUT','SELECT'].includes(document.activeElement.tagName);
    if(dispatchCard.dataset.loaded!=='true'||(!typing&&!busy&&JSON.stringify(dispatch)!==before)){dispatchCard.dataset.loaded='true';drawDispatcher();if(form&&!formCard.contains(document.activeElement))drawForm();}
  }
  function drawDispatcher(){
    if(dispatchCard.hidden)return;
    syncDispatchWrap();
    if(!dispatch&&!dispatchForm){dispatchCard.replaceChildren(el('h2','',tr('调度模型','Dispatcher model')),el('p','st-note',dispatchNote.text||tr('正在读取…','Loading…')));return;}
    const held=dispatchCard.contains(document.activeElement)?document.activeElement.id:'',d=dispatch,f=dispatchForm||{endpoint:'',model:'',keySlot:''};
    const endpoint=el('input',''),model=el('input',''),slot=el('select',''),slotHint=el('small','st-hint'),row=el('div','st-save-row'),save=el('button','primary',tr('保存','Save')),clear=el('button','plain',tr('清除配置','Clear the configuration')),message=el('span','st-status',dispatchNote.text);
    endpoint.type='url';endpoint.maxLength=300;endpoint.value=f.endpoint;endpoint.autocomplete='off';endpoint.spellcheck=false;endpoint.placeholder='https://';model.type='text';model.maxLength=120;model.value=f.model;model.autocomplete='off';model.spellcheck=false;
    slot.append(...SLOTS.map(item=>{const o=el('option','',tr(item[1],item[2]));o.value=item[0];return o;}));slot.value=f.keySlot||'';
    const hintFor=()=>{const item=SLOTS.find(entry=>entry[0]===slot.value);slotHint.textContent=item?.[3]?tr(`端点必须是 ${item[3]}。需要先为这个服务保存密钥。`,`The endpoint must be on ${item[3]}. Save a key for this provider first.`):tr('可以是任意 HTTPS 端点，或本机的 http://127.0.0.1 模型；请求里不带任何密钥。','Any HTTPS endpoint, or a local http://127.0.0.1 model; no key is sent with the request.');};
    hintFor();
    endpoint.oninput=()=>{f.endpoint=endpoint.value;};model.oninput=()=>{f.model=model.value;};slot.onchange=()=>{f.keySlot=slot.value;hintFor();};
    save.type=clear.type='button';save.id='groups-dispatcher-save';clear.id='groups-dispatcher-clear';message.setAttribute('role','status');message.dataset.error=String(dispatchNote.error);
    save.setAttribute('aria-label',`${tr('保存','Save')}${colon()}${tr('调度模型','dispatcher model')}`);
    const tell=(text,error=false)=>{dispatchNote={text:text||'',error:!!error};message.textContent=dispatchNote.text;message.dataset.error=String(dispatchNote.error);};
    const finish=(id,after)=>async()=>{await after();drawDispatcher();if(form)drawForm();return ()=>document.getElementById(id)?.focus({preventScroll:true});};
    save.onclick=()=>{
      if(!endpoint.value.trim()){tell(tr('请先填写端点地址。','Enter the endpoint address first.'),true);endpoint.focus();return;}
      if(!model.value.trim()){tell(tr('请先填写模型名。','Enter the model name first.'),true);model.focus();return;}
      void run(finish('groups-dispatcher-save',async()=>{
        tell(tr('正在保存…','Saving…'));
        const result=await window.arcade.dispatcherConfigure({endpoint:endpoint.value.trim(),model:model.value.trim(),keySlot:slot.value||null});
        if(result?.ok!==true){tell(`${tr('没有保存','Not saved')}${colon()}${dispatchWhy(codeOf(result))}`,true);return;}
        dispatch=result;dispatchForm={endpoint:result.endpoint||'',model:result.model||'',keySlot:result.keySlot||''};tell(tr('已保存。只在启用调度的群聊中使用。','Saved. Only groups with dispatch enabled use this model.'));
      }));
    };
    clear.dataset.locked=String(!d?.configured);
    let armed=false;const clearText=clear.textContent;clear.addEventListener('blur',()=>{armed=false;clear.textContent=clearText;});
    clear.onclick=()=>{
      if(!armed){armed=true;clear.textContent=tr('再点一次确认清除','Click again to clear');return;}
      void run(finish('groups-dispatcher-endpoint',async()=>{
        const result=await window.arcade.dispatcherConfigure({endpoint:''});
        if(result?.ok!==true){tell(`${tr('没有清除','Not cleared')}${colon()}${dispatchWhy(codeOf(result))}`,true);return;}
        dispatch=result;dispatchForm={endpoint:'',model:'',keySlot:''};tell(tr('已清除。开着这个开关的群聊会退回各自的发言方式。','Cleared. Group chats with the switch on fall back to their own strategy.'));
      }));
    };
    row.append(save,clear,message);
    const nodes=[el('h2','',tr('调度模型','Dispatcher model')),el('p','st-note',tr(`可选，默认不使用。它是一个小模型，在群聊里判断你这句话是对谁说的。保存配置后，只有单独开启调度的群聊会使用它。开启的群聊每一轮会把最近 6 条消息（截短）和成员名字发到这个端点一次，每天最多 ${d?.dailyCap||500} 次；你点到名字的成员仍然优先；出任何问题都会退回群聊原来的发言方式。`,`Optional and unused by default. A small model that judges whom your message in a group chat is meant for. Only groups with dispatch enabled in their settings use the saved configuration. A group with it on sends the last 6 messages (shortened) and the member names to this endpoint once per turn, at most ${d?.dailyCap||500} times a day. A member you mention by name still wins, and any failure falls back to the group’s own strategy.`)),
      field(tr('端点地址（兼容 OpenAI 聊天接口）','Endpoint address (OpenAI-compatible chat API)'),endpoint,'groups-dispatcher-endpoint'),field(tr('模型名','Model name'),model,'groups-dispatcher-model'),field(tr('密钥来源','Key source'),slot,'groups-dispatcher-slot',slotHint),row];
    if(d?.configured&&!d.ready)nodes.push(el('p','st-note',d.keySlot&&!d.keyPresent?tr('请先保存该服务的密钥。','Save a key for this provider first.'):tr('请核对并重新保存调度设置。','Review and save the dispatcher settings again.')));
    dispatchCard.replaceChildren(...nodes);syncBusy();
    if(held&&[document.body,null].includes(document.activeElement))document.getElementById(held)?.focus({preventScroll:true});
  }
  create.onclick=()=>openForm(null);
  window.renderGroups=data=>{
    zh=data.config?.language==='zh';
    const next=data.bot?.st||null,key=JSON.stringify([next?.available,next?.settings?.groupId,next?.problem]);
    if(lang!==data.config?.language){
      lang=data.config?.language;stKey=key;if(!busy)st=next;
      title.textContent=tr('群聊','Group chats');
      intro.textContent=tr('把角色库里的 2 到 8 个角色放进同一段 App 对话，由他们一起回复你。群聊只在 App 对话里进行，不会发到 QQ 或微信；每个群聊有自己的聊天记录。','Put 2 to 8 library characters into one App conversation and let them reply together. A group chat happens in the App conversation only; nothing is sent to QQ or WeChat. Each group chat keeps its own history.');
      create.textContent=tr('新建群聊…','New group chat…');draw();if(form)drawForm();drawDispatcher();
    }else if(!busy&&key!==stKey){stKey=key;st=next;draw();}
    if(!loadedOnce&&document.body.dataset.view==='characters')void load();
  };
  document.addEventListener('arcade-library-changed',()=>{if(!ownChange)void load();});
  new MutationObserver(()=>{if(document.body.dataset.view==='characters')void load();}).observe(document.body,{attributes:true,attributeFilter:['data-view']});
})();
