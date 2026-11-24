// What the pet does: a base stance, one gesture at a time on top of it, and
// small continuous layers (breathing, looking, blinking). Poses are rotations
// in degrees about the model axes: +X nods forward, +Y turns to her left,
// +Z rolls toward her right. Everything here is driven by inputs the page
// passes in; nothing reads the app's state by itself.
import {NEUTRAL} from './face.js';
import {registerPoke, touchSeconds} from './touch.js';

const RAD = Math.PI / 180;
const clamp = (x, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, x));
const ease = x => { const t = clamp(x); return t * t * (3 - 2 * t); };
// 0 -> 1 over [a, b], holds, then 1 -> 0 over [c, d].
const window_ = (t, a, b, c, d) => ease((t - a) / (b - a)) * (1 - ease((t - c) / (d - c)));
// Writes the mirrored pose for the other side: same X, opposite Y and Z.
function both(pose) {
  const out = {...pose};
  for (const [name, r] of Object.entries(pose)) if (name.startsWith('left')) out['right' + name.slice(4)] ??= [r[0], -r[1], -r[2]];
  return out;
}

// Ju stands with her hands folded in front of her: composed, unhurried.
const STANCES = {
  stand: {
    pose: both({leftUpperArm: [-26, 0, -8], leftLowerArm: [-34, 0, -56], leftHand: [0, 0, -10], head: [1, 0, 0]}),
    face: {blinkL: 0.1, blinkR: 0.1},
  },
  // Picked up by the user: arms out, legs hanging.
  held: {
    pose: both({leftUpperArm: [-8, 0, 52], leftLowerArm: [-12, 0, 18], leftUpperLeg: [-10, 0, 7], leftLowerLeg: [16, 0, 0], leftFoot: [26, 0, 0], head: [-6, 0, 0], spine: [-3, 0, 0]}),
    face: {wide: 0.55, mouthRound: 0.5, smile: 0, smirk: 0, browL: 0.7, browR: 0.7},
  },
};

