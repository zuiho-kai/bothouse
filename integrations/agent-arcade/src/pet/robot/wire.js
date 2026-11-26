// The byte protocol between the app and a desk robot ("AAP", version 1).
// Pure code with no DOM or Node APIs: the page, the tests and the reference
// vectors for the firmware (hardware/pet-robot) all use this one file.
//
// A packet is  type(1) seq(1) payload(0..MAX_PAYLOAD) crc16(2, little endian)
// and travels over a byte stream COBS-encoded and terminated by a zero byte,
// so anything else on the line (boot messages, noise) is skipped and a damaged
// packet is dropped by its checksum instead of being misread. On a transport
// that already delivers whole messages the packet is sent as it is.
//
// Host to device                          Device to host
//   HELLO       version                     HELLO   JSON: firmware, board, screen, abilities, optional maxFrameBytes
//   VIEW        motors and presentation     EVENT   pat, poke, held, released, button
//   FRAME_BEGIN rectangle and byte count    STATUS  what it is doing, and whether it lost the picture
//   FRAME_DATA  a slice of the update       PONG
//   FRAME_END   apply it                    LOG     a line of text for the developer
//   SLEEP, PING, CONFIG (JSON)
//   PICTURE_BEGIN / PICTURE_COMMIT         PICTURE_ACK (when negotiated)

export const VERSION = 1, MAX_PAYLOAD = 1000, MAX_FRAME_BYTES = 262144;
export const TYPE = Object.freeze({
  HELLO: 0x01, VIEW: 0x02, FRAME_BEGIN: 0x03, FRAME_DATA: 0x04, FRAME_END: 0x05, SLEEP: 0x06, PING: 0x07, CONFIG: 0x08,
  PICTURE_BEGIN: 0x09, PICTURE_COMMIT: 0x0A, PICTURE_CAPTURE: 0x0B, PICTURE_SHOW: 0x0C,
  D_HELLO: 0x81, D_EVENT: 0x82, D_STATUS: 0x83, D_PONG: 0x84, D_LOG: 0x85,
  D_PICTURE_ACK: 0x86,
});
export const EVENTS = Object.freeze({1: 'pat', 2: 'poke', 3: 'held', 4: 'released', 5: 'button'});
export const STATUS = Object.freeze({ASLEEP: 1, TORQUE: 2, NEED_FULL: 4});
const FRAME_SLICE = MAX_PAYLOAD - 6;

