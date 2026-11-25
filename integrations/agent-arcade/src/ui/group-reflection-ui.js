'use strict';
(() => {
  const api = window.arcade;
  if (typeof api?.groupReflection !== 'function') return;

  const field = name => $('bot-qq-group-reflection-' + name);
  const panel = $('bot-qq-group-reflection'), schedule = field('scheduled'), hour = field('hour');
  const save = field('save'), run = field('run'), refresh = field('refresh');
  const feedback = field('feedback');
  const words = {
    title: ['群反思','Group reflection'],
    intro: ['回看本群公开消息，找出可用于回复的规则。每条候选都由你决定是否批准。','Review this group’s public messages for potential reply rules. You decide whether each candidate becomes a rule.'],
    refresh: ['重新读取反思','Reload reflection'],
    disclosure: ['每次运行会把本群中符合条件的公开消息发送给当前角色的 AI 服务，可能产生 API 费用。','Each run sends eligible public group messages to the current role’s AI provider. API charges may apply.'],
    scheduled: ['开启定时反思','Enable scheduled reflection'],
    scheduleAvailability: ['App 打开且群聊已连接时，才会在所选小时内运行。','Runs during the selected hour while the app is open and group chat is connected.'],
    hour: ['每天几点运行（本机时间）','Daily hour (local time)'],
    save: ['保存定时设置','Save schedule'],
    run: ['现在运行一次','Run once now'],
    never: ['还没有运行过反思。','Reflection has not run yet.'],
    last: ['上次运行','Last run'],
    read: ['读取 {n} 条公开消息','Public messages read · {n}'],
    missed: ['错过了一次定时反思，可以手动运行。','A scheduled run was missed. You can run once now.'],
    candidates: ['规则候选','Rule candidates'],
    rules: ['已批准的规则','Approved rules'],
    seen: ['另有 {n} 项只有一个本机日期的证据，尚未成为候选。','Observations with evidence from one local date · {n}'],
    days: ['{n} 个不同本机日期，按群消息的原始发送日期累计','{n} distinct local dates, based on the original message send dates'],
    oneDay: ['1 个本机日期，按群消息的原始发送日期计算','1 local date, based on the original message send date'],
    quotes: ['已核对的公开群消息引用','Verified quotes from public group messages'],
    approve: ['批准为规则','Approve as a rule'],
    reject: ['拒绝','Reject'],
    violation: ['已有规则未遵守','Existing rule was missed'],
    savedWording: ['当前规则原文','Current rule wording'],
    suggestedWording: ['搭档建议的措辞','Suggested wording from the companion'],
    reviewWording: ['批准后的规则文字（最多 200 字）','Wording to approve (up to 200 characters)'],
    sameRule: ['批准会更新同一条规则。保留原文或改写后再批准。','Approval updates the same rule. Keep its current wording or edit it before approving.'],
    ruleUnavailable: ['原规则已停用或变更。你可以拒绝这条候选。','The original rule is disabled or has changed. You can reject this candidate.'],
    approveRevision: ['批准这条规则','Approve this rule'],
    enabled: ['已启用','Enabled'],
    disabled: ['已停用','Disabled'],
    enable: ['启用规则','Enable rule'],
    disable: ['停用规则','Disable rule'],
    noCandidates: ['暂无待审核的规则候选。','No rule candidates are waiting for review.'],
    noRules: ['暂无已批准的规则。','No rules have been approved.'],
    roleNeeded: ['请先核对这个群的群角色。','Review the saved role for this group first.'],
    wait: ['请等当前连接或角色设置操作完成。','Wait for the current connection or role settings operation to finish.'],
    loading: ['正在读取群反思…','Loading group reflection…'],
    saving: ['正在保存这次操作…','Saving this action…'],
    running: ['正在让搭档回看本群公开消息…','The companion is reviewing this group’s public messages…'],
    completed: ['已完成。新增 {created} 项，合并 {merged} 项，待审核 {pending} 项。','Completed. {created} new, {merged} merged and {pending} awaiting review.'],
    saved: ['已保存本群此角色的定时设置。','Saved the schedule for this group role.'],
    approved: ['已批准这条规则。','The rule was approved.'],
    revised: ['已更新原有规则的措辞。','The existing rule’s wording was updated.'],
    reaffirmed: ['已批准沿用原有规则的措辞。','The existing wording was approved.'],
    rejected: ['已拒绝这条候选。','The candidate was rejected.'],
    ruleOn: ['已启用这条规则。','The rule was enabled.'],
    ruleOff: ['已停用这条规则。','The rule was disabled.'],
    stale: ['这个群的反思或角色已变化。请重新读取。','This group’s reflection or role changed. Reload before continuing.'],
    evidenceChanged: ['用于审核的公开消息已变动或撤回。请重新读取后再核对。','The public evidence changed or was recalled. Reload before reviewing again.'],
    sourceUnavailable: ['暂时无法核对群消息来源。请重新读取后重试。','The source group messages could not be verified. Reload before trying again.'],
    providerNeeded: ['请先为这个搭档设置可用于群聊的 AI 服务。','Configure an AI provider for this companion’s group chat first.'],
    badInput: ['请核对本机时间、所选条目或规则措辞后再试。','Check the local hour, selected entry or rule wording and try again.'],
    waitingBusy: ['当前有反思或回复正在处理，请稍后重试。','A reflection or reply is in progress. Try again after it finishes.'],
    limit: ['这类条目已达上限。请先处理现有候选或停用一条已批准的规则。','This type of entry has reached its limit. Review existing candidates or disable an approved rule first.'],
    failed: ['群反思操作未完成。请重新读取后再试。','The group reflection action could not be completed. Reload and try again.'],
  };
  const outcomes = {
    ok: ['已完成','Completed'],
    no_new_messages: ['暂无符合条件的新公开消息','No new eligible public messages'],
    invalid_output: ['AI 返回的候选格式有误','The AI returned invalid candidates'],
    runner_failed: ['AI 调用失败','The AI request failed'],
    cancelled: ['已取消','Cancelled'],
    unavailable: ['当时无法运行','Unavailable at the time'],
    failed: ['运行未完成','The run did not complete'],
  };
  const errors = {
    group_reflection_changed:'stale',credential_scope_changed:'stale',group_reflection_not_found:'stale',
    group_reflection_rule_changed:'stale',group_reflection_rule_invalid:'badInput',
    group_reflection_evidence_changed:'evidenceChanged',group_reflection_source_changed:'evidenceChanged',
    group_reflection_source_unavailable:'sourceUnavailable',
    group_reflection_model_failed:'providerNeeded',
    group_reflection_invalid:'badInput',group_reflection_invalid_request:'badInput',group_reflection_busy:'waitingBusy',
    group_reflection_limit:'limit',reflection_invalid_request:'badInput',reflection_busy:'waitingBusy',
    reflection_limit:'limit',reflection_rule_cap:'limit',reflection_candidate_not_found:'stale',
    reflection_candidate_decided:'stale',reflection_rule_not_found:'stale',
  };
  const resultWord = {configure:'saved',approve:'approved',reject:'rejected'};
  const validId = id => typeof id === 'string' && /^[a-zA-Z0-9-]{1,128}$/.test(id);
  const validTime = value => Number.isSafeInteger(value) && value >= 0 && value <= 8.64e15;
  const count = value => Number.isSafeInteger(value) && value >= 0;
  const validHour = value => count(value) && value <= 23;
  const validText = value => typeof value === 'string' && !!value.trim() && value.length <= 2000;
  const validWording = value => validText(value) && value.length <= 200 && !/[\p{Cc}\u2028\u2029]/u.test(value);
  const evidenceDays = items => new Set(items.map(item => item.day)).size;
  const evidenceValid = item => validId(item?.messageId) && validText(item.quote) && /^\d{4}-\d{2}-\d{2}$/.test(item.day);
  const candidate = item => validId(item?.id) && validText(item.ruleDraft) && item.state === 'pending' &&
    Array.isArray(item.evidence) && item.evidence.length > 0 && item.evidence.every(evidenceValid) &&
    item.count === evidenceDays(item.evidence) && (item.kind!=='rule_violated'||validId(item.ruleId));
  const rule = item => validId(item?.id) && validText(item.text) && typeof item.enabled === 'boolean';
  const settled = new Set(['connected','disconnected']);
  let context, contextKey, current, locale = 'en';

  const tr = key => words[key]?.[locale==='zh'?0:1] || '';
  const outcomeText = value => (Object.hasOwn(outcomes,value) ? outcomes[value] : outcomes.failed)[locale==='zh'?0:1];
  const available = () => !!context?.scope.roleId && !context.roleUpdating && settled.has(context.status);
  const displayCount = (key,value) => tr(key).replace('{n}',String(value));
  function runFeedback(view){
    if (!view?.runOutcome) return '';
    if (view.runOutcome!=='ok' || !view.runCounts) return outcomeText(view.runOutcome);
    return tr('completed').replace(/\{(created|merged|pending)\}/g,(_,key)=>String(view.runCounts[key]));
  }

  function viewFrom(value,scope){
    if (value?.ok !== true || value.accountId !== scope.expectedAccountId || value.groupId !== scope.groupId ||
        value.roleId !== scope.roleId || typeof value.revision !== 'string' || !/^[a-zA-Z0-9-]{8,128}$/.test(value.revision) ||
        typeof value.scheduled !== 'boolean' || !validHour(value.hour) ||
        !(value.lastRunAt === null || validTime(value.lastRunAt)) ||
        !(value.lastOutcome === null || typeof value.lastOutcome === 'string') ||
        !(value.lastRead === null || count(value.lastRead)) || typeof value.missed !== 'boolean' ||
        !count(value.seenOnce) || !Array.isArray(value.candidates) || !value.candidates.every(candidate) ||
        !Array.isArray(value.rules) || !value.rules.every(rule)) return null;
    const idsUnique = rows => new Set(rows.map(row=>row.id)).size===rows.length;
    return idsUnique(value.candidates)&&idsUnique(value.rules)?value:null;
  }
  function button(action,label,item,locked,patch){
    const from = current, revision = from.data.revision;
    const node = el('button','secondary',tr(label));node.type = 'button';node.disabled = locked;
    node.setAttribute('aria-label',tr(label)+' · '+(item.ruleDraft||item.text));
    node.onclick = () => {
      if (!node.disabled && from.data?.revision === revision) {
        const values = typeof patch==='function'?patch():patch;
        if (values!==null) void request(action,{id:item.id,...values},from);
      }
    };
    return node;
  }
  function violationReview(row,item,rule,locked){
    row.append(el('strong','',tr('violation')));
    if (rule) row.append(el('small','',tr('savedWording')),el('p','',rule.text));
    if (rule && item.ruleDraft!==rule.text) row.append(el('small','',tr('suggestedWording')),el('p','',item.ruleDraft));
    const target = {...item,ruleDraft:rule?.text||tr('violation')};
    if (!rule?.enabled) {
      row.append(el('p','bot-fine',tr('ruleUnavailable')));
      return button('approve','approveRevision',target,true);
    }
    row.append(el('p','bot-fine',tr('sameRule')));
    current.edits ??= new Map();
    const edits = current.edits, saved = edits.get(item.id);
    const input = el('input');input.id = 'bot-qq-group-reflection-wording-'+item.id;
    input.type = 'text';input.maxLength = 200;input.autocomplete = 'off';
    input.disabled = locked;input.value = saved?.original===rule.text?saved.value:rule.text;
    const label = el('label','',tr('reviewWording'));label.htmlFor = input.id;
    const approve = button('approve','approveRevision',target,locked||!validWording(input.value.trim()),()=>{
      const value = input.value.trim();
      return !validWording(value)?null:value===rule.text?{}:{text:value};
    });
    input.oninput = ()=>{
      edits.set(item.id,{original:rule.text,value:input.value});
      const valid = validWording(input.value.trim());
      approve.disabled = locked||!valid;
      if (valid) input.removeAttribute('aria-invalid');
      else input.setAttribute('aria-invalid','true');
    };
    row.append(label,input);
    return approve;
  }
  function showCandidates(items,rules,locked){
    field('candidates').replaceChildren(...(items.length?items.map(item=>{
      const row = el('article','qq-check');row.tabIndex = -1;row.dataset.candidateId = item.id;
      const quotes = item.evidence.map(({quote,day})=>{
        const group = el('div'), content = el('blockquote','',quote);
        content.style.whiteSpace = 'pre-wrap';group.append(el('small','',day),content);return group;
      });
      const actions = el('div','qq-actions');
      const violation = item.kind==='rule_violated';
      const approve = violation?violationReview(row,item,rules.find(rule=>rule.id===item.ruleId),locked):button('approve','approve',item,locked);
      actions.append(approve,button('reject','reject',item,locked));
      if (!violation) row.append(el('strong','',item.ruleDraft));
      row.append(el('p','',item.count===1?tr('oneDay'):displayCount('days',item.count)),el('small','',tr('quotes')),...quotes,actions);
      return row;
    }):[el('p','bot-fine',tr('noCandidates'))]));
  }
  function showRules(items,locked){
    field('rules').replaceChildren(...(items.length?items.map(item=>{
      const row = el('article','qq-check');row.tabIndex = -1;row.dataset.ruleId = item.id;
      const actions = el('div','qq-actions');
      actions.append(button('rule',item.enabled?'disable':'enable',item,locked,{enabled:!item.enabled}));
      row.append(el('strong','',item.text),el('p','',tr(item.enabled?'enabled':'disabled')),actions);
      return row;
    }):[el('p','bot-fine',tr('noRules'))]));
  }
  function paint(){
    panel.hidden = !context;
    const data = current?.data, operation = current?.operation;
    const locked = !available() || !!operation;
    const scope = context?.scope;
    field('scope').textContent = scope?[
      (locale==='zh'?'搭档 QQ ':'Companion QQ ')+scope.expectedAccountId,
      (locale==='zh'?'群 ':'Group ')+scope.groupId,context.roleName,
    ].filter(Boolean).join(' · '):'';
    refresh.disabled = locked;
    field('controls').hidden = !data;
    schedule.disabled = locked;hour.disabled = locked || !schedule.checked;
    save.disabled = locked || !data || (schedule.checked===data.scheduled && Number(hour.value)===data.hour);
    run.disabled = locked || !data || data.running===true;
    feedback.textContent = !scope?.roleId ? tr('roleNeeded') : !available() ? tr('wait') :
      operation ? tr(({view:'loading',run:'running'})[operation.action] || 'saving') :
      current?.notice ? tr(current.notice) : data?.running===true ? tr('running') :
      runFeedback(current);
    if (!data) return;
    const last = data.lastRunAt===null?tr('never'):[
      tr('last'),new Date(data.lastRunAt).toLocaleString(locale==='zh'?'zh-CN':'en'),
      data.lastOutcome&&outcomeText(data.lastOutcome),count(data.lastRead)&&displayCount('read',data.lastRead),
    ].filter(Boolean).join(' · ');
    field('last').textContent = last;
    field('missed').hidden = !data.missed;
    field('seen').hidden = !data.seenOnce;
    field('seen').textContent = data.seenOnce?displayCount('seen',data.seenOnce):'';
    showCandidates(data.candidates,data.rules,locked);showRules(data.rules,locked);
  }
  function update(next,language){
    const changedLocale = (language==='zh'?'zh':'en')!==locale;
    if (changedLocale || contextKey===undefined) {
      locale = language==='zh'?'zh':'en';
      for (const label of panel.querySelectorAll('[data-group-reflection]')) label.textContent = tr(label.dataset.groupReflection);
    }
    const {roleName='',status='',roleUpdating=false,...scope} = next || {};
    const key = JSON.stringify(next?[scope,roleName,status,roleUpdating]:null);
    if (key!==contextKey) {
      contextKey = key;context = next?{scope,roleName,status,roleUpdating}:null;
      current = context&&panel.open?{}:null;
      schedule.checked = false;hour.value = '3';paint();
      if (current&&available()) void request('view',{},current);
    } else if (changedLocale) paint();
  }
  function respondError(from,code){
    from.notice = (Object.hasOwn(errors,code) && errors[code]) || 'failed';
    if (['stale','evidenceChanged'].includes(from.notice)) from.data = null;
  }
  async function request(action,patch,from){
    if (!panel.open || !available() || !from || from!==current || from.operation || action!=='view'&&!from.data) return;
    if (action==='run' && from.data.running===true) return;
    const scope = context.scope, operation = {action};
    const startedFocused = panel.contains(document.activeElement);
    const sameOperation = () => panel.open && current===from && from.operation===operation;
    from.operation = operation;from.notice = '';from.runOutcome = null;paint();
    try {
      const result = await api.groupReflection({...scope,action,...(action==='view'?{}:{revision:from.data.revision,...patch})});
      if (!sameOperation()) return;
      if (result?.ok!==true) {respondError(from,result?.code);return;}
      const next = viewFrom(result,scope);
      if (!next) {from.data=null;respondError(from);return;}
      const candidate = (action==='approve'||action==='reject')&&from.data.candidates.find(row=>row.id===patch.id);
      if (action==='approve'&&candidate?.kind==='rule_violated') {
        const prior = from.data.rules.find(rule=>rule.id===candidate.ruleId);
        if (!prior?.enabled || !next.rules.some(rule=>rule.id===prior.id&&rule.enabled&&rule.text===(patch.text??prior.text))) {
          from.data = null;respondError(from,'group_reflection_rule_changed');return;
        }
      }
      from.data = next;
      from.notice = action==='rule'?(patch.enabled?'ruleOn':'ruleOff'):resultWord[action]||'';
      if (candidate) {
        from.edits?.delete(candidate.id);
        if (action==='approve'&&candidate.kind==='rule_violated') from.notice = patch.text===undefined?'reaffirmed':'revised';
      }
      if (action==='run') {
        from.runOutcome = result.outcome||result.lastOutcome||'failed';
        const {created,merged,pending} = result;
        from.runCounts = [created,merged,pending].every(count)?{created,merged,pending}:null;
      }
      hour.value = String(next.hour);schedule.checked = next.scheduled;
    } catch (error) {
      if (sameOperation()) respondError(from,error?.code);
    } finally {
      if (sameOperation()) {
        from.operation = null;paint();
        if (startedFocused && document.activeElement===document.body) {
          const row = patch.id&&[...field('rules').children].find(item=>item.dataset.ruleId===patch.id);
          (row || refresh).focus();
        }
      }
    }
  }

  hour.replaceChildren(...Array.from({length:24},(_,value)=>{
    const option = el('option','',String(value).padStart(2,'0')+':00');option.value=String(value);return option;
  }));
  panel.addEventListener('toggle',()=>{
    if (!panel.open) {current=null;paint();return;}
    if (current) return;
    current = {};paint();
    if (available()) void request('view',{},current);
  });
  schedule.onchange = hour.onchange = paint;
  refresh.onclick = () => void request('view',{},current);
  save.onclick = () => void request('configure',{scheduled:schedule.checked,hour:Number(hour.value)},current);
  run.onclick = () => void request('run',{},current);
  window.ArcadeGroupReflection = Object.freeze({render:update});
})();
