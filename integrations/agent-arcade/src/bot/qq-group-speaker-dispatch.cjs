'use strict';

const fs = require('node:fs');
const {atomicJSON} = require('../core/files.cjs');
const {DEFAULT_FLOW} = require('./social-flow.cjs');

const BALLOT_WINDOW_MS = 1000;
const EVENT_WINDOW_MS = 60_000;
const MAX_EVENTS = 128;
const MAX_SETTINGS = 120;
const ID = /^\d{5,15}$/;
const PROFILE = /^[a-zA-Z0-9-]{1,64}$/;
const EVENT = /^[a-f0-9]{64}$/;
const empty = Object.freeze({revision: 0, enabled: false});
const fail = code => Object.assign(Error('QQ group reply dispatch ('+code+').'), {code});

function load(file) {
  try {
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.size > 32_000) throw Error();
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (data?.version !== 1 || !Array.isArray(data.groups) || data.groups.length > MAX_SETTINGS) throw Error();
    const rows = new Map();
    for (const {groupId, profileId, accountId, revision, enabled} of data.groups) {
      if (typeof groupId !== 'string' || typeof accountId !== 'string' || typeof profileId !== 'string' ||
          !ID.test(groupId) || !ID.test(accountId) || !PROFILE.test(profileId) || rows.has(groupId) ||
          !Number.isSafeInteger(revision) || revision < 1 || typeof enabled !== 'boolean') throw Error();
      rows.set(groupId, {profileId, accountId, revision, enabled});
    }
    return rows;
  } catch (error) {
    if (error.code === 'ENOENT') return new Map();
    throw fail('group_dispatch_unavailable');
  }
}

