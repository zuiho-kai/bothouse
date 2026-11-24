// The desk robot preview page: the driver that would talk to a device is wired
// straight into the on-screen twin, so every packet the device would receive
// is the one the twin shows.
import {RobotDriver} from './driver.js';
import {RobotTwin} from './twin.js';
import {RobotScreen, SCREENS, rgb565, hexToRgb} from './screen.js';
import {encodeUpdate} from './codec.js';
import {RobotLink} from './link.js';
import {PreviewHeartbeat} from './heartbeat.js';

const query = new URLSearchParams(location.search), canvas = document.getElementById('stage');
const zh = query.get('lang') === 'zh';
const labels = zh ? {
  angle: '观察角度', front: '正面', side: '侧看', image: '橘的立绘圆屏机器人预览',
  waiting: '等待主程序连接', offline: '连接中断 · 休眠', pat: '摸了摸橘', poke: '戳了戳橘', huff: '橘有点气鼓鼓',
} : {
  angle: 'Viewing angle', front: 'Front', side: 'Side', image: 'Round-screen robot preview with Ju’s portrait',
  waiting: 'Waiting for the app', offline: 'Disconnected · asleep', pat: 'Patted Ju', poke: 'Poked Ju', huff: 'Ju looks grumpy',
};

// The face the firmware keeps for itself: eyes closed, a faint smile.
const SLEEPING_FACE = {blinkL: 1, blinkR: 1, smile: 0.15, smirk: 0};

function sleepingScreen(meta, spec, portrait) {
  const sleeping = new RobotScreen(meta, spec, portrait);
  sleeping.draw(SLEEPING_FACE, portrait ? 'Zz' : '');
  return sleeping;
}

// `tape`, when given, also collects the exact bytes a device would be sent.
function build(stage, spec, portrait, random, tape = null, nowMs) {
  const twin = new RobotTwin(stage, spec, stage.meta.skin, {sleeping: sleepingScreen(stage.meta, spec, portrait).canvas});
  const link = tape ? new RobotLink({skin: stage.meta.skin}) : null;
  if (link) tape.push(...link.hello());
  const driver = new RobotDriver({meta: stage.meta, screen: spec, portrait, language: zh ? 'zh' : 'en', random, nowMs,
    getMaxFrameBytes: () => link?.maxFrameBytes,
    send: packet => { twin.receive(packet); if (link) tape.push(...link.bytesFor(packet)); }});
  return {twin, driver};
}
const base64 = bytes => { let text = ''; for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(text); };

// Still pictures for scripts/pet-preview.cjs --page robot/twin.html. Each shot
// is "yaw" or "yaw:key=value;..." with activity, attention, gesture, event,
// quiet, asleep and at (seconds), e.g. ?preview=0:activity=thinking,25:event=pat;at=0.6
function preview(stage, spec, portrait) {
  const shots = (query.get('preview') || '0').split(',').map(text => {
    const [yaw, rest = ''] = text.split(':');
    return {yaw: Number(yaw), ...Object.fromEntries(rest.split(';').filter(Boolean).map(pair => pair.split('=')))};
  });
  const width = innerWidth, height = innerHeight, each = width / shots.length, report = [];
  stage.resize(each, height, Number(query.get('ratio')) || 2); stage.renderer.setSize(width, height, false); stage.renderer.setScissorTest(true);
  shots.forEach((shot, i) => {
    const tape = shot.tape ? [] : null, {twin, driver} = build(stage, spec, portrait, () => 0.5, tape), start = 1.0, at = Number(shot.at || 1.2), dt = 1 / 30;
    driver.motion.blink.next = 1e9;
    if (shot.quiet) driver.setQuiet(true);
    driver.present({activity: shot.activity || 'idle', attention: Boolean(shot.attention)});
    for (let t = 0; t < start + at; t += dt) {
      if (t >= start && t - dt < start) { if (shot.gesture) driver.react(shot.gesture); if (shot.event) driver.deviceEvent(shot.event); if (shot.asleep) driver.sleep(); }
      if (shot.activity === 'speaking') driver.pulse();
      driver.tick(dt); twin.update(dt);
    }
    stage.pivot.rotation.y = shot.yaw * Math.PI / 180;
    stage.renderer.setViewport(i * each, 0, each, height); stage.renderer.setScissor(i * each, 0, each, height);
    stage.render();
    if (tape) {
      // For scripts/pet-robot-smoke.cjs: the bytes sent and the picture the twin ended up with.
      const all = new Uint8Array(tape.reduce((n, chunk) => n + chunk.length, 0)); let offset = 0; for (const chunk of tape) { all.set(chunk, offset); offset += chunk.length; }
      (window.tapes ||= []).push({bytes: base64(all), picture: base64(new Uint8Array(twin.buffer.buffer)), width: twin.content.width, height: twin.content.height});
    }
    report.push({shot, cue: driver.screen.cue, touch: driver.screen.touch, frames: twin.frames, bytes: twin.bytes, largest: twin.largest, motorTravel: Math.round(twin.motorTravel), head: {pan: Math.round(twin.now.pan), tilt: Math.round(twin.now.tilt)}, asleep: twin.asleep});
  });
  console.log('TWIN ' + JSON.stringify(report));
  document.title = 'pet-ready';
}

