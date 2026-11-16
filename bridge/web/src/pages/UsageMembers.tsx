import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getUsage, type UsageRow } from '@/api/usage';
import { formatToken, type TokenUnit } from '@/store/usageSettings';

export default function UsageMembers({ from, to, role, model, revision, unit, nameOf }: {
  from: string; to: string; role: string; model: string; revision: number; unit: TokenUnit; nameOf: (role: string) => string;
}) {
  const { t } = useTranslation();
  const [rows, setRows] = useState<UsageRow[]>([]);
  const [selected, setSelected] = useState('');
  const [sort, setSort] = useState('tokens');
  const [details, setDetails] = useState<{ daily: UsageRow[]; roles: UsageRow[]; models: UsageRow[] }>();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const keyOf = (r: UsageRow) => r.member ? `${r.member.platform}:${r.member.account}` : 'unattributed';
  const label = (r: UsageRow) => r.member ? (r.member.name || r.member.account) : t('usage.membersUnattributed');
  useEffect(() => {
    let active = true;
    const params = { ...(from ? { from } : {}), ...(to ? { to } : {}), ...(role ? { role } : {}), ...(model ? { model } : {}) };
    setLoading(true);
    setDetails(undefined);
    Promise.all([
      getUsage('members', params),
      selected ? Promise.all(['daily', 'roles', 'models'].map(g => getUsage(g as 'daily' | 'roles' | 'models', { ...params, member: selected }))) : Promise.resolve(undefined),
    ]).then(([members, detail]) => {
      if (!active) return;
      setRows(members.items);
      setDetails(detail ? { daily: detail[0].items, roles: detail[1].items, models: detail[2].items } : undefined);
      setError('');
    }).catch(e => { if (active) setError(String(e.message)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [from, to, role, model, revision, selected]);
  const total = rows.reduce((sum, r) => sum + r.total_tokens, 0);
  const ordered = [...rows].sort((a, b) => sort === 'cost'
    ? (b.estimated_cost ?? -1) - (a.estimated_cost ?? -1) || keyOf(a).localeCompare(keyOf(b))
    : b.total_tokens - a.total_tokens || keyOf(a).localeCompare(keyOf(b)));
  const tokens = (r: UsageRow, value: number) => r.responses > 0 && r.responses === r.unknown_usage_responses ? t('usage.unavailable') : formatToken(value, unit);
  const cost = (r: UsageRow) => r.estimated_cost === undefined ? '—' : `${r.estimated_cost.toFixed(4)}${r.unpriced_responses ? ' *' : ''}`;
  return <section className="rounded-card bg-surface p-5 ring-1 ring-hairline min-w-0" aria-label={t('usage.members')}>
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 className="font-semibold">{t('usage.members')}</h2>
      <select aria-label={t('usage.membersSort')} value={sort} onChange={e => setSort(e.target.value)} className="bg-surface border border-hairline rounded-lg px-3 py-2 text-sm">
        <option value="tokens">{t('usage.tokens')}</option><option value="cost">{t('usage.cost')}</option>
      </select>
    </div>
    <p className="text-xs text-ink-mute mt-2">{t('usage.membersNote')}</p>
    {error && <p role="alert" className="text-red-500 mt-3">{error}</p>}
    <div className="overflow-x-auto mt-3" aria-busy={loading}>
      <table className="w-full text-sm text-left">
        <thead className="text-xs text-ink-mute"><tr>
          {['membersRank', 'membersPerson', 'tokens', 'input', 'output', 'membersCacheRead', 'membersCacheWrite', 'requests', 'cost', 'membersShare'].map(k => <th key={k} className="pr-4 py-2 whitespace-nowrap">{t(`usage.${k}`)}</th>)}
        </tr></thead>
        <tbody>{ordered.map((r, i) => <tr key={keyOf(r)} className="border-t border-hairline">
          <td className="py-3 pr-4">{i + 1}</td>
          <td className="py-3 pr-4 min-w-40 max-w-64"><button className="text-accent hover:underline break-all text-left" onClick={() => setSelected(keyOf(r))}>{label(r)}</button>
            {r.member && <div className="text-xs text-ink-mute break-all">{r.member.platform} · {r.member.account}</div>}</td>
          {[r.total_tokens, r.input_tokens, r.output_tokens, r.cache_read_tokens, r.cache_write_tokens].map((v, n) => <td key={n} className="pr-4 tabular-nums whitespace-nowrap" title={String(v)}>{tokens(r, v)}</td>)}
          <td className="pr-4 tabular-nums">{r.responses.toLocaleString()}</td><td className="pr-4 tabular-nums whitespace-nowrap">{cost(r)}</td>
          <td className="tabular-nums">{r.unknown_usage_responses || !total ? '—' : `${(r.total_tokens / total * 100).toFixed(1)}%`}</td>
        </tr>)}{!rows.length && !loading && <tr><td colSpan={10} className="py-6 text-center text-ink-mute">{t('usage.empty')}</td></tr>}</tbody>
      </table>
    </div>
    {selected && <div className="mt-5 border-t border-hairline pt-4 space-y-4">
      <div className="flex flex-wrap justify-between gap-2"><h3 className="font-semibold break-all">{t('usage.membersDetail')} · {rows.find(r => keyOf(r) === selected) ? label(rows.find(r => keyOf(r) === selected)!) : selected}</h3>
        <button className="text-accent" onClick={() => setSelected('')}>{t('usage.membersClose')}</button></div>
      {details && (['daily', 'roles', 'models'] as const).map(group => <div key={group}>
        <h4 className="text-sm font-medium mb-2">{t(group === 'daily' ? 'usage.membersDaily' : `usage.${group}`)}</h4>
        <div className="overflow-x-auto"><table className="w-full text-sm"><tbody>{details[group].map(r => <tr key={r.date || r.role || r.model} className="border-t border-hairline">
          <td className="py-2 pr-4 break-all text-left">{r.date || (r.role ? nameOf(r.role) : r.model)}</td>
          <td className="pr-4 text-right tabular-nums">{tokens(r, r.total_tokens)} tokens</td><td className="text-right tabular-nums">{cost(r)}</td>
        </tr>)}</tbody></table></div>{!details[group].length && <p className="text-sm text-ink-mute">{t('usage.empty')}</p>}
      </div>)}
    </div>}
  </section>;
}
