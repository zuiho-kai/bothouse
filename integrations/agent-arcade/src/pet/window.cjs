'use strict';
// The desktop pet's window, on the main-process side: a small transparent
// window that floats above the desktop, lets clicks through everywhere except
// on the character, and is moved by dragging her. It reports the pointer to
// the page (a click-through window gets no pointer events of its own) and
// forwards what the companion is really doing in the app.
//
// The pet is a view of state, not an actor: it cannot approve anything, and it
// shows a cue but never message text on the desktop.
const path = require('node:path');
const {pathToFileURL} = require('node:url');

const {ACTIVITIES, TOUCHES, SHARED_REACTIONS} = require('./presence.cjs');

const SIZES = Object.freeze({s: [210, 270], m: [270, 350], l: [350, 450]});
const PETS = Object.freeze(['ju']);
const POLL_MS = 33, MARGIN = 28;
const LABELS = {
  en: {open: 'Open Agent Arcade', size: 'Size', s: 'Small', m: 'Medium', l: 'Large', hide: 'Hide desktop companion'},
  zh: {open: '打开 Agent Arcade', size: '大小', s: '小', m: '中', l: '大', hide: '收起桌面角色'},
};

// Accepts what the settings page or config.json may hold and returns a clean
// record; anything unknown falls back to the default rather than throwing.
function normalize(value) {
  const v = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const coordinate = n => (Number.isFinite(n) && Math.abs(n) < 1e6 ? Math.round(n) : null);
  return {enabled: v.enabled === true, pet: PETS.includes(v.pet) ? v.pet : 'ju', size: Object.hasOwn(SIZES, v.size) ? v.size : 'm', x: coordinate(v.x), y: coordinate(v.y)};
}
function supported(platform = process.platform) { return platform === 'darwin' || platform === 'win32'; }

// Keeps the window where her feet can stand on the bottom of a display's work
// area and most of her stays on screen.
function clampToArea(x, y, width, height, area) {
  return {
    x: Math.round(Math.min(area.x + area.width - width * 0.6, Math.max(area.x - width * 0.4, x))),
    y: Math.round(Math.min(area.y + area.height - height, Math.max(area.y, y))),
  };
}
function place(settings, displays, primary) {
  const [width, height] = SIZES[settings.size];
  if (settings.x !== null && settings.y !== null) {
    const centre = {x: settings.x + width / 2, y: settings.y + height / 2};
    const home = displays.find(d => centre.x >= d.workArea.x && centre.x < d.workArea.x + d.workArea.width && centre.y >= d.workArea.y && centre.y < d.workArea.y + d.workArea.height);
    if (home) return {width, height, ...clampToArea(settings.x, settings.y, width, height, home.workArea)};
  }
  const area = primary.workArea;
  return {width, height, x: area.x + area.width - width - MARGIN, y: area.y + area.height - height};
}

class PetWindow {
  constructor({electron, getSettings, saveSettings, onOpen = () => {}, onTouch = () => {}, language = () => 'en', platform = process.platform, interval = {set: setInterval, clear: clearInterval}, now = () => Date.now()}) {
    Object.assign(this, {electron, getSettings, saveSettings, onOpen, onTouch, language, platform, interval, now});
    this.page = path.join(__dirname, 'pet.html'); this.pageURL = pathToFileURL(this.page).href;
    this.win = null; this.timer = null; this.ready = false; this.drag = null; this.lastPointer = null; this.activity = 'idle'; this.attention = false; this.problem = '';
    this.handlers = {
      'pet:ready': () => { this.ready = true; this.problem = ''; this.win.showInactive(); this.sendActivity(); },
      'pet:failed': (_event, message) => { this.problem = String(message || 'The desktop companion could not be drawn.').slice(0, 200); this.destroy(); },
      'pet:interactive': (_event, value) => { if (!this.drag) this.win.setIgnoreMouseEvents(value !== true, {forward: true}); },
      'pet:drag-start': () => this.startDrag(),
      'pet:drag-end': () => this.endDrag(),
      'pet:open': () => { this.clearAttention(); this.onOpen(); },
      'pet:menu': () => this.menu(),
      // The user poked, patted, lifted or put her down; other bodies may answer.
      'pet:touch': (_event, kind) => { if (TOUCHES.includes(kind)) this.onTouch(kind); },
    };
    this.listening = false;
  }
  settings() { return normalize(this.getSettings()); }
  available() { return supported(this.platform); }
  snapshot() { const s = this.settings(); return {supported: this.available(), enabled: s.enabled, visible: Boolean(this.win), pet: s.pet, size: s.size, problem: this.problem}; }