// Each gesture returns {pose, face, root?} for its local time.
const GESTURES = {
  // A small curtsy when she first appears.
  greet: {duration: 2.6, play(t) {
    const dip = window_(t, 0.25, 0.8, 1.5, 2.1), lift = window_(t, 0.1, 0.6, 1.6, 2.2);
    return {
      pose: {...both({leftUpperArm: [-10, 0, 30 * lift - 9 * (1 - lift)], leftLowerArm: [-20 * (1 - lift), 0, -64 * (1 - lift) - 8 * lift], leftUpperLeg: [-24 * dip, 0, 3 * dip], leftLowerLeg: [46 * dip, 0, 0], leftFoot: [-22 * dip, 0, 0]}),
        skirt1: [0, 0, 16 * lift], skirt2: [0, 0, 16 * lift], skirt4: [0, 0, -16 * lift], skirt5: [0, 0, -16 * lift], head: [13 * dip, 0, -5 * dip], chest: [5 * dip, 0, 0]},
      face: {happy: window_(t, 0.5, 0.9, 1.4, 1.9), blinkL: window_(t, 0.5, 0.9, 1.4, 1.9), blinkR: window_(t, 0.5, 0.9, 1.4, 1.9), smile: 0.8},
      root: [0, -0.02 * dip, 0],
    };
  }},
  // Raises her left hand and waves: something wants the user's attention.
  wave: {duration: 2.4, play(t) {
    const up = window_(t, 0, 0.4, 1.9, 2.4), swing = Math.sin(t * 13) * 15 * up;
    return {
      pose: {leftUpperArm: [-26 - 14 * up, 0, -8 + 128 * up], leftLowerArm: [-34 + 20 * up, 0, -56 + 84 * up + swing], leftHand: [0, 0, swing * 0.5], head: [0, 0, -7 * up], chest: [0, 0, -3 * up]},
      face: {smile: 0.9, mouthOpen: 0.5 * window_(t, 0.2, 0.5, 1.2, 1.6), browL: 0.5, browR: 0.5},
    };
  }},
  // Runs her fingers down the long lock by her left shoulder; her idle habit.
  tuck: {duration: 3.2, play(t) {
    const up = window_(t, 0, 0.7, 2.3, 3.1), stroke = Math.sin(clamp((t - 0.8) / 1.3) * Math.PI) * up;
    return {
      pose: {leftUpperArm: [-26 - 22 * up, 0, -8 + 92 * up - 14 * stroke], leftLowerArm: [-34 + 20 * up, 0, -56 + 84 * up], leftHand: [0, 0, 16 * up], head: [4 * up, -8 * up, 7 * up], hairSideL1: [0, 0, -7 * stroke], hairSideL2: [0, 0, -8 * stroke]},
      face: {gazeX: 0.55 * up, gazeY: -0.4 * up, blinkL: 0.3 * up, blinkR: 0.3 * up, smile: 0.5},
    };
  }},
  // A slow nod: she heard you.
  nod: {duration: 1.3, play(t) {
    const n = Math.sin(clamp(t / 1.2) * Math.PI * 2) * (1 - t / 1.3);
    return {pose: {head: [12 * Math.max(0, n) - 3 * Math.max(0, -n), 0, 0], neck: [4 * n, 0, 0]}, face: {blinkL: Math.max(0, n) * 0.8, blinkR: Math.max(0, n) * 0.8, smile: 0.6}};
  }},
  // Poked: looks at the pointer with one brow up.
  poke: {duration: touchSeconds.poke, play(t) {
    const k = window_(t, 0, 0.12, 0.9, 1.4), hop = Math.sin(clamp(t / 0.3) * Math.PI);
    return {pose: {head: [-4 * k, 0, 7 * k], chest: [-2 * k, 0, 0]}, face: {browL: 0.9 * k, browR: 0.2 * k, wide: 0.35 * k, smirk: 0.9, smile: 0.5}, root: [0, 0.012 * hop, 0]};
  }},
  // Poked again and again: closes her eyes and turns away, unbothered.
  huff: {duration: touchSeconds.huff, play(t) {
    const k = window_(t, 0, 0.3, 2.0, 2.6);
    return {pose: {head: [-5 * k, 26 * k, -6 * k], chest: [0, 9 * k, 0], ...both({leftUpperArm: [-34, 0, -9 - 4 * k]})}, face: {blinkL: k, blinkR: k, browL: -0.6 * k, browR: -0.6 * k, smile: -0.5 * k, smirk: 0, mouthRound: 0.25 * k, blush: 0.5 * k}};
  }},
  // Head pat: eyes close into a smile and she leans into the hand.
  pat: {duration: touchSeconds.pat, play(t) {
    const k = window_(t, 0, 0.2, 1.1, 1.6);
    return {pose: {head: [9 * k, 0, Math.sin(t * 7) * 3 * k], neck: [4 * k, 0, 0]}, face: {happy: k, blinkL: k, blinkR: k, smile: 1, smirk: 0.2, blush: 0.9 * k}, root: [0, -0.006 * k, 0]};
  }},
  // Set down after being carried: lands, then smooths her capelet.
  land: {duration: 1.5, play(t) {
    const squash = Math.sin(clamp(t / 0.35) * Math.PI), settle = window_(t, 0.35, 0.7, 1.1, 1.5);
    return {
      pose: {...both({leftUpperLeg: [-18 * squash, 0, 0], leftLowerLeg: [34 * squash, 0, 0], leftFoot: [-16 * squash, 0, 0], leftUpperArm: [-20, 0, 22 * squash - 6 * settle], leftLowerArm: [-30, 0, -40 - 30 * settle]}), head: [8 * squash, 0, 0]},
      face: {blinkL: squash, blinkR: squash, smile: 0.2 + 0.4 * settle}, root: [0, -0.016 * squash, 0],
    };
  }},
};

// Looping stances for what the companion is really doing in the app.
const ACTIVITIES = {
  // A reply is being generated: hand to her chin, eyes up and aside.
  thinking(t) {
    const sway = Math.sin(t * 0.9);
    return {pose: {rightUpperArm: [-96, 0, 36], rightLowerArm: [-24, 0, 22], rightHand: [0, 0, 0], leftUpperArm: [-30, 0, -6], leftLowerArm: [-40, 0, -78], head: [-5 + sway, -6, 7 + sway * 1.5], chest: [0, -3, 0]},
      face: {gazeX: -0.55, gazeY: 0.6, browL: 0.35, browR: 0.5, smile: 0.1, smirk: 0.2}};
  },
  // Static expressions keep the two service states distinct in reduced motion.
  failed() { return {face: {gazeY: -0.4, browL: -0.35, browR: -0.35, smile: -0.45, smirk: 0}}; },
  unknown() { return {face: {browL: 0.7, browR: 0.05, wide: 0.2, mouthRound: 0.25, smile: 0, smirk: 0}}; },
  // A reply is streaming in: hands open a little, mouth follows the text.
  speaking(t, energy) {
    const beat = Math.sin(t * 2.2);
    return {pose: both({leftUpperArm: [-30, 0, 4 + 3 * beat], leftLowerArm: [-44, 0, -26], head: [2 * Math.sin(t * 3.1) * energy, 0, 2 * beat * energy]}),
      face: {mouthOpen: energy * (0.35 + 0.45 * Math.abs(Math.sin(t * 9.5) * Math.sin(t * 3.7 + 1))), smile: 0.55, browL: 0.25, browR: 0.25}};
  },
};

