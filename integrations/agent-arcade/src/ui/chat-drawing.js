(() => {
  const items = new Map();
  let accountId, historyId, observer, pane, viewer, viewing;
  let activeReads = 0;
  let scopeRevision = 0;
  const en = () => document.documentElement.lang.startsWith('en');
  const t = (zh, english) => en() ? english : zh;
  const element = (tag, cls) => Object.assign(document.createElement(tag), { className: cls });
  const validPreview = src => typeof src === 'string' && src.length <= 22 + 4 * Math.ceil(8 * 1024 * 1024 / 3) && src.startsWith('data:image/png;base64,');
  function labels(item) {
    const rendering = item.phase + document.documentElement.lang;
    if (item.rendering === rendering) return;
    item.rendering = rendering;
    const description = item.sticker?t('表情图', 'Reaction image'):t('角色绘图', 'Character drawing');
    item.image.alt = description;
    item.open.setAttribute('aria-label', item.sticker?t('查看表情图原图','View full reaction image'):t('查看角色绘图原图', 'View full character drawing'));
    item.label.textContent = item.phase === 'loading' ? t('正在读取图片…', 'Loading image…') : item.sticker?t('查看表情图','View reaction image'):t('查看绘图', 'View drawing');
    item.box.dataset.ready=String(item.phase==='ready');
    item.credit.hidden=item.phase!=='ready'||!item.credit.textContent;
    item.label.hidden = item.phase === 'ready';
    item.image.hidden = item.phase !== 'ready';
    item.open.hidden = item.phase === 'error';
    item.error.hidden = item.phase !== 'error';
    item.retry.hidden = item.phase !== 'error';
    item.error.textContent = t('暂时无法读取这条消息的图片。', 'The image in this message could not be loaded.');
    item.retry.textContent = t('重新读取', 'Try loading again');
  }
  function clearImage(item) {
    item.image.removeAttribute('src');
    if (item.phase === 'ready') item.phase = 'idle';
    labels(item);
  }
  function closeViewer(restore) {
    if (!viewing) return;
    const {item,origin} = viewing;
    viewing = null;
    viewer.dialog.close();
    viewer.image.removeAttribute('src');
    if (restore && origin.isConnected) origin.focus();
    if (item && !item.visible) clearImage(item);
  }
  function showViewer(src, origin, item) {
    if (!viewer) {
      const dialog = element('dialog', 'chat-drawing-viewer');
      const image = element('img', 'chat-drawing-original');
      const close = element('button', 'secondary');
      close.type = 'button';
      close.addEventListener('click', () => closeViewer(true));
      dialog.addEventListener('cancel', event => { event.preventDefault(); closeViewer(true); });
      dialog.append(close, image);
      document.body.append(dialog);
      viewer = { dialog, image, close };
    }
    if (viewing) closeViewer(false);
    viewing = {origin,item};
    const alt=item?.sticker?t('表情图原图','Full reaction image'):t('角色绘图原图', 'Full character drawing');
    viewer.dialog.setAttribute('aria-label',alt);
    viewer.close.textContent = t('关闭', 'Close');
    viewer.image.alt = alt;
    viewer.image.src = src;
    viewer.dialog.showModal();
    viewer.close.focus();
  }
  async function openRecent(binding, origin) {
    const revision = scopeRevision;
    const current = () => revision === scopeRevision && binding.accountId === accountId &&
      binding.historyId && binding.historyId === historyId && origin.isConnected && document.body.dataset.view === 'bot';
    if (!current()) return 'changed';
    try {
      const result = await window.arcade.desktopChatDrawingRead({...binding, latest:true});
      if (!current()) return 'changed';
      if (!result?.ok) return result?.code || 'storage_unavailable';
      if (!result.messageId || !validPreview(result.preview)) return 'storage_unavailable';
      const image = new Image();
      image.src = result.preview;
      await image.decode();
      if (!current() || document.querySelector('dialog[open]')) return 'changed';
      showViewer(image.src, origin, items.get(result.messageId));
      return 'opened';
    } catch { return 'storage_unavailable'; }
  }
  async function read(item) {
    const binding = { accountId, historyId, messageId: item.id };
    item.phase = 'loading';
    activeReads++;
    labels(item);
    try {
      const result = await window.arcade.desktopChatDrawingRead(binding);
      if (items.get(item.id) !== item) return;
      if (!item.visible && !item.wantsOpen) { item.phase = 'idle'; return; }
      const src = result?.preview;
      if (!result?.ok || !validPreview(src) || (result.sticker===true)!==item.sticker) throw new Error('invalid image');
      item.image.src = src;
      await item.image.decode();
      if (items.get(item.id) !== item) return;
      if (!item.visible && !item.wantsOpen) { item.phase = 'idle'; clearImage(item); return; }
      item.credit.textContent=item.sticker&&typeof result.credit==='string'&&result.credit.length<=600?result.credit:'';
      item.phase = 'ready';
      if (item.wantsOpen) showViewer(item.image.src,item.open,item);
    } catch {
      if (items.get(item.id) === item) {
        const moveFocus = document.activeElement === item.open;
        item.phase = 'error';
        item.image.removeAttribute('src');
        labels(item);
        if (moveFocus) item.retry.focus();
      }
    } finally {
      item.wantsOpen = false;
      labels(item);
      activeReads--;
      pump();
    }
  }
  function pump() {
    for (const item of items.values()) {
      if (activeReads >= 2) break;
      if ((item.visible || item.wantsOpen) && item.phase === 'idle') void read(item);
    }
  }
  function make(id,sticker) {
    const box = element('div', 'chat-drawing');
    const open = element('button', 'chat-drawing-open');
    const image = element('img', 'chat-drawing-image');
    const label = element('span', 'chat-drawing-label');
    const error = element('span', 'chat-drawing-error');
    const retry = element('button', 'secondary chat-drawing-retry');
    const credit = element('small','chat-sticker-credit');
    box.dataset.messageId = id;
    open.type = retry.type = 'button';
    error.setAttribute('role', 'status');
    open.append(image, label);
    box.append(open, credit, error, retry);
    if(sticker)box.dataset.sticker='true';
    const item = { id, box, open, image, label, error, retry, credit, sticker, visible: false, wantsOpen: false, phase: 'idle' };
    open.addEventListener('click', () => {
      if (item.phase === 'ready') showViewer(item.image.src,item.open,item);
      else { item.wantsOpen = true; pump(); }
    });
    retry.addEventListener('click', () => {
      item.phase = 'idle';
      item.visible = true;
      labels(item);
      item.open.focus();
      pump();
    });
    labels(item);
    return item;
  }
  function forget(item) {
    items.delete(item.id);
    observer?.unobserve(item.box);
    if (viewing?.item === item) closeViewer(false);
    item.box.remove();
    clearImage(item);
  }
  function update(state, rows, root) {
    const local = state?.bot?.local;
    const nextAccount = state?.accounts?.selectedId;
    const nextHistory = state?.desktopChat?.kind === 'local' && document.body.dataset.view === 'bot' &&
      typeof window.arcade?.desktopChatDrawingRead === 'function' && root && nextAccount && !local?.libraryGroupId && local?.historyId;
    let changed = false;
    if (nextAccount !== accountId || nextHistory !== historyId || root !== pane) {
      scopeRevision++;
      closeViewer(false);
      for (const item of items.values()) forget(item);
      observer?.disconnect();
      observer=null;
      pane = root;
      accountId = nextAccount;
      historyId = nextHistory;
      if (historyId && window.IntersectionObserver) {
        observer = new IntersectionObserver(entries => {
          for (const entry of entries) {
            const item = items.get(entry.target.dataset.messageId);
            if (item?.box !== entry.target) continue;
            item.visible = entry.isIntersecting;
            if (!item.visible && viewing?.item !== item && item.phase === 'ready') clearImage(item);
          }
          pump();
        }, { root });
      }
    }
    if (!historyId) return false;
    const eligible = new Map((local.history || []).filter(m => m?.role === 'assistant' && m.drawing === true).map(m => [m.id,m]));
    const mounted = new Set();
    for (const row of rows) {
      const id = row.dataset.messageId;
      if (row.dataset.role !== 'assistant' || !eligible.has(id)) continue;
      const body = row.querySelector(':scope > .message-body');
      if (!body) continue;
      mounted.add(id);
      let item = items.get(id);
      const message=eligible.get(id);
      if (!item) { item = make(id,message.sticker===true); items.set(id, item); }
      item.box.dataset.replacesLabel=String(item.sticker&&!message.edited&&message.text==='［表情图］');
      if (item.box.parentElement !== row) {
        body.after(item.box);
        observer?.observe(item.box);
        if(!observer)item.visible=true;
        changed = true;
      }
      labels(item);
    }
    for (const item of items.values()) {
      if (!mounted.has(item.id)) { forget(item); changed = true; }
    }
    pump();
    return changed;
  }
  window.ArcadeChatDrawing = { update, openRecent };
})();
