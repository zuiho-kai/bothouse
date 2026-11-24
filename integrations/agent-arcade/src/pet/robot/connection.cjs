'use strict';

const {randomInt, randomUUID} = require('node:crypto');
const {createSerialAdapter} = require('./serial-adapter.cjs');

const MAX_WRITE = 32768, MAX_QUEUED = 65536, CHOICE_MS = 60000;
const fault = code => Object.assign(new Error(code), {robotCode: code});
const expired = (promise, ms, code) => {
  let timer;
  const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(fault(code)), ms); });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
};

function serialNumber(value) {
  // Windows can derive a PnP instance tail (e.g. 6&...&0&0000) from
  // the hub location when the USB descriptor supplies no serial.
  if (typeof value !== 'string' || !/^(?:[a-f\d]{12}|[a-f\d]{2}([:-])(?:[a-f\d]{2}\1){4}[a-f\d]{2})$/i.test(value)) return '';
  const hex = value.replace(/[:-]/g, '').toUpperCase();
  if (/^(?:0{12}|F{12})$/.test(hex)) return '';
  return hex.match(/../g).join(':');
}

function eligible(list) {
  if (!Array.isArray(list) || list.length > 4096) throw fault('list');
  const rows = list.filter(p => /^303a$/i.test(p?.vendorId) && /^1001$/i.test(p.productId)
    && typeof p.path === 'string' && /^(?:COM\d+|\/dev\/[a-z\d._-]+)$/i.test(p.path));
  const paths = new Map(), serials = new Map();
  for (const p of rows) {
    paths.set(p.path, (paths.get(p.path) || 0) + 1);
    const sn = serialNumber(p.serialNumber);
    serials.set(sn, (serials.get(sn) || 0) + 1);
  }
  return rows.filter(p => paths.get(p.path) === 1).map(p => {
    const sn = serialNumber(p.serialNumber);
    return {path: p.path, sn, unique: !!sn && serials.get(sn) === 1, label: sn ? p.path + ' · ' + sn : p.path,
      fingerprint: JSON.stringify([p.path, p.serialNumber ?? '', p.locationId ?? '', p.pnpId ?? ''])};
  });
}