export class Motion {
  constructor(stage, {random = Math.random, calm = false, fidget = true} = {}) {
    this.stage = stage; this.random = random; this.calm = calm; this.fidget = fidget;
    this.time = 0; this.pose = {}; this.face = {...NEUTRAL}; this.rootOffset = [0, 0, 0];
    this.stance = 'stand'; this.gesture = null; this.gestureTime = 0; this.activity = 'idle'; this.speech = 0;
    this.touchGesture = null; this.touchStarted = 0;
    this.look = {yaw: 0, pitch: 0, eyeX: 0, eyeY: 0, targetYaw: 0, targetPitch: 0, interest: 0, idle: 0};
    this.blink = {next: 2.5, t: -1, again: false};
    this.nextFidget = 9 + random() * 8; this.pokes = []; this.hover = 0; this.swing = {angle: 0, velocity: 0};
    this.rest = {};
    for (const [name, bone] of Object.entries(stage.bones)) this.rest[name] = bone.position.clone();
  }
  play(name) { if (GESTURES[name] && this.stance !== 'held') { this.gesture = name; this.gestureTime = 0; this.nextFidget = this.time + 10 + this.random() * 10; } }
  // A robot touch uses the existing expression and duration on its screen.
  // Leave the independent pose, gesture clock and fidget schedule alone.
  playTouch(name) {
    if (name !== 'pat' && name !== 'poke' && name !== 'huff') return false;
    this.touchGesture = name; this.touchStarted = this.time;
    return true;
  }
  clearTouches() { this.touchGesture = null; this.pokes.length = 0; }
  setActivity(name) { this.activity = Object.hasOwn(ACTIVITIES, name) ? name : 'idle'; }
  // A streamed piece of the reply arrived; keeps the mouth moving for a moment.
  pulse() { this.speech = 1; }
  setHeld(held) {
    if (held === (this.stance === 'held')) return;
    this.stance = held ? 'held' : 'stand'; this.gesture = held ? null : 'land'; this.gestureTime = 0;
  }
  // Pointer feedback: three pokes within a few seconds and she turns away.
  nextPoke() { return registerPoke(this.pokes, this.time); }
  poke() { this.play(this.nextPoke()); }
  // dx, dy: where the pointer is from her face, in units of her height, +y up.
  lookAt(dx, dy, moved) {
    const look = this.look;
    look.targetYaw = clamp(Math.atan2(dx, 1.4) / RAD, -42, 42); look.targetPitch = clamp(Math.atan2(dy, 1.4) / RAD, -24, 30);
    if (moved) { look.idle = 0; look.interest = Math.max(look.interest, Math.hypot(dx, dy) < 3.2 ? 1 : 0.35); }
  }
  setHover(hovering) { this.hovering = hovering; }
  // Horizontal acceleration of the window while carried, for the body's swing.
  carry(velocity) { this.swing.velocity -= velocity * 0.9; }

