import {changedRect, frameTiles} from './codec.js';
import {pictureCRC32} from './wire.js';

// One in-flight picture. Count driver time after handoff, giving a draining
// FIFO time to deliver the commit before expecting a reply.
const WAIT_SECONDS = 1, ATTEMPTS = 3;

export class PictureDelivery {
  constructor(driver, getBufferedBytes) {
    this.driver = driver; this.getBufferedBytes = getBufferedBytes;
    this.reset();
  }

  reset() {
    this.session = undefined; // awaiting HELLO; null denotes an actual v1 reply
    this.confirmedId = 0; this.confirmedChecksum = 0; this.lastId = 0; this.pending = null;
    this.cachePixels = 0; this.cache = null; this.confirmedAppearance = null;
    this.dirty = true; this.attempts = 0; this.elapsed = Infinity;
    this.driver.sent = null;
  }

  greetingSent() {
    // Also covers a greeting explicitly initiated by the transport owner.
    if (this.session !== undefined) this.reset();
    if (!this.attempts) this.attempts = 1;
    this.elapsed = 0;
  }

  greeted(session, cachePixels = 0) {
    if (this.session !== undefined) return;
    this.session = session; this.cachePixels = cachePixels; this.attempts = 0; this.elapsed = 0;
  }

  get state() {
    if (this.attempts >= ATTEMPTS && this.elapsed >= WAIT_SECONDS) return 'unconfirmed';
    if (this.session === undefined) return 'negotiating';
    if (this.session === null) return 'legacy';
    return this.pending || this.dirty || !this.confirmedId ? 'pending' : 'confirmed';
  }

  accept(session, id, checksum) {
    const p = this.pending;
    if (session !== this.session || !p?.committing || p.id !== id || p.checksum !== checksum) return;
    this.driver.sent = p.pixels; this.confirmedId = id; this.confirmedChecksum = checksum; this.pending = null;
    this.cache = p.cache; this.confirmedAppearance = p.appearance;
    this.attempts = 0; this.elapsed = 0;
  }

  update(dt, changed) {
    this.dirty ||= changed;
    const exhausted = this.state === 'unconfirmed';
    this.elapsed += dt;
    if (this.session === undefined) {
      if (this.attempts < ATTEMPTS && this.elapsed >= WAIT_SECONDS) {
        this.attempts++; this.elapsed = 0;
        // A refused greeting uses the same finite retry budget as a lost one.
        try { this.driver.send({type: 'reset'}); } catch { /* await next deadline */ }
      }
      return;
    }
    if (this.session === null) {
      if (this.dirty || !this.driver.sent) {
        this.dirty = false;
        this.driver.sendLegacyFrame();
      }
      return;
    }
    if (this.pending?.buffered > 0 && !exhausted) {
      const remaining = this.getBufferedBytes();
      // A new low-water mark proves forward progress. Idle traffic behind the
      // commit cannot extend the window by oscillating the queue length.
      if (Number.isSafeInteger(remaining) && remaining >= 0 && remaining < this.pending.buffered) {
        this.pending.buffered = remaining; this.elapsed = 0;
      }
    }
    if (this.pending && (this.elapsed < WAIT_SECONDS || this.attempts >= ATTEMPTS)) return;
    if (!this.pending && !this.dirty) return;
    this.transmit();
  }

  // Only switch between the two known appearances while the current front
  // still belongs to this capture. Only a verified ACK installs the result.
  cacheFor(id, appearance, checksum, rect) {
    const prior = this.confirmedAppearance;
    if (!appearance || !prior || prior.cue !== appearance.cue || checksum === this.confirmedChecksum) return null;
    const toPoke = prior.touch === null && appearance.touch === 'poke';
    const toNeutral = prior.touch === 'poke' && appearance.touch === null;
    const slot = this.cache;
    if (slot && slot.cue === appearance.cue &&
        ((toPoke && this.confirmedChecksum === slot.neutral && checksum === slot.poke) ||
         (toNeutral && this.confirmedChecksum === slot.poke && checksum === slot.neutral))) return slot;
    if (toPoke && rect.width * rect.height <= this.cachePixels) {
      return {id, cue: appearance.cue, neutral: this.confirmedChecksum, poke: checksum};
    }
    return null;
  }

  transmit() {
    if (this.lastId === 0xFFFFFFFF) { this.driver.reset(); return; }
    const driver = this.driver, {contentWidth: width, contentHeight: height} = driver.screen;
    const base = this.pending ? 0 : this.confirmedId;
    // Drop the superseded snapshot before capturing the newest canvas. An
    // ACK for the old attempt may have been lost even if the display changed.
    this.pending = null;
    const pixels = driver.capturePixels(), previous = base ? driver.sent : new Uint16Array(pixels.length);
    const rect = changedRect(previous, pixels, width, height);
    this.dirty = false;
    if (base && !rect) return;
    const session = this.session, id = ++this.lastId;
    const appearance = this.cachePixels && driver.spec.portrait
      ? {cue: driver.screen.cue, touch: driver.screen.touch} : null;
    const checksum = pictureCRC32(pixels), cache = base ? this.cacheFor(id, appearance, checksum, rect) : null;
    const p = this.pending = {id, pixels, checksum, committing: false, appearance, cache};
    this.attempts++; this.elapsed = 0;
    try {
      if (driver.send({type: 'picture-begin', session, id, base}) === false || this.pending !== p) return;
      if (cache && cache.id !== id) {
        if (driver.send({type: 'picture-show', session, id, captureId: cache.id, checksum}) === false || this.pending !== p) return;
      } else if (rect) {
        for (const tile of frameTiles(previous, pixels, width, rect, driver.getMaxFrameBytes())) {
          if (driver.send(tile) === false || this.pending !== p) return;
        }
      }
      p.committing = true;  // a synchronous transport can deliver the ACK inside send()
      if (cache?.id === id) driver.send({type: 'picture-capture', session, id, checksum, rect});
      else driver.send({type: 'picture-commit', session, id, checksum});
    } catch {
      // Even a thrown write may have reached the receiver. Keep the confirmed
      // front buffer as the baseline until the matching ACK or a fresh retry.
    } finally {
      if (this.pending === p && this.getBufferedBytes) p.buffered = this.getBufferedBytes();
    }
  }
}
