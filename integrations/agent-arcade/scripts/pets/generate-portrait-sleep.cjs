'use strict';
// npx electron scripts/pets/generate-portrait-sleep.cjs [--write]
// With no arguments, fail if the installed asset differs by even one byte.
const {app, BrowserWindow} = require('electron');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {setTimeout: delay} = require('node:timers/promises');

const root = path.resolve(__dirname, '../..');
const file = path.join(root, 'hardware/pet-robot/firmware/assets/ju-portrait-480.aaps');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-arcade-portrait-asset-'));
app.setPath('userData', profile);
app.disableHardwareAcceleration();

async function generate() {
  const version = require('../../package.json').devDependencies.electron;
  if (process.versions.electron !== version) throw Error(`Use Electron ${version} from the project lockfile`);
  const win = new BrowserWindow({show: false, webPreferences: {sandbox: true, contextIsolation: true, backgroundThrottling: false}});
  try {
    await win.loadFile(path.join(root, 'src/pet/robot/twin.html'), {query: {asset: '1', screen: 'ju-portrait-480'}});
    const deadline = Date.now() + 15000;
    while (win.webContents.getTitle() !== 'pet-ready') {
      if (win.webContents.getTitle() === 'pet-error' || Date.now() >= deadline) throw Error('Could not render the portrait sleep asset');
      await delay(30);
    }
    const bytes = Buffer.from(await win.webContents.executeJavaScript('window.asset'), 'base64');
    if (bytes.length <= 11 || bytes.readUInt32BE(0) !== 0x41415053 || bytes[4] !== 1 ||
        bytes.readUInt16LE(7) !== 504 || bytes.readUInt16LE(9) !== 504) throw Error('Expected a 504 x 504 AAPS v1 portrait');
    if (process.argv.includes('--write')) {
      const temporary = file + '.' + process.pid + '.tmp';
      try {
        fs.writeFileSync(temporary, bytes, {flag: 'wx'});
        fs.renameSync(temporary, file);
      } finally {
        fs.rmSync(temporary, {force: true});
      }
    } else if (!fs.readFileSync(file).equals(bytes)) {
      throw Error('The committed portrait differs from a fresh render. Use --write to update it.');
    }
    console.log(`${path.basename(file)} ${bytes.length} bytes, SHA-256 ${crypto.createHash('sha256').update(bytes).digest('hex')}`);
  } finally {
    win.destroy();
  }
}

app.whenReady().then(generate).then(() => app.exit(0), error => {
  console.error(error);
  app.exit(1);
});
app.on('quit', () => {
  try { fs.rmSync(profile, {recursive: true, force: true}); } catch { /* Chromium may still hold a cache file on exit. */ }
});
