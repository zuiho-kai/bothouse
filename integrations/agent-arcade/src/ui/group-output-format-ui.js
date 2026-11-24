'use strict';
(() => {
  const api = window.arcade;
  if (typeof api?.groupOutputFormat !== 'function') return;

  const panel = $('bot-qq-group-output-format'), field = name => $('bot-qq-group-output-format-'+name);
  const choice = field('choice'), review = field('review'), approve = field('approve');
  const toggle = field('toggle'), refresh = field('refresh'), status = field('status');
  const words = {
    title: ['群回复格式','Group reply format'],
    intro: ['规则只调整本群当前角色发送的最终 AI 回复。群成员消息、命令和模型提示词各走原有流程。','An approved rule formats this group role’s final outgoing AI replies. Member messages, commands and model prompts stay separate.'],
    copy: ['每个群角色保存自己的副本。之后修改 App 脚本，也需要在这里重新预览并批准才会替换这份副本。','Each group role keeps its own saved copy. Preview and approve again here to apply later edits from the App script library.'],
    refresh: ['重新读取格式设置','Reload format settings'],
    choice: ['App 脚本库中的输出脚本','Output script from the App library'],
    choose: ['请选择输出脚本','Choose an output script'],
    empty: ['没有符合条件的输出脚本。','No eligible output scripts.'],
    review: ['预览脚本','Preview script'],
    preview: ['核对这份脚本','Review the exact script'],
    pattern: ['查找表达式','Find pattern'],
    replacement: ['替换文本','Replacement'],
    emptyReplacement: ['（空，删除匹配文字）','(Empty, removes matches)'],
    trimmed: ['从匹配中移除的字符串','Strings trimmed from matches'],
    substituteRaw: ['查找表达式中的角色变量按原文代入。','Character variables are inserted into the find pattern as written.'],
    substituteEscaped: ['查找表达式中的角色变量会先做正则转义。','Character variables are regex-escaped before insertion into the find pattern.'],
    depths: ['App 深度设置 · 最小 {min} · 最大 {max}','App depth settings · Minimum {min} · Maximum {max}'],
    unset: ['未设置','unset'],
    approve: ['批准并启用','Approve and enable'],
    stored: ['App 保存时使用','App stored-output script'],
    display: ['App 显示时使用','App display-output script'],
    noSaved: ['群回复格式已关闭。','Group reply formatting is off.'],
    active: ['格式已启用 · {n} 个已批准脚本','Formatting on · {n} approved scripts'],
    inactive: ['格式已关闭 · 保留 {n} 个已批准脚本','Formatting off · {n} approved scripts retained'],
    savedList: ['已批准脚本的执行顺序（保存类在前）','Approved scripts in run order (stored before display)'],
    enable: ['启用已批准的脚本','Enable the approved scripts'],
    disable: ['停用群回复格式','Disable group reply formatting'],
    moveUp: ['上移','Move up'],
    moveDown: ['下移','Move down'],
    remove: ['移除副本','Remove copy'],
    addEffect: ['批准会把这一条加入本群此角色的顺序，并启用群回复格式。','Approval adds this script to this group role’s list and enables reply formatting.'],
    refreshEffect: ['批准会更新列表里的同一条脚本，并启用群回复格式。','Approval updates this script in the list and enables reply formatting.'],
    offline: ['请等当前连接或角色设置操作完成。','Wait for the current connection or role settings operation to finish.'],
    needRole: ['请先核对这个群的群角色。','Review the saved role for this group first.'],
    loading: ['正在读取格式设置…','Loading format settings…'],
    reviewing: ['正在读取待批准的脚本…','Loading the script for review…'],
    saving: ['正在保存格式设置…','Saving format settings…'],
    saved: ['已为本群此角色保存并启用批准的副本。','Saved and enabled the approved copy for this group role.'],
    enabled: ['已启用原先批准的脚本。','The previously approved scripts are enabled.'],
    disabled: ['已停用。后续回复会使用未套用这些脚本的文本。','Formatting is off. Future replies will use their text before these scripts.'],
    removed: ['已从本群此角色的顺序中移除该脚本。','Removed the script from this group role’s run order.'],
    removedLast: ['已移除最后一个脚本。群回复格式已关闭。','Removed the last approved script. Group reply formatting is off.'],
    reordered: ['已保存新顺序。后续群回复会按此顺序处理。','Saved the new order for future group replies.'],
    stale: ['本群的格式设置或角色已变化。请重新读取后再操作。','This group’s format settings or role changed. Reload before continuing.'],
    newReview: ['App 脚本已变化或不再可用。请重新读取并预览，再决定是否批准。','The App script changed or is unavailable. Reload and preview it again before approving.'],
    limit: ['已批准的脚本达到 10 个。请先移除一个，或预览并更新列表里的同一条脚本。','Up to 10 scripts can be approved. Remove one before adding another, or review an update to a script already in the list.'],
    failed: ['群回复格式操作未完成。请重新读取后再试。','The group reply format action could not be completed. Reload and try again.'],
  };
  const stages = new Set(['stored','display']);
  const maxScripts=10;
  const badScope = new Set(['credential_scope_changed','group_output_format_changed','group_output_format_not_found','group_output_format_invalid_order']);
  const stalePreview = new Set(['group_output_format_review_required','group_output_format_ineligible','group_output_format_script_changed']);
  const actions = {view:'loading',preview:'reviewing',configure:'saving',remove:'saving',reorder:'saving'};
  const validId = value => typeof value==='string' && /^[a-f0-9]{16}$/.test(value);
  const revision = value => Number.isSafeInteger(value) && value>=0;
  const script = item => validId(item?.id) && typeof item.scriptName==='string' && !!item.scriptName.trim() && item.scriptName.length<=100 && stages.has(item.stage);
  const sameScript = (left,right) => !!left&&!!right&&left.id===right.id&&left.scriptName===right.scriptName&&left.stage===right.stage;
  const sameList = (left,right)=>left.length===right.length&&left.every((item,index)=>sameScript(item,right[index]));
  const canonical = items => {
    const firstDisplay=items.findIndex(item=>item.stage==='display');
    return firstDisplay===-1||items.slice(firstDisplay).every(item=>item.stage==='display');
  };
  const unique = items => new Set(items.map(item=>item.id)).size===items.length;
  const exactScript = item => typeof item?.findRegex==='string' && !!item.findRegex && item.findRegex.length<=1000 &&
    typeof item.replaceString==='string' && item.replaceString.length<=4000;
  const depth = value => value===null || Number.isSafeInteger(value);
  const reviewedOptions = item => Array.isArray(item.trimStrings) && item.trimStrings.length<=20 &&
    item.trimStrings.every(value=>typeof value==='string'&&value.length<=200) &&
    ['none','raw','escaped'].includes(item.substituteRegex) && depth(item.minDepth) && depth(item.maxDepth);
  let context, contextKey, current, locale = 'en';

  const tr = key => words[key]?.[locale==='zh'?0:1] || '';
  const available = () => !!context?.scope.roleId && !context.roleUpdating && ['connected','disconnected'].includes(context.status);
  const previewFor = data => data?.preview?.id===choice.value ? data.preview : null;
  function viewFrom(value,scope){
    if (value?.ok!==true || value.accountId!==scope.expectedAccountId || value.groupId!==scope.groupId || value.roleId!==scope.roleId ||
        !revision(value.revision) || typeof value.enabled!=='boolean' || !Array.isArray(value.scripts) || value.scripts.length>maxScripts ||
        !value.scripts.every(script)||!unique(value.scripts)||!canonical(value.scripts)||
        (value.scripts.length?!sameScript(value.scripts[0],value.script):value.script!==null||value.enabled) ||
        !Array.isArray(value.choices)||!value.choices.every(script)||!unique(value.choices)) return null;
    const {revision:seen,enabled,scripts,choices} = value;
    return {revision:seen,enabled,scripts,choices};
  }
  function line(name,value){
    field(name).textContent = value;
  }
  function fillRules(record){
    line('pattern',record?.findRegex||'');
    line('replacement',record?(record.replaceString||tr('emptyReplacement')):'');
  }
  function fillOptions(record){
    const box = field('options'), items = [];
    if (record?.trimStrings?.length) {
      const list = el('ul');
      for (const value of record.trimStrings) list.append(el('li','',JSON.stringify(value)));
      items.push(el('h4','',tr('trimmed')),list);
    }
    if (record?.substituteRegex==='raw') items.push(el('p','',tr('substituteRaw')));
    if (record?.substituteRegex==='escaped') items.push(el('p','',tr('substituteEscaped')));
    if (record && (record.minDepth!==null || record.maxDepth!==null)) {
      items.push(el('p','',tr('depths').replace('{min}',String(record.minDepth??tr('unset')))
        .replace('{max}',String(record.maxDepth??tr('unset')))));
    }
    box.hidden = !items.length;
    box.replaceChildren(...items);
  }
  function scopeLabel(){
    if (!context) return '';
    return [
      (locale==='zh'?'搭档 QQ ':'Companion QQ ')+context.scope.expectedAccountId,
      (locale==='zh'?'群 ':'Group ')+context.scope.groupId,
      context.roleName,
    ].filter(Boolean).join(' · ');
  }
  function showSaved(data,locked){
    const list=field('list'), items=data.scripts, from=current;
    line('saved',items.length ? tr(data.enabled?'active':'inactive').replace('{n}',String(items.length)) : tr('noSaved'));
    field('list-title').hidden = list.hidden = !items.length;
    list.replaceChildren(...items.map((saved,index)=>{
      const row=el('li'), buttons=el('div','qq-actions');
      row.dataset.formatScript=saved.id;row.tabIndex=-1;
      const actionButton=(action,label,blocked,perform)=>{
        const button=el('button','secondary',tr(label));button.type='button';
        button.dataset.formatAction=action;button.disabled=locked||blocked;
        button.setAttribute('aria-label',tr(label)+' · '+saved.scriptName);
        button.onclick=()=>{if(!button.disabled&&from.data===data)perform();};
        return button;
      };
      const move=step=>{
        const target=index+step, scriptIds=items.map(item=>item.id);
        [scriptIds[index],scriptIds[target]]=[scriptIds[target],scriptIds[index]];
        void request('reorder',{revision:data.revision,scriptIds},from,saved.id);
      };
      buttons.append(actionButton('move-up','moveUp',items[index-1]?.stage!==saved.stage,()=>move(-1)),
        actionButton('move-down','moveDown',items[index+1]?.stage!==saved.stage,()=>move(1)),
        actionButton('remove','remove',false,()=>void request('remove',{revision:data.revision,scriptId:saved.id},from)));
      row.append(el('p','',saved.scriptName+' · '+tr(saved.stage)),buttons);
      return row;
    }));
    toggle.hidden = !items.length;
    toggle.disabled = locked || !items.length;
    toggle.textContent = tr(data.enabled?'disable':'enable');
  }
  function paint(){
    panel.hidden = !context;
    const data = current?.data, operation = current?.operation;
    const locked = !available() || !!operation;
    line('scope',scopeLabel());
    refresh.disabled = locked;
    status.textContent = !context?.scope.roleId ? tr('needRole') : !available() ? tr('offline') :
      operation ? tr(actions[operation.action]) : tr(current?.notice);
    field('controls').hidden = !data;
    if (!data) return;

    showSaved(data,locked);

    const selected = choice.value;
    const names = data.choices.map(item=>[item.id,item.scriptName+' · '+tr(item.stage)]);
    const options = [[ '',tr(names.length?'choose':'empty') ],...names.map(([id,label])=>[
      id,names.filter(([,name])=>name===label).length>1?label+' · '+id.slice(-8):label,
    ])];
    const optionKey = JSON.stringify(options);
    if (choice.dataset.optionsKey!==optionKey) {
      choice.replaceChildren(...options.map(([value,label])=>{
        const option = el('option','',label);option.value=value;return option;
      }));
      choice.dataset.optionsKey = optionKey;
      choice.value = names.some(([id])=>id===selected)?selected:'';
    }
    choice.disabled = locked || !names.length;
    review.disabled = locked || !choice.value;
    const preview = previewFor(current);
    const updating=preview && data.scripts.some(item=>item.id===preview.id);
    const full=!updating && data.scripts.length>=maxScripts;
    approve.disabled = locked || !preview || full;
    field('preview').hidden = !preview;
    line('preview-scope',preview?scopeLabel():'');
    line('name',preview?preview.scriptName+' · '+tr(preview.stage):'');
    line('preview-effect',preview?tr(full?'limit':updating?'refreshEffect':'addEffect'):'');
    fillRules(preview);
    fillOptions(preview);
  }
  function update(next,language){
    const changedLocale = (language==='zh'?'zh':'en')!==locale;
    if (changedLocale || contextKey===undefined) {
      locale = language==='zh'?'zh':'en';
      for (const node of panel.querySelectorAll('[data-group-format]')) node.textContent=tr(node.dataset.groupFormat);
    }
    const {roleName='',status='',roleUpdating=false,...scope} = next || {};
    const key = JSON.stringify(next?[scope,roleName,status,roleUpdating]:null);
    if (key!==contextKey) {
      contextKey=key;context=next?{scope,roleName,status,roleUpdating}:null;
      current=context&&panel.open?{}:null;
      choice.value='';paint();
      if (current&&available()) void request('view',{},current);
    } else if (changedLocale) paint();
  }
  function showError(view,code){
    if (badScope.has(code)) view.notice='stale';
    else if (stalePreview.has(code)) view.notice='newReview';
    else if (code==='group_output_format_limit') view.notice='limit';
    else view.notice='failed';
    view.preview=null;
    if (view.notice==='stale') view.data=null;
  }
  async function request(action,patch,from,focusId){
    if (!panel.open || !available() || !from || from!==current || from.operation || action!=='view'&&!from.data) return;
    const scope=context.scope, operation={action};
    const focused=panel.contains(document.activeElement);
    const currentOperation=()=>panel.open && from===current && from.operation===operation;
    const prior=from.data, priorPreview=from.preview;
    from.operation=operation;from.preview=null;from.notice='';paint();
    let actionFocus;
    try {
      const result=await api.groupOutputFormat({...scope,action,...patch});
      if (!currentOperation()) return;
      if (result?.ok!==true) {showError(from,result?.code);return;}
      const next=viewFrom(result,scope);
      if (!next) {from.data=null;showError(from);return;}
      if (action==='preview') {
        const preview=result.preview;
        if (next.revision!==prior.revision || preview?.id!==patch.scriptId || choice.value!==patch.scriptId ||
            !script(preview)||!exactScript(preview)||!reviewedOptions(preview)||
            typeof preview.approval!=='string'||!/^[a-f0-9]{64}$/.test(preview.approval)) {
          showError(from,'group_output_format_review_required');return;
        }
        from.preview=preview;
        actionFocus=field('preview-title');
      }
      if (['configure','remove','reorder'].includes(action)) {
        let valid,notice;
        if (action==='configure') {
          const previous=prior.scripts.filter(item=>item.id!==patch.scriptId), kept=next.scripts.filter(item=>item.id!==patch.scriptId);
          valid=next.enabled===patch.enabled&&sameList(previous,kept)&&
            (!patch.scriptId||sameScript(next.scripts.find(item=>item.id===patch.scriptId),priorPreview));
          notice=patch.scriptId?'saved':patch.enabled?'enabled':'disabled';
        } else if (action==='remove') {
          const expected=prior.scripts.filter(item=>item.id!==patch.scriptId);
          valid=sameList(expected,next.scripts)&&next.enabled===(expected.length>0&&prior.enabled);
          notice=expected.length?'removed':'removedLast';
        } else {
          const expected=patch.scriptIds.map(id=>prior.scripts.find(item=>item.id===id));
          valid=next.enabled===prior.enabled&&sameList(expected,next.scripts);
          notice='reordered';
        }
        if (!valid) {from.data=null;showError(from);return;}
        from.notice=notice;
        if (action==='configure'&&patch.scriptId) choice.value='';
      }
      from.data=next;
    } catch(error) {
      if (currentOperation()) showError(from,error?.code);
    } finally {
      if (currentOperation()) {
        from.operation=null;paint();
        if (focused&&(panel.contains(document.activeElement)||document.activeElement===document.body)) {
          if (focusId) actionFocus=[...field('list').children].find(item=>item.dataset.formatScript===focusId);
          if (actionFocus&&!actionFocus.closest('[hidden]')) actionFocus.focus();
          else if (document.activeElement===document.body) refresh.focus();
        }
      }
    }
  }
  panel.addEventListener('toggle',()=>{
    if (!panel.open) {current=null;choice.value='';paint();return;}
    if (current) return;
    current={};paint();if (available()) void request('view',{},current);
  });
  choice.onchange=()=>{
    if (current) {current.preview=null;current.notice='';paint();}
  };
  refresh.onclick=()=>void request('view',{},current);
  review.onclick=()=>{
    if (choice.value) void request('preview',{scriptId:choice.value},current);
  };
  approve.onclick=()=>{
    const preview=previewFor(current);
    if (!approve.disabled && preview) void request('configure',{revision:current.data.revision,enabled:true,scriptId:preview.id,approval:preview.approval},current);
  };
  toggle.onclick=()=>{
    if (current?.data?.scripts.length) void request('configure',{revision:current.data.revision,enabled:!current.data.enabled},current);
  };
  field('preview-title').tabIndex=-1;
  for (const node of panel.querySelectorAll('pre')) {
    node.style.whiteSpace='pre-wrap';node.style.overflowWrap='anywhere';
  }
  window.ArcadeGroupOutputFormat=Object.freeze({render:update});
})();
