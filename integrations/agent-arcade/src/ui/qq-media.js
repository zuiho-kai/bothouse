'use strict';
(() => {
  if(typeof window.arcade.qqImagePick!=='function')return;
  const button=el('button','secondary qq-media-entry');button.id='qq-media-open';button.hidden=true;
  document.querySelector('.bot-heading-actions')?.prepend(button);
  const drawer=el('dialog','qq-media');drawer.id='qq-media';drawer.setAttribute('aria-labelledby','qq-media-title');document.body.append(drawer);
  let latest=null,language='zh',panel=null,draft=null,waiting=false,feedback='',problem=false,epoch=0,timer=null,returnFocus=null,receipt=null;
  const tr=(zh,en)=>language==='zh'?zh:en;
  const selected = () => latest?.accounts?.selectedId;
  const account = () => latest?.accounts?.accounts?.find(row => row.id === selected());
  const mac = () => window.arcade.platform?.os === 'darwin';
  const qqNumber = /^[1-9]\d{4,14}$/;
  const owner = Object.freeze({});
  function groupTargets() {
    if (!mac() && window.arcade.platform?.os !== 'win32') return [];
    const targets = latest?.bot?.media?.groupTargets;
    if (!Array.isArray(targets)) return [];
    return targets.filter(target => target && typeof target.groupId === 'string' && qqNumber.test(target.groupId) &&
      typeof target.role === 'string' && target.role.trim() && target.role.length <= 64 &&
      typeof target.roleId === 'string' && target.roleId.length > 0 && target.roleId.length <= 64 &&
      targets.filter(other => other?.groupId === target.groupId).length === 1);
  }
  const supported = () => latest?.bot?.channel === 'qq' && latest.bot.media?.supported === true &&
    (!mac() || groupTargets().length > 0);
  const available = () => supported() && latest.bot.media.available === true;
  const binding = target => JSON.stringify([selected(), account()?.accountId, latest?.bot?.status,
    ...(target === owner ? [latest?.bot?.qq?.ownerId, latest?.persona?.id, latest?.persona?.name] : [latest?.bot?.qq?.expectedAccountId])]);
  const currentGroup = target => groupTargets().some(row => row.groupId === target.groupId &&
    row.roleId === target.roleId && row.role === target.role);
  const groupNameOf = value => typeof value === 'string' && value.trim() && value.length <= 128 && !/[\p{Cc}\p{Cf}]/u.test(value) ? value : '';
  const groupLabel = (groupId, groupName) => groupName ? groupId + ' · ' + groupName : groupId;
  const problems={
    disconnected:['请先连接这位搭档的 QQ，再选择图片。','Connect this companion’s QQ before choosing an image.'],
    changed:['搭档或连接已变化，请关闭后重新选择图片。','The companion or connection changed. Close this view and choose the image again.'],
    operation_in_progress:['上一项图片操作尚未结束，请稍候。','The previous image operation is still finishing. Please wait.'],
    image_too_large:['图片超过处理范围。请选择 8 MiB 以内、边长不超过 8192 像素的图片；处理后的图片也有大小限制。','The image exceeds processing limits. Choose a file up to 8 MiB and 8192 pixels per edge; the processed image also has size limits.'],
    image_invalid:['无法读取这张图片。请选择有效的 PNG 或 JPEG。','This image could not be read. Choose a valid PNG or JPEG.'],
    image_format:['这里只支持静态 PNG 和 JPEG 图片。','Only static PNG and JPEG images are supported here.'],
    image_animated:['暂不支持动态图，请选择静态 PNG 或 JPEG。','Animated images are not supported. Choose a static PNG or JPEG.'],
    unsafe_file:['图片路径包含不支持的链接，请重新选择本机原文件。','The image path contains an unsupported link. Choose the original local file.'],
    file_changed:['选择期间图片发生变化，请重新选择。','The image changed while being read. Choose it again.'],
    file_unavailable:['图片无法读取，请检查文件后重新选择。','The file is unavailable. Check it and choose it again.'],
    expired_ticket:['图片预览已过期，请重新选择。','The image preview expired. Choose it again.'],
    stale_ticket:['这份预览已失效，请重新选择图片。','This preview is no longer valid. Choose the image again.'],
    group_unavailable:['无法核实这个群的授权、搭档角色或当前成员资格。请检查 QQ 群聊设置。','This group’s authorization, companion role, or membership could not be verified. Check QQ group settings.'],
    account_mismatch:['QQ 身份与当前搭档不符，未继续发送。请检查连接。','The QQ identity does not match this companion. Sending did not continue. Check the connection.'],
    account_changed:['QQ 身份发生变化，未继续发送。请检查连接。','The QQ identity changed. Sending did not continue. Check the connection.'],
    account_offline:['QQ 尚未在线，请恢复连接后重新选择图片。','QQ is not online. Restore its connection and choose the image again.'],
    status_unverified:['无法核实 QQ 在线状态，请检查连接后重试。','QQ online status could not be verified. Check the connection.'],
    bridge_unhealthy:['本机 QQ 连接状态异常，请检查 QQ 账号页。','The local QQ connection is unhealthy. Check QQ accounts.'],
    cancelled:['已取消，没有继续发送图片。','Cancelled. Image sending did not continue.'],
    send_rejected:['QQ 拒绝了发送请求，图片未发送。','QQ rejected the send request. No image was sent.'],
  };
  const explain=code=>problems[code]?tr(...problems[code]):tr('图片操作未完成。请检查连接与图片后重新选择。','The image operation did not complete. Check the connection and image before choosing again.');
  const args = (source = panel) => ({accountId: source.accountId, panelId: source.panelId,
    ...(source.target?.groupId ? {groupId: source.target.groupId} : {})});
  const matchesPanel = (value, source = panel) => value?.accountId === source.accountId && value.panelId === source.panelId && value.groupId === source.target?.groupId;
  function validRecipient(value, source = panel) {
    if (!value || !qqNumber.test(value.accountId) || typeof value.role !== 'string' || value.role.length > 64) return false;
    if (source.target === owner) return qqNumber.test(value.ownerId) && !Object.hasOwn(value, 'groupId');
    return !!source.target && value.accountId === source.qqAccountId && value.groupId === source.target.groupId &&
      value.role === source.target.role && value.roleId === source.target.roleId && !Object.hasOwn(value, 'ownerId');
  }
  function action(id, label, fn, disabled = false, primary = false) {
    const node = el('button', primary ? 'primary' : 'secondary', label);
    node.id = id; node.type = 'button'; node.disabled = disabled; node.onclick = fn;
    return node;
  }
  function clearDraft() { clearTimeout(timer); timer = null; draft = null; receipt = null; }
  function replacePanel(next) {
    const previous = panel;
    epoch++; panel = next; clearDraft(); waiting = false; feedback = ''; problem = false;
    return previous;
  }
  function newPanel(target) {
    return {accountId: selected(), qqAccountId: account()?.accountId, panelId: crypto.randomUUID(), binding: binding(target), target};
  }
  function close() {
    const previous = replacePanel(null);
    if (drawer.open) drawer.close(); drawer.replaceChildren(); document.documentElement.classList.remove('qq-media-open');
    if (previous?.target) void window.arcade.qqImageClose(args(previous)).catch(() => {});
    if (returnFocus?.isConnected && !returnFocus.hidden) returnFocus.focus({preventScroll: true});
  }
  async function changeTarget(groupId) {
    if (!panel || panel.fixedGroup || waiting) return;
    const target = groupId === 'owner' && !mac() ? owner : groupTargets().find(row => row.groupId === groupId) || null;
    const next = newPanel(target), previous = replacePanel(next);
    waiting = !!previous.target;
    draw();
    if (previous.target) {
      const result = await window.arcade.qqImageClose(args(previous)).catch(() => null);
      if (panel !== next || !drawer.open) return;
      if (result?.ok !== true) {
        waiting = false; feedback = explain(result?.code || 'operation_in_progress'); problem = true; draw(); return;
      }
    }
    waiting = false; draw(); $('qq-media-target')?.focus({preventScroll: true});
  }
  function validDraft(value, source) {
    return value?.kind === 'image' && typeof value.ticketId === 'string' && /^[a-f0-9-]{36}$/.test(value.ticketId) &&
      typeof value.preview === 'string' && value.preview.length <= 710000 && /^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(value.preview) &&
      Number.isSafeInteger(value.width) && value.width >= 1 && value.width <= 2048 &&
      Number.isSafeInteger(value.height) && value.height >= 1 && value.height <= 2048 &&
      Number.isSafeInteger(value.bytes) && value.bytes >= 1 && value.bytes <= 4 * 1024 * 1024 &&
      Number.isSafeInteger(value.expiresAt) && value.expiresAt > Date.now() && validRecipient(value.recipient, source);
  }
  function acceptDraft(value, token) {
    draft = value;
    timer = setTimeout(() => {
      if (token !== epoch || !panel || !draft) return;
      const id = draft.ticketId; clearDraft(); feedback = explain('expired_ticket'); problem = false;
      void window.arcade.qqImageDiscard({...args(), ticketId: id}).catch(() => {}); draw();
    }, Math.min(5 * 60 * 1000, value.expiresAt - Date.now() + 1));
  }
  async function choose() {
    if (!panel?.target || waiting) return;
    const source = panel, token = ++epoch;
    const current = () => token === epoch && panel === source && drawer.open;
    clearDraft(); waiting = true; feedback = tr('正在选择并处理图片…', 'Choosing and preparing the image…'); problem = false; draw();
    try {
      const result = await window.arcade.qqImagePick(args(source));
      if (!current()) return;
      if (result?.ok !== true) { problem = result?.code !== 'cancelled'; feedback = explain(result?.code); return; }
      if (result.cancelled) { feedback = tr('已取消选择，没有发送图片。', 'Selection cancelled. No image was sent.'); return; }
      if (!matchesPanel(result, source)) { problem = true; feedback = explain('changed'); return; }
      if (!validDraft(result.draft, source)) throw Error('Invalid preview');
      if (source.target.groupId) {
        const image = new Image(); image.src = result.draft.preview;
        await image.decode();
        if (!current()) return;
        if (image.naturalWidth < 1 || image.naturalHeight < 1 || result.draft.expiresAt <= Date.now()) throw Error('Invalid image');
      }
      acceptDraft(result.draft, token); feedback = '';
    } catch {
      if (current()) {
        problem = true; feedback = tr('图片预览暂不可用，没有发出图片。请重新选择。', 'The image preview is unavailable. No image was sent. Choose it again.');
      }
    } finally {
      if (current()) {
        waiting = false; draw();
        if (source.target.groupId && draft) {
          const content = drawer.querySelector('.qq-media-content');
          content.scrollTop = 0;
          $('qq-media-recipient')?.focus({preventScroll: true});
        }
      }
    }
  }
  async function remove() {
    if (!panel || waiting || !draft) return;
    const id = draft.ticketId, token = ++epoch; clearDraft(); waiting = true; feedback = ''; draw();
    try { await window.arcade.qqImageDiscard({...args(), ticketId: id}); } catch {}
    finally { if (token === epoch && panel) { waiting = false; draw(); } }
  }
  async function send() {
    if (!panel || waiting || !draft || !validRecipient(draft.recipient)) return;
    const {ticketId: id, recipient: {accountId, ownerId, groupId, role, groupName}} = draft, token = ++epoch;
    const recipient = groupId ? {accountId, groupId, role, groupName: groupNameOf(groupName)} : {accountId, ownerId};
    clearDraft(); waiting = true; problem = false;
    feedback = groupId ? tr(`正在向 QQ 群 ${groupId} 发送图片…`, `Sending an image to QQ group ${groupId}…`) : tr('正在向主人 QQ 发送…', 'Sending to the owner on QQ…');
    draw();
    try {
      const result = await window.arcade.qqImageSend({...args(), ticketId: id});
      if (token !== epoch || !panel || !drawer.open) return;
      const belongs = result?.ok === true && matchesPanel(result) && result.ticketId === id && result.kind === 'image';
      if (belongs && result.outcome === 'accepted' && typeof result.messageId === 'string' && /^-?\d{1,20}$/.test(result.messageId)) {
        receipt = {messageId: result.messageId, ...recipient};
        feedback = tr('QQ 已接受图片发送请求。请在 QQ 中查看图片。', 'QQ accepted the image send request. Check the image in QQ.'); problem = false;
      } else if (belongs && result.outcome === 'not_sent') { feedback = explain(result.code); problem = result.code !== 'cancelled'; }
      else {
        feedback = tr('是否发送成功尚未确认。请先在 QQ 查看，避免重复发送；这份预览不会重发。', 'The send outcome is unconfirmed. Check QQ before sending another copy. This preview will not be sent again.'); problem = true;
      }
    } catch {
      if (token === epoch && panel) {
        feedback = tr('是否发送成功尚未确认。请先在 QQ 查看；这份预览不会重发。', 'The send outcome is unconfirmed. Check QQ; this preview will not be sent again.'); problem = true;
      }
    } finally { if (token === epoch && panel && drawer.open) { waiting = false; draw(); } }
  }
  function groupPicker(targets, groupId) {
    const picker = el('div', 'qq-media-target'), select = el('select'), label = el('label', '', tr('发送目标', 'Recipient'));
    select.id = 'qq-media-target'; label.htmlFor = select.id;
    const option = (id, text) => { const node = el('option', '', text); node.value = id; return node; };
    select.append(mac() ? option('', tr('请选择一个群', 'Choose a group')) : option('owner', tr('主人 QQ', 'Owner QQ')));
    for (const {groupId, role} of targets) select.append(option(groupId, tr(`群 ${groupId} · ${role}`, `Group ${groupId} · ${role}`)));
    select.value = groupId || (panel.target === owner ? 'owner' : ''); select.disabled = waiting; select.onchange = () => void changeTarget(select.value);
    picker.append(label, select); return picker;
  }
  function renderRecipient(recipient) {
    const {accountId, ownerId, groupId, role, groupName} = recipient;
    const section = el('section', 'qq-media-recipient'), destination = groupId && groupLabel(groupId, groupNameOf(groupName));
    section.id = 'qq-media-recipient'; section.tabIndex = -1;
    section.append(el('strong', '', role || tr('当前搭档', 'Current companion')),
      el('p', '', tr(`发送账号 QQ ${accountId}`, `Sending account: QQ ${accountId}`)),
      el('p', '', groupId ? tr(`目标 QQ 群 ${destination}`, `Recipient: QQ group ${destination}`) : tr(`主人 QQ ${ownerId}`, `Owner: QQ ${ownerId}`)));
    if (panel?.fixedGroup && account()?.name) {
      section.prepend(el('p', '', tr(`搭档 · ${account().name}`, `Companion · ${account().name}`)));
    }
    return section;
  }
  function renderReceipt() {
    const details = el('details', 'qq-media-receipt'), summary = el('summary', '', tr('发送详情', 'Send details'));
    details.id = 'qq-media-receipt'; summary.id = 'qq-media-receipt-summary';
    details.open = $('qq-media-receipt')?.open === true; details.append(summary);
    const fields = [['messageId', tr('消息 ID', 'Message ID')], ['accountId', tr('发送账号 QQ', 'From QQ')]];
    if (receipt.groupId) fields.push(['groupId', tr('目标 QQ 群', 'QQ group')], ['role', tr('角色', 'Role')]);
    else fields.push(['ownerId', tr('主人 QQ', 'Owner QQ')]);
    for (const [key, label] of fields) {
      const value = key === 'groupId' ? groupLabel(receipt.groupId, receipt.groupName) : receipt[key];
      const row = el('p', '', `${label}：${value}`); row.dataset.field = key; details.append(row);
    }
    details.append(el('p', 'qq-media-note', tr('这是本次请求的回执，不代表对方已收到或查看图片。', 'This is the request receipt, not confirmation of delivery or viewing.')));
    return details;
  }
  function draw() {
    if (!panel) return;
    const focus = document.activeElement?.id, scroll = drawer.querySelector('.qq-media-content')?.scrollTop || 0;
    const group = panel.target?.groupId, groupMode = mac() || !!group, targets = groupTargets();
    const head = el('div', 'qq-media-heading'), heading = el('div'), title = el('h2', '', tr('分享图片', 'Share an image'));
    title.id = 'qq-media-title';
    heading.append(title, el('p', '', groupMode ? tr('由当前搭档的 QQ 发到所选群', 'Send from this companion’s QQ to the selected group') : tr('由当前搭档的 QQ 发给主人', 'Send from this companion’s QQ to its owner')));
    head.append(heading, action('qq-media-close', tr('关闭', 'Close'), close));
    const content = el('div', 'qq-media-content');
    if (targets.length && !panel.fixedGroup) content.append(groupPicker(targets, group));
    if (draft) {
      content.append(renderRecipient(draft.recipient));
      const figure = el('figure', 'qq-media-preview'), image = el('img');
      image.src = draft.preview; image.alt = tr('待发送图片的本机预览', 'Local preview of the image to send');
      figure.append(image, el('figcaption', '', `${draft.width} × ${draft.height} · ${(draft.bytes / 1024).toFixed(0)} KiB`));
      content.append(figure);
    } else if (panel.target) {
      if (group) content.append(renderRecipient({accountId: panel.qqAccountId, ...panel.target}));
      const empty = el('div', 'qq-media-empty');
      empty.append(el('p', '', tr('选择一张图片，先检查预览和接收对象。', 'Choose an image, then review its preview and recipient.')),
        el('p', '', tr('PNG / JPEG · 本机文件不超过 8 MiB', 'PNG / JPEG · local files up to 8 MiB')));
      content.append(empty);
    }
    if (panel.target) {
      content.append(el('p', 'qq-media-note', group ? tr('图片会在本机缩放并去除附加信息。核对群号、角色和预览后再发送。开启该群识图时，成员随后引用图片，正式回复可在短时间内读到图片。', 'The app resizes the image and removes metadata locally. Review the group number, role and preview before sending. With image input enabled, a member can quote the image for a reply shortly after.') : tr('只在点击“发送给主人”后发送。图片会缩放并去除附加信息；不会交给 AI 识图，也不会发布到群或空间。', 'Only Send to owner sends it. The image is resized and extra metadata removed. It is not sent to an AI for analysis, a group or Qzone.')));
      const actions = el('div', 'qq-media-actions');
      actions.append(action('qq-media-choose', draft ? tr('换一张', 'Choose another') : tr('选择图片', 'Choose image'), () => void choose(), waiting));
      if (draft) actions.append(action('qq-media-remove', tr('移除图片', 'Remove image'), () => void remove(), waiting));
      content.append(actions);
    }
    const footer = el('div', 'qq-media-footer'), result = el('div', 'qq-media-result'), status = el('p', problem ? 'problem' : '', feedback);
    status.id = 'qq-media-status'; status.setAttribute('role', problem ? 'alert' : 'status'); result.append(status);
    if (receipt) result.append(renderReceipt());
    const confirmation = group ? tr(`发送到群 ${group}`, `Send to group ${group}`) : groupMode ? tr('发送到群', 'Send to group') : tr('发送给主人', 'Send to owner');
    footer.append(result, action('qq-media-send', confirmation, () => void send(), waiting || !draft, true));
    drawer.replaceChildren(head, content, footer); if (groupMode) content.scrollTop = scroll;
    const restore = focus && $(focus); if (restore && drawer.contains(restore) && !restore.disabled) restore.focus({preventScroll: true});
  }
  function openPanel(target, fixedGroup = false, opener = document.activeElement) {
    returnFocus = opener; replacePanel({...newPanel(target),fixedGroup});
    draw(); document.documentElement.classList.add('qq-media-open'); drawer.showModal();
    const picker = $('qq-media-target');
    (picker || $('qq-media-close'))?.focus();
    if (!picker) void choose();
  }
  button.onclick = () => {
    if (!available() || !selected() || panel) return;
    openPanel(mac() ? null : owner);
  };
  window.ArcadeQQMedia = {openForGroup({profileId, expectedAccountId, groupId, roleId, returnFocus:opener} = {}) {
    if (panel || !available() || latest?.bot?.status !== 'connected' || profileId !== selected() ||
      !qqNumber.test(expectedAccountId || '') || latest.bot.qq?.expectedAccountId !== expectedAccountId ||
      account()?.accountId !== expectedAccountId) return false;
    const target = groupTargets().find(row => row.groupId === groupId && row.roleId === roleId);
    if (!target) return false;
    openPanel(target, true, opener);
    return true;
  }};
  drawer.addEventListener('cancel', event => { event.preventDefault(); close(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden && panel) close(); });
  window.addEventListener('pagehide', close);
  const previous = window.renderBot;
  window.renderBot = next => {
    previous?.(next); latest = next; language = next.config?.language || 'en';
    button.textContent = tr('分享图片', 'Share image'); button.hidden = !supported(); button.disabled = !available();
    button.title = available() ? (groupTargets().length ? tr('选择接收对象，预览后发送', 'Choose the recipient, preview the image, then send') : tr('预览后，由搭档 QQ 发给主人', 'Preview, then send from this companion’s QQ to its owner')) : tr('请先连接当前搭档的 QQ', 'Connect this companion’s QQ first');
    if (!panel) return;
    const target = panel.target;
    if (view !== 'bot' || next.bot?.status !== 'connected' || !supported() || binding(target) !== panel.binding || (target?.groupId && !currentGroup(target))) { close(); return; }
    const currentDraft = next.bot.media.draft;
    if (draft && (currentDraft?.ticketId !== draft.ticketId || (target?.groupId && !validRecipient(currentDraft.recipient)))) {
      clearDraft(); feedback = explain('stale_ticket'); problem = false;
    }
    draw();
  };
  if (typeof data !== 'undefined' && data) window.renderBot(data);
})();
