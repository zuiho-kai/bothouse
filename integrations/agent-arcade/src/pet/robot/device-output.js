// The driver writes a transaction synchronously. The port drains one chunk
// at a time. Count the in-flight chunk until native write + drain completes.
export class DeviceOutput {
  constructor(send, {capacity = 768 * 1024, chunk = 32768} = {}) {
    this.send = send; this.ring = new Uint8Array(capacity); this.chunk = chunk;
    this.head = 0; this.used = 0; this.inFlight = 0; this.scheduled = false; this.revision = 0;
  }
  get buffered() { return this.used + this.inFlight; }
  clear() { this.head = 0; this.used = 0; this.revision++; }
  write(bytes) {
    if (bytes.length > this.ring.length - this.buffered) return false;
    const tail = (this.head + this.used) % this.ring.length;
    const first = Math.min(bytes.length, this.ring.length - tail);
    this.ring.set(bytes.subarray(0, first), tail);
    this.ring.set(bytes.subarray(first), 0);
    this.used += bytes.length;
    if (!this.scheduled) {
      this.scheduled = true;
      queueMicrotask(() => this.drain());
    }
    return true;
  }
  async drain() {
    while (this.used) {
      const revision = this.revision;
      const n = Math.min(this.used, this.chunk, this.ring.length - this.head);
      const bytes = this.ring.slice(this.head, this.head + n);
      this.head = (this.head + n) % this.ring.length; this.used -= n; this.inFlight = n;
      let sent = false;
      try { sent = await this.send(bytes); } catch { /* revoked port or renderer */ }
      this.inFlight = 0;
      if (!sent && revision === this.revision) this.clear();
    }
    this.scheduled = false;
  }
}
