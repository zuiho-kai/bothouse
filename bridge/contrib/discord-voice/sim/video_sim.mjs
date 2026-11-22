// Simulated meeting video, for meeting_video_sim_test.go: stands in for listener.mjs (same stdout
// protocol) but feeds video.mjs and golive.mjs with made-up media instead of a real voice channel.
//   camera: VP8 picture with a number on it, packetised (RFC 7741), AES-GCM encrypted like Discord's
//           aead_aes256_gcm_rtpsize, sent through the patched VoiceReceiver.onUdpMessage after a
//           server op 12 named its SSRC — the path a real camera takes.
//   screen: a fake Discord gateway; ScreenWatcher logs in, joins, sends STREAM_WATCH; the stream
//           connection gets H264 (RFC 6184 STAP-A / FU-A) the same way.
// Each source shows two numbers one after the other, so two stills each must come out.
// argv: <dir for copies of the stills>. Needs ffmpeg with drawtext. Exits non-zero on a mismatch.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import crypto from 'node:crypto';
import { createInterface } from 'node:readline';
import { VoiceReceiver, VoiceWebSocket } from '@discordjs/voice';
import { WebSocketServer } from 'ws';
import { CameraReceiver } from '../video.mjs';
import { ScreenWatcher } from '../golive.mjs';

const keep = process.argv[2] || '';
const tmp = mkdtempSync(join(tmpdir(), 'bothouse-videosim-'));
const emit = (o) => process.stdout.write(JSON.stringify(o) + '\n');
const log = (...a) => console.error('[sim]', ...a);
const must = (ok, what) => {
  if (!ok) {
    emit({ op: 'error', message: 'sim: ' + what });
    process.exit(1);
  }
};
const GUILD = '111';
const VOICE = '222';
const CAM_USER = '333'; // 小红
const SCREEN_USER = '444'; // 阿明
const WATCHER = '555';
export const NUMBERS = { camera: ['4271', '8305'], screen: ['9058', '1736'] };

const FONTS = ['/System/Library/Fonts/Supplemental/Arial.ttf', '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'];
function encode(text, codec) {
  const font = FONTS.find((f) => { try { readFileSync(f); return true; } catch { return false; } });
  const out = join(tmp, `${text}.${codec === 'vp8' ? 'ivf' : 'h264'}`);
  const draw = `drawtext=${font ? `fontfile=${font}:` : ''}text='${text}':fontsize=120:fontcolor=black:x=(w-tw)/2:y=(h-th)/2`;
  const enc = codec === 'vp8' ? ['-c:v', 'libvpx', '-b:v', '500k', '-f', 'ivf']
    : ['-c:v', 'libx264', '-profile:v', 'baseline', '-x264-params', 'slices=1:threads=1', '-bsf:v', 'h264_mp4toannexb', '-f', 'h264'];
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=white:s=640x360:r=10:d=1.5', '-vf', draw, '-pix_fmt', 'yuv420p', '-g', '10', ...enc, out]);
  return readFileSync(out);
}

// VP8 in IVF → frames
function ivfFrames(buf) {
  const frames = [];
  for (let i = buf.readUInt16LE(6); i + 12 <= buf.length;) {
    const n = buf.readUInt32LE(i);
    frames.push(buf.subarray(i + 12, i + 12 + n));
    i += 12 + n;
  }
  return frames;
}

// H264 Annex-B → access units (lists of NALs); one slice per picture (slices=1)
function h264Units(buf) {
  const nals = [];
  let start = -1;
  for (let i = 0; i + 3 <= buf.length; i++) {
    if (buf[i] === 0 && buf[i + 1] === 0 && (buf[i + 2] === 1 || (buf[i + 2] === 0 && buf[i + 3] === 1))) {
      const sc = buf[i + 2] === 1 ? 3 : 4;
      if (start >= 0) nals.push(buf.subarray(start, i));
      start = i + sc;
      i += sc - 1;
    }
  }
  if (start >= 0) nals.push(buf.subarray(start));
  const units = [];
  let cur = [];
  for (const n of nals) {
    const t = n[0] & 0x1f;
    if (t === 9) continue; // access unit delimiter
    cur.push(n);
    if (t === 1 || t === 5) { units.push(cur); cur = []; }
  }
  return units;
}

