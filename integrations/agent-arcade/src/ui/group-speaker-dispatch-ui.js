'use strict';
(() => {
  const api=window.arcade,panel=$('bot-qq-group-speaker-dispatch');
  if(!panel||typeof api?.groupSpeakerDispatch!=='function')return;
  const field=name=>$('bot-qq-group-speaker-dispatch-'+name);
  const endpoint=field('endpoint'),model=field('model'),slot=field('slot');
  const save=field('save'),toggle=field('toggle'),refresh=field('refresh');
  const slots=[
    ['', '不带密钥（仅本机或自建端点）','No key (local or self-hosted endpoint)'],
    ['key','用应用里已保存的 Anthropic 密钥','The Anthropic key saved in the app'],
    ['openaiKey','用应用里已保存的 OpenAI 密钥','The OpenAI key saved in the app'],
    ['deepseekKey','用应用里已保存的 DeepSeek 密钥','The DeepSeek key saved in the app'],
    ['geminiKey','用应用里已保存的 Gemini 密钥','The Gemini key saved in the app'],
    ['doubaoKey','用应用里已保存的豆包密钥','The Doubao key saved in the app'],
  ];
  const hosts={key:'api.anthropic.com',openaiKey:'api.openai.com',deepseekKey:'api.deepseek.com',
    geminiKey:'generativelanguage.googleapis.com',doubaoKey:'ark.cn-beijing.volces.com'};
  const words={
    title:['多搭档接话调度（可选）','Choose among willing companions (optional)'],
    intro:['每位搭档仍先判断自己是否适合接话。多位愿意回复时，调度模型选择一位；原生 @ 单独指向一位时优先她。调度不可用时，也只让一位愿意回复的搭档回应。此设置独立于 App 内群聊。',
      'Each companion first decides whether to reply. When several are willing, the dispatcher selects one; a unique native @ takes priority. If dispatch is unavailable, one willing companion may still reply. This is separate from App group chats.'],
    disclosure:['评分只会把本次回复所对应的最新一条合格公开群文字和公开角色名发送到此端点，API 调用可能计费。',
      'Scoring sends only the latest eligible public group text associated with this reply and public role names to this endpoint. API calls may cost money.'],
    endpoint:['端点地址（兼容 OpenAI 聊天接口）','Endpoint address (OpenAI-compatible chat API)'],
    model:['小模型名称','Small model name'],slot:['使用此搭档已保存的密钥','Use this companion’s saved key'],
    slotLocal:['不带密钥时，仅使用你控制的本机或自建端点；不会读取其他搭档的凭据。','Without a key, use a local or self-hosted endpoint you control. Other companions’ credentials are never used.'],
    slotHost:['已保存的密钥只发送到该服务自己的地址：','A saved key is sent only to its provider’s own host: '],
    save:['保存调度模型','Save dispatcher'],enable:['启用本群调度','Enable for this group'],disable:['停用本群调度','Disable for this group'],refresh:['重新读取','Reload'],
    off:['本群调度已关闭。','Dispatch is off for this group.'],on:['本群调度已启用。修改前请先停用。','Dispatch is enabled. Disable it before editing.'],
    empty:['尚未配置。填写并保存模型，再启用。','Not configured. Save a model, then enable it.'],
    review:['请核对并重新保存设置，再启用。','Review and save the settings before enabling.'],ready:['已保存，可以启用。','Saved. You can now enable it.'],
    readOnly:['另一位搭档正在管理本群的已启用调度。请切换到该搭档停用后再修改。','Another companion owns the enabled dispatcher. Switch to that companion and disable it before changing this setup.'],
    owner:['配置搭档：','Configuration companion: '],unknownOwner:['默认设置或尚未指定搭档','Default or no companion assigned'],
    loading:['正在读取调度设置…','Reading dispatcher settings…'],saving:['正在保存…','Saving…'],enabling:['正在启用…','Enabling…'],disabling:['正在停用…','Disabling…'],
    saved:['调度模型已保存。点击“启用本群调度”后生效。','Dispatcher saved. Choose Enable for this group to apply it.'],enabled:['已启用本群调度。','Dispatch enabled for this group.'],disabled:['本群调度已停用，保存的配置保留。','Dispatch disabled; the saved configuration is retained.'],
    draft:['有未保存的修改。先保存，再启用。','You have unsaved changes. Save before enabling.'],
    invalid:['填写有效端点和模型名。带密钥时，端点必须使用该服务自己的 HTTPS 地址。','Enter a valid endpoint and model name. With a saved key, use that provider’s own HTTPS host.'],
    stale:['搭档、群或设置已变化。本次操作未确认，请重新读取。','The companion, group or settings changed. This action is unconfirmed; reload before trying again.'],
    busy:['调度正在处理另一项操作，请稍后重新读取。','Another dispatcher operation is in progress. Reload shortly.'],
    unavailable:['暂时无法读取或保存调度，请重新读取后再试。','Dispatcher settings are unavailable. Reload and try again.'],
    notReady:['请先核对并保存调度设置。','Review and save the dispatcher settings first.'],
    keyMissing:['当前搭档没有保存所选服务的密钥。先保存密钥，或选择其他来源。','This companion has no saved key for the selected provider. Save one or choose another source.'],
  };
  const errors={group_dispatch_invalid:'invalid',group_dispatch_changed:'stale',credential_scope_changed:'stale',
    group_dispatch_busy:'busy',group_dispatch_unavailable:'unavailable',group_dispatch_not_ready:'notReady',
    group_dispatch_read_only:'readOnly',group_dispatch_configure_failed:'unavailable',
    key_missing:'keyMissing'};
  const actions={view:'loading',configure:'saving',enable:'enabling',disable:'disabling'};
  let context=null,contextKey,view=null,locale='en';
  const tr=key=>words[key]?.[locale==='zh'?0:1]||'';
  const available=()=>context&&!context.roleUpdating&&['connected','disconnected'].includes(context.status);
  const draft=()=>({endpoint:endpoint.value.trim(),model:model.value.trim(),keySlot:slot.value||null});
  const dirty=()=>!!view?.data&&JSON.stringify(draft())!==JSON.stringify({endpoint:view.data.endpoint,model:view.data.model,keySlot:view.data.keySlot});
  function fill(value={endpoint:'',model:'',keySlot:null}){endpoint.value=value.endpoint;model.value=value.model;slot.value=value.keySlot||'';}
  function valid(value){
    return value?.ok===true&&Number.isSafeInteger(value.revision)&&value.revision>=0&&
      ['editable','enabled','configured','ready'].every(key=>typeof value[key]==='boolean')&&
      (value.ownerName===null||typeof value.ownerName==='string'&&value.ownerName.length<=120&&!/[\p{Cc}\p{Cf}]/u.test(value.ownerName))&&
      typeof value.endpoint==='string'&&value.endpoint.length<=2048&&typeof value.model==='string'&&value.model.length<=200&&
      (value.keySlot===null||Object.hasOwn(hosts,value.keySlot))&&(value.problem===null||typeof value.problem==='string');
  }
  function paint(){
    panel.hidden=!context;
    for(const node of panel.querySelectorAll('[data-group-speaker]'))node.textContent=tr(node.dataset.groupSpeaker);
    const selected=slot.value;
    slot.replaceChildren(...slots.map(([value,zh,en])=>{const option=el('option','',locale==='zh'?zh:en);option.value=value;return option;}));slot.value=selected;
    field('scope').textContent=context?(locale==='zh'?`搭档 QQ ${context.scope.expectedAccountId} · 群 ${context.scope.groupId}`:`Companion QQ ${context.scope.expectedAccountId} · group ${context.scope.groupId}`):'';
    const data=view?.data,pending=view?.operation;
    const locked=!available()||!!pending,editingLocked=locked||!data?.editable||data.enabled;
    field('controls').hidden=!data;
    refresh.disabled=locked;
    for(const input of [endpoint,model,slot])input.disabled=editingLocked;
    const needsConfirmation=data?.configured&&!data.ready&&!data.problem;
    save.disabled=editingLocked||(!dirty()&&!needsConfirmation);
    toggle.textContent=tr(data?.enabled?'disable':'enable');
    toggle.disabled=locked||!data?.editable||!data.enabled&&(!data.ready||dirty());
    field('slot-hint').textContent=slot.value?tr('slotHost')+hosts[slot.value]:tr('slotLocal');
    field('owner').textContent=data?tr('owner')+(data.ownerName||tr('unknownOwner')):'';
    field('saved').textContent=data?(data.enabled?tr('on'):[tr('off'),tr(!data.configured?'empty':data.ready?'ready':'review')].join(' ')):'';
    field('read-only').hidden=!data||data.editable;field('read-only').textContent=tr('readOnly');
    const notice=pending?actions[pending.action]:view?.notice||(!data?'':dirty()?'draft':data.problem?errors[data.problem]||'unavailable':'');
    field('status').textContent=tr(notice);
  }
  async function request(action){
    const from=view,data=from?.data;
    if(!panel.open||!available()||!from||from.operation||action!=='view'&&(!data||!data.editable)||
      action==='configure'&&data.enabled||action==='enable'&&dirty()||
      action==='enable'&&(!data.ready||data.enabled)||action==='disable'&&!data.enabled)return;
    let patch={};
    if(action==='configure'){
      patch=draft();let url;
      try{url=new URL(patch.endpoint);}catch{}
      const local=url&&['127.0.0.1','localhost','[::1]'].includes(url.hostname);
      if(!url||url.username||url.password||url.hash||!(url.protocol==='https:'||url.protocol==='http:'&&local&&!patch.keySlot)||
        patch.keySlot&&url.hostname!==hosts[patch.keySlot]||!patch.model||/[\p{Cc}\p{Cf}]/u.test(patch.model)){
        from.notice='invalid';paint();return;
      }
    }
    const scope=context.scope,op={action};from.operation=op;from.notice='';paint();
    const current=()=>panel.open&&view===from&&from.operation===op;
    try{
      const result=await api.groupSpeakerDispatch({...scope,action,...(action==='view'?{}:{revision:data.revision}),...patch});
      if(!current())return;
      if(result?.ok!==true){
        const code=result?.code;from.notice=errors[code]||'unavailable';
        if(['group_dispatch_changed','credential_scope_changed'].includes(code)){from.data=null;fill();}
        if(code==='group_dispatch_read_only'&&from.data)from.data={...from.data,editable:false};
        if(code==='group_dispatch_not_ready'&&from.data)from.data={...from.data,ready:false};
        return;
      }
      if(!valid(result)||data&&result.revision<data.revision)throw Error('Invalid dispatcher snapshot');
      from.data=result;fill(result);
      from.notice=action==='configure'?'saved':
        action==='enable'?'enabled':action==='disable'?'disabled':'';
    }catch{if(current()){from.notice='unavailable';from.data=null;fill();}}
    finally{if(current()){from.operation=null;paint();}}
  }
  function render(next,language){
    locale=language==='zh'?'zh':'en';
    const scope=next&&Object.fromEntries(['profileId','expectedMode','expectedChannel','expectedAccountId','groupId'].map(key=>[key,next[key]]));
    const nextContext=next&&scope.expectedChannel==='qq'?{scope,status:next.status,roleUpdating:next.roleUpdating===true}:null;
    const key=JSON.stringify(nextContext);
    if(key!==contextKey){contextKey=key;context=nextContext;view=context&&panel.open?{}:null;fill();paint();if(view&&available())void request('view');}
    else paint();
  }
  for(const input of [endpoint,model,slot])input.addEventListener('input',()=>{if(view)view.notice='';paint();});
  slot.addEventListener('change',()=>{if(view)view.notice='';paint();});
  save.onclick=()=>void request('configure');refresh.onclick=()=>void request('view');
  toggle.onclick=()=>void request(view?.data?.enabled?'disable':'enable');
  panel.addEventListener('toggle',()=>{view=context&&panel.open?{}:null;fill();paint();if(view&&available())void request('view');});
  window.ArcadeGroupSpeakerDispatch={render};
})();
