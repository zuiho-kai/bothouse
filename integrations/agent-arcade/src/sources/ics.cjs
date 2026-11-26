'use strict';
// Minimal RFC 5545 reader for reminders: VEVENT starts and VTODO due times from
// one local .ics file or one https calendar URL. Calendar text is data only.
const fs = require('node:fs');
const path = require('node:path');
const {makeEvent, isSourceId, cleanText, digest} = require('./event.cjs');
const {fetchBounded, httpsUrl, displayUrl} = require('./feed.cjs');
const {absolutePath} = require('./folder.cjs');

const MINUTE = 60000, DAY = 86400000;
const MAX_BYTES = 2 * 1024 * 1024, MAX_COMPONENTS = 5000, MAX_INSTANCES = 500, MAX_STEPS = 20000, MAX_SEEN = 500, MAX_EVENTS = 50;
const WINDOW_BACK = DAY, WINDOW_AHEAD = 31 * DAY, GRACE = 5 * MINUTE, FETCH_INTERVAL = 15 * MINUTE, EXPANSION_TTL = 60 * MINUTE;
const OWNER_LIVE_GRACE = GRACE + 30 * MINUTE, MAX_OWNER_IDS = MAX_COMPONENTS * 4;
const WEEKDAYS = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];
const OCCURRENCE_FIELDS = new Set(['UID', 'DTSTART', 'RRULE', 'RECURRENCE-ID']);
const UNSHIFTED = [{original:-Infinity, ownerShift:0, groupShift:0}];
const fail = (code, message) => Object.assign(new Error(message || code), {code});
const formatters = new Map();

function formatter(zone) {
  let format = formatters.get(zone);
  if (!format) {
    format = new Intl.DateTimeFormat('en-US', {timeZone:zone, hourCycle:'h23', year:'numeric', month:'2-digit', day:'2-digit',
      hour:'2-digit', minute:'2-digit', second:'2-digit'});
    if (formatters.size >= 64) formatters.delete(formatters.keys().next().value);
    formatters.set(zone, format);
  }
  return format;
}
function validZone(zone) {
  if (typeof zone !== 'string' || !zone || zone.length > 64) return null;
  try { return formatter(zone).resolvedOptions().timeZone; } catch { return null; }
}
// "Wall" values are local calendar fields packed with Date.UTC, so date
// arithmetic stays in whole local days across DST changes.
function offsetAt(zone, at) {
  const p = {};
  for (const part of formatter(zone).formatToParts(at)) p[part.type] = Number(part.value);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(at / 1000) * 1000;
}
function wallToEpoch(wall, zone) {
  if (zone === 'UTC') return wall;
  let at = wall - offsetAt(zone, wall);
  const second = offsetAt(zone, at);
  if (wall - second !== at) at = wall - second;
  return at;
}

