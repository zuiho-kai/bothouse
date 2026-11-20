// Camera video for the meeting assistant: receive other members' cameras on the bot's voice
// connection and save a still every SHOT_MS, only when the picture changed.
//
// Discord forwards video only to voice clients that declare video support, so this patches
// @discordjs/voice the way the official client talks: IDENTIFY says video, SELECT_PROTOCOL lists the
// video codecs, and right after it a receive-only video state (voice op 12) is announced. Op 12 from
// the server then says which SSRC is whose camera. Video RTP is transport-decrypted like audio,
// reassembled into frames (H264 RFC 6184 / VP8 RFC 7741), the DAVE end-to-end layer is removed with
// the connection's own davey session, and ffmpeg decodes the frames since the last keyframe into
// one JPEG. A keyframe is asked for (RTCP PLI) after each still and after packet loss.
// 出处（下文标「SPEC」的数字都出自这里）：idoldange/discord-ext-voice-video-recv（discord.py 版，
//   同一做法，MIT）https://github.com/idoldange/discord-ext-voice-video-recv 的 codecs.py、patch.py、rtcp.py。
// Go Live (screen share) is not sent to bot accounts (same source, README); only cameras come this way.
import { spawn } from 'node:child_process';
import { readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import crypto from 'node:crypto';
import { VoiceReceiver, VoiceWebSocket } from '@discordjs/voice';

const PT_AUDIO = 120; // SPEC: codecs.py PT_AUDIO
const PT_H264 = 101; // SPEC: codecs.py PT_H264
const PT_VP8 = 103; // SPEC: codecs.py PT_VP8
const CODEC_BY_PT = { [PT_H264]: 'h264', [PT_VP8]: 'vp8' };
const RTX = new Set([102, 104]); // SPEC: codecs.py PT_H264_RTX, PT_VP8_RTX
// SPEC: codecs.py CODECS (the SELECT_PROTOCOL codec list; the server only forwards codecs listed here)
const CODECS = [
  { name: 'opus', type: 'audio', priority: 1000, payload_type: PT_AUDIO, rtx_payload_type: null }, // SPEC: codecs.py
  { name: 'H264', type: 'video', priority: 1000, payload_type: PT_H264, rtx_payload_type: 102 }, // SPEC: codecs.py
  { name: 'VP8', type: 'video', priority: 2000, payload_type: PT_VP8, rtx_payload_type: 104 }, // SPEC: codecs.py
];
const START4 = Buffer.from([0, 0, 0, 1]); // SPEC: H264 Annex-B start codes
const START3 = Buffer.from([0, 0, 1]); // SPEC: H264 Annex-B start codes
const DAVE_VIDEO = 1; // SPEC: @snazzah/davey index.d.ts, MediaType.VIDEO = 1

// 来源：用户只说「按时间截帧」，没给间隔，这个值是自定的：10 秒一张，画面没变就不留。
export const SHOT_MS = 10000;
// mean absolute difference of a 16×16 grey thumbnail (0–255) above which the picture counts as changed.
// 来源：自定，e2e 实测后按测得的噪声和换页差值回填（见 PR）。
const CHANGED = 6;

let ffmpegMissing = false;

function run(cmd, args) {
  return new Promise((resolve) => {
    let p;
    try {
      p = spawn(cmd, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    } catch (e) {
      return resolve({ code: -1, err: e.message });
    }
    let err = '';
    p.stderr.on('data', (d) => (err += d));
    p.on('error', (e) => resolve({ code: -1, err: e.message }));
    p.on('close', (code) => resolve({ code, err }));
  });
}

// SPEC: IVF container (libvpx ivfenc): 32-byte file header, 12-byte frame headers
function ivf(frames) {
  const head = Buffer.alloc(32); // SPEC: IVF
  head.write('DKIF', 0);
  head.writeUInt16LE(32, 6); // SPEC: IVF header length
  head.write('VP80', 8); // SPEC: IVF fourcc offset
  head.writeUInt32LE(30, 16); // SPEC: IVF time base (rate); 30 is only nominal, timing is not used
  head.writeUInt32LE(1, 20); // SPEC: IVF time base (scale)
  head.writeUInt32LE(frames.length, 24); // SPEC: IVF frame count offset
  const parts = [head];
  frames.forEach((f, i) => {
    const fh = Buffer.alloc(12); // SPEC: IVF frame header
    fh.writeUInt32LE(f.length, 0);
    fh.writeBigUInt64LE(BigInt(i), 4); // SPEC: IVF frame header, timestamp at offset 4
    parts.push(fh, f);
  });
  return Buffer.concat(parts);
}

// Reassembles the RTP payloads of one SSRC into whole frames; a lost packet spoils everything up to
// the next keyframe (needKey). SPEC: depacketizer.py FrameAssembler.
class Assembler {
  constructor(codec) {
    this.codec = codec;
    this.ts = null;
    this.parts = [];
    this.key = false;
    this.ok = true;
    this.lastSeq = null;
    this.needKey = true;
  }

  push(seq, ts, marker, data) {
    if (this.lastSeq !== null && ((seq - this.lastSeq) & 0xffff) !== 1) {
      this.ok = false;
      this.needKey = true;
    }
    this.lastSeq = seq;
    if (this.ts !== null && ts !== this.ts) {
      if (this.parts.length) this.needKey = true; // the previous frame never got its last packet
      this.parts = [];
      this.key = false;
      this.ok = true;
    }
    this.ts = ts;
    let chunk;
    let key;
    try {
      [chunk, key] = this.codec === 'vp8' ? vp8(data) : h264(data);
    } catch {
      this.ok = false;
      this.needKey = true;
      return null;
    }
    if (chunk.length) this.parts.push(chunk);
    this.key ||= key;
    if (!marker) return null;
    const frame = Buffer.concat(this.parts);
    const { key: isKey, ok } = this;
    this.parts = [];
    this.key = false;
    this.ok = true;
    this.ts = null;
    if (!ok || !frame.length) return null;
    if (isKey) this.needKey = false;
    return this.needKey ? null : { frame, key: isKey };
  }
}

// SPEC: RFC 7741 §4.2 VP8 payload descriptor
function vp8(p) {
  let i = 1; // SPEC: RFC 7741, first descriptor byte
  const start = Boolean(p[0] & 0x10) && (p[0] & 0x0f) === 0; // SPEC: RFC 7741 S bit, PID 0
  if (p[0] & 0x80) {
    const x = p[1];
    i = 2; // SPEC: RFC 7741, X byte present
    if (x & 0x80) i += p[i] & 0x80 ? 2 : 1; // SPEC: RFC 7741 I bit, 7/15-bit picture id
    if (x & 0x40) i += 1; // SPEC: RFC 7741 L bit, TL0PICIDX
    if (x & 0x30) i += 1; // SPEC: RFC 7741 T/K bits
  }
  const body = p.subarray(i);
  return [body, Boolean(start && body.length && (body[0] & 0x01) === 0)]; // SPEC: RFC 6386 P bit 0 = keyframe
}

// SPEC: RFC 6184 §5.6–5.8 single NAL / STAP-A (24) / FU-A (28); NAL 5 = IDR, 7 = SPS
function h264(p) {
  const t = p[0] & 0x1f;
  if (t === 24) { // SPEC: RFC 6184 STAP-A
    const out = [];
    let i = 1;
    let key = false;
    while (i + 2 <= p.length) {
      const n = p.readUInt16BE(i);
      const nal = p.subarray(i + 2, i + 2 + n);
      out.push(START4, nal);
      key ||= [5, 7].includes(nal[0] & 0x1f); // SPEC: RFC 6184 IDR/SPS
      i += 2 + n;
    }
    return [Buffer.concat(out), key];
  }
  if (t === 28) { // SPEC: RFC 6184 FU-A
    const hdr = p[1];
    if (hdr & 0x80) return [Buffer.concat([START4, Buffer.from([(p[0] & 0xe0) | (hdr & 0x1f)]), p.subarray(2)]), [5, 7].includes(hdr & 0x1f)]; // SPEC: RFC 6184
    return [p.subarray(2), false]; // SPEC: RFC 6184 FU-A payload after 2 bytes
  }
  return [Buffer.concat([START4, p]), t === 5 || t === 7]; // SPEC: RFC 6184 IDR/SPS
}

function replaceAll(buf, from, to) {
  const out = [];
  let i = 0;
  for (let j = buf.indexOf(from); j !== -1; j = buf.indexOf(from, i)) {
    out.push(buf.subarray(i, j), to);
    i = j + from.length;
  }
  out.push(buf.subarray(i));
  return Buffer.concat(out);
}

function meanDiff(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]);
  return s / a.length;
}

