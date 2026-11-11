/**
 * 日期换算：年内第几天、农历月日与除夕判定。
 *
 * 依赖 ICU 的中国农历日历（不引第三方库），精度边界见 lunarPartsOf。
 * 必须始终成立：拿不到农历时返回 undefined，不猜一个近似值。
 * @module dsh-pet/src/host/time-context/lunar
 */
import { DAY_MS } from './constants.ts';
import { LUNAR_EVE, LUNAR_INDEX, SOLAR_INDEX } from './entries.ts';
import type { LunarParts, RankedEntry } from './entries.ts';

/** ICU 中国农历格式器；null = 已判定本环境不可用（不重试、不抛错）。 */
let lunarFormatter: Intl.DateTimeFormat | null | undefined;

/**
 * 取 ICU 农历格式器。Intl 在缺少该日历时不会抛错，而是静默退回公历——那会让每个月都被当成农历
 * 同月同日，所以用 resolvedOptions().calendar 确认它真的解析成了 'chinese'，否则一律判不可用。
 */
function getLunarFormatter(): Intl.DateTimeFormat | undefined {
  if (lunarFormatter === null) return undefined;
  if (!lunarFormatter) {
    const fmt = new Intl.DateTimeFormat('en-u-ca-chinese', { month: 'numeric', day: 'numeric', year: 'numeric' });
    lunarFormatter = fmt.resolvedOptions().calendar === 'chinese' ? fmt : null;
  }
  return lunarFormatter ?? undefined;
}

/** 年内日序号（0 起，按 UTC 计算，闰年自然正确）——假期区间比较用它。 */
export function dayOfYear(date: Date): number {
  return (Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) - Date.UTC(date.getFullYear(), 0, 1)) / DAY_MS;
}

/** '月-日' → 该年内的日序号（0 起）。 */
export function dayOfYearOf(year: number, monthDay: string): number {
  const [month, day] = monthDay.split('-').map(Number);
  return (Date.UTC(year, (month ?? 1) - 1, day ?? 1) - Date.UTC(year, 0, 1)) / DAY_MS;
}

/**
 * 公历日期 → 农历月日。
 *
 * 已知精度边界（已评估并接受）：朔时刻贴近 UTC+8 午夜时 ICU 会把农历初一放错一天——2025–2060 的
 * 445 个月起点里错 2 个，都是正月（2027-02-06 距午夜 8 分钟、2030-02-03 距午夜 5 分钟），表现为那
 * 两年春节与元宵各差一天；2027 一例已与香港天文台官方对照表核对。要绝对准确只需换掉本函数实现
 * （换库或加修正表），下游逻辑一行不用动。
 * @returns 农历月/日（闰月 month 为负）；环境不支持农历、取不到月日，或农历年与公历年不吻合
 *   （自洽校验：农历年只可能是当年或前一年，挡住 ICU 退化时把公历当农历返回）→ undefined。
 */
function lunarPartsOf(date: Date): LunarParts | undefined {
  const fmt = getLunarFormatter();
  if (!fmt) return undefined;
  const parts = fmt.formatToParts(date);
  const pick = (type: string): string | undefined => parts.find((p) => p.type === type)?.value;
  const rawMonth = pick('month');
  const rawDay = pick('day');
  const rawYear = pick('relatedYear') ?? pick('year');
  if (!rawMonth || !rawDay || !rawYear) return undefined;
  const month = Number.parseInt(rawMonth, 10);
  const day = Number.parseInt(rawDay, 10);
  const year = Number.parseInt(rawYear, 10);
  if (!Number.isFinite(month) || !Number.isFinite(day) || !Number.isFinite(year)) return undefined;
  const gregorianYear = date.getFullYear();
  // 农历年只会是当年或前一年（春节前的 1–2 月仍属上一个农历年）
  if (year !== gregorianYear && year !== gregorianYear - 1) return undefined;
  return { month: /bis/i.test(rawMonth) ? -month : month, day };
}

/** 当天是否是除夕（腊月最后一天：次日为正月初一即成立，廿九/三十都能认）。 */
function isLunarEve(date: Date): boolean {
  const today = lunarPartsOf(date);
  if (!today || today.month !== 12) return false;
  const next = lunarPartsOf(new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1));
  return Boolean(next && next.month === 1 && next.day === 1);
}

/** 某一天命中的全部条目（公历、农历、除夕三类；假期区间不按天查，另行处理）。 */
export function entriesAt(date: Date): RankedEntry[] {
  const out: RankedEntry[] = [];
  const solar = SOLAR_INDEX.get(date.getMonth() + 1 + '-' + date.getDate());
  if (solar) out.push(solar);
  const lunar = lunarPartsOf(date);
  // 闰月（month < 0）不参与匹配：闰五月初五不是端午
  if (lunar && lunar.month > 0) {
    const hit = LUNAR_INDEX.get(lunar.month + '-' + lunar.day);
    if (hit) out.push(hit);
  }
  if (LUNAR_EVE && isLunarEve(date)) out.push(LUNAR_EVE);
  return out;
}
