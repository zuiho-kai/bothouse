import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getUsage, type UsageRow } from '@/api/usage';

export default function UsageMembers({ from, to, role, model, revision }: {
  from: string; to: string; role: string; model: string; revision: number;
}) {
  const { t } = useTranslation();
  const [rows, setRows] = useState<UsageRow[]>([]);
  const [member, setMember] = useState('');
  const [sort, setSort] = useState('tokens');
  const [group, setGroup] = useState<'daily' | 'roles' | 'models'>('daily');
  const [detail, setDetail] = useState<UsageRow[]>([]);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    setRows([]); setError('');
    getUsage('members', { from, to, role, model })
      .then(r => { if (active) setRows(r.items); })
      .catch(e => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [from, to, role, model, revision]);
  useEffect(() => {
    let active = true;
    setDetail([]);
    if (member) getUsage(group, { from, to, role, model, member })
      .then(r => { if (active) setDetail(r.items); })
      .catch(e => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [from, to, role, model, member, group, revision]);
  const total = rows.reduce((n, r) => n + r.total_tokens, 0);
  const sorted = [...rows].sort((a, b) => sort === 'cost'
    ? (b.estimated_cost ?? -1) - (a.estimated_cost ?? -1)
    : b.total_tokens - a.total_tokens);
  const name = (id?: string) => id === 'system' ? t('usage.membersSystem') : id;
  const cols = ['tokens', 'input', 'output', 'membersCacheRead', 'membersCacheWrite', 'requests', 'cost'] as const;
  const cells = (r: UsageRow) => <>
    {[r.total_tokens, r.input_tokens, r.output_tokens, r.cache_read_tokens, r.cache_write_tokens, r.responses].map((n, i) => <td key={i} className="p-2 text-right tabular-nums">{n.toLocaleString()}</td>)}
    <td className="p-2 text-right tabular-nums">{r.estimated_cost === undefined ? '—' : `$${r.estimated_cost.toFixed(4)}`}{r.unpriced_responses > 0 && ' *'}</td>
  </>;
  return <section className="rounded-card bg-surface p-5 ring-1 ring-hairline" aria-label={t('usage.membersTitle')}>
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 className="font-semibold">{t('usage.membersTitle')}</h2>
      <select aria-label={t('usage.membersSort')} value={sort} onChange={e => setSort(e.target.value)} className="bg-surface-sunken rounded p-2">
        <option value="tokens">{t('usage.tokens')}</option><option value="cost">{t('usage.cost')}</option>
      </select>
    </div>
    <p className="text-xs text-ink-mute my-3">{t('usage.membersNote')}</p>
    {error && <p role="alert">{error}</p>}
    <div className="overflow-x-auto"><table className="w-full text-sm whitespace-nowrap">
      <thead><tr><th className="p-2">{t('usage.membersRank')}</th><th className="p-2 text-left">{t('usage.membersMember')}</th>{cols.map(c => <th className="p-2 text-right" key={c}>{t(`usage.${c}`)}</th>)}<th className="p-2">{t('usage.membersShare')}</th></tr></thead>
      <tbody>{sorted.map((r, i) => <tr key={r.member} className="border-t border-hairline">
        <td className="p-2 text-center">{i + 1}</td><td className="p-2"><button className="text-accent underline" onClick={() => setMember(member === r.member ? '' : r.member!)}>{name(r.member)}</button></td>
        {cells(r)}<td className="p-2 text-right">{total ? (100 * r.total_tokens / total).toFixed(1) : '0.0'}%</td>
      </tr>)}</tbody>
    </table></div>
    {!rows.length && !error && <p className="text-xs text-ink-mute mt-3">{t('usage.empty')}</p>}
    {member && <div className="mt-5 border-t border-hairline pt-4">
      <div className="flex flex-wrap items-center justify-between gap-3"><h3>{name(member)}</h3><select aria-label={t('usage.membersDetail')} value={group} onChange={e => setGroup(e.target.value as typeof group)} className="bg-surface-sunken rounded p-2">
        <option value="daily">{t('usage.membersDaily')}</option><option value="roles">{t('usage.roles')}</option><option value="models">{t('usage.models')}</option>
      </select></div>
      <div className="overflow-x-auto"><table className="w-full text-sm whitespace-nowrap"><thead><tr><th className="p-2 text-left">{t('usage.name')}</th>{cols.map(c => <th className="p-2 text-right" key={c}>{t(`usage.${c}`)}</th>)}</tr></thead><tbody>{detail.map((r, i) => <tr key={i} className="border-t border-hairline"><td className="p-2">{r.date || r.role || r.model}</td>{cells(r)}</tr>)}</tbody></table></div>
      {!detail.length && <p className="text-xs text-ink-mute mt-3">{t('usage.empty')}</p>}
    </div>}
  </section>;
}
