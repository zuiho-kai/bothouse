import { useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Cable, Wifi, Clock } from 'lucide-react';
import { Badge, EmptyState, PageHeader, LoadingState } from '@/components/ui';
import { listBridgeAdapters, type BridgeAdapter } from '@/api/bridge';
import { listProjects, shownNames, type ProjectSummary } from '@/api/projects';
import { formatTime } from '@/lib/utils';

export default function BridgeAdapters() {
  const { t } = useTranslation();
  const [adapters, setAdapters] = useState<BridgeAdapter[]>([]);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [data, p] = await Promise.all([listBridgeAdapters(), listProjects().catch(() => null)]);
      setAdapters(data.adapters || []);
      if (p) setProjects(p.projects || []);
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

  return (
    <div className="space-y-5 animate-fade-in">
      <PageHeader
        icon={Cable}
        title={t('bridge.title')}
        description={t('bridge.platform') + ' · ' + t('bridge.capabilities')}
        actions={
          <Badge variant="outline">
            {adapters.length} {t('bridge.platform')}
          </Badge>
        }
      />

      {loading && adapters.length === 0 ? (
        <LoadingState label={t('common.loading')} />
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
                      <Badge variant="info">{showName(a.project)}</Badge>
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
                <span className="flex shrink-0 items-center gap-1 text-xs text-ink-mute">
                  <Clock size={12} strokeWidth={1.6} />
                  {formatTime(a.connected_at)}
                </span>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
