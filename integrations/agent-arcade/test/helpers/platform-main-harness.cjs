'use strict';
// Runs the actual main-process startup (src/main.cjs, including the whenReady
// body and every registered IPC handler) against a synthetic Electron, in an
// isolated temporary profile, for a platform chosen by the test. Nothing is
// launched: no window, no tray, no account, no network and no child process.
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), vm = require('node:vm');
const {createRequire} = require('node:module'), {pathToFileURL} = require('node:url'), {EventEmitter} = require('node:events');
const MAIN = path.resolve(__dirname, '../../src/main.cjs'), fromMain = createRequire(MAIN);

class FakeImage {
  constructor(size = 16) { this.size = size; this.representations = []; }
  isEmpty() { return false; }
  getSize() { return {width: this.size, height: this.size}; }
  resize({width, height} = {}) { return new FakeImage(width || height || this.size); }
  toPNG() { return Buffer.from(`png-${this.size}`); }
  toDataURL() { return ''; }
  addRepresentation(value) { this.representations.push(value); }
}

async function boot(t, {platform, tray = true, nativeImage, pickFile, update, installedVoices, draftHandoff, providerLogin} = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'arcade-platform-main-'));
  const handlers = new Map(), appEvents = new Map(), intervals = [];
  const calls = {menus: [], appUserModelIds: [], dockIcons: [], quits: 0, trays: [], windows: [], shows: 0, hides: 0, focuses: 0, errors: [], constructed: [], privilegedSchemes: []};
  const vault = {isEncryptionAvailable: () => true, encryptString: text => Buffer.from(text).map(byte => byte ^ 0x5a), decryptString: bytes => Buffer.from(bytes).map(byte => byte ^ 0x5a).toString()};
  const indexUrl = pathToFileURL(path.join(path.dirname(MAIN), 'ui', 'index.html')).href;
  class FakeWindow extends EventEmitter {
    constructor(options) {
      super(); this.setMaxListeners(0); this.options = options; this.visible = true; this.destroyed = false; calls.windows.push(this);
      this.webContents = Object.assign(new EventEmitter(), {mainFrame: {url: indexUrl}, send() {}, setWindowOpenHandler() {}, isDestroyed: () => false});
    }
    isDestroyed() { return this.destroyed; } isVisible() { return this.visible; } isMinimized() { return false; } isFocused() { return false; }
    show() { calls.shows++; this.visible = true; } hide() { calls.hides++; this.visible = false; } focus() { calls.focuses++; }
    setAlwaysOnTop() {} setMinimumSize() {} setSize() {} setBackgroundColor() {} loadURL() {}
  }
  class FakeTray { constructor(image) { if (!tray) throw Error('No tray on this desktop'); this.image = image; calls.trays.push(this); } setToolTip() {} on() {} setContextMenu(menu) { this.menu = menu; } }
  class FakeNotification extends EventEmitter { static isSupported() { return false; } show() {} close() {} }
  const nativeTheme = Object.assign(new EventEmitter(), {shouldUseDarkColors: false, themeSource: 'system'});
  let readyRequested = false;
  const app = {
    requestSingleInstanceLock: () => true, on: (name, fn) => { appEvents.set(name, fn); }, whenReady: () => { readyRequested = true; return Promise.resolve(); },
    getLocale: () => 'en-US', getName: () => 'Agent Arcade', getPath: () => path.join(root, 'userData'), getAppPath: () => path.dirname(path.dirname(MAIN)),
    getApplicationNameForProtocol: draftHandoff?.handler || (() => ''),
    isPackaged: false, setAppUserModelId: id => { calls.appUserModelIds.push(id); }, quit: () => { calls.quits++; },
    ...(platform === 'darwin' ? {dock: {setIcon: image => { calls.dockIcons.push(image); }}} : {}),
  };
  const electron = {
    app, BrowserWindow: FakeWindow, Tray: FakeTray, Notification: FakeNotification, nativeTheme, safeStorage: vault,
    protocol: {registerSchemesAsPrivileged(schemes) {
      if (readyRequested) throw Error('Privileged schemes must register before app ready.');
      calls.privilegedSchemes.push(structuredClone(schemes));
    }},
    ipcMain: {handle: (name, fn) => { handlers.set(name, fn); }},
    Menu: {buildFromTemplate: template => ({template}), setApplicationMenu: menu => { calls.menus.push(menu); }},
    nativeImage: nativeImage || {createFromBuffer: () => new FakeImage(16), createFromPath: () => new FakeImage(16), createFromBitmap: (_bytes, options) => new FakeImage(options.width)},
    dialog: {showMessageBox:update?.confirm, showErrorBox: (_title, message) => { calls.errors.push(message); }, showOpenDialog: pickFile || (async () => ({canceled: true, filePaths: []})), showSaveDialog: async () => ({canceled: true})},
    session: {defaultSession: {setPermissionRequestHandler() {}}},
    clipboard: {writeText: draftHandoff?.copy || (() => {})}, shell: {openExternal: draftHandoff?.open || (async () => {}), openPath: async () => ''},
  };
  // Windows-only construction is observed, not executed, so a simulated Windows
  // start never inspects processes on the machine running the test.
  const observed = (id, names) => { const real = fromMain(id), copy = {...real}; for (const name of names) copy[name] = class { constructor() { calls.constructed.push(name); } snapshot() { return {observed: name}; } close() { return {closed: true}; } closeCurrent() { return Promise.resolve({closed: true}); } observe() {} retireOrphanPreviews() {} }; return copy; };
  const replaced = new Map([
    ['./bot/qq-console.cjs', () => observed('./bot/qq-console.cjs', ['QQConsole'])],
    ['./bot/qq-components.cjs', () => {
      const {QQComponents}=observed('./bot/qq-components.cjs',['QQComponents']);
      return {QQComponents:class extends QQComponents{execute({action}){if(action!=='pending-dismiss')throw Error('Unexpected component action');}}};
    }],
    ['./bot/qq-remote-panel.cjs', () => observed('./bot/qq-remote-panel.cjs', ['QQRemotePanel'])],
    ['./bot/qq-transfer-panel.cjs', () => observed('./bot/qq-transfer-panel.cjs', ['QQTransferPanel'])],
    ['./bot/qq-transfer-local.cjs', () => observed('./bot/qq-transfer-local.cjs', ['QQTransferLocal'])],
    ['./bot/qq-transfer-jobs.cjs', () => { const copy = observed('./bot/qq-transfer-jobs.cjs', ['QQTransferJobs']); const Base = copy.QQTransferJobs; copy.QQTransferJobs = class extends Base { settleRetirementCleanup() { return {closed: true}; } }; return copy; }],
    ['./bot/qq-supervisor-panel.cjs', () => observed('./bot/qq-supervisor-panel.cjs', ['QQSupervisorPanel'])],
    ['./auth/windows-webauthn.cjs', () => observed('./auth/windows-webauthn.cjs', ['WindowsWebAuthn'])],
  ]);
  if(providerLogin)replaced.set('./bot/provider-login.cjs',()=>({createProviderLogin:()=>providerLogin}));
  if(installedVoices){
    const file='./voice/qq-installed-voices.cjs';
    // The picker module imports the same backend itself. Use the real picker
    // with the fixture list/render functions and keep the main wiring intact.
    replaced.set(file,()=>({...fromMain(file),...installedVoices}));
    replaced.set('./voice/qq-character-voices.cjs',()=>{
      const {QQCharacterVoices}=fromMain('./voice/qq-character-voices.cjs');
      return {QQCharacterVoices:class extends QQCharacterVoices{
        constructor(options){super({...options,listWindows:installedVoices.listWindowsVoices,renderWindows:installedVoices.renderWindowsVoice});}
      }};
    });
  }
  if (update) {
    app.isPackaged = true;
    replaced.set('./core/windows-app-update.cjs', () => {
      const real=fromMain('./core/windows-app-update.cjs');
      return {...real,dailyUpdateBinding:()=>({}),createWindowsUpdate:opts=>real.createWindowsUpdate({...opts,open:update.open})};
    });
    if (update.refuseQuit) replaced.set('./voice/asr-gate.cjs', () => {
      const real=fromMain('./voice/asr-gate.cjs');
      return {...real,AsrGate:class extends real.AsrGate {async close(){return {closed:false};}}};
    });
  }
  const env = {AGENT_ARCADE_HOME: root, AGENT_ARCADE_CLAUDE_SETTINGS: path.join(root, 'home', '.claude', 'settings.json'), LOCALAPPDATA: path.join(root, 'local'), HOME: path.join(root, 'home'), PATH: ''};
  const context = {
    __dirname: path.dirname(MAIN), module: {exports: {}}, console,
    process: {argv: [], env, platform, arch: 'arm64', pid: process.pid, execPath: process.execPath, versions: process.versions},
    setInterval: (fn, ms) => { const timer = {fn, ms}; intervals.push(timer); return timer; }, clearInterval: timer => { const at = intervals.indexOf(timer); if (at >= 0) intervals.splice(at, 1); },
    setTimeout, clearTimeout, setImmediate, queueMicrotask, Buffer, URL, AbortController, AbortSignal, structuredClone, TextEncoder, TextDecoder,
    require: id => id === 'electron' ? electron : replaced.has(id) ? replaced.get(id)() : fromMain(id),
  };
  vm.runInNewContext(fs.readFileSync(MAIN, 'utf8') + '\nmodule.exports={state:()=>({hostGate,qqConsole,qqComponents,qqCompanionLaunch,remotePanel,transferPanel,supervisorPanel,transferLocal,qceScheduleTimer,tray,cleanedUp,problem,accounts,pets,bus}),publish};', context, {filename: MAIN});
  // whenReady resolved already; its callback runs on the next microtasks.
  for (let turn = 0; turn < 20 && !calls.windows.length && !calls.errors.length; turn++) await new Promise(resolve => setImmediate(resolve));
  if (calls.errors.length) throw Error(`Startup failed: ${calls.errors.join('; ')}`);
  const window = calls.windows[0], event = {sender: window.webContents, senderFrame: window.webContents.mainFrame};
  const invoke = (name, value) => handlers.get('arcade:' + name)(event, value);
  let quitDone = false;
  const quit = async () => {
    if (quitDone) return; quitDone = true;
    const before = appEvents.get('before-quit');
    for (let attempt = 0; attempt < 2 && !context.module.exports.state().cleanedUp; attempt++) {
      before({preventDefault() {}});
      for (let turn = 0; turn < 400 && !context.module.exports.state().cleanedUp && !context.module.exports.state().problem; turn++) await new Promise(resolve => setTimeout(resolve, 5));
    }
  };
  t.after(async () => {
    await quit();
    const resolved = fs.realpathSync(root), base = fs.realpathSync(os.tmpdir());
    if (!resolved.startsWith(base + path.sep) || !path.basename(resolved).startsWith('arcade-platform-main-')) throw Error('Unexpected fixture directory');
    fs.rmSync(resolved, {recursive: true, force: true, maxRetries: 5, retryDelay: 50});
  });
  return {root, env, handlers, appEvents, intervals, calls, window, event, invoke, quit, api: context.module.exports};
}
module.exports = {boot, FakeImage};
