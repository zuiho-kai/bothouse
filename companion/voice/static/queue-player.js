'use strict';

// One injected media element. Pages own HTTP/recovery/advance; this queue owns
// ordering, media callbacks and aggregate progress. update() never starts a
// stopped player: only start(), called under the page's user-intent latch, can.
class VoiceQueuePlayer {
  constructor(audio, { baseURL, onState = () => {}, onProgress = () => {} }) {
    this.audio = audio;
    this.baseURL = baseURL;
    this.onState = onState;
    this.onProgress = onProgress;
    this.epoch = 0;
    this.listeners = [];
    this.running = false;
    this.id = null;
  }

  select(turn) {
    this.stop();
    this.id = turn.id;
    this.streaming = Array.isArray(turn.audio_chunks);
    this.chunks = new Map();
    this.next = 0;
    this.elapsed = 0;
    this.current = null;
    this.complete = false;
    this.done = false;
    this.fatal = false;
    this.error = null;
    this.whole = null;
    this.replay = false;
    this.update(turn);
  }

  url(value) {
    if (typeof value !== 'string' || !value) throw new Error('缺少音频地址。');
    const url = new URL(value, this.baseURL);
    if (url.origin !== new URL(this.baseURL).origin || !['http:', 'https:'].includes(url.protocol)) {
      throw new Error('音频地址不属于当前语音服务。');
    }
    return url.href;
  }

  update(turn) {
    if (turn.id !== this.id || this.fatal) return;
    if (turn.status === 'error') {
      this.fail(new Error(turn.error || '本轮语音合成失败。'), true);
      return;
    }
    try {
      if (this.streaming) {
        for (const chunk of turn.audio_chunks || []) {
          if (!Number.isInteger(chunk.index) || chunk.index < 0 || !Number.isFinite(chunk.duration_seconds) || chunk.duration_seconds <= 0) {
            throw new Error('音频分块索引或时长无效。');
          }
          const item = { index: chunk.index, url: this.url(chunk.audio_url), duration: chunk.duration_seconds };
          const old = this.chunks.get(item.index);
          if (old && (old.url !== item.url || old.duration !== item.duration)) throw new Error('已收到的音频分块发生变化。');
          this.chunks.set(item.index, item);
        }
      }
      if (turn.status === 'ready' && (!this.streaming || turn.audio_complete === true)) {
        this.complete = true;
        if (this.streaming && (!this.chunks.size || [...this.chunks.keys()].some((index) => index >= this.chunks.size))) {
          throw new Error('语音已结束，但音频分块不完整。');
        }
        if (turn.audio_url) this.whole = this.url(turn.audio_url);
        else if (!this.streaming) throw new Error('本段缺少音频地址。');
      }
      if (this.running) this.pump();
      this.onProgress(this.snapshot());
    } catch (error) { this.fail(error, true); }
  }

  snapshot() {
    if (!this.id) return { position: 0, duration: 0 };
    const finite = (n) => Number.isFinite(n) && n >= 0 ? n : 0;
    const total = this.streaming
      ? [...this.chunks.values()].reduce((sum, item) => sum + item.duration, 0)
      : finite(this.audio.duration);
    // Completed chunks use the server's exact durations, including the final
    // receipt. Media currentTime/duration can be rounded differently by a UA.
    const position = this.done ? total : this.elapsed + (this.current
      ? Math.min(finite(this.audio.currentTime), this.current.duration || finite(this.audio.duration)) : 0);
    return { position, duration: Math.max(position, total) };
  }

  start({ replay = false } = {}) {
    if (!this.id || this.running || this.fatal) return;
    if (replay || this.done) {
      if (!this.complete || !this.whole) return;
      this.stop();
      this.replay = true;
      this.current = null;
      this.elapsed = 0;
      this.next = 0;
      this.done = false;
    }
    this.running = true;
    if (this.current) this.playItem(this.current, true);
    else this.pump();
  }

  pump() {
    if (!this.running || this.current) return;
    const item = this.streaming && !this.replay ? this.chunks.get(this.next)
      : this.next === 0 && this.whole ? { url: this.whole, duration: 0 } : null;
    if (item) this.playItem(item);
    else if (this.complete && this.next > 0 && (!this.streaming || this.replay || this.next === this.chunks.size)) {
      this.running = false;
      this.done = true;
      this.emit('completed');
    } else this.emit('waiting');
  }

  detach() {
    this.epoch += 1;
    for (const [type, listener] of this.listeners) this.audio.removeEventListener(type, listener);
    this.listeners = [];
  }

  stop() {
    const snapshot = this.id ? this.snapshot() : { position: 0, duration: 0 };
    this.running = false;
    this.detach();
    this.audio.pause();
    return snapshot;
  }

  emit(state, error) {
    this.onState(state, this.snapshot(), error);
    this.onProgress(this.snapshot());
  }

  fail(error, fatal = false) {
    this.stop();
    this.fatal = fatal;
    this.error = error;
    this.emit('failed', error);
  }

  playItem(item, resume = false) {
    this.detach();
    this.current = item;
    const epoch = this.epoch;
    const valid = () => this.running && this.epoch === epoch && this.current === item;
    const mediaValid = () => valid() && (this.audio.currentSrc || this.audio.src) === item.url;
    let started = false;
    const listen = (type, callback) => {
      const listener = () => { if (mediaValid()) callback(); };
      this.listeners.push([type, listener]);
      this.audio.addEventListener(type, listener);
    };
    if (!resume || this.audio.error || this.audio.src !== item.url) {
      this.audio.src = item.url;
      this.audio.load();
    }
    listen('playing', () => {
      if (this.audio.paused) return;
      started = true;
      this.emit('playing');
    });
    listen('ended', () => {
      if (!started || !this.audio.ended) return;
      this.detach();
      this.elapsed += item.duration || this.snapshot().duration;
      this.next += 1;
      this.current = null;
      this.pump();
    });
    listen('error', () => {
      if (this.audio.error) this.fail(new Error('音频无法加载或解码（' + this.audio.error.code + '）。'));
    });
    listen('pause', () => {
      if (this.audio.paused && !this.audio.ended) { this.stop(); this.emit('paused'); }
    });
    listen('waiting', () => this.emit('buffering'));
    listen('timeupdate', () => this.onProgress(this.snapshot()));
    listen('loadedmetadata', () => this.onProgress(this.snapshot()));
    this.emit('loading');
    if (!valid()) return;
    try {
      Promise.resolve(this.audio.play()).catch((error) => { if (valid()) this.fail(error); });
    } catch (error) { if (valid()) this.fail(error); }
  }
}

if (typeof module !== 'undefined' && module.exports) module.exports = VoiceQueuePlayer;