  update(dt) {
    this.time += dt; const t = this.time, target = {}, face = {...NEUTRAL};
    const layer = part => { if (!part) return; for (const [name, r] of Object.entries(part.pose || {})) target[name] = r; Object.assign(face, part.face || {}); if (part.root) root = part.root; };
    let root = [0, 0, 0];
    layer(STANCES[this.stance]);
    this.speech = Math.max(0, this.speech - dt * 1.6);
    if (this.stance !== 'held') {
      if (this.activity === 'speaking' && this.speech > 0.02) layer(ACTIVITIES.speaking(t, ease(this.speech)));
      else if (this.activity !== 'idle' && this.activity !== 'speaking') layer(ACTIVITIES[this.activity](t));
      if (this.gesture) {
        const gesture = GESTURES[this.gesture];
        this.gestureTime += dt;
        if (this.gestureTime >= gesture.duration) this.gesture = null; else layer(gesture.play(this.gestureTime));
      } else if (this.fidget && !this.calm && this.activity === 'idle' && t > this.nextFidget && !this.hovering) {
        this.play(this.random() < 0.7 ? 'tuck' : 'nod');
      }
    }
    if (this.touchGesture) {
      const touch = GESTURES[this.touchGesture], age = t - this.touchStarted;
      if (age >= touch.duration) this.touchGesture = null;
      else Object.assign(face, touch.play(age).face);
    }
    // Hovering: she gives the pointer her attention, leaning in a little.
    this.hover += ((this.hovering && this.stance !== 'held' ? 1 : 0) - this.hover) * (1 - Math.exp(-dt * 6));

    // Ease the pose toward its target; gestures move faster than stance changes.
    const rate = 1 - Math.exp(-dt * (this.gesture ? 14 : 8));
    for (const name of new Set([...Object.keys(target), ...Object.keys(this.pose)])) {
      const to = target[name] || [0, 0, 0], now = this.pose[name] ||= [0, 0, 0];
      for (let i = 0; i < 3; i++) now[i] += (to[i] - now[i]) * rate;
    }
    for (let i = 0; i < 3; i++) this.rootOffset[i] += (root[i] - this.rootOffset[i]) * rate;

    // Looking: the eyes go first, the head follows, and interest fades when
    // the pointer has been still for a while so she looks back at the user.
    const look = this.look;
    look.idle += dt;
    if (look.idle > 5) look.interest = Math.max(0, look.interest - dt * 0.5);
    const want = this.stance === 'held' ? 0 : look.interest;
    const yaw = look.targetYaw * want, pitch = look.targetPitch * want;
    look.yaw += (yaw * 0.62 - look.yaw) * (1 - Math.exp(-dt * 3.2)); look.pitch += (pitch * 0.62 - look.pitch) * (1 - Math.exp(-dt * 3.2));
    look.eyeX += (clamp((yaw - look.yaw) / 24, -1, 1) - look.eyeX) * (1 - Math.exp(-dt * 12));
    look.eyeY += (clamp((pitch - look.pitch) / 20, -1, 1) - look.eyeY) * (1 - Math.exp(-dt * 12));

    // Continuous layers.
    const breath = this.calm ? 0 : Math.sin(t * 1.75), sway = this.calm ? 0 : Math.sin(t * 0.62);
    const added = {
      spine: [0.9 * breath, look.yaw * 0.12, sway * 0.7],
      chest: [0.7 * breath + 4 * this.hover, look.yaw * 0.18, sway * 0.5],
      neck: [-look.pitch * 0.25, look.yaw * 0.25, 0],
      head: [-look.pitch * 0.75 - 0.6 * breath, look.yaw * 0.75, -look.yaw * 0.12 - sway * 0.8 - 5 * this.hover],
      hips: [0, 0, -sway * 0.8],
      leftUpperArm: [0, 0, 0.8 * breath], rightUpperArm: [0, 0, -0.8 * breath],
    };
    if (this.stance === 'held') {
      // A pendulum about the hand, driven by how the window is being moved.
      const swing = this.swing;
      swing.velocity += (-swing.angle * 38 - swing.velocity * 3.2) * dt; swing.angle = clamp(swing.angle + swing.velocity * dt, -0.9, 0.9);
      const kick = swing.angle / RAD;
      added.leftUpperLeg = [Math.sin(t * 5.1) * 5, 0, kick * 0.35]; added.rightUpperLeg = [Math.sin(t * 5.1 + 2) * 5, 0, kick * 0.35];
      added.leftLowerLeg = [Math.abs(kick) * 0.3, 0, 0]; added.rightLowerLeg = [Math.abs(kick) * 0.3, 0, 0];
    } else { this.swing.angle *= Math.exp(-dt * 8); this.swing.velocity *= Math.exp(-dt * 8); }

    const bones = this.stage.bones;
    for (const [name, bone] of Object.entries(bones)) {
      if (bone.userData.spring && !this.pose[name]) continue;        // left to springs.js
      const r = this.pose[name] || [0, 0, 0], extra = added[name] || [0, 0, 0];
      bone.rotation.set((r[0] + extra[0]) * RAD, (r[1] + extra[1]) * RAD, (r[2] + extra[2]) * RAD);
    }
    bones.root.position.set(this.rest.root.x + this.rootOffset[0], this.rest.root.y + this.rootOffset[1], this.rest.root.z + this.rootOffset[2]);

    // Blinking.
    const blink = this.blink; let lid = 0;
    if (blink.t < 0 && t > blink.next) blink.t = 0;
    if (blink.t >= 0) {
      blink.t += dt; lid = Math.sin(clamp(blink.t / 0.16) * Math.PI);
      if (blink.t > 0.16) { blink.t = -1; blink.next = blink.again ? t + 0.12 : t + 2.4 + this.random() * 3.6; blink.again = !blink.again && this.random() < 0.18; }
    }
    face.gazeX = (face.gazeX || 0) + look.eyeX; face.gazeY = (face.gazeY || 0) + look.eyeY;
    // Attention opens her resting half-lidded eyes; it must not hold them open
    // through a gesture that closes them (a pat, turning away).
    const opened = this.gesture ? 0 : 0.8 * this.hover;
    face.blinkL = Math.max(face.blinkL * (1 - opened), lid); face.blinkR = Math.max(face.blinkR * (1 - opened), lid);
    face.smile = Math.min(1, face.smile + 0.35 * this.hover);
    const faceRate = 1 - Math.exp(-dt * 16);
    for (const name of Object.keys(NEUTRAL)) this.face[name] += (face[name] - this.face[name]) * (name.startsWith('blink') ? 1 : faceRate);
    return this.face;
  }
  // Rotation of the whole figure about the point she is held by, in radians.
  get tilt() { return this.swing.angle; }
}

export const GESTURE_NAMES = Object.keys(GESTURES), ACTIVITY_NAMES = Object.keys(ACTIVITIES);
