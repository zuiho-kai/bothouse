'use strict';

// The index moves the original settings cards, keeping their handlers and
// platform-specific visibility. Conversation settings continue to own AI and QQ.
window.mountGlobalSettings = function ({grid, heading, gear, openView, tr}) {
  const view = grid.closest('.view');
  const nav = el('div', 'settings-index');
  nav.setAttribute('role', 'navigation');
  const content = el('div', 'settings-content');
  const daily = el('div', 'settings-nav-group'), personal = el('div', 'settings-nav-group');
  const advanced = el('details', 'settings-advanced'), summary = el('summary', '');
  advanced.id = 'settings-advanced';
  const dailyLabel = el('h2', ''), personalLabel = el('h2', '');
  daily.append(dailyLabel);
  personal.append(personalLabel);
  advanced.append(summary);
  nav.append(daily, personal, advanced);
  const back = el('button', 'plain settings-back'), backText = el('span', '');
  back.type = 'button';
  back.id = 'settings-back';
  back.append(el('span', '', '‹'), backText);
  back.firstChild.setAttribute('aria-hidden', 'true');
  heading.prepend(back);
  const narrow = matchMedia('(max-width: 760px)');
  const compact = () => narrow.matches || document.body.classList.contains('compact');
  const tasks = new Map();
  let data, previousView = 'bot', origin = 'bot', originControl = gear, entryControl;
  let active = 'appearance', detail = false, returning = false;
  const rememberEntry = event => { entryControl = event.currentTarget; };
  gear.addEventListener('click', rememberEntry, true);
  document.getElementById('connect').addEventListener('click', rememberEntry, true);
  document.getElementById('view-picker').addEventListener('change', event => {
    if (event.currentTarget.value === 'settings') rememberEntry(event);
  }, true);

  function task(key, names, group, ids = []) {
    const button = el('button', 'settings-task'), label = el('span', 'settings-task-name');
    button.type = 'button';
    button.id = key === 'ai' ? 'ai-card-open' : 'settings-nav-' + key;
    button.dataset.settingsTarget = key;
    const text = el('span', 'settings-task-text'), hint = el('span', 'settings-task-hint');
    if (key === 'ai') hint.id = 'ai-card-state';
    const arrow = el('span', 'settings-task-arrow', '›');
    arrow.setAttribute('aria-hidden', 'true');
    text.append(label, hint);
    button.append(text, arrow);
    group.append(button);
    const panel = el('section', 'settings-section');
    panel.id = 'settings-section-' + key;
    panel.setAttribute('aria-labelledby', button.id);
    for (const id of ids) {
      const card = document.getElementById(id)?.closest('.settings-card');
      if (card) panel.append(card);
    }
    panel.hidden = true;
    content.append(panel);
    button.onclick = () => choose(key);
    tasks.set(key, {button, label, hint, names, panel, group});
  }
  task('appearance', ['外观与语言', 'Appearance & language'], daily, ['interface-card', 'theme']);
  task('notifications', ['通知', 'Notifications'], daily, ['notifications']);
  task('shortcut', ['发送快捷键', 'Send shortcut'], daily, ['send-shortcut-enter']);
  task('pets', ['桌面搭档', 'Desktop companion'], daily, ['desktopPetCard', 'desktop-pets-card']);
  task('ai', ['本机搭档的 AI 服务', 'Local companion AI service'], personal);
  task('qq', ['QQ 群聊', 'QQ groups'], personal);
  task('backend', ['渠道与派活', 'Channel & dispatch'], advanced);
  task('bridge', ['QQ 桥接', 'QQ bridge'], advanced);
  task('observer', ['观察器与隐私', 'Observer & privacy'], advanced, ['observer-card', 'captureResults']);
  task('robot', ['桌面机器人连接', 'Desk robot connection'], advanced, ['robot-device-card']);
  grid.append(nav, content);

  function paint() {
    const single = compact();
    grid.dataset.indexOnly = String(single && !detail);
    grid.dataset.detailOnly = String(single && detail);
    for (const [key, item] of tasks) {
      const selected = key === active && (!single || detail);
      item.panel.hidden = !selected;
      if (selected) item.button.setAttribute('aria-current', 'true');
      else item.button.removeAttribute('aria-current');
    }
    setText(backText, detail && single ? tr('返回设置', 'All settings') : tr('返回', 'Back'));
  }
  function show(key) {
    active = key;
    detail = true;
    if (tasks.get(key).group === advanced) advanced.open = true;
    paint();
    const panel = tasks.get(key).panel;
    const target = panel.querySelector('h2') || panel;
    target.tabIndex = -1;
    target.focus({preventScroll:true});
    target.scrollIntoView({block:'nearest'});
  }
  function returnFrom(key) {
    if (!tasks.has(key)) return;
    returning = true;
    openView('settings');
    returning = false;
    detail = false;
    active = 'appearance';
    if (tasks.get(key).group === advanced) advanced.open = true;
    paint();
    tasks.get(key).button.focus();
  }
  function choose(key) {
    const item = tasks.get(key);
    if (!item) return;
    if (['appearance', 'notifications', 'shortcut', 'pets', 'observer', 'robot'].includes(key)) {
      show(key);
      return;
    }
    if (key === 'ai' && window.ArcadeFirstRun?.needed(data)) {
      window.ArcadeFirstRun.open({fromSettings:true});
      return;
    }
    const opened = window.ArcadeSettingsDestinations.open(key, {data, returnToSettings:() => returnFrom(key)});
    if (opened) return;
    show(key);
  }

  function setText(node, text) { if (node.textContent !== text) node.textContent = text; }
  const emptyStates = new Map();
  for (const key of ['ai','qq','backend','bridge']) {
    const panel = tasks.get(key).panel;
    const title = el('h2', ''), note = el('p', ''), select = el('button', 'secondary');
    select.type = 'button';
    select.onclick = () => window.openCompanionManager({onClose:() => returnFrom(key)});
    const box = el('div', 'settings-card');
    box.append(title, note, select);
    panel.append(box);
    emptyStates.set(key, {title, note, select});
  }
  const updateApp = window.mountAppUpdate?.(tr);
  function updateCopy() {
    updateApp?.(data.appUpdate);
    setText(dailyLabel, tr('应用', 'Application'));
    const selected = data.accounts?.accounts?.find(row => row.id === data.accounts.selectedId);
    setText(personalLabel, selected?.name ? tr('当前搭档 · ', 'Current companion · ') + selected.name : tr('当前搭档', 'Current companion'));
    setText(summary, tr('高级设置', 'Advanced settings'));
    nav.setAttribute('aria-label', tr('设置分类', 'Settings categories'));
    const bot = data.bot || {};
    const qq = selected?.channel === 'qq' && bot.channel === 'qq';
    for (const [key, item] of tasks) {
      const name = key === 'ai' && window.ArcadeFirstRun?.needed(data) ? tr('连接本机搭档的 AI 服务', 'Connect your local companion’s AI') : tr(...item.names);
      setText(item.label, name);
      if (key === 'ai') {
        const provider = Array.from(document.getElementById('bot-mode').options).find(option => option.value === bot.mode)?.textContent;
        const models = document.getElementById('bot-' + bot.mode + '-model');
        const saved = bot[bot.mode + 'Model'];
        const model = models && (saved ? Array.from(models.options).find(option => option.value === saved)?.textContent || saved : models.options[0]?.textContent);
        setText(item.hint, [provider || bot.mode, model].filter(Boolean).join(' · '));
      }
      if (!emptyStates.has(key)) continue;
      const empty = emptyStates.get(key);
      setText(empty.title, name);
      const chooseQQ = !qq && ['qq','bridge'].includes(key);
      setText(empty.note, chooseQQ ? tr('请选择要管理的普通 QQ 搭档。', 'Choose the personal QQ companion you want to manage.') :
        tr('当前搭档的设置尚未就绪。', 'Settings for this companion are not ready yet.'));
      setText(empty.select, tr('选择搭档', 'Choose companion'));
      empty.select.hidden = !chooseQQ || !window.openCompanionManager;
    }
  }
  function goBack() {
    if (compact() && detail) {
      detail = false;
      paint();
      tasks.get(active).button.focus();
    } else {
      openView(origin);
      (originControl?.getClientRects().length ? originControl : gear).focus();
    }
  }
  back.onclick = goBack;
  view.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || event.defaultPrevented || event.target.matches('input,select,textarea')) return;
    event.preventDefault();
    goBack();
  });
  narrow.addEventListener('change', paint);
  return {
    choose,
    sync(next, page) {
      data = next;
      if (page === 'settings' && previousView !== page && !returning) {
        origin = previousView;
        originControl = entryControl || gear;
        active = 'appearance';
        detail = false;
        advanced.open = false;
      }
      entryControl = null;
      previousView = page;
      window.ArcadeSettingsDestinations.sync(next, page);
      if (page !== 'settings') return;
      updateCopy();
      paint();
    }
  };
};
