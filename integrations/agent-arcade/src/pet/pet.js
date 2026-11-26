// Entry point of the desktop pet window: wires the stage, the motion and the
// springs to the pointer and to what the host (src/pet/preload.cjs) reports.
import {createStage, CENTRE_Y} from './stage.js';
import {Motion} from './motion.js';
import {Springs} from './springs.js';
import {showActivityCue} from './cue.js';

const query = new URLSearchParams(location.search), canvas = document.getElementById('stage'), cue = document.getElementById('cue');
const host = window.petHost || null, id = query.get('pet') || 'ju';
const calm = matchMedia('(prefers-reduced-motion: reduce)');
const language = query.get('lang') === 'zh' ? 'zh' : 'en';
document.documentElement.lang = language;

// Still pictures of fixed moments, for scripts/pet-preview.cjs. Each shot is
// "yaw" or "yaw:key=value;key=value" with the keys gesture, at, stance,
// activity, hover and look (x/y), e.g.
// ?preview=0,35:gesture=wave;at=1,0:stance=held,0:activity=thinking
function preview(stage) {
  document.body.classList.add('preview');
  const shots = (query.get('preview') || '0').split(',').map(text => {
    const [yaw, rest = ''] = text.split(':');
    return {yaw: Number(yaw), ...Object.fromEntries(rest.split(';').filter(Boolean).map(pair => pair.split('=')))};
  });
  const width = innerWidth, height = innerHeight, each = width / shots.length;
  stage.resize(each, height, Number(query.get('ratio')) || 2); stage.renderer.setSize(width, height, false); stage.renderer.setScissorTest(true);
  const springs = new Springs(stage);
  shots.forEach((shot, i) => {
    const motion = new Motion(stage, {random: () => 0.5, fidget: false}), start = 0.6, at = Number(shot.at || 1.2);
    stage.pivot.rotation.set(0, 0, 0); springs.reset();
    if (shot.stance === 'held') motion.setHeld(true);
    if (shot.activity) motion.setActivity(shot.activity);
    if (shot.hover) motion.setHover(true);
    if (shot.look) { const [x, y] = shot.look.split('/').map(Number); motion.lookAt(x, y, true); }
    motion.blink.next = 1e9;
    let face = null;
    for (let t = 0; t < start + at; t += 1 / 60) {
      if (shot.gesture && t >= start && t - 1 / 60 < start) motion.play(shot.gesture);
      if (shot.activity === 'speaking') motion.pulse();
      face = motion.update(1 / 60); stage.root.updateMatrixWorld(true); springs.update(1 / 60);
    }
    stage.setFace(face);
    stage.pivot.rotation.y = shot.yaw * Math.PI / 180;
    stage.renderer.setViewport(i * each, 0, each, height); stage.renderer.setScissor(i * each, 0, each, height);
    stage.render();
  });
  document.title = 'pet-ready';
}

