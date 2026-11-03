/**
 * Token usage main panel (#105): the same numbers as the bothouse panel's Usage page
 * (bridge/web/src/pages/Usage.tsx), read through the collab host's owner-only
 * /collab/api/usage/* route so the panel token never reaches the browser.
 */
import { useCallback, useEffect, useState } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { NS } from './locales.ts'
import styles from './PanelPages.module.css'

/** One ledger row (bridge/web/src/api/usage.ts UsageRow). */
export interface UsageRow {
  date?: string
  role?: string
  model?: string
  input_tokens: number
  output_tokens: number
  cache_read_tokens: number
  cache_write_tokens: number
  total_tokens: number
  responses: number
  replies?: number
  unknown_usage_responses: number
  estimated_cost?: number
  unpriced_responses: number
}

/** One usage answer (bridge/core/management_usage.go). */
export interface UsageResult {
  from: string
  to: string
  timezone: string
  items: UsageRow[] | null
}

export type UsagePageProps = PropsRuntime<'main'> & PropsLocale<typeof NS>

type Fetcher = (input: string) => Promise<Response>

const dayKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

/**
 * Short token count: 1234 → 1.2K, 3456789 → 3.46M.
 * @param n - token count.
 * @returns compact text.
 */
export function compactTokens(n: number): string {
  if (!Number.isFinite(n) || n === 0) return '0'
  const abs = Math.abs(n)
  if (abs >= 1e9) return `${(n / 1e9).toFixed(2)}B`
  if (abs >= 1e6) return `${(n / 1e6).toFixed(2)}M`
  if (abs >= 1e3) return `${(n / 1e3).toFixed(1)}K`
  return String(n)
}

const total = (rows: UsageRow[], key: 'total_tokens' | 'responses') => rows.reduce((s, r) => s + r[key], 0)
const cost = (rows: UsageRow[]) => rows.some(r => r.estimated_cost !== undefined)
  ? rows.reduce((s, r) => s + (r.estimated_cost ?? 0), 0).toFixed(2)
  : '—'

/**
 * Load one usage group through the collab route.
 * @param fetcher - same-origin fetch.
 * @param group - daily | roles | models.
 * @param params - from/to filters.
 * @returns the parsed answer.
 */
export async function loadUsage(fetcher: Fetcher, group: 'daily' | 'roles' | 'models', params: Record<string, string> = {}): Promise<UsageResult> {
  const query = new URLSearchParams(params).toString()
  const res = await fetcher(new URL(`collab/api/usage/${group}${query ? `?${query}` : ''}`, document.baseURI).toString())
  const body = await res.json().catch(() => ({})) as Partial<UsageResult> & { reason?: string; error?: string }
  if (!res.ok) throw new Error(body.reason || body.error || `HTTP ${res.status}`)
  return { from: body.from ?? '', to: body.to ?? '', timezone: body.timezone ?? '', items: body.items ?? [] }
}

const sameOrigin: Fetcher = input => fetch(input, { credentials: 'same-origin' })

interface Loaded {
  daily: UsageResult
  roles: UsageRow[]
  models: UsageRow[]
  today: UsageRow[]
}

/**
 * Usage overview: today and the ledger's default range (one year), daily bars, per role and per model.
 * @param props - locale share.
 * @returns the usage page.
 */
