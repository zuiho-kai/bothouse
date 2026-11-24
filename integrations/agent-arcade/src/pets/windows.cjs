'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const {publicCatalog} = require('../core/personas.cjs');

const SCHEME = 'arcade-pet';
const ORIGIN = SCHEME + '://local';
const ENTRY = ORIGIN + '/index.html';
const TEXTURE_BLOB_PREFIX = 'blob:' + ORIGIN + '/';
function localTextureBlob(url, resourceType) {
  return ['image', 'xhr'].includes(resourceType) && url.startsWith(TEXTURE_BLOB_PREFIX) &&
    /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(url.slice(TEXTURE_BLOB_PREFIX.length));
}
const WIDTH = 208;
const HEIGHT = 272;
const definitions = [
  ['claude', 'claude-ju', 'Claude'], ['gpt', 'codex-dragon', 'GPT'],
  ['codex', 'codex-dragon', 'Codex'], ['deepseek', 'deepseek-whale', 'DeepSeek'],
  ['gemini', 'gemini-cat', 'Gemini'], ['doubao', 'doubao-girl', 'Doubao'],
  ['sprout', 'sprout', ''],
];
const catalog = new Map(publicCatalog().map(row => [row.id, row]));
const PETS = definitions.map(([id, model, provider]) => Object.freeze({id, model, provider, name: catalog.get(model).name}));
const BY_ID = new Map(PETS.map(pet => [pet.id, pet]));

function petId(mode) {
  if (['api', 'native', 'claude'].includes(mode)) return 'claude';
  return BY_ID.has(mode) && mode !== 'sprout' ? mode : null;
}

function enabledPets(value) {
  return Array.isArray(value) ? [...new Set(value.filter(id => BY_ID.has(id)))] : [];
}

function validatePetToggle(value) {
  if (!value || Object.keys(value).length !== 2 || !BY_ID.has(value.id) || typeof value.enabled !== 'boolean') {
    throw Error('Invalid desktop pet selection.');
  }
  return value;
}

function registerScheme(protocol) {
  protocol.registerSchemesAsPrivileged([{scheme: SCHEME, privileges: {standard: true, secure: true, supportFetchAPI: true}}]);
}

function makeResourceLookup(app) {
  const root = path.join(__dirname, '..', '..');
  const files = new Map([
    ['/index.html', [path.join(__dirname, 'index.html'), 'text/html']],
    ['/pet.css', [path.join(__dirname, 'pet.css'), 'text/css']],
    ['/pet.mjs', [path.join(__dirname, 'pet.mjs'), 'text/javascript']],
  ]);
  for (const rel of ['build/three.module.js', 'build/three.core.js']) {
    files.set('/three/' + rel, [path.join(root, 'node_modules/three', rel), 'text/javascript']);
  }
  // electron-builder prunes every dependency's examples directory by default.
  // Mac packaging explicitly carries only the three ES module add-ons used.
  const addonRoot = app.isPackaged ? path.join(process.resourcesPath, 'desktop-pet-addons') :
    path.join(root, 'node_modules/three/examples/jsm');
  for (const rel of ['loaders/GLTFLoader.js', 'utils/BufferGeometryUtils.js', 'utils/SkeletonUtils.js']) {
    files.set('/three/examples/jsm/' + rel, [path.join(addonRoot, rel), 'text/javascript']);
  }
  for (const model of new Set(PETS.map(pet => pet.model))) {
    files.set('/models/' + model + '.glb', [path.join(root, 'src/assets/pets', model + '.glb'), 'model/gltf-binary']);
  }
  return value => {
    let url;
    try { url = new URL(value); } catch { return undefined; }
    if (url.protocol !== SCHEME + ':' || url.hostname !== 'local' || url.port ||
        url.username || url.password || url.search || url.hash) return undefined;
    return files.get(url.pathname);
  };
}

class PetWindows {
  constructor({electron, onClose, onChange, workArea}) {
    Object.assign(this, {electron, onClose, onChange, workArea});
    this.windows = new Map();
    this.failures = new Set();
    this.positions = new Map();
    this.settings = [];
    this.language = 'en';
    this.activity = new Map();
    this.bindings = new Map();
    this.closed = false;
  }

  snapshot(supported) {
    return {supported, pets: supported ? PETS.map(pet => ({
      id: pet.id, provider: pet.provider, name: this.character(pet).name,
      enabled: this.settings.includes(pet.id), unavailable: this.failures.has(pet.id),
    })) : []};
  }

