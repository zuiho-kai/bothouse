import { describe, expect, it } from 'vitest';
import en from './locales/en.json';
import zh from './locales/zh.json';
import zhTW from './locales/zh-TW.json';
import ja from './locales/ja.json';
import es from './locales/es.json';
import ko from './locales/ko.json';
import ru from './locales/ru.json';

// 2026-11-06 独立验收：删掉 en.json / ko.json 里新增的四个键，99 条用例照样全绿、lint 也过，
// 全仓没有语言包一致性检查。这组用例补的就是这道护栏。

type Tree = { [k: string]: string | Tree };
const dicts: Record<string, Tree> = { en, zh, 'zh-TW': zhTW, ja, es, ko, ru };

function flatten(tree: Tree, prefix = ''): string[] {
  return Object.entries(tree).flatMap(([k, v]) => {
    const key = prefix ? `${prefix}.${k}` : k;
    return typeof v === 'object' && v !== null ? flatten(v as Tree, key) : [key];
  });
}

// 额度页这轮新增/改名的键：每种语言都得有，少一个用户就会看到键名本身。
const USAGE_KEYS = [
  'usage.quickFilters',
  'usage.presetToday',
  'usage.presetThisWeek',
  'usage.presetThisMonth',
  'usage.presetLast7Days',
  'usage.presetPastYear',
  'usage.presetPastYearHint',
  'usage.tokenBreakdown',
];

// #1376: the plugins page's package-kind labels. They live in the locale files (the rest of that
// page keeps its zh/en/ja table), so all seven must carry them or a user sees the key name.
const PLUGIN_KEYS = ['plugins.stateClientUi', 'plugins.clientUiNote'];

describe('locale files stay in step', () => {
  it.each(Object.keys(dicts))('%s has every usage quick-filter key', lang => {
    const keys = new Set(flatten(dicts[lang]));
    expect(USAGE_KEYS.filter(k => !keys.has(k))).toEqual([]);
  });

  it.each(Object.keys(dicts))('%s has every plugin package-kind key', lang => {
    const keys = new Set(flatten(dicts[lang]));
    expect(PLUGIN_KEYS.filter(k => !keys.has(k))).toEqual([]);
  });

  it.each(Object.keys(dicts))('%s has no key that en.json does not have', lang => {
    const english = new Set(flatten(dicts.en));
    expect(flatten(dicts[lang]).filter(k => !english.has(k))).toEqual([]);
  });

  it.each(Object.keys(dicts))('%s no longer offers the old "all" preset', lang => {
    // 「全部」实际只能查到一年，已改名为「近一年」；旧键留着就会有人又把它接回去。
    expect(flatten(dicts[lang]).filter(k => k.includes('presetAll'))).toEqual([]);
  });
});