  // Brings the window in line with the settings: creates, resizes or removes it.
  apply() {
    const settings = this.settings();
    if (!settings.enabled || !this.available()) { this.destroy(); return; }
    if (this.win && !this.win.isDestroyed()) {
      const bounds = this.win.getBounds(), [width, height] = SIZES[settings.size];
      if (bounds.width !== width || bounds.height !== height) {
        const area = this.electron.screen.getDisplayMatching(bounds).workArea;
        this.win.setBounds({width, height, ...clampToArea(bounds.x + (bounds.width - width) / 2, bounds.y + bounds.height - height, width, height, area)});
        this.remember();
      }
      return;
    }
    this.create(settings);
  }
  create(settings) {
    const {BrowserWindow, screen, ipcMain} = this.electron;
    const bounds = place(settings, screen.getAllDisplays(), screen.getPrimaryDisplay());
    const win = this.win = new BrowserWindow({
      ...bounds, show: false, frame: false, transparent: true, hasShadow: false, resizable: false, movable: false, minimizable: false, maximizable: false, fullscreenable: false,
      skipTaskbar: true, focusable: false, alwaysOnTop: true, acceptFirstMouse: true, title: 'Agent Arcade desktop companion', ...(this.platform === 'darwin' ? {type: 'panel'} : {}),
      webPreferences: {preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true},
    });
    this.ready = false; this.drag = null; this.lastPointer = null;
    win.setAlwaysOnTop(true, 'floating');
    if (this.platform === 'darwin') win.setVisibleOnAllWorkspaces(true, {visibleOnFullScreen: false, skipTransformProcessType: true});
    win.setIgnoreMouseEvents(true, {forward: true});
    win.webContents.setWindowOpenHandler(() => ({action: 'deny'}));
    win.webContents.on('will-navigate', event => event.preventDefault());
    win.webContents.on('render-process-gone', () => { this.problem = 'The desktop companion stopped unexpectedly.'; this.destroy(); });
    win.on('closed', () => { if (this.win === win) { this.win = null; this.stopPolling(); } });
    if (!this.listening) {
      for (const [channel, handler] of Object.entries(this.handlers)) ipcMain.on(channel, (event, value) => { if (this.trusted(event)) handler(event, value); });
      this.listening = true;
    }
    win.loadFile(this.page, {query: {pet: settings.pet, lang: this.language() === 'zh' ? 'zh' : 'en'}}).catch(error => { this.problem = String(error?.message || error).slice(0, 200); this.destroy(); });
    this.timer = this.interval.set(() => this.poll(), POLL_MS);
  }
  trusted(event) {
    return Boolean(this.win) && !this.win.isDestroyed() && event.sender === this.win.webContents && event.senderFrame === this.win.webContents.mainFrame && String(event.senderFrame.url).split('?')[0] === this.pageURL;
  }
  send(channel, value) { if (this.win && !this.win.isDestroyed() && this.ready) this.win.webContents.send(channel, value); }

