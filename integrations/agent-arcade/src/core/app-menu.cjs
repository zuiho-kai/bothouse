'use strict';
// The macOS application menu as plain data. Electron only attaches the standard
// editing shortcuts (Command+C, V, X, A, Z) to a window when an Edit menu with
// these roles exists, so a missing menu breaks copy and paste in every text field.
// Windows and Linux keep Electron's default menu: this returns null for them.
const COPY = Object.freeze({
  en: {edit: 'Edit', view: 'View', window: 'Window', about: 'About', services: 'Services', hide: 'Hide', hideOthers: 'Hide Others', unhide: 'Show All', quit: 'Quit',
    undo: 'Undo', redo: 'Redo', cut: 'Cut', copy: 'Copy', paste: 'Paste', pasteAndMatchStyle: 'Paste and Match Style', delete: 'Delete', selectAll: 'Select All',
    resetZoom: 'Actual Size', zoomIn: 'Zoom In', zoomOut: 'Zoom Out', togglefullscreen: 'Toggle Full Screen', toggleDevTools: 'Toggle Developer Tools',
    minimize: 'Minimize', zoom: 'Zoom', close: 'Close Window', front: 'Bring All to Front'},
  zh: {edit: '编辑', view: '显示', window: '窗口', about: '关于', services: '服务', hide: '隐藏', hideOthers: '隐藏其他', unhide: '全部显示', quit: '退出',
    undo: '撤销', redo: '重做', cut: '剪切', copy: '拷贝', paste: '粘贴', pasteAndMatchStyle: '粘贴并匹配样式', delete: '删除', selectAll: '全选',
    resetZoom: '实际大小', zoomIn: '放大', zoomOut: '缩小', togglefullscreen: '切换全屏', toggleDevTools: '切换开发者工具',
    minimize: '最小化', zoom: '缩放', close: '关闭窗口', front: '前置全部窗口'},
});
const EDIT_ROLES = Object.freeze(['undo', 'redo', null, 'cut', 'copy', 'paste', 'pasteAndMatchStyle', 'delete', 'selectAll']);
function applicationMenuTemplate({platform = process.platform, appName = 'Agent Arcade', language = 'en', developer = false} = {}) {
  if (platform !== 'darwin') return null;
  const text = COPY[language === 'zh' ? 'zh' : 'en'], name = typeof appName === 'string' && appName ? appName.slice(0, 60) : 'Agent Arcade';
  const item = role => role ? {role, label: text[role]} : {type: 'separator'};
  return [
    {label: name, submenu: [
      {role: 'about', label: `${text.about} ${name}`}, {type: 'separator'},
      {role: 'services', label: text.services}, {type: 'separator'},
      {role: 'hide', label: `${text.hide} ${name}`}, item('hideOthers'), item('unhide'), {type: 'separator'},
      {role: 'quit', label: `${text.quit} ${name}`}]},
    {label: text.edit, submenu: EDIT_ROLES.map(item)},
    {label: text.view, submenu: [item('resetZoom'), item('zoomIn'), item('zoomOut'), {type: 'separator'}, item('togglefullscreen'),
      ...(developer ? [{type: 'separator'}, item('toggleDevTools')] : [])]},
    {label: text.window, role: 'window', submenu: [item('minimize'), item('zoom'), {type: 'separator'}, item('close'), {type: 'separator'}, item('front')]},
  ];
}
module.exports = {applicationMenuTemplate, EDIT_ROLES};