class RobotConnection {
  constructor({adapter = createSerialAdapter(), openDisplay, loadRemembered = () => null,
    saveRemembered = () => {}, onChange = () => {}, timeoutMs = 6000, pollMs = 2000} = {}) {
    this.adapter = adapter; this.openDisplay = openDisplay; this.saveRemembered = saveRemembered; this.onChange = onChange;
    this.timeoutMs = timeoutMs; this.pollMs = pollMs; this.state = 'idle'; this.error = null;
    this.choices = new Map(); this.cycle = 0; this.revision = 0; this.active = null; this.owner = null; this.disposed = false;
    // A canceled native open can complete later. Never open a second handle
    // before the first one has actually closed, including on a reused COM name.
    this.portIdle = Promise.resolve();
    let record;
    try { record = loadRemembered(); } catch { this.state = 'error'; this.error = 'storage'; }
    const sn = serialNumber(record?.serialNumber);
    this.saved = sn ? {serialNumber: sn, autoConnect: record.autoConnect === true} : null;
  }
  snapshot() {
    const a = this.active, releasing = this.owner?.releaseState;
    const state = releasing === 'closing' ? 'disconnecting' : releasing ? 'disconnect-error' : this.state;
    return {state, error: this.error, remembered: !!this.saved, rememberedLabel: this.saved?.serialNumber || '', portOpen: !!this.owner?.port,
      label: a?.row.label || this.saved?.serialNumber || '', delivery: a?.delivery ? {...a.delivery} : null,
      candidates: Array.from(this.choices, ([id, row]) => ({id, label: row.label, rememberable: row.unique}))};
  }
  publish(state = this.state, error = null) {
    this.state = state; this.error = error;
    if (!this.disposed) this.onChange(this.snapshot());
    return this.snapshot();
  }
  remember(value) {
    try { this.saveRemembered(value); } catch { throw fault('storage'); }
    this.saved = value;
  }
  list() {
    if (!this.enumerating) {
      this.enumerating = Promise.resolve().then(() => this.adapter.list()).then(eligible)
        .finally(() => { this.enumerating = null; });
    }
    return expired(this.enumerating, this.timeoutMs, 'list');
  }
  async refresh() {
    if (this.disposed || this.owner?.releaseState) return this.snapshot();
    const rev = ++this.revision;
    this.choices.clear();
    try {
      const rows = await this.list();
      if (this.revision !== rev || this.disposed) return this.snapshot();
      for (const row of rows.slice(0, 64)) this.choices.set(randomUUID(), {...row, till: Date.now() + CHOICE_MS});
      return this.publish(this.state === 'error' && !this.active ? 'idle' : this.state);
    } catch {
      if (this.revision !== rev || this.disposed) return this.snapshot();
      return this.publish(this.active ? this.state : 'error', 'list');
    }
  }
  start() {
    if (!this.disposed && !this.started) {
      this.started = true;
      if (this.saved?.autoConnect && !this.active) {
        this.publish('reconnecting'); return this.watch();
      }
    }
    return Promise.resolve(this.snapshot());
  }
  schedule() {
    clearTimeout(this.timer);
    if (this.disposed || this.owner?.releaseState || (!this.active && this.state !== 'reconnecting')) return;
    this.timer = setTimeout(() => { this.watch().catch(() => {}); }, this.pollMs);
    this.timer.unref?.();
  }
  async watch() {
    if (this.owner?.releaseState) return this.snapshot();
    const a = this.active, saved = this.saved, cycle = this.cycle;
    try {
      const rows = await this.list();
      if (this.disposed || a !== this.active || cycle !== this.cycle || saved !== this.saved) return this.snapshot();
      if (a) {
        const here = rows.find(r => r.fingerprint === a.row.fingerprint);
        if (!here) return this.lost(a, 'transport');
        if (a.row.unique && !here.unique) {
          a.row.unique = false;
          if (this.saved?.serialNumber === here.sn) this.remember(null);
          this.publish(this.state, 'ambiguous');
        }
      } else if (this.state === 'reconnecting' && saved?.autoConnect) {
        const matches = rows.filter(r => r.sn === saved.serialNumber);
        if (matches.length && !matches[0].unique) {
          this.remember(null); return this.publish('error', 'ambiguous');
        }
        if (matches.length === 1) return this.begin(matches[0], true);
      }
    } catch (e) {
      if (!this.disposed && cycle === this.cycle && a === this.active) {
        if (e.robotCode === 'storage') { this.cancel(); return this.publish('error', 'storage'); }
        this.publish(this.state, 'list');
      }
    } finally {
      if (!this.disposed && cycle === this.cycle) this.schedule();
    }
    return this.snapshot();
  }
  async connect(id) {
    if (this.disposed || this.owner?.releaseState) return this.snapshot();
    const row = typeof id === 'string' ? this.choices.get(id) : null;
    if (!row || row.till < Date.now()) return this.publish(this.active ? this.state : 'error', 'stale');
    return this.begin(row, false);
  }
  async begin(row, auto) {
    this.cancel();
    this.choices.clear();
    if (!auto && this.saved?.autoConnect && (!row.unique || row.sn !== this.saved.serialNumber)) {
      try { this.remember({...this.saved, autoConnect: false}); } catch { return this.publish('error','storage'); }
    }
    const a = {row: {...row}, auto, port: null, display: null, delivery: null, buffered: 0, writes: 0, tail: Promise.resolve()};
    a.canceled = new Promise(resolve => { a.cancel = resolve; });
    this.active = a;
    this.publish('connecting');
    try {
      await Promise.race([expired(this.open(a), this.timeoutMs, 'timeout'), a.canceled]);
    } catch (e) {
      if (a === this.active) {
        this.lost(a, e.robotCode || 'open');
        if (a.releaseDone) await a.releaseDone;
      }
    }
    return this.snapshot();
  }
  async verifyRow(a) {
    // A UI refresh may have taken its sample before an asynchronous open or
    // close. Always begin a fresh OS enumeration for each ownership check.
    if (this.enumerating) await expired(this.enumerating, this.timeoutMs, 'list').catch(() => {});
    if (this.active !== a) return false;
    if (this.enumerating) throw fault('list');
    const rows = await this.list().catch(() => { throw fault('list'); });
    if (this.active !== a) return false;
    const live = rows.find(r => r.fingerprint === a.row.fingerprint);
    if (!live || (a.auto && !live.unique)) throw fault(live ? 'ambiguous' : 'stale');
    a.row.unique &&= live.unique;
    return true;
  }
  async open(a) {
    const idle = this.portIdle;
    let release;
    this.portIdle = new Promise(resolve => { release = resolve; });
    await idle;
    if (this.active !== a) { release(); return; }
    try {
      if (!(await this.verifyRow(a)) || this.active !== a) { release(); return; }
      a.release = release;
      this.owner = a;
      a.port = await this.adapter.open(a.row.path);
    } catch (e) {
      if (this.owner === a) this.releasePort(a);
      else release();
      throw e.robotCode ? e : fault('open');
    }
    if (this.active !== a) {
      this.closePort(a);
      return;
    }
    const port = a.port;
    this.publish();
    if (!(await this.verifyRow(a)) || this.active !== a) return;
    const {framed, TYPE, StreamReader, isRoundDisplayHello, parseDeviceHello} = await import('./wire.js');
    if (this.active !== a) return;
    const nonce = randomInt(1, 0x100000000);
    const hello = Buffer.alloc(7); hello[0] = 1; hello.writeUInt32LE(nonce, 3);
    await this.write(a, Buffer.concat([Buffer.of(0), framed(TYPE.HELLO, 0, hello)]));
    const reader = new StreamReader(), buffer = Buffer.alloc(4096);
    while (this.active === a) {
      const n = await port.read(buffer);
      if (this.active !== a) return;
      if (!Number.isInteger(n) || n <= 0 || n > buffer.length) throw fault('transport');
      const reply = reader.push(buffer.subarray(0, n)).find(p => {
        if (p.type !== TYPE.D_HELLO) return false;
        if (isRoundDisplayHello(p.payload, nonce)) return true;
        const other = parseDeviceHello(p.payload);
        if (other?.pictureSession && other.pictureSession !== nonce) return false;
        throw fault('incompatible');
      });
      if (reply) break;
    }
    if (this.active !== a) return;
    if (!(await this.verifyRow(a)) || this.active !== a) return;
    const display = this.openDisplay({
      write: bytes => this.write(a, bytes), getBufferedBytes: () => a.buffered,
      onDelivery: value => {
        if (this.active !== a || !value || !['handshake','syncing','confirmed','unconfirmed','incompatible','sleeping'].includes(value.phase)) return;
        const count = k => Number.isInteger(value[k]) && value[k] >= 0 && value[k] <= 0xffffffff ? value[k] : 0;
        a.delivery = {phase: value.phase, session: count('session'), id: count('id'), checksum: count('checksum'), attempts: count('attempts')};
        this.publish();
      },
      onFault: reason => { if (this.active === a) this.lost(a, reason === 'incompatible' ? reason : reason === 'worker' ? reason : 'transport'); },
    });
    if (this.active !== a) { display.close(); return; }
    a.display = display;
    try { this.remember(a.row.unique ? {serialNumber: a.row.sn, autoConnect: true} : null); }
    catch { throw fault('storage'); }
    this.publish('connected'); this.schedule();
    this.receive(a, buffer).catch(() => this.lost(a, 'transport'));
  }
  async receive(a, buffer) {
    while (this.active === a) {
      const n = await a.port.read(buffer);
      if (this.active !== a) return;
      if (!Number.isInteger(n) || n <= 0 || n > buffer.length) throw fault('transport');
      a.display.receive(Buffer.from(buffer.subarray(0, n)));
    }
  }
  write(a, bytes) {
    if (this.active !== a || !a.port || !(bytes instanceof Uint8Array) || !bytes.length ||
        bytes.length > MAX_WRITE || a.writes >= 32 || a.buffered + bytes.length > MAX_QUEUED) return Promise.reject(fault('transport'));
    const copy = Buffer.from(bytes);
    a.buffered += copy.length; a.writes++;
    const work = a.tail.then(async () => {
      if (this.active !== a) throw fault('transport');
      await a.port.write(copy);
      if (this.active !== a) throw fault('transport');
      await a.port.drain();
    });
    a.tail = work.catch(() => {});
    return expired(work, this.timeoutMs, 'transport').catch(e => { this.lost(a, 'transport'); throw e; })
      .finally(() => { a.buffered -= copy.length; a.writes--; });
  }
  releasePort(a) {
    clearTimeout(a.releaseTimer);
    this.owner = null;
    a.release();
    a.finishRelease?.();
    if (a.releaseState && !this.disposed) {
      this.publish(this.state, this.error);
      if (this.state === 'reconnecting') this.schedule();
    }
  }
  closePort(a) {
    if (!a.port || a.closing) return;
    a.closing = true;
    Promise.resolve().then(() => a.port.close()).then(() => this.releasePort(a), () => {
      // The adapter can invalidate its local fd before native close resolves.
      // A rejection gives no evidence that the driver released the handle.
      clearTimeout(a.releaseTimer);
      a.releaseState = 'failed';
      a.finishRelease();
      if (!this.disposed) this.publish(this.state, this.error);
    });
  }
  cancel() {
    this.cycle++; this.revision++;
    clearTimeout(this.timer);
    const a = this.active;
    this.active = null;
    if (!a) return this.owner?.releaseDone;
    a.cancel();
    try { a.display?.close(); } catch {}
    const owner = this.owner;
    if (owner === a) {
      a.releaseState = 'closing';
      a.releaseDone = new Promise(resolve => { a.finishRelease = resolve; });
      if (!this.disposed) {
        a.releaseTimer = setTimeout(() => {
          a.releaseState = 'timeout';
          a.finishRelease();
          if (!this.disposed) this.publish(this.state, this.error);
        }, this.timeoutMs);
      }
      this.closePort(a);
    }
    return owner?.releaseDone;
  }
  lost(a, code) {
    if (this.active !== a) return this.snapshot();
    this.cancel();
    const retry = a.row.unique && this.saved?.autoConnect && a.row.sn === this.saved.serialNumber &&
      ['stale','list','open','transport'].includes(code);
    if (code === 'ambiguous' && this.saved) {
      try { this.remember(null); } catch { return this.publish('error', 'storage'); }
    }
    this.publish(retry ? 'reconnecting' : 'error', code);
    if (retry) this.schedule();
    return this.snapshot();
  }
  disconnect() { return this.stop(false); }
  forget() { return this.stop(true); }
  async stop(forget) {
    if (this.disposed) return this.snapshot();
    const closing = this.cancel(); this.choices.clear();
    try { if (this.saved) this.remember(forget ? null : {...this.saved, autoConnect: false}); }
    catch { return this.publish('error','storage'); }
    this.publish('disconnected');
    if (closing) await closing;
    return this.snapshot();
  }
  dispose() {
    this.disposed = true; this.cancel(); this.choices.clear(); this.state = 'idle';
  }
}

module.exports = {RobotConnection};
