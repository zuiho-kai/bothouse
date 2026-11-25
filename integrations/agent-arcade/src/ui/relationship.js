'use strict';
(() => {
  const root=el('section','view relationship-view');root.id='relationship-view';root.hidden=true;document.querySelector('main').append(root);
  const nav=el('button','nav');nav.dataset.view='relationship';nav.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M12 20S3 15 3 8a5 5 0 0 1 9-3 5 5 0 0 1 9 3c0 7-9 12-9 12Z"/></svg>';const navText=el('span');nav.append(navText);nav.onclick=()=>switchView('relationship');document.querySelector('nav').insertBefore(nav,document.querySelector('nav [data-view="connections"]'));
  const option=el('option');option.value='relationship';$('view-picker').append(option);
  let state,language,identity,tab='memory',busy=false,editing=null,editingRevision=null,cardPreview=null,refs={},listKey='',viewEpoch=0,memorySource=null,sourceProfile=null,localScopeKey=null;
  const sourceDrafts=new Map();
  const QQ_TABS=['followups','journal'];let boundKey=null;
  // A QQ relationship exists (owner set for the QQ channel, verified once, or records already kept).
  // Without one, the QQ-only tabs and the QQ memory source stay folded behind one line.
  const qqBound=s=>{const b=s?.bot||{},social=b.social||{};return !!(social.memoryReady||social.active||b.channel==='qq'&&(b.qq?.ownerId||b.qq?.check?.accountId)||social.facts?.length||social.followups?.length||social.entries?.length);};
  const localAvailable=s=>!!s?.bot?.local?.memory&&typeof window.arcade.desktopLocalMemory==='function';
  const localMemory=()=>tab==='memory'&&memorySource==='local';
  const memoryScope=(s,source)=>JSON.stringify([s.accounts?.selectedId||'primary',source,source==='local'?[s.bot?.local?.characterId,s.bot?.local?.memory?.id]:[s.bot?.social?.config.characterId,s.bot?.channel,s.bot?.qq?.ownerId,s.bot?.qq?.check?.accountId,!!s.bot?.social?.memoryReady]]);
  const viewIdentity=s=>localMemory()?memoryScope(s,'local'):memoryScope(s,'channel');
  const tr=(zh,en)=>language==='zh'?zh:en;
  const text=(tag,value,cls='')=>el(tag,cls,value);
  function button(label,fn,cls='secondary',success=''){const b=text('button',label,cls);b.type='button';b.onclick=()=>void perform(fn,success);return b;}
  let focusEditor=false;
  async function perform(fn,success=''){
    if(busy)return;
    const startedIdentity=identity,epoch=viewEpoch,draft=refs.memoryDraft;
    const isCurrent=()=>identity===startedIdentity&&(viewEpoch===epoch||(draft&&draft===refs.memoryDraft));
    const operation={epoch};busy=operation;refs.feedback.textContent=tr('处理中…','Working…');updateControls();
    try{
      const result=await fn({isCurrent});if(!isCurrent())return;
      const snapshotEpoch=viewEpoch,next=await window.arcade.snapshot();if(!isCurrent())return;
      if(viewEpoch===snapshotEpoch)window.renderRelationship(next);
      if(isCurrent())refs.feedback.textContent=typeof success==='function'?success(result):success;
    }catch(error){if(isCurrent())refs.feedback.textContent=editError(error);}
    finally{if(busy===operation){busy=false;updateControls();if(focusEditor&&isCurrent())refs.editor?.focus();}focusEditor=false;}
  }
  function editError(error){
    if(error?.localMemory&&error.code==='invalid_memory')return tr('请核对记忆内容，最多 500 字；没有自动重试。','Check the memory text; up to 500 characters. It was not retried automatically.');
    if(error?.localMemory){const codes={changed:tr('记忆来源已变化，请重新核对当前内容。','The memory source changed. Review the current entries.'),storage_unavailable:tr('本地记忆暂时无法读取，草稿仍保留，请稍后再试。','Local memory is unavailable. Your draft is kept; try again later.'),busy:tr('上一项记忆操作尚未结束，请稍后再试。','The previous memory action is still running. Try again shortly.'),stopping:tr('正在结束上一段本地对话，请稍后再试。','The previous App conversation is ending. Try again shortly.'),stop_failed:tr('上一段本地对话尚未确认结束，请先在聊天页再次暂停。','The previous App conversation is not confirmed stopped. Retry pausing it on the chat page.'),fact_changed:tr('这条记忆已被更新。请重新点“修改”，核对最新内容后再保存。','This memory was updated. Select Edit again and review the latest content.'),fact_not_found:tr('这条记忆已不存在，请查看当前列表。','This memory no longer exists. Check the current list.'),invalid_request:tr('请核对记忆内容，最多 500 字。','Check the memory text; up to 500 characters.')};return (Object.hasOwn(codes,error.code)?codes[error.code]:null)||tr('记忆保存结果未确认。请先核对当前列表，未自动重试。','The memory result is unconfirmed. Check the current list before trying again.');}
    const message=String(error?.message||error);
    if(message.endsWith('The fact changed; review the current value.'))return tr('这条记忆已被更新。请重新点“修改”，核对最新内容后再保存。','This memory was updated. Select Edit again and review the latest content before saving.');
    if(message.endsWith('The follow-up changed; review its current time.'))return tr('这个回访已被更新。请重新点“修改”，核对最新时间和内容后再保存。','This follow-up was updated. Select Edit again and review the latest time and topic before saving.');
    return message;
  }
  function publishFeedback(result){
    if(result?.accepted===true)return result.contentVerified===true?tr('空间接口已接受，正文已读回；实际可见范围仍需核对。','Qzone accepted the post and its text was read back. Audience visibility still needs checking.'):tr('空间接口已接受；正文与实际可见范围尚未核验。','Qzone accepted the post. Its text and audience visibility have not been verified.');
    if(result?.unknown)return tr('发布结果未确认，未自动重发。请先查看她的空间。','Publication is uncertain and was not retried. Check her Qzone before doing anything else.');
    if(result?.cancelled)return tr('本次发布已取消，未提交帖子。','Publication was cancelled before the post was submitted.');
    return tr('未确认发布成功，请查看日记记录。','Publication was not confirmed. Check the journal record.');
  }
  function input(label,id,{type='text',max=500,rows}={}){const wrap=text('div','','social-field'),lab=text('label',label),field=text(rows?'textarea':'input');field.id=id;lab.htmlFor=id;if(rows)field.rows=rows;else field.type=type;field.maxLength=max;wrap.append(lab,field);return {wrap,field};}
  function localTimeValue(at){const date=new Date(at);return new Date(at-date.getTimezoneOffset()*60000).toISOString().slice(0,19);}
  function followupTime(value){
    const at=new Date(value).getTime(),wall=value.length===16?value+':00':value;
    if(!Number.isFinite(at)||at<=Date.now())throw Error(tr('请选择未来的有效时间。','Choose a valid future time.'));
    if(localTimeValue(at)!==wall)throw Error(tr('这个本地时间不存在，可能遇到夏令时切换。请选择另一个时间。','This local time does not exist, possibly because of daylight saving. Choose another time.'));
    // A repeated clock time has two valid UTC offsets. Do not silently select
    // one; an existing appointment keeps its already explicit instant below.
    const offset=new Date(at).getTimezoneOffset();
    for(const day of [-1,1]){const shift=new Date(at+day*86400000).getTimezoneOffset()-offset;if(shift&&localTimeValue(at+shift*60000)===wall)throw Error(tr('这个时间在夏令时切换时出现两次。请选择另一个时间，或在 QQ 回访命令中明确 +11:00 等时差。','This time occurs twice during a daylight-saving change. Choose another time or specify an explicit UTC offset in a QQ follow-up command.'));}
    return at;
  }
  async function edit(value){if(!localMemory())return window.arcade.socialEdit(value);const accountId=state.accounts?.selectedId,memoryId=state.bot?.local?.memory?.id;let r;try{r=await window.arcade.desktopLocalMemory({accountId,memoryId,...value});}catch(e){throw {localMemory:true,code:e?.code};}if(r?.ok!==true||r.accountId!==accountId||r.memoryId!==memoryId||r.action!==value.action)throw {localMemory:true,code:r?.code||'changed'};return r;}
  function chooseMemory(source){if(busy||memorySource===source)return;memorySource=source;build();renderLists();updateControls();$('relationship-memory-'+source)?.focus({preventScroll:true});}
  function build(){
    viewEpoch++;identity=viewIdentity(state);root.replaceChildren();refs={};editing=null;editingRevision=null;cardPreview=null;listKey='';
    const persona=(localMemory()?(state.personas||[]).find(p=>p.id===state.bot?.local?.characterId):null)||state.persona;const head=text('div','','relationship-heading');const avatar=text('img');avatar.src=persona?.portrait||'portraits/sprout-anime.png';avatar.alt='';const titles=text('div');titles.append(text('h1',tr('相处','Together')),text('p',`${persona?.name?.[language]||''} · ${tr('留下记忆，也保留彼此的空间','A shared history, with room to be yourself')}`,'subtitle'));head.append(avatar,titles);root.append(head);
    const tabs=text('div','','relationship-tabs');tabs.setAttribute('role','tablist');const bound=qqBound(state);for(const [id,zh,en]of [['memory','记得的事','Memory'],['followups','约定回访','Follow-ups'],['journal','她的日记','Her journal'],['card','角色卡','Character card']]){if(!bound&&QQ_TABS.includes(id))continue;const b=button(tr(zh,en),()=>{tab=id;build();renderLists();updateControls();$('relationship-tab-'+id)?.focus({preventScroll:true});},'plain');b.id='relationship-tab-'+id;b.setAttribute('role','tab');b.setAttribute('aria-selected',String(tab===id));tabs.append(b);}root.append(tabs);
    refs.feedback=text('p','','relationship-feedback');refs.feedback.setAttribute('role','status');root.append(refs.feedback);
    refs.notice=text('p','','social-hint');root.append(refs.notice);
    refs.body=text('div','','relationship-body');root.append(refs.body);
    if(tab==='memory')buildMemory();if(tab==='followups')buildFollowups();if(tab==='journal')buildJournal();if(tab==='card')buildCard();
    if(!bound){const more=text('p','','relationship-more'),link=text('button',tr('去“工作 › 渠道”连接','Connect under Work › Channels'),'plain');link.type='button';link.id='relationship-connect-qq';link.onclick=()=>switchView('connections');more.append(text('span',tr('连接 QQ 后还可以：约定回访、写公开日记。','After connecting QQ you can also schedule follow-ups and keep a public journal.')),link);root.append(more);}
  }
  function buildMemory(){
    if(!localAvailable(state)&&!qqBound(state)){refs.body.append(text('p',tr('这位角色的 App 记忆现在还不能用。先在“对话”页和它聊起来，再回到这里。','App memory is not available for this character yet. Start a conversation on the Chat page first, then come back here.'),'relationship-intro'));return;}
    if(localAvailable(state)&&!qqBound(state))refs.body.append(text('p',tr('只属于这位角色的 App 对话；暂停聊天后也能管理。','For this character’s App conversations. You can manage it while chat is paused.'),'social-hint'));
    else if(localAvailable(state)){const source=text('div','','relationship-actions relationship-memory-sources');source.setAttribute('role','group');source.setAttribute('aria-label',tr('记忆来源','Memory source'));for(const [id,zh,en]of [['local','App 记忆','App memory'],['channel','QQ 记忆','QQ memory']]){const b=text('button',tr(zh,en),'secondary');b.id='relationship-memory-'+id;b.type='button';b.setAttribute('aria-pressed',String(memorySource===id));b.onclick=()=>chooseMemory(id);source.append(b);}refs.sources=source;refs.body.append(source,text('p',localMemory()?tr('只属于这位角色的 App 对话，与 QQ 分开保存；暂停聊天后也能管理。','For this character’s App conversations, saved separately from QQ. You can manage it while chat is paused.'):tr('来自已核实的 QQ 主人关系，与 App 记忆分开保存。','From the verified QQ owner relationship, saved separately from App memory.'),'social-hint'));}
    refs.body.append(text('p',tr('记下你明确想保留的偏好与约定。每条记忆都有来源和时间，你可以随时改正。','Keep the preferences and facts you explicitly want remembered. Every entry has a source and time, and you can correct it.'),'relationship-intro'));
    refs.list=text('div','','relationship-records');refs.body.append(refs.list);
    const {wrap,field}=input(tr('希望她记住什么','What should she remember?'),'memory-text',{max:500,rows:3});refs.editor=field;
    // The draft owns the revision the user actually reviewed, even if a newer snapshot arrives.
    const scope=memoryScope(state,memorySource);
    const draft=sourceDrafts.get(scope)||{text:'',id:null,revision:null};
    sourceDrafts.set(scope,draft);refs.memoryDraft=draft;
    field.value=draft.text;field.oninput=()=>{draft.text=field.value;};
    function clearDraft(){Object.assign(draft,{text:'',id:null,revision:null});refs.editor.value='';}
    refs.save=button('',async({isCurrent})=>{
      const {id,revision}=draft,submitted=field.value;
      draft.text=submitted;
      await edit(id!==null?{action:'correct',id,text:submitted,...(Number.isInteger(revision)?{revision}:{})}:{action:'remember',text:submitted});
      if(isCurrent()&&draft.text===submitted)clearDraft();
    },'primary',()=>tr('记忆已保存。','Memory saved.'));
    refs.save.id='relationship-memory-save';
    const cancel=text('button',tr('取消更正','Cancel correction'),'secondary');
    cancel.id='relationship-memory-cancel';cancel.type='button';refs.cancelCorrection=cancel;
    cancel.onclick=()=>{
      if(busy||refs.memoryDraft!==draft||draft.id===null)return;
      clearDraft();refs.feedback.textContent='';updateControls();
      (field.disabled?$('relationship-tab-memory'):field).focus({preventScroll:true});
    };
    const actions=text('div','','button-row');actions.append(refs.save,cancel);
    refs.body.append(wrap,actions,text('p',localMemory()?tr('保存会停止当前 App 回复。更正或忘记还会清空此角色的 App 近期对话与自由笔记，并移除含相同旧事实的记忆。无关记忆和 QQ 记录保留。','Saving stops the current App reply. Correcting or forgetting also clears this character’s recent App conversation and freeform notes, and removes memories containing the same old fact. Unrelated memories and QQ records stay unchanged.'):tr('纠正或忘记会清空这段关系的近期对话与自由笔记、取消关联回访，也移除包含相同旧事实文字的记忆，防止再次引用。无关结构化记忆保留，QQ 聊天记录不变。','Correcting or forgetting clears recent conversation and freeform notes, cancels linked follow-ups, and removes memories containing the same old fact text. Unrelated structured memories and QQ messages stay unchanged.'),'social-hint'));
  }
  function buildFollowups(){
    refs.body.append(text('p',tr('约好时间再来找你。应用关闭时错过的约定不会补发；时间与内容可以修改。','Agree on a time to check in. Missed appointments while the app is closed are not replayed. You can edit the time and topic.'),'relationship-intro'));
    refs.list=text('div','','relationship-records');refs.body.append(refs.list);
    const topic=input(tr('到时聊什么','What should she follow up on?'),'followup-text',{max:500,rows:2}),when=input(tr('时间','When'),'followup-time',{type:'datetime-local'});when.field.step='1';refs.editor=topic.field;refs.when=when.field;
    const zone=Intl.DateTimeFormat().resolvedOptions().timeZone;refs.body.append(topic.wrap,when.wrap,text('p',`${tr('当前时间区','Time zone')}: ${zone}`,'social-hint'));
    refs.save=button(tr('约好回访','Schedule follow-up'),async()=>{const unchanged=editing&&Number.isFinite(refs.originalDueAt)&&localTimeValue(refs.originalDueAt)===(when.field.value.length===16?when.field.value+':00':when.field.value);const dueAt=unchanged?refs.originalDueAt:followupTime(when.field.value);if(dueAt<=Date.now())throw Error(tr('请选择未来的有效时间。','Choose a valid future time.'));await edit({action:editing?'followup-edit':'followup-add',...(editing?{id:editing,...(Number.isInteger(editingRevision)?{revision:editingRevision}:{})}:{}),text:topic.field.value,dueAt,timeZone:zone});editing=null;editingRevision=null;refs.originalDueAt=null;topic.field.value='';when.field.value='';},'primary',()=>tr('回访约定已保存。','Follow-up scheduled.'));refs.body.append(refs.save,text('p',tr('需保持 QQ 陪伴连接，并开启“主动找我聊天”。回访遵守联系时段与每日限额；暂停主动活动也会暂停回访。','Keep QQ companion mode connected and proactive messages enabled. Follow-ups respect contact hours and daily limits. Pausing proactive activity also pauses follow-ups.'),'social-hint'));
  }
  function buildJournal(){
    refs.body.append(text('p',tr('日记只延续公开人设和已经发布的内容。你的私聊与私人记忆不会交给空间文案生成。','Her journal continues only the public persona and published entries. Private chats and memory are not used to generate posts.'),'relationship-intro'));
    refs.generate=button(tr('让她写一则草稿','Ask her for a draft'),()=>window.arcade.socialDraft(),'secondary',result=>result?.state==='draft'?tr('草稿已保存，尚未发布。','Draft saved. It has not been published.'):tr('未确认生成草稿，请查看记录。','A new draft was not confirmed. Check the journal.'));refs.body.append(refs.generate);
    refs.list=text('div','','relationship-records');refs.body.append(refs.list);
    const {wrap,field}=input(tr('公开日记草稿','Public journal draft'),'journal-text',{max:1000,rows:4});refs.editor=field;refs.save=button(tr('保存草稿','Save draft'),async()=>{await edit({action:editing?'entry-edit':'entry-add',...(editing?{id:editing}:{}),text:field.value});editing=null;field.value='';},'primary',()=>tr('草稿已保存，尚未发布。','Draft saved. It has not been published.'));refs.body.append(wrap,refs.save,text('p',tr('发布按钮会将所选正文发到她的 QQ 空间，指定仅主人可见。接口回执与真实可见范围分开记录；本地删除不会删除已发说说。','Publish sends the selected text to her Qzone for the bound owner. An API receipt is separate from audience verification. Removing a local entry does not delete the external post.'),'social-hint'));
  }
  function buildCard(){
    refs.body.append(text('p',tr('角色卡只描述人设、形象与说话示例。导入不会改变 AI 登录、好友范围或操作权限。','Character cards describe the persona, portrait and speaking examples. Importing does not change AI login, contacts or permissions.'),'relationship-intro'));
    const row=text('div','','relationship-actions');refs.import=button(tr('导入角色卡…','Import character card…'),async({isCurrent})=>{const preview=await window.arcade.characterImport();if(!isCurrent())return null;cardPreview=preview;if(cardPreview){const c=cardPreview.card;refs.cardPreview.textContent=`${c.name}\n\n${c.description}\n\n${c.speechExamples.map(e=>`${tr('你','You')}：${e.user}\n${c.name}：${e.assistant}`).join('\n\n')}`;refs.cardWarnings.textContent=(cardPreview.warnings||[]).join('\n');refs.apply.hidden=false;}return preview;},'secondary',result=>result?tr('角色卡已预览，尚未应用。','Character card previewed. It has not been applied.'):tr('已取消导入。','Import cancelled.'));refs.export=button(tr('导出角色卡…','Export character card…'),()=>window.arcade.characterExport(),'secondary',result=>result?.saved?tr('角色卡已导出。','Character card exported.'):tr('已取消导出。','Export cancelled.'));row.append(refs.import,refs.export);refs.body.append(row);
    refs.cardPreview=text('pre','','relationship-card-preview');refs.cardWarnings=text('p','','social-hint');refs.apply=button(tr('使用这张角色卡','Use this character card'),async({isCurrent})=>{if(!cardPreview)return;const applied=await window.arcade.characterApply(cardPreview.card);if(isCurrent()){const examples=applied?.social?.config?.speechExamples;if(!Array.isArray(examples))throw Error(tr('角色卡已提交，但无法读回说话示例。请重新打开角色卡页面核对。','The card was submitted, but its examples could not be read back. Reopen the character card page to check them.'));refs.drawExamples(examples);cardPreview=null;refs.apply.hidden=true;}},'primary',()=>tr('角色卡已应用，下次连接生效。','Character card applied for the next connection.'));refs.apply.hidden=true;refs.body.append(refs.cardPreview,refs.cardWarnings,refs.apply);
    refs.body.append(text('h2',tr('她会怎么说','How she speaks')));
    const examples=text('div');examples.id='card-examples';refs.examples=examples;
    function addExample(value={user:'',assistant:''}){if(examples.children.length>=6)return;const pair=text('div','','relationship-example');for(const [key,label]of [['user',tr('当你说','When you say')],['assistant',tr('她的回应方式','How she responds')]]){const lab=text('label',label),area=text('textarea');area.dataset.role=key;area.value=value[key];area.maxLength=240;area.rows=3;lab.append(area);pair.append(lab);}const remove=button(tr('移除示例','Remove example'),()=>pair.remove(),'plain');pair.append(remove);examples.append(pair);}
    refs.drawExamples=values=>{examples.replaceChildren();for(const value of values)addExample(value);};
    refs.drawExamples(state.bot?.social?.config.speechExamples||[]);
    const more=button(tr('添加说话示例','Add a speaking example'),()=>addExample(),'plain');
    refs.save=button(tr('保存说话示例','Save speaking examples'),()=>{const speechExamples=[...examples.children].map(pair=>({user:pair.querySelector('[data-role=user]').value,assistant:pair.querySelector('[data-role=assistant]').value}));return window.arcade.socialConfigure({speechExamples});},'primary',()=>tr('说话示例已保存，下次连接生效。','Speaking examples saved for the next connection.'));refs.body.append(examples,more,refs.save,text('p',tr('最多 6 组。断开这位搭档后应用人设改动。角色卡只导入受支持的描述，不执行扩展或远程素材。','Up to six examples. Disconnect this companion before applying persona changes. Only supported descriptions are imported; extensions and remote assets are not executed.'),'social-hint'));
  }
  function renderLists(){
    if(!refs.list)return;const s=state.bot?.social||{},items=tab==='memory'?(localMemory()?state.bot?.local?.memory?.facts||[]:s.facts||[]):tab==='followups'?s.followups||[]:s.entries||[];const next=JSON.stringify(items);if(next===listKey)return;listKey=next;refs.list.replaceChildren();
    if(!items.length)refs.list.append(text('p',tr('这里还没有记录。','No entries yet.'),'relationship-empty'));
    for(const item of items){const row=text('article','','relationship-record');row.append(text('p',item.text,'relationship-record-text'));const when=tab==='followups'?item.dueAt:item.updatedAt||item.at||item.createdAt;const stamp=when?new Date(when).toLocaleString(language==='zh'?'zh-CN':'en',item.timeZone?{timeZone:item.timeZone}:{}):'';
      const states={pending:tr('等待约定时间','Scheduled'),attempting:tr('正在提交','Submitting'),sent:tr('发送接口已接受','Send accepted'),published:tr('发布接口已接受','Publish accepted'),draft:tr('草稿','Draft'),cancelled:tr('已取消','Cancelled'),missed:tr('已错过，未补发','Missed, not replayed'),unknown:tr('结果未确认，不重发','Uncertain, not retried'),failed:tr('未完成','Failed')};
      row.append(text('small',`${stamp}${item.timeZone?' '+item.timeZone:''}${item.state?' · '+(states[item.state]||item.state):' · '+tr(item.sourceIds?.length?'来自你的聊天':'手动记录',item.sourceIds?.length?'From your conversation':'Manually recorded')}`,'social-hint'));
      const actions=text('div','','relationship-actions');const canEdit=tab==='memory'||tab==='journal'&&item.state==='draft'||tab==='followups'&&item.state==='pending';
      if(canEdit)actions.append(button(tr('修改','Edit'),()=>{
        if(tab==='memory')Object.assign(refs.memoryDraft,{text:item.text,id:item.id,revision:item.revision});
        else{editing=item.id;editingRevision=item.revision;}
        refs.editor.value=item.text;if(refs.when){refs.originalDueAt=item.dueAt;refs.when.value=localTimeValue(item.dueAt);}focusEditor=true;
      }));
      if(tab==='memory')actions.append(button(tr('忘记','Forget'),async()=>{if(!window.confirm(localMemory()?tr('忘记这条 App 记忆，并清空此角色的近期 App 对话与自由笔记？QQ 和其他角色的记录保留。','Forget this App memory and clear this character’s recent App conversation and freeform notes? QQ and other characters’ records are kept.'):tr('忘记这条记忆，并清空这段关系的全部近期对话、自由笔记与关联回访？QQ 消息保留。','Forget this memory and clear all recent conversation, freeform notes and linked follow-ups for this relationship? QQ messages are kept.')))return false;await edit({action:'forget',id:item.id,...(Number.isInteger(item.revision)?{revision:item.revision}:{})});return true;},'plain',done=>done?tr('这条记忆已忘记，近期对话与关联记录已清理。','Memory forgotten; recent conversation and related records cleared.'):tr('已保留这条记忆。','Memory kept.')));
      if(tab==='followups'&&item.state==='pending')actions.append(button(tr('取消约定','Cancel follow-up'),()=>edit({action:'followup-cancel',id:item.id}),'plain',()=>tr('回访约定已取消。','Follow-up cancelled.')));
      if(tab==='journal'&&item.state==='draft'){const publish=button(tr('发布到她的空间','Publish to her Qzone'),()=>window.arcade.socialPublish(item.id),'primary',publishFeedback);publish.dataset.publish='true';publish.disabled=!s.active||busy;actions.append(publish);}
      if(tab==='journal')actions.append(button(tr('移除本地记录','Remove local entry'),async()=>{if(!window.confirm(tr('只移除本机日记记录，QQ 空间的帖子保留。继续？','Remove only this local journal entry? The Qzone post is kept.')))return false;await edit({action:'entry-delete',id:item.id});return true;},'plain',done=>done?tr('本地日记记录已移除；QQ 空间帖子未删除。','Local journal entry removed. The Qzone post was not deleted.'):tr('已保留本地记录。','Local entry kept.')));
      row.append(actions);refs.list.append(row);
    }
  }
  function updateControls(){
    if(!refs.notice)return;const s=state.bot?.social||{},local=state.bot?.local?.memory,ready=localMemory()?!!local?.available:!!s.memoryReady,connected=state.bot?.status!=='disconnected';
    if(refs.memoryDraft){
      const label=refs.memoryDraft.id===null?tr('记住这件事','Remember this'):tr('保存更正','Save correction');
      if(refs.save.textContent!==label)refs.save.textContent=label;
      refs.cancelCorrection.hidden=refs.memoryDraft.id===null;refs.cancelCorrection.disabled=!!busy;
    }
    refs.notice.textContent=localMemory()?(ready?'':local?.reason==='busy'?tr('正在更新本地记忆，请稍候。','Local memory is being updated. Please wait.'):local?.reason==='stopping'?tr('正在结束上一段 App 对话，请稍后再试。','The previous App conversation is ending. Try again shortly.'):tr('本地记忆暂时无法读取，请稍后再试；不需要连接 QQ。','Local memory is unavailable. Try again later; no QQ connection is needed.')):ready?(['followups','journal'].includes(tab)?tr('这里仍是 QQ 关系中的记录，不使用 App 记忆。','These are records for the QQ relationship; App memory is not used.'):''):qqBound(state)?tr('先用这位角色连接一次 QQ，确认属于你们的记忆。','Connect this character to QQ once to establish your shared memory.'):'';
    if(refs.save)refs.save.disabled=!!busy||(tab==='card'?connected:!ready);if(refs.generate)refs.generate.disabled=!!busy||!s.active;if(refs.apply)refs.apply.disabled=!!busy||connected;if(refs.import)refs.import.disabled=!!busy;if(refs.export)refs.export.disabled=!!busy;if(localMemory()&&refs.editor)refs.editor.disabled=!!busy||!ready;for(const b of refs.sources?.querySelectorAll('button')||[])b.disabled=!!busy;for(const b of refs.list?.querySelectorAll('button')||[])b.disabled=!!busy||!ready||(b.dataset.publish==='true'&&!s.active);
  }
  window.renderRelationship=next=>{
    state=next;
    const profile=next.accounts?.selectedId||'primary',localScope=memoryScope(next,'local'),channelScope=memoryScope(next,'channel');
    const localChanged=localScope!==localScopeKey;
    if(localChanged){sourceDrafts.clear();localScopeKey=localScope;}
    else for(const key of sourceDrafts.keys())if(key!==localScope&&key!==channelScope)sourceDrafts.delete(key);
    if(profile!==sourceProfile){sourceProfile=profile;memorySource=next.desktopChat?.kind==='local'?'local':'channel';}
    if(!localAvailable(next))memorySource='channel';
    const bound=qqBound(next),rebound=bound!==boundKey;boundKey=bound;
    if(!bound){if(QQ_TABS.includes(tab))tab='memory';if(localAvailable(next))memorySource='local';}
    const lang=next.config?.language==='zh'?'zh':'en',id=viewIdentity(next);
    navText.textContent=lang==='zh'?'相处':'Together';option.textContent=navText.textContent;
    const changedContext=identity!==id||(localChanged&&tab==='memory');
    if(changedContext)busy=false;
    if(changedContext||language!==lang||(rebound&&(!busy||tab==='memory'))||!root.childElementCount){language=lang;build();}
    renderLists();updateControls();
  };
})();