  initialize() {
    if (this.session) return;
    const resources = makeResourceLookup(this.electron.app);
    const {ipcMain, session} = this.electron;
    this.session = session.fromPartition('arcade-desktop-pets', {cache: false});
    this.session.setPermissionRequestHandler((_contents, _permission, cb) => cb(false));
    this.session.setPermissionCheckHandler(() => false);
    // Three decodes embedded GLB PNGs through ImageBitmapLoader's fetch of
    // a short-lived object URL. Keep requests in the isolated pet origin.
    this.session.webRequest.onBeforeRequest(({url, resourceType}, callback) =>
      callback({cancel: !resources(url) && !localTextureBlob(url, resourceType)}));
    this.session.protocol.handle(SCHEME, async request => {
      const resource = request.method === 'GET' && resources(request.url);
      if (!resource) return new Response(null, {status: 404});
      try {
        return new Response(await fs.readFile(resource[0]), {headers: {
          'Content-Type': resource[1], 'X-Content-Type-Options': 'nosniff',
          'Cache-Control': 'no-store',
        }});
      } catch {
        return new Response(null, {status: 404});
      }
    });
    ipcMain.handle('arcade-pet:init', event => this.payload(this.authorize(event)));
    ipcMain.handle('arcade-pet:close', event => this.authorize(event).window.close());
  }

  authorize(event) {
    const entry = [...this.windows.values()].find(item => item.window.webContents === event.sender);
    if (!entry || this.closed || event.senderFrame !== event.sender.mainFrame || event.senderFrame.url !== ENTRY) {
      throw Error('Untrusted desktop pet window.');
    }
    return entry;
  }

  character(pet) {
    return catalog.get(this.bindings.get(pet.id)?.character || pet.model);
  }

  payload({pet, bindingRevision}) {
    const character = this.character(pet);
    return {
      id: pet.id, modelPath: '/models/' + character.id + '.glb', name: character.name[this.language],
      provider: pet.provider, language: this.language, quiet: this.quiet,
      busy: this.activity.get(pet.id) === true, bindingRevision,
    };
  }

  notify(entry, name, value) {
    if (!entry.window.isDestroyed() && !entry.window.webContents.isDestroyed()) {
      entry.window.webContents.send('arcade-pet:' + name, value);
    }
  }

  bounds(id, index) {
    const saved = this.positions.get(id);
    // Use the remembered window rectangle to select a currently visible
    // display. The main window remains the starting point for new pets.
    const area = this.workArea(saved);
    const columns = Math.max(1, Math.floor((area.width - 16) / WIDTH));
    const x = saved?.x ?? area.x + area.width - WIDTH - 8 - (index % columns) * WIDTH;
    const y = saved?.y ?? area.y + area.height - HEIGHT - 8 - Math.floor(index / columns) * HEIGHT;
    return {
      x: Math.round(Math.max(area.x, Math.min(x, area.x + area.width - WIDTH))),
      y: Math.round(Math.max(area.y, Math.min(y, area.y + area.height - HEIGHT))),
      width: WIDTH, height: HEIGHT,
    };
  }

  open(pet) {
    this.initialize();
    const {BrowserWindow} = this.electron;
    const window = new BrowserWindow({
      ...this.bounds(pet.id, PETS.indexOf(pet)), transparent: true, frame: false, show: false,
      alwaysOnTop: true, skipTaskbar: true, resizable: false, fullscreenable: false,
      hasShadow: false, title: this.character(pet).name[this.language],
      webPreferences: {
        session: this.session, preload: path.join(__dirname, 'preload.cjs'),
        contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true,
      },
    });
    const rememberPosition = () => {
      if (this.windows.get(pet.id) === entry && !window.isDestroyed()) {
        this.positions.set(pet.id, window.getBounds());
      }
    };
    const entry = {pet, window, rememberPosition, bindingRevision: 0};
    this.windows.set(pet.id, entry);
    window.on('move', rememberPosition);
    window.on('close', rememberPosition);
    window.once('closed', () => {
      if (this.windows.get(pet.id) !== entry) return;
      this.windows.delete(pet.id);
      this.activity.delete(pet.id);
      this.onClose(pet.id);
    });
    const failed = () => {
      if (this.windows.get(pet.id) !== entry) return;
      this.failures.add(pet.id);
      this.destroy(pet.id);
      this.onChange();
    };
    window.webContents.setWindowOpenHandler(() => ({action: 'deny'}));
    for (const name of ['will-navigate', 'will-redirect', 'will-attach-webview']) {
      window.webContents.on(name, event => event.preventDefault());
    }
    window.webContents.on('render-process-gone', failed);
    window.once('ready-to-show', () => {
      if (!window.isDestroyed()) window.showInactive();
    });
    window.loadURL(ENTRY).catch(failed);
  }

