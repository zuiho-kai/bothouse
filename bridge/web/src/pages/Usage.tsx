import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Activity, RefreshCw, X, Calendar } from 'lucide-react';
import { getUsage, type UsageResult, type UsageRow } from '@/api/usage';
import { listProjects, shownNames, type ProjectSummary } from '@/api/projects';
import { useUsageSettingsStore, formatToken, TOKEN_UNITS, type TokenUnit } from '@/store/usageSettings';
import { cn } from '@/lib/utils';

// 来源: SPEC bridge/core/management_usage.go 要求跨度不超过一年 (366天)
const MAX_RANGE_DAYS = 366;

const dayKey = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const number = (value: number) => value.toLocaleString();
const sum = (rows: UsageRow[], key: 'total_tokens' | 'responses' | 'unknown_usage_responses' | 'unpriced_responses') => rows.reduce((s, r) => s + r[key], 0);
const panel = 'rounded-card bg-surface p-5 ring-1 ring-hairline';
// 热力五档：0/1/2/3/4 全部走同一个 accent 的透明度梯度，亮暗两套色自动跟随令牌。
const colors = ['bg-surface-sunken', 'bg-accent/15', 'bg-accent/35', 'bg-accent/60', 'bg-accent/90'];

export type DatePreset = 'today' | 'thisWeek' | 'thisMonth' | 'last7Days' | 'pastYear';

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

// 日期串按 UTC 做纯日历运算，避免浏览器时区参与；输入输出都是 YYYY-MM-DD。
const shiftDay = (day: string, delta: number) => {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
};

// serverToday 是后端日历（/api/v1/usage 按服务器 time.Local 解释日期）的今天；
// 预设都从它推算，而不是浏览器日历，二者跨日时不会差一天。
export function getPresetRange(preset: DatePreset, serverToday: string): { from: string; to: string } {
  if (preset === 'today') return { from: serverToday, to: serverToday };
  if (preset === 'thisWeek') {
    // 来源: 沿用标准 ISO-8601 周初(周一)至今天作为「本周」
    const weekday = new Date(`${serverToday}T00:00:00Z`).getUTCDay();
    return { from: shiftDay(serverToday, weekday === 0 ? -6 : 1 - weekday), to: serverToday };
  }
  if (preset === 'thisMonth') return { from: `${serverToday.slice(0, 8)}01`, to: serverToday };
  if (preset === 'last7Days') return { from: shiftDay(serverToday, -6), to: serverToday };
  // 近一年：不传起止，由后端返回默认范围（今天往前一年），见 management_usage.go。
  return { from: '', to: '' };
}

// 手动改日期时用来同步高亮：都为空即「近一年」；否则按 今日→本周→本月→近7天 的固定顺序
// 取第一个范围完全相同的预设。点击预设时不走这里，直接保留所点的那一个。
export function matchPreset(start: string, end: string, serverToday: string): DatePreset | null {
  if (!start && !end) return 'pastYear';
  const order: DatePreset[] = ['today', 'thisWeek', 'thisMonth', 'last7Days'];
  for (const p of order) {
    const range = getPresetRange(p, serverToday);
    if (range.from === start && range.to === end) return p;
  }
  return null;
}

