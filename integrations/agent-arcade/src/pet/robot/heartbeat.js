// Local monotonic time belongs to the preview. Only a reply to its current
// probe proves that the main process can still sample the companion.
export const SILENCE_MS = 2500;

export class PreviewHeartbeat {
  constructor({request, present, sleep, now = () => performance.now(), token = () => crypto.randomUUID()}) {
    Object.assign(this, {request, present, sleep, now, token});
    this.pending = null;
    this.confirmed = null;
    this.lastReply = 0;
  }

  online() {
    const now = this.now();
    if (this.confirmed !== null && now - this.lastReply > SILENCE_MS) {
      this.confirmed = null;
      this.pending = null;
      this.sleep();
    }
    if (this.pending && now - this.pending.sent > SILENCE_MS) this.pending = null;
    return this.confirmed !== null;
  }

  // Host ticks and state changes merely invite a new sample. A queued tick
  // or an old reply arriving after a stall cannot wake the robot by itself.
  check() {
    this.online();
    if (this.pending) return;
    this.pending = {token: this.token(), sent: this.now()};
    this.request(this.pending.token);
  }

  accept(sample) {
    this.online();
    if (!this.pending || sample?.token !== this.pending.token) return;
    this.confirmed = this.pending.token;
    this.pending = null;
    this.lastReply = this.now();
    const state = {activity: sample.activity, attention: sample.attention};
    if (state.activity === 'thinking' && Number.isSafeInteger(sample.thinkingRun) && sample.thinkingRun > 0) state.thinkingRun = sample.thinkingRun;
    if ((state.activity === 'thinking' || state.activity === 'speaking') && Number.isSafeInteger(sample.completedRun) && sample.completedRun > 0) state.completedRun = sample.completedRun;
    this.present(state);
    return true;
  }

  acceptsEffect(token) { return this.online() && token === this.confirmed; }

  // Probe and touch travel in order from the same frame. While a reply is
  // in flight the main process will receive the probe before this touch.
  touchToken() { return this.online() ? this.pending?.token ?? this.confirmed : null; }
}
