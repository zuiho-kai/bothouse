// Adapted from OpenIM Electron's conversationSort (AGPL-3.0) and Tinode Web's
// ContactList filter and pin/unpin menu (Apache-2.0). See THIRD_PARTY_NOTICES.md.
const normalName = text => text.normalize('NFKC').trim().toLowerCase();

function readPins(key) {
  try {
    const saved = JSON.parse(localStorage.getItem(key));
    if (Array.isArray(saved)) return new Set(saved.filter(id => typeof id === 'string'));
  } catch {}
  return new Set();
}

function build(tag, className, text = '') {
  const element = document.createElement(tag);
  element.className = className;
  if (text) element.textContent = text;
  if (tag === 'button') element.type = 'button';
  return element;
}

export function mountConversationList(directory, render) {
  const search = build('div','conversation-search');
  search.hidden = true;
  const input = build('input','');
  input.type = 'search';
  input.placeholder = '搜索会话';
  input.setAttribute('aria-label','搜索会话');
  input.setAttribute('aria-controls',directory.id);
  input.autocomplete = 'off';
  input.maxLength = 100;
  const clear = build('button','text-button','清除');
  clear.hidden = true;
  clear.setAttribute('aria-label','清除会话搜索');
  const status = build('p','sr-only');
  status.setAttribute('role','status');
  const problem = build('p','feedback conversation-pin-error');
  problem.setAttribute('role','alert');
  problem.hidden = true;
  search.append(input,clear,status,problem);
  directory.parentElement.querySelector('header').append(search);

  const menu = build('div','action-popover conversation-menu');
  menu.id = 'conversation-list-menu';
  menu.popover = 'auto';
  menu.setAttribute('role','group');
  menu.setAttribute('aria-label','会话操作');
  const pin = build('button','');
  menu.append(pin);
  document.body.append(menu);

  let key, visible = false, query = '', pinned = new Set(), target;
  const opened = () => menu.matches(':popover-open');
  const findRow = id => [...directory.querySelectorAll('.conversation-row')].find(row => row.dataset.id === id);
  const triggerOf = row => row?.querySelector('.conversation-row-actions');
  const setExpanded = (id,on) => triggerOf(findRow(id))?.setAttribute('aria-expanded',String(on));
  function close() {
    if (opened()) menu.hidePopover();
    setExpanded(target,false);
    target = undefined;
  }
  menu.addEventListener('toggle',()=>{ if (!opened()) close(); });
  function place(row) {
    const rect = triggerOf(row).getBoundingClientRect();
    const left = Math.max(8,Math.min(rect.right-menu.offsetWidth,innerWidth-menu.offsetWidth-8));
    const top = rect.bottom + menu.offsetHeight + 5 < innerHeight ?
      rect.bottom + 3 : Math.max(8,rect.top-menu.offsetHeight-3);
    menu.style.left = left+'px';
    menu.style.top = top+'px';
  }
  function open(row) {
    const id = row.dataset.id;
    if (opened() && id === target) { close(); return; }
    close();
    target = id;
    pin.textContent = pinned.has(id) ? '取消置顶' : '置顶会话';
    menu.showPopover({source:triggerOf(row)});
    setExpanded(id,true);
    place(row);
    pin.focus({preventScroll:true});
  }
  directory.addEventListener('contextmenu',event=>{
    const row = event.target.closest('.conversation-row');
    if (!visible || !row) return;
    event.preventDefault();
    open(row);
  });
  directory.addEventListener('keydown',event=>{
    if (!(event.key === 'ContextMenu' || event.shiftKey && event.key === 'F10')) return;
    const row = event.target.closest('.conversation-row');
    if (!visible || !row) return;
    event.preventDefault();
    open(row);
  });
  directory.addEventListener('scroll',close);
  window.addEventListener('resize',close);
  menu.addEventListener('keydown',event=>{
    if (event.key !== 'Escape') return;
    event.preventDefault();
    const trigger = triggerOf(findRow(target));
    close();
    trigger?.focus({preventScroll:true});
  });
  pin.onclick = ()=>{
    const id = target;
    if (!key || !visible || !findRow(id)) return;
    const next = readPins(key);
    const removing = next.delete(id);
    if (!removing) next.add(id);
    try {
      if (next.size) localStorage.setItem(key,JSON.stringify([...next]));
      else localStorage.removeItem(key);
    } catch {
      close();
      triggerOf(findRow(id))?.focus({preventScroll:true});
      problem.textContent = '未能保存置顶。请检查此设备的浏览器存储。';
      problem.hidden = false;
      return;
    }
    pinned = next;
    problem.hidden = true;
    close();
    render();
    triggerOf(findRow(id))?.focus({preventScroll:true});
    status.textContent = removing ? '已取消置顶。' : '已置顶。';
  };
  window.addEventListener('storage',event=>{
    if (!key || (event.key !== key && event.key !== null)) return;
    pinned = readPins(key);
    if (visible) render();
  });
  function updateQuery() {
    query = normalName(input.value);
    clear.hidden = !input.value;
    render();
  }
  function resetQuery() {
    input.value = '';
    updateQuery();
    input.focus();
  }
  clear.onclick = resetQuery;
  input.addEventListener('input',updateQuery);
  input.addEventListener('keydown',event=>{
    if (event.isComposing || event.keyCode === 229) return;
    if (event.key === 'Escape' && input.value) {
      event.preventDefault();
      resetQuery();
    }
    if (event.key === 'ArrowDown' || event.key === 'Enter' && query) {
      const result = directory.querySelector('[data-chat-id]');
      if (!result) return;
      event.preventDefault();
      result.focus({preventScroll:true});
      if (event.key === 'Enter') result.click();
    }
  });

  return {
    scope(account,show = false) {
      const next = account && 'arcade.conversation-pins.v1.'+account;
      if (next !== key) {
        close();
        key = next;
        pinned = readPins(key);
        input.value = query = status.textContent = '';
        clear.hidden = problem.hidden = true;
      }
      visible = show;
      if (!visible) close();
      search.hidden = !visible;
    },
    render(items,drawRow,empty) {
      const focus = document.activeElement;
      const oldRow = focus?.closest('.conversation-row');
      const oldId = oldRow?.dataset.id;
      const focusedTrigger = focus === triggerOf(oldRow);
      // The server already sorts by activity. Preserve that order inside each
      // bucket and change only the pinned/unpinned rank (OpenIM conversationSort).
      const matching = items.filter(item=>!query || normalName(item.title).includes(query));
      matching.sort((a,b)=>Number(pinned.has(b.id))-Number(pinned.has(a.id)));
      const rows = matching.map(item=>{
        const row = drawRow(item);
        const name = row.querySelector('strong');
        const wrapper = build('div','conversation-row');
        wrapper.dataset.id = item.id;
        if (pinned.has(item.id)) {
          wrapper.dataset.pinned = '';
          const time = row.querySelector('time');
          const meta = build('span','conversation-row-meta');
          if (time) {
            time.replaceWith(meta);
            meta.append(time);
          } else row.append(meta);
          const badge = build('span','conversation-pin','置顶');
          badge.setAttribute('aria-hidden','true');
          meta.append(badge);
          row.setAttribute('aria-description','已置顶');
        }
        name.id = 'conversation-name-'+item.id;
        const trigger = build('button','conversation-row-actions','⋯');
        trigger.setAttribute('aria-label','会话操作');
        trigger.setAttribute('aria-describedby',name.id);
        trigger.setAttribute('aria-controls',menu.id);
        trigger.setAttribute('aria-expanded',String(item.id === target && opened()));
        trigger.onclick = ()=>open(wrapper);
        wrapper.append(row,trigger);
        return wrapper;
      });
      directory.replaceChildren(...(rows.length ? rows : [empty(query ? '未找到会话，请试试其他名称。' :
        '暂无消息。添加朋友后就能开始聊天。')]));
      if (opened()) {
        const current = findRow(target);
        if (current) {
          pin.textContent = pinned.has(target) ? '取消置顶' : '置顶会话';
          place(current);
        } else close();
      }
      if (oldId && focus !== document.activeElement) {
        const restored = findRow(oldId);
        (focusedTrigger ? triggerOf(restored) : restored?.querySelector('[data-chat-id]'))?.focus({preventScroll:true});
      }
      const result = query ? '找到 '+rows.length+' 个会话。' : '';
      if (status.textContent !== result) status.textContent = result;
    }
  };
}