function unescapeText(value) {
  return value.replace(/\\([\\;,nN])/g, (match, c) => (c === 'n' || c === 'N' ? '\n' : c));
}
function parseLine(line) {
  let quoted = false, colon = -1;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') quoted = !quoted;
    else if (c === ':' && !quoted) { colon = i; break; }
  }
  if (colon < 1) return null;
  const head = line.slice(0, colon).split(';'), params = {};
  let repeatedRange = false;
  for (const part of head.slice(1)) {
    const eq = part.indexOf('=');
    if (eq > 0) {
      const name = part.slice(0, eq).toUpperCase();
      if (name === 'RANGE' && Object.hasOwn(params, name)) repeatedRange = true;
      params[name] = part.slice(eq + 1).replace(/^"|"$/g, '');
    }
  }
  return {name:head[0].toUpperCase(), params, repeatedRange, value:line.slice(colon + 1)};
}
function parseDate(value, params, defaultZone) {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/.exec(String(value).trim());
  if (!m) return null;
  const allDay = m[4] === undefined;
  const wall = Date.UTC(+m[1], +m[2] - 1, +m[3], allDay ? 0 : +m[4], allDay ? 0 : +m[5], allDay ? 0 : +m[6]);
  if (!Number.isFinite(wall)) return null;
  // An unknown TZID (for example a Windows zone name) falls back to the source's zone.
  const zone = m[7] ? 'UTC' : (!allDay && params?.TZID && validZone(params.TZID)) || defaultZone;
  return {wall, zone, allDay, floating:!m[7]};
}
function parseRule(value, defaultZone) {
  const parts = {};
  let repeated = false;
  for (const item of String(value).split(';')) {
    const eq = item.indexOf('=');
    if (eq <= 0) { repeated = true; continue; }
    const name = item.slice(0, eq).toUpperCase();
    if (Object.hasOwn(parts, name)) repeated = true;
    parts[name] = item.slice(eq + 1);
  }
  const freq = String(parts.FREQ || '').toUpperCase();
  if (!['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'].includes(freq)) return null;
  const int = (text, max) => (/^\d{1,6}$/.test(text || '') && +text >= 1 ? Math.min(+text, max) : null);
  const interval = int(parts.INTERVAL, 1000);
  const rule = {freq, interval:interval || 1, count:int(parts.COUNT, 100000), until:null, days:null, ordinalWeekday:null};
  if (parts.UNTIL) rule.until = parseDate(parts.UNTIL, null, defaultZone);
  const selectors = Object.keys(parts).filter(key => !['FREQ', 'INTERVAL', 'COUNT', 'UNTIL'].includes(key));
  const weekStart = parts.WKST === undefined || parts.WKST.toUpperCase() === 'MO';
  let selectorsSupported = selectors.length === 0;
  if (freq === 'WEEKLY' && parts.BYDAY) {
    const days = [...new Set(parts.BYDAY.split(',').map(x => WEEKDAYS.indexOf(x.trim().toUpperCase().replace(/^[+-]?\d+/, ''))).filter(x => x >= 0))];
    if (days.length) rule.days = days.sort((a, b) => a - b);
    selectorsSupported = weekStart && selectors.every(key => key === 'BYDAY' || key === 'WKST') &&
      parts.BYDAY.split(',').every(day => WEEKDAYS.includes(day.toUpperCase()));
  } else if (freq === 'WEEKLY' && selectors.length === 1 && selectors[0] === 'WKST') {
    selectorsSupported = weekStart;
  } else if (freq === 'MONTHLY' && selectors.length === 1 && selectors[0] === 'BYDAY') {
    const ordinal = /^([+-]?[1-5])(MO|TU|WE|TH|FR|SA|SU)$/i.exec(parts.BYDAY);
    if (ordinal && !repeated) rule.ordinalWeekday = {ordinal:Number(ordinal[1]), day:WEEKDAYS.indexOf(ordinal[2].toUpperCase())};
    selectorsSupported = !!rule.ordinalWeekday;
  }
  rule.groupSupported = !repeated && selectorsSupported &&
    (parts.INTERVAL === undefined || interval !== null && interval === Number(parts.INTERVAL)) &&
    (parts.COUNT === undefined || rule.count !== null && rule.count === Number(parts.COUNT)) &&
    (parts.UNTIL === undefined || rule.until && parts.COUNT === undefined);
  return rule;
}