  // About thirty times a second: tell the page where the pointer is and, while
  // she is being carried, keep the window under the hand.
  poll() {
    if (!this.win || this.win.isDestroyed() || !this.ready) return;
    const point = this.electron.screen.getCursorScreenPoint(), bounds = this.win.getBounds();
    if (this.drag) {
      const area = this.electron.screen.getDisplayNearestPoint(point).workArea, time = this.now();
      const next = clampToArea(point.x - this.drag.offsetX, point.y - this.drag.offsetY, bounds.width, bounds.height, area);
      if (next.x !== bounds.x || next.y !== bounds.y) {
        this.win.setBounds({...next, width: bounds.width, height: bounds.height});
        this.send('pet:moved', {dx: next.x - bounds.x, dy: next.y - bounds.y, dt: Math.max(0.001, (time - this.drag.at) / 1000)});
      }
      this.drag.at = time;
      this.send('pet:pointer', {x: point.x - next.x, y: point.y - next.y});
      return;
    }
    const x = point.x - bounds.x, y = point.y - bounds.y;
    if (this.lastPointer && this.lastPointer.x === x && this.lastPointer.y === y) return;
    this.lastPointer = {x, y};
    this.send('pet:pointer', {x, y});
  }
  startDrag() {
    if (!this.win || this.drag) return;
    const point = this.electron.screen.getCursorScreenPoint(), bounds = this.win.getBounds();
    this.drag = {offsetX: point.x - bounds.x, offsetY: point.y - bounds.y, at: this.now()};
    this.win.setIgnoreMouseEvents(false);
  }
  endDrag() { if (!this.drag) return; this.drag = null; this.remember(); }
  remember() {
    if (!this.win || this.win.isDestroyed()) return;
    const bounds = this.win.getBounds();
    try { this.saveSettings({...this.settings(), x: bounds.x, y: bounds.y}); } catch { /* The position is a convenience; she stays where she is for this run. */ }
  }
  menu() {
    if (!this.win) return;
    const text = LABELS[this.language() === 'zh' ? 'zh' : 'en'], settings = this.settings();
    const change = patch => { this.saveSettings({...this.settings(), ...patch}); this.apply(); };
    this.electron.Menu.buildFromTemplate([
      {label: text.open, click: () => { this.clearAttention(); this.onOpen(); }},
      {label: text.size, submenu: Object.keys(SIZES).map(size => ({label: text[size], type: 'radio', checked: settings.size === size, click: () => change({size})}))},
      {type: 'separator'},
      {label: text.hide, click: () => change({enabled: false})},
    ]).popup({window: this.win});
  }

  setActivity(state) { this.present({activity: state, attention: this.attention}); }
  pulse() { this.send('pet:activity', {pulse: true}); }
  // As a body of the shared presence (src/pet/presence.cjs).
  present({activity, attention}) {
    const next = ACTIVITIES.includes(activity) ? activity : 'idle';
    const waiting = attention === true;
    if (next === this.activity && waiting === this.attention) return;
    this.activity = next; this.attention = waiting; this.sendActivity();
  }
  // Another body was touched; she answers here with the same reaction.
  react(kind) { if (SHARED_REACTIONS.includes(kind)) this.send('pet:gesture', kind); }
  // Something is waiting for the user in the app; cleared when they open it.
  raiseAttention() { this.present({activity: this.activity, attention: true}); }
  clearAttention() { this.present({activity: this.activity, attention: false}); }
  sendActivity() { this.send('pet:activity', {state: this.activity, attention: this.attention}); }

  stopPolling() { if (this.timer) { this.interval.clear(this.timer); this.timer = null; } }
  destroy() {
    this.stopPolling(); this.ready = false; this.drag = null;
    const win = this.win; this.win = null;
    if (win && !win.isDestroyed()) win.destroy();
  }
  close() {
    this.destroy();
    if (this.listening) { for (const channel of Object.keys(this.handlers)) this.electron.ipcMain.removeAllListeners(channel); this.listening = false; }
  }
}

module.exports = {PetWindow, normalize, supported, place, clampToArea, SIZES, PETS};