let active = null;

// Video receiver for one voice connection. onShot({user_id, kind, at, jpg}) gets each kept still.
export class CameraReceiver {
  constructor({ tmp, onShot, log }) {
    this.tmp = tmp;
    this.onShot = onShot;
    this.log = log;
    this.ssrc = new Map(); // video ssrc → { userId, codec, asm, frames, lastAt, thumb, busy }
    this.connection = null;
    this.pli = 0;
    this.packets = 0;
    this.shots = 0;
    this.timer = setInterval(() => this.shootAll(), SHOT_MS);
    active = this;
  }

  attach(connection) {
    this.connection = connection;
  }

  networking() {
    const st = this.connection?.state;
    return st && st.networking ? st.networking.state : null;
  }

  // voice op 12 from the server: a member's camera state. SPEC: receiver.py on_video_state
  onVideo(d) {
    const uid = String(d.user_id || '');
    if (!uid) return;
    for (const [ssrc, s] of this.ssrc) if (s.userId === uid) this.ssrc.delete(ssrc);
    const streams = (d.streams || []).filter((s) => s.type !== 'screen' && s.active && s.ssrc);
    if (!streams.length && d.video_ssrc && (d.streams || []).some((s) => s.active !== false)) streams.push({ ssrc: d.video_ssrc });
    for (const s of streams) this.ssrc.set(s.ssrc, { userId: uid, codec: null, asm: null, frames: [], lastAt: 0, thumb: null, busy: false });
    this.log('video state', uid, streams.length ? 'camera on' : 'camera off', streams.map((s) => s.ssrc).join(','));
  }

