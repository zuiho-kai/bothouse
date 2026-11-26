'use strict';
// node scripts/pets/test-desktop-touch.cjs [--out DIRECTORY]
// Replays the H17 device recording into two actual desktop-pet windows.
// The control follows the same renderer clock without receiving any touches.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {createHash} = require('node:crypto');
const {spawnSync} = require('node:child_process');
const {setTimeout: pause} = require('node:timers/promises');
const root = path.resolve(__dirname, '../..');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');

function launch() {
  const args = process.argv.slice(2);
  assert(args.length === 0 || (args.length === 2 && args[0] === '--out' && args[1]), 'Use [--out DIRECTORY]');
  const base = path.resolve(args[1] || path.join(root, 'outputs', 'desktop-touch'));
  fs.mkdirSync(base, {recursive: true});
  const output = fs.mkdtempSync(path.join(base, 'run-'));
  const temp = fs.realpathSync(os.tmpdir());
  const profile = fs.mkdtempSync(path.join(temp, 'arcade-h19-'));
  const env = {HOME: profile, USERPROFILE: profile, H19_PROFILE: profile, H19_OUTPUT: output};
  for (const key of ['SystemRoot', 'WINDIR', 'ComSpec', 'SystemDrive', 'PATH', 'PATHEXT',
    'TEMP', 'TMP', 'TMPDIR', 'LANG', 'LC_ALL', 'LC_CTYPE']) {
    if (process.env[key]) env[key] = process.env[key];
  }
  for (const key of ['APPDATA', 'LOCALAPPDATA', 'XDG_CONFIG_HOME', 'XDG_CACHE_HOME', 'XDG_DATA_HOME', 'AGENT_ARCADE_HOME']) {
    env[key] = path.join(profile, key);
    fs.mkdirSync(env[key]);
  }
  try {
    const child = spawnSync(require('electron'), ['--user-data-dir=' + path.join(profile, 'electron'), __filename],
      {env, cwd: root, stdio: 'inherit', windowsHide: true, timeout: 240_000});
    if (child.error) throw child.error;
    process.exitCode = child.status ?? 1;
  } finally {
    assert.equal(path.dirname(fs.realpathSync(profile)), temp);
    assert.match(path.basename(profile), /^arcade-h19-[a-zA-Z0-9]+$/);
    fs.rmSync(profile, {recursive: true, force: true, maxRetries: 4, retryDelay: 250});
    console.log(output);
  }
}