const MTU = 1100;
function vp8Payloads(frame) {
  const out = [];
  for (let i = 0; i < frame.length; i += MTU) out.push(Buffer.concat([Buffer.from([i === 0 ? 0x10 : 0x00]), frame.subarray(i, i + MTU)]));
  return out;
}
function h264Payloads(unit) {
  const out = [];
  const params = unit.filter((n) => [7, 8].includes(n[0] & 0x1f));
  if (params.length) { // STAP-A
    const parts = [Buffer.from([0x78])];
    for (const n of params) { const l = Buffer.alloc(2); l.writeUInt16BE(n.length); parts.push(l, n); }
    out.push(Buffer.concat(parts));
  }
  for (const n of unit.filter((x) => ![7, 8].includes(x[0] & 0x1f))) {
    if (n.length <= MTU) { out.push(n); continue; }
    const body = n.subarray(1);
    for (let i = 0; i < body.length; i += MTU) {
      const fu = Buffer.from([(n[0] & 0xe0) | 28, (i === 0 ? 0x80 : 0) | (i + MTU >= body.length ? 0x40 : 0) | (n[0] & 0x1f)]);
      out.push(Buffer.concat([fu, body.subarray(i, i + MTU)]));
    }
  }
  return out;
}

// RTP with a one-word header extension, sealed like aead_aes256_gcm_rtpsize
function sealer(key, ssrc, pt) {
  let seq = 1000;
  let ts = 90000;
  let nonce = 0;
  return (payloads) => {
    const pkts = payloads.map((p, i) => {
      const h = Buffer.alloc(16);
      h[0] = 0x90; // V=2, X=1
      h[1] = pt | (i === payloads.length - 1 ? 0x80 : 0);
      h.writeUInt16BE(seq++ & 0xffff, 2);
      h.writeUInt32BE(ts, 4);
      h.writeUInt32BE(ssrc, 8);
      h.writeUInt16BE(0xbede, 12);
      h.writeUInt16BE(1, 14); // extension length: 1 word
      const suffix = Buffer.alloc(4);
      suffix.writeUInt32BE(++nonce);
      const c = crypto.createCipheriv('aes-256-gcm', key, Buffer.concat([suffix, Buffer.alloc(8)]));
      c.setAAD(h);
      const body = Buffer.concat([Buffer.from([0x10, 0x22, 0x33, 0x44]), p]);
      return Buffer.concat([h, c.update(body), c.final(), c.getAuthTag(), suffix]);
    });
    ts += 9000;
    return pkts;
  };
}

// a stand-in for an @discordjs/voice VoiceConnection, far enough for video.mjs
function fakeConnection(key) {
  const sentWs = [];
  const ws = Object.create(VoiceWebSocket.prototype);
  ws.ws = { send: (s) => sentWs.push(JSON.parse(s)) };
  const vr = Object.create(VoiceReceiver.prototype);
  vr.connectionData = { encryptionMode: 'aead_aes256_gcm_rtpsize', secretKey: key, nonceBuffer: Buffer.alloc(12) };
  const pli = [];
  const networking = { state: { ws, udp: { send: (b) => pli.push(b) }, connectionData: { ssrc: 7, encryptionMode: 'aead_aes256_gcm_rtpsize', secretKey: key } } };
  const handlers = {};
  return {
    sentWs, ws, vr, pli, receiver: vr,
    state: { status: 'ready', networking },
    on: (ev, fn) => (handlers[ev] = fn),
    destroy() { this.state = { status: 'destroyed' }; },
    // the handshake as @discordjs/voice sends it, through the patched sendPacket
    handshake() {
      ws.sendPacket({ op: 0, d: { server_id: 'x', user_id: 'y', session_id: 'z', token: 't' } });
      ws.emit('packet', { op: 2, d: { ssrc: 7, streams: [{ type: 'video', rid: '100', ssrc: 8, rtx_ssrc: 9 }] } });
      ws.sendPacket({ op: 1, d: { protocol: 'udp', data: {} } });
    },
    feed(pkts) { for (const m of pkts) VoiceReceiver.prototype.onUdpMessage.call(vr, m); },
  };
}

