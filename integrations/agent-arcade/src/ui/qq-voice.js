'use strict';
(() => {
  if (typeof window.arcade.qqVoicePick !== 'function') return;
  const button = el('button', 'secondary qq-voice-entry');
  button.id = 'qq-voice-open'; button.hidden = true;
  const imageButton = $('qq-media-open');
  if (imageButton) imageButton.after(button);
  else document.querySelector('.bot-heading-actions')?.prepend(button);
  const drawer = el('dialog', 'qq-voice');
  drawer.id = 'qq-voice'; drawer.setAttribute('aria-labelledby', 'qq-voice-title'); document.body.append(drawer);
  let latest = null, language = 'zh', panel = null, draft = null, waiting = false, feedback = '', problem = false;
  let epoch = 0, timer = null, returnFocus = null, audio = null, playback = 'idle', playEpoch = 0;
  let textDraft = '', generator = 'checking', generatorReason = '', renderOp = null, composing = false, draftSource = null, receipt = null, progressTimer = null;
  const tr = (zh, en) => language === 'zh' ? zh : en;
  const selected = () => latest?.accounts?.selectedId;
  const account = () => latest?.accounts?.accounts?.find(row => row.id === selected());
  const mac = () => window.arcade.platform?.os === 'darwin';
  const qqNumber = /^[1-9]\d{4,14}$/;
  const owner = Object.freeze({});
  function groupTargets() {
    const targets = latest?.bot?.voiceMedia?.groupTargets;
    if (!Array.isArray(targets)) return [];
    return targets.filter(target => target && typeof target.groupId === 'string' && qqNumber.test(target.groupId) &&
      typeof target.role === 'string' && target.role.trim() && target.role.length <= 64 &&
      typeof target.roleId === 'string' && target.roleId.length > 0 && target.roleId.length <= 64 &&
      targets.filter(row => row?.groupId === target.groupId).length === 1);
  }
  const supported = () => latest?.bot?.channel === 'qq' && (mac() ? groupTargets().length > 0 : latest.bot.voiceMedia?.supported === true);
  const available = () => supported() && latest.bot.voiceMedia?.available === true;
  const binding = target => JSON.stringify([selected(), account()?.accountId, latest?.bot?.status,
    ...(target === owner ? [latest?.bot?.qq?.ownerId, latest?.persona?.id, latest?.persona?.name] : [])]);
  const groupCurrent = target => groupTargets().some(row => row.groupId === target.groupId && row.roleId === target.roleId && row.role === target.role);
  const canSend = () => !waiting && !!draft && !!panel?.target;
  const groupNameOf = value => typeof value === 'string' && value.trim() && value.length <= 128 && !/[\p{Cc}\p{Cf}]/u.test(value) ? value : '';
  const groupLabel = (groupId, groupName) => groupName ? `${groupId} · ${groupName}` : groupId;
  const problems = {
    disconnected: ['请先连接这位搭档的 QQ，再选择语音。', 'Connect this companion’s QQ before choosing audio.'],
    changed: ['搭档或连接已变化，请关闭后重新选择语音。', 'The companion or connection changed. Close this view and choose audio again.'],
    operation_in_progress: ['上一项语音操作尚未结束，请稍候。', 'The previous voice operation is still finishing. Please wait.'],
    voice_too_large: ['文件超过 4 MiB，请选择更短的 WAV。', 'The file exceeds 4 MiB. Choose a shorter WAV.'],
    voice_invalid: ['无法读取这段语音，请选择有效的 WAV 文件。', 'This audio could not be read. Choose a valid WAV file.'],
    voice_format: ['请选择单声道、16 位 PCM WAV；支持 16、24、32、44.1 或 48 kHz。', 'Choose mono 16-bit PCM WAV at 16, 24, 32, 44.1 or 48 kHz.'],
    voice_duration: ['请选择 0.2–30 秒的语音。', 'Choose audio between 0.2 and 30 seconds long.'],
    voice_not_canonical: ['语音格式校验未通过，请重新选择符合要求的 WAV。', 'Audio format validation failed. Choose a supported WAV again.'],
    voice_render_unavailable: ['本机语音生成尚未配置或配置不可用。仍可选择 WAV 文件。', 'Local voice generation is not configured or its configuration is unavailable. You can still choose a WAV.'],
    voice_render_unsupported_platform: ['此平台暂不能生成语音。请选择现有的 WAV 文件。', 'Voice generation is unavailable on this platform. Choose an existing WAV.'],
    voice_render_busy: ['上一项本机语音生成尚未结束，请等待或取消。', 'The previous local generation is still finishing. Wait or cancel it.'],
    voice_render_limit: ['请缩短文字。最多 120 个字符，生成语音还需在 30 秒以内。', 'Shorten the text. It must fit 120 characters and produce audio no longer than 30 seconds.'],
    voice_render_timeout: ['本机生成超时，文字已保留。可以手动再试，或选择 WAV。', 'Local generation timed out. Your text is kept. Try again manually or choose a WAV.'],
    voice_render_failed: ['本机语音未生成，文字已保留。请检查本机语音配置，或选择 WAV。', 'Local voice generation failed. Your text is kept. Check the local voice setup or choose a WAV.'],
    voice_render_exit_unconfirmed: ['尚未确认本机语音进程已退出。请关闭面板后检查，暂不能开始新的生成。', 'The local voice process has not been confirmed stopped. Close this panel and check before starting another generation.'],
    unsafe_file: ['文件路径包含不支持的链接，请选择本机原文件。', 'The file path contains an unsupported link. Choose the original local file.'],
    file_changed: ['选择期间文件发生变化，请重新选择。', 'The file changed while being read. Choose it again.'],
    file_unavailable: ['文件无法读取，请检查文件后重新选择。', 'The file is unavailable. Check it and choose it again.'],
    expired_ticket: ['语音预览已过期，请重新选择。', 'The voice preview expired. Choose audio again.'],
    stale_ticket: ['这份预览已失效，请重新选择语音。', 'This preview is no longer valid. Choose audio again.'],
    group_unavailable: ['无法核实这个群的授权、搭档角色或当前成员资格。请检查 QQ 群聊设置。', 'This group’s authorization, companion role, or membership could not be verified. Check QQ group settings.'],
    account_mismatch: ['QQ 身份与当前搭档不符，未继续发送。请检查连接。', 'The QQ identity does not match this companion. Sending did not continue. Check the connection.'],
    account_changed: ['QQ 身份发生变化，未继续发送。请检查连接。', 'The QQ identity changed. Sending did not continue. Check the connection.'],
    account_offline: ['QQ 尚未在线，请恢复连接后重新选择语音。', 'QQ is not online. Restore its connection and choose audio again.'],
    status_unverified: ['无法核实 QQ 在线状态，请检查连接。', 'QQ online status could not be verified. Check the connection.'],
    bridge_unhealthy: ['本机 QQ 连接状态异常，请检查 QQ 账号页。', 'The local QQ connection is unhealthy. Check QQ accounts.'],
    cancelled: ['已取消，没有继续发送语音。', 'Cancelled. Voice sending did not continue.'],
  };
  const explain = code => problems[code] ? tr(...problems[code]) : tr('语音操作未完成。请检查连接和 WAV 文件后重新选择。', 'The voice operation did not complete. Check the connection and WAV before choosing again.');
  const args = (source = panel) => ({accountId: source.accountId, panelId: source.panelId,
    ...(source.target?.groupId ? {groupId: source.target.groupId} : {})});
  const matchesPanel = (result, source = panel) => result?.accountId === source.accountId && result.panelId === source.panelId && result.groupId === source.target?.groupId;
  function validRecipient(recipient) {
    if (!recipient || !qqNumber.test(recipient.accountId) || typeof recipient.role !== 'string' || recipient.role.length > 64) return false;
    const target = panel?.target;
    if (!target?.groupId) return target === owner && qqNumber.test(recipient.ownerId) && !Object.hasOwn(recipient, 'groupId');
    return recipient.accountId === panel.qqAccountId && recipient.groupId === target.groupId &&
      recipient.role === target.role && recipient.roleId === target.roleId && !Object.hasOwn(recipient, 'ownerId');
  }
  const action = (id, label, fn, disabled = false, primary = false) => { const node = el('button', primary ? 'primary' : 'secondary', label); node.id = id; node.disabled = disabled; node.onclick = fn; return node; };
  function stopPreview(release = false) {
    playEpoch++;
    if (audio) { audio.pause(); try { audio.currentTime = 0; } catch {} if (release) { audio.onended = null; audio.onerror = null; audio.removeAttribute('src'); audio.load(); audio = null; } }
    playback = 'idle';
  }
  function clearDraft() { clearTimeout(timer); timer = null; stopPreview(true); draft = null; draftSource = null; receipt = null; }
  function replacePanel(next) {
    clearTimeout(progressTimer); progressTimer = null;
    const previous = panel; epoch++; panel = next; clearDraft(); waiting = false; feedback = ''; problem = false;
    textDraft = ''; renderOp = null; composing = false; generator = 'checking'; generatorReason = '';
    return previous;
  }
  function newPanel(target) {
    return {accountId: selected(), qqAccountId: account()?.accountId, panelId: crypto.randomUUID(), binding: binding(target), target};
  }
  function close() {
    const previous = replacePanel(null);
    if (drawer.open) drawer.close(); drawer.replaceChildren(); document.documentElement.classList.remove('qq-voice-open');
    if (previous?.target) void window.arcade.qqVoiceClose(args(previous)).catch(() => {});
    if (returnFocus?.isConnected && !returnFocus.hidden) returnFocus.focus({preventScroll: true});
  }
  async function changeTarget(value) {
    if (!panel || waiting) return;
    const target = value === 'owner' && !mac() ? owner : groupTargets().find(row => row.groupId === value) || null;
    const next = newPanel(target), previous = replacePanel(next);
    waiting = !!previous.target;
    draw();
    if (previous.target) {
      const result = await window.arcade.qqVoiceClose(args(previous)).catch(() => null);
      if (panel !== next || !drawer.open) return;
      if (result?.ok !== true) { feedback = explain(result?.code || 'operation_in_progress'); problem = true; draw(); return; }
    }
    waiting = false; draw(); $('qq-voice-target')?.focus({preventScroll: true});
    if (target) void checkGenerator();
  }
  function acceptDraft(value) {
    if (!value || value.kind !== 'voice' || typeof value.ticketId !== 'string' || !/^[a-f0-9-]{36}$/.test(value.ticketId) ||
      !Number.isSafeInteger(value.bytes) || value.bytes < 44 || value.bytes > 4 * 1024 * 1024 ||
      typeof value.preview !== 'string' || value.preview.length !== 22 + 4 * Math.ceil(value.bytes / 3) || !/^data:audio\/wav;base64,[A-Za-z0-9+/]+={0,2}$/.test(value.preview) ||
      ![16000, 24000, 32000, 44100, 48000].includes(value.sampleRate) || value.channels !== 1 || value.bits !== 16 ||
      !Number.isFinite(value.durationSeconds) || value.durationSeconds < 0.2 || value.durationSeconds > 30 ||
      !Number.isSafeInteger(value.expiresAt) || value.expiresAt <= Date.now() || !validRecipient(value.recipient)) throw Error('Invalid preview');
    draft = value; audio = new Audio(); audio.preload = 'none'; audio.src = value.preview;
    const current = audio;
    audio.onended = () => { if (audio === current && panel && draft) { playback = 'ended'; drawPlayback(); } };
    audio.onerror = () => { if (audio === current && panel && draft) { playback = 'error'; drawPlayback(); } };
    const token = epoch;
    timer = setTimeout(() => { if (token !== epoch || !panel || !draft) return; const id = draft.ticketId; clearDraft(); feedback = explain('expired_ticket'); problem = false; void window.arcade.qqVoiceDiscard({...args(), ticketId: id}).catch(() => {}); draw(); }, Math.min(5 * 60 * 1000, value.expiresAt - Date.now() + 1));
  }
  async function preview() {
    if (!panel || !draft || waiting || !audio) return;
    if (playback === 'playing' || playback === 'starting') { stopPreview(); drawPlayback(); return; }
    const current = audio, token = ++playEpoch; playback = 'starting'; drawPlayback();
    try { await current.play(); if (token === playEpoch && audio === current && panel && draft) { playback = 'playing'; drawPlayback(); } else if (audio !== current) current.pause(); }
    catch { if (token === playEpoch && audio === current && panel && draft) { playback = 'error'; drawPlayback(); } }
  }
  function drawPlayback() {
    const control = $('qq-voice-preview'), state = $('qq-voice-playback'); if (!control || !state) return;
    control.textContent = playback === 'playing' || playback === 'starting' ? tr('停止试听', 'Stop preview') : tr('试听', 'Listen locally');
    control.setAttribute('aria-pressed', String(playback === 'playing' || playback === 'starting'));
    state.textContent = playback === 'playing' ? tr('正在本机播放，尚未发送。', 'Playing locally. Not sent.') : playback === 'starting' ? tr('正在准备本机播放…', 'Preparing local playback…') : playback === 'error' ? tr('本机试听失败。请检查音频输出或换一个 WAV；没有发送语音。', 'Local playback failed. Check audio output or choose another WAV. No voice was sent.') : playback === 'ended' ? tr('本机试听结束，尚未发送。', 'Local preview finished. Not sent.') : tr('点“试听”才会播放，不会自动播放。', 'Playback starts only when you choose Listen locally.');
  }
  const validText = () => !!textDraft.trim() && textDraft.length <= 240 && [...textDraft].length <= 120 && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\ud800-\udfff]/u.test(textDraft);
  function updateTextControls() {
    const counter = $('qq-voice-text-count'), generate = $('qq-voice-generate'), sendButton = $('qq-voice-send');
    if (counter) { counter.textContent = `${[...textDraft].length} / 120`; counter.classList.toggle('invalid', !!textDraft && !validText()); }
    if (generate) generate.disabled = waiting || composing || generator !== 'available' || !validText();
    if (sendButton) sendButton.disabled = !canSend();
  }
  function editText(event) {
    textDraft = event.target.value;
    if (draft) void remove(tr('文字已修改，旧语音已移除。请重新生成后试听。', 'The text changed. The old clip was removed. Generate and review it again.'));
    updateTextControls();
  }
  async function checkGenerator() {
    const current = panel;
    if (!current?.target) return;
    if (!['qqVoiceAvailability', 'qqVoiceRender', 'qqVoiceCancelRender'].every(method => typeof window.arcade[method] === 'function')) { generator = 'unavailable'; generatorReason = 'voice_render_unavailable'; draw(); return; }
    try {
      const result = await window.arcade.qqVoiceAvailability(args());
      if (panel !== current || !drawer.open) return;
      if (result?.ok === true && !matchesPanel(result, current)) { generator = 'unavailable'; generatorReason = 'changed'; }
      else {
        generator = result?.ok === true && result.available === true ? 'available' : 'unavailable';
        generatorReason = result?.ok === true ? result.reason || 'voice_render_unavailable' : result?.code || 'voice_render_unavailable';
      }
    } catch { if (panel !== current || !drawer.open) return; generator = 'unavailable'; generatorReason = 'voice_render_unavailable'; }
    if (panel === current) draw();
  }
  function finishRender(op) {
    if (renderOp !== op || panel !== op.panel || !drawer.open) return;
    clearTimeout(progressTimer); progressTimer = null;
    if (op.cancelRequested) {
      if (op.cancelFailed) { waiting = true; problem = true; feedback = tr('尚未确认本机生成已停止。请关闭此面板后检查，暂不能再次生成或选择文件。', 'Local generation has not been confirmed stopped. Close this panel and check before generating or choosing a file again.'); draw(); return; }
      if (!op.done || !op.cancelSettled) return;
      feedback = tr('已取消生成，没有发送语音。文字已保留。', 'Generation cancelled. No voice was sent. Your text is kept.'); problem = false;
    }
    renderOp = null; waiting = false; draw();
  }
  async function observeRender(op) {
    const current=()=>renderOp===op&&panel===op.panel&&op.token===epoch&&!op.done&&!op.cancelRequested&&drawer.open;
    if(!current())return;
    try{
      const result=await window.arcade.qqVoiceAvailability(args(op.panel));
      if(!current())return;
      const labels={preparing:['正在准备声音，首次使用可能需要稍等…','Preparing the voice. The first use may take a little longer…'],generating:['正在合成这段语音…','Creating this voice clip…'],finalizing:['正在检查语音，请稍候…','Checking the clip before local preview…']};
      if(result?.ok===true&&matchesPanel(result,op.panel)&&Object.hasOwn(labels,result.progress?.stage)){
        feedback=tr(...labels[result.progress.stage]);const status=$('qq-voice-status');if(status)status.textContent=feedback;
      }
    }catch{/* Keep the last observed stage; do not retry a render or change cancellation. */}
    finally{if(current())progressTimer=setTimeout(()=>void observeRender(op),750);}
  }
  async function generate() {
    if (!panel || waiting || generator !== 'available' || !validText() || composing) return;
    const op = {panel, token: ++epoch, done: false, cancelRequested: false, cancelSettled: false, cancelFailed: false};
    renderOp = op; clearDraft(); waiting = true; feedback = tr('正在本机生成语音，首次加载模型可能需要更久…', 'Generating voice locally. The first model load may take longer…'); problem = false; const text = textDraft; draw();
    progressTimer=setTimeout(()=>void observeRender(op),750);
    try {
      const result = await window.arcade.qqVoiceRender({...args(), text});
      if (renderOp !== op || panel !== op.panel || op.token !== epoch || op.cancelRequested || !drawer.open) return;
      if (result?.ok !== true) { feedback = explain(result?.code || 'voice_render_failed'); problem = result?.code !== 'cancelled'; if (result?.code === 'voice_render_exit_unconfirmed') { op.cancelRequested = true; op.cancelSettled = true; op.cancelFailed = true; } }
      else if (matchesPanel(result)) { acceptDraft(result.draft); draftSource = 'text'; feedback = tr('语音已生成。可以先试听，再决定是否发送。', 'Voice generated. Listen locally before deciding whether to send.'); }
      else { feedback = explain('changed'); problem = true; }
    } catch { if (renderOp === op && panel === op.panel && !op.cancelRequested) { clearDraft(); feedback = explain('voice_render_failed'); problem = true; } }
    finally { op.done = true; finishRender(op); }
  }
  async function cancelRender() {
    const op = renderOp; if (!panel || !op || op.cancelRequested) return;
    op.cancelRequested = true; epoch++; clearTimeout(progressTimer); progressTimer=null; clearDraft(); feedback = tr('正在停止本机生成，请稍候…', 'Stopping local generation. Please wait…'); problem = false; draw();
    try { const result = await window.arcade.qqVoiceCancelRender(args()); op.cancelFailed = result?.ok !== true || result.cancelled !== true; }
    catch { op.cancelFailed = true; }
    finally { op.cancelSettled = true; finishRender(op); }
  }
  async function choose() {
    if (!panel?.target || waiting) return; const token = ++epoch; clearDraft(); waiting = true; feedback = tr('正在选择并检查 WAV…', 'Choosing and checking the WAV…'); problem = false; draw();
    try { const result = await window.arcade.qqVoicePick(args()); if (token !== epoch || !panel || !drawer.open) return;
      if (result?.ok !== true) { problem = result?.code !== 'cancelled'; feedback = explain(result?.code); }
      else if (result.cancelled) feedback = tr('已取消选择，没有发送语音。', 'Selection cancelled. No voice was sent.');
      else if (matchesPanel(result)) { acceptDraft(result.draft); draftSource = 'file'; feedback = ''; }
      else { problem = true; feedback = explain('changed'); }
    } catch { if (token === epoch && panel) { clearDraft(); problem = true; feedback = tr('语音预览暂不可用，没有发出语音。请重新选择。', 'The voice preview is unavailable. No voice was sent. Choose audio again.'); } }
    finally { if (token === epoch && panel && drawer.open) { waiting = false; draw(); } }
  }
  async function remove(message = '') {
    if (!panel || waiting || !draft) return; const id = draft.ticketId; clearDraft(); const token = ++epoch; waiting = true; feedback = message; problem = false; draw();
    try { await window.arcade.qqVoiceDiscard({...args(), ticketId: id}); } catch {} finally { if (token === epoch && panel) { waiting = false; draw(); } }
  }
  async function send() {
    if (!canSend() || !validRecipient(draft.recipient)) return;
    const {ticketId: id, recipient: {accountId, ownerId, groupId, role, groupName}} = draft, token = ++epoch;
    const recipient = groupId ? {accountId, groupId, role, groupName: groupNameOf(groupName)} : {accountId, ownerId};
    clearDraft(); textDraft = ''; waiting = true;
    feedback = groupId ? tr(`正在向 QQ 群 ${groupId} 发送语音…`, `Sending voice to QQ group ${groupId}…`) : tr('正在向主人 QQ 发送语音…', 'Sending voice to the owner on QQ…');
    problem = false; draw();
    try { const result = await window.arcade.qqVoiceSend({...args(), ticketId: id}); if (token !== epoch || !panel || !drawer.open) return;
      const belongs = result?.ok === true && matchesPanel(result) && result.ticketId === id && result.kind === 'voice';
      if (belongs && result.outcome === 'accepted' && typeof result.messageId === 'string' && /^-?\d{1,20}$/.test(result.messageId)) { receipt = {messageId: result.messageId, ...recipient}; feedback = tr('QQ 已接受语音发送请求，不代表已听到。', 'QQ accepted the voice send request. This does not confirm it was heard.'); problem = false; }
      else if (belongs && result.outcome === 'not_sent') { feedback = explain(result.code); problem = result.code !== 'cancelled'; }
      else { feedback = tr('是否发送成功尚未确认。请先在 QQ 查看，避免重复发送；这份预览不会重发。', 'The send outcome is unconfirmed. Check QQ before sending another copy. This preview will not be sent again.'); problem = true; }
    } catch { if (token === epoch && panel) { feedback = tr('是否发送成功尚未确认。请先在 QQ 查看；这份预览不会重发。', 'The send outcome is unconfirmed. Check QQ; this preview will not be sent again.'); problem = true; } }
    finally { if (token === epoch && panel && drawer.open) { waiting = false; draw(); } }
  }
  function draw() {
    if (!panel || composing) return; const active = document.activeElement, focus = active?.id, selection = focus === 'qq-voice-text' ? [active.selectionStart, active.selectionEnd] : null, scroll = drawer.querySelector('.qq-voice-content')?.scrollTop || 0, head = el('div', 'qq-voice-heading'), heading = el('div'), title = el('h2', '', tr('分享语音', 'Share a voice clip'));
    const target = panel.target, group = target?.groupId, groupMode = mac() || !!group;
    const verifiedGroup = group && groupLabel(group, groupNameOf(draft?.recipient?.groupName || receipt?.groupName));
    title.id = 'qq-voice-title'; heading.append(title, el('p', '', groupMode ? tr('由当前搭档的 QQ 发到所选群', 'Send from this companion’s QQ to the selected group') : tr('由当前搭档的 QQ 发给主人', 'Send from this companion’s QQ to its owner'))); head.append(heading, action('qq-voice-close', tr('关闭', 'Close'), close));
    const content = el('div', 'qq-voice-content'), targets = groupTargets();
    if (targets.length) {
      const picker = el('div', 'qq-voice-target'), label = el('label', '', tr('发送目标', 'Recipient')), select = el('select');
      select.id = 'qq-voice-target'; label.htmlFor = select.id;
      const option = (value, text) => {const node = el('option', '', text);node.value = value;return node;};
      select.append(mac() ? option('', tr('请选择一个群', 'Choose a group')) : option('owner', tr('主人 QQ', 'Owner QQ')));
      for (const {groupId, role} of targets) select.append(option(groupId, tr(`群 ${groupId} · ${role}`, `Group ${groupId} · ${role}`)));
      select.value = group || (target === owner ? 'owner' : ''); select.disabled = waiting;
      select.onchange = () => void changeTarget(select.value);
      picker.append(label, select); content.append(picker);
    }
    if (target) {
      const currentAccount = account();
      const recipientInfo = draft?.recipient || (group ? {role: target.role, accountId: panel.qqAccountId, groupId: group} : {role: currentAccount?.name, accountId: currentAccount?.accountId, ownerId: latest?.bot?.qq?.ownerId});
      if (qqNumber.test(recipientInfo.accountId) && qqNumber.test(recipientInfo.groupId || recipientInfo.ownerId)) {
        const recipient = el('section', 'qq-voice-recipient');
        recipient.append(el('strong', '', recipientInfo.role || tr('当前搭档', 'Current companion')), el('p', '', tr(`发送账号 QQ ${recipientInfo.accountId}`, `Sending account: QQ ${recipientInfo.accountId}`)),
          el('p', '', group ? tr(`目标 QQ 群 ${verifiedGroup}`, `Recipient: QQ group ${verifiedGroup}`) : tr(`主人 QQ ${recipientInfo.ownerId}`, `Owner: QQ ${recipientInfo.ownerId}`)));
        content.append(recipient);
      }
    }
    const composer = el('section', 'qq-voice-composer');
    if (generator === 'available') {
      const label = el('label', '', tr('想说哪一句？', 'What should the clip say?')); label.htmlFor = 'qq-voice-text';
      const input = el('textarea'); input.id = 'qq-voice-text'; input.rows = 3; input.maxLength = 240; input.value = textDraft; input.readOnly = waiting; input.spellcheck = false; input.setAttribute('aria-describedby', 'qq-voice-text-help qq-voice-text-count');
      input.oninput = editText; input.addEventListener('compositionstart', () => { composing = true; updateTextControls(); }); input.addEventListener('compositionend', event => { composing = false; editText(event); draw(); });
      const help = el('p', 'qq-voice-text-help', tr('本机温柔女声 · Serena。最多 120 个字符；生成后仍需核验不超过 30 秒。', 'Local Serena voice. Up to 120 characters; generated audio must still fit 30 seconds.')); help.id = 'qq-voice-text-help';
      const row = el('div', 'qq-voice-compose-actions'), count = el('span', 'qq-voice-text-count'); count.id = 'qq-voice-text-count';
      row.append(action('qq-voice-generate', tr('生成语音', 'Generate voice'), () => void generate(), true), count);
      if (renderOp) row.append(action('qq-voice-cancel-render', renderOp.cancelFailed ? tr('停止未确认', 'Stop unconfirmed') : renderOp.cancelRequested ? tr('正在停止…', 'Stopping…') : tr('取消生成', 'Cancel generation'), () => void cancelRender(), renderOp.cancelRequested));
      composer.append(label, input, help, row);
    } else composer.append(el('p', 'qq-voice-text-help', generator === 'checking' ? tr('正在检查本机语音配置；也可以直接选择 WAV。', 'Checking local voice configuration. You can also choose a WAV now.') : explain(generatorReason || 'voice_render_unavailable')));
    if (target) content.append(composer);
    if (draft) {
      const player = el('section', 'qq-voice-player'), duration = el('strong', 'qq-voice-duration', tr(`${draft.durationSeconds.toFixed(1)} 秒`, `${draft.durationSeconds.toFixed(1)} seconds`));
      const format = el('p', 'qq-voice-format', tr(`WAV · 单声道 · 16 位 · ${draft.sampleRate / 1000} kHz · ${(draft.bytes / 1024).toFixed(0)} KiB`, `WAV · mono · 16-bit · ${draft.sampleRate / 1000} kHz · ${(draft.bytes / 1024).toFixed(0)} KiB`));
      const playbackStatus = el('p'); playbackStatus.id = 'qq-voice-playback'; playbackStatus.setAttribute('role', 'status');
      player.append(el('p', 'qq-voice-source', draftSource === 'text' ? tr('文字生成的语音', 'Voice generated from your text') : tr('本机 WAV 预览', 'Local WAV preview')), duration, format, action('qq-voice-preview', '', () => void preview(), waiting), playbackStatus); content.append(player);
    }
    if (target) {
      content.append(el('p', 'qq-voice-note', group ? tr('可以选择在本机试听。核对群号和角色后，点击“发送到群”将语音交给 QQ。WAV 需为单声道 16 位 PCM、0.2–30 秒、不超过 4 MiB。', 'Listening locally is optional. Confirm the group number and role, then choose Send to group to upload to QQ. WAV files must be mono 16-bit PCM, 0.2–30 seconds, up to 4 MiB.') : tr('生成和试听都在本机进行，不读取聊天。只有“发送给主人”才会将语音交给 QQ，不发到群或空间。WAV 文件需为单声道 16 位 PCM、0.2–30 秒、不超过 4 MiB。', 'Generation and preview stay on this device and do not read your chats. Only Send to owner uploads the voice to QQ, not a group or Qzone. WAV files must be mono 16-bit PCM, 0.2–30 seconds, up to 4 MiB.')));
      const actions = el('div', 'qq-voice-actions'); actions.append(action('qq-voice-choose', draft ? tr('换一段', 'Choose another') : tr('选择 WAV', 'Choose WAV'), () => void choose(), waiting)); if (draft) actions.append(action('qq-voice-remove', tr('移除语音', 'Remove voice'), () => void remove(), waiting)); content.append(actions);
    }
    const footer = el('div', 'qq-voice-footer'), result = el('div', 'qq-voice-result'), status = el('p', problem ? 'problem' : '', feedback); status.id = 'qq-voice-status'; status.setAttribute('role', problem ? 'alert' : 'status'); result.append(status);
    if (receipt) {
      const details = el('details', 'qq-voice-receipt'), summary = el('summary', '', tr('发送详情', 'Send details')); details.id = 'qq-voice-receipt'; summary.id = 'qq-voice-receipt-summary'; details.open = $('qq-voice-receipt')?.open === true; details.append(summary);
      const fields = [['messageId', tr('消息 ID', 'Message ID')], ['accountId', tr('发送账号 QQ', 'From QQ')]];
      if (receipt.groupId) fields.push(['groupId', tr('目标 QQ 群', 'QQ group')], ['role', tr('角色', 'Role')]);
      else fields.push(['ownerId', tr('主人 QQ', 'Owner QQ')]);
      for (const [key, label] of fields) {
        const value = key === 'groupId' ? groupLabel(receipt.groupId, receipt.groupName) : receipt[key];
        const row = el('p', '', `${label}：${value}`); row.dataset.field = key; details.append(row);
      }
      details.append(el('p', 'qq-voice-note', tr('这是本次请求的回执，不代表对方已收到或听过语音。', 'This is the request receipt, not confirmation of delivery or listening.'))); result.append(details);
    }
    footer.append(result, action('qq-voice-send', groupMode ? tr('发送到群', 'Send to group') : tr('发送给主人', 'Send to owner'), () => void send(), !canSend(), true)); drawer.replaceChildren(head, content, footer); drawPlayback(); updateTextControls(); content.scrollTop = scroll;
    const restore = focus && $(focus); if (restore && drawer.contains(restore) && !restore.disabled) { restore.focus({preventScroll: true}); if (selection && restore.setSelectionRange) restore.setSelectionRange(...selection); }
  }
  button.onclick = () => {
    if (!available() || !selected()) return;
    returnFocus = document.activeElement;
    replacePanel(newPanel(mac() ? null : owner));
    draw(); document.documentElement.classList.add('qq-voice-open'); drawer.showModal();
    (mac() ? $('qq-voice-target') : $('qq-voice-close'))?.focus();
    void checkGenerator();
  };
  drawer.addEventListener('cancel', event => { event.preventDefault(); close(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden && panel) close(); }); window.addEventListener('pagehide', close);
  const previous = window.renderBot;
  window.renderBot = next => {
    previous?.(next); latest = next; language = next.config?.language || 'en'; button.textContent = tr('分享语音', 'Share voice'); button.hidden = !supported(); button.disabled = !available();
    button.title = available() ? (mac() ? tr('选群后，由搭档的 QQ 发到群', 'Choose a group to send from this companion’s QQ') : tr('先试听，再由搭档 QQ 发给主人', 'Listen locally, then send from this companion’s QQ to its owner')) : tr('请先连接当前搭档的 QQ', 'Connect this companion’s QQ first');
    if (panel) {
      const target = panel.target;
      if (view !== 'bot' || next.bot?.status !== 'connected' || !supported() || binding(target) !== panel.binding || (target?.groupId && !groupCurrent(target))) { close(); return; }
      const currentDraft = next.bot?.voiceMedia?.draft;
      if (draft && (currentDraft?.ticketId !== draft.ticketId || (target?.groupId && !validRecipient(currentDraft.recipient)))) { clearDraft(); feedback = explain('stale_ticket'); problem = false; }
      draw();
    }
  };
  if (typeof data !== 'undefined' && data) window.renderBot(data);
})();
