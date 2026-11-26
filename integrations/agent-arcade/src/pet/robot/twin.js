// The robot's twin on screen: a stand-in for the physical device that takes
// the very packets the device would get and shows what it would do with them.
// It models the parts that differ from the desktop pet: a rigid shell (no
// swinging hair), a flat screen for a face, a head moved by two speed-limited
// motors, and a device that falls asleep when the app stops talking to it.
//
// It is a preview and a test oracle, not a promise about a particular servo.
import {Motion} from '../motion.js';
import {present} from './screen.js';
import {decodeUpdate} from './codec.js';

// The same motion profile as the firmware core (hardware/pet-robot/core/aap.cpp):
// slow, with gentle starts and stops, because a geared servo is heard whenever it moves.
const RAD = Math.PI / 180, MOTOR_SPEED = 30, MOTOR_ACCEL = 90;     // degrees per second, and per second squared
const SILENCE = 2.5;                              // seconds without a packet before the device sleeps
const NEUTRAL_POSE = {pan: 0, tilt: 0, dx: 0, dy: 0, roll: 0};
const expand565 = value => { const r = value >> 11, g = (value >> 5) & 63, b = value & 31; return [(r << 3) | (r >> 2), (g << 2) | (g >> 4), (b << 3) | (b >> 2)]; };

