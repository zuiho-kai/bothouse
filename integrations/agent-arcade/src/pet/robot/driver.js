// Drives a desk robot body from the same motion and face code as the desktop
// pet. The robot is treated as a small terminal: this driver decides what its
// screen shows and where its head points, and hands plain packets to `send`.
// How packets travel (USB, a socket, or straight into the on-screen twin) is
// not this file's business.
//
// Packets out:
//   {type: 'reset'}   greet the receiver and re-establish the picture baseline
//   {type: 'picture-begin'|'picture-commit', ...}   boundaries on a negotiated link
//   {type: 'frame', x, y, width, height, data}   the pixels of the screen
//        content that changed, as an update for that rectangle (codec.js)
//   {type: 'view', pan, tilt, torque, dx, dy, roll, ms}   where the motors
//        should be, whether they hold, and how the content is presented;
//        `ms` is how long the device takes to ease there
//   {type: 'sleep'}   the app is going away; the device shows its own
//        sleeping face until it hears from an app again
// Events in (from the device): 'pat', 'poke', 'held', 'released'.
import {Motion} from '../motion.js';
import {activityCue} from '../cue.js';
import {RobotScreen, SCREENS, rgb565} from './screen.js';
import {headPose, NeckPlan, plainSkeleton} from './pose.js';
import {changedRect, frameTiles} from './codec.js';
import {PictureDelivery} from './picture-delivery.js';

const HEARTBEAT = 1.0;      // seconds between repeated view packets when nothing changes
const THINKING_WAIT_MS = 3000;
const LOOK_AWAY = Object.freeze({pan: -9, tilt: 0}), FACE_FRONT = Object.freeze({pan: 0, tilt: 0});
const STILL_VIEW = Object.freeze({type: 'view', ...FACE_FRONT, torque: false, dx: 0, dy: 0, roll: 0, ms: 90});

