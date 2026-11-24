import {RobotDriver} from './driver.js';
import {RobotLink} from './link.js';
import {SCREENS} from './screen.js';
import {PreviewHeartbeat, SILENCE_MS} from './heartbeat.js';
import {DeviceOutput} from './device-output.js';
import {isRoundDisplayHello} from './wire.js';

const host = window.deviceHost;

async function start() {
  const spec = SCREENS['ju-portrait-480'], portrait = new Image();
  portrait.src = new URL(spec.portrait, import.meta.url).href;
  await portrait.decode();
  const meta = {skin: '#211713'};
  let generation = 0, blocked = false, boardSeen = performance.now(), interrupted = 0;
  let reading = false, probing = false, checkAgain = false, reporting = false, lastReport = '', nextReport;
  const output = new DeviceOutput(bytes => host.write(generation, bytes));
  const link = new RobotLink({skin: meta.skin, checkHello: isRoundDisplayHello,
    onHello: () => { boardSeen = performance.now(); },
    onEvent: kind => {
      const token = heartbeat.touchToken();
      if (!token || blocked || interrupted >= 3) return;
      const felt = driver.deviceEvent(kind);
      if (felt) host.touched(generation, token, felt).catch(() => {}); // the owner can close the port
    },
    onStatus: () => {
      const now = performance.now();
      // A board that reappears after silence can trigger a new challenge.
      // STATUS alone never admits a device or confirms a picture.
      if (now - boardSeen > SILENCE_MS && (interrupted >= 3 ||
          (driver.deliveryState === 'unconfirmed' && driver.pictures.session === undefined))) {
        interrupted = 0; output.clear(); driver.reset();
      }
      boardSeen = now;
    },
    onSessionLost: hadPicture => { interrupted = hadPicture ? 1 : interrupted + 1; },
    onIncompatible: () => { blocked = true; output.clear(); host.fault('incompatible'); }});
  const driver = new RobotDriver({meta, screen: spec, portrait, language: new URLSearchParams(location.search).get('lang'),
    link, write: bytes => output.write(bytes), getBufferedBytes: () => output.buffered, nowMs: () => performance.now()});
  driver.setQuiet(true); // Neither supported round board drives motors.
  function report() {
    const p = driver.pictures, state = driver.deliveryState;
    const phase = driver.asleep ? 'sleeping' : interrupted >= 3 ? 'unconfirmed' :
      state === 'negotiating' ? 'handshake' : state === 'pending' ? 'syncing' : state;
    const value = {phase, generation, session: p.session || 0, id: p.pending?.id || p.confirmedId,
      checksum: p.pending?.checksum ?? p.confirmedChecksum, attempts: interrupted >= 3 ? 3 : p.attempts};
    const key = JSON.stringify(value);
    if (key === lastReport) return;
    lastReport = key; nextReport = value;
    if (!reporting) sendReports();
  }
  async function sendReports() {
    reporting = true;
    try { while (nextReport) { const value = nextReport; nextReport = null; await host.delivery(value); } }
    catch { /* the window's port can be revoked during an IPC call */ }
    finally { reporting = false; }
  }
  const heartbeat = new PreviewHeartbeat({
    request: async token => {
      probing = true;
      try {
        const sample = await host.probe(token);
        if (sample && heartbeat.accept(sample)) {
          if (generation && generation !== sample.generation) { interrupted = 0; output.clear(); driver.reset(); driver.present(sample); }
          generation = sample.generation;
          if (sample.pulse) driver.pulse();
          if (sample.reaction) driver.react(sample.reaction);
          // Render changed marks before reporting an ACK for an earlier picture.
          if (!blocked && interrupted < 3) driver.tick(0);
          report();
        }
      } catch { /* a retired sender cannot sample the presence */ } finally {
        probing = false;
        if (checkAgain) { checkAgain = false; check(); }
      }
    },
    present: state => driver.present(state),
    sleep: () => { output.clear(); driver.sleep(); report(); },
  });
  function check() {
    if (blocked) return;
    if (probing) { checkAgain = true; return; }
    heartbeat.check();
  }
  function expireBoard(now) {
    if (link.device && driver.pictures.session !== undefined && now - boardSeen > SILENCE_MS) {
      output.clear(); driver.reset();
    }
  }
  async function read() {
    reading = true;
    try {
      const bytes = await host.read();
      if (bytes?.length && !blocked && heartbeat.online()) {
        expireBoard(performance.now());
        if (link.receive(bytes)) output.clear();
        report();
      }
    } catch { /* the owning window has closed */ } finally { reading = false; }
  }
  host.onCheck(check);
  let previous = performance.now(), previousProbe = previous;
  setInterval(() => {
    const now = performance.now(), dt = Math.min(0.1, (now - previous) / 1000); previous = now;
    if (blocked) return;
    if (now - previousProbe >= 800) { previousProbe = now; check(); }
    if (heartbeat.online()) {
      expireBoard(now);
      if (interrupted < 3) driver.tick(dt);
      report();
      if (!reading) read();
    }
  }, 33);
  check();
}

start().catch(() => host.fault('worker'));