function parseCalendar(input, {timeZone} = {}) {
  const text = Buffer.isBuffer(input) || input instanceof Uint8Array ? null : input;
  if (text !== null && typeof text !== 'string') throw fail('invalid_calendar', 'The calendar is not text.');
  if ((text === null ? input.byteLength : Buffer.byteLength(text)) > MAX_BYTES) throw fail('too_large', 'The calendar is larger than 2 MiB.');
  const defaultZone = timeZone === undefined ? new Intl.DateTimeFormat().resolvedOptions().timeZone : validZone(timeZone);
  if (!defaultZone) throw fail('invalid_input', 'Invalid time zone.');
  const source = (text === null ? new TextDecoder('utf-8').decode(input) : text).replace(/^\ufeff/, '');
  if (!/^BEGIN:VCALENDAR\s*$/im.test(source)) throw fail('invalid_calendar', 'The file is not an iCalendar document.');
  const components = [];
  const parents = [];
  const occurrenceFields = new Set();
  let current = null, depth = 0, complete = true;
  for (const line of source.replace(/\r?\n[ \t]/g, '').split(/\r?\n/)) {
    if (!line) continue;
    const prop = parseLine(line);
    if (!prop) continue;
    if (prop.name === 'BEGIN') {
      const type = prop.value.trim().toUpperCase();
      if (current) depth++;
      else if (type === 'VEVENT' || type === 'VTODO') {
        if (components.length >= MAX_COMPONENTS) throw fail('too_many_components', `The calendar has more than ${MAX_COMPONENTS} entries.`);
        current = {type, uid:'', summary:'', status:'', start:null, end:null, due:null, rule:null, recurrenceId:null, exdates:[],
          directEvent:type === 'VEVENT' && parents.length === 1 && parents[0] === 'VCALENDAR', classification:null, cancelled:false,
          ambiguous:false, range:null, unsupportedRule:false};
        occurrenceFields.clear();
        depth = 0;
      }
      parents.push(type);
      continue;
    }
    if (prop.name === 'END') {
      const type = prop.value.trim().toUpperCase();
      if (parents.pop() !== type) complete = false;
      if (current && depth > 0) depth--;
      else if (current && type === current.type) { components.push(current); current = null; }
      continue;
    }
    if (!current || depth > 0) continue;
    const repeatedField = current.directEvent && occurrenceFields.has(prop.name);
    if (current.directEvent && OCCURRENCE_FIELDS.has(prop.name)) {
      if (repeatedField) current.ambiguous = true;
      occurrenceFields.add(prop.name);
    }
    switch (prop.name) {
      case 'UID': current.uid = cleanText(prop.value, 300); break;
      case 'SUMMARY': current.summary = cleanText(unescapeText(prop.value), 200); break;
      case 'CLASS': current.classification = current.classification === null ? prop.value.toUpperCase().slice(0, 20) : ''; break;
      case 'STATUS':
        current.status = prop.value.trim().toUpperCase().slice(0, 20);
        if (current.status === 'CANCELLED') current.cancelled = true;
        break;
      case 'DTSTART': current.start = parseDate(prop.value, prop.params, defaultZone); break;
      case 'DTEND': current.end = parseDate(prop.value, prop.params, defaultZone); break;
      case 'DUE': current.due = parseDate(prop.value, prop.params, defaultZone); break;
      case 'RECURRENCE-ID': {
        current.recurrenceId = parseDate(prop.value, prop.params, defaultZone);
        const range = prop.repeatedRange ? '' : prop.params.RANGE?.toUpperCase() ?? null;
        current.range = repeatedField && (current.range !== null || range !== null) ? '' : range;
        if (!current.recurrenceId) current.ambiguous = true;
        break;
      }
      case 'RRULE':
        current.rule = parseRule(prop.value, defaultZone);
        current.unsupportedRule = !current.rule?.groupSupported;
        break;
      case 'EXDATE':
        for (const item of prop.value.split(',').slice(0, 500)) {
          const date = current.exdates.length < 500 && parseDate(item, prop.params, defaultZone);
          if (date) current.exdates.push(date);
        }
        break;
      default:
    }
  }
  return {components, timeZone:defaultZone, complete:complete && parents.length === 0};
}

function ordinalMonthWall(y, m, time, {ordinal, day}) {
  const sign = Math.sign(ordinal);
  const edge = new Date(ordinal < 0 ? Date.UTC(y, m + 1, 0) : Date.UTC(y, m, 1));
  const edgeDay = (edge.getUTCDay() + 6) % 7;
  const offset = (sign * (day - edgeDay) + 7) % 7 + (Math.abs(ordinal) - 1) * 7;
  const wall = Date.UTC(y, m, edge.getUTCDate() + sign * offset, ...time);
  return new Date(wall).getUTCMonth() === edge.getUTCMonth() ? wall : null;
}