export class RobotDriver {
  constructor({meta, screen = 'lcd-320x240', portrait, language, send, link, write, getMaxFrameBytes, getBufferedBytes, random = Math.random, calm = false, neck, nowMs}) {
    this.spec = typeof screen === 'string' ? SCREENS[screen] : screen;
    if (!this.spec) throw Error(`Unknown robot screen ${screen}`);
    if (!send && !(link && typeof write === 'function')) throw TypeError('A robot driver needs send or a link and byte writer');
    this.send = send ?? (packet => {
      for (const bytes of link.bytesFor(packet)) if (write(bytes) === false) return false;
      return true;
    });
    this.getMaxFrameBytes = link
      ? () => Math.min(getMaxFrameBytes?.() ?? link.maxFrameBytes, link.maxFrameBytes)
      : getMaxFrameBytes;
    this.needsHello = false; this.bones = plainSkeleton();
    this.motion = new Motion({bones: this.bones}, {random, calm, fidget: !calm});
    this.nowMs = nowMs ?? (() => this.motion.time * 1000);
    this.reducedMotion = false; this.stillThinkingRun = null; this.thinkingRun = undefined;
    this.clearChatMovement();
    this.screen = new RobotScreen(meta, this.spec, portrait, language); this.plan = new NeckPlan(neck);
    this.activity = 'idle'; this.attention = false; this.quiet = false; this.held = false;
    this.sent = null; this.lastView = null; this.sinceView = Infinity; this.asleep = false; this.asked = null;
    if (link) {
      this.pictures = new PictureDelivery(this, getBufferedBytes);
      link.bindDriver(this);
    }
  }
  // From the shared presence.
  clearChatMovement() {
    this.thinkingSince = null; this.confirmedAt = null; this.chatTarget = null;
  }
  present({activity, attention, thinkingRun, completedRun}) {
    const thinking = activity === 'thinking', newRun = thinking && this.thinkingRun !== thinkingRun;
    if (thinking && this.reducedMotion) this.stillThinkingRun = thinkingRun;
    else if (!thinking || thinkingRun !== this.stillThinkingRun) this.stillThinkingRun = null;
    const fault = activity === 'unknown' || activity === 'failed';
    if (this.chatTarget === LOOK_AWAY && (!thinking || newRun)) {
      // A probe may skip directly from A thinking to B thinking or speaking.
      // Direct subscribers see each transition; sampled bodies need A's receipt.
      const replied = this.thinkingRun === undefined ? activity === 'speaking' : completedRun === this.thinkingRun;
      this.chatTarget = replied && !fault ? FACE_FRONT : null;
      if (!this.chatTarget) this.plan.torque = false;
    } else if (fault && this.chatTarget) {
      this.chatTarget = null; this.plan.torque = false;
    }
    if (thinking) {
      const now = this.nowMs();
      if (this.thinkingSince === null || newRun) this.thinkingSince = now;
      // A sampled preview must hear from the same live turn past the threshold.
      // A directly attached presence supplies all transitions synchronously.
      this.confirmedAt = thinkingRun === undefined ? null : now;
    } else this.thinkingSince = null;
    this.thinkingRun = thinkingRun;
    this.activity = activity; this.attention = attention; this.motion.setActivity(activity); this.asleep = false;
  }
  pulse() { this.motion.pulse(); }
  react(kind) {
    if (this.asleep || this.motion.playTouch(kind)) return;
    this.motion.play(kind); this.asked = this.motion.gesture;
  }
  // The user asked for silence: the motors stay released, the screen keeps moving.
  setQuiet(value) { this.quiet = value === true; }
  // Used only by the live preview. Keep the current picture and touch clock.
  setReducedMotion(value) {
    if (this.reducedMotion === value) return;
    this.reducedMotion = value;
    // The preference can change offline. The last sampled turn still identifies
    // stale movement, even though disconnecting discarded its timer and target.
    if (value && this.activity === 'thinking') this.stillThinkingRun = this.thinkingRun;
    this.chatTarget = null; this.plan.target = FACE_FRONT; this.plan.torque = false;
    this.motion.fidget = !value && !this.motion.calm;
    this.motion.gesture = null; this.asked = null;
  }
  // From the device. Returns the touch to report to the presence, if any.
  deviceEvent(kind) {
    if (this.asleep) return null;
    if (kind === 'pat' || kind === 'poke') {
      const reaction = kind === 'poke' ? this.motion.nextPoke() : 'pat';
      this.motion.playTouch(reaction); return reaction;
    }
    if (kind === 'held') { this.held = true; this.motion.setHeld(true); return 'held'; }
    if (kind === 'released') { this.held = false; this.motion.setHeld(false); this.asked = this.motion.gesture; return 'released'; }
    return null;
  }
  // On reconnect or NEED_FULL, greet again before sending the latest picture.
  reset() {
    if (this.chatTarget) this.plan.torque = false;
    this.clearChatMovement();
    this.motion.clearTouches();
    this.pictures?.reset();
    this.needsHello = !this.pictures; this.sent = null; this.lastView = null; this.sinceView = Infinity; this.asleep = false;
  }
  // Link notifications only change state. The next driver tick owns all writes.
  picturePending() { if (!this.asleep) this.pictures.greetingSent(); }
  pictureSession(session, cachePixels) { if (!this.asleep) this.pictures.greeted(session, cachePixels); }
  pictureAck(session, id, checksum) { if (!this.asleep) this.pictures.accept(session, id, checksum); }
  get deliveryState() { return this.pictures?.state ?? 'legacy'; }
  sleep() {
    this.clearChatMovement();
    this.asleep = true; this.asked = null; this.held = false;
    this.motion.setHeld(false); this.motion.gesture = null; this.motion.speech = 0; this.motion.clearTouches();
    this.plan.torque = false; this.lastView = null;
    this.pictures?.reset();
    this.send({type: 'sleep'});
  }

