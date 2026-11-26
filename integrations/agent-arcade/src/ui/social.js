'use strict';
(() => {
  // Keep this panel alive when the connection page refreshes. In particular,
  // receipt polling must not discard a half-written character or memory note.
  const panel = el('details', 'onboarding-extra social-panel');
  panel.id = 'social-panel';
  const contactFields=['proactiveMessages','activeStart','activeEnd','intervalMinutes','maxMessagesPerDay'];
  let latest, appState, language, formScope, savedKey = '', dirty = false, working = null, confirmingForget = false;
  let draftPolicy=null,conflict=false;
  let controls = {}, message = '', refs = {};
  const words = {
    zh: {
      title:'相处方式', subtitle:'让角色延续对话，也有自己的日常。', enabled:'用陪伴模式连接 QQ',
      enabledNote:'这一连接专注聊天，不执行文件或命令。需要派活时，断开后关闭陪伴模式。',
      character:'角色形象', name:'她的名字', description:'公开人设与兴趣（可用于空间文案）', notes:'希望她记住的事 · 私人记忆',
      notesHint:'只用于与你聊天，不用于空间文案。写下你希望保留的偏好、称呼或话题。', notesUnavailable:'先用这位角色连接一次 QQ，确认联系人后，再断开来填写这份私人记忆。',
      proactiveMessages:'让她主动找我聊天', proactiveNote:'私聊只联系你绑定的 QQ 号。单独允许主动消息的群也遵守下方的联系时段和额度。她可以选择不发。',
      qqImageMessages:'看懂我发来的 QQ 图片', qqImageNote:'当前主人私聊的单张 JPG / PNG 会交给所选 AI 看图并以文字回复，按 API 正常计费。支持 Claude API、GPT API 与 DeepSeek Flash；也可明确引用这段私聊中的单张图片，不浏览其他历史。', qqImageUnavailable:'当前接入暂不支持看图，不会上传图片。可选择 Claude API、GPT API 或 DeepSeek Flash。',
      qqVoiceMessages:'听懂我发来的 QQ 语音', qqVoiceNote:'需要本机 Qwen 识别模型。只处理你的私聊语音（最长 30 秒），以文字回复；转写内容会交给所选 AI，不用于发布、授权或修改记忆。默认关闭。',
      qzonePosts:'让她发布 QQ 空间动态', qzoneNote:'文字动态设为仅指定的你可见。真实账号的可见范围仍待验收。',
      timing:'联系时间与频率', activeStart:'开始时间', activeEnd:'结束时间', intervalMinutes:'考虑主动活动的间隔（分钟）',
      maxMessagesPerDay:'每天最多主动聊天次数', maxPostsPerDay:'每天最多空间动态条数', timeNote:'使用这台电脑的本地时间；仅在应用已连接时活动。不补发错过的活动。',
      save:'保存相处方式', saved:'已保存，下次连接生效。', pause:'暂停主动活动', paused:'主动活动已暂停，仍可继续聊天。',
      consider:'现在考虑一次', considerNote:'按已保存的时间与频率限制执行；刚聊过 15 分钟内保持安静，也可能选择不打扰。',
      offline:'保存后，连接 QQ 开始相处。', locked:'连接中可以暂停活动。修改角色或相处方式，请先断开。',
      online:'当前连接可调整主动私聊、联系时段和频率。绑定主人', saveContact:'保存联系设置', contactSaved:'联系设置已保存，当前连接已生效。',
      changedContact:'连接或联系设置已变化。载入当前设置后可继续编辑。', reloadContact:'载入当前联系设置',
      unsupported:'先选择 QQ 和本机 Claude、Claude API、GPT API、DeepSeek、Gemini 或豆包 API。Codex 陪伴模式尚未支持。',
      unavailable:'此版本尚未提供陪伴模式控制。', active:'陪伴中', ready:'已设置', disabled:'未开启', busy:'正在考虑',
      privacy:'记忆与最近活动', privacyNote:'最近 120 条对话和你填写的记忆保存在本机，按角色与联系人分开。生成回复时会交给所选模型；API 用量照常计费。不是无限记忆。',
      memoryEmpty:'连接后，从 QQ 和她说第一句话。', recent:'最近的主动活动', noActions:'还没有主动活动。',
      forget:'清除这位角色的记忆…', forgetConfirm:'清除对话和记忆', forgetNote:'删除本机保存的当前角色与联系人的对话和记忆，并暂停主动活动。QQ 消息与空间动态保留。', cancel:'保留记忆',
      forgotten:'已清除当前记忆并暂停主动活动。', failed:'操作未完成', unsaved:'有未保存的修改', activityDraft:'草稿', activityWait:'选择等待', activitySending:'正在发送', activitySent:'接口已接受', activityUnknown:'发送结果不确定', activityFailed:'未发送',
      you:'你', characterRole:'角色', history:'最近保存的对话', pending:'请稍候…', selectedIndependent:'形象与 AI 登录分开选择；使用项目原创头像。',
      disconnectForget:'断开连接后可清除记忆。', decisionWait:'这次没有主动活动。', decisionCooldown:'距离上次考虑还没到设定的间隔，请稍后再试。', decisionBusy:'正在处理对话，这次不主动打扰。', decisionAccepted:'已提交这次活动，接口回执见下方。', decisionFailed:'这次活动未完成，请查看下方记录。',
      decisionInactive:'请先开启并连接 QQ 陪伴模式。', decisionOffline:'QQ 尚未在线，请确认连接后再试。', decisionRecordFailed:'主动活动记录保存失败。请检查本机存储。',
      decisionDisabled:'请先开启你想用的主动活动，再考虑一次。', decisionHours:'当前不在已保存的联系时段，请在时段内再试。',
      decisionFirstChat:'先用绑定的 QQ 私聊跟她说句话，再等这次对话安静满 15 分钟。',
      decisionRecentChat:'刚聊过，让这次对话安静满 15 分钟后再考虑。',
      decisionMessageLimit:'今天的主动私聊次数已用完，请明天再试。', decisionPostLimit:'今天的 QQ 空间动态额度已用完，请明天再试。',
      decisionMessageZero:'每天最多主动聊天次数设为 0。如需主动私聊，请在联系设置中调大这个上限。',
      decisionPostZero:'每天最多空间动态条数设为 0。如需发布，请断开连接后调大这个上限。',
      decisionWaitingReply:'上次主动私聊后还没收到你的回复。用绑定的 QQ 回复后，再等对话安静满 15 分钟。',
      decisionStaleChat:'上次收到你的私聊已超过 7 天。先用绑定的 QQ 聊一句，再等对话安静满 15 分钟。'
    },
    en: {
      title:'Companion', subtitle:'A continuing conversation, with a daily life of her own.', enabled:'Use companion mode on QQ',
      enabledNote:'This connection is for conversation, without file or command actions. Disconnect and turn this off to dispatch work.',
      character:'Character portrait', name:'Her name', description:'Public persona and interests (may appear in posts)', notes:'Things to remember · private',
      notesHint:'Used only in your conversation, not for posts. Add preferences, names or topics you want to keep.', notesUnavailable:'Connect this character to QQ once to verify the contact, then disconnect to add private memory notes.',
      proactiveMessages:'Let her start conversations', proactiveNote:'Private chat only contacts your bound QQ account. Groups with proactive messages enabled also follow the hours and limits below. She may choose to stay quiet.',
      qqImageMessages:'Understand my QQ pictures', qqImageNote:'A single current JPG / PNG from your private chat goes to the selected AI for a text reply, with normal API usage. Supports Claude API, GPT API and DeepSeek Flash, including one explicitly quoted picture in this private chat; other history is not browsed.', qqImageUnavailable:'The current connection does not support pictures; no image is uploaded. Choose Claude API, GPT API or DeepSeek Flash.',
      qqVoiceMessages:'Understand my QQ voice messages', qqVoiceNote:'Requires a configured local Qwen model. Your private voice messages (up to 30 seconds) receive text replies. Transcripts go to the selected AI, without triggering posts, approvals or memory commands. Off by default.',
      qzonePosts:'Let her publish Qzone posts', qzoneNote:'Text posts target only your bound account. Visibility still needs real-account acceptance.',
      timing:'Hours and frequency', activeStart:'From', activeEnd:'Until', intervalMinutes:'Consider activity every (minutes)',
      maxMessagesPerDay:'Maximum conversations started per day', maxPostsPerDay:'Maximum Qzone posts per day', timeNote:'Uses this computer’s local time, while connected. Missed activity is not replayed.',
      save:'Save companion settings', saved:'Saved for the next connection.', pause:'Pause proactive activity', paused:'Proactive activity paused. Conversation can continue.',
      consider:'Consider activity now', considerNote:'Respects saved hours and limits, including 15 quiet minutes after conversation. She may choose not to interrupt.',
      offline:'Save, then connect QQ to start.', locked:'You can pause activity while connected. Disconnect to edit the character or settings.',
      online:'You can change proactive chat, contact hours and frequency while connected. Bound owner', saveContact:'Save contact settings', contactSaved:'Contact settings saved for the current connection.',
      changedContact:'The connection or contact settings changed. Reload the current settings to continue editing.', reloadContact:'Reload current contact settings',
      unsupported:'Select QQ with local Claude, Claude API, GPT API, DeepSeek, Gemini or Doubao API. Codex companion mode is not supported yet.',
      unavailable:'Companion controls are unavailable in this build.', active:'Together', ready:'Configured', disabled:'Off', busy:'Considering',
      privacy:'Memory and recent activity', privacyNote:'The last 120 messages and your memory notes stay on this device, separated by character and contact. They are sent to your selected model for replies; API usage is billed normally. Memory is not unlimited.',
      memoryEmpty:'Connect, then say hello to her on QQ.', recent:'Recent proactive activity', noActions:'No proactive activity yet.',
      forget:'Clear this character’s memory…', forgetConfirm:'Clear conversation and memory', forgetNote:'Deletes this character/contact’s locally saved conversation and notes, and pauses proactive activity. QQ messages and Qzone posts are kept.', cancel:'Keep memory',
      forgotten:'Current memory cleared and proactive activity paused.', failed:'Action did not finish', unsaved:'Unsaved changes', activityDraft:'Draft', activityWait:'Chose to wait', activitySending:'Sending', activitySent:'Accepted by bridge', activityUnknown:'Delivery uncertain', activityFailed:'Not sent',
      you:'You', characterRole:'Character', history:'Recently saved conversation', pending:'Please wait…', selectedIndependent:'Choose a character separately from the AI login. All portraits are project originals.',
      disconnectForget:'Disconnect before clearing memory.', decisionWait:'No proactive activity this time.', decisionCooldown:'Wait until the configured interval after the last check has elapsed.', decisionBusy:'A conversation is in progress. No proactive interruption.', decisionAccepted:'Activity submitted. See the bridge receipt below.', decisionFailed:'This activity did not finish. See the record below.',
      decisionInactive:'Enable and connect QQ companion mode first.', decisionOffline:'QQ is offline. Check the connection and try again.', decisionRecordFailed:'The activity record could not be saved. Check local storage.',
      decisionDisabled:'Turn on the proactive activities you want to use, then try again.', decisionHours:'It is outside your saved contact hours. Try again during those hours.',
      decisionFirstChat:'Send her a private message from your linked QQ account, then let the conversation rest for 15 minutes.',
      decisionRecentChat:'You just chatted. Let the conversation rest for 15 minutes before trying again.',
      decisionMessageLimit:'Today’s limit for proactive private messages is reached. Try again tomorrow.', decisionPostLimit:'Today’s limit for Qzone posts is reached. Try again tomorrow.',
      decisionMessageZero:'The daily limit for proactive private messages is set to 0. To allow them, raise the limit in contact settings.',
      decisionPostZero:'The daily limit for Qzone posts is set to 0. To allow posting, disconnect before raising the limit.',
      decisionWaitingReply:'She is still waiting for a reply to her last message. Reply from your linked QQ account, then leave 15 quiet minutes.',
      decisionStaleChat:'Your last private message was over seven days ago. Send a new message from your linked QQ account, then leave 15 quiet minutes.'
    }
  };
  const defaults = {enabled:false,characterId:'claude-ju',name:'橘',description:'',notes:'',proactiveMessages:false,qzonePosts:false,qqVoiceMessages:false,qqImageMessages:true,activeStart:9,activeEnd:22,intervalMinutes:180,maxMessagesPerDay:2,maxPostsPerDay:1};
  const tr = key => words[language || 'en'][key] || key;
  const setStatus = value => {message = value; if(refs.message) refs.message.textContent = message;};
  const add = (tag, cls, text) => el(tag, cls, text);
  const offline=bot=>!bot?.status||bot.status==='disconnected';
  function livePolicy(){
    const id=latest?.social?.contactPolicyId;
    return latest?.status==='connected'&&latest.channel==='qq'&&latest.qq?.ownerId&&appState?.accounts?.selectedId&&
      typeof window.arcade.socialContactConfigure==='function'&&typeof id==='string'&&id.length?id:null;
  }
  function scopeOf(bot,full){
    const profile=full?.accounts?.accounts?.find(row=>row.id===full.accounts.selectedId);
    return JSON.stringify([full?.accounts?.selectedId,bot?.channel,bot?.mode,profile?.accountId||bot?.qq?.expectedAccountId,bot?.qq?.ownerId,bot?.social?.config?.characterId,offline(bot)]);
  }
  function resetDraft(){dirty=false;draftPolicy=null;conflict=false;savedKey='';}
  function markDirty(){
    if(!dirty)draftPolicy=livePolicy();
    dirty=true;setStatus(tr('unsaved'));updateSave();
  }
  function updateSave(){
    const policy=livePolicy(),stale=dirty&&draftPolicy&&(conflict||draftPolicy!==policy);
    refs.save.disabled=!!working||(!offline(latest)&&(!policy||!dirty||!!stale));
    refs.save.textContent=tr(policy?'saveContact':'save');
    refs.reload.hidden=!stale;refs.reload.disabled=!!working;
    if(stale&&!working)setStatus(tr('changedContact'));
  }
  function field(name, type, parent, {maxLength, min, max} = {}) {
    const wrap=add('div','social-field'), label=add('label','',tr(name));label.htmlFor=`social-${name}`;
    const input=add(type==='textarea'?'textarea':'input','');input.id=label.htmlFor;
    if(type!=='textarea')input.type=type;
    if(maxLength)input.maxLength=maxLength;
    if(min!==undefined)input.min=String(min);if(max!==undefined)input.max=String(max);
    if(type==='number')input.step='1';
    if(type==='textarea')input.rows=name==='description'?3:3;
    input.oninput=markDirty;
    controls[name]=input;wrap.append(label,input);parent.append(wrap);return input;
  }
  function toggle(name, note, parent) {
    const row=add('div','social-toggle-row'), label=add('label','social-toggle'), input=add('input','');input.type='checkbox';input.id=`social-${name}`;input.onchange=markDirty;
    label.append(input,add('span','',tr(name)));row.append(label,add('p','social-hint',tr(note)));parent.append(row);controls[name]=input;return row;
  }
  function build() {
    const wasOpen=panel.open;panel.replaceChildren();controls={};refs={};
    const summary=add('summary','social-summary');summary.append(add('span','',tr('title')));refs.state=add('span','social-state');summary.append(refs.state);panel.append(summary);
    const body=add('div','social-body');body.append(add('p','social-intro',tr('subtitle')));
    refs.notice=add('p','social-notice');body.append(refs.notice);
    const form=add('form','social-form');form.onsubmit=event=>{
      event.preventDefault();if(refs.fields.disabled||refs.save.disabled)return;
      if(offline(latest)){void invoke('socialConfigure',readFields(),tr('saved'));return;}
      if(draftPolicy&&draftPolicy===livePolicy())
        void invoke('socialContactConfigure',{profileId:appState.accounts.selectedId,policyId:draftPolicy,settings:readFields(contactFields)},tr('contactSaved'));
    };
    refs.fields=add('fieldset','social-fields');const legend=add('legend','sr-only',tr('title'));refs.fields.append(legend);
    toggle('enabled','enabledNote',refs.fields);refs.imageNote=toggle('qqImageMessages','qqImageNote',refs.fields).querySelector('p');toggle('qqVoiceMessages','qqVoiceNote',refs.fields);
    const identity=add('div','social-identity');refs.avatar=add('img','social-avatar');refs.avatar.alt='';identity.append(refs.avatar);
    const identityFields=add('div','social-identity-fields');
    const choiceWrap=add('div','social-field'),choiceLabel=add('label','',tr('character')),select=add('select','');select.id='social-characterId';choiceLabel.htmlFor=select.id;
    const personas=appState?.personas||[];
    for(const persona of personas){const item=add('option','',persona.name[language]||persona.name.en);item.value=persona.id;select.append(item);}
    if(!personas.length){const fallback=add('option','','橘 / Ju');fallback.value='claude-ju';select.append(fallback);}
    select.onchange=()=>{const persona=personas.find(p=>p.id===select.value);if(persona){controls.name.value=persona.name[language]||persona.name.en;controls.description.value=persona.description[language]||persona.description.en;}controls.notes.value='';controls.proactiveMessages.checked=false;controls.qzonePosts.checked=false;updateAvatar();dirty=true;setStatus(tr('unsaved'));renderControls();};
    controls.characterId=select;choiceWrap.append(choiceLabel,select);identityFields.append(choiceWrap);field('name','text',identityFields,{maxLength:40});identity.append(identityFields);refs.fields.append(identity,add('p','social-hint',tr('selectedIndependent')));
    field('description','textarea',refs.fields,{maxLength:800});field('notes','textarea',refs.fields,{maxLength:1000});refs.notesHint=add('p','social-hint',tr('notesHint'));refs.fields.append(refs.notesHint);
    const activities=add('div','social-activities');toggle('proactiveMessages','proactiveNote',activities);toggle('qzonePosts','qzoneNote',activities);refs.fields.append(activities);
    const hours=add('details','social-hours');hours.append(add('summary','',tr('timing')));const grid=add('div','social-limit-grid');
    field('activeStart','number',grid,{min:0,max:23});field('activeEnd','number',grid,{min:0,max:24});field('intervalMinutes','number',grid,{min:30,max:1440});field('maxMessagesPerDay','number',grid,{min:0,max:10});field('maxPostsPerDay','number',grid,{min:0,max:3});hours.append(grid,add('p','social-hint',tr('timeNote')));refs.fields.append(hours);
    refs.save=add('button','primary',tr('save'));refs.save.type='submit';refs.save.id='social-save';
    refs.reload=add('button','secondary',tr('reloadContact'));refs.reload.type='button';refs.reload.id='social-contact-reload';refs.reload.onclick=reloadContact;
    refs.fields.append(refs.save,refs.reload);form.append(refs.fields);body.append(form);
    const live=add('div','social-live-actions');refs.pause=add('button','secondary',tr('pause'));refs.pause.id='social-pause';refs.pause.onclick=()=>void invoke('socialPause',undefined,tr('paused'));
    refs.consider=add('button','plain',tr('consider'));refs.consider.id='social-consider';refs.consider.onclick=()=>void invoke('socialConsider');live.append(refs.pause,refs.consider);body.append(live,add('p','social-hint',tr('considerNote')));
    refs.message=add('p','social-operation');refs.message.id='social-operation';refs.message.setAttribute('role','status');refs.message.setAttribute('aria-live','polite');body.append(refs.message);
    const memory=add('details','social-memory');memory.append(add('summary','',tr('privacy')),add('p','social-hint',tr('privacyNote')));memory.append(add('h3','',tr('history')));refs.history=add('ol','social-history');memory.append(refs.history,add('h3','',tr('recent')));refs.actions=add('ol','social-action-list');memory.append(refs.actions);
    refs.forget=add('button','plain social-forget',tr('forget'));refs.forget.id='social-forget';refs.forget.onclick=()=>{confirmingForget=true;renderControls();};
    refs.forgetBox=add('div','social-forget-confirm');refs.forgetBox.append(add('p','',tr('forgetNote')));const forgetYes=add('button','secondary',tr('forgetConfirm'));forgetYes.id='social-forget-confirm';forgetYes.onclick=()=>void invoke('socialForget',undefined,tr('forgotten'));const forgetNo=add('button','plain',tr('cancel'));forgetNo.onclick=()=>{confirmingForget=false;renderControls();refs.forget.focus();};refs.forgetBox.append(forgetYes,forgetNo);memory.append(refs.forget,refs.forgetBox);body.append(memory);panel.append(body);panel.open=wasOpen;
  }
  function updateAvatar(){const persona=appState?.personas?.find(p=>p.id===controls.characterId.value);refs.avatar.src=persona?.portrait||'portraits/claude-ju-anime-v2.png';}
  function writeFields(config){for(const [key,input]of Object.entries(controls)){if(input.type==='checkbox')input.checked=config[key]===true;else input.value=config[key]??defaults[key];}updateAvatar();}
  function readFields(keys=Object.keys(controls),raw=false){const config={};for(const key of keys){const input=controls[key];config[key]=input.type==='checkbox'?input.checked:input.type==='number'&&!raw?Number(input.value):input.value;}return config;}
  async function reloadContact(){
    if(working||!draftPolicy)return;
    const op=working={};renderControls();
    try{
      const full=await window.arcade.snapshot();
      if(working!==op||scopeOf(full.bot,full)!==formScope)return;
      resetDraft();setStatus('');window.renderSocial(full.bot,full);
      const ownerScope=formScope;
      requestAnimationFrame(()=>{if(formScope===ownerScope&&livePolicy())controls.proactiveMessages.focus({preventScroll:true});});
    }catch(error){if(working===op)setStatus(`${tr('failed')}：${error.message}`);}
    finally{if(working===op){working=null;renderControls();}}
  }
  function renderControls(){
    const social=latest?.social||{}, connected=!offline(latest),policy=livePolicy();
    const supported=latest?.channel==='qq'&&social.supported===true&&['claude','api','gpt','deepseek','gemini','doubao'].includes(latest?.mode),available=!!window.arcade.socialConfigure;
    refs.fields.disabled=!!working||!supported||(!available&&!policy)||(connected&&!policy);
    for(const [key,input] of Object.entries(controls)){
      input.disabled=!!policy&&!contactFields.includes(key);
      if(input.type==='number')input.required=!!policy&&contactFields.includes(key);
    }
    updateSave();
    const memoryReady=social.memoryReady===true&&controls.characterId.value===social.config?.characterId;
    controls.notes.disabled=!!policy||!memoryReady;refs.notesHint.textContent=tr(memoryReady?'notesHint':'notesUnavailable');
    refs.imageNote.textContent=tr(social.imageInput?.supported===false?'qqImageUnavailable':'qqImageNote');
    refs.state.textContent=social.busy?tr('busy'):social.active?tr('active'):social.config?.enabled?tr('ready'):tr('disabled');
    refs.state.dataset.active=String(!!social.active);
    refs.notice.textContent=policy?tr('online')+' · QQ '+latest.qq.ownerId:!available?tr('unavailable'):!supported?tr('unsupported'):connected?tr('locked'):tr('offline');
    refs.pause.disabled=working||!available||!(social.config?.proactiveMessages||social.config?.qzonePosts||social.busy);
    refs.consider.disabled=working||!window.arcade.socialConsider||!social.active||!!social.busy;
    refs.forget.disabled=working||connected||!window.arcade.socialForget;refs.forget.title=connected?tr('disconnectForget'):'';
    refs.forget.hidden=confirmingForget;refs.forgetBox.hidden=!confirmingForget;
    refs.forgetBox.querySelectorAll('button').forEach(button=>button.disabled=working||connected);
    refs.message.textContent=working?tr('pending'):message||social.problem||'';
    refs.history.replaceChildren();const history=(social.history||[]).slice(-6);
    if(!history.length)refs.history.append(add('li','social-empty',tr('memoryEmpty')));
    for(const entry of history){const item=add('li',''),who=add('strong','',entry.role==='user'?tr('you'):social.config?.name||tr('characterRole'));item.append(who,add('p','',String(entry.text||'').slice(0,1000)));refs.history.append(item);}
    refs.actions.replaceChildren();const actions=[...(social.actions||[])].sort((a,b)=>(b.at||0)-(a.at||0)).slice(0,6);
    if(!actions.length)refs.actions.append(add('li','social-empty',tr('noActions')));
    const states={draft:'activityDraft',planned:'activityDraft',wait:'activityWait',waiting:'activityWait',attempting:'activitySending',sending:'activitySending',accepted:'activitySent',sent:'activitySent',published:'activitySent',unknown:'activityUnknown',failed:'activityFailed',cancelled:'activityFailed',skipped:'activityWait'};
    for(const entry of actions){const item=add('li',''),meta=add('div','social-action-meta');meta.append(add('strong','',tr(states[entry.state]||'activityUnknown')));if(entry.at){const time=add('time','',new Date(entry.at).toLocaleString(language==='zh'?'zh-CN':'en'));time.dateTime=new Date(entry.at).toISOString();meta.append(time);}item.append(meta,add('p','',String(entry.text||entry.reason||'').slice(0,1000)));refs.actions.append(item);}
  }
  async function invoke(method,value,success=''){
    if(working||!window.arcade[method])return;
    const op=working={};message='';renderControls();
    try{const result=await window.arcade[method](value);
      if(working!==op)return;
      // A successful save may normalize settings (for example, pausing activity
      // after a character change). Render that saved state rather than the draft.
      if(method==='socialConfigure'||method==='socialContactConfigure')resetDraft();
      if(method==='socialContactConfigure'&&livePolicy()!==value.policyId&&livePolicy()!==result?.social?.contactPolicyId)window.renderSocial(latest,appState);
      else if(result?.bot)window.renderSocial(result.bot,result);else if(result?.social)window.renderSocial(result,appState);if(method==='socialForget')confirmingForget=false;
      const decision=result?.socialDecision;
      if(method==='socialConsider'&&decision){
        const saved=result.social?.config;
        const messageLimit=saved?.maxMessagesPerDay===0?'decisionMessageZero':'decisionMessageLimit';
        const postLimit=saved?.maxPostsPerDay===0?'decisionPostZero':'decisionPostLimit';
        const reason={busy:'decisionBusy',cooldown:'decisionCooldown',failed:'decisionFailed',
          inactive:'decisionInactive',offline:'decisionOffline',activity_record_failed:'decisionRecordFailed',
          activities_disabled:'decisionDisabled',outside_hours:'decisionHours',first_owner_message:'decisionFirstChat',
          recent_chat:'decisionRecentChat',message_daily_limit:messageLimit,post_daily_limit:postLimit,
          waiting_for_owner_reply:'decisionWaitingReply',owner_chat_stale:'decisionStaleChat'}[decision.reason];
        success=tr(reason||(decision.accepted?'decisionAccepted':'decisionWait'));
        if(decision.alsoPostLimited)success+=' '+tr(postLimit);
      }
      setStatus(success);}
    catch(error){
      if(working===op){
        if(method==='socialContactConfigure'&&(error.code==='changed'||/已变化|已切换|changed|stale/i.test(error.message)))conflict=true;
        setStatus(`${tr('failed')}：${error.message}`);
      }
    }
    finally{if(working===op){working=null;renderControls();}}
  }
  window.renderSocial=(bot,full)=>{
    const scope=scopeOf(bot,full||appState);
    if(scope!==formScope){formScope=scope;resetDraft();message='';confirmingForget=false;working=null;}
    latest=bot||{};if(full)appState=full;const nextLanguage=appState?.config?.language==='zh'?'zh':'en';
    const config={...defaults,...latest.social?.config};const key=JSON.stringify(config);
    const draft=dirty&&language?readFields(Object.keys(controls),true):null;
    if(language!==nextLanguage||!panel.childElementCount){language=nextLanguage;build();writeFields(draft||config);}
    else if(!dirty&&savedKey!==key)writeFields(config);
    savedKey=key;renderControls();
    const parent=$('connections-content');if(parent&&!panel.isConnected)parent.insertBefore(panel,$('onboarding-appearance')||null);
  };
  const original=window.renderConnections;
  window.renderConnections=next=>{original?.(next);window.renderSocial(next.bot,next);};
  if(data)window.renderSocial(data.bot,data);
})();
