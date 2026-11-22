// Screen share (Go Live) for the meeting assistant. Optional: only with meeting_screen_token set.
//
// Discord does not send Go Live to bot accounts, so a second, user account ("the watcher") does what
// the official client does when you click a stream: it joins the same voice channel, sends gateway
// op 20 STREAM_WATCH with the stream key, gets STREAM_CREATE (rtc_server_id) and STREAM_SERVER_UPDATE
// (endpoint, token) back and connects a separate voice connection to that stream server. That
// connection carries the sharer's video; video.mjs (kind 'screen') turns it into stills.
// 出处（下文标「SPEC」的都出自这里）：
//   giorgi-o/DiscordVideoProtocol README「The video stuff」https://github.com/giorgi-o/DiscordVideoProtocol
//   Discord-RE/Discord-video-stream（MIT）src/client/Streamer.ts、GatewayOpCodes.ts、voice/StreamConnection.ts、
//   src/utils.ts generateStreamKey https://github.com/Discord-RE/Discord-video-stream
// Automating a user account is against Discord's terms; the account can be banned. Use a spare one.
import { VoiceConnectionStatus, joinVoiceChannel } from '@discordjs/voice';
import { CameraReceiver } from './video.mjs';

export const GATEWAY = 'wss://gateway.discord.gg/?v=9&encoding=json'; // SPEC: the gateway user clients use
const OP = { DISPATCH: 0, HEARTBEAT: 1, IDENTIFY: 2, VOICE_STATE: 4, RECONNECT: 7, INVALID: 9, HELLO: 10, STREAM_DELETE: 19, STREAM_WATCH: 20 }; // SPEC: GatewayOpCodes.ts

// SPEC: utils.ts generateStreamKey, guild streams
export const streamKey = (guildId, channelId, userId) => `guild:${guildId}:${channelId}:${userId}`;

export class ScreenWatcher {
  constructor({ token, guildId, channelId, tmp, onShot, onWatcher, log, gateway = GATEWAY, join = joinVoiceChannel }) {
    Object.assign(this, { token, guildId, channelId, tmp, onShot, onWatcher, log, gateway, join });
    this.seq = null;
    this.userId = null;
    this.sessionId = null;
    this.voice = null; // the watcher's own (silent) connection to the voice channel
    this.voiceAdapter = null;
    this.wanted = new Set(); // members sharing their screen
    this.streams = new Map(); // sharer → { connection, adapter, receiver, rtcServerId }
    this.closed = false;
  }

  start() {
    this.ws = new WebSocket(this.gateway);
    this.ws.addEventListener('message', (e) => {
      try {
        this.onGateway(JSON.parse(e.data));
      } catch (err) {
        this.log('screen watcher', err.message);
      }
    });
    this.ws.addEventListener('close', (e) => {
      clearInterval(this.beat);
      if (!this.closed) this.log('screen watcher: gateway closed', e.code, e.reason);
    });
    this.ws.addEventListener('error', () => this.log('screen watcher: gateway error'));
  }

