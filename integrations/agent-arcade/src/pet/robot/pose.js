// How a pose of the on-screen character becomes a pose of a desk robot whose
// only moving part is its head. No DOM and no three.js here, so this file also
// runs under Node for the tests.
//
// A small servo is audible every time it moves and many of them buzz while
// holding against a load. So the robot's head is moved by its motors only for
// movements worth hearing (a nod, a turn, a bow), and everything subtler (the
// slow sway, the last degree of a tilt, any roll, which this neck cannot do)
// is shown by shifting and turning the picture on the screen instead.

const DEG = 180 / Math.PI;
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const CHAIN = ['spine', 'chest', 'neck', 'head'];

// Where the head points, in degrees: pan (+ toward her left), tilt (+ nodding
// forward) and roll (+ toward her right), summed down the spine as the
// on-screen rig applies them.
export function headPose(bones) {
  let tilt = 0, pan = 0, roll = 0;
  for (const name of CHAIN) { const r = bones[name]?.rotation; if (r) { tilt += r.x; pan += r.y; roll += r.z; } }
  return {pan: pan * DEG, tilt: tilt * DEG, roll: roll * DEG};
}

export const NECK = Object.freeze({
  pan: Object.freeze([-40, 40]), tilt: Object.freeze([-12, 18]),   // mechanical range, degrees
  wake: 4.5,              // from rest, the pose must be this far off before the motors start at all
  follow: 1.5,            // once moving, a new target is sent when the pose has moved this far from the last one
  settle: 1.2,            // seconds without a new target before the motors are released
  pixelsPerDegree: 1.6,   // how far the picture shifts for each degree the motors do not cover
  maxShift: 10,           // pixels
  maxRoll: 9,             // degrees, on the screen
});

// Splits each pose into what the motors do and what the screen does.
export class NeckPlan {
  constructor(options = {}) {
    this.options = {...NECK, ...options};
    this.target = {pan: 0, tilt: 0}; this.torque = false; this.still = 0; this.changed = false;
  }
  // pose: {pan, tilt, roll} in degrees. `expressive` is true while a gesture or
  // an activity is shaping the pose; idle sway alone never starts the motors.
  // `quiet` keeps the motors off entirely (the user asked for silence, or she
  // is being carried).
  update(pose, dt, {expressive = false, quiet = false, fixedTarget, startTurn = false} = {}) {
    const o = this.options, aim = fixedTarget ?? pose;
    const wanted = {pan: clamp(aim.pan, o.pan[0], o.pan[1]), tilt: clamp(aim.tilt, o.tilt[0], o.tilt[1])};
    this.changed = false;
    const target = {pan: Math.round(wanted.pan * 2) / 2, tilt: Math.round(wanted.tilt * 2) / 2};
    const gap = Math.max(Math.abs(wanted.pan - this.target.pan), Math.abs(wanted.tilt - this.target.tilt));
    const move = fixedTarget ? startTurn || target.pan !== this.target.pan || target.tilt !== this.target.tilt
      : this.torque ? gap > o.follow : expressive && gap > o.wake;
    if (quiet) {
      if (this.torque) { this.torque = false; this.changed = true; }
    } else if (move) {
      // From rest only a clear, expressive movement wakes the motors (a nod while
      // she speaks stays on the screen); once moving she follows through.
      this.target = target;
      this.torque = true; this.still = 0; this.changed = true;
    } else if (this.torque) {
      this.still += dt;
      if (this.still > o.settle && !expressive) { this.torque = false; this.changed = true; }
    }
    // Whatever the motors do not show goes to the screen.
    const shift = value => clamp(value * o.pixelsPerDegree, -o.maxShift, o.maxShift);
    return {
      motors: {pan: this.target.pan, tilt: this.target.tilt, torque: this.torque, changed: this.changed},
      screen: {dx: shift(pose.pan - this.target.pan), dy: shift(pose.tilt - this.target.tilt), roll: clamp(-pose.roll, -o.maxRoll, o.maxRoll)},
    };
  }
}

// A stand-in skeleton for running the motion code where there is no 3D model.
export function plainSkeleton(names = ['root', 'hips', ...CHAIN, 'leftUpperArm', 'leftLowerArm', 'leftHand', 'rightUpperArm', 'rightLowerArm', 'rightHand', 'leftUpperLeg', 'leftLowerLeg', 'leftFoot', 'rightUpperLeg', 'rightLowerLeg', 'rightFoot']) {
  const bones = {};
  for (const name of names) bones[name] = {
    position: {x: 0, y: 0, z: 0, clone() { return {x: this.x, y: this.y, z: this.z}; }, set(x, y, z) { this.x = x; this.y = y; this.z = z; }},
    rotation: {x: 0, y: 0, z: 0, set(x, y, z) { this.x = x; this.y = y; this.z = z; }},
    userData: {},
  };
  return bones;
}
