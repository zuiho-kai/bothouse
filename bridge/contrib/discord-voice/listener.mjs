// Discord voice listener for the meeting assistant (bridge/platform/discord/meeting.go).
//
// The bridge keeps the only gateway connection. This process speaks JSON lines with it:
//   stdin   {"op":"join","guild_id","channel_id"}   start: join that voice channel
//           {"op":"voice_state","d":{…}} / {"op":"voice_server","d":{…}}   the bot's own gateway events
//           {"op":"leave"}                                    leave, transcribe what is left, exit
//   stdout  {"op":"gateway","d":{…}}     a gateway payload (op 4) the bridge must send
//           {"op":"ready"}               connected to the voice channel, recording
//           {"op":"segment","user_id","start","end","text"}   one stretch of speech (times: epoch ms)
//           {"op":"done"}                everything transcribed, about to exit
//           {"op":"error","message"}     fatal
// Voice itself (voice gateway, UDP, transport encryption and DAVE end-to-end encryption) is
// @discordjs/voice; discordgo cannot do DAVE, which Discord requires on voice channels.
// Audio is cut per speaker at pauses, decoded to 16 kHz mono wav, transcribed by asr_worker.py
// (argv: the python that has mlx_whisper) and the wav is deleted right after: no recording is kept.
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { EndBehaviorType, VoiceConnectionStatus, entersState, joinVoiceChannel } from '@discordjs/voice';
import OpusScript from 'opusscript';

const RATE = 16000; // source: whisper's input sample rate (mlx_whisper/audio.py SAMPLE_RATE)
// A speaker's silence this long ends the segment. 来源：用户只说按停顿切段，没给时长，这个值是自定的；
// 实测（e2e 第一轮）：7 段各 3–9 秒、段间停 2.5 秒的话切成 7 段，句内逗号句号的停顿没有被切开。
const PAUSE_MS = 1000;

const python = process.argv[2] || 'python3';
const here = dirname(fileURLToPath(import.meta.url));
const tmp = mkdtempSync(join(tmpdir(), 'bothouse-voice-'));
const emit = (o) => process.stdout.write(JSON.stringify(o) + '\n');
const log = (...a) => console.error('[voice]', ...a);

// --- transcription: one resident worker, one wav at a time, in order ---
const asr = spawn(python, ['-I', join(here, 'asr_worker.py')], { stdio: ['pipe', 'pipe', 'inherit'] });
const waiting = []; // segments sent to the worker, oldest first
let idle = null; // resolves when `waiting` is empty
asr.on('error', (e) => fail(`transcriber did not start (${python}): ${e.message}`));
asr.on('exit', (code) => {
  if (waiting.length || !leaving) fail(`transcriber exited (code ${code})`);
});
createInterface({ input: asr.stdout }).on('line', (line) => {
  const seg = waiting.shift();
  if (!seg) return;
  try {
    unlinkSync(seg.wav);
  } catch {}
  let text = '';
  try {
    text = (JSON.parse(line).text || '').trim();
  } catch {
    log('bad transcriber line', line);
  }
  if (text) emit({ op: 'segment', user_id: seg.userId, start: seg.start, end: seg.end, text });
  if (!waiting.length && idle) idle();
});

function wavHeader(bytes) {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0);
  h.writeUInt32LE(36 + bytes, 4);
  h.write('WAVEfmt ', 8);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20); // PCM
  h.writeUInt16LE(1, 22); // mono
  h.writeUInt32LE(RATE, 24);
  h.writeUInt32LE(RATE * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write('data', 36);
  h.writeUInt32LE(bytes, 40);
  return h;
}

let seq = 0;
function transcribe(userId, start, end, pcm) {
  const bytes = pcm.reduce((n, b) => n + b.length, 0);
  if (!bytes) return;
  const wav = join(tmp, `${++seq}.wav`);
  writeFileSync(wav, Buffer.concat([wavHeader(bytes), ...pcm]));
  waiting.push({ wav, userId, start, end });
  asr.stdin.write(wav + '\n');
}

// --- voice ---
let connection = null;
let leaving = false;
const open = new Set(); // streams being recorded

function record(userId) {
  if (leaving || connection.receiver.subscriptions.has(userId)) return;
  const stream = connection.receiver.subscribe(userId, { end: { behavior: EndBehaviorType.AfterSilence, duration: PAUSE_MS } });
  const decoder = new OpusScript(RATE, 1);
  const pcm = [];
  const start = Date.now();
  let last = start;
  open.add(stream);
  stream.on('data', (packet) => {
    try {
      pcm.push(Buffer.from(decoder.decode(packet)));
      last = Date.now();
    } catch {} // a damaged packet: skip it
  });
  stream.on('error', (e) => log('receive stream', userId, e.message));
  stream.once('close', () => {
    open.delete(stream);
    decoder.delete();
    transcribe(userId, start, last, pcm);
  });
}

function join_(guildId, channelId) {
  connection = joinVoiceChannel({
    guildId,
    channelId,
    selfDeaf: false,
    selfMute: true,
    debug: true,
    adapterCreator: (methods) => {
      adapter = methods;
      return {
        sendPayload: (payload) => {
          emit({ op: 'gateway', d: payload });
          return true;
        },
        destroy: () => {
          adapter = null;
        },
      };
    },
  });
  connection.on('debug', (m) => {
    if (m.includes('[DAVE]')) log(m); // the other debug lines carry the voice token and the secret key
  });
  connection.on('stateChange', (from, to) => log('connection', from.status, '->', to.status));
  connection.on('error', (e) => log('connection error', e.message));
  connection.receiver.speaking.on('start', record);
  connection.on(VoiceConnectionStatus.Disconnected, async () => {
    if (leaving) return;
    // moved to another channel or a voice server change reconnects by itself; anything else is the end
    try {
      await Promise.race([
        entersState(connection, VoiceConnectionStatus.Signalling, 5000),
        entersState(connection, VoiceConnectionStatus.Connecting, 5000),
      ]);
    } catch {
      fail('disconnected from the voice channel');
    }
  });
  entersState(connection, VoiceConnectionStatus.Ready, 30000).then(
    () => emit({ op: 'ready' }),
    () => fail('could not connect to the voice channel in 30s'),
  );
}

let adapter = null;

async function leave() {
  if (leaving) return;
  leaving = true;
  for (const s of open) s.destroy(); // close → transcribe what was being said
  if (connection && connection.state.status !== VoiceConnectionStatus.Destroyed) connection.destroy(); // sends the op 4 that leaves
  if (waiting.length) await new Promise((r) => (idle = r));
  emit({ op: 'done' });
  finish(0);
}

function fail(message) {
  log('fatal:', message);
  emit({ op: 'error', message });
  finish(1);
}

let finished = false;
function finish(code) {
  if (finished) return;
  finished = true;
  leaving = true;
  try {
    if (connection && connection.state.status !== VoiceConnectionStatus.Destroyed) connection.destroy();
  } catch {}
  asr.kill();
  rmSync(tmp, { recursive: true, force: true });
  process.stdout.write('', () => process.exit(code));
}

createInterface({ input: process.stdin })
  .on('line', (line) => {
    let m;
    try {
      m = JSON.parse(line);
    } catch {
      return;
    }
    if (m.op === 'join') join_(m.guild_id, m.channel_id);
    else if (m.op === 'voice_state') adapter?.onVoiceStateUpdate(m.d);
    else if (m.op === 'voice_server') adapter?.onVoiceServerUpdate(m.d);
    else if (m.op === 'leave') leave();
  })
  .on('close', () => leave()); // the bridge went away