async function test() {
  const {app, BrowserWindow, ipcMain, screen, session} = require('electron');
  const {PetPresence} = require('../../src/pet/presence.cjs');
  const {PetWindow, supported} = require('../../src/pet/window.cjs');
  const {installPixelClock, samplePetFrame, comparePetFrames} = require('./desktop-touch-pixels.cjs');
  const {openRecordedTouch} = require('./recorded-round-touch.cjs');
  const out = process.env.H19_OUTPUT, profile = fs.realpathSync(process.env.H19_PROFILE);
  assert.equal(path.dirname(profile), fs.realpathSync(os.tmpdir()));
  assert(['win32', 'darwin'].includes(process.platform), 'Run this desktop-window fixture on Windows or macOS');
  const darwin = process.platform === 'darwin';
  app.setPath('appData', profile);
  app.setPath('userData', path.join(profile, 'electron'));
  for (const flag of ['disable-background-networking', 'disable-component-update', 'disable-sync', 'use-mock-keychain',
    'disable-renderer-backgrounding', 'disable-background-timer-throttling', 'enable-unsafe-swiftshader']) app.commandLine.appendSwitch(flag);
  app.commandLine.appendSwitch('use-gl', 'angle');
  app.commandLine.appendSwitch('use-angle', 'swiftshader');
  app.commandLine.appendSwitch('password-store', 'basic');
  const source = ['src/pet/presence.cjs', 'src/pet/window.cjs', 'src/pet/preload.cjs', 'src/pet/pet.html', 'src/pet/pet.js',
    'src/pet/desktop.js', 'src/pet/pet.css', 'src/pet/cue.js', 'src/pet/stage.js', 'src/pet/motion.js',
    'src/pet/touch.js', 'src/pet/springs.js', 'src/pet/face.js',
    'src/pet/models/ju.glb', 'src/pet/models/ju.json', 'src/pet/robot/link.js', 'src/pet/robot/driver.js',
    'src/pet/robot/picture-delivery.js', 'src/pet/robot/wire.js', 'scripts/pets/test-desktop-touch.cjs',
    'scripts/pets/desktop-touch-pixels.cjs', 'scripts/pets/recorded-round-touch.cjs', 'scripts/pets/replay-round-link.cjs',
    'test/fixtures/h17-recorded-touch.json', 'test/fixtures/h17-idle.rgb565.gz'];
  const git = (...args) => spawnSync('git', args, {cwd: root, encoding: 'utf8'}).stdout?.trim();
  const checkout = git('rev-parse', '--show-toplevel');
  const report = {
    passed: false, platform: process.platform, electron: process.versions.electron, productSupportsThisOS: supported(),
    windowMode: darwin ? 'native macOS PetWindow, controlled renderer clock and pointer' :
      'Windows Electron BrowserWindow fixture with PetWindow platform=darwin',
    inputs: Object.fromEntries(source.map(name => [name, sha(fs.readFileSync(path.join(root, name)))])),
    gitHead: checkout && path.relative(checkout, root) === '' ? git('rev-parse', 'HEAD') : null,
    physicalHardware: false, remoteRequests: [], errors: [], scenarios: {},
  };
  const controllers = new Set();
  app.on('window-all-closed', () => {}); // keep the isolated process alive between the two scenarios

  async function until(fn, label) {
    const end = Date.now() + 20_000;
    while (Date.now() < end) {
      const result = await fn();
      if (result) return result;
      await pause(25);
    }
    throw Error(label);
  }
  class ClockWindow extends BrowserWindow {
    async loadFile(file, options) {
      await installPixelClock(this.webContents);
      this.loadedLocalFiles = [];
      const cdp = this.webContents.debugger;
      cdp.on('message', (_event, method, params) => {
        if (method !== 'Network.responseReceived' || !params.response.url.startsWith('file:')) return;
        this.loadedLocalFiles.push(path.basename(new URL(params.response.url).pathname));
      });
      await cdp.sendCommand('Network.enable');
      // This replay measures the historical 3D model's eye whites and lean.
      return super.loadFile(file, {...options, query: {...options.query, model: '3d'}});
    }
  }
  async function body(label, log) {
    const presence = new PetPresence({onError: (error, id, method) => report.errors.push([id, method, String(error)])});
    const settings = {enabled: true, pet: 'ju', size: 'l'};
    const pet = new PetWindow({electron: {BrowserWindow: ClockWindow, ipcMain, screen}, platform: darwin ? process.platform : 'darwin',
      getSettings: () => settings, saveSettings: () => { throw Error('Unexpected settings write'); },
      // The unattended twin stays in the same unhovered pose on both hosts.
      interval: {set: () => 1, clear() {}}, language: () => 'zh'});
    controllers.add(pet);
    presence.attach('desktop', pet);
    presence.attach('robot-device', {react() { throw Error('The sender received its own touch'); }});
    pet.apply();
    const wc = pet.win.webContents;
    const loading = log.windows[label] = {messages: []};
    wc.on('console-message', info => {
      if (info.level === 'error') loading.messages.push(info.message);
    });
    try {
      await until(() => {
        if (pet.problem) throw Error(pet.problem);
        return pet.ready;
      }, 'Timed out loading the model for ' + label);
    } catch (error) {
      if (!wc.isDestroyed()) {
        loading.diagnosis = wc.getURL() ? await Promise.race([
          wc.executeJavaScript('({title:document.title, url:location.href, state:document.readyState, bridge:typeof window.petHost, clock:typeof window.__petTestSample, resources:performance.getEntriesByType("resource").map(e=>e.name)})'),
          pause(1200).then(() => 'renderer did not answer'),
        ]) : 'window has not navigated';
      }
      throw error;
    }
    const info = await wc.executeJavaScript('(' + function () {
      window.__h19Received = [];
      window.petHost.onGesture(kind => window.__h19Received.push(kind));
      return {url: location.href, title: document.title, bridge: Object.keys(window.petHost).sort(),
        resources: performance.getEntriesByType('resource').map(r => new URL(r.name).pathname.split('/').pop()),
        reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches};
    }.toString() + ')()');
    log.windows[label] = {...info, loadedFiles: pet.win.loadedLocalFiles, url: path.basename(new URL(info.url).pathname), bounds: pet.win.getContentBounds()};
    assert.equal(info.title, 'pet-ready');
    assert.equal(new URL(info.url).searchParams.has('preview'), false);
    assert(pet.win.loadedLocalFiles.includes('ju.glb') && pet.win.loadedLocalFiles.includes('stage.js'), label + ' loaded model and renderer');
    return {pet, presence, wc};
  }

  async function scenario(name, triple) {
    const dir = path.join(out, name);
    fs.mkdirSync(dir);
    const log = report.scenarios[name] = {windows: {}, inputs: [], delivered: [], frames: {}, captures: {}};
    const subject = await body('touched', log), control = await body('control', log);
    let frame = -110;
    const replay = await openRecordedTouch({onTouch(kind) {
      assert(subject.presence.touched('robot-device', kind));
      log.delivered.push(kind);
    }});
    try {
      log.recording = replay.proof;
      async function input(key, expected) {
        const before = log.delivered.length;
        const actual = await replay.receive(key);
        assert.equal(actual, expected);
        assert.equal(log.delivered.length, before + (expected ? 1 : 0));
        const seen = () => subject.wc.executeJavaScript('window.__h19Received.slice()');
        if (expected) await until(async () => (await seen()).length === log.delivered.length, key + ' did not reach the preload');
        assert.deepEqual(await seen(), log.delivered);
        assert.deepEqual(await control.wc.executeJavaScript('window.__h19Received.slice()'), []);
        log.inputs.push({key, accepted: actual, rendererFrame: frame, seenThroughPreload: [...log.delivered]});
      }
      async function pair(label, target, gesture) {
        const count = target - frame;
        assert(Number.isInteger(count) && count >= 0);
        const filenames = ['touched', 'control'].map(id => path.join(dir, label + '-' + id + '.png'));
        const [active, idle] = await Promise.all([subject, control].map((w, i) => samplePetFrame(w.wc, count, filenames[i])));
        frame = target;
        assert.equal(active.frame, idle.frame);
        assert.equal(active.gesture || '', gesture);
        assert.equal(idle.gesture || '', '');
        assert.equal(active.activity, 'idle');
        assert(active.opaquePixels > 500 && idle.opaquePixels > 500);
        const difference = comparePetFrames(filenames[1], filenames[0]);
        log.frames[label] = {target, active, idle, difference};
        return difference;
      }
      async function captureWindows(label) {
        // Capture the composited production page (including its contact shadow).
        // Only this webContents is read. The operating-system desktop is never captured.
        const [image, reference] = await Promise.all([subject.wc.capturePage(), control.wc.capturePage()]);
        assert(!image.isEmpty() && !reference.isEmpty());
        const png = image.toPNG();
        const filename = label + '-window.png';
        const file = path.join(dir, filename);
        fs.writeFileSync(file, png);
        const refFile = path.join(dir, label + '-control-window.png'), referencePng = reference.toPNG();
        fs.writeFileSync(refFile, referencePng);
        const bitmap = image.toBitmap(), colors = new Set();
        for (let i = 0; i < bitmap.length; i += 16) {
          if (bitmap[i+3] > 200) colors.add(bitmap.readUInt32LE(i));
        }
        assert(colors.size > 50, 'Window capture must show a rendered character');
        return {file: filename, sha256: sha(png), ...image.getSize(), sampledOpaqueColors: colors.size,
          reference: path.basename(refFile), referenceSha256: sha(referencePng), difference: comparePetFrames(refFile, file)};
      }
      async function photograph(label, verify) {
        // The compositor can still expose the previous frame after WebGL
        // completed. Let it catch up without advancing the animation or input.
        for (let attempt = 1; attempt <= 6; attempt++) {
          try {
            const capture = await captureWindows(label);
            verify(capture.difference);
            log.captures[label] = {...capture, attempts: attempt, rendererFrame: frame};
            return;
          } catch (error) {
            if (error.code !== 'ERR_ASSERTION' || attempt === 6) throw error;
            await pause(75);
          }
        }
      }
      function expression(difference, kind) {
        const [neutral, touched] = difference.eyeWhites;
        assert(neutral >= 8 * (difference.height / 350) ** 2, 'Reference must have open eyes');
        assert(difference.eyeDiff >= Math.max(8, difference.eyeArea * .003), 'Eye region must differ from the unpoked control');
        if (kind === 'poke') assert(touched > neutral * .50 && difference.faceCentreShiftX < -difference.height * .008,
          'Poke must keep the eyes open and lean from the matched idle pose');
        else assert(touched < neutral * .20 && difference.faceCentreShiftX > difference.height * .025,
          'Huff must close the eyes and turn from the matched neutral pose');
      }
      const start = await pair('idle', 0, '');
      assert.equal(start.wholeDiff, 0);
      await photograph('idle', difference => assert.equal(difference.wholeDiff, 0));
      await input('first', 'poke');
      const first = await pair('poke', 4, 'poke');
      assert(first.eyeDiff >= Math.max(8, first.eyeArea * .003), 'No visible poke in the eye ROI');
      expression(first, 'poke');
      await photograph('poke', difference => expression(difference, 'poke'));
      await input('duplicate', null);
      await pair('poke-held', 10, 'poke');
      await input('stale', null);
      let peak = first.eyeDiff;
      if (triple) {
        const times = replay.proof.inputMs.map(t => Math.round(t * 30 / 1000));
        assert.deepEqual(times, [0, 20, 27]);
        await pair('before-second', times[1], 'poke');
        await input('second', 'poke');
        await pair('second-poke', times[2], 'poke');
        await input('third', 'huff');
        const frown = await pair('huff', times[2]+9, 'huff');
        assert(frown.eyeDiff >= Math.max(8, frown.eyeArea * .003), 'No visible huff in the eye ROI');
        expression(frown, 'huff');
        await photograph('huff', difference => expression(difference, 'huff'));
        peak = Math.max(peak, frown.eyeDiff);
        await pair('huff-held', times[2]+18, 'huff');
      }
      const recovered = await pair('restored', triple ? 147 : 85, '');
      function restored(difference) {
        assert(difference.eyeDiff <= Math.max(5, peak * .03), 'Eyes did not return to the matched idle frame');
        assert(difference.wholeDiff <= Math.max(10, difference.width * difference.height * .0005),
          'The complete character must return to the matched idle pose');
      }
      restored(recovered);
      await photograph('restored', restored);
      assert.deepEqual(log.delivered, triple ? ['poke', 'poke', 'huff'] : ['poke']);
      assert.deepEqual(await control.wc.executeJavaScript('window.__h19Received.slice()'), []);
    } finally {
      await replay.close();
      for (const one of [subject, control]) { one.pet.close(); controllers.delete(one.pet); }
    }
  }
  try {
    await app.whenReady();
    session.defaultSession.webRequest.onBeforeRequest({urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*']},
      (request, done) => { report.remoteRequests.push(new URL(request.url).origin); done({cancel: true}); });
    await scenario('single', false);
    await scenario('three', true);
    assert.deepEqual(report.errors, []);
    assert.deepEqual(report.remoteRequests, []);
    report.passed = true;
  } catch (error) {
    report.failure = error.stack || String(error);
    console.error(report.failure);
  } finally {
    for (const pet of controllers) pet.close();
    fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n');
    app.exit(report.passed ? 0 : 1);
  }
}

if (process.versions.electron) {
  test().catch(error => { console.error(error); require('electron').app.exit(1); });
} else launch();
