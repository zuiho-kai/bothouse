import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Package, RotateCw } from 'lucide-react';
import { Badge, Button, EmptyState, Input, LoadingState, PageHeader } from '@/components/ui';
import {
  getPluginConfig,
  inspectPlugin,
  installPlugin,
  listPlugins,
  savePluginConfig,
  switchPlugin,
  type DSHPlugin,
  type DSHPluginsState,
  type PluginConfig,
  type PluginInspection,
} from '@/api/plugins';
import { failureText, pluginTexts, rowErrorText } from './texts';
import api from '@/api/client';
import { dshHomeUrl } from '@/lib/collabPages';
import { goToDsh } from '@/lib/openDsh';

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
  // inspection is the confirm step: nothing runs until the person has seen where the package
  // comes from, whether it fits this DSH, and what it may do.
  const [inspection, setInspection] = useState<PluginInspection | null>(null);
  const [inspecting, setInspecting] = useState(false);
  // A non-registry source needs a second, explicit acknowledgement: the switch alone is a config
  // fact, this is the person saying they know what that address is.
  const [ackNonRegistry, setAckNonRegistry] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [lines, setLines] = useState<string[]>([]);
  // installError keeps the classifier kind so the readable text can be in the reader's language.
  const [installError, setInstallError] = useState<{ kind?: string; detail?: string; log?: string } | null>(null);
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState('');
  const [openingConfig, setOpeningConfig] = useState(false);
  // 插件配置 (#150 ②a): one row's config open for editing. The text is YAML on purpose — the
  // fields belong to the plugin, and a `!!js` expression must go back verbatim.
  const [configRow, setConfigRow] = useState('');
  const [configText, setConfigText] = useState('');
  const [configMeta, setConfigMeta] = useState<PluginConfig | null>(null);
  const [configBusy, setConfigBusy] = useState(false);
  const [configError, setConfigError] = useState('');
  const [configNotice, setConfigNotice] = useState('');

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

  const check = async () => {
    const want = spec.trim();
    if (!want) {
      setInstallError({ detail: T.specEmpty });
      return;
    }
    setInspecting(true);
    setInstallError(null);
    setNotice('');
    try {
      setAckNonRegistry(false);
      setInspection(await inspectPlugin(want));
    } catch (e: any) {
      setInspection(null);
      setInstallError({ detail: e?.message || '' });
    } finally {
      setInspecting(false);
    }
  };

  const install = async () => {
    const want = (inspection?.spec || spec).trim();
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
      setInspection(null);
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

  // openConfig loads a row's config into the editor. A read is cheap and it may have changed under
  // DSH's own page, so it is read again rather than remembered from the list.
  const openConfig = async (rowId: string) => {
    setConfigBusy(true);
    setConfigRow(rowId);
    setConfigText('');
    setConfigError('');
    setConfigNotice('');
    setConfigMeta(null);
    try {
      const cfg = await getPluginConfig(rowId);
      setConfigMeta(cfg);
      setConfigText(cfg.config_yaml);
    } catch (e: any) {
      setConfigError(e?.message || '');
      setConfigText('');
    } finally {
      setConfigBusy(false);
    }
  };

  const saveConfig = async () => {
    if (!configRow) return;
    setConfigBusy(true);
    setConfigError('');
    setConfigNotice('');
    try {
      const r = await savePluginConfig(configRow, configText);
      setConfigMeta(r.config);
      setConfigText(r.config.config_yaml);
      setConfigNotice(r.changed ? T.configSaved : '');
    } catch (e: any) {
      setConfigError(e?.message || '');
    } finally {
      setConfigBusy(false);
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

      {state && !state.writes_allowed && (
        <p className="rounded-card bg-surface-sunken p-4 text-sm text-ink-soft ring-1 ring-hairline" data-testid="plugins-read-only">
          {T.writesOff}
        </p>
      )}

      {state?.can_install && state.writes_allowed && (
        <section className="rounded-card bg-surface p-5 ring-1 ring-hairline" data-testid="plugins-configure">
          <h2 className="font-medium text-ink">{T.configureTitle}</h2>
          <p className="mt-1 text-sm text-ink-soft">{T.configureHint}</p>
          <Button
            className="mt-3"
            variant="secondary"
            loading={openingConfig}
            disabled={installing || busy !== ''}
            onClick={() => {
              setOpeningConfig(true);
              void goToDsh(dshHomeUrl(undefined, api.getToken()))
                .finally(() => setOpeningConfig(false));
            }}
            data-testid="plugins-configure-open"
          >
            {T.configureOpen}
          </Button>
        </section>
      )}

      {/* Install: one package spec, then a confirm step that names the source, the fit and the
          permission — and only then the streamed run. Only shown when dsh is there and allowed. */}
      {state?.can_install && state?.writes_allowed && (
        <section className="rounded-card bg-surface p-5 ring-1 ring-hairline" data-testid="plugins-install">
          <h2 className="font-medium text-ink">{T.installTitle}</h2>
          <p className="mt-1 text-xs text-ink-mute">{T.installHint}</p>
          <div className="mt-3 flex flex-wrap items-end gap-2">
            <div className="min-w-[16rem] flex-1">
              <Input
                value={spec}
                onChange={(e) => { setSpec(e.target.value); setInspection(null); setAckNonRegistry(false); }}
                placeholder={T.installPlaceholder}
                aria-label={T.installTitle}
                data-testid="plugins-install-spec"
                disabled={installing || inspecting}
                onKeyDown={(e) => { if (e.key === 'Enter') check(); }}
              />
            </div>
            <Button
              variant="secondary"
              onClick={check}
              disabled={installing || inspecting}
              loading={inspecting}
              data-testid="plugins-inspect-go"
            >
              {inspecting ? T.inspecting : T.inspect}
            </Button>
            {/* No second button until the confirm step has run: "install" with nothing known about
                the package is exactly the one-click the review asked to remove. */}
            {inspection && (
              <Button
                onClick={install}
                disabled={
                  installing ||
                  inspecting ||
                  !inspection.allowed ||
                  (inspection.kind !== 'registry' && !ackNonRegistry)
                }
                loading={installing}
                data-testid="plugins-install-go"
              >
                {installing ? T.installing : T.confirmInstall}
              </Button>
            )}
          </div>

          {inspection && (
            <div className="mt-3 rounded-control bg-surface-sunken p-4 text-sm text-ink-soft" data-testid="plugins-inspect">
              <p className="text-xs text-ink-mute">{T.confirmHint}</p>
              <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
                <dt className="text-ink-mute">{T.sourceLabel}</dt>
                <dd className="break-all">
                  {/* A registry spec's source is the registry itself; anything else came from the
                      address the person typed, so show that verbatim. */}
                  <code>{inspection.kind === 'registry' ? inspection.registry : inspection.spec}</code>
                </dd>
                {inspection.version && (<><dt className="text-ink-mute">{T.versionLabel}</dt><dd>{inspection.version}</dd></>)}
                {inspection.publisher && (<><dt className="text-ink-mute">{T.publisherLabel}</dt><dd>{inspection.publisher}</dd></>)}
                {inspection.requires && (
                  <>
                    <dt className="text-ink-mute">{T.compatLabel}</dt>
                    <dd data-testid="plugins-inspect-compat" data-compatible={inspection.compatible === undefined ? 'unknown' : inspection.compatible ? '1' : '0'}>
                      <code>{inspection.requires}</code>
                      {' — '}
                      {inspection.compatible === undefined
                        ? T.compatUnchecked
                        : inspection.compatible ? T.compatOk : <span className="text-ink">{T.compatNo}</span>}
                    </dd>
                  </>
                )}
                <dt className="text-ink-mute">{T.permissionsLabel}</dt>
                <dd data-testid="plugins-inspect-required">
                  {inspection.required}
                  <span className="mt-1 block text-ink-mute">{inspection.bundle ? T.bundleYes : T.bundleNo}</span>
                </dd>
              </dl>
              {inspection.kind !== 'registry' && (
                <label className="mt-2 flex items-start gap-2 text-xs text-ink" data-testid="plugins-inspect-nonregistry">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={ackNonRegistry}
                    onChange={(e) => setAckNonRegistry(e.target.checked)}
                    disabled={installing}
                    data-testid="plugins-inspect-nonregistry-ack"
                  />
                  <span>
                    {T.nonRegistryWarn}
                    <span className="mt-0.5 block font-medium text-ink">{T.nonRegistryAck}</span>
                  </span>
                </label>
              )}
              {inspection.error && (
                <p className="mt-2 text-xs text-ink-mute" data-testid="plugins-inspect-miss">
                  {T.registryMiss}
                  <span className="mt-0.5 block break-words">{inspection.error}</span>
                </p>
              )}
              {!inspection.allowed && inspection.reason && (
                <p className="mt-2 text-xs text-ink" data-testid="plugins-inspect-refused">{inspection.reason}</p>
              )}
            </div>
          )}
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
                    // One write at a time: an install rewrites the same package.json, and two
                    // switches at once would each answer "changed" for a list only one of them
                    // lands. The backend now recomputes under the lock, this only stops the
                    // confusing double-click.
                    disabled={installing || busy !== ''}
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
                        {/* 插件配置 (#150 ②a): the row's own config, opened in place. A shipped
                            surface layer is not offered: its config is DSH's own UI. */}
                        {!p.shipped && state?.writes_allowed && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="ml-2"
                            onClick={() => (configRow === row.id ? setConfigRow('') : void openConfig(row.id))}
                            disabled={installing || configBusy}
                            data-testid={`plugin-${p.name}-row-${row.id}-config`}
                          >
                            {T.rowConfig}
                          </Button>
                        )}
                      </li>
                    ))}
                  </ul>
                  {configRow !== '' && p.rows.some((r) => r.id === configRow) && (
                    <div className="mt-3 rounded-control bg-surface-sunken p-3" data-testid="plugins-config-editor">
                      <h3 className="text-xs font-medium text-ink">{T.rowConfig} · <code>{configRow}</code></h3>
                      <p className="mt-1 text-xs text-ink-mute" data-testid="plugins-config-layer">
                        {configMeta?.layer === 'home'
                          ? configMeta.reason
                          : configMeta?.overridden
                            ? T.configFromProfile
                            : configMeta?.layer === 'none'
                              ? T.configNoneYet
                              : T.configFromBundle}
                      </p>
                      <textarea
                        className="mt-2 w-full rounded-control border border-hairline bg-surface p-2 font-mono text-xs text-ink"
                        rows={8}
                        spellCheck={false}
                        value={configText}
                        onChange={(e) => setConfigText(e.target.value)}
                        readOnly={configBusy || !configMeta?.editable}
                        aria-label={T.rowConfig}
                        data-testid="plugins-config-text"
                      />
                      {configText.includes('!bothouse/secret') && (
                        <p className="mt-1 text-xs text-ink-mute" data-testid="plugins-config-secrets">{T.configSecrets}</p>
                      )}
                      {configMeta?.editable && (
                        <p className="mt-1 text-xs text-ink-mute">
                          {configText.trim() === '' && configMeta.overridden ? T.configEmpty : T.configHint}
                        </p>
                      )}
                      {configError && (
                        <p className="mt-2 text-xs text-ink" data-testid="plugins-config-error">{configError}</p>
                      )}
                      {configNotice && (
                        <p className="mt-2 text-xs text-ink-soft" data-testid="plugins-config-saved">{configNotice}</p>
                      )}
                      {configMeta?.editable && (
                        <div className="mt-2 flex gap-2">
                          <Button
                            size="sm"
                            onClick={saveConfig}
                            loading={configBusy}
                            disabled={configBusy}
                            data-testid="plugins-config-save"
                          >
                            {configBusy ? T.configSaving : T.configSave}
                          </Button>
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => { setConfigRow(''); setConfigError(''); setConfigNotice(''); }}
                            disabled={configBusy}
                          >
                            {T.configCancel}
                          </Button>
                        </div>
                      )}
                    </div>
                  )}
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