function* candidates(rule, wall0, from) {
  const first = new Date(wall0), interval = rule.interval, skip = rule.count ? 0 : Math.max(0, from - 2 * DAY - wall0);
  if (rule.freq === 'DAILY') {
    for (let k = Math.floor(skip / (interval * DAY)); ; k++) yield wall0 + k * interval * DAY;
  } else if (rule.freq === 'WEEKLY') {
    const day0 = Math.floor(wall0 / DAY), timeOfDay = wall0 - day0 * DAY, weekday = (first.getUTCDay() + 6) % 7;
    const monday = day0 - weekday, days = rule.days || [weekday];
    for (let w = Math.max(0, Math.floor(skip / (7 * DAY * interval)) - 1) * interval; ; w += interval) {
      for (const offset of days) { const at = (monday + w * 7 + offset) * DAY + timeOfDay; yield at >= wall0 ? at : null; }
    }
  } else {
    const y = first.getUTCFullYear(), m = first.getUTCMonth(), d = first.getUTCDate();
    const rest = [first.getUTCHours(), first.getUTCMinutes(), first.getUTCSeconds()];
    for (let k = 0; ; k += interval) {
      if (rule.ordinalWeekday) {
        const at = ordinalMonthWall(y, m + k, rest, rule.ordinalWeekday);
        yield at !== null && at >= wall0 ? at : null;
        continue;
      }
      const at = rule.freq === 'MONTHLY' ? Date.UTC(y, m + k, d, ...rest) : Date.UTC(y + k, m, d, ...rest);
      yield new Date(at).getUTCDate() === d ? at : null; // skip months without that day
    }
  }
}
// Real start instants of one component inside [from, to].
function instances(base, rule, excluded, from, to) {
  const out = [];
  const keep = at => { if (at >= from && at <= to && !excluded.has(at)) out.push(at); };
  if (!rule) { keep(wallToEpoch(base.wall, base.zone)); return out; }
  const until = rule.until;
  const untilWall = until && (until.allDay || (until.floating && until.zone !== 'UTC')) ? until.wall + (until.allDay ? DAY - 1 : 0) : null;
  const untilReal = until && untilWall === null ? wallToEpoch(until.wall, until.zone) : null;
  let steps = 0, count = 0;
  for (const wall of candidates(rule, base.wall, from)) {
    if (++steps > MAX_STEPS) break;
    if (wall === null) continue;
    if (rule.count && count >= rule.count) break;
    count++;
    if ((untilWall !== null && wall > untilWall) || wall > to + 2 * DAY) break;
    if (wall < from - 2 * DAY) continue;
    const at = wallToEpoch(wall, base.zone);
    if (untilReal !== null && at > untilReal) break;
    keep(at);
    if (out.length >= MAX_INSTANCES) break;
  }
  return out;
}
function expandCalendar(calendar, now, series = calendarSeries(calendar)) {
  const from = now - WINDOW_BACK, to = now + WINDOW_AHEAD, overrides = new Map(), out = [];
  for (const c of calendar.components) {
    if (!c.recurrenceId || !c.uid) continue;
    if (!overrides.has(c.uid)) overrides.set(c.uid, new Set());
    overrides.get(c.uid).add(wallToEpoch(c.recurrenceId.wall, c.recurrenceId.zone));
  }
  for (const c of calendar.components) {
    const todo = c.type === 'VTODO', base = todo ? c.due : c.start;
    if (!base || c.status === 'CANCELLED' || (todo && c.status === 'COMPLETED')) continue;
    const excluded = new Set(c.exdates.map(x => wallToEpoch(x.wall, x.zone)));
    if (!c.recurrenceId && c.uid) for (const at of overrides.get(c.uid) || []) excluded.add(at);
    const duration = !todo && c.end ? Math.max(0, wallToEpoch(c.end.wall, c.end.zone) - wallToEpoch(base.wall, base.zone)) : 0;
    const uid = c.uid || digest(`${c.type}|${c.summary}|${base.wall}`, 24);
    const definition = c.directEvent ? series.get(uid) : null;
    const compiled = definition && !c.recurrenceId ? recurrenceRanges(definition, c) : null;
    const ranges = compiled?.length ? compiled : UNSHIFTED;
    const override = definition && c.uid && c.recurrenceId ? wallToEpoch(c.recurrenceId.wall, c.recurrenceId.zone) : null;
    const recurrence = override !== null && definition.exceptions.get(override)?.length === 1 ? override : null;
    for (const {original, at} of rangedInstances(base, c.recurrenceId ? null : c.rule, excluded, from, to, ranges, 'ownerShift')) {
      const origin = recurrence ?? original;
      const key = digest(`${c.type}|${uid}|${origin}`, 20);
      const effectiveKey = origin !== at ? digest(`${c.type}|${uid}|${at}`, 20) : null;
      out.push({key, ...(effectiveKey ? {effectiveKey} : {}), uid, todo, title:c.summary, at, end:duration ? at + duration : null, allDay:base.allDay});
    }
  }
  return out.sort((a, b) => a.at - b.at);
}