const stills = [];
const onShot = (s) => {
  stills.push(s);
  if (keep) writeFileSync(join(keep, `${s.kind}-${stills.filter((x) => x.kind === s.kind).length}.jpg`), s.jpg);
  emit({ op: 'frame', user_id: s.user_id, kind: s.kind, at: s.at, jpg: s.jpg.toString('base64') });
};
const shootNow = async (rv) => { for (const [ssrc, st] of rv.ssrc) await rv.shoot(ssrc, st); };

async function camera() {
  const key = crypto.randomBytes(32);
  const conn = fakeConnection(key);
  const rv = new CameraReceiver({ tmp, log, onShot });
  rv.attach(conn);
  conn.handshake();
  const [id, sel, op12] = conn.sentWs;
  must(id.op === 0 && id.d.video === true && id.d.streams[0].type === 'video', 'IDENTIFY does not declare camera video');
  must(sel.op === 1 && sel.d.codecs.some((c) => c.name === 'VP8') && sel.d.codecs.some((c) => c.name === 'H264'), 'SELECT_PROTOCOL lacks the video codecs');
  must(op12?.op === 12 && op12.d.video_ssrc === 8 && op12.d.audio_ssrc === 7, 'no receive-only op 12 after SELECT_PROTOCOL');
  conn.ws.emit('packet', { op: 12, d: { user_id: CAM_USER, audio_ssrc: 70, video_ssrc: 71, streams: [{ type: 'video', rid: '100', ssrc: 71, active: true }] } });
  const seal = sealer(key, 71, 103); // PT 103 = VP8
  for (const n of NUMBERS.camera) {
    for (const f of ivfFrames(encode(n, 'vp8'))) conn.feed(seal(vp8Payloads(f)));
    await shootNow(rv);
  }
  await rv.flush();
  must(conn.pli.length > 0, 'no keyframe request (RTCP PLI) was sent');
  log('camera packets', rv.packets, 'stills', rv.shots, 'pli', conn.pli.length);
}