  destroy(id) {
    const entry = this.windows.get(id);
    const open = entry && !entry.window.isDestroyed();
    if (open) entry.rememberPosition?.();
    this.windows.delete(id);
    this.activity.delete(id);
    if (open) entry.window.destroy();
  }

  sync({enabled, language, quiet}) {
    if (this.closed) return;
    const changedAppearance = language !== this.language || quiet !== this.quiet;
    this.settings = enabledPets(enabled);
    this.language = language === 'zh' ? 'zh' : 'en';
    this.quiet = quiet === true;
    for (const pet of PETS) {
      if (!this.settings.includes(pet.id)) {
        this.failures.delete(pet.id);
        this.destroy(pet.id);
      } else if (!this.windows.has(pet.id) && !this.failures.has(pet.id)) {
        try { this.open(pet); } catch { this.failures.add(pet.id); }
      } else if (changedAppearance) {
        const entry = this.windows.get(pet.id);
        if (entry) this.notify(entry, 'state', this.payload(entry));
      }
    }
  }

  observe(services = [], selectedId) {
    if (!this.windows.size) return;
    const bindings = new Map();
    const profiles = [...services].sort(([a], [b]) => Number(b === selectedId) - Number(a === selectedId));
    for (const [accountId, service] of profiles) {
      const id = petId(service.config.mode);
      if (!id || bindings.has(id)) continue;
      const run = service.localCompanion?.run;
      const builtin = run && !run.stCard && !run.stGroup ? run : null;
      const override = service.localCompanion?.desktopPetChoice();
      const character = builtin?.binding.character || override ||
        (service.status === 'connected' ? service.socialStore.config().characterId : BY_ID.get(id).model);
      const groupBusy = [...(service.groupRoute?.actors.values() || [])].some(actor => actor.engine.current);
      const busy = !!(builtin?.engine.operationBusy() ||
        (service.status === 'connected' && (service.dispatcher?.current || groupBusy)));
      const binding = {accountId, character: catalog.has(character) ? character : BY_ID.get(id).model, busy};
      bindings.set(id, binding);
      if (character === 'sprout' && !bindings.has('sprout')) bindings.set('sprout', binding);
    }

    const previous = this.bindings;
    this.bindings = bindings;
    for (const entry of this.windows.values()) {
      const {id} = entry.pet;
      const prior = previous.get(id);
      const next = bindings.get(id);
      const busy = next?.busy === true;
      const bindingChanged = prior?.accountId !== next?.accountId || prior?.character !== next?.character;
      if (!bindingChanged && this.activity.get(id) === busy) continue;
      // Tag queued pet events without sending the account identity to the window.
      if (bindingChanged) entry.bindingRevision++;
      this.activity.set(id, busy);
      entry.window.setTitle(this.character(entry.pet).name[this.language]);
      this.notify(entry, 'state', this.payload(entry));
    }
  }

  reply(mode, character, accountId, {requireBinding = false} = {}) {
    if (this.quiet) return;
    const id = petId(mode);
    for (const target of character === 'sprout' ? [id, 'sprout'] : [id]) {
      const entry = this.windows.get(target);
      if (!entry || this.character(entry.pet).id !== character) continue;
      const bound = this.bindings.get(target);
      if (requireBinding && (!bound || bound.accountId !== accountId || bound.character !== character || !this.settings.includes(target))) continue;
      if (bound?.accountId && bound.accountId !== accountId) continue;
      this.notify(entry, 'reply', {bindingRevision: entry.bindingRevision});
    }
  }

  close() {
    this.closed = true;
    for (const id of this.windows.keys()) this.destroy(id);
  }

  reopen() { this.closed = false; }
}

module.exports = {PetWindows, enabledPets, validatePetToggle, registerScheme};
