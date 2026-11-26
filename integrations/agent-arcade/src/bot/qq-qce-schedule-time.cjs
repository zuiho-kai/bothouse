'use strict';

const { createHash } = require('node:crypto');

const MINUTE = 60_000, DAY = 86_400_000;
const LIMITS = Object.freeze({
  minEpochMs: Date.UTC(2000, 0, 1),
  maxEpochMsExclusive: Date.UTC(2100, 0, 1),
  maxSearchDays: 400,
});
const formatters = new Map();
const occurrences = new Map();

function fail(code) {
  return Object.assign(new Error(code), { code });
}

function exactObject(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
      || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw fail('invalid_recurrence');
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(descriptors).some(key => typeof key !== 'string' || !keys.includes(key)
      || !Object.hasOwn(descriptors[key], 'value'))) throw fail('invalid_recurrence');
}

function formatter(timeZone) {
  if (formatters.has(timeZone)) return formatters.get(timeZone);
  let value;
  try {
    value = new Intl.DateTimeFormat('en-GB', {
      timeZone, calendar: 'iso8601', numberingSystem: 'latn', hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
  } catch { throw fail('invalid_recurrence'); }
  if (formatters.size >= 32) formatters.delete(formatters.keys().next().value);
  formatters.set(timeZone, value);
  return value;
}

function validateRecurrence(value) {
  exactObject(value, ['frequency', 'time', 'timeZone', 'weekdays', 'monthDay', 'dstPolicy', 'missingMonthDay']);
  if (!['frequency', 'time', 'timeZone', 'dstPolicy', 'missingMonthDay'].every(key => Object.hasOwn(value, key))
      || !['daily', 'weekly', 'monthly'].includes(value.frequency)
      || typeof value.time !== 'string' || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value.time)
      || typeof value.timeZone !== 'string' || !/^[A-Za-z][A-Za-z0-9_+./-]{0,99}$/.test(value.timeZone)
      || value.missingMonthDay !== 'skip') throw fail('invalid_recurrence');
  exactObject(value.dstPolicy, ['missing', 'repeated']);
  if (value.dstPolicy.missing !== 'skip' || value.dstPolicy.repeated !== 'first') throw fail('invalid_recurrence');
  let weekdays;
  if (value.frequency === 'weekly') {
    if (!Array.isArray(value.weekdays) || value.weekdays.length < 1 || value.weekdays.length > 7
        || [...value.weekdays].some(x => !Number.isInteger(x) || x < 1 || x > 7)
        || new Set(value.weekdays).size !== value.weekdays.length) throw fail('invalid_recurrence');
    weekdays = [...value.weekdays].sort((a, b) => a - b);
  } else if (Object.hasOwn(value, 'weekdays')) throw fail('invalid_recurrence');
  if (value.frequency === 'monthly') {
    if (!Number.isInteger(value.monthDay) || value.monthDay < 1 || value.monthDay > 31) throw fail('invalid_recurrence');
  } else if (Object.hasOwn(value, 'monthDay')) throw fail('invalid_recurrence');
  const timeZone = formatter(value.timeZone).resolvedOptions().timeZone;
  return {
    frequency: value.frequency, time: value.time, timeZone,
    ...(weekdays ? { weekdays } : {}),
    ...(value.frequency === 'monthly' ? { monthDay: value.monthDay } : {}),
    dstPolicy: { missing: 'skip', repeated: 'first' }, missingMonthDay: 'skip',
  };
}

function parts(format, at) {
  const result = Object.create(null);
  for (const part of format.formatToParts(at)) {
    if (['year', 'month', 'day', 'hour', 'minute', 'second'].includes(part.type)) result[part.type] = Number(part.value);
  }
  if (Object.keys(result).length !== 6 || Object.values(result).some(x => !Number.isInteger(x))) throw fail('schedule_time_unavailable');
  return result;
}

// Deliberately finite minute-resolution calendar scheduling, not a general
// historical time-zone inverse. Contemporary IANA offsets (2000..2099) are
// whole minutes and within 24 hours. Check every possible minute, not sampled
// hourly offsets or Date's implicit gap normalization. Each match round-trips
// the full ISO date, local hour/minute and zero seconds through the runtime ICU.
function firstInstant(rule, date, nominal) {
  const key = `${rule.timeZone}|${date}|${rule.time}`;
  if (occurrences.has(key)) return occurrences.get(key);
  const [hour, minute] = rule.time.split(':').map(Number);
  const [year, month, day] = date.split('-').map(Number);
  const wall = nominal + hour * 60 * MINUTE + minute * MINUTE;
  const format = formatter(rule.timeZone);
  let found = null;
  for (let at = wall - DAY; at <= wall + DAY; at += MINUTE) {
    const p = parts(format, at);
    if (p.year === year && p.month === month && p.day === day
        && p.hour === hour && p.minute === minute && p.second === 0) {
      found = at;
      break; // The repeated local time's second instant is never a slot.
    }
  }
  if (occurrences.size >= 512) occurrences.delete(occurrences.keys().next().value);
  occurrences.set(key, found);
  return found;
}

function nextOccurrence(value, afterEpochMs) {
  const rule = validateRecurrence(value);
  if (!Number.isSafeInteger(afterEpochMs)) throw fail('invalid_schedule_time');
  if (afterEpochMs < LIMITS.minEpochMs || afterEpochMs >= LIMITS.maxEpochMsExclusive) throw fail('schedule_time_out_of_range');
  // UTC-day order plus the full offset bound also covers date-boundary shifts.
  // Do not assume the local date advances monotonically through a transition.
  const start = Math.floor(afterEpochMs / DAY) * DAY - DAY;
  let best = null, reachedEnd = false;
  for (let i = 0; i < LIMITS.maxSearchDays; i++) {
    const nominal = start + i * DAY;
    if (best && nominal - DAY > best.at) break;
    if (nominal >= LIMITS.maxEpochMsExclusive) { reachedEnd = true; break; }
    if (nominal < LIMITS.minEpochMs) continue;
    const day = new Date(nominal);
    if (rule.frequency === 'weekly' && !rule.weekdays.includes(day.getUTCDay() || 7)) continue;
    if (rule.frequency === 'monthly' && day.getUTCDate() !== rule.monthDay) continue;
    const localDate = day.toISOString().slice(0, 10);
    const at = firstInstant(rule, localDate, nominal);
    if (at === null || at <= afterEpochMs || at < LIMITS.minEpochMs || at >= LIMITS.maxEpochMsExclusive) continue;
    if (!best || at < best.at) {
      best = {
        at, utc: new Date(at).toISOString(),
        slotKey: createHash('sha256').update(JSON.stringify(['qce-calendar-v1', rule, localDate])).digest('hex'),
        localDate, localTime: rule.time, timeZone: rule.timeZone,
      };
    }
  }
  if (best) return best;
  if (reachedEnd) return null;
  throw fail('schedule_time_unavailable');
}

module.exports = { validateRecurrence, nextOccurrence, LIMITS };
