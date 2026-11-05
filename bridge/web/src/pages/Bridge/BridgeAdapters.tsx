import { useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Cable, Wifi, Clock, Plug, Layers } from 'lucide-react';
import { Badge, EmptyState, PageHeader, LoadingState, Section } from '@/components/ui';
import { listBridgeAdapters, type BridgeAdapter } from '@/api/bridge';
import { getStatus, type SystemStatus } from '@/api/status';
import { listProjects, shownNames, type ProjectSummary } from '@/api/projects';
import { connectedSources, dshStatus, getDSHSummary, type DSHSummary } from '@/api/dsh';
import { DSHNotice, errorMessage } from '@/components/DSHNotice';
import { formatTime } from '@/lib/utils';

// Two different things, two different lists. The page used to count only the bridge adapters —
// external WebSocket clients — so a healthy panel whose roles were on Discord and Cloud Web still
// read "0 platforms / no bridge adapters". Platforms come from /status (what the roles are
// actually connected to); adapters stay a separate, optional list.
export default function BridgeAdapters() {
  const { t } = useTranslation();
  const [status, setStatus] = useState<SystemStatus | null>(null);
  const [adapters, setAdapters] = useState<BridgeAdapter[]>([]);
  const [adapterReadFailed, setAdapterReadFailed] = useState(false);
  const [adaptersEnabled, setAdaptersEnabled] = useState(false);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [dsh, setDsh] = useState<DSHSummary | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [dshError, setDshError] = useState('');
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [statusResult, adapterResult, projectResult, dshResult] = await Promise.allSettled([
        getStatus(), listBridgeAdapters(), listProjects(), getDSHSummary(),
      ]);
      const s = statusResult.status === 'fulfilled' ? statusResult.value : null;
      setStatus(s);
      setAdapterReadFailed(statusResult.status === 'rejected' || adapterResult.status === 'rejected');
      setAdapters(adapterResult.status === 'fulfilled' ? adapterResult.value.adapters || [] : []);
      setAdaptersEnabled(s?.bridge?.enabled === true);
      if (projectResult.status === 'fulfilled') setProjects(projectResult.value.projects || []);
      setErrors([statusResult, adapterResult, projectResult].filter((r) => r.status === 'rejected').map((r) => errorMessage(r.reason)));
      setDsh(dshResult.status === 'fulfilled' ? dshResult.value : null);
      setDshError(dshResult.status === 'rejected' ? errorMessage(dshResult.reason) : '');
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

  const showName = shownNames(projects);
  const platforms = connectedSources(status?.connected_platforms || [], dsh);

  return (
    <div className="space-y-5 animate-fade-in">
      <PageHeader
        icon={Cable}
        title={t('bridge.title')}
        description={t('bridge.platform') + ' · ' + t('bridge.capabilities')}
        actions={
          <Badge variant="outline">
            {platforms.length} {t('bridge.platform')}
          </Badge>
        }
      />

      {loading && !status ? (
        <LoadingState label={t('common.loading')} />
      ) : (
        <>
          {errors.map((error, i) => <p role="alert" key={i}>{error}</p>)}
          <DSHNotice status={dshError ? 'error' : dsh ? dshStatus(dsh) : undefined} error={dshError || dsh?.error} />
          <Section title={t('bridge.connectedPlatforms')} description={t('bridge.platform')}>
            {platforms.length === 0 ? (
              <EmptyState
                message={t('bridge.noPlatforms')}
                hint={t('bridge.noPlatformsHint')}
                icon={Layers}
              />
            ) : (
              <div className="flex flex-wrap gap-2">
                {platforms.map((p) => (
                  <span
                    key={p}
                    className="inline-flex items-center gap-2 rounded-control bg-surface-sunken px-3 py-1.5 text-sm text-ink ring-1 ring-hairline"
                  >
                    <Plug size={14} strokeWidth={1.6} className="text-ink-mute" />
                    {p}
                  </span>
                ))}
              </div>
            )}
          </Section>

          <Section
            title={t('bridge.externalAdapters')}
            description={t('bridge.capabilities')}
            actions={adapters.length > 0 ? <Badge variant="outline">{adapters.length}</Badge> : undefined}
          >
            {adapterReadFailed ? null : !adaptersEnabled ? (
              // Bridge websocket is off, so no external client can register. Say that instead of
              // implying the platforms themselves are missing.
              <EmptyState
                message={t('bridge.bridgeDisabled')}
                hint={t('bridge.bridgeDisabledHint')}
                icon={Plug}
              />
            ) : adapters.length === 0 ? (
              <EmptyState message={t('bridge.noAdapters')} icon={Cable} />
            ) : (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                {adapters.map((a, i) => (
                  <article
                    key={`${a.platform}-${a.project}-${i}`}
                    className="rounded-card bg-surface p-5 ring-1 ring-hairline transition-[box-shadow,background-color] duration-state ease-ui-standard hover:ring-hairline-strong"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex min-w-0 items-center gap-3">
                        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-card bg-surface-sunken ring-1 ring-hairline">
                          <Wifi size={18} strokeWidth={1.5} className="text-ink-soft" />
                        </span>
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="truncate font-medium text-ink">{a.platform}</span>
                            {a.project && <Badge variant="info">{showName(a.project)}</Badge>}
                          </div>
                          {a.capabilities?.length ? (
                            <div className="mt-1.5 flex flex-wrap gap-1">
                              {a.capabilities.map((c) => (
                                <Badge key={c} variant="default">
                                  {c}
                                </Badge>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      </div>
                      {a.connected_at && (
                        <span className="flex shrink-0 items-center gap-1 text-xs text-ink-mute">
                          <Clock size={12} strokeWidth={1.6} />
                          {formatTime(a.connected_at)}
                        </span>
                      )}
                    </div>
                  </article>
                ))}
              </div>
            )}
          </Section>
        </>
      )}
    </div>
  );
}