  send(op, d) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ op, d }));
  }

  onGateway(m) {
    if (m.s != null) this.seq = m.s;
    if (m.op === OP.HELLO) {
      this.beat = setInterval(() => this.send(OP.HEARTBEAT, this.seq), m.d.heartbeat_interval);
      this.send(OP.IDENTIFY, { token: this.token, capabilities: 0, compress: false, properties: { os: 'Windows', browser: 'Chrome', device: '' } });
      return;
    }
    if (m.op === OP.HEARTBEAT) return this.send(OP.HEARTBEAT, this.seq);
    if (m.op === OP.INVALID) return this.log('screen watcher: the token was refused (meeting_screen_token)');
    if (m.op === OP.RECONNECT) return this.log('screen watcher: gateway asked to reconnect; screen shares stop for this meeting');
    if (m.op !== OP.DISPATCH) return;
    const d = m.d || {};
    switch (m.t) {
      case 'READY':
        this.userId = d.user?.id;
        this.onWatcher?.(this.userId);
        this.log('screen watcher: logged in', this.userId);
        this.joinVoice();
        break;
      case 'VOICE_STATE_UPDATE':
        if (d.user_id !== this.userId || d.guild_id !== this.guildId) return;
        this.sessionId = d.session_id;
        this.voiceAdapter?.onVoiceStateUpdate(d);
        for (const uid of this.wanted) if (!this.streams.has(uid)) this.watch(uid);
        break;
      case 'VOICE_SERVER_UPDATE':
        if (d.guild_id === this.guildId) this.voiceAdapter?.onVoiceServerUpdate(d);
        break;
      case 'STREAM_CREATE': { // SPEC: Streamer.ts, STREAM_CREATE gives rtc_server_id
        const s = this.streamOf(d.stream_key);
        if (!s) return;
        s.rtcServerId = d.rtc_server_id;
        // SPEC: StreamConnection.ts daveChannelId = rtc_server_id − 1 (the voice library takes the DAVE
        // channel from the state packet's channel_id)
        s.adapter?.onVoiceStateUpdate({ session_id: this.sessionId, user_id: this.userId, channel_id: (BigInt(d.rtc_server_id) - 1n).toString() });
        break;
      }
      case 'STREAM_SERVER_UPDATE': { // SPEC: Streamer.ts, endpoint and token of the stream server
        const s = this.streamOf(d.stream_key);
        if (!s?.rtcServerId) return;
        // SPEC: Streamer.ts serverId = rtc_server_id (the voice library takes server_id from guild_id)
        s.adapter?.onVoiceServerUpdate({ token: d.token, endpoint: d.endpoint, guild_id: s.rtcServerId });
        break;
      }
      case 'STREAM_DELETE': {
        const uid = String(d.stream_key || '').split(':').pop();
        if (this.streams.has(uid)) this.unwatch(uid, false);
        break;
      }
    }
  }

  streamOf(key) {
    const parts = String(key || '').split(':'); // SPEC: utils.ts parseStreamKey
    if (parts[0] !== 'guild' || parts[1] !== this.guildId || parts[2] !== this.channelId) return null;
    return this.streams.get(parts[3]) || null;
  }

  joinVoice() {
    this.send(OP.VOICE_STATE, { guild_id: this.guildId, channel_id: this.channelId, self_mute: true, self_deaf: true, self_video: false });
    // the watcher sits in the channel like a person; its own audio connection carries nothing we use
    this.voice = this.join({
      guildId: this.guildId, channelId: this.channelId, group: 'golive-watcher', selfMute: true, selfDeaf: true,
      adapterCreator: (methods) => {
        this.voiceAdapter = methods;
        return { sendPayload: () => true, destroy: () => (this.voiceAdapter = null) }; // op 4 is sent above
      },
    });
    this.voice.on('error', (e) => this.log('screen watcher voice', e.message));
  }

  // the bridge says whether a member in the meeting's voice channel is sharing their screen
  setStreaming(userId, on) {
    if (!userId || userId === this.userId) return;
    if (on) {
      this.wanted.add(userId);
      if (this.sessionId && !this.streams.has(userId)) this.watch(userId);
    } else {
      this.wanted.delete(userId);
      if (this.streams.has(userId)) this.unwatch(userId, true);
    }
  }

  watch(uid) {
    const s = { rtcServerId: null, adapter: null };
    s.receiver = new CameraReceiver({ tmp: this.tmp, log: this.log, onShot: this.onShot, kind: 'screen', userId: uid });
    s.connection = this.join({
      guildId: `golive:${uid}`, channelId: this.channelId, group: 'golive', selfMute: true, selfDeaf: false,
      adapterCreator: (methods) => {
        s.adapter = methods;
        return { sendPayload: () => true, destroy: () => (s.adapter = null) }; // a stream connection sends no op 4
      },
    });
    s.connection.on('error', (e) => this.log('screen stream', uid, e.message));
    s.connection.on('stateChange', (from, to) => this.log('screen stream', uid, from.status, '->', to.status));
    s.receiver.attach(s.connection);
    this.streams.set(uid, s);
    this.send(OP.STREAM_WATCH, { stream_key: streamKey(this.guildId, this.channelId, uid) }); // SPEC: GatewayOpCodes.ts 20
    this.log('screen watcher: watching', uid);
  }

  async unwatch(uid, tell) {
    const s = this.streams.get(uid);
    this.streams.delete(uid);
    if (!s) return;
    if (tell) this.send(OP.STREAM_DELETE, { stream_key: streamKey(this.guildId, this.channelId, uid) }); // SPEC: GatewayOpCodes.ts 19
    await s.receiver.flush(); // the last still of the share
    if (s.connection.state.status !== VoiceConnectionStatus.Destroyed) s.connection.destroy();
  }

  async close() {
    if (this.closed) return;
    this.closed = true;
    await Promise.all([...this.streams.keys()].map((uid) => this.unwatch(uid, true)));
    if (this.voice && this.voice.state.status !== VoiceConnectionStatus.Destroyed) this.voice.destroy();
    this.send(OP.VOICE_STATE, { guild_id: this.guildId, channel_id: null, self_mute: false, self_deaf: false });
    clearInterval(this.beat);
    try {
      this.ws?.close();
    } catch {}
  }
}
