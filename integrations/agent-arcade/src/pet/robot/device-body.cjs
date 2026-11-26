'use strict';
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const {SHARED_REACTIONS} = require('../presence.cjs');
const {RobotMarks, validProbe} = require('./presence-marks.cjs');

const PAGE = path.join(__dirname, 'device.html');
const PAGE_URL = pathToFileURL(PAGE).href;
const phases = new Set(['handshake', 'syncing', 'confirmed', 'unconfirmed', 'incompatible', 'sleeping']);
const uint32 = n => Number.isInteger(n) && n >= 0 && n <= 0xffffffff;
const SILENCE_MS = 2500, MAX_TX = 32768, MAX_RX = 65536;

class RobotDeviceBody {
  constructor({electron, getPresence, onTouch = () => {}, language = () => 'en', now = () => performance.now()}) {
    Object.assign(this, {electron, getPresence, onTouch, language, now});
    this.current = null;
    this.handlers = [];
  }
  open({write, onDelivery, onFault}) {
    this.close();
    const win = new this.electron.BrowserWindow({show: false, skipTaskbar: true, focusable: false,
      webPreferences: {preload: path.join(__dirname, 'device-preload.cjs'), contextIsolation: true,
        partition: 'robot-device', sandbox: true, nodeIntegration: false, webSecurity: true, backgroundThrottling: false}});
    const s = this.current = {win, marks: new RobotMarks(), generation: 1, lastProbe: null, ready: false,
      checkPending: false, pulse: false, reaction: null, writing: false, rx: Buffer.alloc(MAX_RX), used: 0,
      opened: this.now(), stale: false};
    const fault = code => {
      if (this.current !== s) return;
      this.close();
      onFault(code);
    };
    const handle = (name, fn) => {
      const key = 'robot-device:' + name;
      this.electron.ipcMain.handle(key, (event, ...args) => {
        if (this.current !== s || win.isDestroyed() || event.sender !== win.webContents ||
            event.senderFrame !== win.webContents.mainFrame || event.senderFrame.url.split('?')[0] !== PAGE_URL) return null;
        return fn(...args);
      });
      this.handlers.push(key);
    };
    handle('probe', token => {
      if (!validProbe(token)) return null;
      const now = this.now();
      if (s.lastProbe !== null && now - s.lastProbe > SILENCE_MS) {
        s.generation++; s.used = 0; s.marks = new RobotMarks(); s.pulse = false; s.reaction = null;
        if (!s.stale) onDelivery({phase: 'sleeping', session: 0, id: 0, checksum: 0, attempts: 0});
        s.stale = true;
      }
      s.checkPending = false;
      let state;
      try { state = this.getPresence(); } catch { return null; }
      const sample = s.marks.sample(state, token);
      if (!sample || this.current !== s) return null;
      s.ready = true; s.stale = false; s.lastProbe = now; s.token = token;
      const reply = {...sample, generation: s.generation, pulse: s.pulse, reaction: s.reaction};
      s.pulse = false; s.reaction = null;
      return reply;
    });
    handle('touch', (generation, token, kind) => {
      if (s.ready && !s.stale && generation === s.generation && token === s.token &&
          this.now() - s.lastProbe <= SILENCE_MS && (kind === 'poke' || kind === 'huff')) this.onTouch(kind);
    });
    handle('write', async (generation, bytes) => {
      if (s.lastProbe === null || this.now() - s.lastProbe > SILENCE_MS || generation !== s.generation) return false;
      if (!(bytes instanceof Uint8Array) || !bytes.length || bytes.length > MAX_TX || s.writing) {
        fault('worker'); return false;
      }
      s.writing = true;
      try {
        if (await write(bytes) === false) throw Error('write refused');
        return this.current === s;
      } catch { fault('transport'); return false; }
      finally { s.writing = false; }
    });
    handle('read', () => {
      if (!s.used) return null;
      const bytes = Uint8Array.from(s.rx.subarray(0, s.used));
      s.used = 0;
      return bytes;
    });
    handle('delivery', value => {
      if (!value || value.generation !== s.generation || !phases.has(value.phase) ||
          ![value.session, value.id, value.checksum, value.attempts].every(uint32) || value.attempts > 3) return;
      if (this.now() - s.lastProbe > SILENCE_MS && value.phase !== 'sleeping') return;
      const {phase, session, id, checksum, attempts} = value;
      onDelivery({phase, session, id, checksum, attempts});
    });
    handle('fault', code => fault(code === 'incompatible' ? code : 'worker'));
    win.webContents.setWindowOpenHandler(() => ({action: 'deny'}));
    win.webContents.on('will-navigate', event => event.preventDefault());
    win.webContents.on('will-attach-webview', event => event.preventDefault());
    win.webContents.on('render-process-gone', () => fault('worker'));
    win.on('closed', () => fault('worker'));
    s.watchdog = setInterval(() => {
      const now = this.now();
      if (!s.ready && now - s.opened > 8000) { fault('worker'); return; }
      if (s.ready && now - s.lastProbe > SILENCE_MS && !s.stale) {
        s.stale = true; onDelivery({phase: 'sleeping', session: 0, id: 0, checksum: 0, attempts: 0});
      }
    }, 800);
    win.loadFile(PAGE, {query: {lang: this.language() === 'zh' ? 'zh' : 'en'}}).catch(() => fault('worker'));
    return {
      receive: bytes => {
        if (this.current !== s || !bytes?.length) return;
        if (!(bytes instanceof Uint8Array) || bytes.length > MAX_RX - s.used) { fault('transport'); return; }
        s.rx.set(bytes, s.used); s.used += bytes.length;
      },
      close: () => { if (this.current === s) this.close(); },
    };
  }
  check() {
    const s = this.current;
    if (!s || !s.ready || s.checkPending) return;
    s.checkPending = true; s.win.webContents.send('robot-device:check');
  }
  present(state) { if (this.current?.marks.observe(state)) this.check(); }
  pulse() { if (this.current?.ready) { this.current.pulse = true; this.check(); } }
  react(kind) { if (this.current?.ready && SHARED_REACTIONS.includes(kind)) { this.current.reaction = kind; this.check(); } }
  close() {
    const s = this.current; this.current = null;
    for (const channel of this.handlers.splice(0)) this.electron.ipcMain.removeHandler(channel);
    if (s) { clearInterval(s.watchdog); if (!s.win.isDestroyed()) s.win.destroy(); }
  }
  dispose() { this.close(); }
}
module.exports = {RobotDeviceBody};
