// Turns the driver's packets into the bytes a device reads, and the bytes a
// device writes back into what the app needs to know. It owns the small amount
// of session state the protocol has: packet numbers, update numbers, and the
// rule that a device which lost the picture is greeted again and sent all of
// it. No DOM, no serial port: whoever owns the transport calls `bytesFor` and
// `receive`.
import {TYPE, VERSION, MAX_FRAME_BYTES, framed, frame, view, StreamReader, parseDeviceHello, isRoundDisplayHello, parseEvent, parseRoundTouch, parseStatus, picturePayload, pictureCapture, pictureShow, parsePictureAck} from './wire.js';
import {rgb565, hexToRgb} from './screen.js';

export class RobotLink {
  // onHello(device), onEvent(kind), onStatus(status), onResync() are optional.
  constructor({skin = '#ffe4d2', onHello = () => {}, onEvent = () => {}, onStatus = () => {}, onResync = () => {}, checkHello, onIncompatible = () => {}, onSessionLost = () => {}, now = () => performance.now()} = {}) {
    this.background = rgb565(...hexToRgb(skin)); this.reader = new StreamReader();
    this.seq = 0; this.frameId = 0; this.device = null; this.status = null;
    this.driver = null; this.nonce = 0; this.awaitingHello = false; this.greetingSeq = 0;
    this.frameByteLimit = MAX_FRAME_BYTES;
    Object.assign(this, {onHello, onEvent, onStatus, onResync, checkHello, onIncompatible, onSessionLost, now});
  }
  // A live duplex driver can wait for replies. One-way recordings keep v1's
  // original greeting and never claim that the receiver applied a picture.
  bindDriver(driver) {
    this.driver = driver;
    this.device = null;
    this.awaitingHello = false;
  }
  hello() {
    const payload = new Uint8Array(this.driver ? 7 : 3);
    payload.set([VERSION, this.background & 255, this.background >> 8]);
    if (this.driver) {
      this.device = null;
      this.awaitingHello = true;
      this.greetingSeq = this.seq;
      const previous = this.nonce;
      do { this.nonce = crypto.getRandomValues(new Uint32Array(1))[0]; } while (!this.nonce || this.nonce === previous);
      new DataView(payload.buffer).setUint32(3, this.nonce, true);
      this.driver.picturePending();
    }
    return [framed(TYPE.HELLO, this.seq++, payload)];
  }
  ping() { return [framed(TYPE.PING, this.seq++, Uint8Array.of(this.seq & 255))]; }
  get maxFrameBytes() { return this.frameByteLimit; }
  receiveEvent(payload) {
    if (!this.checkHello) {
      const kind = parseEvent(payload); if (kind) this.onEvent(kind);
      return;
    }
    if (!this.device?.abilities.includes('touch')) return;
    const touch = parseRoundTouch(payload);
    if (!touch || touch.session !== this.device.pictureSession || touch.id <= this.lastTouchId) return;
    // Consume even contacts dropped during startup or a burst, so a replay
    // cannot turn them into a later gesture. Nothing waits in an input queue.
    this.lastTouchId = touch.id;
    const p = this.driver?.pictures, now = this.now();
    if (p?.session !== touch.session || !p.confirmedId || now - this.lastTouchAt < 100) return;
    this.lastTouchAt = now;
    this.onEvent('poke');
  }
  // Encoding never acknowledges display or receipt. A v1 device requests resync through status.
  bytesFor(packet) {
    // End a torn COBS packet before the recovery greeting starts a new picture.
    if (packet.type === 'reset') return [Uint8Array.of(0), ...this.hello()];
    if (packet.type === 'view') return [framed(TYPE.VIEW, this.seq++, view(packet))];
    if (packet.type === 'sleep') {
      if (this.driver) { this.device = null; this.awaitingHello = false; }
      return [framed(TYPE.SLEEP, this.seq++)];
    }
    if (packet.type === 'picture-begin' || packet.type === 'picture-commit' ||
        packet.type === 'picture-capture' || packet.type === 'picture-show') {
      if (!this.driver || !this.device?.pictureSession || this.device.pictureSession !== packet.session) throw Error('Picture session is not confirmed');
      if (packet.type === 'picture-capture' || packet.type === 'picture-show') {
        if (!this.device.pictureCachePixels) throw Error('Picture cache was not negotiated');
        if (packet.type === 'picture-show') {
          const payload = pictureShow(packet.session, packet.id, packet.captureId, packet.checksum);
          return [framed(TYPE.PICTURE_SHOW, this.seq++, payload)];
        }
        const {width, height, margin} = this.device.screen, r = packet.rect;
        if (r.x + r.width > width + 2 * margin || r.y + r.height > height + 2 * margin) throw RangeError('Cache rectangle is outside the screen');
        const payload = pictureCapture(packet.session, packet.id, packet.checksum, r);
        return [framed(TYPE.PICTURE_CAPTURE, this.seq++, payload)];
      }
      const begin = packet.type === 'picture-begin';
      const payload = picturePayload(packet.session, packet.id, begin ? packet.base : packet.checksum);
      const message = framed(begin ? TYPE.PICTURE_BEGIN : TYPE.PICTURE_COMMIT, this.seq++, payload);
      // A retry can follow a partial COBS packet left by a failed write.
      return begin ? [Uint8Array.of(0), message] : [message];
    }
    if (packet.type === 'frame') {
      if (this.driver && !this.device) throw Error('Waiting for device HELLO');
      if (this.maxFrameBytes < 3) throw RangeError('Device capacity cannot hold one RGB565 pixel update');
      if (packet.data.length > this.maxFrameBytes) throw RangeError('Screen update is too large for the frame capacity');
      return frame(this.frameId = (this.frameId + 1) & 0xFFFF, packet).map(([type, payload]) => framed(type, this.seq++, payload));
    }
    return [];
  }
  // Bytes from the device. Returns true when the device must be greeted again
  // and sent the whole picture (it restarted, slept, or refused an update).
  receive(chunk) {
    let resync = false;
    for (const packet of this.reader.push(chunk)) {
      if (packet.type === TYPE.D_HELLO) {
        const device = parseDeviceHello(packet.payload);
        if (this.driver) {
          if (!this.awaitingHello || (device?.pictureSession !== undefined && device.pictureSession !== this.nonce)) continue;
          if (this.checkHello && !this.checkHello(packet.payload, this.nonce)) {
            this.awaitingHello = false;
            this.onIncompatible();
            continue;
          }
          if (!device) continue;
          this.awaitingHello = false;
        }
        // Only the matching round-board profile can negotiate its cache.
        if (device?.pictureCachePixels && !isRoundDisplayHello(packet.payload, this.nonce)) delete device.pictureCachePixels;
        this.device = device;
        // A malformed advertisement must not silently gain the legacy budget.
        this.frameByteLimit = device ? Math.min(device.maxFrameBytes ?? MAX_FRAME_BYTES, MAX_FRAME_BYTES) : 0;
        if (device) {
          this.lastTouchId = 0; this.lastTouchAt = -Infinity;
          this.driver?.pictureSession(device.pictureSession ?? null, device.pictureCachePixels);
          this.onHello(device);
        }
      }
      else if (packet.type === TYPE.D_EVENT) this.receiveEvent(packet.payload);
      else if (packet.type === TYPE.D_PICTURE_ACK) {
        const ack = parsePictureAck(packet.payload);
        if (this.driver && ack && ack.session === this.device?.pictureSession) this.driver.pictureAck(ack.session, ack.id, ack.checksum);
      }
      else if (packet.type === TYPE.D_STATUS) {
        const status = parseStatus(packet.payload);
        if (!status) continue;
        this.status = status;
        // v1 status only echoes the last received host envelope. Before the
        // sequence wraps, ignore an echo from before this session's HELLO.
        const echoInSession = ((status.seq - this.greetingSeq) & 255) < this.seq - this.greetingSeq;
        if ((status.needFull || status.asleep) && (!this.driver || (this.device && echoInSession))) {
          resync = true;
          // Further statuses or late ACKs for the lost picture cannot reset it twice.
          if (this.driver) {
            this.onSessionLost(Boolean(this.driver.pictures?.confirmedId));
            this.device = null;
            this.awaitingHello = false;
            this.driver.reset();
          }
        }
        this.onStatus(status);
      }
    }
    if (resync && !this.driver) this.onResync();
    return resync;
  }
}
