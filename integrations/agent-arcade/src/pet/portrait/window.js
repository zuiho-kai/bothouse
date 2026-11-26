import {loadPortraitPlates} from './plates.js';
import {showActivityCue} from '../cue.js';
import {registerPoke, touchSeconds} from '../touch.js';

const descriptions = {
  en: {idle: 'Ju at rest', thinking: 'Ju considering her reply', speaking: 'Ju reaching out to reply',
    pat: 'Ju smiling at a gentle touch', huff: 'Ju reacting to repeated pokes'},
  zh: {idle: '安静陪伴的橘', thinking: '橘在思考', speaking: '橘伸手回应', pat: '橘被轻摸后微笑', huff: '橘被连续轻戳'},
};

export async function openPortrait() {
  const canvas = document.getElementById('stage'), cue = document.getElementById('cue');
  const ctx = canvas.getContext('2d', {willReadFrequently: true});
  const host = window.petHost, body = document.body;
  const language = new URLSearchParams(location.search).get('lang') === 'zh' ? 'zh' : 'en';
  const calm = matchMedia('(prefers-reduced-motion: reduce)');
  const plates = await loadPortraitPlates();
  let activity = 'idle', attention = false, gesture = '', pose = 'idle';
  let source = null, target, since = 0, animation = 0, expiry = 0;
  let down = null, dragging = false, interactive = false;
  const pointer = {x: -1, y: -1}, pokes = [];
  let stroke = 0, lastStroke = 0;

  body.classList.add('portrait');
  document.documentElement.lang = language;

  function onCharacter(x, y) {
    if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) return false;
    return ctx.getImageData(Math.floor(x * canvas.width / innerWidth),
      Math.floor(y * canvas.height / innerHeight), 1, 1).data[3] > 40;
  }

  function updatePointer() {
    const next = Boolean(down) || onCharacter(pointer.x, pointer.y);
    body.classList.toggle('grab', next && !dragging);
    if (next === interactive) return;
    interactive = next;
    host?.setInteractive(next);
  }

  function draw(now) {
    animation = 0;
    const mix = source && !calm.matches ? Math.min(1, Math.max(0, (now - since) / 120)) : 1;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (mix < 1) {
      ctx.globalAlpha = 1 - mix;
      ctx.drawImage(source, 0, 0);
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = mix;
    }
    ctx.drawImage(target, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    if (mix < 1) animation = requestAnimationFrame(draw);
    else source = null;
    updatePointer();
  }

  function settle() {
    cancelAnimationFrame(animation);
    source = null;
    target = plates.get(pose, canvas.width, canvas.height);
    draw(performance.now());
  }

  function updatePose() {
    const next = gesture === 'huff' ? 'huff' : gesture ? 'pat'
      : activity === 'thinking' || activity === 'speaking' ? activity : 'idle';
    Object.assign(body.dataset, {gesture, activity, pose: next});
    canvas.setAttribute('aria-label', descriptions[language][next]);
    if (next === pose) return;
    pose = next;
    if (calm.matches) { settle(); return; }
    // A second event can arrive inside a fade. Start it at the pixels that
    // are actually on screen, including a partly raised hand.
    cancelAnimationFrame(animation);
    source = document.createElement('canvas');
    source.width = canvas.width;
    source.height = canvas.height;
    source.getContext('2d').drawImage(canvas, 0, 0);
    target = plates.get(pose, canvas.width, canvas.height);
    since = performance.now();
    draw(since);
  }

  function fit() {
    const ratio = Math.min(2, devicePixelRatio);
    const width = Math.max(1, Math.round(innerWidth * ratio));
    const height = Math.max(1, Math.round(innerHeight * ratio));
    if (target && canvas.width === width && canvas.height === height) return;
    canvas.width = width;
    canvas.height = height;
    settle();
  }

  function watchDisplayScale() {
    matchMedia(`(resolution: ${devicePixelRatio}dppx)`).addEventListener('change', () => {
      fit();
      watchDisplayScale();
    }, {once: true});
  }

  function preference() {
    body.dataset.reducedMotion = String(calm.matches);
    if (calm.matches) settle();
  }

  function react(kind) {
    if (dragging || !Object.hasOwn(touchSeconds, kind)) return;
    clearTimeout(expiry);
    gesture = kind;
    updatePose();
    expiry = setTimeout(() => { gesture = ''; updatePose(); }, touchSeconds[kind] * 1000);
  }

  function localTouch(kind) {
    react(kind);
    host?.touched(kind);
  }

  host?.onActivity(message => {
    // Pulses have no separate mouth cycle in this portrait. Speaking lasts
    // for the actual activity interval supplied by the main process.
    if (message.state === undefined) return;
    activity = message.state;
    attention = message.attention === true;
    showActivityCue(cue, activity, attention, language);
    updatePose();
  });
  host?.onGesture(react);
  host?.onPointer(position => { Object.assign(pointer, position); updatePointer(); });

  canvas.addEventListener('pointerdown', event => {
    if (event.button !== 0 || !event.isPrimary || !onCharacter(event.clientX, event.clientY)) return;
    down = {x: event.clientX, y: event.clientY, at: performance.now(), id: event.pointerId};
    stroke = 0;
    canvas.setPointerCapture(event.pointerId);
    updatePointer();
  });
  canvas.addEventListener('pointermove', event => {
    if (!event.isPrimary) return;
    pointer.x = event.clientX;
    pointer.y = event.clientY;
    if (down && !dragging && Math.hypot(pointer.x - down.x, pointer.y - down.y) > 4) {
      dragging = true;
      body.classList.add('held');
      host?.dragStart();
      host?.touched('held');
    }
    updatePointer();
    if (down) return;
    // Only strokes over the drawn head accumulate, at every window size.
    const art = plates.bounds(pose, innerWidth, innerHeight);
    if (pointer.y < art.y || pointer.y > art.y + art.height * .46 || !onCharacter(pointer.x, pointer.y)) {
      stroke = 0;
      return;
    }
    const now = performance.now();
    if (now - lastStroke > 900) stroke = 0;
    lastStroke = now;
    stroke += Math.hypot(event.movementX, event.movementY);
    if (stroke > 260) { stroke = 0; localTouch('pat'); }
  });
  function release(event) {
    if (!down || down.id !== event.pointerId) return;
    const quick = performance.now() - down.at < 500;
    down = null;
    if (dragging) {
      dragging = false;
      body.classList.remove('held');
      host?.dragEnd();
      host?.touched('released');
    } else if (quick && event.type === 'pointerup') {
      if (attention) host?.open();
      else localTouch(registerPoke(pokes, performance.now() / 1000));
    }
    updatePointer();
  }
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);
  canvas.addEventListener('lostpointercapture', release);
  canvas.addEventListener('dblclick', event => { if (onCharacter(event.clientX, event.clientY)) host?.open(); });
  canvas.addEventListener('contextmenu', event => { event.preventDefault(); if (onCharacter(event.clientX, event.clientY)) host?.menu(); });
  addEventListener('resize', fit);
  calm.addEventListener('change', preference);
  watchDisplayScale();
  fit();
  body.dataset.reducedMotion = String(calm.matches);
  updatePose();
  document.title = 'pet-ready';
  host?.ready();
}
