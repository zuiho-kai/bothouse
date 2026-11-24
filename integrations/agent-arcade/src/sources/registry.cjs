'use strict';
// Drives the configured listen sources from a cheap once-a-second tick.
const fs = require('node:fs');
const path = require('node:path');
const {randomUUID} = require('node:crypto');
const {atomicJSON} = require('../core/files.cjs');
const {cleanText, digest} = require('./event.cjs');
const {validateSources, loadSources, saveSources, sourceOptions, displayTarget} = require('./config.cjs');
const {createIcsSource} = require('./ics.cjs');
const {createFolderSource} = require('./folder.cjs');
const {createFeedSource} = require('./feed.cjs');
const {isGroupPageName} = require('./group-page.cjs');

const MAX_IN_FLIGHT = 2, MAX_BACKOFF = 30 * 60000, POLL_TIMEOUT = 120000, MAX_EVENTS_PER_POLL = 100;
const MAX_CURSOR_BYTES = 1024 * 1024, MAX_STATE_BYTES = 24 * 1024 * 1024, STATE_VERSION = 1;
const DEFAULT_FACTORIES = Object.freeze({
  ics: (config, {now}) => createIcsSource({...sourceOptions(config), now}),
  folder: (config, {now}) => createFolderSource({...sourceOptions(config), now, captureGroupRoot:true}),
  feed: (config, {now}) => createFeedSource({...sourceOptions(config), now}),
});
const signature = config => digest(JSON.stringify([config.kind, Object.entries(sourceOptions(config)).sort(([a], [b]) => (a < b ? -1 : 1))]));
function groupSourceKind(config) {
  if (config.kind === 'ics') return 'groupCalendars';
  if (config.kind === 'folder') return 'groupFolders';
  if (config.kind === 'feed') return config.mode === 'page' ? 'groupPages' : 'groupFeeds';
  return null;
}
const MAX_GROUP_OCCURRENCES = 5000;
const isRootStamp = value => typeof value === 'string' && /^[0-9a-f]{32}$/.test(value);

function calendarOccurrences(previous, rows) {
  const current = new Map(), duplicates = new Set();
  for (const row of Array.isArray(rows) ? rows.slice(0, MAX_GROUP_OCCURRENCES) : []) {
    if (typeof row?.id !== 'string' || !/^[0-9a-f]{32}$/.test(row.id) || typeof row.title !== 'string' ||
        cleanText(row.title, 200) !== row.title || !Number.isSafeInteger(row.start) || row.start < 0 ||
        typeof row.allDay !== 'boolean' || typeof row.timeZone !== 'string' || !/^[A-Za-z0-9_+:/-]{1,64}$/.test(row.timeZone) ||
        typeof row.localTime !== 'string' || !(row.allDay ? /^\d{4}-\d\d-\d\d$/ : /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d$/).test(row.localTime)) continue;
    const {id, title, start, localTime, timeZone, allDay} = row;
    if (duplicates.has(id)) continue;
    if (current.delete(id)) { duplicates.add(id); continue; }
    const old = previous?.get(id);
    const next = {id, title, start, localTime, timeZone, allDay};
    current.set(id, old && Object.keys(next).every(key => old[key] === next[key]) ? old : Object.freeze(next));
  }
  return current;
}
function shortError(error) {
  const code = typeof error?.code === 'string' && /^[\w.-]{1,40}$/.test(error.code) ? error.code : 'error';
  // First line only: no stack, and no credentials if a message ever quotes a URL.
  const message = cleanText(String(error?.message ?? '').split(/\r?\n/, 1)[0].replace(/\/\/[^/\s@]*@/g, '//').replace(/([?&][\w.-]{1,40}=)[^&\s]+/g, '$1\u2026'), 160);
  return {code, message:message || code};
}