async function screen() {
  const gwSeen = [];
  const wss = new WebSocketServer({ port: 0 });
  await new Promise((r) => wss.once('listening', r));
  const RTC = '1234567890123456789';
  wss.on('connection', (sock) => {
    const send = (op, d, t) => sock.send(JSON.stringify({ op, d, t, s: t ? gwSeen.length : null }));
    send(10, { heartbeat_interval: 41250 });
    sock.on('message', (raw) => {
      const m = JSON.parse(raw);
      gwSeen.push(m);
      if (m.op === 2) send(0, { user: { id: WATCHER }, session_id: 'gw' }, 'READY');
      else if (m.op === 4 && m.d.channel_id) send(0, { user_id: WATCHER, guild_id: GUILD, channel_id: VOICE, session_id: 'voice-session' }, 'VOICE_STATE_UPDATE');
      else if (m.op === 20) {
        send(0, { stream_key: m.d.stream_key, rtc_server_id: RTC, region: 'x', viewer_ids: [WATCHER], paused: false }, 'STREAM_CREATE');
        send(0, { stream_key: m.d.stream_key, endpoint: 'stream.example:443', token: 'stream-token', guild_id: null }, 'STREAM_SERVER_UPDATE');
      }
    });
  });
  const joined = [];
  const join = (cfg) => {
    const conn = fakeConnection(crypto.randomBytes(32));
    const calls = { cfg, state: null, server: null, conn };
    const adapter = cfg.adapterCreator({ onVoiceStateUpdate: (d) => (calls.state = d), onVoiceServerUpdate: (d) => (calls.server = d), destroy() {} });
    adapter.sendPayload({ op: 4 });
    joined.push(calls);
    return conn;
  };
  let watcherId = null;
  const w = new ScreenWatcher({ token: 'user-token', guildId: GUILD, channelId: VOICE, tmp, log, onShot, onWatcher: (id) => { watcherId = id; emit({ op: 'watcher', user_id: id }); }, gateway: `ws://127.0.0.1:${wss.address().port}`, join });
  w.start();
  w.setStreaming(SCREEN_USER, true); // the bridge saw self_stream before the watcher got in
  const until = async (f, what) => { for (let i = 0; i < 100 && !f(); i++) await new Promise((r) => setTimeout(r, 20)); must(f(), what); };
  await until(() => joined.find((j) => j.cfg.group === 'golive')?.server, 'the stream connection never got its server');
  const ident = gwSeen.find((m) => m.op === 2);
  must(ident?.d.token === 'user-token', 'gateway IDENTIFY lacks the token');
  must(watcherId === WATCHER, 'watcher id not reported');
  must(gwSeen.some((m) => m.op === 4 && m.d.guild_id === GUILD && m.d.channel_id === VOICE && m.d.self_deaf), 'watcher did not join the voice channel');
  const watch = gwSeen.find((m) => m.op === 20);
  must(watch?.d.stream_key === `guild:${GUILD}:${VOICE}:${SCREEN_USER}`, `STREAM_WATCH key = ${watch?.d.stream_key}`);
  const st = joined.find((j) => j.cfg.group === 'golive');
  must(st.server.guild_id === RTC && st.server.token === 'stream-token' && st.server.endpoint === 'stream.example:443', 'stream server packet wrong');
  must(st.state.session_id === 'voice-session' && st.state.user_id === WATCHER && st.state.channel_id === (BigInt(RTC) - 1n).toString(), 'stream state packet wrong');
  const conn = st.conn;
  conn.handshake();
  must(conn.sentWs[0].d.streams[0].type === 'screen', 'stream IDENTIFY does not say screen');
  const rv = w.streams.get(SCREEN_USER).receiver;
  const seal = sealer(conn.vr.connectionData.secretKey, 91, 101); // PT 101 = H264, no op 12 on purpose
  for (const n of NUMBERS.screen) {
    for (const u of h264Units(encode(n, 'h264'))) conn.feed(seal(h264Payloads(u)));
    await shootNow(rv);
  }
  w.setStreaming(SCREEN_USER, false);
  await until(() => gwSeen.some((m) => m.op === 19), 'no STREAM_DELETE when the share stopped');
  await w.close();
  log('screen packets', rv.packets, 'stills', rv.shots);
  wss.close();
}

emit({ op: 'ready' });
const t0 = Date.now();
emit({ op: 'segment', user_id: CAM_USER, start: t0, end: t0 + 2000, text: '大家看我摄像头上的数字' });
await camera();
await screen();
emit({ op: 'segment', user_id: SCREEN_USER, start: Date.now(), end: Date.now() + 2000, text: '这是我共享的屏幕' });
const count = (k) => stills.filter((s) => s.kind === k).length;
must(count('camera') === 2 && count('screen') === 2, `stills camera=${count('camera')} screen=${count('screen')}, want 2 each`);
must(stills.every((s) => s.jpg[0] === 0xff && s.jpg[1] === 0xd8), 'a still is not a JPEG');
createInterface({ input: process.stdin }).on('line', (l) => {
  if (l.includes('"leave"')) { emit({ op: 'done' }); process.exit(0); }
}).on('close', () => process.exit(0));
