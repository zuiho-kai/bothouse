import { describe, expect, it } from 'vitest';
import { chatCopy, formatClock, formatDayLabel, formatRelative, pickChatCopy } from './copy';

const zh = chatCopy.zh;
const en = chatCopy.en;
const NOW = new Date('2026-11-03T15:00:00+08:00').getTime();

describe('formatRelative', () => {
  it('says just now under a minute', () => {
    expect(formatRelative(new Date(NOW - 20_000).toISOString(), zh, NOW)).toBe(zh.justNow);
  });

  it('counts minutes, hours, days', () => {
    expect(formatRelative(new Date(NOW - 12 * 60_000).toISOString(), zh, NOW)).toBe('12 分钟');
    expect(formatRelative(new Date(NOW - 3 * 3_600_000).toISOString(), zh, NOW)).toBe('3 小时');
    expect(formatRelative(new Date(NOW - 2 * 86_400_000).toISOString(), zh, NOW)).toBe('2 天');
  });

  it('switches to a date after a week', () => {
    expect(formatRelative(new Date(NOW - 20 * 86_400_000).toISOString(), zh, NOW)).toMatch(/^\d+\/\d+$/);
  });

  it('returns empty for missing or broken timestamps', () => {
    expect(formatRelative('', zh, NOW)).toBe('');
    expect(formatRelative('not-a-date', zh, NOW)).toBe('');
  });

  it('uses the english copy set', () => {
    expect(formatRelative(new Date(NOW - 3 * 3_600_000).toISOString(), en, NOW)).toBe('3h');
  });
});

describe('formatDayLabel', () => {
  it('labels today and yesterday', () => {
    expect(formatDayLabel(new Date(NOW).toISOString(), zh, NOW)).toBe(zh.today);
    expect(formatDayLabel(new Date(NOW - 86_400_000).toISOString(), zh, NOW)).toBe(zh.yesterday);
  });

  it('labels older days with a date', () => {
    expect(formatDayLabel(new Date(NOW - 5 * 86_400_000).toISOString(), zh, NOW)).toMatch(/月\d+日$/);
  });
});

describe('formatClock', () => {
  it('pads hours and minutes', () => {
    expect(formatClock(new Date('2026-11-03T09:05:00').toISOString())).toBe('09:05');
  });
});

describe('pickChatCopy', () => {
  it('routes every zh variant to chinese copy and the rest to english', () => {
    expect(pickChatCopy('zh')).toBe(zh);
    expect(pickChatCopy('zh-TW')).toBe(zh);
    expect(pickChatCopy('en')).toBe(en);
    expect(pickChatCopy(undefined)).toBe(en);
  });
});
