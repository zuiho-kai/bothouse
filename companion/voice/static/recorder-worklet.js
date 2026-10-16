/* The worklet's sampleRate is the AudioContext's actual rate, never assumed 16 kHz. */
class VoiceRecorder extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const seconds = Math.min(30, Math.max(1, Number(options.processorOptions.maxSeconds) || 30));
    this.limit = Math.floor(sampleRate * seconds);
    this.frames = 0;
    this.buffer = new Float32Array(2048);
    this.used = 0;
    this.stopped = false;
    this.port.onmessage = ({ data }) => {
      if (data.type === 'stop') this.finish();
    };
  }

  flush() {
    if (!this.used) return;
    const samples = this.buffer.slice(0, this.used);
    this.port.postMessage({ type: 'samples', samples }, [samples.buffer]);
    this.used = 0;
  }

  finish() {
    if (this.stopped) return;
    this.stopped = true;
    this.flush();
    this.port.postMessage({ type: 'stopped', sampleRate, frames: this.frames });
  }

  process(inputs) {
    if (this.stopped) return false;
    const channels = inputs[0];
    if (!channels || !channels.length) return true;
    for (let i = 0; i < channels[0].length; i += 1) {
      let value = 0;
      for (const channel of channels) value += channel[i];
      this.buffer[this.used++] = value / channels.length;
      this.frames += 1;
      if (this.used === this.buffer.length) this.flush();
      if (this.frames >= this.limit) {
        this.finish();
        return false;
      }
    }
    // Outputs remain zero: the microphone is never monitored through the speakers.
    return true;
  }
}

registerProcessor('voice-recorder', VoiceRecorder);