function TokenBreakdownBar({
  input,
  output,
  cache,
  total,
  unit,
}: {
  input: number;
  output: number;
  cache: number;
  total: number;
  unit: TokenUnit;
}) {
  const { t } = useTranslation();
  const sumParts = input + output + cache;
  const base = sumParts > 0 ? sumParts : total;
  const inPct = base > 0 ? (input / base) * 100 : 0;
  const outPct = base > 0 ? (output / base) * 100 : 0;
  const cachePct = base > 0 ? (cache / base) * 100 : 0;

  return (
    <div className="mt-3 pt-2.5 border-t border-hairline/60 space-y-1.5" data-testid="usage-breakdown-bar">
      <div
        className="h-1.5 w-full bg-surface-sunken rounded-full overflow-hidden flex"
        title={`${t('usage.input', '输入')}: ${inPct.toFixed(0)}% · ${t('usage.output', '输出')}: ${outPct.toFixed(0)}% · ${t('usage.cache', '缓存')}: ${cachePct.toFixed(0)}%`}
      >
        {inPct > 0 && <div style={{ width: `${inPct}%` }} className="bg-sky-500 transition-all" />}
        {outPct > 0 && <div style={{ width: `${outPct}%` }} className="bg-amber-500 transition-all" />}
        {cachePct > 0 && <div style={{ width: `${cachePct}%` }} className="bg-emerald-500 transition-all" />}
      </div>
      <div className="flex items-center justify-between text-[11px] text-ink-mute tabular-nums gap-1">
        <span className="flex items-center gap-1 text-sky-600 dark:text-sky-400 min-w-0" title={`${t('usage.input', '输入')}: ${number(input)} tokens`}>
          <span className="w-1.5 h-1.5 rounded-full bg-sky-500 shrink-0" />
          <span className="truncate">{t('usage.input', '输入')} {formatToken(input, unit)}</span>
        </span>
        <span className="flex items-center gap-1 text-amber-600 dark:text-amber-400 min-w-0" title={`${t('usage.output', '输出')}: ${number(output)} tokens`}>
          <span className="w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0" />
          <span className="truncate">{t('usage.output', '输出')} {formatToken(output, unit)}</span>
        </span>
        <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400 min-w-0" title={`${t('usage.cache', '缓存')}: ${number(cache)} tokens`}>
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
          <span className="truncate">{t('usage.cache', '缓存')} {formatToken(cache, unit)}</span>
        </span>
      </div>
    </div>
  );
}