function groupPublic(component) {
  return !component.ambiguous && !component.cancelled && component.classification === 'PUBLIC' &&
    (component.range === null || component.range === 'THISANDFUTURE' && !!component.recurrenceId);
}

function supportedMaster(component) {
  if (component.unsupportedRule) return false;
  const rule = component.rule, date = new Date(component.start.wall);
  if (rule?.days) return rule.days.includes((date.getUTCDay() + 6) % 7);
  if (rule?.ordinalWeekday) {
    const time = [date.getUTCHours(), date.getUTCMinutes(), date.getUTCSeconds()];
    return ordinalMonthWall(date.getUTCFullYear(), date.getUTCMonth(), time, rule.ordinalWeekday) === component.start.wall;
  }
  return true;
}

function recurrenceRanges(definition, master) {
  if (definition.masters.length !== 1 || !supportedMaster(master)) return UNSHIFTED;
  if (definition.ranges) return definition.ranges;
  const {start:base, rule} = master;
  const ranges = [...UNSHIFTED];
  const noExclusions = new Set();
  for (const [original, components] of definition.exceptions) {
    const ranged = components.find(component => component.range !== null);
    if (!ranged) continue;
    const {recurrenceId, start} = ranged;
    if (ranged.range !== 'THISANDFUTURE' || ranges.length >= MAX_INSTANCES) return definition.ranges = [];
    const validAnchor = components.length === 1 && !ranged.ambiguous && recurrenceId.zone === base.zone &&
      recurrenceId.allDay === base.allDay && instances(base, rule, noExclusions, original, original).length === 1;
    const validStart = validAnchor && start && start.zone === base.zone && start.allDay === base.allDay;
    const ownerShift = validAnchor && ranged.status === 'CANCELLED' ? null : validStart ? start.wall - recurrenceId.wall : 0;
    const groupShift = validStart && groupPublic(ranged) ? ownerShift : null;
    // Original recurrence IDs order the ranges even after a move crosses a later start.
    ranges.push({original, ownerShift, groupShift});
  }
  definition.ranges = ranges.sort((a, b) => a.original - b.original);
  return definition.ranges;
}

function calendarSeries(calendar) {
  const series = new Map();
  if (!calendar.complete) return series;
  for (const component of calendar.components) {
    if (!component.directEvent || !component.uid && !component.start) continue;
    const uid = component.uid || digest(`${component.type}|${component.summary}|${component.start.wall}`, 24);
    if (!series.has(uid)) series.set(uid, {masters:[], exceptions:new Map()});
    const {masters, exceptions} = series.get(uid);
    if (!component.recurrenceId) { masters.push(component); continue; }
    const original = wallToEpoch(component.recurrenceId.wall, component.recurrenceId.zone);
    if (!exceptions.has(original)) exceptions.set(original, []);
    exceptions.get(original).push(component);
  }
  return series;
}

function* rangedInstances(base, rule, excluded, from, to, ranges, channel) {
  let kept = 0;
  for (let i = 0; i < ranges.length; i++) {
    const range = ranges[i], shift = range[channel];
    if (shift === null) continue;
    const limit = ranges[i + 1]?.original ?? Infinity;
    // A wall-time shift can span an offset change. Expand a bounded cushion
    // in the recurrence clock, then retain only the exact effective window.
    const cushion = shift && base.zone !== 'UTC' ? 2 * DAY : 0;
    const first = Math.max(range.original, from - shift - cushion);
    const last = Math.min(limit - 1, to - shift + cushion);
    if (first > last) continue;
    for (const original of instances(base, rule, excluded, first, last)) {
      const at = shift ? wallToEpoch(original + offsetAt(base.zone, original) + shift, base.zone) : original;
      if (at < from || at > to) continue;
      yield {original, at};
      if (++kept >= MAX_INSTANCES) return;
    }
  }
}