function live(stage) {
  const motion = new Motion(stage, {calm: calm.matches}), springs = new Springs(stage);
  calm.addEventListener('change', () => { motion.calm = calm.matches; springs.strength = calm.matches ? 0.25 : 1; });
  springs.strength = calm.matches ? 0.25 : 1;
  const {THREE} = stage, pointer = {x: -1e4, y: -1e4, inside: false, moved: false, down: null, dragging: false, rub: 0, rubAt: 0};
  const hold = new THREE.Vector3(0, 0.8, 0), probe = new THREE.Vector3();
  let interactive = false, last = performance.now(), sinceDraw = 1, attention = false, unitsPerPixel = 1 / 300;

  const fit = () => {
    stage.resize(innerWidth, innerHeight, Math.min(2, devicePixelRatio));
    // Model units per CSS pixel at the character's depth.
    const distance = stage.camera.position.distanceTo(new THREE.Vector3(0, CENTRE_Y, 0));
    unitsPerPixel = 2 * distance * Math.tan(stage.camera.fov * Math.PI / 360) / innerHeight;
  };
  addEventListener('resize', fit); fit();
  // Where her face is on the page, to turn pointer positions into directions.
  const faceOnPage = () => { probe.set(0, 0.68, 0.15); stage.root.localToWorld(probe).project(stage.camera); return [(probe.x + 1) / 2 * innerWidth, (1 - probe.y) / 2 * innerHeight]; };
  const worldAt = (x, y) => new THREE.Vector3((x - innerWidth / 2) * unitsPerPixel, CENTRE_Y + (innerHeight / 2 - y) * unitsPerPixel, 0);

  const setInteractive = value => { if (value === interactive) return; interactive = value; document.body.classList.toggle('grab', value && !pointer.dragging); host?.setInteractive(value); };
  const updateCue = () => showActivityCue(cue, motion.activity, attention, language);

  // The host reports the pointer about 30 times a second, also outside the
  // window, because a click-through window receives no pointer events.
  host?.onPointer(({x, y}) => { pointer.moved ||= Math.hypot(x - pointer.x, y - pointer.y) > 1.5; pointer.x = x; pointer.y = y; });
  host?.onMoved(({dx, dy, dt}) => {
    springs.shift(-dx * unitsPerPixel, dy * unitsPerPixel);
    motion.carry(dx * unitsPerPixel / Math.max(dt, 1 / 120));
  });
  host?.onActivity(({state, attention: waiting, pulse}) => {
    if (pulse) motion.pulse();
    if (state === undefined) return;
    if (waiting && !attention) motion.play('wave');
    if (!waiting && attention && motion.gesture === 'wave') motion.gesture = null;
    attention = waiting === true;
    motion.setActivity(state); updateCue();
  });
  host?.onGesture(name => motion.play(name));

  canvas.addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    pointer.down = {x: event.clientX, y: event.clientY, at: performance.now()};
    canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener('pointermove', event => {
    pointer.x = event.clientX; pointer.y = event.clientY; pointer.moved = true;
    if (pointer.down && !pointer.dragging && Math.hypot(event.clientX - pointer.down.x, event.clientY - pointer.down.y) > 4) {
      pointer.dragging = true; document.body.classList.add('held'); document.body.classList.remove('grab');
      hold.copy(worldAt(pointer.down.x, pointer.down.y)); hold.y = Math.max(0.5, hold.y);
      motion.setHeld(true); host?.dragStart(); host?.touched('held');
    }
    // Stroking her head without pressing counts as a pat.
    if (!pointer.down && worldAt(event.clientX, event.clientY).y > 0.6) {
      const now = performance.now();
      if (now - pointer.rubAt > 900) pointer.rub = 0;
      pointer.rub += Math.hypot(event.movementX, event.movementY); pointer.rubAt = now;
      if (pointer.rub > 260) { pointer.rub = 0; motion.play('pat'); host?.touched('pat'); }
    }
  });
  const release = event => {
    if (!pointer.down) return;
    const wasDrag = pointer.dragging, quick = performance.now() - pointer.down.at < 500;
    pointer.down = null; pointer.dragging = false; document.body.classList.remove('held');
    if (wasDrag) { motion.setHeld(false); host?.dragEnd(); host?.touched('released'); }
    else if (quick && event.type === 'pointerup') { if (attention) host?.open(); else { motion.poke(); host?.touched(motion.gesture); } }
  };
  canvas.addEventListener('pointerup', release); canvas.addEventListener('pointercancel', release);
  canvas.addEventListener('dblclick', () => host?.open());
  canvas.addEventListener('contextmenu', event => { event.preventDefault(); host?.menu(); });

  const frame = now => {
    requestAnimationFrame(frame);
    const dt = Math.min(0.1, (now - last) / 1000); last = now; sinceDraw += dt;
    // About 30 frames a second is enough unless she is being carried.
    if (sinceDraw < (pointer.dragging ? 1 / 61 : 1 / 31)) return;
    const step = sinceDraw; sinceDraw = 0;
    const [fx, fy] = faceOnPage();
    motion.lookAt((pointer.x - fx) * unitsPerPixel, (fy - pointer.y) * unitsPerPixel, pointer.moved); pointer.moved = false;
    motion.setHover(pointer.inside && !pointer.dragging);
    stage.setFace(motion.update(step));
    // What she is doing, as page state: read by the smoke tests and by anyone inspecting the window.
    document.body.dataset.gesture = motion.gesture || ''; document.body.dataset.activity = motion.activity;
    // Carried: the figure swings about the point under the hand.
    const tilt = motion.tilt;
    stage.pivot.rotation.z = tilt;
    stage.pivot.position.set(hold.x - (hold.x * Math.cos(tilt) - hold.y * Math.sin(tilt)), hold.y - (hold.x * Math.sin(tilt) + hold.y * Math.cos(tilt)), 0);
    stage.root.updateMatrixWorld(true);
    springs.update(step);
    stage.render();
    // Only her own pixels take the pointer; everything else falls through to
    // whatever is underneath the window.
    const within = pointer.x >= 0 && pointer.y >= 0 && pointer.x < innerWidth && pointer.y < innerHeight;
    const ratio = stage.renderer.getPixelRatio();
    pointer.inside = within && stage.alphaAt(pointer.x * ratio, pointer.y * ratio) > 40;
    setInteractive(pointer.inside || pointer.dragging || Boolean(pointer.down));
  };
  requestAnimationFrame(frame);
  if (!calm.matches) setTimeout(() => motion.play('greet'), 500);
  document.title = 'pet-ready';
  host?.ready();
}

createStage(canvas, id).then(stage => (query.has('preview') ? preview(stage) : live(stage))).catch(error => {
  document.title = 'pet-error'; console.error(error); host?.failed(String(error?.message || error));
});