export default function Usage() {
  const { t } = useTranslation();
  const { unit, setUnit } = useUsageSettingsStore();

  const [daily, setDaily] = useState<UsageResult>();
  const [hours, setHours] = useState<UsageRow[]>([]);
  const [roles, setRoles] = useState<UsageRow[]>([]);
  const [models, setModels] = useState<UsageRow[]>([]);
  const [roleRows, setRoleRows] = useState<UsageRow[]>([]);
  const [modelRows, setModelRows] = useState<UsageRow[]>([]);
  const [todayRoles, setTodayRoles] = useState<UsageRow[]>([]);
  const [role, setRole] = useState('');
  const [model, setModel] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [selectedDay, setSelectedDay] = useState(dayKey(new Date()));
  // 后端日历的今天：取不带起止参数的查询返回的 to；拿到前先用浏览器日期占位。
  const [serverToday, setServerToday] = useState(dayKey(new Date()));
  const [selectedPreset, setSelectedPreset] = useState<DatePreset | null>('pastYear');
  // 用户自己改过起止（或从热力图挑过某天）之后，后端日历的今天再变也不动他的输入：
  // 2026-11-06 验收实测，先手动填 11-02..11-06、服务器日随后回来是 11-03 时，起止被悄悄
  // 改写成 11-02..11-03，用户填的范围被吞掉。
  const [datesTouched, setDatesTouched] = useState(false);
  const [dayPicked, setDayPicked] = useState(false);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [revision, setRevision] = useState(0);

  const refresh = useCallback(() => setRevision(v => v + 1), []);
  useEffect(() => { listProjects().then(p => setProjects(p.projects || [])).catch(() => {}); }, [revision]);
  const nameOf = shownNames(projects);
  useEffect(() => { window.addEventListener('cc:refresh', refresh); return () => window.removeEventListener('cc:refresh', refresh); }, [refresh]);

  const handleResetDates = () => {
    setStartDate('');
    setEndDate('');
    setSelectedPreset('pastYear');
    setError('');
  };

  const handleSelectPreset = (preset: DatePreset) => {
    const range = getPresetRange(preset, serverToday);
    setStartDate(range.from);
    setEndDate(range.to);
    setSelectedPreset(preset);
    setDatesTouched(false); // 点了预设＝愿意跟着后端日历走，跨日重算重新生效
    setError('');
  };

  const handleDateInput = (which: 'start' | 'end', value: string) => {
    const start = which === 'start' ? value : startDate;
    const end = which === 'end' ? value : endDate;
    setStartDate(start);
    setEndDate(end);
    setSelectedPreset(matchPreset(start, end, serverToday));
    setDatesTouched(true);
  };

  // 后端日历的今天变了（首次拿到或跨日）时，按所选预设重新推算起止，保持「今日/本周…」语义。
  useEffect(() => {
    if (datesTouched) return;
    if (!selectedPreset || selectedPreset === 'pastYear') return;
    const range = getPresetRange(selectedPreset, serverToday);
    setStartDate(range.from);
    setEndDate(range.to);
    // 只在 serverToday 变化时重算；selectedPreset 变化由点击处理函数自己设好起止。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverToday]);

  // 小时图与热力图选中环也跟后端日历走（原先一直用浏览器日，跨零点会比「今日卡」差一天）。
  useEffect(() => {
    if (dayPicked) return;
    setSelectedDay(serverToday);
  }, [serverToday, dayPicked]);

  useEffect(() => {
    let active = true;

    // Validate date range if both provided
    if (startDate && endDate) {
      if (startDate > endDate) {
        setError(t('usage.dateRangeInvalid'));
        return;
      }
      const dayDiff = (new Date(endDate).getTime() - new Date(startDate).getTime()) / (1000 * 3600 * 24);
      if (dayDiff > MAX_RANGE_DAYS) {
        setError(t('usage.dateRangeTooLong'));
        return;
      }
    }

    const baseFilter = { ...(role ? { role } : {}), ...(model ? { model } : {}) };
    const rangeFilter = {
      ...(startDate ? { from: startDate } : {}),
      ...(endDate ? { to: endDate } : {}),
    };
    const queryFilter = { ...baseFilter, ...rangeFilter };

    setLoading(true);
    Promise.all([
      getUsage('daily', queryFilter),
      getUsage('roles'),
      getUsage('models'),
      getUsage('roles', { from: serverToday, to: serverToday, ...baseFilter }),
      getUsage('roles', queryFilter),
      getUsage('models', queryFilter),
    ])
      .then(([d, r, m, today, filteredRoles, filteredModels]) => {
        if (active) {
          setDaily(d);
          setRoles(r.items || []);
          if (DAY_RE.test(r.to || '')) setServerToday(r.to);
          setModels(m.items || []);
          setTodayRoles(today.items || []);
          setRoleRows(filteredRoles.items || []);
          setModelRows(filteredModels.items || []);
          setError('');
        }
      })
      .catch(e => {
        if (active) setError(String(e.message));
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => { active = false; };
  }, [role, model, startDate, endDate, serverToday, revision]);

  useEffect(() => {
    let active = true;
    setHours([]);
    getUsage('hourly', { from: selectedDay, to: selectedDay, ...(role ? { role } : {}), ...(model ? { model } : {}) })
      .then(d => { if (active) setHours(d.items || []); })
      .catch(e => { if (active) setError(String(e.message)); });
    return () => { active = false; };
  }, [selectedDay, role, model, revision]);

  const rows = daily?.items || [];
  const today = rows.find(r => r.date === serverToday);
  const maxDay = Math.max(1, ...rows.map(r => r.total_tokens));
  const byDay = new Map(rows.map(r => [r.date, r]));
  const days: Date[] = [];
  if (daily) {
    const end = new Date(`${daily.to}T12:00:00`);
    for (const d = new Date(`${daily.from}T12:00:00`); d <= end; d.setDate(d.getDate() + 1)) days.push(new Date(d));
  }
  const maxHour = Math.max(1, ...hours.map(r => r.total_tokens));
  const peak = hours.reduce<UsageRow | undefined>((p, r) => !p || r.total_tokens > p.total_tokens ? r : p, undefined);
  const cost = rows.reduce((s, r) => s + (r.estimated_cost ?? 0), 0);
  const unknown = sum(rows, 'unknown_usage_responses');
  const priced = rows.some(r => r.estimated_cost !== undefined);
  const isCustomRange = Boolean(startDate || endDate);

  const todayInput = today?.input_tokens || 0;
  const todayOutput = today?.output_tokens || 0;
  const todayCache = (today?.cache_read_tokens || 0) + (today?.cache_write_tokens || 0);
  const todayTotal = today?.total_tokens || 0;

  const totalTokens = sum(rows, 'total_tokens');
  const totalInput = rows.reduce((s, r) => s + (r.input_tokens || 0), 0);
  const totalOutput = rows.reduce((s, r) => s + (r.output_tokens || 0), 0);
  const totalCache = rows.reduce((s, r) => s + ((r.cache_read_tokens || 0) + (r.cache_write_tokens || 0)), 0);

  const unitLabels: Record<TokenUnit, string> = {
    raw: t('usage.unitRawShort', '原数'),
    M: 'M',
    B: 'B',
  };

  const table = (items: UsageRow[], dimension: 'role' | 'model') => (
    <div className="overflow-x-auto">
      <table className="w-full text-sm text-left">
        <thead className="text-xs text-ink-mute">
          <tr>
            {['name', ...(dimension === 'role' ? ['replies'] : []), 'requests', 'input', 'output', 'cache', 'tokens', 'unknown', 'cost'].map(k => {
              let headerClass = `py-3 pr-4 font-medium ${k === 'name' ? '' : 'text-right'}`;
              let dotClass = '';
              if (k === 'input') {
                headerClass += ' text-sky-600 dark:text-sky-400';
                dotClass = 'bg-sky-500';
              } else if (k === 'output') {
                headerClass += ' text-amber-600 dark:text-amber-400';
                dotClass = 'bg-amber-500';
              } else if (k === 'cache') {
                headerClass += ' text-emerald-600 dark:text-emerald-400';
                dotClass = 'bg-emerald-500';
              } else if (k === 'tokens') {
                headerClass += ' font-semibold text-ink';
              }
              return (
                <th className={headerClass} key={k}>
                  {dotClass ? (
                    <span className="inline-flex items-center justify-end gap-1">
                      <span className={`w-1.5 h-1.5 rounded-full ${dotClass} shrink-0`} />
                      {t(`usage.${k}`)}
                    </span>
                  ) : (
                    t(`usage.${k}`)
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {items.map(r => {
            const cacheTokens = r.cache_read_tokens + r.cache_write_tokens;
            const tokenCols = [
              { key: 'input', val: r.input_tokens, color: 'text-sky-600 dark:text-sky-400 font-mono' },
              { key: 'output', val: r.output_tokens, color: 'text-amber-600 dark:text-amber-400 font-mono font-medium' },
              { key: 'cache', val: cacheTokens, color: 'text-emerald-600 dark:text-emerald-400 font-mono' },
              { key: 'tokens', val: r.total_tokens, color: 'text-ink font-mono font-semibold' },
            ];
            const sumParts = r.input_tokens + r.output_tokens + cacheTokens;
            const base = sumParts > 0 ? sumParts : r.total_tokens;
            const inPct = base > 0 ? (r.input_tokens / base) * 100 : 0;
            const outPct = base > 0 ? (r.output_tokens / base) * 100 : 0;
            const cachePct = base > 0 ? (cacheTokens / base) * 100 : 0;

            return (
              <tr key={r[dimension]} className="border-t border-hairline hover:bg-surface-raised/40 transition-colors">
                <td className="py-3 pr-4 font-medium">
                  <button className="text-accent hover:underline" onClick={() => dimension === 'role' ? setRole(r.role || '') : setModel(r.model || '')}>
                    {dimension === 'role' ? nameOf(r.role || '') : r.model}
                  </button>
                </td>
                {dimension === 'role' && <td className="pr-4 tabular-nums text-right text-ink-soft">{number(r.replies || 0)}</td>}
                <td className="pr-4 tabular-nums text-right text-ink-soft">{number(r.responses)}</td>
                {tokenCols.map(({ key, val, color }) => r.responses > 0 && r.unknown_usage_responses === r.responses ? (
                  <td key={key} className="pr-4 text-ink-mute whitespace-nowrap" title={t('usage.unavailableWhy')}>{t('usage.unavailable')}</td>
                ) : (
                  <td key={key} className={`pr-4 tabular-nums text-right ${color}`} title={`${t(`usage.${key}`)}: ${number(val)} tokens`}>
                    <div>{formatToken(val, unit)}</div>
                    {key === 'tokens' && r.total_tokens > 0 && (
                      <div
                        className="h-1 w-16 ml-auto bg-surface-sunken rounded-full overflow-hidden flex mt-1"
                        title={`${t('usage.input')}: ${inPct.toFixed(0)}% · ${t('usage.output')}: ${outPct.toFixed(0)}% · ${t('usage.cache')}: ${cachePct.toFixed(0)}%`}
                      >
                        {inPct > 0 && <div style={{ width: `${inPct}%` }} className="bg-sky-500" />}
                        {outPct > 0 && <div style={{ width: `${outPct}%` }} className="bg-amber-500" />}
                        {cachePct > 0 && <div style={{ width: `${cachePct}%` }} className="bg-emerald-500" />}
                      </div>
                    )}
                  </td>
                ))}
                <td className="pr-4 tabular-nums text-right text-ink-mute" title={t('usage.unavailableWhy')}>{number(r.unknown_usage_responses)}</td>
                <td className="whitespace-nowrap text-right tabular-nums">{r.estimated_cost === undefined ? '—' : r.estimated_cost.toFixed(4)}{r.unpriced_responses > 0 && ' *'}</td>
              </tr>
            );
          })}
          {!items.length && <tr><td colSpan={dimension === 'role' ? 9 : 8} className="py-6 text-center text-ink-mute">{t('usage.empty')}</td></tr>}
        </tbody>
      </table>
    </div>
  );

  return (
    <div className="space-y-5 animate-fade-in text-ink">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-lg font-semibold text-ink">
            <Activity className="text-accent-text" size={20} />
            {t('usage.title')}
          </h1>
          <p className="mt-0.5 text-sm text-ink-mute">{t('usage.subtitle')}</p>
        </div>
        <div className="flex flex-wrap gap-2 items-center">
          {/* Quick Date Presets */}
          <div
            role="group"
            aria-label={t('usage.quickFilters', '快捷筛选')}
            className="flex rounded-lg border border-hairline bg-surface p-0.5 text-xs shadow-sm"
            data-testid="usage-date-presets"
          >
            {(['today', 'thisWeek', 'thisMonth', 'last7Days', 'pastYear'] as const).map(p => {
              const isActive = selectedPreset === p;
              const labelMap: Record<DatePreset, string> = {
                today: t('usage.presetToday', '今日'),
                thisWeek: t('usage.presetThisWeek', '本周'),
                thisMonth: t('usage.presetThisMonth', '本月'),
                last7Days: t('usage.presetLast7Days', '近7天'),
                pastYear: t('usage.presetPastYear', '近一年'),
              };
              return (
                <button
                  key={p}
                  type="button"
                  onClick={() => handleSelectPreset(p)}
                  data-testid={`usage-preset-${p}`}
                  className={cn(
                    'px-2.5 py-1.5 rounded-md font-medium transition-colors',
                    isActive
                      ? 'bg-accent text-white shadow-sm'
                      : 'text-ink-soft hover:text-ink'
                  )}
                  aria-pressed={isActive}
                  title={p === 'pastYear' ? t('usage.presetPastYearHint', '默认范围：今天往前一年（后端单次最多查一年）') : labelMap[p]}
                >
                  {labelMap[p]}
                </button>
              );
            })}
          </div>

          {/* Token Unit Toggle (raw / M / B) */}
          <div
            role="radiogroup"
            aria-label={t('usage.tokenUnit', '显示单位')}
            className="flex rounded-lg border border-hairline bg-surface p-0.5 text-xs shadow-sm"
            data-testid="usage-unit-selector"
          >
            {TOKEN_UNITS.map(u => (
              <button
                key={u}
                type="button"
                role="radio"
                aria-checked={unit === u}
                onClick={() => setUnit(u)}
                data-testid={`usage-unit-option-${u}`}
                className={cn(
                  'px-2.5 py-1.5 rounded-md font-medium transition-colors',
                  unit === u
                    ? 'bg-accent text-white shadow-sm'
                    : 'text-ink-soft hover:text-ink'
                )}
                title={t(`usage.unit${u === 'raw' ? 'Raw' : u}`)}
              >
                {unitLabels[u]}
              </button>
            ))}
          </div>

          {/* Custom Date Range Picker */}
          <div className="flex items-center gap-1.5 text-xs bg-surface border border-hairline rounded-lg px-2.5 py-1.5 shadow-sm">
            <Calendar size={14} className="text-ink-mute shrink-0" />
            <input
              aria-label={t('usage.startDate')}
              type="date"
              value={startDate}
              onChange={e => handleDateInput('start', e.target.value)}
              className="bg-transparent text-ink text-xs focus:outline-none"
              data-testid="usage-start-date"
            />
            <span className="text-ink-mute">—</span>
            <input
              aria-label={t('usage.endDate')}
              type="date"
              value={endDate}
              onChange={e => handleDateInput('end', e.target.value)}
              className="bg-transparent text-ink text-xs focus:outline-none"
              data-testid="usage-end-date"
            />
            {isCustomRange && (
              <button
                type="button"
                onClick={handleResetDates}
                aria-label={t('usage.resetRange')}
                title={t('usage.resetRange')}
                className="text-ink-mute hover:text-ink ml-1"
                data-testid="usage-reset-dates"
              >
                <X size={14} />
              </button>
            )}
          </div>

          {/* Role Filter */}
          <select
            aria-label={t('usage.roles')}
            value={role}
            onChange={e => setRole(e.target.value)}
            className="bg-surface border border-hairline rounded-lg px-3 py-2 text-sm shadow-sm"
          >
            <option value="">{t('usage.allRoles')}</option>
            {roles.map(r => <option key={r.role} value={r.role}>{nameOf(r.role || '')}</option>)}
          </select>

          {/* Model Filter */}
          <select
            aria-label={t('usage.models')}
            value={model}
            onChange={e => setModel(e.target.value)}
            className="bg-surface border border-hairline rounded-lg px-3 py-2 text-sm shadow-sm"
          >
            <option value="">{t('usage.allModels')}</option>
            {models.map(r => <option key={r.model}>{r.model}</option>)}
          </select>

          {/* Refresh Button */}
          <button
            onClick={refresh}
            aria-label={t('usage.refresh')}
            className="p-2 text-ink-mute hover:text-ink transition-colors"
          >
            <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {error && <div role="alert" className="p-4 rounded-card bg-red-500/10 text-red-500 text-sm font-medium">{error}</div>}

      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
        {/* Card 1: Today Tokens */}
        <div className={cn(panel, 'flex flex-col justify-between')}>
          <div>
            <div className="text-xs text-ink-mute mb-2">{t('usage.todayTokens')}</div>
            <div className="text-2xl font-semibold tabular-nums text-ink truncate" title={`${number(todayTotal)} tokens`}>
              {formatToken(todayTotal, unit)}
            </div>
          </div>
          <TokenBreakdownBar input={todayInput} output={todayOutput} cache={todayCache} total={todayTotal} unit={unit} />
        </div>

        {/* Card 2: Today Responses */}
        <div className={cn(panel, 'flex flex-col justify-between')}>
          <div>
            <div className="text-xs text-ink-mute mb-2">{t('usage.todayResponses')}</div>
            <div className="text-2xl font-semibold tabular-nums text-ink truncate" title={`${number(today?.replies || 0)}`}>
              {number(today?.replies || 0)}
            </div>
          </div>
          <div className="mt-3 pt-2.5 border-t border-hairline/60 text-[11px] text-ink-mute flex items-center justify-between">
            <span>{t('usage.requests')}: {number(today?.responses || 0)}</span>
            <span>{t('usage.unknown')}: {number(today?.unknown_usage_responses || 0)}</span>
          </div>
        </div>

        {/* Card 3: Custom / Year Tokens */}
        <div className={cn(panel, 'flex flex-col justify-between')}>
          <div>
            <div className="text-xs text-ink-mute mb-2">{isCustomRange ? t('usage.customTokens') : t('usage.yearTokens')}</div>
            <div className="text-2xl font-semibold tabular-nums text-ink truncate" title={`${number(totalTokens)} tokens`}>
              {formatToken(totalTokens, unit)}
            </div>
          </div>
          <TokenBreakdownBar input={totalInput} output={totalOutput} cache={totalCache} total={totalTokens} unit={unit} />
        </div>

        {/* Card 4: Estimated Cost */}
        <div className={cn(panel, 'flex flex-col justify-between')}>
          <div>
            <div className="text-xs text-ink-mute mb-2">{t('usage.cost')}</div>
            <div className="text-2xl font-semibold tabular-nums text-ink truncate">
              {priced ? cost.toFixed(4) : t('usage.unpriced')}
            </div>
          </div>
          <div className="mt-3 pt-2.5 border-t border-hairline/60 text-[11px] text-ink-mute truncate">
            {priced ? (
              <span>{t('usage.note', { unknown, unpriced: sum(rows, 'unpriced_responses') }).split('。')[0]}</span>
            ) : (
              <span>{t('usage.unpriced')}</span>
            )}
          </div>
        </div>
      </div>

      <section className={panel}>
        <div className="flex justify-between items-center mb-4">
          <h2 className="font-semibold">{t('usage.heatmap')}</h2>
          <span className="text-xs text-ink-mute">{daily?.from} — {daily?.to} · {daily?.timezone}</span>
        </div>
        <div className="overflow-x-auto pb-2">
          <div className="grid grid-rows-7 grid-flow-col gap-[3px] w-max" style={{ paddingTop: 2 }}>
            {days.map((d, i) => {
              const key = dayKey(d), r = byDay.get(key), total = r?.total_tokens || 0;
              const level = total === 0 ? 0 : Math.min(4, Math.ceil(total / maxDay * 4));
              const tokenDisplay = formatToken(total, unit);
              return (
                <button
                  key={key}
                  aria-label={`${key}: ${tokenDisplay}, ${r?.unknown_usage_responses || 0} ${t('usage.unknown')}`}
                  title={`${key} · ${tokenDisplay} (${number(total)} tokens) · ${r?.replies || 0} ${t('usage.replies')} · ${r?.unknown_usage_responses || 0} ${t('usage.unknown')}`}
                  onClick={() => { setDayPicked(true); setSelectedDay(key); }}
                  style={{ gridRow: i === 0 ? d.getDay() + 1 : undefined }}
                  className={`w-[14px] h-[14px] rounded-[3px] ${colors[level]} ${selectedDay === key ? 'ring-2 ring-accent ring-offset-1 dark:ring-offset-canvas' : ''} ${r?.unknown_usage_responses ? 'border border-amber-500/70' : ''}`}
                />
              );
            })}
          </div>
        </div>
        <div className="flex justify-between text-xs text-ink-mute mt-3">
          <span>{t('usage.clickDay')}</span>
          <div className="flex items-center gap-1.5">
            {t('usage.less')}
            {colors.map(c => <span key={c} className={`w-3 h-3 rounded-sm ${c}`} />)}
            {t('usage.more')}
          </div>
        </div>
      </section>

      <section className={panel}>
        <div className="flex flex-wrap justify-between items-center gap-2 mb-4">
          <h2 className="font-semibold">{t('usage.hourly')}</h2>
          <div className="flex gap-3 items-center text-xs text-ink-mute">
            {peak && peak.total_tokens > 0 && (
              <span title={`${number(peak.total_tokens)} tokens`}>
                {t('usage.peak')}: {String(peak.hour).padStart(2, '0')}:00 · {formatToken(peak.total_tokens, unit)} tokens
              </span>
            )}
            <input
              aria-label={t('usage.day')}
              type="date"
              value={selectedDay}
              onChange={e => { if (e.target.value) { setDayPicked(true); setSelectedDay(e.target.value); } }}
              className="bg-transparent rounded border border-hairline px-2 py-1"
            />
          </div>
        </div>
        <div className="h-32 flex gap-1 sm:gap-2 items-end border-b border-hairline">
          {Array.from({ length: 24 }, (_, hour) => {
            const r = hours.find(r => r.hour === hour), total = r?.total_tokens || 0;
            const tokenDisplay = formatToken(total, unit);
            return (
              <div
                key={hour}
                className="flex-1 h-full flex items-end"
                title={`${hour}:00 · ${tokenDisplay} (${number(total)} tokens) · ${r?.unknown_usage_responses || 0} ${t('usage.unknown')}`}
              >
                <div
                  className={`w-full rounded-t ${peak?.hour === hour && total ? 'bg-accent' : 'bg-accent/70'}`}
                  style={{ height: `${Math.max(total ? 2 : 0, total / maxHour * 100)}%` }}
                />
              </div>
            );
          })}
        </div>
        <div className="flex text-[10px] text-ink-mute mt-2">
          {Array.from({ length: 24 }, (_, h) => (
            <span key={h} className="flex-1 text-center">{String(h).padStart(2, '0')}</span>
          ))}
        </div>
        {!hours.length && <p className="text-xs text-ink-mute mt-3">{t('usage.empty')}</p>}
      </section>

      <section className={panel}>
        <h2 className="font-semibold">{t('usage.todayRoles')}</h2>
        {table(todayRoles, 'role')}
      </section>

      <div className="grid grid-cols-1 gap-5">
        <section className={panel}>
          <h2 className="font-semibold">{isCustomRange ? t('usage.customRoles') : t('usage.roles')}</h2>
          {table(roleRows, 'role')}
        </section>
        <section className={panel}>
          <h2 className="font-semibold">{isCustomRange ? t('usage.customModels') : t('usage.models')}</h2>
          {table(modelRows, 'model')}
        </section>
      </div>

      <p className="text-xs text-ink-mute leading-relaxed">{t('usage.note', { unknown, unpriced: sum(rows, 'unpriced_responses') })}</p>
    </div>
  );
}