function groupCalendarInstances(series, from, to, observe) {
  for (const [uid, definition] of series) {
    const {masters, exceptions} = definition;
    for (const components of exceptions.values()) {
      for (const component of components) {
        if (!component.start) continue;
        const {wall, zone} = component.start;
        const at = wallToEpoch(wall, zone);
        if (at >= from && at <= to) observe(uid, component, at, components.length === 1 && groupPublic(component), false);
      }
    }
    for (const master of masters) {
      if (!master.start) continue;
      const base = master.start;
      const publishable = masters.length === 1 && groupPublic(master) && supportedMaster(master);
      // Unsupported rules or ambiguous masters still contribute a collision at
      // any legacy-projected times, while explicit exceptions remain independent.
      const ranges = recurrenceRanges(definition, master);
      const excluded = new Set(master.exdates.map(date => wallToEpoch(date.wall, date.zone)));
      for (const original of exceptions.keys()) excluded.add(original);
      const applied = publishable || ranges.length ? ranges : UNSHIFTED;
      for (const {original, at} of rangedInstances(base, master.rule, excluded, from, to, applied, publishable ? 'groupShift' : 'ownerShift')) {
        observe(uid, master, at, publishable, at !== original);
      }
    }
  }
}

function reminder(id, item, at) {
  return makeEvent({source:id, kind:item.todo ? 'calendar.due' : 'calendar.upcoming', subject:item.uid, key:String(item.at),
    title:item.title || '(untitled)', detail:new Date(item.at).toISOString(), at,
    data:{start:item.at, ...(item.end ? {end:item.end} : {}), allDay:item.allDay}});
}

