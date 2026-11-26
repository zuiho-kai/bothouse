'use strict';
const object = (value, keys) => value && Object.getPrototypeOf(value) === Object.prototype && Object.keys(value).every(key => keys.includes(key));
const failure = code => Object.assign(Error(`Desktop conversation selection failed (${code}).`), {code});
const fs = require('node:fs');
const path = require('node:path');
const {atomicJSON} = require('../core/files.cjs');
const {observeLocalRunners} = require('./desktop-chat.cjs');

// The last conversation kind of a profile is kept in that profile's own folder:
//   <profile root>/desktop-conversation.json   {"version":1,"kind":"local"|"channel"}
// It is a foreground preference only. Anything else in the file makes it ignored.
const CHOICE_FILE = 'desktop-conversation.json';
const profileRoot = service => typeof service?.root === 'string' && path.isAbsolute(service.root) ? service.root : null;
function storedKind(service) {
  const root = profileRoot(service); if (!root) return null;
  try {
    const file = path.join(root, CHOICE_FILE), stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.size > 256) return null;
    const value = JSON.parse(fs.readFileSync(file, 'utf8'));
    return object(value, ['version', 'kind']) && value.version === 1 && ['local', 'channel'].includes(value.kind) ? value.kind : null;
  } catch { return null; }
}
function storeKind(service, kind) {
  const root = profileRoot(service); if (!root) return;
  try { atomicJSON(path.join(root, CHOICE_FILE), {version:1, kind}); } catch { /* The choice still holds for this run. */ }
}

// Foreground choice is not a QQ identity or permission. It never opens a channel.
class DesktopConversations {
  constructor({getSelection, retire, prepare = async () => {}, onChange = () => {}} = {}) {
    if ([getSelection, retire, prepare, onChange].some(fn => typeof fn !== 'function')) throw failure('invalid_request');
    Object.assign(this, {getSelection, retire, prepare, onChange});
    this.epoch = 0; this.pendingSelection = null; this.choices = new Map(); this.stored = new WeakMap(); this.closed = false;
  }
  current() { if (this.closed) return null; try { return this.getSelection(); } catch { return null; } }
  kind() {
    const current = this.current(); if (!current) return 'channel';
    const saved = this.choices.get(current.accountId);
    if (saved?.service === current.service) return saved.kind === 'local' ? 'local' : 'channel';
    // No choice made for this service in this run: its profile's stored choice, read once.
    if (!this.stored.has(current.service)) this.stored.set(current.service, storedKind(current.service) || 'channel');
    return this.stored.get(current.service);
  }
  isSelecting() {
    if (!this.pendingSelection) return false;
    const current = this.current();
    return current?.accountId === this.pendingSelection.accountId && current.service === this.pendingSelection.service;
  }
  retireCurrent(reason) { this.current()?.service?.resetChannelHistory?.(); this.retire(reason); }
  invalidate(reason) {
    this.epoch++;
    this.pendingSelection = null;
    this.retireCurrent(reason);
  }
  capture(value, keys) {
    if (!object(value, keys) || typeof value.accountId !== 'string') throw failure('invalid_request');
    const selected = this.current();
    if (!selected || selected.accountId !== value.accountId || !selected.service) throw failure('changed');
    return selected;
  }
  async select(value) {
    const selected = this.capture(value, ['accountId', 'kind']);
    if (!['local', 'channel'].includes(value.kind)) throw failure('invalid_request');
    const epoch = ++this.epoch;
    // Retirement can synchronously publish the old room with a fresh context ID.
    // Close admission before anything can observe that ID.
    this.pendingSelection = selected;
    const check = () => {
      const current = this.current();
      if (epoch !== this.epoch || current?.accountId !== selected.accountId || current?.service !== selected.service) throw failure('changed');
    };
    try {
      this.retireCurrent();
      check();
      await this.prepare(selected); check();
      // If there was no open room to retire, publish before waiting for startup.
      this.onChange();
      check();
      if (value.kind === 'local') {
        if (typeof selected.service.localStart !== 'function') throw failure('unavailable');
        // Lets a failed App reply be reported by class (key, quota, network...) instead of one sentence.
        observeLocalRunners(selected.service);
        await selected.service.localStart({assertCurrent:check}); check();
      }
      this.choices.set(selected.accountId, {service:selected.service, kind:value.kind});
      storeKind(selected.service, value.kind);
      return {kind:value.kind};
    } catch (error) {
      check();
      throw error;
    } finally {
      // A stale completion must neither unlock nor refresh a newer selection.
      if (this.epoch === epoch) {
        this.pendingSelection = null;
        this.onChange();
      }
    }
  }
  async stop(value) {
    const selected = this.capture(value, ['accountId']);
    if (typeof selected.service.localStop !== 'function') throw failure('unavailable');
    this.invalidate(); const epoch = this.epoch;
    await selected.service.localStop();
    const current = this.current();
    if (epoch !== this.epoch || current?.accountId !== selected.accountId || current?.service !== selected.service) throw failure('changed');
    this.onChange(); return {kind:this.kind()};
  }
  history(value) {
    const selected = this.capture(value, ['accountId', 'historyId']);
    if (typeof value.historyId !== 'string' || !value.historyId || value.historyId.length > 100) throw failure('invalid_request');
    if (this.kind() !== 'local') throw failure('changed');
    if (typeof selected.service.localHistory !== 'function') throw failure('unavailable');
    return selected.service.localHistory(value.historyId);
  }
  readDrawing(value) {
    const selected=this.capture(value,['accountId','historyId','messageId','latest']);
    if(typeof value.historyId!=='string'||!value.historyId||value.historyId.length>100)throw failure('invalid_request');
    const latest=Object.hasOwn(value,'latest');
    if(latest){
      if(value.latest!==true||Object.hasOwn(value,'messageId'))throw failure('invalid_request');
    }else if(typeof value.messageId!=='string'||!/^local-out:command:(?:drawing|sticker):[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value.messageId))throw failure('invalid_request');
    if(this.kind()!=='local'||this.isSelecting())throw failure('changed');
    const image=selected.service.localManager().readDrawing(value.historyId,latest?null:value.messageId);
    if(!image)throw failure('not_found');
    return {preview:'data:image/png;base64,'+image.bytes.toString('base64'),...(latest?{messageId:image.messageId}:{}),
      ...(image.sticker?{sticker:true,...(image.credit?{credit:image.credit}:{})}:{})};
  }
  channelHistory(value) {
    const selected = this.capture(value, ['accountId', 'historyId']);
    if (typeof value.historyId !== 'string' || !value.historyId || value.historyId.length > 100) throw failure('invalid_request');
    if (this.kind() !== 'channel') throw failure('changed');
    if (typeof selected.service.channelHistory !== 'function') throw failure('unavailable');
    return selected.service.channelHistory(value.historyId);
  }
  close() { this.closed = true; this.invalidate(); this.choices.clear(); }
}
module.exports = {DesktopConversations};