  // one video RTP packet, still transport-encrypted
  onPacket(receiver, msg) {
    this.packets++;
    const pt = msg[1] & 0x7f;
    const ssrcNum = msg.readUInt32BE(8); // SPEC: RTP header, SSRC at offset 8
    const st = this.ssrc.get(ssrcNum);
    const codec = CODEC_BY_PT[pt];
    if (!st || !codec) return;
    const cd = receiver.connectionData;
    if (!cd.encryptionMode || !cd.secretKey || !cd.nonceBuffer) return;
    let payload;
    try {
      payload = receiver.decrypt(msg, cd.encryptionMode, cd.nonceBuffer, cd.secretKey);
    } catch {
      return;
    }
    // padding and header extension body, as @discordjs/voice parsePacket does for audio
    if (msg[0] & 0x20) {
      const pad = payload[payload.length - 1];
      if (pad < payload.length) payload = payload.subarray(0, payload.length - pad);
    }
    if (msg[0] & 0x10) payload = payload.subarray(4 * msg.readUInt16BE(14)); // SPEC: RFC 3550 extension length at offset 14
    if (!payload.length) return;
    if (!st.asm || st.codec !== codec) {
      st.asm = new Assembler(codec);
      st.codec = codec;
      st.frames = [];
    }
    // SPEC: RTP header, sequence at offset 2, timestamp at 4, marker bit
    const done = st.asm.push(msg.readUInt16BE(2), msg.readUInt32BE(4), Boolean(msg[1] & 0x80), payload);
    if (st.asm.needKey) this.requestKey(ssrcNum, st);
    if (!done) return;
    const frame = this.daveDecrypt(st.userId, done.frame, codec);
    if (!frame) {
      st.asm.needKey = true;
      return;
    }
    if (done.key) st.frames = [];
    else if (!st.frames.length) return; // nothing to decode from without a keyframe
    st.frames.push(frame);
    st.lastAt = Date.now();
  }

