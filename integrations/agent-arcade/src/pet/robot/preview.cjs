'use strict';
// The desk robot preview window, on the main-process side. It shows the
// robot's on-screen twin (src/pet/robot/twin.js): the same driver that would
// talk to a device runs in the page and feeds the twin instead. As a body of
// the shared presence it mirrors the companion like the desktop pet does, and
// a click on the twin is reported as a touch on the robot.
//
// It is a screen simulation and says so in its title. No device is involved.
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const {TOUCHES, SHARED_REACTIONS} = require('../presence.cjs');
const {RobotMarks, validProbe} = require('./presence-marks.cjs');

const TITLES = {en: 'Desk robot preview (on screen only)', zh: '桌面机器人预览（仅屏幕模拟）'};
const HEARTBEAT_MS = 800;

class RobotPreview {
  constructor({electron, onTouch = () => {}, onChange = () => {}, language = () => 'en', getPresence = () => this.state, interval = {set: setInterval, clear: clearInterval}}) {
    Object.assign(this, {electron, onTouch, onChange, language, getPresence, interval});
    this.page = path.join(__dirname, 'twin.html'); this.pageURL = pathToFileURL(this.page).href;
    this.win = null; this.ready = false; this.state = {activity: 'idle', attention: false}; this.listeners = new Map(); this.problem = '';
    this.timer = null; this.token = null; this.marks = new RobotMarks();
    this.handlers = {
      'robot:ready': () => {
        if (!this.ready) {
          const win = this.win;
          this.ready = true; win.show();
          this.timer = this.interval.set(() => { if (this.win === win) this.send('robot:check'); }, HEARTBEAT_MS);
        }
        this.send('robot:check');
      },
      'robot:probe': (_event, token) => {
        if (!this.ready || !validProbe(token)) return;
        let state;
        try { state = this.getPresence(); } catch { return; }
        const sample = this.marks.sample(state, token);
        if (!sample) return;
        this.token = token;
        this.state = this.marks.state;
        this.send('robot:presence', sample);
      },
      'robot:touch': (_event, message) => {
        if (this.token && message?.token === this.token && TOUCHES.includes(message.kind)) this.onTouch(message.kind);
      },
    };
  }
  snapshot() { return {previewOpen: Boolean(this.win), problem: this.problem}; }
  trusted(event) {
    return Boolean(this.win) && !this.win.isDestroyed() && event.sender === this.win.webContents && event.senderFrame === this.win.webContents.mainFrame && String(event.senderFrame.url).split('?')[0] === this.pageURL;
  }
  send(channel, value) { if (this.win && !this.win.isDestroyed() && this.ready) this.win.webContents.send(channel, value); }
  open() {
    if (this.win && !this.win.isDestroyed()) { this.win.show(); this.win.focus(); return; }
    const {BrowserWindow, ipcMain} = this.electron;
    const win = this.win = new BrowserWindow({
      width: 380, height: 540, minWidth: 300, minHeight: 420, show: false, backgroundColor: '#2b2a30', title: TITLES[this.language() === 'zh' ? 'zh' : 'en'], autoHideMenuBar: true, fullscreenable: false,
      webPreferences: {preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, backgroundThrottling: false},
    });
    this.ready = false; this.problem = '';
    this.marks = new RobotMarks(this.state);
    win.webContents.setWindowOpenHandler(() => ({action: 'deny'}));
    win.webContents.on('will-navigate', event => event.preventDefault());
    win.webContents.on('render-process-gone', () => { if (this.win === win) { this.problem = 'The robot preview stopped unexpectedly.'; this.close(); } });
    win.on('page-title-updated', event => event.preventDefault());
    win.on('closed', () => { if (this.win === win) { this.stopHeartbeat(); this.win = null; this.onChange(); } });
    if (!this.listeners.size) {
      for (const [channel, handler] of Object.entries(this.handlers)) {
        const listener = (event, value) => { if (this.trusted(event)) handler(event, value); };
        this.listeners.set(channel, listener); ipcMain.on(channel, listener);
      }
    }
    const query = {screen: 'ju-portrait-480', lang: this.language() === 'zh' ? 'zh' : 'en'};
    win.loadFile(this.page, {query}).catch(error => { if (this.win === win) { this.problem = String(error?.message || error).slice(0, 200); this.close(); } });
    this.onChange();
  }
  stopHeartbeat() {
    if (this.timer !== null) this.interval.clear(this.timer);
    this.timer = null; this.token = null; this.ready = false;
  }
  close() {
    const win = this.win; this.win = null; this.stopHeartbeat();
    if (win && !win.isDestroyed()) win.destroy();
    this.onChange();
  }
  dispose() {
    this.onChange = () => {};        // the app is going away; nothing is left to tell
    this.close();
    for (const [channel, listener] of this.listeners) this.electron.ipcMain.removeListener(channel, listener);
    this.listeners.clear();
  }
  // As a body of the shared presence (src/pet/presence.cjs).
  present(state) {
    const previous = this.state;
    if (!this.marks.observe(state)) return;
    this.state = this.marks.state;
    // While waiting on a reply, the periodic probe will paint an unread mark.
    // An extra probe here could authorize neck movement just before the reply.
    if (previous.activity === 'thinking' && this.state.activity === 'thinking' &&
        previous.attention !== this.state.attention) return;
    this.send('robot:check');
  }
  pulse() { if (this.token) this.send('robot:pulse', this.token); }
  react(kind) { if (this.token && SHARED_REACTIONS.includes(kind)) this.send('robot:reaction', {token: this.token, kind}); }
}

module.exports = {RobotPreview, TITLES};