function createIcsSource({id, file, url, leadMinutes = 15, timeZone, fetchImpl = globalThis.fetch, readFile = fs.promises.readFile, now = Date.now, timeoutMs = 20000} = {}) {
  if (!isSourceId(id)) throw fail('invalid_input', 'The source id must be 1-64 characters of A-Z, a-z, 0-9, _ or -.');
  if ((file === undefined) === (url === undefined)) throw fail('invalid_input', 'A calendar needs exactly one of a local file or an https URL.');
  const local = file !== undefined ? absolutePath(file, 'calendar file') : null, remote = url !== undefined ? httpsUrl(url) : null;
  if (!Number.isInteger(leadMinutes) || leadMinutes < 1 || leadMinutes > 1440) throw fail('invalid_input', 'The reminder lead time must be between 1 and 1440 minutes.');
  if (timeZone !== undefined && !validZone(timeZone)) throw fail('invalid_input', 'Invalid time zone.');
  if (typeof fetchImpl !== 'function' || typeof readFile !== 'function' || typeof now !== 'function') throw fail('invalid_input', 'Invalid calendar source options.');
  const lead = leadMinutes * MINUTE;
  let calendar = null, contentKey = null, fetchedAt = null, expanded = null, expandedAt = null, groupCandidates = [];
  async function refresh(signal) {
    const at = now();
    if (remote && calendar && fetchedAt !== null && at - fetchedAt < FETCH_INTERVAL && at >= fetchedAt) return;
    let bytes;
    if (remote) bytes = (await fetchBounded(remote.href, {fetchImpl, timeoutMs, signal, maxBytes:MAX_BYTES, accept:'text/calendar, text/plain;q=0.5'})).bytes;
    else {
      // Refuse an oversized real file before reading it into memory.
      if (readFile === fs.promises.readFile && (await fs.promises.stat(local)).size > MAX_BYTES) throw fail('too_large', 'The calendar is larger than 2 MiB.');
      const content = await readFile(local, {signal});
      bytes = typeof content === 'string' ? Buffer.from(content) : content;
      if (!(bytes instanceof Uint8Array)) throw fail('invalid_calendar', 'The calendar is not text.');
    }
    if (bytes.byteLength > MAX_BYTES) throw fail('too_large', 'The calendar is larger than 2 MiB.');
    const key = digest(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('latin1'));
    if (key !== contentKey) { calendar = parseCalendar(bytes, {timeZone}); contentKey = key; expanded = null; }
    fetchedAt = at;
  }
  async function poll(cursor, signal) {
    if (signal?.aborted) throw fail('aborted');
    await refresh(signal);
    const at = now();
    if (!expanded || at < expandedAt || at - expandedAt >= EXPANSION_TTL) {
      const candidates = new Map();
      const series = calendarSeries(calendar);
      expanded = expandCalendar(calendar, at, series);
      groupCalendarInstances(series, at - GRACE, at + lead + EXPANSION_TTL, (uid, component, start, publicEvent, shifted) => {
        const {zone:timeZone, allDay} = component.start;
        const event = reminder(id, {uid, title:component.summary, at:start, allDay}, at);
        if (!publicEvent || candidates.has(event.id)) { candidates.set(event.id, null); return; }
        const wall = new Date(start + offsetAt(timeZone, start)).toISOString();
        const occurrence = Object.freeze({id:event.id, title:event.title, start,
          localTime:wall.slice(0, allDay ? 10 : 19), timeZone, allDay});
        candidates.set(event.id, {occurrence, shifted});
      });
      groupCandidates = [...candidates.values()].filter(Boolean).sort((a, b) => a.occurrence.start - b.occurrence.start);
      expandedAt = at;
    }
    const seen = cursor && typeof cursor === 'object' && Array.isArray(cursor.seen) ? cursor.seen.filter(x => typeof x === 'string').slice(-MAX_SEEN) : [];
    const groupShiftSeen = Array.isArray(cursor?.groupShiftSeen)
      ? cursor.groupShiftSeen.filter(key => typeof key === 'string' && /^[a-f0-9]{32}$/.test(key)).slice(-MAX_SEEN) : [];
    const shiftKnown = new Set(groupShiftSeen);
    const known = new Set(seen), events = [], ownerCalendarIds = new Set();
    for (const item of expanded) {
      if (item.at - at > lead) break;
      const past = at - item.at;
      const retain = !item.todo && past <= OWNER_LIVE_GRACE && ownerCalendarIds.size < MAX_OWNER_IDS;
      const due = past <= GRACE && !known.has(item.key);
      if (!retain && !due) continue;
      const event = reminder(id, item, at);
      if (retain) ownerCalendarIds.add(event.id);
      if (!due) continue;
      const previouslyReminded = known.has(item.effectiveKey) || !item.todo && shiftKnown.has(event.id);
      if (!previouslyReminded && events.length >= MAX_EVENTS) continue;
      // Adopt the original occurrence key even when an older cursor used a
      // shifted start, or the group sidecar was saved first on an older build.
      known.add(item.key); seen.push(item.key);
      if (!previouslyReminded) events.push(event);
    }
    const eligible = groupCandidates.filter(({occurrence}) => occurrence.start - at <= lead && at - occurrence.start <= GRACE);
    const current = eligible.map(item => item.occurrence);
    const currentIds = new Set(current.map(item => item.id));
    const newIds = events.filter(event => event.kind === 'calendar.upcoming' && currentIds.has(event.id) && !shiftKnown.has(event.id)).map(event => event.id);
    const fresh = new Set(newIds);
    for (const {occurrence, shifted} of eligible) {
      if (!shifted || shiftKnown.has(occurrence.id) || newIds.length >= MAX_EVENTS) continue;
      shiftKnown.add(occurrence.id);
      groupShiftSeen.push(occurrence.id);
      if (!fresh.has(occurrence.id)) newIds.push(occurrence.id);
    }
    const nextCursor = {seen:seen.slice(-MAX_SEEN)};
    if (groupShiftSeen.length) nextCursor.groupShiftSeen = groupShiftSeen.slice(-MAX_SEEN);
    return {cursor:nextCursor, events, ownerCalendarIds:[...ownerCalendarIds], groupCalendar:{current, newIds}};
  }
  return Object.freeze({id, kind:'ics', intervalMs:MINUTE, fetchIntervalMs:remote ? FETCH_INTERVAL : MINUTE,
    target:remote ? displayUrl(remote) : path.basename(local), poll});
}

module.exports = {createIcsSource, parseCalendar, expandCalendar, LIMITS:Object.freeze({MAX_BYTES, MAX_COMPONENTS, MAX_INSTANCES, MAX_SEEN})};