// IEEE CRC-32 of the complete RGB565 content, including the motion margin.
// Feed each pixel low byte first, independent of the host's byte order.
const crc32Table = Uint32Array.from({length: 256}, (_, byte) => {
  let crc = byte;
  for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xEDB88320 : 0);
  return crc >>> 0;
});
export function pictureCRC32(pixels) {
  let crc = 0xFFFFFFFF;
  for (const pixel of pixels) {
    crc = (crc >>> 8) ^ crc32Table[(crc ^ pixel) & 255];
    crc = (crc >>> 8) ^ crc32Table[(crc ^ (pixel >>> 8)) & 255];
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

const uint32 = value => Number.isInteger(value) && value >= 0 && value <= 0xFFFFFFFF;
// The last word is the base picture ID for BEGIN and the content CRC for COMMIT/ACK.
export function picturePayload(session, id, word) {
  if (!uint32(session) || !session || !uint32(id) || !id || !uint32(word)) throw RangeError('Invalid picture transaction');
  const payload = new Uint8Array(12), v = new DataView(payload.buffer);
  v.setUint32(0, session, true); v.setUint32(4, id, true); v.setUint32(8, word, true);
  return payload;
}
// CAPTURE commits the received tiles and installs their reversible difference.
// SHOW names that capture's acknowledged picture ID inside a new transaction.
export const PICTURE_CACHE_PIXELS = 32768;
export function pictureCapture(session, id, checksum, rect) {
  const {x, y, width, height} = rect;
  if (![x, y, width, height].every(n => Number.isInteger(n) && n >= 0 && n <= 65535) ||
      !width || !height || width * height > PICTURE_CACHE_PIXELS) throw RangeError('Invalid cache rectangle');
  const out = new Uint8Array(20), v = new DataView(out.buffer);
  out.set(picturePayload(session, id, checksum));
  [x, y, width, height].forEach((n, i) => v.setUint16(12 + i * 2, n, true));
  return out;
}
export function pictureShow(session, id, captureId, checksum) {
  if (!captureId || !uint32(checksum)) throw RangeError('Invalid cached picture');
  const out = new Uint8Array(16);
  out.set(picturePayload(session, id, captureId));
  new DataView(out.buffer).setUint32(12, checksum, true);
  return out;
}
export function parsePictureAck(payload) {
  if (payload.length !== 12) return null;
  const v = new DataView(payload.buffer, payload.byteOffset, payload.length);
  const session = v.getUint32(0, true), id = v.getUint32(4, true);
  return session && id ? {session, id, checksum: v.getUint32(8, true)} : null;
}

// CRC-16/CCITT-FALSE (polynomial 0x1021, initial 0xFFFF).
export function crc16(bytes, start = 0, end = bytes.length) {
  let crc = 0xFFFF;
  for (let i = start; i < end; i++) {
    crc ^= bytes[i] << 8;
    for (let bit = 0; bit < 8; bit++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xFFFF : (crc << 1) & 0xFFFF;
  }
  return crc;
}
// Consistent Overhead Byte Stuffing: the result contains no zero byte.
export function cobsEncode(bytes) {
  const out = [0];
  let code = 0, block = 1;
  for (const byte of bytes) {
    if (byte === 0) { out[code] = block; code = out.length; out.push(0); block = 1; }
    else { out.push(byte); if (++block === 0xFF) { out[code] = block; code = out.length; out.push(0); block = 1; } }
  }
  out[code] = block;
  return Uint8Array.from(out);
}
// Returns null for data that is not valid COBS.
export function cobsDecode(bytes) {
  const out = [];
  for (let i = 0; i < bytes.length;) {
    const block = bytes[i];
    if (block === 0 || i + block > bytes.length) return null;
    for (let k = 1; k < block; k++) out.push(bytes[i + k]);
    i += block;
    if (block < 0xFF && i < bytes.length) out.push(0);
  }
  return Uint8Array.from(out);
}

export function packet(type, seq, payload = new Uint8Array(0)) {
  if (payload.length > MAX_PAYLOAD) throw RangeError('Payload is too large for one packet');
  const out = new Uint8Array(payload.length + 4);
  out[0] = type; out[1] = seq & 255; out.set(payload, 2);
  const crc = crc16(out, 0, out.length - 2);
  out[out.length - 2] = crc & 255; out[out.length - 1] = crc >> 8;
  return out;
}
// For a byte stream: the packet, COBS-encoded, with its terminating zero.
export function framed(type, seq, payload) {
  const encoded = cobsEncode(packet(type, seq, payload)), out = new Uint8Array(encoded.length + 1);
  out.set(encoded); return out;
}
// Returns {type, seq, payload} or null when the bytes are not a sound packet.
export function parsePacket(bytes) {
  if (!bytes || bytes.length < 4 || bytes.length > MAX_PAYLOAD + 4) return null;
  if (crc16(bytes, 0, bytes.length - 2) !== (bytes[bytes.length - 2] | (bytes[bytes.length - 1] << 8))) return null;
  return {type: bytes[0], seq: bytes[1], payload: bytes.subarray(2, bytes.length - 2)};
}
// Splits a byte stream into packets. Feed it whatever arrives; it keeps at most
// one unfinished packet and counts what it had to throw away.
export class StreamReader {
  constructor() { this.pending = []; this.overflow = false; this.dropped = 0; }
  push(chunk) {
    const packets = [];
    for (const byte of chunk) {
      if (byte !== 0) { if (this.pending.length > (MAX_PAYLOAD + 4) * 1.01 + 8) this.overflow = true; else this.pending.push(byte); continue; }
      if (this.pending.length || this.overflow) {
        const decoded = this.overflow ? null : cobsDecode(this.pending), parsed = decoded && parsePacket(decoded);
        if (parsed) packets.push(parsed); else this.dropped++;
      }
      this.pending = []; this.overflow = false;
    }
    return packets;
  }
}

const u16 = (view, offset, value) => view.setUint16(offset, value, true), i16 = (view, offset, value) => view.setInt16(offset, value, true);
const clamp = (value, lo, hi) => Math.min(hi, Math.max(lo, Math.round(value)));

export const hello = () => Uint8Array.of(VERSION);
// pan, tilt and roll in degrees (sent as hundredths), dx and dy in pixels.
export function view({pan, tilt, torque, dx, dy, roll, ms}) {
  const out = new Uint8Array(11), v = new DataView(out.buffer);
  i16(v, 0, clamp(pan * 100, -18000, 18000)); i16(v, 2, clamp(tilt * 100, -18000, 18000));
  v.setInt8(4, clamp(dx, -127, 127)); v.setInt8(5, clamp(dy, -127, 127)); i16(v, 6, clamp(roll * 100, -18000, 18000));
  u16(v, 8, clamp(ms, 0, 65535)); out[10] = torque ? 1 : 0;
  return out;
}
export function parseView(payload) {
  if (payload.length !== 11) return null;
  const v = new DataView(payload.buffer, payload.byteOffset, payload.length);
  return {pan: v.getInt16(0, true) / 100, tilt: v.getInt16(2, true) / 100, dx: v.getInt8(4), dy: v.getInt8(5), roll: v.getInt16(6, true) / 100, ms: v.getUint16(8, true), torque: (payload[10] & 1) === 1};
}
// The packets (as [type, payload] pairs) that carry one screen update.
export function frame(id, {x, y, width, height, data}) {
  if (data.length > MAX_FRAME_BYTES) throw RangeError('Screen update is too large');
  const begin = new Uint8Array(14), b = new DataView(begin.buffer);
  u16(b, 0, id); u16(b, 2, x); u16(b, 4, y); u16(b, 6, width); u16(b, 8, height); b.setUint32(10, data.length, true);
  const out = [[TYPE.FRAME_BEGIN, begin]];
  for (let offset = 0; offset < data.length; offset += FRAME_SLICE) {
    const slice = data.subarray(offset, Math.min(data.length, offset + FRAME_SLICE)), payload = new Uint8Array(6 + slice.length), p = new DataView(payload.buffer);
    u16(p, 0, id); p.setUint32(2, offset, true); payload.set(slice, 6);
    out.push([TYPE.FRAME_DATA, payload]);
  }
  const end = new Uint8Array(2); u16(new DataView(end.buffer), 0, id);
  out.push([TYPE.FRAME_END, end]);
  return out;
}
// Puts a screen update back together on the receiving side. `accept` returns
// {x, y, width, height, data} when an update is complete, null while it is not,
// and throws when the pieces do not fit, after which the picture must be sent
// again in full.
export class FrameAssembler {
  constructor() { this.current = null; }
  accept(type, payload) {
    const v = new DataView(payload.buffer, payload.byteOffset, payload.length);
    if ((type === TYPE.HELLO && payload[0] === VERSION) || type === TYPE.SLEEP) {
      this.current = null;
      return null;
    }
    if (this.current && (type === TYPE.FRAME_BEGIN || (type === TYPE.VIEW && payload.length === 11))) {
      this.current = null; throw RangeError('Previous screen update is incomplete');
    }
    if (type === TYPE.FRAME_BEGIN) {
      if (payload.length !== 14) throw RangeError('Bad frame header');
      const size = v.getUint32(10, true);
      if (size > MAX_FRAME_BYTES) throw RangeError('Screen update is too large');
      this.current = {id: v.getUint16(0, true), x: v.getUint16(2, true), y: v.getUint16(4, true), width: v.getUint16(6, true), height: v.getUint16(8, true), data: new Uint8Array(size), got: 0};
      return null;
    }
    const frame = this.current;
    if (type === TYPE.FRAME_DATA) {
      if (payload.length < 6 || !frame || v.getUint16(0, true) !== frame.id || v.getUint32(2, true) !== frame.got || frame.got + payload.length - 6 > frame.data.length) { this.current = null; throw RangeError('Screen update arrived out of order'); }
      frame.data.set(payload.subarray(6), frame.got); frame.got += payload.length - 6;
      return null;
    }
    if (type === TYPE.FRAME_END) {
      this.current = null;
      if (payload.length !== 2 || !frame || v.getUint16(0, true) !== frame.id || frame.got !== frame.data.length) throw RangeError('Screen update is incomplete');
      return {x: frame.x, y: frame.y, width: frame.width, height: frame.height, data: frame.data};
    }
    return null;
  }
}
// Device to host.
export function parseEvent(payload) { return payload.length === 1 ? EVENTS[payload[0]] || null : null; }
// The round board emits a single contact-down poke. Host-side Motion decides
// which facial reaction it gets. No coordinates or touch history travel.
export function parseRoundTouch(payload) {
  if (payload.length !== 9 || payload[0] !== 2) return null;
  const v = new DataView(payload.buffer, payload.byteOffset, payload.length);
  const session = v.getUint32(1, true), id = v.getUint32(5, true);
  return session && id ? {session, id} : null;
}
export function parseStatus(payload) {
  if (payload.length < 6) return null;
  const v = new DataView(payload.buffer, payload.byteOffset, payload.length);
  return {seq: payload[0], asleep: Boolean(payload[1] & STATUS.ASLEEP), torque: Boolean(payload[1] & STATUS.TORQUE), needFull: Boolean(payload[1] & STATUS.NEED_FULL), pan: v.getInt16(2, true) / 100, tilt: v.getInt16(4, true) / 100};
}
// The device's description of itself. Unknown fields are ignored and every
// accepted field is checked, because this is text from outside the app.
function roundDisplayHello(payload, nonce) {
  if (!uint32(nonce) || !nonce || payload.length > 600) return null;
  let h;
  try { h = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(payload)); } catch { return null; }
  if (!Array.isArray(h?.abilities)) return null;
  const touchFirmware = h.firmware === '0.2.0-s3' || h.firmware === '0.3.0-s3';
  const displayOnly = h.abilities.length === 0 && (h.firmware === '0.1.0-s3' || touchFirmware);
  const touch = touchFirmware && h.abilities.length === 1 && h.abilities[0] === 'touch';
  return (displayOnly || touch) && h.proto === VERSION && h.board === 'waveshare-s3-touch-lcd-2.1' &&
    h.screen?.width === 480 && h.screen.height === 480 && h.screen.margin === 12 && h.screen.round === true &&
    h.maxFrameBytes === 32768 && h.pictureSession === nonce ? h : null;
}
export const isRoundDisplayHello = (payload, nonce) => Boolean(roundDisplayHello(payload, nonce));
export const isH15DisplayHello = (payload, nonce) => roundDisplayHello(payload, nonce)?.firmware === '0.1.0-s3';

export function parseDeviceHello(payload) {
  if (payload.length > 600) return null;
  let value;
  try { value = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(payload)); } catch { return null; }
  if (!value || typeof value !== 'object' || value.proto !== VERSION) return null;
  const text = (v, max) => (typeof v === 'string' && v.length <= max && /^[\w .:+-]*$/.test(v) ? v : ''), size = v => (Number.isInteger(v) && v > 0 && v <= 1024 ? v : 0);
  const screen = value.screen && typeof value.screen === 'object' ? {width: size(value.screen.width), height: size(value.screen.height), margin: Number.isInteger(value.screen.margin) && value.screen.margin >= 0 && value.screen.margin <= 64 ? value.screen.margin : 0, round: value.screen.round === true} : null;
  if (!screen || !screen.width || !screen.height) return null;
  const abilities = Array.isArray(value.abilities) ? value.abilities.filter(a => ['pan', 'tilt', 'touch', 'imu', 'button'].includes(a)).slice(0, 8) : [];
  const device = {proto: VERSION, firmware: text(value.firmware, 24), board: text(value.board, 32), id: text(value.id, 32), screen, abilities};
  if (Object.hasOwn(value, 'pictureSession')) {
    if (!uint32(value.pictureSession) || !value.pictureSession) return null;
    device.pictureSession = value.pictureSession;
  }
  if (Object.hasOwn(value, 'maxFrameBytes')) {
    if (!Number.isSafeInteger(value.maxFrameBytes) || value.maxFrameBytes < 0) return null;
    device.maxFrameBytes = value.maxFrameBytes;
  }
  if (value.firmware === '0.3.0-s3' && value.pictureCachePixels === PICTURE_CACHE_PIXELS) device.pictureCachePixels = PICTURE_CACHE_PIXELS;
  return device;
}
