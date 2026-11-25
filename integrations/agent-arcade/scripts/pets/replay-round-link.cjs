'use strict';
// Replay a recorded round-screen App endpoint in Electron, without a serial port.
// electron scripts/pets/replay-round-link.cjs path/to/app-replay.json
const {app, BrowserWindow} = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const {createHash} = require('node:crypto');

const root = path.resolve(__dirname, '../..');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

// Runs in a sandboxed page. Only the clock, random choices and byte transport
// are supplied by the replay. The portrait, canvas, driver and codec are real.
async function prepare(seed, recordedTouch) {
  const {RobotDriver} = await import('./driver.js');
  const {RobotLink} = await import('./link.js');
  const skin = '#211713';
  const image = new Image();
  image.src = './assets/ju-portrait.webp';
  await image.decode();
  const random = crypto.getRandomValues.bind(crypto);
  // H15 recorded a starting nonce and advanced one nonzero uint32 per HELLO.
  // Supply that recorded sequence to the current driver's random source.
  let nextNonce = seed;
  crypto.getRandomValues = array => {
    if (!(array instanceof Uint32Array) || array.length !== 1) return random(array);
    array[0] = nextNonce;
    nextNonce = ((nextNonce + 1) >>> 0) || 1;
    return array;
  };
  const {isRoundDisplayHello} = await import('./wire.js');
  const reactions = [];
  const writes = [];
  let elapsed = 0;
  const link = new RobotLink({skin, ...(recordedTouch && {checkHello: isRoundDisplayHello, now: () => elapsed,
    onEvent(kind) { const felt = driver.deviceEvent(kind); if (felt) reactions.push(felt); }})});
  const driver = new RobotDriver({meta: {skin}, screen: 'ju-portrait-480', portrait: image, language: recordedTouch ? 'zh' : 'en',
    calm: true, random: () => 0.5, nowMs: () => elapsed, link, write: bytes => writes.push(bytes)});
  if (recordedTouch) driver.setQuiet(true);
  function base64(bytes) {
    let text = '';
    for (let i = 0; i < bytes.length; i += 16384) text += String.fromCharCode(...bytes.subarray(i, i + 16384));
    return btoa(text);
  }
  window.runRoundReplay = command => {
    switch (command.op) {
      case 'tick': elapsed += command.ms; driver.tick(command.ms / 1000); break;
      case 'present': driver.present({activity: command.activity, attention: command.attention === true}); break;
      case 'receive': link.receive(Uint8Array.from(atob(command.data), c => c.charCodeAt(0))); break;
      case 'recorded-first-picture': {
        if (!recordedTouch || driver.pictures.lastId || !driver.pictures.session) throw Error('Expected a new touch session');
        const raw = Uint8Array.from(atob(command.data), c => c.charCodeAt(0));
        if (raw.length !== 504 * 504 * 2) throw Error('Expected the full recorded RGB565 picture');
        // Replay the H17 device's recorded first content exactly once, so its
        // original ACK applies on hosts with different image/color renderers.
        const capture = driver.capturePixels;
        driver.capturePixels = function () { this.capturePixels = capture; return new Uint16Array(raw.buffer); };
        break;
      }
      case 'view': writes.push(...link.bytesFor({type: 'view', ...command.view})); break;
      case 'pixels': break;
      default: throw Error('Unknown round link replay operation');
    }
    const bytes = new Uint8Array(writes.reduce((size, part) => size + part.length, 0));
    let at = 0;
    for (const part of writes) { bytes.set(part, at); at += part.length; }
    writes.length = 0;
    return {bytes: base64(bytes), state: driver.deliveryState, reactions: reactions.splice(0),
      ...(command.op === 'pixels' ? {pixels: base64(new Uint8Array(driver.capturePixels().buffer))} : {})};
  };
}

async function openRoundReplay(seed, {recordedTouch = false} = {}) {
  if (!Number.isSafeInteger(seed) || seed < 1 || seed > 0xffffffff) throw Error('Expected a nonzero uint32 replay nonce');
  const win = new BrowserWindow({show: false, webPreferences: {sandbox: true, contextIsolation: true, backgroundThrottling: false}});
  await win.loadFile(path.join(root, 'src/pet/robot/twin.html'), {query: {asset: '1', screen: 'ju-portrait-480'}});
  await win.webContents.executeJavaScript('(' + prepare.toString() + ')(' + seed + ',' + (recordedTouch === true) + ')');
  return {
    async step(command) {
      const result = await win.webContents.executeJavaScript('window.runRoundReplay(' + JSON.stringify(command) + ')');
      return {bytes: Buffer.from(result.bytes, 'base64'), state: result.state, reactions: result.reactions,
        ...(result.pixels ? {pixels: Buffer.from(result.pixels, 'base64')} : {})};
    },
    close() { win.destroy(); },
  };
}

async function replay(file) {
  const tape = JSON.parse(fs.readFileSync(file, 'utf8'));
  const session = await openRoundReplay(tape.nonce);
  const dir = path.dirname(file);
  try {
    for (const row of tape.steps) {
      const command = {...row.command};
      if (command.op === 'receive') {
        const file = path.resolve(dir, command.file);
        const relative = path.relative(dir, file);
        if (relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) throw Error('Reply file is outside the recording');
        command.data = fs.readFileSync(file).toString('base64');
      }
      const result = await session.step(command);
      assert.equal(result.state, row.state, row.name);
      assert.equal(digest(result.bytes), row.bytesSha256, row.name);
      if (row.pixelsSha256) assert.equal(digest(result.pixels), row.pixelsSha256, row.name);
    }
    console.log('Matched ' + tape.steps.length + ' recorded App steps');
  } finally { session.close(); }
}

module.exports = {openRoundReplay};
if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'aap-round-replay-'));
  app.setPath('userData', profile);
  app.disableHardwareAcceleration();
  app.whenReady().then(() => replay(path.resolve(process.argv[2]))).then(() => app.exit(0), error => {console.error(error); app.exit(1);});
  app.on('quit', () => { try {fs.rmSync(profile, {recursive: true, force: true});} catch { /* Chromium is closing */ } });
}
