const MAX_SAMPLES = 16000 * 30;

class SocialVoiceProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.pcm = new Int16Array(MAX_SAMPLES);
    this.length = 0;
    this.port.onmessage = () => this.finish();
  }

  finish() {
    if (!this.pcm) return;
    const samples = this.pcm.slice(0, this.length);
    this.pcm = null;
    this.port.postMessage(samples, [samples.buffer]);
  }

  process([inputs]) {
    if (!this.pcm) return false;
    if (!inputs?.[0]) return true;
    for (const sample of inputs[0]) {
      const level = Math.max(-1, Math.min(1, sample));
      this.pcm[this.length++] = Math.round(level * (level < 0 ? 32768 : 32767));
      if (this.length === MAX_SAMPLES) {
        this.finish();
        return false;
      }
    }
    return true;
  }
}

registerProcessor('arcade-social-voice', SocialVoiceProcessor);