class QQGroupSpeakerDispatch {
  constructor({file, now = Date.now}) {
    Object.assign(this, {file, now});
    this.settings = null;
    this.turns = new Map();
    this.coverage = new Map();
    this.addresses = new Map();
    this.mediaClaims = new Map();
  }
  read(groupId) {
    this.settings ??= load(this.file);
    return this.settings.get(groupId) || empty;
  }
  save(groupId, expected, {profileId, accountId, enabled}) {
    if (this.read(groupId) !== expected) throw fail('group_dispatch_changed');
    const revision = expected.revision + 1;
    if (!Number.isSafeInteger(revision)) throw fail('group_dispatch_unavailable');
    const updated = new Map(this.settings);
    updated.set(groupId, {profileId, accountId, enabled, revision});
    if (updated.size > MAX_SETTINGS) throw fail('group_dispatch_unavailable');
    try {
      atomicJSON(this.file, {version: 1, groups: [...updated].map(([id, row]) => ({groupId: id, ...row}))});
    } catch {
      throw fail('group_dispatch_unavailable');
    }
    this.settings = updated;
    const pending = this.turns.get(groupId);
    for (const turn of pending?.values() || []) this.finish(turn, null);
    this.turns.delete(groupId);
    this.coverage.delete(groupId);
    this.addresses.delete(groupId);
    this.mediaClaims.delete(groupId);
  }
  finish(turn, winner) {
    if (turn.finished) return;
    turn.finished = true;
    clearTimeout(turn.timer);
    turn.controller.abort();
    turn.ballots.clear();
    turn.text = '';
    turn.resolve(winner);
  }
  close() {
    for (const events of this.turns.values()) {
      for (const turn of events.values()) this.finish(turn, null);
    }
    this.turns.clear();
    this.coverage.clear();
    this.addresses.clear();
    this.mediaClaims.clear();
  }
  liveEvent({eventKey, createdAt}, now) {
    return typeof eventKey === 'string' && EVENT.test(eventKey) && Number.isSafeInteger(createdAt) &&
      createdAt >= now-EVENT_WINDOW_MS && createdAt <= now+60_000;
  }
  hasTurn({groupId,eventKey}){
    const turn=this.turns.get(groupId)?.get(eventKey);
    return !!turn&&turn.expires>=this.now();
  }
  getMediaClaims(groupId, now) {
    let claims = this.mediaClaims.get(groupId);
    if (!claims) this.mediaClaims.set(groupId, claims = new Map());
    for (const [key, entry] of claims) if (entry.expires < now) claims.delete(key);
    return claims;
  }
  reserveMedia(event) {
    const now = this.now();
    if (!this.liveEvent(event, now)) return null;
    const claims = this.getMediaClaims(event.groupId, now), key = event.kind+':'+event.eventKey;
    if (claims.has(key)) return claims.get(key);
    if (claims.size >= MAX_EVENTS) return null;
    const row = {kind:event.kind, eventKey:event.eventKey, accountId:event.accountId, from:event.from, createdAt:event.createdAt,
      observedAt:now, expires:event.createdAt+EVENT_WINDOW_MS, claimed:false, photo:event.photo};
    claims.set(key,row);
    return row;
  }
  claimVoice(event) {
    const row = this.reserveMedia(event);
    if (!row || row.claimed || row.recalled || row.accountId !== event.accountId) return false;
    // This is an exclusive admission, including failed or cancelled attempts.
    // A later bridge never inherits raw audio or a transcript from the first.
    row.claimed = true;
    row.observedAt = this.now();
    return true;
  }
  recallVoice(event) {
    const row = this.mediaClaims.get(event.groupId)?.get('voice:'+event.eventKey);
    if (row?.accountId === event.accountId) row.recalled = true;
  }
  photoForVoice(event, targets, photoState) {
    const now = this.now();
    if (!this.liveEvent(event, now) || !this.mediaClaims.has(event.groupId)) return null;
    const claims = this.getMediaClaims(event.groupId, now);
    const known = claims.get('voice:'+event.eventKey);
    if (known) return known.photo || null;

    const latest = this.latestMedia(event, claims);
    // The next recording can continue a recent recording already bound to
    // this photo. An independent or differently addressed turn has no link.
    const photo = latest?.kind === 'photo' ? latest : latest?.photo;
    if (!photo || photo.recalled || targets.length && (targets.length !== 1 || targets[0] !== photo.accountId)) return null;
    const address = latest.textAddress || photo.textAddress;
    if (!targets.length && address && address.accountId !== photo.accountId) return null;
    const pending = photoState(photo);
    if (pending === false || !pending && now-photo.observedAt > DEFAULT_FLOW.maxBatchMs) return null;
    return photo;
  }
  latestMedia(event, claims) {
    let latest;
    for (const row of claims.values()) {
      if (row.kind && !row.recalled && row.from === event.from && row.createdAt <= event.createdAt &&
          (!latest || row.createdAt >= latest.createdAt)) latest = row;
    }
    return latest;
  }
  observePhoto(event, observer, nativeId, attachable) {
    const row = this.reserveMedia(event);
    if (row && !row.recalled) {
      row.attachable = attachable;
      row.nativeIds ??= new Map();
      if (!row.nativeIds.has(observer)) row.nativeIds.set(observer,nativeId);
    }
    return row && !row.recalled ? row.eventKey : null;
  }
  recallPhoto({groupId, accountId, from, id}) {
    for (const row of this.mediaClaims.get(groupId)?.values() || []) {
      if (row.kind !== 'photo' || row.from !== from || row.nativeIds?.get(accountId) !== id) continue;
      row.recalled = true;
      this.observe('recall',{groupId, eventKey:row.eventKey, createdAt:row.createdAt},[]);
    }
  }
  mediaFollowup(event, pendingState, named) {
    const now = this.now();
    if (!this.liveEvent(event, now)) return null;
    const claims = this.mediaClaims.get(event.groupId);
    if (!claims) return null;
    this.getMediaClaims(event.groupId, now);
    const key = 'text:'+event.eventKey, known = claims.get(key);
    if (known && !known.source.recalled) return known;
    const latest = this.latestMedia(event, claims);
    if (!latest || latest.kind === 'photo' && !latest.attachable) return null;
    const address = latest.textAddress;
    const followsAddress = address && event.createdAt >= address.createdAt;
    const addressActive = followsAddress && now-address.lastAt <= DEFAULT_FLOW.debounceMs &&
      now-address.startedAt <= DEFAULT_FLOW.maxBatchMs;
    if (!addressActive) {
      const pending = pendingState(latest);
      // A completed photo stops accepting implicit follow-ups immediately.
      // A bridge might observe it before the named role has queued its copy.
      if (latest.kind === 'photo' && pending === false) return null;
      if (!pending && now-latest.observedAt > DEFAULT_FLOW.maxBatchMs) return null;
    }
    let accountId = latest.accountId;
    if (named) {
      const startedAt = addressActive && named === address.accountId ? address.startedAt : now;
      if (!address || followsAddress) {
        latest.textAddress = {accountId:named,createdAt:event.createdAt,startedAt,lastAt:now};
      }
      accountId = named;
    } else if (addressActive) {
      address.lastAt = now;
      accountId = address.accountId;
    } else if (followsAddress) {
      // A finished text segment does not become part of the earlier media
      // task. Other companions can treat the new text as a fresh group turn.
      accountId = null;
    }
    const assignment = {accountId, source:latest, expires:event.createdAt+EVENT_WINDOW_MS};
    if (claims.size < MAX_EVENTS) claims.set(key,assignment);
    return assignment;
  }
  coveredEvents(groupId, now) {
    let covered = this.coverage.get(groupId);
    if (!covered) this.coverage.set(groupId, covered = new Map());
    for (const [key, entry] of covered) if (entry.expires < now) covered.delete(key);
    return covered;
  }
  groupAddresses(groupId, now) {
    let records = this.addresses.get(groupId);
    if (!records) this.addresses.set(groupId, records = new Map());
    for (const [key, record] of records) if (record.expires < now) records.delete(key);
    return records;
  }
  rememberAddress(event, now, covered) {
    const {groupId, eventKey, createdAt, targets, addressKey, addressAt, addressKind, reference, accountId} = event;
    const records = this.groupAddresses(groupId, now);
    const previous = records.get(eventKey);
    if (!targets.length || !addressKey || covered.get(addressKey)?.recalled) return previous?.targets || [];
    const direct = addressKey === eventKey;
    if (addressKind === 'quote' && previous?.kind === 'mention') return previous.targets;
    if (previous && previous.kind === addressKind && !direct && (previous.direct || previous.at >= addressAt)) return previous.targets;
    if (!previous && records.size >= MAX_EVENTS) return targets;
    const expires = createdAt+EVENT_WINDOW_MS;
    if (previous?.kind === 'quote' && addressKind === 'quote' &&
        (previous.conflict || previous.accountId !== accountId)) {
      records.set(eventKey, {targets:[], kind:'quote', conflict:true, expires});
      this.updateAddress(groupId, eventKey, []);
      return [];
    }
    records.set(eventKey, {targets, addressKey, at:addressAt, direct, kind:addressKind,
      ...(addressKind === 'quote' ? {accountId, referenceId:reference.id} : {}), expires});
    this.updateAddress(groupId, eventKey, targets);
    return targets;
  }
  updateAddress(groupId, eventKey, targets) {
    const turn = this.turns.get(groupId)?.get(eventKey);
    if (turn && !turn.finished) {
      turn.targets = targets;
      this.consider(turn);
    }
  }
  forgetQuoteOwner({groupId, accountId, referenceId}) {
    const records = this.addresses.get(groupId);
    for (const [key, row] of records || []) {
      if (row.kind !== 'quote' || row.accountId !== accountId || row.referenceId !== referenceId) continue;
      records.delete(key);
      this.updateAddress(groupId, key, []);
    }
  }
  eligible(turn) {
    const addressed = turn.roster.filter(row => turn.targets.includes(row.id));
    return addressed.length ? addressed : turn.roster;
  }
  consider(turn) {
    if (turn.finished || turn.settling) return;
    const eligible = this.eligible(turn);
    if (eligible.every(row => turn.ballots.has(row.id))) {
      void this.settle(turn);
    } else if (eligible.some(row => turn.ballots.get(row.id)?.willing)) {
      turn.timer ??= setTimeout(() => {void this.settle(turn);}, BALLOT_WINDOW_MS);
    } else {
      clearTimeout(turn.timer);
      turn.timer = null;
    }
  }
  stopCovered(groupId, eventKey) {
    const turn = this.turns.get(groupId)?.get(eventKey);
    if (!turn) return;
    turn.blocked = true;
    turn.cancelWinner?.();
    turn.cancelWinner = null;
    this.finish(turn, null);
  }
  observe(action, event, earlier) {
    const now = this.now();
    if (!this.liveEvent(event, now)) return;
    const {groupId, eventKey, createdAt} = event;
    const covered = this.coveredEvents(groupId, now);
    if (action === 'recall') {
      const previous = covered.get(eventKey);
      if (previous || covered.size < MAX_EVENTS) {
        covered.set(eventKey, {by: previous?.by || new Set(), recalled:true, expires: createdAt+EVENT_WINDOW_MS});
      }
      this.stopCovered(groupId, eventKey);
      const turns = this.turns.get(groupId);
      const records = this.groupAddresses(groupId, now);
      for (const [key, address] of records) {
        if (key !== eventKey && address.addressKey !== eventKey) continue;
        records.delete(key);
        this.updateAddress(groupId, key, []);
      }
      for (const [key, entry] of covered) {
        if (!entry.by.delete(eventKey) || entry.by.size || entry.recalled) continue;
        covered.delete(key);
        const turn = turns?.get(key);
        if (turn?.blocked && !turn.claimed && !turn.scoreRequested) turns.delete(key);
      }
      return;
    }
    if (covered.get(eventKey)?.recalled) return;
    this.rememberAddress(event, now, covered);
    // The latest native anchor identifies the shared answer even when another
    // bridge queued these exact source messages as separate turns.
    for (const previous of earlier) {
      if (previous.eventKey === eventKey || !this.liveEvent(previous, now)) continue;
      let entry = covered.get(previous.eventKey);
      if (!entry) {
        if (covered.size >= MAX_EVENTS) break;
        entry = {by:new Set(), expires:previous.createdAt+EVENT_WINDOW_MS};
        covered.set(previous.eventKey, entry);
      }
      entry.by.add(eventKey);
      this.stopCovered(groupId, previous.eventKey);
    }
  }
  async settle(turn) {
    if (turn.finished || turn.settling) return;
    turn.settling = true;
    clearTimeout(turn.timer);
    const willing = () => {
      const eligible = this.eligible(turn);
      return [...turn.ballots].filter(([id, row]) => row.willing && !row.signal.aborted && eligible.some(role => role.id === id)).map(([id]) => id);
    };
    const original = willing();
    let winner = original[0] || null;
    try {
      if (turn.scorer && original.length > 1 && turn.text.trim()) {
        turn.scoreRequested = true;
        const options = turn.roster.filter(row => original.includes(row.id));
        const choice = await turn.scorer.choose({
          group: {members: options.map(row => row.id)}, roster: options,
          incoming: turn.text, signal: turn.controller.signal, publicGroup: true,
        });
        const available = willing();
        winner = available.includes(choice?.speakers?.[0]) && choice.reason === 'model' ? choice.speakers[0] : available[0] || null;
      }
    } catch {
      winner = willing()[0] || null;
    } finally {
      this.finish(turn, winner);
    }
  }
  vote(event, willing, signal, cancelWinner, {roster, scorer}) {
    const {groupId, eventKey, createdAt, accountId, text} = event;
    const now = this.now();
    if (!this.liveEvent(event, now)) return false;
    const covered = this.coveredEvents(groupId, now);
    if (covered.has(eventKey)) return false;
    const targets = this.rememberAddress(event, now, covered);
    let events = this.turns.get(groupId);
    if (!events) this.turns.set(groupId, events = new Map());
    for (const [key, turn] of events) {
      if (turn.expires < now) {
        this.finish(turn, null);
        events.delete(key);
      }
    }
    // The shared fingerprint can collide within a OneBot timestamp second.
    // Only the sole addressee's own bridge can distinguish its native IDs.
    // Keep the first ballot at the shared key for delayed copies from peers.
    const first = events.get(eventKey);
    const addressedSourceId = event.addressedSourceId;
    const distinct = addressedSourceId && first?.addressedAccount === accountId &&
      first.addressedSourceId !== addressedSourceId;
    const key = distinct ? eventKey + ':' + addressedSourceId : eventKey;
    let turn = distinct ? events.get(key) : first;
    if (!turn) {
      if (events.size >= MAX_EVENTS) return false;
      let resolve;
      const result = new Promise(done => {resolve = done;});
      turn = {resolve, result, expires: createdAt+EVENT_WINDOW_MS, roster, targets, text, scorer,
        ballots: new Map(), controller: new AbortController()};
      if (addressedSourceId) {
        turn.addressedAccount = accountId;
        turn.addressedSourceId = addressedSourceId;
      }
      events.set(key, turn);
    }
    if (!turn.roster.some(row => row.id === accountId)) return false;
    const qualified = willing && this.eligible(turn).some(row => row.id === accountId);
    if (!turn.finished && !turn.settling && !turn.ballots.has(accountId)) {
      turn.ballots.set(accountId, {willing:qualified, signal});
      this.consider(turn);
    }
    if (!qualified || signal.aborted) return false;
    return new Promise(resolve => {
      const cancel = () => {
        resolve(false);
        if ([...turn.ballots.values()].every(row => !row.willing || row.signal.aborted)) this.finish(turn, null);
      };
      const voted = winner => {
        signal.removeEventListener('abort', cancel);
        if (winner !== accountId || signal.aborted || turn.claimed || turn.blocked) return resolve(false);
        turn.claimed = true;
        turn.cancelWinner = cancelWinner;
        resolve(true);
      };
      signal.addEventListener('abort', cancel, {once:true});
      void turn.result.then(voted);
    });
  }
}

module.exports = {QQGroupSpeakerDispatch};
