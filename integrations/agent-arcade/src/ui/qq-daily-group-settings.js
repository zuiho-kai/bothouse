'use strict';

// Daily and advanced settings use the same mounted controls and IPC handlers.
(() => {
  const byId = id => document.getElementById(id);
  const groups = byId('bot-qq-groups');
  const roles = byId('bot-qq-group-roles');
  const entry = document.createElement('button');
  entry.id = 'bot-qq-daily-settings';
  entry.type = 'button';
  entry.className = 'secondary';
  entry.hidden = true;
  byId('bot-settings-toggle').before(entry);
  entry.onclick = () => window.openConversationSetup({section:'qq-groups'});

  const dialog = document.createElement('dialog');
  dialog.id = 'qq-daily-group-settings';
  dialog.setAttribute('aria-labelledby', 'qq-daily-title');
  dialog.innerHTML = `
    <header class="qq-daily-header"><h2 id="qq-daily-title"></h2><button type="button" id="qq-daily-close" class="plain"></button></header>
    <div class="qq-daily-context">
      <label><span id="qq-daily-profile-label"></span><select id="qq-daily-profile"></select></label>
      <label><span id="qq-daily-group-label"></span><select id="qq-daily-group"></select></label>
    </div>
    <p id="qq-daily-notice" role="status"></p>
    <button type="button" id="qq-daily-connection" class="plain" hidden></button>
    <div class="qq-daily-tabs" role="group" aria-labelledby="qq-daily-title"><button type="button" data-page="role"></button><button type="button" data-page="policy"></button><button type="button" id="qq-daily-advanced" data-page="advanced"></button></div>
    <div id="qq-daily-body"></div>
    <footer id="qq-daily-policy-footer" hidden></footer>`;
  document.body.append(dialog);
  const profile = byId('qq-daily-profile'), picker = byId('qq-daily-group');
  const tabs = [...dialog.querySelectorAll('[data-page]')];
  const panels = Object.fromEntries(tabs.map(button => {
    const key = button.dataset.page, panel = document.createElement('section');
    panel.id = 'qq-daily-' + key + '-panel';
    button.setAttribute('aria-controls', panel.id);
    button.onclick = () => showPage(key);
    return [key, panel];
  }));
  let snapshot, directory = [], session, targetProfile, targetQQ, groupId, page;
  let contextName = '', switching = '', notice = '', previousFocus, locations = [];
  let outgoingCaption = '', issueTarget = null;
  let groupVoice = false;
  const voiceGuide = document.createElement('p');
  voiceGuide.className = 'bot-fine';
  voiceGuide.id = 'qq-daily-voice-guide';
  const tr = (zh, en) => snapshot?.config?.language === 'zh' ? zh : en;
  const drawing=window.createQQGroupDrawingSettings();
  const membership = window.createQQGroupMembership({
    acceptGroups(before, groups, nextGroup = groupId) {
      const revision = qq()?.groups?.membershipRevision;
      if (!current() || (revision !== before && revision !== groups.membershipRevision)) return false;
      snapshot = {...snapshot, bot:{...snapshot.bot, qq:{...qq(), groups}}};
      groupId = groups.groupIds.includes(nextGroup) ? nextGroup : '';
      contextName = '';
      syncGroup();
      return true;
    },
    refreshSnapshot: window.arcade.snapshot
  });
  byId('qq-daily-body').prepend(membership.element);
  const accounts = () => (snapshot?.accounts?.accounts || []).filter(row => row.channel === 'qq');
  const qq = () => snapshot?.bot?.channel === 'qq' ? snapshot.bot.qq : null;
  const current = () => Boolean(targetProfile && targetProfile === snapshot?.accounts?.selectedId &&
    targetQQ && targetQQ === qq()?.expectedAccountId && accounts().some(row => row.id === targetProfile));

  function options(select, items, placeholder, value) {
    const rows = [['',placeholder], ...items];
    if (select.dataset.choices !== JSON.stringify(rows)) {
      select.replaceChildren(...rows.map(([id,name]) => new Option(name,id)));
      select.dataset.choices = JSON.stringify(rows);
    }
    select.value = value;
  }
  function move(node, to) {
    if (!node) return;
    const place = document.createComment('group settings');
    node.before(place);
    locations.push([place,node]);
    to.append(node);
  }
  function mount() {
    outgoingCaption = byId('bot-qq-group-outgoing').querySelector('summary').textContent;
    const children = [...groups.children];
    move(groups, byId('qq-daily-body'));
    groups.append(panels.role, panels.policy, panels.advanced);
    const policyNodes = new Set([
      byId('bot-qq-groups-enabled').closest('label'), byId('bot-qq-groups-edit-note'),
      byId('bot-qq-group-images'), byId('bot-qq-group-voice'), byId('bot-qq-groups-proactive').closest('label'),
      byId('bot-qq-groups-proactive-edit-note'), byId('bot-qq-groups-save').parentElement, byId('bot-qq-groups-feedback'),
      byId('bot-qq-group-media-empty'), byId('bot-qq-groups-state'), byId('bot-qq-group-outgoing'),
    ]);
    for (const child of children) {
      const roleNode = child === roles || child.id === 'bot-qq-group-role-alert';
      move(child, roleNode ? panels.role : policyNodes.has(child) ? panels.policy : panels.advanced);
    }
    panels.policy.prepend(byId('bot-qq-group-outgoing'));
    const web = byId('bot-qq-public-web');
    if (web) {
      move(web, panels.policy);
      if (!groupVoice) panels.policy.prepend(web);
    }
    if (groupVoice) byId('bot-qq-group-outgoing').querySelector('summary').after(voiceGuide);
    byId('bot-qq-group-outgoing').after(drawing.element);
    // Keep the current role and its settings together when their section moves.
    // Each advanced feature retains its own original explicit apply button.
    for (const detail of [...byId('bot-qq-group-role-controls').children].filter(node => node.tagName === 'DETAILS')) {
      move(detail, panels.advanced);
    }
    const companionSettings = byId('bot-qq-groups-companion-settings');
    if (companionSettings) move(companionSettings, panels.advanced);
    for (const field of ['description','examples']) byId('bot-qq-group-role-preview-' + field).tabIndex = 0;
  }
  function showPage(key) {
    page = key;
    const save = byId('bot-qq-groups-save').parentElement, feedback = byId('bot-qq-groups-feedback');
    if (key === 'advanced') byId('bot-qq-groups-rule').after(save, feedback);
    else byId('qq-daily-policy-footer').append(save, feedback);
    byId('qq-daily-policy-footer').hidden = key !== 'policy' || !current() || !groupId;
    for (const button of tabs) {
      const selected = button.dataset.page === page;
      button.setAttribute('aria-pressed', String(selected));
      panels[button.dataset.page].hidden = !selected || !current() || (!groupId && page !== 'advanced');
    }
    byId('qq-daily-body').scrollTop = 0;
    window.syncQQDailyGroupPolicy?.();
  }
  function syncGroup() {
    dialog.dataset.groupId = groupId;
    const outgoing = byId('bot-qq-group-outgoing');
    outgoing.open = groupVoice && Boolean(groupId && current());
    roles.dispatchEvent(new Event('arcade-group-role-discard'));
    roles.open = Boolean(groupId && current());
    window.syncQQDailyGroupPolicy?.();
    if (roles.open) {
      roles.dispatchEvent(new Event('toggle'));
      const select = byId('bot-qq-group-role-group');
      if ([...select.options].some(option => option.value === groupId) && select.value !== groupId) {
        select.value = groupId;
        select.dispatchEvent(new Event('change', {bubbles:true}));
      }
    }
    refresh();
  }
  function refresh() {
    if (!session) return;
    const linked = current(), ids = linked ? qq()?.groups?.groupIds || [] : [];
    const onlineMembership = linked && snapshot.bot.status === 'connected' && Boolean(qq()?.groups?.membershipRevision) &&
      typeof window.arcade?.botGroupMembershipDirectory === 'function' && typeof window.arcade?.botGroupMembershipSet === 'function';
    byId('qq-daily-title').textContent = tr('群设置','Group settings');
    byId('qq-daily-close').textContent = tr('关闭','Close');
    byId('qq-daily-profile-label').textContent = tr('搭档','Companion');
    byId('qq-daily-group-label').textContent = tr('QQ 群','QQ group');
    tabs[0].textContent = tr('群人设','Group role');
    tabs[1].textContent = tr('接话与媒体','Replies and media');
    tabs[2].textContent = tr('高级设置','Advanced');
    options(profile, accounts().map(row => {
      const id = row.expectedQQAccountId || (row.id === snapshot.accounts.selectedId && qq()?.expectedAccountId) || '';
      return [row.id, (row.name || row.id) + (id ? ' · QQ ' + id : '')];
    }), tr('选择 QQ 搭档','Choose a QQ companion'), targetProfile);
    options(picker, ids.map(id => {
      const name = (id === groupId && contextName) || directory.find(row => row.id === id)?.name;
      return [id, name ? name + ' · ' + id : id];
    }), tr('选择一个群','Choose a group'), groupId);
    profile.disabled = groupVoice || Boolean(switching);
    picker.disabled = !linked || !ids.length || Boolean(switching);
    tabs[0].disabled = tabs[1].disabled = !groupId || !linked;
    tabs[2].disabled = !linked;
    const hint = byId('qq-daily-notice');
    hint.textContent = notice || (switching ? tr('正在切换搭档…','Switching companion…') :
      !linked ? tr('请选择已设置普通 QQ 账号的搭档。','Choose a companion with a saved personal QQ account.') :
      !ids.length ? (onlineMembership ? tr('还没有已授权的群。','No groups are saved.') :
        tr('还没有已授权的群。可在高级设置中添加群号。','No groups are saved. Add a group number in Advanced.')) :
      !groupId ? (groupVoice ? tr('选择要设置语音的群。','Choose the group whose voice settings you want to edit.') :
        tr('请选择要设置的群。','Choose the group to configure.')) : '');
    hint.hidden = !hint.textContent;
    membership.update(linked && !switching && snapshot.bot.status === 'connected' ? {
      profileId: targetProfile, expectedMode: snapshot.bot.mode, expectedChannel: 'qq',
      expectedAccountId: targetQQ
    } : null, linked ? qq()?.groups : null, groupId, picker.selectedOptions[0]?.textContent, tr,
    snapshot.bot?.social?.config?.proactiveMessages === true);
    const connection = byId('qq-daily-connection');
    connection.hidden = linked || !snapshot?.bot || Boolean(switching);
    connection.textContent = tr('打开搭档连接设置','Open companion connection settings');
    const outgoingTitle = byId('bot-qq-group-outgoing').querySelector('summary');
    const media = linked && qq()?.groups?.outgoingMedia?.find(row => row.groupId === groupId);
    const role=linked&&qq()?.groups?.generation?.find(row=>row.groupId===groupId);
    if (groupVoice) {
      const privateMedia = snapshot.bot?.social?.ownerMedia;
      const currentRole = media || role;
      const sameRole = privateMedia?.accountId === targetQQ && currentRole?.roleId === privateMedia?.roleId;
      const voice = sameRole ? privateMedia.selectedVoice : null;
      voiceGuide.textContent = currentRole ? (!media ?
        tr(`本群角色是${currentRole.roleName}。本群语音设置暂不可用。`, `This group uses ${currentRole.roleName}. Voice settings are currently unavailable.`) : voice ?
        tr(`本群角色是${currentRole.roleName}。允许本轮语音后，可使用已选音色 ${voice.name}。请保存本群素材。`,
           `This group uses ${currentRole.roleName}. Allow spoken replies to use the selected voice, ${voice.name}. Save media for this group.`) :
        tr(`本群角色是${currentRole.roleName}。请按下方为这个角色提供的选项选择并保存本群语音。`,
           `This group uses ${currentRole.roleName}. Choose from this role’s voice options below and save media for this group.`)) : '';
    }
    drawing.update(role&&qq().groups.enabled?{profileId:targetProfile,expectedMode:snapshot.bot.mode,expectedChannel:'qq',
      expectedAccountId:targetQQ,groupId,roleId:role.roleId}:null,snapshot?.config?.language,qq()?.groups?.drawingActivity,{
      profileName:snapshot.accounts?.accounts?.find(item=>item.id===targetProfile)?.name,
      roleName:role?.roleName,canShare:snapshot.bot?.status==='connected'&&snapshot.bot?.media?.available===true&&
        snapshot.accounts?.accounts?.some(item=>item.id===targetProfile&&item.accountId===targetQQ)&&
        snapshot.bot.media.groupTargets?.some(item=>item.groupId===groupId&&item.roleId===role?.roleId),
    });
    const allowed = new Set([...(media?.assets || []), ...(media?.reactionAssets || [])]);
    if (media?.recordingAvailable === false) {
      allowed.delete('whale-recording');allowed.delete('card-recording');
    }
    if (Array.isArray(media?.namedStickers)) {
      // The legacy named image shares the role's default sticker slot.
      if (media.namedSticker) {
        for (const asset of allowed) if (asset.endsWith('-sticker')) allowed.delete(asset);
      }
      for (const sticker of media.namedStickers) {
        if (sticker.request || sticker.reaction) allowed.add(sticker.id);
      }
    }
    const granted = allowed.size;
    outgoingTitle.textContent = media ? (tr('本群可发素材 · ','Media for this group · ') + media.roleName +
      (granted ? tr(' · 已授权 ' + granted + ' 项',' · ' + granted + ' allowed') : tr(' · 选择素材',' · Choose media'))) :
      tr('角色可发给本群的素材','Media the character may send to this group');
    byId('qq-daily-policy-footer').hidden = page !== 'policy' || !linked || !groupId;
    for (const button of tabs) {
      const key = button.dataset.page;
      panels[key].hidden = page !== key || !linked || (key !== 'advanced' && !groupId);
    }
  }
  function leave() {
    if (!session) return;
    session = null;
    issueTarget = null;
    groupVoice = false;
    voiceGuide.remove();
    membership.update(null);
    drawing.update(null,snapshot?.config?.language);
    switching = '';
    roles.open = false;
    roles.dispatchEvent(new Event('arcade-group-role-discard'));
    for (const [place,node] of locations.reverse()) place.replaceWith(node);
    locations = [];
    Object.values(panels).forEach(panel => panel.remove());
    for (const field of ['description','examples']) byId('bot-qq-group-role-preview-' + field).removeAttribute('tabindex');
    byId('bot-qq-group-outgoing').querySelector('summary').textContent = outgoingCaption;
    delete dialog.dataset.groupId;
    contextName = '';
    window.syncQQDailyGroupPolicy?.();
    if (previousFocus?.isConnected) previousFocus.focus({preventScroll:true});
    else if (previousFocus?.hasAttribute('data-qq-media-issue-settings')) byId('bot-qq-groups-runtime').focus({preventScroll:true});
  }
  function close() {
    if (dialog.open) dialog.close();
    leave();
  }
  byId('qq-daily-close').onclick = close;
  byId('qq-daily-connection').onclick = () => {close();window.openConversationSetup({section:'channel'});};
  dialog.addEventListener('click', event => {
    if (event.target.closest('#bot-qq-groups-companion-settings')) close();
  }, true);
  dialog.addEventListener('cancel', event => {event.preventDefault();close();});
  dialog.addEventListener('close', () => {if (!dialog.open) leave();});
  picker.onchange = () => {
    issueTarget = null;groupId = picker.value;contextName = '';notice = '';syncGroup();
    if(groupVoice&&groupId)byId('bot-qq-group-outgoing').querySelector('summary').scrollIntoView({block:'nearest'});
  };
  profile.onchange = async () => {
    const selected = profile.value, opened = session;
    issueTarget = null;notice = '';groupId = '';contextName = '';targetProfile = '';targetQQ = '';
    syncGroup();
    if (!selected) return;
    if (selected === snapshot.accounts.selectedId) {
      targetProfile = selected;targetQQ = qq()?.expectedAccountId || '';syncGroup();return;
    }
    switching = selected;refresh();
    try {
      const next = await window.arcade.accountSelect(selected);
      if (opened !== session || switching !== selected) return;
      if (next?.accounts?.selectedId !== selected || next.bot?.channel !== 'qq') throw Error('Selection changed');
      // Wait for the production renderer to bind its existing forms to the same profile.
      if (snapshot.accounts.selectedId !== selected) throw Error('Selection changed');
      targetProfile = selected;targetQQ = qq()?.expectedAccountId || '';
    } catch {
      if (opened === session) notice = tr('未能切换搭档，请重新选择。','Could not switch companions. Choose again.');
    } finally {
      if (opened === session) {switching = '';syncGroup();}
    }
  };
  function matchesMediaIssue(hint) {
    const config=qq()?.groups;
    return Boolean(hint?.profileId && hint.profileId===snapshot?.accounts?.selectedId && hint.expectedAccountId &&
      hint.expectedAccountId===qq()?.expectedAccountId && config?.groupIds?.includes(hint.groupId) &&
      config.outgoingMedia?.some(row=>row.groupId===hint.groupId && row.roleId===hint.roleId &&
        (!hint.assetId||row.availableAssets?.includes(hint.assetId))));
  }
  function showIssueMedia(hint) {
    issueTarget={profileId:hint.profileId,expectedAccountId:hint.expectedAccountId,groupId:hint.groupId,roleId:hint.roleId,assetId:hint.assetId};
    showPage('policy');
    const outgoing=byId('bot-qq-group-outgoing');
    outgoing.open=true;
    let target=outgoing.querySelector('summary');
    if(hint.assetId){
      const checkbox=[...outgoing.querySelectorAll('input[type="checkbox"]')].find(box=>box.value===hint.assetId);
      const choose=[...outgoing.querySelectorAll('button[data-operation="choose"]')].find(button=>button.dataset.asset===hint.assetId);
      if(checkbox&&!checkbox.matches(':disabled'))target=checkbox;
      else if(choose&&!choose.hidden&&!choose.matches(':disabled'))target=choose;
    }
    target.focus({preventScroll:true});target.scrollIntoView({block:'nearest'});
  }
  function open(hint = {}) {
    if (!snapshot || (hint.mediaIssue && !matchesMediaIssue(hint))) return false;
    if (hint.groupVoice && (!hint.profileId || !hint.expectedAccountId || hint.profileId!==snapshot.accounts?.selectedId ||
      hint.expectedAccountId!==qq()?.expectedAccountId)) return false;
    if (session && hint.mediaIssue) {
      if (!current() || switching || groupId!==hint.groupId) return false;
      showIssueMedia(hint);return true;
    }
    if (session) close();
    if (window.canOpenQQDailyGroupPolicy?.() === false) {
      toast(tr('请先处理已打开的群设置草稿。','Finish the existing group settings draft first.'));return false;
    }
    previousFocus = hint.returnFocus instanceof HTMLElement && hint.returnFocus.isConnected ? hint.returnFocus : document.activeElement;
    session = {};switching = '';notice = '';groupVoice = hint.groupVoice === true;
    const id = snapshot.accounts?.selectedId || '', account = qq()?.expectedAccountId || '';
    const matches = (!hint.profileId || hint.profileId === id) && (!hint.expectedAccountId || hint.expectedAccountId === account);
    targetProfile = matches && account ? id : '';targetQQ = matches ? account : '';
    groupId = matches && hint.profileId === id && hint.expectedAccountId === account &&
      qq()?.groups?.groupIds?.includes(hint.groupId) ? hint.groupId : '';
    contextName = groupId && typeof hint.groupName === 'string' ? hint.groupName.slice(0,120) : '';
    mount();
    dialog.showModal();
    showPage(groupVoice ? 'policy' : 'role');syncGroup();
    if (hint.mediaIssue) showIssueMedia(hint);
    else (groupId ? byId('bot-qq-group-role-card') : current() && !picker.disabled ? picker : profile).focus();
    return dialog.open;
  }
  function update(next, names) {
    snapshot = next;
    directory = names || [];
    entry.hidden = next.bot?.channel !== 'qq' || next.desktopChat?.kind === 'local';
    entry.textContent = tr('群设置','Group settings');
    if (!session) return;
    if (issueTarget && !matchesMediaIssue(issueTarget)) {
      issueTarget=null;groupId='';contextName='';
      if (!current()) {targetProfile='';targetQQ='';}
      notice=tr('搭档、群或人设已变更，请重新选择。','The companion, group or role has changed. Choose the current target.');
      syncGroup();return;
    }
    if ((targetProfile && !current()) || (groupId && !qq()?.groups?.groupIds?.includes(groupId) && !membership.removing(groupId))) {
      if (!current()) {targetProfile = '';targetQQ = '';}
      groupId = '';contextName = '';syncGroup();return;
    }
    refresh();
  }
  function revealPreview() {
    if (!session || page !== 'role') return;
    const body = byId('qq-daily-body'), preview = byId('bot-qq-group-role-preview');
    const text = byId('bot-qq-group-role-preview-description').getBoundingClientRect();
    const action = byId('bot-qq-group-role-approve').getBoundingClientRect();
    if (text.top + Math.min(text.height, 26) > action.top) {
      body.scrollTop += Math.max(0, preview.getBoundingClientRect().top - body.getBoundingClientRect().top - 8);
    }
  }
  window.ArcadeQQDailySettings = {open,update,revealPreview};
})();
