import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Check, RotateCw, ToggleRight } from 'lucide-react';
import { Badge, Button, LoadingState, PageHeader, Section } from '@/components/ui';
import { cn } from '@/lib/utils';
import { getFeatures, setFeature, type FeatureState } from '@/api/features';
import { featureTexts, type FeatureTexts } from './texts';

/**
 * 功能开关 (#1861): every on/off switch of config.toml on one page, from the bridge's registry
 * (config/features.go). The global ones are a list; the per-role ones are a grid, one column per
 * role. A click writes config.toml and reloads the running roles; a switch the bridge only reads
 * at start says so before and after the click.
 */
export default function FeaturesPage() {
  const { i18n } = useTranslation();
  const lang = i18n.language || 'en';
  const T = featureTexts(lang);
  const zh = lang.toLowerCase().startsWith('zh');

  const [features, setFeatures] = useState<FeatureState[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [note, setNote] = useState<{ msg: string; err: string }>({ msg: '', err: '' });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setFeatures((await getFeatures()).features);
      setError('');
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const flip = async (f: FeatureState) => {
    const id = idOf(f);
    setBusy(id);
    setNote({ msg: '', err: '' });
    try {
      const r = await setFeature({ project: f.project, key: f.key, on: !f.on });
      setFeatures(r.features);
      setNote({ msg: r.restart_required ? T.savedRestart : T.saved, err: r.reload_error ? `${T.reloadError} ${r.reload_error}` : '' });
    } catch (e: any) {
      setNote({ msg: '', err: `${T.saveFailed}：${e?.message || e}` });
    } finally {
      setBusy('');
    }
  };

  const globals = useMemo(() => (features ?? []).filter((f) => f.scope === 'global'), [features]);
  const perRole = useMemo(() => (features ?? []).filter((f) => f.scope === 'project'), [features]);
  const roles = useMemo(() => [...new Set(perRole.map((f) => f.project || ''))], [perRole]);
  const roleKeys = useMemo(() => [...new Set(perRole.map((f) => f.key))], [perRole]);
  const pending = (features ?? []).filter((f) => f.pending_restart).length;
  const label = (f: FeatureState) => (zh ? f.name : f.name_en);
  const desc = (f: FeatureState) => (zh ? f.desc : f.desc_en);

  return (
    <div className="space-y-5 animate-fade-in" data-testid="features-page">
      <PageHeader
        icon={ToggleRight}
        title={T.title}
        description={T.subtitle}
        actions={
          <Button variant="secondary" size="sm" onClick={load} disabled={loading}>
            <RotateCw size={14} className={loading ? 'animate-spin' : ''} />
            {T.refresh}
          </Button>
        }
      />

      {error && (
        <div className="rounded-card bg-surface p-4 text-sm ring-1 ring-hairline">
          <p className="font-medium text-ink">{T.loadFailed}</p>
          <p className="mt-1 break-words text-xs text-ink-mute">{error}</p>
        </div>
      )}

      {pending > 0 && (
        <p className="flex items-start gap-2 rounded-card bg-amber-500/10 px-4 py-3 text-sm text-amber-700 ring-1 ring-amber-500/25 dark:text-amber-400" data-testid="features-pending">
          <AlertTriangle size={16} strokeWidth={1.6} className="mt-0.5 shrink-0" />
          {T.pendingBanner(pending)}
        </p>
      )}
      {note.msg && <p className="flex items-center gap-1 text-xs text-emerald-600" data-testid="features-saved"><Check size={13} />{note.msg}</p>}
      {note.err && <p className="break-words text-xs text-red-500" data-testid="features-error">{note.err}</p>}

      {loading && !features ? (
        <LoadingState label={T.loading} />
      ) : features && (
        <>
          <Section title={T.globalTitle} description={T.globalHint}>
            <ul className="divide-y divide-hairline" data-testid="features-global">
              {globals.map((f) => (
                <li key={f.key} className="flex items-center justify-between gap-4 py-3" data-testid={`feature-${f.key}`}>
                  <FeatureLabel f={f} T={T} name={label(f)} desc={desc(f)} showDefault />
                  <Switch on={f.on} busy={busy === idOf(f)} label={label(f)} onClick={() => flip(f)} />
                </li>
              ))}
            </ul>
          </Section>

          {roles.length > 0 && (
            <Section title={T.rolesTitle} description={T.rolesHint}>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] border-separate border-spacing-0 text-left" data-testid="features-roles">
                  <thead>
                    <tr>
                      <th className="border-b border-hairline pb-2 pr-4 text-xs font-medium text-ink-mute">{T.switchCol}</th>
                      {roles.map((r) => (
                        <th key={r} className="border-b border-hairline px-3 pb-2 text-center text-xs font-medium text-ink-soft">{r}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {roleKeys.map((key) => {
                      const row = perRole.filter((f) => f.key === key);
                      return (
                        <tr key={key} data-testid={`feature-row-${key}`}>
                          <td className="border-b border-hairline py-3 pr-4 align-top">
                            <FeatureLabel f={row[0]} T={T} name={label(row[0])} desc={desc(row[0])} />
                          </td>
                          {roles.map((r) => {
                            const f = row.find((x) => (x.project || '') === r);
                            return (
                              <td key={r} className="border-b border-hairline px-3 py-3 text-center align-top" data-testid={`feature-${r}/${key}`}>
                                {f && (
                                  <div className="inline-flex flex-col items-center gap-1">
                                    <Switch on={f.on} busy={busy === idOf(f)} label={`${r} · ${label(f)}`} onClick={() => flip(f)} />
                                    <span className={cn('text-[10px]', f.pending_restart ? 'text-amber-600' : 'text-ink-mute')}>
                                      {f.pending_restart ? T.pending : f.default ? T.defaultOn : T.defaultOff}
                                    </span>
                                  </div>
                                )}
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Section>
          )}
        </>
      )}
    </div>
  );
}

const idOf = (f: FeatureState) => (f.project ? `${f.project}/${f.key}` : f.key);

/** Name, what it does, its config key, and the notes a click depends on. */
function FeatureLabel({ f, T, name, desc, showDefault }: { f: FeatureState; T: FeatureTexts; name: string; desc: string; showDefault?: boolean }) {
  return (
    <div className="min-w-0">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium text-ink">{name}</span>
        {showDefault && <Badge variant="outline">{f.default ? T.defaultOn : T.defaultOff}</Badge>}
        {f.restart && <Badge variant="warning">{T.needsRestart}</Badge>}
        {showDefault && f.pending_restart && <Badge variant="danger">{T.pending}</Badge>}
      </div>
      <p className="mt-0.5 text-xs leading-relaxed text-ink-mute">{desc}</p>
      <code className="mt-1 inline-block rounded bg-surface-sunken px-1.5 py-0.5 font-mono text-[10px] text-ink-mute">
        {f.key}{f.inverted ? ` · ${T.inverted}` : ''}
      </code>
    </div>
  );
}

function Switch({ on, busy, label, onClick }: { on: boolean; busy: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={busy}
      onClick={onClick}
      className={cn(
        'h-6 w-10 shrink-0 rounded-pill transition-colors duration-base ease-ui-standard disabled:opacity-50',
        on ? 'bg-accent' : 'bg-hairline-strong',
      )}
    >
      <span className={cn('mx-1 block h-4 w-4 rounded-full bg-surface shadow-sm transition-transform duration-base ease-ui-out', on ? 'translate-x-4' : 'translate-x-0')} />
    </button>
  );
}