export function UsagePage({ t }: UsagePageProps) {
  const [data, setData] = useState<Loaded>()
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [revision, setRevision] = useState(0)
  const refresh = useCallback(() => setRevision(v => v + 1), [])

  useEffect(() => {
    let active = true
    const today = dayKey(new Date())
    setLoading(true)
    Promise.all([
      loadUsage(sameOrigin, 'daily'),
      loadUsage(sameOrigin, 'roles'),
      loadUsage(sameOrigin, 'models'),
      loadUsage(sameOrigin, 'roles', { from: today, to: today }),
    ]).then(([daily, roles, models, todayRoles]) => {
      if (!active) return
      setData({ daily, roles: roles.items ?? [], models: models.items ?? [], today: todayRoles.items ?? [] })
      setError('')
    }).catch((e: unknown) => {
      if (active) setError(e instanceof Error ? e.message : String(e))
    }).finally(() => {
      if (active) setLoading(false)
    })
    return () => { active = false }
  }, [revision])

  const days = data?.daily.items ?? []
  const maxDay = Math.max(1, ...days.map(r => r.total_tokens))
  const byTokens = (rows: UsageRow[]) => [...rows].sort((a, b) => b.total_tokens - a.total_tokens)

  return (
    <div className={styles.usage}>
      <header className={styles.usageHeader}>
        <h1 className={styles.usageTitle}>{t('usageTitle')}</h1>
        {data && <span className={styles.usageRange}>{data.daily.from} — {data.daily.to}</span>}
        <button type="button" className={styles.usageRefresh} onClick={refresh} disabled={loading}>
          {loading ? t('usageLoading') : t('usageRefresh')}
        </button>
      </header>
      {error && <p className={styles.usageError} role="alert">{t('usageError', { reason: error })}</p>}
      {data && (
        <>
          <section className={styles.usageTiles}>
            <Tile label={t('usageTodayTokens')} value={compactTokens(total(data.today, 'total_tokens'))} />
            <Tile label={t('usageTodayResponses')} value={total(data.today, 'responses').toLocaleString()} />
            <Tile label={t('usageRangeTokens')} value={compactTokens(total(data.roles, 'total_tokens'))} />
            <Tile label={t('usageRangeCost')} value={cost(data.roles)} />
          </section>
          <section className={styles.usageCard}>
            <h2 className={styles.usageSub}>{t('usageDaily')}</h2>
            {days.length === 0
              ? <p className={styles.usageEmpty}>{t('usageEmpty')}</p>
              : (
                  <div className={styles.usageBars} role="img" aria-label={t('usageDaily')}>
                    {days.map(r => (
                      <span
                        key={r.date}
                        className={styles.usageBar}
                        style={{ height: `${Math.max(2, (r.total_tokens / maxDay) * 100)}%` }}
                        title={`${r.date} · ${compactTokens(r.total_tokens)} · ${r.responses}`}
                      />
                    ))}
                  </div>
                )}
          </section>
          <UsageTable title={t('usageByRole')} name={t('usageRole')} rows={byTokens(data.roles)} pick={r => r.role} t={t} />
          <UsageTable title={t('usageByModel')} name={t('usageModel')} rows={byTokens(data.models)} pick={r => r.model} t={t} />
          {data.daily.timezone && <p className={styles.usageFoot}>{t('usageTimezone', { tz: data.daily.timezone })}</p>}
        </>
      )}
    </div>
  )
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.usageTile}>
      <div className={styles.usageTileLabel}>{label}</div>
      <div className={styles.usageTileValue}>{value}</div>
    </div>
  )
}

function UsageTable({ title, name, rows, pick, t }: {
  title: string
  name: string
  rows: UsageRow[]
  pick: (r: UsageRow) => string | undefined
  t: UsagePageProps['t']
}) {
  return (
    <section className={styles.usageCard}>
      <h2 className={styles.usageSub}>{title}</h2>
      {rows.length === 0
        ? <p className={styles.usageEmpty}>{t('usageEmpty')}</p>
        : (
            <div className={styles.usageTableWrap}>
              <table className={styles.usageTable}>
                <thead>
                  <tr>
                    <th>{name}</th>
                    <th>{t('usageResponses')}</th>
                    <th>{t('usageInput')}</th>
                    <th>{t('usageOutput')}</th>
                    <th>{t('usageCache')}</th>
                    <th>{t('usageTotal')}</th>
                    <th>{t('usageCost')}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={pick(r) ?? i}>
                      <td className={styles.usageName}>{pick(r) || '—'}</td>
                      <td>{r.responses.toLocaleString()}</td>
                      <td>{compactTokens(r.input_tokens)}</td>
                      <td>{compactTokens(r.output_tokens)}</td>
                      <td>{compactTokens(r.cache_read_tokens + r.cache_write_tokens)}</td>
                      <td>{compactTokens(r.total_tokens)}</td>
                      <td>{r.estimated_cost === undefined ? '—' : r.estimated_cost.toFixed(4)}{r.unpriced_responses > 0 ? ' *' : ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
    </section>
  )
}
