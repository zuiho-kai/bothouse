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
const panel = 'rounded-2xl border border-gray-200/80 dark:border-white/[0.08] bg-white/80 dark:bg-white/[0.025] p-5';
const colors = ['bg-gray-100 dark:bg-white/[0.07]', 'bg-emerald-200 dark:bg-emerald-950', 'bg-emerald-300 dark:bg-emerald-800', 'bg-emerald-500 dark:bg-emerald-600', 'bg-emerald-700 dark:bg-emerald-400'];

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
    setError('');
  };

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
      getUsage('roles', { from: dayKey(new Date()), to: dayKey(new Date()), ...baseFilter }),
      getUsage('roles', queryFilter),
      getUsage('models', queryFilter),
    ])
      .then(([d, r, m, today, filteredRoles, filteredModels]) => {
        if (active) {
          setDaily(d);
          setRoles(r.items || []);
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
  }, [role, model, startDate, endDate, revision]);

  useEffect(() => {
    let active = true;
    setHours([]);
    getUsage('hourly', { from: selectedDay, to: selectedDay, ...(role ? { role } : {}), ...(model ? { model } : {}) })
      .then(d => { if (active) setHours(d.items || []); })
      .catch(e => { if (active) setError(String(e.message)); });
    return () => { active = false; };
  }, [selectedDay, role, model, revision]);

  const rows = daily?.items || [];
  const today = rows.find(r => r.date === dayKey(new Date()));
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

  const unitLabels: Record<TokenUnit, string> = {
    raw: t('usage.unitRawShort', '原数'),
    M: 'M',
    B: 'B',
  };

  const table = (items: UsageRow[], dimension: 'role' | 'model') => (
    <div className="overflow-x-auto">
      <table className="w-full text-sm text-left">
        <thead className="text-xs text-gray-400">
          <tr>
            {['name', ...(dimension === 'role' ? ['replies'] : []), 'requests', 'input', 'output', 'cache', 'tokens', 'unknown', 'cost'].map(k => (
              <th className="py-3 pr-4 font-medium" key={k}>{t(`usage.${k}`)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {items.map(r => {
            const rawTokens = [r.input_tokens, r.output_tokens, r.cache_read_tokens + r.cache_write_tokens, r.total_tokens];
            return (
              <tr key={r[dimension]} className="border-t border-gray-100 dark:border-white/[0.06]">
                <td className="py-3 pr-4 font-medium">
                  <button className="text-accent hover:underline" onClick={() => dimension === 'role' ? setRole(r.role || '') : setModel(r.model || '')}>
                    {dimension === 'role' ? nameOf(r.role || '') : r.model}
                  </button>
                </td>
                {dimension === 'role' && <td className="pr-4 tabular-nums">{number(r.replies || 0)}</td>}
                <td className="pr-4 tabular-nums">{number(r.responses)}</td>
                {rawTokens.map((v, i) => r.responses > 0 && r.unknown_usage_responses === r.responses ? (
                  <td key={i} className="pr-4 text-gray-400 whitespace-nowrap" title={t('usage.unavailableWhy')}>{t('usage.unavailable')}</td>
                ) : (
                  <td key={i} className="pr-4 tabular-nums" title={`${number(v)} tokens`}>
                    {formatToken(v, unit)}
                  </td>
                ))}
                <td className="pr-4 tabular-nums" title={t('usage.unavailableWhy')}>{number(r.unknown_usage_responses)}</td>
                <td className="whitespace-nowrap">{r.estimated_cost === undefined ? '—' : r.estimated_cost.toFixed(4)}{r.unpriced_responses > 0 && ' *'}</td>
              </tr>
            );
          })}
          {!items.length && <tr><td colSpan={dimension === 'role' ? 9 : 8} className="py-6 text-center text-gray-400">{t('usage.empty')}</td></tr>}
        </tbody>
      </table>
    </div>
  );

  return (
    <div className="space-y-5 animate-fade-in text-gray-900 dark:text-gray-100">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
            <Activity className="text-accent" size={24} />
            {t('usage.title')}
          </h1>
          <p className="text-sm text-gray-400 mt-1">{t('usage.subtitle')}</p>
        </div>
        <div className="flex flex-wrap gap-2 items-center">
          {/* Token Unit Toggle (raw / M / B) */}
          <div
            role="radiogroup"
            aria-label={t('usage.tokenUnit', '显示单位')}
            className="flex rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-0.5 text-xs shadow-sm"
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
                    : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
                )}
                title={t(`usage.unit${u === 'raw' ? 'Raw' : u}`)}
              >
                {unitLabels[u]}
              </button>
            ))}
          </div>

          {/* Custom Date Range Picker */}
          <div className="flex items-center gap-1.5 text-xs bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg px-2.5 py-1.5 shadow-sm">
            <Calendar size={14} className="text-gray-400 shrink-0" />
            <input
              aria-label={t('usage.startDate')}
              type="date"
              value={startDate}
              onChange={e => setStartDate(e.target.value)}
              className="bg-transparent text-gray-900 dark:text-gray-100 text-xs focus:outline-none"
              data-testid="usage-start-date"
            />
            <span className="text-gray-400">—</span>
            <input
              aria-label={t('usage.endDate')}
              type="date"
              value={endDate}
              onChange={e => setEndDate(e.target.value)}
              className="bg-transparent text-gray-900 dark:text-gray-100 text-xs focus:outline-none"
              data-testid="usage-end-date"
            />
            {isCustomRange && (
              <button
                type="button"
                onClick={handleResetDates}
                aria-label={t('usage.resetRange')}
                title={t('usage.resetRange')}
                className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 ml-1"
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
            className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 text-sm shadow-sm"
          >
            <option value="">{t('usage.allRoles')}</option>
            {roles.map(r => <option key={r.role} value={r.role}>{nameOf(r.role || '')}</option>)}
          </select>

          {/* Model Filter */}
          <select
            aria-label={t('usage.models')}
            value={model}
            onChange={e => setModel(e.target.value)}
            className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 text-sm shadow-sm"
          >
            <option value="">{t('usage.allModels')}</option>
            {models.map(r => <option key={r.model}>{r.model}</option>)}
          </select>

          {/* Refresh Button */}
          <button
            onClick={refresh}
            aria-label={t('usage.refresh')}
            className="p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors"
          >
            <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {error && <div role="alert" className="p-4 rounded-xl bg-red-500/10 text-red-500 text-sm font-medium">{error}</div>}

      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
        {[
          [t('usage.todayTokens'), formatToken(today?.total_tokens || 0, unit), `${number(today?.total_tokens || 0)} tokens`],
          [t('usage.todayResponses'), number(today?.replies || 0), `${number(today?.replies || 0)}`],
          [isCustomRange ? t('usage.customTokens') : t('usage.yearTokens'), formatToken(sum(rows, 'total_tokens'), unit), `${number(sum(rows, 'total_tokens'))} tokens`],
          [t('usage.cost'), priced ? cost.toFixed(4) : t('usage.unpriced'), undefined],
        ].map(([label, value, title]) => (
          <div key={label} className={panel}>
            <div className="text-xs text-gray-400 mb-2">{label}</div>
            <div className="text-2xl font-semibold tabular-nums text-accent truncate" title={title}>
              {value}
            </div>
          </div>
        ))}
      </div>

      <section className={panel}>
        <div className="flex justify-between items-center mb-4">
          <h2 className="font-semibold">{t('usage.heatmap')}</h2>
          <span className="text-xs text-gray-400">{daily?.from} — {daily?.to} · {daily?.timezone}</span>
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
                  onClick={() => setSelectedDay(key)}
                  style={{ gridRow: i === 0 ? d.getDay() + 1 : undefined }}
                  className={`w-[14px] h-[14px] rounded-[3px] ${colors[level]} ${selectedDay === key ? 'ring-2 ring-accent ring-offset-1 dark:ring-offset-gray-950' : ''} ${r?.unknown_usage_responses ? 'border border-amber-500/70' : ''}`}
                />
              );
            })}
          </div>
        </div>
        <div className="flex justify-between text-xs text-gray-400 mt-3">
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
          <div className="flex gap-3 items-center text-xs text-gray-400">
            {peak && peak.total_tokens > 0 && (
              <span title={`${number(peak.total_tokens)} tokens`}>
                {t('usage.peak')}: {String(peak.hour).padStart(2, '0')}:00 · {formatToken(peak.total_tokens, unit)} tokens
              </span>
            )}
            <input
              aria-label={t('usage.day')}
              type="date"
              value={selectedDay}
              onChange={e => { if (e.target.value) setSelectedDay(e.target.value); }}
              className="bg-transparent rounded border border-gray-200 dark:border-gray-700 px-2 py-1"
            />
          </div>
        </div>
        <div className="h-32 flex gap-1 sm:gap-2 items-end border-b border-gray-200 dark:border-gray-800">
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
                  className={`w-full rounded-t ${peak?.hour === hour && total ? 'bg-emerald-400' : 'bg-emerald-600/70'}`}
                  style={{ height: `${Math.max(total ? 2 : 0, total / maxHour * 100)}%` }}
                />
              </div>
            );
          })}
        </div>
        <div className="flex text-[10px] text-gray-400 mt-2">
          {Array.from({ length: 24 }, (_, h) => (
            <span key={h} className="flex-1 text-center">{String(h).padStart(2, '0')}</span>
          ))}
        </div>
        {!hours.length && <p className="text-xs text-gray-400 mt-3">{t('usage.empty')}</p>}
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

      <p className="text-xs text-gray-400 leading-relaxed">{t('usage.note', { unknown, unpriced: sum(rows, 'unpriced_responses') })}</p>
    </div>
  );
}
