'use strict';

const {clean} = require('./dispatcher.cjs');
const {isControlText} = require('./commands.cjs');
const {dueFromLocalTime} = require('./followup-time.cjs');

const minutes = 60_000, hours = 60 * minutes, days = 24 * hours;
const MAX_DURATION = 366 * days;
const MAX_TOPIC = 600;
const DIGITS = '零一二三四五六七八九';
const PLACES = {'千':1000,'百':100,'十':10,'':1};
const UNIT = {'分钟':minutes,'分鐘':minutes,'小时':hours,'小時':hours,'天':days};
const EXPLICIT = /^回[访訪][ \t\u3000]+([^|｜\r\n]+)(?:[|｜]([\s\S]*))?$/u;
const RESCHEDULE = /^改期回[访訪][ \t\u3000]+([^\r\n\u2028\u2029]+)$/u;
const QUOTED_RESCHEDULE = /^(?:[请請][ \t\u3000]*)?改(?:到|成)[ \t\u3000]*([^\r\n\u2028\u2029]{1,64}?)(?:之|以)?[后後][ \t\u3000，,]*提醒我[。！!]?$/u;
const SELECTOR = /^[\w-]{6,180}$/u;
const ABSOLUTE_DATE = /^\d{4}[-/]\d{1,2}[-/]\d{1,2}(?:[Tt \t]|$)/u;
const AFTER = /(?:之|以)?[后後]$/u;
const DIRECT = /^(.{1,64}?)(?:之|以)?[后後][ \t\u3000，,]*提醒我(?![的们們妈媽爸父母爷爺奶哥弟姐妹]|孩子|朋友)([\s\S]*)$/u;
// Only classify recognizable time wording as a direct attempted duration.
// This excludes narrative prefixes, including ones that begin with a number.
const TIMED_WORDS = /^[0-9０-９零〇一二两兩三四五六七八九十百千万萬分分钟鐘秒小时時个個点點天日周週星期月年刻半几好多少大约約概左右上下工作节節营业營業到稍晚点點马馬上会會儿兒立刻现在現在再过過足满滿+＋−\-.．,，~～?？ \t\u3000]+$/u;
const UNKNOWN_NUMBER = /^[a-z]{1,12}[ \t\u3000]*(?:分[钟鐘]|小[时時]|天)$/iu;
const DURATION = /^([0-9０-９]{1,7}|[零〇一二两兩三四五六七八九十百千万萬]{1,14})[ \t\u3000]*(?:([个個])[ \t\u3000]*)?(分钟|分鐘|小时|小時|天)$/u;
const HALF_HOUR = /^半[ \t\u3000]*(?:[个個][ \t\u3000]*)?小[时時]$/u;
const ANOTHER_DIRECT = /(?:[0-9０-９零〇一二两兩三四五六七八九十百千万萬半几]+[ \t\u3000]*[分分钟鐘秒小时時个個点點天日周週星期月年刻 \t\u3000]+|稍|一会儿|一會兒)(?:之|以)?[后後][ \t\u3000，,]*提醒我/u;
const ANOTHER_COMMAND = /(?:^|[，,。；;！？!?])[ \t\u3000]*(?:再|还要|接着|然后|另外|顺便)?[ \t\u3000]*(?:提醒我|(?:改期)?回[访訪][ \t\u3000])/u;
const BEIJING_PREFIX = /^(?:按(?:照)?|以)?北京[时時][间間][ \t\u3000，,：:]*/u;
const NEXT_DAY = /^明[天日][ \t\u3000，,]*/u;
const CALENDAR_REQUEST = /^([^\r\n\u2028\u2029]{0,64}?)(?:[请請][ \t\u3000]*)?提醒我(?![的们們妈媽爸父母爷爺奶哥弟姐妹]|孩子|朋友)([\s\S]*)$/u;
const CLOCK_WORDS = /^(?:(?:凌晨|早上|上午|中午|下午|傍晚|晚上|早晨|夜[里裡]))?[0-9０-９零〇一二两兩三四五六七八九十点點时時分整半：: \t\u3000]*$/u;
const CLOCK_PERIOD = /^(凌晨|早上|早晨|上午|中午|下午|傍晚|晚上)[ \t\u3000]*/u;
const CLOCK_DIGITAL = /^([0-9０-９]{1,2})[：:]([0-9０-９]{2})$/u;
const CLOCK_SPOKEN = /^([0-9０-９零〇一二两兩三四五六七八九十]{1,3})[点點时時](?:(半)|(整)|([0-9０-９零〇一二两兩三四五六七八九十]{1,3})分)?$/u;
const PERIOD_HOURS = {凌晨:[0,5],早上:[1,11],早晨:[1,11],上午:[1,11],中午:[11,13],下午:[12,18],傍晚:[17,19],晚上:[18,23]};
const NEXT_CLAUSE = /[，,。；;！？!?][ \t\u3000]*(?:(?:再|还要|還要|接着|接著|然后|然後|另外|顺便|順便)[ \t\u3000]*)?/gu;
const TOPIC_FILLER = /^(?:吗|嗎|呢|吧|呀|啊|一下|一下吧|我)[。！？!?.,，、…]*$/u;