  planView(dt) {
    const pose = headPose(this.bones);
    // Keep the live screen pose during short waits. Only a sustained wait
    // earns one turn, and only that turn's reply earns a return.
    if (!this.motion.gesture) this.asked = null;
    const expressive = this.motion.gesture !== null && this.motion.gesture === this.asked;
    // A missing or failed reply stays on the display. Release an already moving neck, too.
    const still = this.activity === 'failed' || this.activity === 'unknown';
    const quiet = this.quiet || this.held || still;
    const startTurn = !quiet && !expressive && this.chatTarget !== LOOK_AWAY && this.thinkingSince !== null &&
      Math.floor((this.confirmedAt ?? this.nowMs()) - this.thinkingSince) > THINKING_WAIT_MS;
    // A previous interruption can release the neck midway to the same target.
    if (startTurn) this.chatTarget = LOOK_AWAY;
    const inChat = this.activity === 'thinking' || this.activity === 'speaking';
    const fixedTarget = expressive ? undefined : this.chatTarget ?? (inChat ? this.plan.target : undefined);
    const {motors, screen} = this.plan.update(pose, dt, {expressive, quiet, fixedTarget, startTurn});
    if (fixedTarget === FACE_FRONT && !motors.torque) this.chatTarget = null;
    return {type: 'view', pan: motors.pan, tilt: motors.tilt, torque: motors.torque, dx: Math.round(screen.dx), dy: Math.round(screen.dy), roll: Math.round(screen.roll * 2) / 2, ms: motors.changed ? 260 : 90};
  }

  tick(dt) {
    if (this.asleep) return;
    const face = this.motion.update(dt), still = this.reducedMotion || this.stillThinkingRun !== null;
    const view = still ? STILL_VIEW : this.planView(dt);
    const cue = activityCue(this.activity, this.attention);
    const changed = this.screen.draw(still && !this.motion.touchGesture ? {} : face, cue, this.motion.touchGesture);
    if (this.pictures) this.pictures.update(dt, changed);
    else if (changed || !this.sent) this.sendLegacyFrame();
    if (!this.sent && !this.pictures?.session) return; // no legacy handoff or negotiated session yet
    this.sinceView += dt;
    const last = this.lastView;
    if (!last || this.sinceView >= HEARTBEAT || ['pan', 'tilt', 'torque', 'dx', 'dy', 'roll'].some(key => last[key] !== view[key])) {
      if (this.pictures) {
        // A disconnected writer may refuse the heartbeat too. Keep ticking so
        // the outstanding picture can retry when the transport comes back.
        this.lastView = view; this.sinceView = 0;
        try { this.send(view); } catch { /* next heartbeat or pose change */ }
      } else {
        this.send(view); this.lastView = view; this.sinceView = 0;
      }
    }
  }
  sendFrame() {
    if (this.asleep) return;
    if (this.pictures) this.pictures.update(0, true);
    else this.sendLegacyFrame();
  }
  capturePixels() {
    const {contentWidth: width, contentHeight: height} = this.screen;
    const rgba = this.screen.pixels(), next = new Uint16Array(width * height);
    for (let i = 0, p = 0; i < next.length; i++, p += 4) next[i] = rgb565(rgba[p], rgba[p + 1], rgba[p + 2]);
    return next;
  }
  // Without picture ACKs, sent tracks the last complete synchronous handoff.
  sendLegacyFrame() {
    const {contentWidth: width, contentHeight: height} = this.screen;
    const next = this.capturePixels(), previous = this.sent || new Uint16Array(width * height);
    const rect = changedRect(previous, next, width, height);
    let receiverMayHavePixels = Boolean(this.sent || this.needsHello);
    try {
      if (this.needsHello) {
        this.needsHello = false;
        if (this.send({type: 'reset'}) === false) throw Error('Robot reset was refused');
        if (this.needsHello) return;
        receiverMayHavePixels = false;
      }
      if (rect) {
        const budget = this.getMaxFrameBytes?.();  // a new HELLO can change the capacity
        for (const tile of frameTiles(previous, next, width, rect, budget)) {
          receiverMayHavePixels = true;
          if (this.send(tile) === false) throw Error('Robot frame was refused');
          if (this.needsHello || (this.pictures && this.pictures.session !== null)) return;
        }
      }
      this.sent = next;
    } catch (error) {
      // Any prefix may already be visible, even when the writer threw. A
      // delta from either picture could skip pixels that must return to black.
      this.sent = null;
      if (this.pictures) this.reset(); else this.needsHello = receiverMayHavePixels;
      this.lastView = null;
      throw error;
    }
  }
}