  // SPEC: dave.py decrypt_video_frame
  daveDecrypt(userId, frame, codec) {
    const dave = this.networking()?.dave;
    if (!dave || dave.protocolVersion === 0) return frame;
    const session = dave.session;
    if (!session?.ready) return null;
    const variants = codec === 'h264' ? [frame, replaceAll(frame, START4, START3)] : [frame];
    for (const v of variants) {
      try {
        return session.decrypt(userId, DAVE_VIDEO, v);
      } catch {}
    }
    return null;
  }

  // RTCP picture loss indication: asks the sender for a keyframe, at most once a second per stream.
  // SPEC: rtcp.py build_pli and receiver.py _request_keyframe (1 s); RFC 4585 §6.3.1 PLI (PT 206, FMT 1)
  requestKey(media, st) {
    const now = Date.now();
    if (now - (st.pliAt || 0) < 1000) return; // SPEC: receiver.py, 1 s
    st.pliAt = now;
    const net = this.networking();
    const cd = net?.connectionData;
    if (!net?.udp || !cd?.secretKey) return;
    this.pli = (this.pli + 1) >>> 0;
    const header = Buffer.alloc(8); // SPEC: rtcp.py, 8-byte RTCP header in clear
    header.writeUInt8(0x81, 0); // SPEC: rtcp.py V=2 FMT=1
    header.writeUInt8(206, 1); // SPEC: RFC 4585 PSFB
    header.writeUInt16BE(2, 2); // SPEC: rtcp.py length
    header.writeUInt32BE(cd.ssrc >>> 0, 4); // SPEC: rtcp.py sender ssrc
    const body = Buffer.alloc(4);
    body.writeUInt32BE(media >>> 0, 0);
    const suffix = Buffer.alloc(4); // SPEC: rtcp.py 4-byte nonce suffix
    suffix.writeUInt32BE(this.pli, 0);
    let sealed;
    try {
      // The listener installs no sodium library, so @discordjs/voice can only have picked AES-GCM;
      // in the xchacha mode audio would not decrypt either.
      if (cd.encryptionMode !== 'aead_aes256_gcm_rtpsize') return;
      // SPEC: @discordjs/voice encryptOpusPacket, 12-byte nonce with the counter in front
      const c = crypto.createCipheriv('aes-256-gcm', cd.secretKey, Buffer.concat([suffix, Buffer.alloc(8)]));
      c.setAAD(header);
      sealed = Buffer.concat([c.update(body), c.final(), c.getAuthTag()]);
      net.udp.send(Buffer.concat([header, sealed, suffix]));
    } catch (e) {
      this.log('keyframe request failed', e.message);
    }
  }

  shootAll() {
    for (const [ssrc, st] of this.ssrc) this.shoot(ssrc, st);
  }