function smallChineseInteger(value) {
  if (!/^(?:[零〇一二三四五六七八九十百千]|[两兩](?=[百千]|$)){1,8}$/u.test(value)) return NaN;
  const text = value.replace(/[两兩]/gu,'二').replaceAll('〇','零').replace(/^十/u,'一十');
  let total = 0, digit = 0;
  for (const char of text) {
    if (Object.hasOwn(PLACES,char)) {
      total += digit * PLACES[char];
      digit = 0;
    } else digit = DIGITS.indexOf(char);
  }
  total += digit;
  // Reject ambiguous abbreviations such as 二百三 (230 or 203) and repeated units.
  let canonical = '', gap = false;
  for (const [unit,place] of Object.entries(PLACES)) {
    const n = Math.floor(total / place) % 10;
    if (!n) {
      gap ||= !!canonical;
      continue;
    }
    canonical += (gap ? '零' : '') + DIGITS[n] + unit;
    gap = false;
  }
  return canonical === text ? total : NaN;
}

function wholeNumber(value) {
  if (/^[0-9０-９]+$/u.test(value)) {
    return Number(value.replace(/[０-９]/gu,char=>String(char.charCodeAt(0)-0xff10)));
  }
  const parts = value.split(/[万萬]/u);
  if (parts.length === 1) return smallChineseInteger(value);
  if (parts.length !== 2) return NaN;
  const [high,low] = parts, base = smallChineseInteger(high) * 10_000;
  if (!low) return base;
  const gap = /^[零〇]/u.test(low);
  const rest = smallChineseInteger(gap ? low.slice(1) : low);
  return (rest < 1000) === gap ? base + rest : NaN;
}

function positiveDuration(duration) {
  const text = duration.trim();
  if (HALF_HOUR.test(text)) return 30 * minutes;
  const match = DURATION.exec(text);
  if (!match || (match[2] && !/^小/u.test(match[3]))) return null;
  const durationMs = wholeNumber(match[1]) * UNIT[match[3]];
  return Number.isSafeInteger(durationMs) && durationMs >= minutes && durationMs <= MAX_DURATION ? durationMs : null;
}

function parsed(duration,body) {
  const durationMs = positiveDuration(duration);
  if (durationMs === null) return {error:'duration'};
  const topic = reminderTopic(body);
  return topic ? {durationMs,topic} : {error:'topic'};
}

function reminderTopic(body) {
  const topic = (body || '').trim();
  if (!topic || topic.length > MAX_TOPIC || !topic.isWellFormed() || !/[\p{L}\p{N}]/u.test(topic) ||
      /[|｜\p{Cc}\u2028-\u202e\u2066-\u2069]/u.test(topic) || clean(topic,MAX_TOPIC) !== topic ||
      TOPIC_FILLER.test(topic) || isControlText(topic) || ANOTHER_DIRECT.test(topic) || ANOTHER_COMMAND.test(topic)) return null;
  return topic;
}

const clockNumber = value => /^[零〇]$/u.test(value) ? 0 : wholeNumber(value);

function parseClock(text) {
  const period = CLOCK_PERIOD.exec(text);
  const clock = text.slice(period?.[0].length || 0);
  const digital = CLOCK_DIGITAL.exec(clock);
  const spoken = CLOCK_SPOKEN.exec(clock);
  if (!digital && !spoken) return null;
  let hour = clockNumber((digital || spoken)[1]);
  const minute = digital ? clockNumber(digital[2]) : spoken[2] ? 30 : spoken[4] ? clockNumber(spoken[4]) : 0;
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  if (!period) return digital || hour === 0 || hour > 12 ? {hour,minute} : null;
  const [first,last] = PERIOD_HOURS[period[1]];
  if (hour > 0 && hour < first && hour+12 <= last) hour += 12;
  return hour >= first && hour <= last ? {hour,minute} : null;
}