class SourceRegistry {
  #file; #stateFile; #publish; #publishCalendar; #now; #factories; #entries = new Map(); #active = new Set(); #closed = false; #problem = null; #savedState = null; #savedGroupIdentities = new Map();
  constructor({file, publish, publishCalendar = () => {}, now = Date.now, factories, stateFile} = {}) {
    if (typeof file !== 'string' || !path.isAbsolute(file)) throw new TypeError('The source list file must be an absolute path.');
    if ([publish, publishCalendar, now].some(callback => typeof callback !== 'function')) throw new TypeError('Source callbacks must be functions.');
    this.#file = file; this.#stateFile = stateFile || path.join(path.dirname(file), 'sources-state.json');
    this.#publish = publish; this.#publishCalendar = publishCalendar; this.#now = now; this.#factories = {...DEFAULT_FACTORIES, ...(factories || {})};
  }
  get problem() { return this.#problem; }

  load() {
    if (this.#closed) throw new Error('The source registry is closed.');
    const {sources, problem} = loadSources(this.#file);
    this.#problem = problem || null;
    this.#rebuild(sources, this.#readState());
    if ([...this.#entries.values()].some(entry => entry.groupIdentity)) this.#saveState();
    return {problem:this.#problem};
  }
  configure(nextConfig) {
    if (this.#closed) throw new Error('The source registry is closed.');
    const sources = saveSources(this.#file, validateSources(nextConfig));
    this.#problem = null;
    this.#rebuild(sources, null);
    this.#saveState();
    return this.snapshot();
  }
  snapshot() {
    return [...this.#entries.values()].map(({config, lastCheckedAt, lastEventAt, lastError}) => ({
      id:config.id, kind:config.kind, name:config.name, enabled:config.enabled, notify:config.notify,
      ...(config.kind === 'feed' ? {mode:config.mode ?? 'feed'} : {}),
      lastCheckedAt, lastEventAt, lastError:lastError ? {...lastError} : null, target:displayTarget(config),
    }));
  }
  #groupSource(id, kind) {
    const entry = this.#entries.get(id);
    const identity = entry?.groupIdentity;
    if (!identity || groupSourceKind(entry.config) !== kind || this.#savedGroupIdentities.get(id) !== identity) return null;
    const folder = kind === 'groupFolders', page = kind === 'groupPages';
    const rootStamp = entry.folderRoot;
    const available = () => !this.#closed && this.#entries.get(id) === entry &&
      entry.config.enabled && !!entry.source && entry.groupIdentity === identity && this.#savedGroupIdentities.get(id) === identity &&
      (!folder || (entry.folderProven && !entry.folderBaselining && entry.folderRoot === rootStamp)) &&
      (!page || isGroupPageName(entry.config.name));
    const isCurrent = () => available() && (!folder || entry.source.groupRootStamp?.() === rootStamp);
    const target = folder ? path.basename(entry.config.dir) || entry.config.name : page ? id : displayTarget(entry.config);
    return {id, identity, name:entry.config.name, target, enabled:available(), isCurrent,
      ...(kind === 'groupCalendars' ? {occurrence:key => isCurrent() ? entry.calendarOccurrences?.get(key) || null : null} : {})};
  }
  groupFeed(id) {
    return this.#groupSource(id, 'groupFeeds');
  }
  groupFeeds() {
    return [...this.#entries.keys()].map(id => this.groupFeed(id)).filter(Boolean);
  }
  groupCalendar(id) {
    return this.#groupSource(id, 'groupCalendars');
  }
  groupCalendars() {
    return [...this.#entries.keys()].map(id => this.groupCalendar(id)).filter(Boolean);
  }
  groupFolder(id) {
    return this.#groupSource(id, 'groupFolders');
  }
  groupFolders() {
    return [...this.#entries.keys()].map(id => this.groupFolder(id)).filter(Boolean);
  }
  groupPage(id) {
    return this.#groupSource(id, 'groupPages');
  }
  groupPages() {
    return [...this.#entries.keys()].map(id => this.groupPage(id)).filter(Boolean);
  }
  ownerCalendarCurrent(id, eventId) {
    const entry = this.#entries.get(id);
    return !!(entry?.config.enabled && entry.ownerCalendarIds?.has(eventId));
  }
  tick() {
    try {
      if (this.#closed) return;
      const now = this.#now();
      for (const run of this.#active) if (now - run.startedAt >= POLL_TIMEOUT) this.#fail(run, Object.assign(new Error('The check took too long.'), {code:'timeout'}), true);
      const due = [...this.#entries.values()].filter(e => e.source && e.config.enabled && !e.run && e.nextAt <= now).sort((a, b) => a.nextAt - b.nextAt);
      for (const entry of due) { if (this.#active.size >= MAX_IN_FLIGHT) break; this.#start(entry, now); }
    } catch { /* tick must never throw into the app timer */ }
  }
  close() {
    this.#closed = true;
    for (const entry of this.#entries.values()) this.#drop(entry);
    this.#entries.clear();
  }

  #start(entry, now) {
    const run = {entry, controller:new AbortController(), startedAt:now};
    entry.run = run; this.#active.add(run);
    let pending;
    try { pending = Promise.resolve(entry.source.poll(entry.cursor, run.controller.signal)); } catch (error) { pending = Promise.reject(error); }
    pending.then(result => this.#succeed(run, result), error => this.#fail(run, error, false)).catch(() => {});
  }
  #finish(run) {
    if (!this.#active.delete(run)) return false;
    if (run.entry.run === run) run.entry.run = null;
    return !this.#closed && !run.controller.signal.aborted && this.#entries.get(run.entry.config.id) === run.entry;
  }
  #succeed(run, result) {
    if (!this.#finish(run)) return;
    const entry = run.entry, now = this.#now();
    if (!result || typeof result !== 'object' || !Array.isArray(result.events)) return this.#record(entry, {code:'invalid_result', message:'The source returned an invalid result.'}, now);
    let cursorJson = null;
    try { cursorJson = result.cursor === undefined || result.cursor === null ? null : JSON.stringify(result.cursor); } catch { /* unserializable */ }
    if (cursorJson !== null && Buffer.byteLength(cursorJson) > MAX_CURSOR_BYTES) cursorJson = null;
    if (result.cursor != null && cursorJson === null) return this.#record(entry, {code:'invalid_result', message:'The source returned an invalid or oversized cursor.'}, now);
    const changed = cursorJson !== entry.cursorJson, previousCursor = entry.cursor, previousJson = entry.cursorJson;
    entry.cursor = cursorJson === null ? null : JSON.parse(cursorJson); entry.cursorJson = cursorJson;
    const folder = entry.config.kind === 'folder';
    const previousFolder = folder && {groupIdentity:entry.groupIdentity, folderRoot:entry.folderRoot,
      folderBaselining:entry.folderBaselining};
    const publishFolder = folder && this.#observeFolder(entry, result.groupFolder);
    // Commit the folder identity and its baseline in the same write as the cursor.
    // The successful observation may only be published after durable progress.
    if ((changed || folder) && !this.#saveState()) {
      entry.cursor = previousCursor; entry.cursorJson = previousJson;
      if (folder) Object.assign(entry, previousFolder);
      return this.#record(entry, {code:'state_unavailable', message:'Reminder progress could not be saved. Check the data folder and retry.'}, now);
    }
    const calendar = entry.config.kind === 'ics';
    if (calendar) {
      entry.calendarOccurrences = calendarOccurrences(entry.calendarOccurrences, result.groupCalendar?.current);
      entry.ownerCalendarIds = new Set((Array.isArray(result.ownerCalendarIds) ? result.ownerCalendarIds : [])
        .slice(0, 5000).filter(id => typeof id === 'string' && /^[0-9a-f]{32}$/.test(id)));
    }
    const newCalendarIds = new Set(calendar && Array.isArray(result.groupCalendar?.newIds) ?
      result.groupCalendar.newIds.slice(0, MAX_EVENTS_PER_POLL) : []);
    const source = this.#groupSource(entry.config.id, groupSourceKind(entry.config));
    const identity = source?.enabled && (!folder || publishFolder && source.isCurrent()) ? source.identity : null;
    for (const event of result.events.slice(0, MAX_EVENTS_PER_POLL)) {
      if (!event || typeof event !== 'object' || typeof event.id !== 'string') continue;
      entry.lastEventAt = now;
      const occurrence = newCalendarIds.delete(event.id) ? entry.calendarOccurrences?.get(event.id) : null;
      try { Promise.resolve(this.#publish(event, {...entry.config}, identity, occurrence)).catch(() => {}); } catch { /* one bad delivery must not stop the rest */ }
    }
    // A shifted group occurrence can be new without generating an owner event.
    if (calendar && source?.enabled) for (const id of newCalendarIds) {
      const occurrence = source.occurrence(id);
      if (!occurrence) continue;
      try { Promise.resolve(this.#publishCalendar(occurrence, {...entry.config}, source.identity, now)).catch(() => {}); } catch { /* isolated subscriber */ }
    }
    entry.failures = 0; entry.lastError = null; entry.lastCheckedAt = now; entry.nextAt = now + entry.intervalMs;
  }
  #observeFolder(entry, evidence) {
    const {rootStamp, baselineComplete} = evidence || {};
    entry.folderProven = isRootStamp(rootStamp) && typeof baselineComplete === 'boolean' &&
      entry.source.groupRootStamp?.() === rootStamp;
    if (!entry.folderProven) {
      entry.folderBaselining = true;
      return false;
    }
    if (entry.folderRoot !== rootStamp) {
      if (entry.folderRoot) entry.groupIdentity = randomUUID();
      entry.folderRoot = rootStamp;
      entry.folderBaselining = true;
    }
    // Old removes and new adds still go to the owner during catch-up. Even the
    // batch that completes a new root's baseline cannot enter the group queue.
    if (!entry.folderBaselining) return true;
    entry.folderBaselining = !baselineComplete;
    return false;
  }
  #fail(run, error, abort) {
    const live = this.#finish(run);
    if (abort) run.controller.abort();
    if (live) this.#record(run.entry, shortError(error), this.#now());
  }
  #record(entry, error, now) {
    entry.folderProven = false;
    entry.calendarOccurrences?.clear();
    entry.ownerCalendarIds?.clear();
    entry.failures++; entry.lastCheckedAt = now; entry.lastError = {...error, at:now};
    entry.nextAt = now + Math.min(MAX_BACKOFF, entry.intervalMs * 2 ** Math.min(entry.failures, 20));
  }
  #drop(entry) {
    if (entry.run) { const run = entry.run; this.#active.delete(run); entry.run = null; run.controller.abort(); }
    try { entry.source?.close?.(); } catch { /* best effort */ }
    entry.source = null;
  }
  #rebuild(sources, restored) {
    const now = this.#now(), next = new Map();
    for (const config of sources) {
      const sig = signature(config), old = this.#entries.get(config.id), kind = groupSourceKind(config);
      // The displayed page name is part of its group grant. Renaming the
      // label revokes that grant while keeping the personal URL cursor.
      const groupSig = kind === 'groupPages' ? digest(JSON.stringify([sig, config.name])) : sig;
      if (old && old.sig === sig && old.source && config.enabled) {
        if (old.groupSig !== groupSig) {
          old.groupSig = groupSig;
          old.groupIdentity = randomUUID();
        }
        // Same target: keep the instance, its cursor, schedule and any poll in flight.
        old.config = config; next.set(config.id, old); this.#entries.delete(config.id);
        continue;
      }
      const restoredCursor = restored?.cursors[config.id], restoredGroup = restored?.groups[config.id];
      const saved = old && old.sig === sig ? old : restoredCursor?.sig === sig ? restoredCursor : null;
      const group = old?.groupSig === groupSig ? old : restoredGroup?.sig === groupSig ? restoredGroup : null;
      const folderRoot = isRootStamp(group?.folderRoot) ? group.folderRoot : null;
      const cursorJson = saved?.cursorJson ?? null;
      const entry = {config, sig, groupSig, source:null, intervalMs:60000, cursor:cursorJson === null ? null : JSON.parse(cursorJson), cursorJson,
        groupIdentity:kind ? group?.groupIdentity || group?.identity || randomUUID() : null,
        folderRoot, folderBaselining:!folderRoot || group.folderBaselining !== false, folderProven:false,
        nextAt:now, run:null, failures:0, lastCheckedAt:old?.sig === sig ? old.lastCheckedAt : null,
        lastEventAt:old?.sig === sig ? old.lastEventAt : null, lastError:null};
      if (config.enabled) {
        try {
          const source = this.#factories[config.kind](config, {now:this.#now});
          if (!source || typeof source.poll !== 'function' || !Number.isInteger(source.intervalMs) || source.intervalMs < 1000) throw Object.assign(new Error('The source could not be created.'), {code:'invalid_source'});
          entry.source = source; entry.intervalMs = source.intervalMs;
        } catch (error) { entry.lastError = {...shortError(error), at:now}; }
      }
      next.set(config.id, entry);
    }
    for (const entry of this.#entries.values()) this.#drop(entry);
    this.#entries = next;
  }
  #readState() {
    try {
      if (fs.statSync(this.#stateFile).size > MAX_STATE_BYTES) return null;
      const state = JSON.parse(fs.readFileSync(this.#stateFile, 'utf8'));
      if (!state || state.version !== STATE_VERSION || !state.cursors || typeof state.cursors !== 'object' || Array.isArray(state.cursors)) return null;
      const cursors = Object.create(null), groups = Object.create(null);
      for (const [id, item] of Object.entries(state.cursors)) {
        if (!item || typeof item.sig !== 'string' || item.cursor === undefined || item.cursor === null) continue;
        const cursorJson = JSON.stringify(item.cursor);
        if (Buffer.byteLength(cursorJson) <= MAX_CURSOR_BYTES) cursors[id] = {sig:item.sig, cursorJson};
      }
      for (const saved of [state.groupFeeds, state.groupCalendars, state.groupFolders, state.groupPages]) {
        if (!saved || typeof saved !== 'object' || Array.isArray(saved)) continue;
        for (const [id, item] of Object.entries(saved)) {
          if (/^[0-9a-f]{32}$/.test(item?.sig) && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(item?.identity)) groups[id] = item;
        }
      }
      return {cursors, groups};
    } catch { return null; }
  }
  #saveState() {
    const cursors = Object.create(null), groups = {
      groupFeeds:Object.create(null), groupCalendars:Object.create(null), groupFolders:Object.create(null), groupPages:Object.create(null),
    };
    const identities = new Map();
    for (const [id, entry] of this.#entries) {
      if (entry.cursorJson !== null) cursors[id] = {sig:entry.sig, cursor:entry.cursor};
      if (entry.groupIdentity) {
        const kind = groupSourceKind(entry.config);
        const group = {sig:entry.groupSig, identity:entry.groupIdentity};
        if (kind === 'groupFolders') Object.assign(group, {folderRoot:entry.folderRoot, folderBaselining:entry.folderBaselining});
        groups[kind][id] = group;
        identities.set(id, entry.groupIdentity);
      }
    }
    const state = {version:STATE_VERSION, cursors};
    for (const [key, entries] of Object.entries(groups)) if (Object.keys(entries).length) state[key] = entries;
    const json = JSON.stringify(state);
    if (json === this.#savedState) return true;
    // Delivery must stop if durable progress cannot be recorded, otherwise a
    // restart can repeat an already delivered desktop notification.
    try {
      atomicJSON(this.#stateFile, state);
      this.#savedState = json;
      this.#savedGroupIdentities = identities;
      return true;
    } catch { return false; }
  }
}

module.exports = {SourceRegistry, DEFAULT_FACTORIES};
