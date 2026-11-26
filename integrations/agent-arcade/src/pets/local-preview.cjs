'use strict';
// Packaging entry for the local Ju showcase. It opens the production pet
// window without starting the desktop app, account services or vault.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {setTimeout: delay} = require('node:timers/promises');
const electron = require('electron');
const {app, protocol, screen} = electron;
const {PetWindows, registerScheme} = require('./windows.cjs');
const {credentialStartupAllowed} = require('../core/credential-startup-policy.cjs');
const metadata = require('../../package.json');

async function checkWindow(window) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (window.isDestroyed()) throw Error('Ju preview window closed before it rendered.');
    const state = await window.webContents.executeJavaScript(`({
      model: document.body?.dataset.model,
      mode: document.body?.dataset.mode,
      meshes: Number(document.body?.dataset.meshes || 0),
      textures: Number(document.body?.dataset.textures || 0),
      canvas: [document.getElementById('model')?.width,document.getElementById('model')?.height],
      scale: window.devicePixelRatio
    })`).catch(() => null);
    if (state?.mode === 'failed') throw Error('The packaged Ju GLB could not be rendered.');
    if (window.isVisible() && state?.mode === 'idle' && state.meshes > 0) {
      return {...state, bounds: window.getBounds()};
    }
    await delay(80);
  }
  throw Error('Timed out waiting for the packaged Ju window.');
}

async function checkBlink(window) {
  async function capture() {
    const frame = (await window.webContents.capturePage()).resize({width: 208, height: 272});
    return {
      eyes: frame.crop({x: 80, y: 60, width: 40, height: 22}).toBitmap(),
      boots: frame.crop({x: 74, y: 190, width: 60, height: 51}).toBitmap(),
    };
  }
  const initial = await capture();
  const deadline = Date.now() + 5500;
  let changed = false;
  let samples = 0;
  while (Date.now() < deadline) {
    await delay(70);
    const frame = await capture();
    samples++;
    if (!frame.boots.equals(initial.boots)) throw Error('Ju moved off the idle baseline.');
    if (!frame.eyes.equals(initial.eyes)) changed = true;
    else if (changed) return {eyeChangeAndReturn: true, bootsStable: true, samples};
  }
  throw Error('The packaged Ju window did not blink and return to rest.');
}

if (!app.isPackaged || process.platform !== 'darwin' || metadata.localJuPreview !== true ||
    !credentialStartupAllowed(process.argv)) {
  app.exit(1);
} else {
  const profile = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'arcade-ju-local-'));
  app.setPath('userData', profile);
  app.setPath('sessionData', profile);
  app.commandLine.appendSwitch('disable-background-networking');
  registerScheme(protocol);
  const checking = process.argv.includes('--check-preview');
  let pets;
  app.once('before-quit', () => pets?.close());
  app.on('window-all-closed', () => app.quit());
  app.whenReady().then(async () => {
    pets = new PetWindows({
      electron,
      workArea: saved => (saved ? screen.getDisplayMatching(saved) : screen.getPrimaryDisplay()).workArea,
      onChange: () => {},
      onClose: () => app.quit(),
    });
    pets.sync({enabled: ['claude'], language: 'zh', quiet: false});
    const window = pets.windows.get('claude')?.window;
    if (!window) throw Error('The packaged Ju window could not open.');
    if (checking) {
      const visible = await checkWindow(window);
      const blink = await checkBlink(window);
      console.log(JSON.stringify({
        packaged: true, version: app.getVersion(), arch: process.arch, source: metadata.buildSourceCommit,
        profile, ...visible, blink,
      }));
      await window.webContents.executeJavaScript("setTimeout(()=>document.getElementById('close').click(),0);true");
    }
  }).catch(error => {
    console.error(error.message);
    pets?.close();
    app.exit(1);
  });
}