function live(stage, spec, portrait) {
  const {twin, driver} = build(stage, spec, portrait, Math.random, null, () => performance.now()), host = window.robotHost || null;
  const motionPreference = matchMedia('(prefers-reduced-motion: reduce)');
  const applyPreference = () => {
    const reduced = motionPreference.matches;
    if (driver.reducedMotion === reduced) return;
    driver.setReducedMotion(reduced);
    if (reduced) twin.update(0, true);
  };
  motionPreference.addEventListener('change', applyPreference);
  applyPreference();
  const feedback = document.getElementById('feedback');
  if (portrait) {
    document.body.classList.add('portrait-preview');
    const controls = document.getElementById('view-controls');
    const front = document.getElementById('front-view'), side = document.getElementById('side-view');
    controls.hidden = false;
    controls.setAttribute('aria-label', labels.angle);
    front.textContent = labels.front; side.textContent = labels.side;
    canvas.setAttribute('aria-label', labels.image);
    const selectView = sideways => {
      stage.setSideView(sideways);
      front.setAttribute('aria-pressed', String(!sideways)); side.setAttribute('aria-pressed', String(sideways));
    };
    front.onclick = () => selectView(false);
    side.onclick = () => selectView(true);
  }
  const fit = () => stage.resize(canvas.clientWidth, canvas.clientHeight, Math.min(2, devicePixelRatio));
  addEventListener('resize', fit); fit();
  driver.sleep();
  let hasConnected = false;
  const heartbeat = new PreviewHeartbeat({
    request: token => host?.probe(token),
    present: state => {
      // Chromium can expose the new match before delivering its change event.
      applyPreference();
      hasConnected = true; driver.present(state);
    },
    sleep: () => driver.sleep(),
  });
  host?.onCheck(() => heartbeat.check());
  host?.onPresence(sample => heartbeat.accept(sample));
  host?.onPulse(token => { if (heartbeat.acceptsEffect(token)) driver.pulse(); });
  host?.onReaction(({token, kind}) => { if (heartbeat.acceptsEffect(token)) driver.react(kind); });
  // The pointer stands in for a hand on the real robot: a click is a poke on
  // its touch screen, a stroke across the head is a pat.
  const touch = kind => {
    const token = heartbeat.touchToken();
    if (!token) return;
    const felt = driver.deviceEvent(kind);
    if (felt) host?.touched(token, felt);
  };
  let rub = 0, rubAt = 0;
  canvas.addEventListener('click', () => touch('poke'));
  canvas.addEventListener('pointermove', event => {
    if (event.buttons || event.clientY > innerHeight * 0.55) return;
    const now = performance.now(); if (now - rubAt > 900) rub = 0;
    rub += Math.hypot(event.movementX, event.movementY); rubAt = now;
    if (rub > 260) { rub = 0; touch('pat'); }
  });
  let last = performance.now();
  setInterval(() => {
    const now = performance.now(), dt = Math.min(0.1, (now - last) / 1000); last = now;
    applyPreference();
    if (heartbeat.online()) driver.tick(dt);
    twin.update(dt, driver.reducedMotion);
    if (portrait) {
      const message = !hasConnected ? labels.waiting : twin.asleep ? labels.offline : labels[driver.motion.touchGesture] || '';
      if (message !== feedback.textContent) feedback.textContent = message;
    }
    Object.assign(document.body.dataset, {
      asleep: String(twin.asleep), gesture: driver.motion.touchGesture || driver.motion.gesture || '',
      activity: twin.asleep ? 'asleep' : driver.activity, cue: twin.asleep ? '' : driver.screen.cue,
      pan: String(Math.round(twin.now.pan)), tilt: String(Math.round(twin.now.tilt)), torque: String(twin.target.torque),
    });
  }, 33);
  const frame = () => { requestAnimationFrame(frame); stage.render(); };
  requestAnimationFrame(frame);
  document.title = 'pet-ready';
  host?.ready();
}

// The asset the firmware carries: "AAPS", version, background, content size,
// then the sleeping face as one update against an empty picture.
function sleepingAsset(meta, spec, portrait) {
  const screen = sleepingScreen(meta, spec, portrait);
  const rgba = screen.pixels(), width = screen.contentWidth, height = screen.contentHeight, picture = new Uint16Array(width * height);
  for (let i = 0, p = 0; i < picture.length; i++, p += 4) picture[i] = rgb565(rgba[p], rgba[p + 1], rgba[p + 2]);
  const update = encodeUpdate(new Uint16Array(width * height), picture, width, {x: 0, y: 0, width, height}), background = rgb565(...hexToRgb(meta.skin));
  const out = new Uint8Array(11 + update.length); out.set([65, 65, 80, 83, 1, background & 255, background >> 8, width & 255, width >> 8, height & 255, height >> 8]); out.set(update, 11);
  window.asset = base64(out); document.title = 'pet-ready';
}

async function openPage() {
  document.documentElement.lang = zh ? 'zh-CN' : 'en';
  const spec = SCREENS[query.get('screen') || 'lcd-320x240'];
  if (!spec) throw Error('Unknown screen');
  let portrait, stage;
  if (spec.portrait) {
    portrait = new Image();
    portrait.src = new URL(spec.portrait, import.meta.url).href;
    await portrait.decode();
    const {createRoundStage, ROUND_META} = await import('./round-stage.js');
    if (query.has('asset')) return sleepingAsset(ROUND_META, spec, portrait);
    stage = createRoundStage(canvas);
  } else {
    const {createStage} = await import('../stage.js');
    stage = await createStage(canvas, query.get('pet') || 'ju');
  }
  if (query.has('asset')) return sleepingAsset(stage.meta, spec, portrait);
  return query.has('preview') ? preview(stage, spec, portrait) : live(stage, spec, portrait);
}

openPage().catch(error => {
  document.title = 'pet-error'; console.error(error);
  if (window.robotHost) {
    document.getElementById('feedback').textContent = zh ? '预览加载失败，请关闭窗口后重试。' : 'Preview failed to load. Close the window and try again.';
    window.robotHost.ready();
  }
});
