'use strict';

window.createQQGroupMembership = ({acceptGroups, refreshSnapshot}) => {
  const element = document.createElement('section');
  element.className = 'qq-group-membership';
  element.hidden = true;
  element.innerHTML = `
    <p data-current></p>
    <div class="qq-membership-actions">
      <button type="button" class="secondary" data-toggle></button>
      <button type="button" class="plain" data-remove></button>
      <button type="button" class="secondary" data-directory></button>
    </div>
    <div data-review hidden>
      <p data-impact></p>
      <div class="qq-membership-actions">
        <button type="button" class="secondary" data-confirm></button>
        <button type="button" class="plain" data-cancel></button>
      </div>
    </div>
    <div data-add-form hidden>
      <label><span data-choose></span><select data-choice></select></label>
      <p data-add-effects></p>
      <button type="button" class="secondary" data-add></button>
    </div>
    <p data-feedback role="status"></p>`;
  const get = key => element.querySelector('[data-' + key + ']');
  const choice = get('choice');
  let view, groups, tr, proactiveChat;
  const groupList = value => value?.groupIds || [];
  const paused = (value, id) => (value?.pausedGroupIds || []).includes(id);
  const available = () => typeof groups?.membershipRevision === 'string' && Boolean(groups.membershipRevision);
  const operations = () => window.arcade;
  const title = ({id,name}) => name ? name + ' · ' + id : id;

  function impact(id) {
    const card = groups.roles?.find(row => row.groupId === id)?.name;
    const books = (groups.lorebooks || []).filter(row => row.groupId === id).map(row => row.name).filter(Boolean);
    const media = groups.outgoingMedia?.find(row => row.groupId === id);
    const approvedMedia = Boolean(media?.assets?.length || media?.reactionAssets?.length ||
      media?.namedStickers?.some(item => item.request || item.reaction));
    const details = [];
    if (card) details.push(tr('角色卡：','Role card: ') + card);
    if (books.length) details.push(tr('世界书：','World books: ') + books.join(tr('、', ', ')));
    if (approvedMedia) details.push(tr('已批准的发送素材','Approved outgoing media'));
    return tr('移出会撤下本群的角色卡、世界书、媒体、生图许可及其他群专属设置。',
      'Removing clears this group’s role, world books, media and drawing permissions, and other group-specific settings.') +
      (details.length ? ' ' + details.join(tr('。', '. ')) + tr('。', '.') : '');
  }

  function render() {
    element.hidden = !view || !available();
    if (element.hidden) return;
    const {id, busy, review, entries, feedback} = view;
    const inList = groupList(groups).includes(id), full = groupList(groups).length >= 5;
    const isPaused = inList && paused(groups, id);
    get('current').textContent = !inList ? '' : isPaused
      ? tr('本群已暂停接话和主动说话，角色卡和批准仍保留。恢复后沿用原设定。',
        'Replies and proactive messages are paused here. The role and approvals are kept and reused when resumed.')
      : groups.reviewRequiredGroupIds?.includes(id) ? tr('本群角色待重新批准。','Review this group’s role to resume replies.')
        : tr('本群已在名单中。','This group is on the list.');
    get('toggle').hidden = get('remove').hidden = !inList;
    get('toggle').textContent = isPaused ? tr('恢复本群','Resume this group') : tr('暂停本群','Pause this group');
    get('remove').textContent = tr('移出名单','Remove from list');
    get('directory').textContent = full ? tr('已达 5 群上限','Five-group limit reached') : tr('从群目录加入','Add from QQ groups');
    get('directory').disabled = busy || full || Boolean(review);
    get('toggle').disabled = get('remove').disabled = busy || Boolean(review);
    get('review').hidden = !review || !inList;
    get('impact').textContent = review && inList ? view.name + ' · QQ ' + view.identity.expectedAccountId +
      tr('。搭档将停止服务此群，QQ 账号仍留在群里。',' . The companion will stop serving it. The QQ account stays in the group.') +
      ' ' + impact(id) : '';
    get('confirm').textContent = tr('确认移出','Confirm removal');
    get('confirm').disabled = busy;
    get('cancel').textContent = tr('取消','Cancel');
    get('cancel').disabled = busy;
    get('add-form').hidden = !entries.length || full || Boolean(review);
    get('choose').textContent = tr('选择要加入的群','Choose the group to add');
    get('add').textContent = tr('加入所选群','Add selected group');
    const options = [['', tr('选择一个群','Choose a group')], ...entries.map(row => [row.id,title(row)])];
    if (choice.dataset.options !== JSON.stringify(options)) {
      choice.replaceChildren(...options.map(([id,label]) => new Option(label,id)));
      choice.dataset.options = JSON.stringify(options);
    }
    choice.value = view.selected;
    choice.disabled = busy;
    const selected = entries.find(item => item.id === view.selected);
    get('add').disabled = busy || !selected;
    get('add-effects').textContent = !selected ? '' :
      title(selected) + ' · QQ ' + view.identity.expectedAccountId +
      tr('。加入后，这位搭档可在本群接话。',' . After joining, this companion can reply here.') +
      (groups.proactive === true && proactiveChat
        ? tr('也可按「相处方式」设定的时段和频率主动说话。',' It can also start conversations within the configured hours and frequency.')
        : tr('当前设置下，搭档不会在本群主动说话。',' The current settings keep proactive messages off here.')) +
      tr('收图、语音、发送素材和付费生图须在本群另行批准。',' Receiving images, voice, outgoing media and paid drawing require separate approval for this group.');
    get('feedback').textContent = feedback;
  }

  function request() {
    return {...view.identity, expectedRevision:groups.membershipRevision};
  }

  function checkedGroups(bot, account) {
    const saved = bot?.qq?.groups;
    if (bot?.channel !== 'qq' || bot.status !== 'connected' || bot.qq.expectedAccountId !== account ||
        typeof saved?.membershipRevision !== 'string' || !saved.membershipRevision || !Array.isArray(saved.groupIds)) {
      throw Error('QQ membership context changed');
    }
    return saved;
  }

  async function recover(captured, payload) {
    try {
      const fresh = await refreshSnapshot();
      if (view !== captured || fresh.accounts?.selectedId !== payload.profileId) return;
      const checked = checkedGroups(fresh.bot, payload.expectedAccountId);
      acceptGroups(payload.expectedRevision, checked);
    } catch { /* A later app snapshot can restore the controls. */ }
  }

  get('directory').onclick = async () => {
    const captured = view, payload = request();
    captured.busy = true;
    captured.entries = [];
    captured.feedback = tr('正在读取群目录…','Reading QQ groups…');
    render();
    try {
      const response = await operations().botGroupMembershipDirectory(payload);
      if (view !== captured || groups.membershipRevision !== payload.expectedRevision) return;
      if (response.accountId !== payload.expectedAccountId || response.membershipRevision !== payload.expectedRevision ||
          !Array.isArray(response.items)) throw Error('QQ group directory changed');
      const unique = new Map(response.items.filter(row => /^\d{5,15}$/.test(row?.id) && typeof row.id === 'string' &&
        typeof row.name === 'string' && !groupList(groups).includes(row.id)).map(row => [row.id,row]));
      captured.entries = [...unique.values()];
      captured.selected = '';
      captured.feedback = captured.entries.length ? '' : tr('这个 QQ 账号没有其他可加入的群。','This QQ account has no other groups to add.');
    } catch {
      if (view === captured) captured.feedback = tr('未能读取此 QQ 的群目录，请重试。','Could not read the groups for this QQ account. Try again.');
    } finally {
      if (view === captured) {captured.busy = false; render();}
    }
  };

  async function save(action, groupId, label) {
    if (!view || view.busy || !available()) return;
    const captured = view, payload = request();
    captured.busy = true;
    captured.removing = action === 'remove' ? groupId : '';
    captured.feedback = tr('正在保存…','Saving…');
    render();
    try {
      const reply = await operations().botGroupMembershipSet({...payload, action, groupId});
      if (view !== captured) return;
      const saved = checkedGroups(reply, payload.expectedAccountId);
      if (reply.mode !== payload.expectedMode || saved.membershipRevision === payload.expectedRevision ||
          groupList(saved).includes(groupId) !== (action !== 'remove') ||
          (action !== 'remove' && paused(saved, groupId) !== (action === 'pause'))) throw Error('QQ group change unconfirmed');
      if (!acceptGroups(payload.expectedRevision, saved, action === 'remove' ? '' : groupId)) {
        throw Error('QQ group settings changed again');
      }
      const messages = {
        add: tr('已加入，可在本群接话。','Added. Replies are enabled for this group.'),
        remove: tr('已从搭档的群名单移出。','Removed from this companion’s groups.'),
        pause: tr('已暂停本群。','This group is paused.'),
        resume: tr('已恢复本群。','This group is resumed.')
      };
      view.feedback = label + ' · ' + messages[action];
      view.busy = false;
      render();
      if (action === 'add') get('toggle').focus();
      if (action === 'remove') get('directory').focus();
    } catch {
      if (view !== captured) return;
      captured.feedback = tr('未确认保存，请核对当前状态后重试。','Save unconfirmed. Check the current state and try again.');
      await recover(captured, payload);
    } finally {
      captured.busy = false;
      captured.removing = '';
      if (view === captured) render();
    }
  }

  get('toggle').onclick = () => save(paused(groups,view.id) ? 'resume' : 'pause',view.id,view.name);
  get('remove').onclick = () => {view.review = impact(view.id); render(); get('cancel').focus();};
  get('confirm').onclick = () => {
    if (impact(view.id) !== view.review) {
      view.review = false;
      view.feedback = tr('群批准已变化，请重新查看移出影响。','Group approvals changed. Review removal again.');
      render();
      get('remove').focus();
      return;
    }
    void save('remove',view.id,view.name);
  };
  get('cancel').onclick = () => {view.review = false; render(); get('remove').focus();};
  choice.onchange = () => {view.selected = choice.value; render();};
  get('add').onclick = () => {
    const selected = view.entries.find(row => row.id === view.selected);
    if (selected) void save('add',selected.id,title(selected));
  };

  return {
    element,
    removing: id => view?.removing === id,
    update(identity, saved, id, name, translate, companionProactive) {
      groups = saved;
      tr = translate;
      proactiveChat = companionProactive;
      if (!identity || !available() || typeof operations().botGroupMembershipDirectory !== 'function' ||
          typeof operations().botGroupMembershipSet !== 'function') view = null;
      else {
        const key = JSON.stringify([identity,id]);
        if (view?.key !== key) view = {key,identity,id,name,entries:[],selected:'',feedback:'',revision:saved.membershipRevision};
        else if (view.revision !== saved.membershipRevision) {
          Object.assign(view,{revision:saved.membershipRevision,entries:[],selected:'',review:false,feedback:''});
        }
      }
      render();
    }
  };
};