function calendarRequest(body) {
  const match = CALENDAR_REQUEST.exec(body);
  if (!match) return null;
  const when = match[1].trim().replace(/^[请請][ \t\u3000]*/u,'');
  const zone = BEIJING_PREFIX.exec(when);
  const dateText = when.slice(zone?.[0].length || 0);
  const tomorrow = NEXT_DAY.exec(dateText);
  const clockText = dateText.slice(tomorrow?.[0].length || 0).trim().replace(/[，,]$/u,'').trimEnd();
  return {zone:!!zone,tomorrow:!!tomorrow,clockText,text:match[2].trimStart().replace(/^[：:]/u,'')};
}

function hasAnotherClock(topic) {
  // A clause must itself start with a precise time and tell the companion
  // to remind the same speaker. A list of things to do is still one topic.
  for (const boundary of topic.matchAll(NEXT_CLAUSE)) {
    const next = calendarRequest(topic.slice(boundary.index+boundary[0].length));
    if (next && parseClock(next.clockText)) return true;
  }
  return false;
}

function parseBeijingReminder(body) {
  const request = calendarRequest(body);
  if (!request || (!request.zone && !request.tomorrow) || !CLOCK_WORDS.test(request.clockText)) return null;
  if (!request.zone) return {error:'calendar_zone'};
  if (!request.tomorrow) return {error:'calendar_day'};
  const clock = parseClock(request.clockText);
  if (!clock) return {error:'calendar_clock'};
  if (hasAnotherClock(request.text)) return {error:'calendar_multiple'};
  const topic = reminderTopic(request.text);
  return topic ? {beijingTomorrow:clock,topic} : {beijingTomorrow:clock,error:'topic'};
}

function beijingTomorrowTime(postedAt,{hour,minute}) {
  // Get the Beijing calendar date by shifting the authenticated wire time
  // into UTC+08:00 before advancing one calendar day. Host time is irrelevant.
  const date = new Date(postedAt + 8 * hours + days).toISOString().slice(0,10);
  const pad = value => String(value).padStart(2,'0');
  const localTime = `${date}T${pad(hour)}:${pad(minute)}:00+08:00`;
  return {localTime,dueAt:dueFromLocalTime(localTime)};
}

const looksRelative = value => TIMED_WORDS.test(value) || UNKNOWN_NUMBER.test(value);

function parseReschedule(args) {
  const error = reason => ({operation:'reschedule',error:reason});
  const parts = /^(\S+)[ \t\u3000]+(.+)$/u.exec(args);
  if (!parts) return AFTER.test(args) && looksRelative(args.replace(AFTER,'')) ? error('code') : null;
  const [,code,when] = parts;
  if (ABSOLUTE_DATE.test(when)) return null;
  if (!AFTER.test(when) && !looksRelative(when)) return null;
  // Same syntax as findCode(). The route still resolves an exact or unique
  // prefix in the requester's pending appointments for this group and role.
  if (!SELECTOR.test(code)) return error('code');
  const durationMs = AFTER.test(when) ? positiveDuration(when.replace(AFTER,'')) : null;
  return durationMs === null ? error('duration') : {operation:'reschedule',code,durationMs};
}

function parseQuotedGroupReschedule(text) {
  if (typeof text !== 'string') return null;
  const match = QUOTED_RESCHEDULE.exec(text.trim());
  if (!match || !looksRelative(match[1])) return null;
  const durationMs = positiveDuration(match[1]);
  return durationMs === null ? {operation:'reschedule',error:'duration'} : {operation:'reschedule',durationMs};
}

/** Recognize one direct request. The authenticated group message supplies the clock separately. */
function parseGroupRelativeFollowup(text) {
  if (typeof text !== 'string') return null;
  const body = text.trim();
  const reschedule = RESCHEDULE.exec(body);
  if (reschedule) return parseReschedule(reschedule[1]);
  const explicit = EXPLICIT.exec(body);
  if (explicit) {
    const when = explicit[1].trim();
    return AFTER.test(when) ? parsed(when.replace(AFTER,''),explicit[2]) : null;
  }
  const calendar = parseBeijingReminder(body);
  if (calendar) return calendar;
  const direct = DIRECT.exec(body);
  if (!direct || !looksRelative(direct[1])) return null;
  return parsed(direct[1],direct[2].trimStart().replace(/^[：:]/u,''));
}

module.exports = {parseGroupRelativeFollowup,parseQuotedGroupReschedule,beijingTomorrowTime};
