'use strict';
(() => {
  const api = window.arcade;
  if (typeof api?.groupWiki !== 'function') return;

  const control = name => $('bot-qq-group-wiki-' + name);
  const panel = $('bot-qq-group-wiki');
  const read = control('read'), propose = control('propose'), title = control('title');
  const source = control('source'), quote = control('quote'), manualQuote = control('manual-quote');
  const save = control('save'), stage = control('stage'), refresh = control('refresh'), ask = control('ask');
  const pending = control('pending'), approved = control('approved'), status = control('status');
  const words = {
    title: ['群共享 Wiki', 'Shared group Wiki'],
    intro: ['群 Wiki 的依据仅来自这个群的公开消息。开启读取后，当前角色的 AI 可在回复时参考获批条目。', 'This Wiki uses public messages from this group as evidence. With reading enabled, this role’s AI can use entries you approve.'],
    refresh: ['重新读取 Wiki 和近期消息', 'Reload Wiki and recent messages'],
    read: ['可读取已批准的条目', 'May read approved entries'],
    propose: ['允许用本群公开消息创建提议', 'Allow proposals from public group messages'],
    save: ['保存 Wiki 权限', 'Save Wiki permissions'],
    draft: ['新建提议', 'Create a proposal'],
    source: ['近期公开群消息', 'Recent public message'],
    choose: ['请选择一条消息', 'Choose a message'],
    noSources: ['暂无已核实的公开群消息。群里有新消息后，可以重新读取。', 'There are no verified public messages to choose from. Reload after new messages arrive.'],
    truncated: ['有 {count} 条消息内容不完整，不能选作依据。', '{count} messages have incomplete text and cannot be selected as evidence.'],
    entryTitle: ['手动提议的标题', 'Title for a manual proposal'],
    stage: ['手动创建待审核提议', 'Create manual proposal for review'],
    ask: ['让搭档提议', 'Ask companion to propose'],
    askNote: ['点击后会把选中的完整公开群消息交给当前搭档的 AI 服务，可能产生 API 费用。', 'Asking the companion sends the complete selected public message to its AI provider. API charges may apply.'],
    manualQuote: ['准确引用（最多 120 字）', 'Exact quote (up to 120 characters)'],
    manualNote: ['请从所选消息中原样复制一行。', 'Copy one line directly from the selected message.'],
    pending: ['待审核的提议', 'Pending proposals'],
    approved: ['已批准的条目', 'Approved entries'],
    noPending: ['没有待审核的提议。', 'No pending proposals.'],
    noApproved: ['没有已批准的条目。', 'No approved entries.'],
    approve: ['批准', 'Approve'],
    reject: ['拒绝', 'Reject'],
    revoke: ['撤回', 'Revoke'],
    evidence: ['公开群消息摘录', 'Excerpt from a public group message'],
    fullSource: ['完整公开群消息', 'Complete public group message'],
    fullSourceMissing: ['暂时找不到完整来源。重新读取后再核对，或拒绝此提议。', 'The complete source is unavailable. Reload to review it, or reject this proposal.'],
    roleNeeded: ['请先核对这个群的群角色。', 'Review the saved role for this group first.'],
    wait: ['请等当前连接或角色设置操作完成。', 'Wait for the current connection or role settings operation to finish.'],
    loading: ['正在读取群 Wiki…', 'Loading group Wiki…'],
    updating: ['正在保存这次操作…', 'Saving this action…'],
    asking: ['正在让搭档根据这条公开消息提出建议…', 'Asking the companion to propose an entry from this public message…'],
    saved: ['已保存本群此角色的 Wiki 权限。', 'Saved Wiki permissions for this group role.'],
    proposed: ['提议已创建。请核对下方内容，再决定是否批准。', 'The proposal is ready for review. Check it below before approving.'],
    noProposal: ['搭档没有提出条目。', 'The companion did not suggest an entry.'],
    accepted: ['已批准该条目。', 'The entry was approved.'],
    rejected: ['已拒绝该提议。', 'The proposal was rejected.'],
    revoked: ['已撤回该条目。', 'The entry was revoked.'],
    stale: ['本群的 Wiki 或角色已变化。请重新读取后再操作。', 'The group Wiki or role changed. Reload before taking another action.'],
    sourceChanged: ['该公开消息已不可用。请重新读取后选择其他消息。', 'That public message is no longer available. Reload and choose another one.'],
    quoteMismatch: ['引用与所选完整消息不一致。这次提议已丢弃。', 'The quote differs from the selected message. The suggestion was discarded.'],
    quoteRequired: ['请从完整消息中准确引用一行，最多 120 字。', 'Quote one line directly from the complete message, up to 120 characters.'],
    modelFailed: ['搭档暂时无法完成提议。请核对当前 AI 服务后再试。', 'The companion could not complete its proposal. Check its AI provider before trying again.'],
    modelBusy: ['这个群角色正在处理提议。请等当前提议完成。', 'This group role is processing a proposal. Wait for it to finish.'],
    proposalOff: ['请先开启并保存提议权限。', 'Turn on proposal permission and save it first.'],
    invalid: ['这次操作的内容无效。请核对条目标题和所选消息。', 'This action was invalid. Check the entry title and selected message.'],
    full: ['本群 Wiki 已达上限。请先处理现有条目。', 'This group Wiki has reached its limit. Review the existing entries first.'],
    duplicate: ['这个标题和摘录已在待审核或已批准条目中。', 'This title and excerpt are already in a pending or approved entry.'],
    failed: ['本群 Wiki 操作未完成。请重新读取后再试。', 'The group Wiki action could not be completed. Reload and try again.'],
  };
  const success = {configure:'saved', propose:'proposed', approve:'accepted', reject:'rejected', revoke:'revoked'};
  const staleCodes = new Set(['credential_scope_changed','group_wiki_changed','group_wiki_not_found']);
  const id = value => typeof value === 'string' && /^[a-zA-Z0-9-]{1,128}$/.test(value);
  const text = (value, max) => typeof value === 'string' && !!value.trim() && value.length <= max;
  const time = value => Number.isSafeInteger(value) && value >= 0 && value <= 8.64e15;
  const evidence = row => id(row?.id) && time(row.at) && typeof row.speaker === 'string' && text(row.quote, 2000);
  const entry = row => id(row?.id) && text(row.title, 80) && text(row.text, 2000) && evidence(row.evidence) && time(row.createdAt);
  const publicSource = row => id(row?.id) && time(row.at) && typeof row.speaker === 'string' && text(row.text, 2000) &&
    (row.truncated === undefined || typeof row.truncated === 'boolean');
  const quoteLine = value => text(value,120) && !/[\p{Cc}\u2028\u2029]/u.test(value);
  let view = null, scope = null, locale = 'en', scopeKey = null;

  const tr = key => words[key]?.[locale === 'zh' ? 0 : 1] || '';
  const available = () => !!scope?.request.roleId && !scope.roleUpdating && ['disconnected','connected'].includes(scope.status);
  const stamp = value => new Date(value).toLocaleString(locale === 'zh' ? 'zh-CN' : 'en', {month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});
  function digest(value, expected){
    if (value?.ok !== true || value.accountId !== expected.expectedAccountId || value.groupId !== expected.groupId || value.roleId !== expected.roleId ||
        !Number.isSafeInteger(value.revision) || value.revision < 0 || typeof value.read !== 'boolean' || typeof value.propose !== 'boolean' ||
        ![value.pending,value.approved,value.sources].every(Array.isArray) ||
        !value.pending.every(entry) || !value.approved.every(entry) || !value.sources.every(publicSource)) return null;
    const entries = [...value.pending,...value.approved];
    if (new Set(entries.map(row => row.id)).size !== entries.length || new Set(value.sources.map(row => row.id)).size !== value.sources.length) return null;
    const {revision,read,propose,pending,approved,sources} = value;
    return {revision,read,propose,pending,approved,sources};
  }
  function actionButton(action, row, locked){
    const from = view, revision = view?.data?.revision;
    const button = el('button', 'secondary', tr(action));
    button.type = 'button';
    button.disabled = locked;
    button.setAttribute('aria-label', tr(action) + ' · ' + row.title);
    button.dataset.wikiAction = action;
    button.onclick = () => {
      if (from?.data?.revision === revision) void request(action, {id:row.id}, from);
    };
    return button;
  }
  function rows(list, items, actions, empty, locked){
    list.replaceChildren(...(items.length ? items.map(item => {
      const row = el('article','qq-check');
      row.dataset.wikiEntry = item.id;
      row.tabIndex = -1;
      const evidenceText = el('blockquote','',item.evidence.quote);
      evidenceText.style.whiteSpace = 'pre-wrap';
      const source = list===pending&&view.data.sources.find(row => !row.truncated &&
        row.id===item.evidence.id && row.speaker===item.evidence.speaker && row.at===item.evidence.at &&
        row.text.includes(item.evidence.quote));
      const tools = el('div','qq-actions');
      tools.append(...actions.map(action => actionButton(action,item,locked || action==='approve'&&!source)));
      row.append(el('strong','',item.title));
      if (item.text !== item.evidence.quote) row.append(el('p','',item.text));
      row.append(el('small','',tr('evidence') + ' · ' + stamp(item.evidence.at)),evidenceText);
      if (source && source.text !== item.evidence.quote) {
        const full = el('blockquote','',source.text);full.style.whiteSpace = 'pre-wrap';
        row.append(el('small','',tr('fullSource')),full);
      }
      if (list===pending && !source) row.append(el('p','bot-fine',tr('fullSourceMissing')));
      row.append(tools);
      return row;
    }) : [el('p','bot-fine',tr(empty))]));
  }
  function draftSource(){
    return view?.data?.sources.find(row => !row.truncated && row.id === source.value);
  }
  function paintDraft(){
    const row = draftSource();
    quote.hidden = !row;
    quote.textContent = row?.text || '';
    ask.disabled = !available() || !!view?.operation || !view?.data?.propose || !row;
    manualQuote.disabled = ask.disabled;
    const excerpt = manualQuote.value.trim();
    const valid = !!row && quoteLine(excerpt) && row.text.includes(excerpt);
    if (excerpt && !valid) manualQuote.setAttribute('aria-invalid','true');
    else manualQuote.removeAttribute('aria-invalid');
    stage.disabled = ask.disabled || !valid || !text(title.value,80);
  }
  function paint(){
    panel.hidden = !scope;
    const scopeLabel = !scope ? '' : locale === 'zh'
      ? ['搭档 QQ ' + scope.request.expectedAccountId, '群 ' + scope.request.groupId, scope.roleName].filter(Boolean).join(' · ')
      : ['Companion QQ ' + scope.request.expectedAccountId, 'Group ' + scope.request.groupId, scope.roleName].filter(Boolean).join(' · ');
    control('scope').textContent = scopeLabel;
    const data = view?.data;
    const busy = !!view?.operation, locked = !available() || busy;
    refresh.disabled = locked;
    control('controls').hidden = !data;
    status.textContent = !scope?.request.roleId ? tr('roleNeeded') : !available() ? tr('wait') :
      busy ? tr(({view:'loading',ask:'asking'})[view.operation.action] || 'updating') : tr(view?.feedback);
    read.disabled = propose.disabled = locked;
    save.disabled = locked || !data || read.checked === data.read && propose.checked === data.propose;
    const sources = data?.sources || [], options = sources.filter(row => !row.truncated), oldSource = source.value;
    const truncated = control('truncated'), count = sources.length - options.length;
    truncated.hidden = count === 0;
    truncated.textContent = count ? tr('truncated').replace('{count}',String(count)) : '';
    source.replaceChildren(...[[ '',tr(options.length ? 'choose' : 'noSources') ],...options.map(row => [
      row.id, stamp(row.at)+' · '+row.text.replace(/\s+/gu,' ').slice(0,64).toWellFormed(),
    ])].map(([value,label]) => {
      const option = el('option','',label);option.value = value;return option;
    }));
    if (options.some(row => row.id === oldSource)) source.value = oldSource;
    else manualQuote.value = '';
    control('draft').hidden = !data?.propose;
    source.disabled = title.disabled = locked || !options.length;
    paintDraft();
    rows(pending,data?.pending||[],['approve','reject'],'noPending',locked);
    rows(approved,data?.approved||[],['revoke'],'noApproved',locked);
  }
  function clearDraft(){
    source.value = '';title.value = '';manualQuote.value = '';read.checked = propose.checked = false;
  }
  function update(next, language){
    const nextLocale = language === 'zh' ? 'zh' : 'en';
    const changedLocale = nextLocale !== locale;
    if (changedLocale || scopeKey === null) {
      locale = nextLocale;
      for (const node of panel.querySelectorAll('[data-group-wiki]')) node.textContent = tr(node.dataset.groupWiki);
    }
    const {roleName = '',status = '',roleUpdating = false,...requestScope} = next || {};
    const key = JSON.stringify(next ? [requestScope,roleName,status,roleUpdating] : null);
    if (key === scopeKey && !changedLocale) return;
    if (key !== scopeKey) {
      scopeKey = key;
      scope = next ? {request:requestScope,roleName,status,roleUpdating} : null;
      view = panel.open && scope ? {} : null;
      clearDraft();
      paint();
      if (view && available()) void request('view',{},view);
    } else paint();
  }
  function failure(code){
    if (staleCodes.has(code)) return 'stale';
    return ({
      group_wiki_source_changed:'sourceChanged',group_wiki_source_unavailable:'sourceChanged',
      group_wiki_propose_off:'proposalOff',group_wiki_invalid:'invalid',
      group_wiki_limit:'full',group_wiki_duplicate:'duplicate',group_wiki_quote_mismatch:'quoteMismatch',group_wiki_quote_required:'quoteRequired',
      group_wiki_model_failed:'modelFailed',group_wiki_busy:'modelBusy',
    })[code] || 'failed';
  }
  async function request(action, patch, from){
    if (!panel.open || !available() || from !== view || !from || from.operation) return;
    if (action !== 'view' && !from.data) return;
    const expected = scope.request;
    const operation = {action};
    const startedWithFocus = panel.contains(document.activeElement);
    const current = () => panel.open && from === view && operation === view.operation;
    from.operation = operation;from.feedback = '';
    paint();
    let focusId = '';
    try {
      const result = await api.groupWiki({...expected,action,...(action === 'view' ? {} : {revision:from.data.revision,...patch})});
      if (!current()) return;
      if (result?.ok !== true) {
        from.feedback = failure(result?.code);
        if (['stale','sourceChanged'].includes(from.feedback)) from.data = null;
        return;
      }
      const next = digest(result,expected);
      if (!next || from.data && next.revision < from.data.revision) throw Error('Invalid group Wiki response');
      const modelPending = action === 'ask' && result.proposalOutcome === 'pending';
      const modelNone = action === 'ask' && result.proposalOutcome === 'none';
      if (action === 'ask' && !modelPending && !modelNone) throw Error('Unverified proposal outcome');
      if (action === 'propose' || modelPending) {
        const change = next.pending.find(row => !from.data.pending.some(old => old.id === row.id));
        const original = from.data.sources.find(row => row.id === patch.sourceId && !row.truncated);
        if (!change || !original || change.evidence.id !== patch.sourceId || change.evidence.speaker !== original.speaker ||
            change.evidence.at !== original.at || !original.text.includes(change.evidence.quote) ||
            action === 'propose' && change.evidence.quote !== patch.quote) throw Error('Unverified pending proposal');
        focusId = change.id;
        source.value = '';title.value = '';manualQuote.value = '';
      } else if (action === 'approve') focusId = patch.id;
      from.data = next;
      read.checked = next.read;propose.checked = next.propose;
      from.feedback = modelPending ? 'proposed' : modelNone ? 'noProposal' : success[action] || '';
    } catch (error) {
      if (current()) {
        from.feedback = failure(error?.code);
        if (['stale','sourceChanged'].includes(from.feedback)) from.data = null;
      }
    } finally {
      if (current()) {
        from.operation = null;
        paint();
        if (startedWithFocus && (panel.contains(document.activeElement) || document.activeElement === document.body)) {
          const entry = focusId && [...panel.querySelectorAll('[data-wiki-entry]')].find(row => row.dataset.wikiEntry === focusId);
          if (entry) entry.focus();
          else if (document.activeElement === document.body) refresh.focus();
        }
      }
    }
  }
  panel.addEventListener('toggle',() => {
    if (!panel.open) {view = null;clearDraft();paint();return;}
    if (view) return;
    view = {};
    paint();
    if (available()) void request('view',{},view);
  });
  read.onchange = propose.onchange = () => {
    if (view?.data) save.disabled = !available() || !!view.operation || read.checked === view.data.read && propose.checked === view.data.propose;
  };
  source.onchange = () => {
    const row = draftSource();
    manualQuote.value = row && quoteLine(row.text) ? row.text : '';
    paintDraft();
  };
  manualQuote.oninput = title.oninput = paintDraft;
  refresh.onclick = () => void request('view',{},view);
  save.onclick = () => void request('configure',{read:read.checked,propose:propose.checked},view);
  ask.onclick = () => {
    const row = draftSource();
    if (row) void request('ask',{sourceId:row.id},view);
  };
  stage.onclick = () => {
    const row = draftSource(), excerpt = manualQuote.value.trim();
    if (row && quoteLine(excerpt) && row.text.includes(excerpt) && text(title.value.trim(),80)) {
      void request('propose',{sourceId:row.id,title:title.value.trim(),quote:excerpt},view);
    }
  };
  quote.style.whiteSpace = 'pre-wrap';
  window.ArcadeGroupWiki = Object.freeze({render:update});
})();