export class RobotTwin {
  // `sleeping` is the content the device keeps for itself (a canvas of the content size).
  constructor(stage, spec, skin, {sleeping, shell = {w: 0.272, cy: 0.656}} = {}) {
    this.stage = stage; this.spec = spec; this.skin = skin; this.sleeping = sleeping; this.shell = shell;
    const canvas = (width, height) => { const c = document.createElement('canvas'); c.width = width; c.height = height; return c; };
    this.content = canvas(spec.width + spec.margin * 2, spec.height + spec.margin * 2); this.contentContext = this.content.getContext('2d');
    // The device's own copy of the content, RGB565, zeros until the first update.
    this.buffer = new Uint16Array(this.content.width * this.content.height);
    this.contentContext.fillStyle = '#000';
    this.contentContext.fillRect(0, 0, this.content.width, this.content.height);
    this.visible = canvas(spec.width, spec.height); this.visibleContext = this.visible.getContext('2d');
    this.target = {...NEUTRAL_POSE, torque: false, ms: 90}; this.now = {...NEUTRAL_POSE}; this.speed = {pan: 0, tilt: 0};
    this.silence = Infinity; this.asleep = true; this.frames = 0; this.bytes = 0; this.largest = 0; this.motorTravel = 0;
    if (stage.setScreenCanvas) {
      stage.setScreenCanvas(this.visible);
      return;
    }
    this.decal = canvas(1024, 1024); this.decalContext = this.decal.getContext('2d');
    stage.faceTexture.image = this.decal; stage.faceTexture.needsUpdate = true;
    // The printed body holds one pose: hands folded, as she stands on screen.
    const settle = new Motion(stage, {fidget: false, calm: true, random: () => 0.5});
    for (let i = 0; i < 90; i++) settle.update(1 / 60);
    for (const name of ['spine', 'chest', 'neck', 'head', 'hips']) stage.bones[name].rotation.set(0, 0, 0);
    const {THREE} = stage, base = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.2, 0.03, 40), new THREE.MeshBasicMaterial({color: 0x3a3038}));
    base.position.y = -0.016; stage.root.add(base);
  }
  receive(packet) {
    if (packet.type === 'sleep') { this.asleep = true; this.target.torque = false; return; }
    this.silence = 0; this.asleep = false;
    if (packet.type === 'reset') {
      this.buffer.fill(0);
      this.contentContext.fillRect(0, 0, this.content.width, this.content.height);
      this.target.pan = this.now.pan; this.target.tilt = this.now.tilt; this.target.torque = false;
      return;
    }
    if (packet.type === 'frame') {
      const {x, y, width, height, data} = packet, image = this.contentContext.createImageData(width, height);
      decodeUpdate(this.buffer, this.content.width, this.content.height, {x, y, width, height}, data);
      for (let j = 0, i = 0; j < height; j++) for (let k = 0; k < width; k++, i++) { const [r, g, b] = expand565(this.buffer[(y + j) * this.content.width + x + k]); image.data[i * 4] = r; image.data[i * 4 + 1] = g; image.data[i * 4 + 2] = b; image.data[i * 4 + 3] = 255; }
      this.contentContext.putImageData(image, x, y);
      this.frames++; this.bytes += data.length; this.largest = Math.max(this.largest, data.length);
    } else if (packet.type === 'view') Object.assign(this.target, {pan: packet.pan, tilt: packet.tilt, torque: packet.torque, dx: packet.dx, dy: packet.dy, roll: packet.roll, ms: packet.ms});
  }
  advancePose(dt) {
    const {now, target} = this;
    // Motors move only while they hold torque; released, the head stays put.
    for (const axis of ['pan', 'tilt']) {
      if (!target.torque || this.asleep) { this.speed[axis] = 0; continue; }
      const gap = target[axis] - now[axis], wanted = Math.sign(gap) * Math.min(MOTOR_SPEED, Math.sqrt(1.2 * MOTOR_ACCEL * Math.abs(gap)));
      this.speed[axis] += Math.max(-MOTOR_ACCEL * dt, Math.min(MOTOR_ACCEL * dt, wanted - this.speed[axis]));
      const step = this.speed[axis] * dt;
      if (Math.abs(step) >= Math.abs(gap)) { this.motorTravel += Math.abs(gap); now[axis] = target[axis]; this.speed[axis] = 0; }
      else { now[axis] += step; this.motorTravel += Math.abs(step); }
    }
    const rate = 1 - Math.exp(-dt * 1000 / Math.max(30, target.ms) * 2.2), want = this.asleep ? {dx: 0, dy: 3, roll: 0} : target;
    for (const key of ['dx', 'dy', 'roll']) now[key] += (want[key] - now[key]) * rate;
  }
  update(dt, reducedMotion = false) {
    this.silence += dt;
    if (this.silence > SILENCE) { this.asleep = true; this.target.torque = false; }
    if (reducedMotion) {
      // The simulated head may be partway through a turn; switch without easing it home.
      Object.assign(this.now, NEUTRAL_POSE); Object.assign(this.target, NEUTRAL_POSE);
      this.target.torque = false; this.speed.pan = this.speed.tilt = 0;
    } else this.advancePose(dt);
    const now = this.now;
    present(this.visibleContext, this.asleep && this.sleeping ? this.sleeping : this.content, this.spec, this.skin, {dx: now.dx, dy: now.dy, roll: now.roll, dim: this.asleep ? 0.45 : 1});
    if (this.stage.setScreenCanvas) {
      this.stage.setScreenCanvas(this.visible);
      this.stage.setHeadPose(now.pan, now.tilt);
    } else {
      this.drawDecal();
      this.stage.bones.head.rotation.set(now.tilt * RAD, now.pan * RAD, 0);
    }
  }
  // Paints the screen, with its bezel, where it sits on the head.
  drawDecal() {
    const c = this.decalContext, b = this.stage.meta.face, n = this.decal.width, scale = n / (b.x1 - b.x0);
    const w = this.shell.w * scale, h = w * this.spec.height / this.spec.width, x = (0 - b.x0) * scale - w / 2, y = (b.y1 - this.shell.cy) * scale - h / 2, bezel = 0.014 * scale;
    c.clearRect(0, 0, n, n);
    c.fillStyle = '#17151a'; c.beginPath();
    if (this.spec.round) c.arc(x + w / 2, y + h / 2, w / 2 + bezel, 0, Math.PI * 2); else c.roundRect(x - bezel, y - bezel, w + bezel * 2, h + bezel * 2, bezel * 1.6);
    c.fill();
    c.drawImage(this.visible, x, y, w, h);
    this.stage.faceTexture.needsUpdate = true;
  }
}
