import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Package, RotateCw } from 'lucide-react';
import { Badge, Button, EmptyState, Input, LoadingState, PageHeader } from '@/components/ui';
import { installPlugin, listPlugins, switchPlugin, type DSHPlugin, type DSHPluginsState } from '@/api/plugins';
import { failureText, pluginTexts, rowErrorText } from './texts';

/**
 * 插件 (#150 第 b 项): the DSH profile's own plugin list, with the two writes that matter —
 * `dsh plugin add` and switching a bundle on or off.
 *
 * The page is a window on the profile, not a second registry: it reads package.json's dependencies
 * and dsh.profile.bundles, and switches by editing that same bundles list (the files DSH's built-in
 * Plugins page edits). A switch therefore never uninstalls anything, and DSH's own page shows the
 * same state. Both the list and the switch need a DSH restart to take effect, which the page says.
 */
export default function PluginList() {
  const { i18n } = useTranslation();
  const T = pluginTexts(i18n.language || 'en');
  const [state, setState] = useState<DSHPluginsState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [spec, setSpec] = useState('');
  const [installing, setInstalling] = useState(false);
  const [lines, setLines] = useState<string[]>([]);
  // installError keeps the classifier kind so the readable text can be in the reader's language.
  const [installError, setInstallError] = useState<{ kind?: string; detail?: string; log?: string } | null>(null);
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState('');

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      setState(await listPlugins());
      setError('');
    } catch (e: any) {
      setError(e?.message || '');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const handler = () => fetchData();
    window.addEventListener('cc:refresh', handler);
    return () => window.removeEventListener('cc:refresh', handler);
  }, [fetchData]);

  const install = async () => {
    const want = spec.trim();
    if (!want) {
      setInstallError({ detail: T.specEmpty });
      return;
    }
    setInstalling(true);
    setLines([]);
    setInstallError(null);
    setNotice('');
    try {
      const next = await installPlugin(want, (ev) => {
        if (ev.line) setLines((prev) => [...prev.slice(-19), ev.line!]);
      });
      setState(next);
      setSpec('');
      const added = next.plugins.find((p) => p.name === want || pxName(p.name) === pxName(want));
      setNotice(added && !added.layer ? T.installedNoLayer : T.installed);
    } catch (e: any) {
      setInstallError({ kind: e?.kind, detail: e?.message || '', log: e?.log });
    } finally {
      setInstalling(false);
    }
  };

  const toggle = async (p: DSHPlugin) => {
    setBusy(p.name);
    setNotice('');
    try {
      const r = await switchPlugin(p.name, !p.enabled);
      setState(r.state);
      if (r.changed) setNotice(T.restartNote);
    } catch (e: any) {
      setError(`${T.switchFailed}: ${e?.message || ''}`);
    } finally {
      setBusy('');
    }
  };

  const plugins = state?.plugins || [];

  const stateBadge = (p: DSHPlugin) => {
    if (p.error) return <Badge variant="danger">{T.stateMissing}</Badge>;
    // A plain dependency is installed but never loaded: it is not off, it is not a plugin.
    if (!p.layer) return <Badge variant="outline">{T.statePlain}</Badge>;
    if (p.shipped) return <Badge variant="outline">{T.stateShipped}</Badge>;
    return p.enabled ? <Badge variant="success">{T.stateOn}</Badge> : <Badge variant="outline">{T.stateOff}</Badge>;
  };

  return (
    <div className="space-y-5 animate-fade-in" data-testid="plugins-page">
      <PageHeader
        icon={Package}
        title={T.title}
        description={T.subtitle}
        actions={
          <Button variant="secondary" size="sm" onClick={fetchData} disabled={loading}>
            <RotateCw size={14} className={loading ? 'animate-spin' : ''} />
            {T.refresh}
          </Button>
        }
      />

      {error && (
        <div className="rounded-card bg-surface p-4 text-sm text-ink-soft ring-1 ring-hairline">
          <p className="font-medium text-ink">{T.loadFailed}</p>
          <p className="mt-1 break-words text-xs text-ink-mute">{error}</p>
        </div>
      )}

      {state && !state.can_install && (
        <p className="rounded-card bg-surface-sunken p-4 text-sm text-ink-soft ring-1 ring-hairline" data-testid="plugins-no-dsh">
          {T.noDSH}
        </p>
      )}

      {/* Install: one package spec, streamed output. Only shown when dsh is actually there. */}
      {state?.can_install && (
        <section className="rounded-card bg-surface p-5 ring-1 ring-hairline" data-testid="plugins-install">
          <h2 className="font-medium text-ink">{T.installTitle}</h2>
          <p className="mt-1 text-xs text-ink-mute">{T.installHint}</p>
          <div className="mt-3 flex flex-wrap items-end gap-2">
            <div className="min-w-[16rem] flex-1">
              <Input
                value={spec}
                onChange={(e) => setSpec(e.target.value)}
                placeholder={T.installPlaceholder}
                aria-label={T.installTitle}
                data-testid="plugins-install-spec"
                disabled={installing}
                onKeyDown={(e) => { if (e.key === 'Enter') install(); }}
              />
            </div>
            <Button onClick={install} disabled={installing} loading={installing} data-testid="plugins-install-go">
              {installing ? T.installing : T.install}
            </Button>
          </div>
          {installing && lines.length > 0 && (
            <pre className="mt-3 max-h-40 overflow-auto rounded-control bg-surface-sunken p-3 text-[11px] leading-relaxed text-ink-mute">
              {lines.join('\n')}
            </pre>
          )}
          {installError && (
            <div className="mt-3 text-sm text-ink-soft" data-testid="plugins-install-error">
              <p className="flex items-start gap-2 font-medium text-ink">
                <AlertTriangle size={14} strokeWidth={1.8} className="mt-0.5 shrink-0 text-ink-soft" />
                {installError.detail && !installError.kind
                  ? installError.detail
                  : T.installFailed(failureText(T, installError.kind))}
              </p>
              {installError.log && (
                <details className="mt-2">
                  <summary className="cursor-pointer text-xs text-ink-mute">{T.details}</summary>
                  <pre className="mt-2 max-h-56 overflow-auto rounded-control bg-surface-sunken p-3 text-[11px] leading-relaxed text-ink-mute">
                    {installError.log}
                  </pre>
                </details>
              )}
            </div>
          )}
          {notice && <p className="mt-3 text-sm text-ink-soft" data-testid="plugins-notice">{notice}</p>}
        </section>
      )}

      {loading && plugins.length === 0 ? (
        <LoadingState label={T.loading} />
      ) : plugins.length === 0 ? (
        <EmptyState message={T.empty} hint={T.emptyHint} />
      ) : (
        <div className="space-y-3">
          {plugins.map((p) => (
            <article
              key={p.name}
              data-testid={`plugin-${p.name}`}
              data-enabled={p.enabled ? '1' : '0'}
              className="rounded-card bg-surface p-5 ring-1 ring-hairline"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <code className="truncate text-sm font-medium text-ink">{p.name}</code>
                    {p.version && <span className="text-xs text-ink-mute">{p.version}</span>}
                    {stateBadge(p)}
                  </div>
                  {p.description && <p className="mt-1 text-xs text-ink-soft">{p.description}</p>}
                  {p.error && <p className="mt-1 text-xs text-ink-mute">{rowErrorText(T, p.error)}</p>}
                </div>
                {/* A shipped surface layer has no switch here: turning it off removes the panel. */}
                {p.layer && !p.shipped && !p.error && (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => toggle(p)}
                    disabled={busy === p.name}
                    loading={busy === p.name}
                    data-testid={`plugin-${p.name}-toggle`}
                  >
                    {p.enabled ? T.off : T.on}
                  </Button>
                )}
              </div>
              {p.layer && p.shipped && (
                <p className="mt-3 text-xs text-ink-mute">{T.shippedNote}</p>
              )}
              {/* The bundled surfaces carry dozens of rows each; collapsed by default so the page
                  stays a list of plugins, and open when the owner wants the detail. */}
              {p.rows && p.rows.length > 0 && (
                <details className="mt-3 border-t border-hairline pt-3" data-testid={`plugin-${p.name}-rows`}>
                  <summary className="cursor-pointer text-xs text-ink-mute">{T.rowsTitle(p.rows.length)}</summary>
                  <ul className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1">
                    {p.rows.map((row) => (
                      <li key={row.id} className="text-xs text-ink-soft" data-testid={`plugin-${p.name}-row-${row.id}`}>
                        <code>{row.name}</code>
                        {row.disabled && <span className="ml-1.5 text-ink-mute">({T.rowOff})</span>}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

/** pxName drops a version suffix so `pkg@1.2.3` still matches the installed `pkg` row. */
function pxName(spec: string): string {
  const at = spec.lastIndexOf('@');
  return at > 0 ? spec.slice(0, at) : spec;
}