  // decode the frames since the last keyframe and keep the last picture if it changed
  async shoot(ssrc, st, final = false) {
    if (st.busy || !st.frames.length || ffmpegMissing) return;
    if (!final && Date.now() - st.lastAt > SHOT_MS) return; // camera paused: nothing new
    st.busy = true;
    const frames = st.frames.slice();
    const at = st.lastAt;
    const fmt = st.codec === 'vp8' ? 'ivf' : 'h264';
    const base = join(this.tmp, `cam-${ssrc}-${at}`);
    try {
      writeFileSync(`${base}.${fmt}`, fmt === 'ivf' ? ivf(frames) : Buffer.concat(frames));
      // SPEC: ffmpeg -update 1 keeps only the last decoded frame; the 16×16 grey copy is for the change test
      const r = await run('ffmpeg', ['-v', 'error', '-y', '-f', fmt, '-i', `${base}.${fmt}`,
        '-map', '0:v', '-update', '1', '-q:v', '3', `${base}.jpg`,
        '-map', '0:v', '-vf', 'scale=16:16,format=gray', '-update', '1', '-f', 'rawvideo', `${base}.gray`]);
      if (r.code === -1) {
        ffmpegMissing = true;
        this.log('ffmpeg not found, camera stills are off:', r.err);
        return;
      }
      let jpg;
      let thumb;
      try {
        jpg = readFileSync(`${base}.jpg`);
        thumb = readFileSync(`${base}.gray`);
      } catch {
        this.log('decode failed', ssrc, r.err.trim().split('\n').pop());
        return;
      }
      const diff = st.thumb && thumb.length === st.thumb.length ? meanDiff(thumb, st.thumb) : Infinity;
      this.log('still', ssrc, 'frames', frames.length, 'diff', diff === Infinity ? 'first' : diff.toFixed(1));
      if (diff > CHANGED) {
        st.thumb = thumb;
        this.shots++;
        this.onShot({ user_id: st.userId, kind: 'camera', at, jpg });
      }
    } finally {
      for (const ext of [fmt, 'jpg', 'gray']) {
        try {
          unlinkSync(`${base}.${ext}`);
        } catch {}
      }
      st.busy = false;
      st.pliAt = 0;
      this.requestKey(ssrc, st); // a fresh keyframe keeps the next decode short
    }
  }

  // last still of every camera (when the meeting ends)
  async flush() {
    clearInterval(this.timer);
    await Promise.all([...this.ssrc].map(([ssrc, st]) => this.shoot(ssrc, st, true)));
    this.log('video packets', this.packets, 'keyframe requests', this.pli, 'stills kept', this.shots);
  }
}

// --- patches (process-wide; one meeting per listener process) ---
// SPEC: patch.py send_as_json / initial_connection / AudioReader.callback
const origSend = VoiceWebSocket.prototype.sendPacket;
VoiceWebSocket.prototype.sendPacket = function (packet) {
  const op = packet?.op;
  if (op === 0 && packet.d) { // SPEC: voice op 0 IDENTIFY
    packet.d.video = true;
    packet.d.streams = [{ type: 'video', rid: '100', quality: 100 }]; // SPEC: patch.py IDENTIFY streams
    this.on('packet', (p) => {
      if (p.op === 2) this.videoStreams = p.d?.streams; // SPEC: voice op 2 READY streams
      else if (p.op === 12 && p.d) active?.onVideo(p.d); // SPEC: voice op 12 VIDEO
    });
  } else if (op === 1 && packet.d) { // SPEC: voice op 1 SELECT_PROTOCOL
    packet.d.codecs = CODECS;
  }
  const r = origSend.call(this, packet);
  if (op === 1) {
    const st = (this.videoStreams || [{}])[0] || {};
    const vs = st.ssrc || 0;
    const rs = st.rtx_ssrc || 0;
    const audio = active?.networking()?.connectionData?.ssrc || 0;
    // SPEC: patch.py receive-only video state, values as the official client sends them
    origSend.call(this, {
      op: 12, // SPEC: voice op 12 VIDEO
      d: {
        audio_ssrc: audio, video_ssrc: vs, rtx_ssrc: rs,
        streams: [{ type: 'video', rid: '100', ssrc: vs, active: false, quality: 100, rtx_ssrc: rs, max_bitrate: 2500000, max_framerate: 20, max_resolution: { type: 'fixed', width: 1280, height: 720 } }], // SPEC: patch.py
      },
    });
  }
  return r;
};

const origUdp = VoiceReceiver.prototype.onUdpMessage;
VoiceReceiver.prototype.onUdpMessage = function (msg) {
  if (active && msg.length > 12 && msg[0] >> 6 === 2) { // SPEC: RTP version 2, 12-byte header
    const pt = msg[1] & 0x7f;
    if (CODEC_BY_PT[pt] || RTX.has(pt)) {
      try {
        active.onPacket(this, msg);
      } catch (e) {
        active.log('video packet', e.message);
      }
      return;
    }
  }
  return origUdp.call(this, msg);
};
