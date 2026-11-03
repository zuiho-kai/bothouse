import { useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import {
  Server, Layers, MessageSquare, Clock, ChevronRight, Gauge,
} from 'lucide-react';
import { StatCard, Badge, EmptyState, PageHeader, LoadingState, Bars, Ring } from '@/components/ui';
import { getStatus, type SystemStatus } from '@/api/status';
import { listProjects, shownName, shownNames, type ProjectSummary } from '@/api/projects';
import { listSessions, type Session } from '@/api/sessions';
import { formatUptime, formatTime } from '@/lib/utils';

const MAX_ITEMS = 4;

export default function Dashboard() {
  const { t } = useTranslation();
  const [status, setStatus] = useState<SystemStatus | null>(null);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [recentSessions, setRecentSessions] = useState<(Session & { project: string })[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const [s, p] = await Promise.all([getStatus(), listProjects()]);
      setStatus(s);
      const projs = p.projects || [];
      setProjects(projs);

      const sessResults = await Promise.allSettled(
        projs.map(proj => listSessions(proj.name).then(r => ({ project: proj.name, sessions: r.sessions || [] })))
      );
      const allSessions: (Session & { project: string })[] = [];
      for (const r of sessResults) {
        if (r.status === 'fulfilled') {
          for (const sess of r.value.sessions) {
            allSessions.push({ ...sess, project: r.value.project });
          }
        }
      }
      allSessions.sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
      setRecentSessions(allSessions.slice(0, MAX_ITEMS));
    } catch (e: any) {
      setError(e.message);
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

  // 两处派生数据都直接来自 status/projects，不引入新的请求，也不推测缺失值。
  const platformCount = status?.connected_platforms?.length ?? 0;
  const projectRows = projects.map((p) => ({
    label: shownName(p),
    value: p.sessions_count ?? 0,
    display: String(p.sessions_count ?? 0),
  }));

  return (
    <div className="space-y-8 animate-fade-in">
      <PageHeader
        icon={Gauge}
        title={t('dashboard.title')}
        description={t('dashboard.version') + ' ' + (status?.version || '-')}
        actions={
          <Badge variant="outline">
            {t('dashboard.uptime')} {status ? formatUptime(status.uptime_seconds) : '-'}
          </Badge>
        }
      />

      {loading && !status ? (
        <LoadingState label={t('common.loading')} />
      ) : error ? (
        <div className="rounded-card bg-red-500/10 p-4 text-sm text-red-700 ring-1 ring-red-500/25 dark:text-red-400">{error}</div>
      ) : (
        <>
          {/* Stats */}
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-4">
            <StatCard label={t('dashboard.version')} value={status?.version || '-'} accent />
            <StatCard label={t('dashboard.uptime')} value={status ? formatUptime(status.uptime_seconds) : '-'} />
            <StatCard label={t('dashboard.platforms')} value={platformCount} />
            <StatCard label={t('dashboard.projects')} value={status?.projects_count ?? 0} />
          </div>

          {/* Monitoring strip: one share ring + one ranking bar, both fed by real counts. */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <div className="rounded-card bg-surface p-5 ring-1 ring-hairline">
              <p className="text-xs font-medium uppercase tracking-wide text-ink-mute">
                {t('dashboard.platforms')}
              </p>
              <div className="mt-3 flex items-center gap-4">
                <Ring
                  ratio={platformCount > 0 ? 1 : 0}
                  display={String(platformCount)}
                  label={t('dashboard.platforms')}
                />
                <div className="text-xs text-ink-mute">
                  {platformCount > 0
                    ? status?.connected_platforms?.join(' · ')
                    : t('dashboard.noData')}
                </div>
              </div>
            </div>

            <div className="rounded-card bg-surface p-5 ring-1 ring-hairline lg:col-span-2">
              <p className="text-xs font-medium uppercase tracking-wide text-ink-mute">
                {t('dashboard.projects')}
              </p>
              <div className="mt-3">
                {projectRows.length === 0 ? (
                  <p className="py-6 text-center text-xs text-ink-mute">{t('dashboard.noData')}</p>
                ) : (
                  <Bars data={projectRows.slice(0, MAX_ITEMS)} labelWidth={88} />
                )}
              </div>
            </div>
          </div>

          {/* Projects */}
          <section>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="flex items-center gap-1.5 text-sm font-semibold text-ink">
                <Server size={14} strokeWidth={1.6} className="text-ink-mute" />
                {t('nav.projects')}
              </h3>
              <Link to="/projects" className="flex items-center gap-0.5 text-xs text-accent-text hover:underline">
                {t('common.viewAll')} <ChevronRight size={12} />
              </Link>
            </div>
            {projects.length === 0 ? (
              <div className="rounded-card bg-surface p-8 ring-1 ring-hairline">
                <EmptyState message={t('projects.noProjects')} icon={Layers} />
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-3 md:grid-cols-3 xl:grid-cols-4">
                {projects.slice(0, MAX_ITEMS).map((p) => (
                  <Link
                    key={p.name}
                    to={`/chat/${p.name}`}
                    className="block min-w-0 overflow-hidden rounded-card bg-surface p-4 ring-1 ring-hairline transition-[box-shadow,background-color] duration-state ease-ui-standard hover:ring-hairline-strong"
                  >
                    <div className="mb-3 flex items-center gap-2.5">
                      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-control bg-surface-sunken text-ink-mute ring-1 ring-hairline">
                        <Server size={14} strokeWidth={1.6} />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-ink">{shownName(p)}</p>
                        <p className="truncate font-mono text-xs text-ink-mute">{p.agent_type}</p>
                      </div>
                    </div>
                    <div className="mb-2 flex flex-wrap gap-1">
                      {p.platforms?.slice(0, 3).map((pl) => (
                        <Badge key={pl}>{pl}</Badge>
                      ))}
                      {(p.platforms?.length ?? 0) > 3 && (
                        <Badge>+{p.platforms!.length - 3}</Badge>
                      )}
                    </div>
                    <p className="text-xs text-ink-mute">{p.sessions_count} sessions</p>
                  </Link>
                ))}
              </div>
            )}
          </section>

          {/* Recent Sessions */}
          <section>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="flex items-center gap-1.5 text-sm font-semibold text-ink">
                <MessageSquare size={14} strokeWidth={1.6} className="text-ink-mute" />
                {t('dashboard.recentSessions')}
              </h3>
              <Link to="/chat" className="flex items-center gap-0.5 text-xs text-accent-text hover:underline">
                {t('common.viewAll')} <ChevronRight size={12} />
              </Link>
            </div>
            {recentSessions.length === 0 ? (
              <div className="rounded-card bg-surface p-8 ring-1 ring-hairline">
                <EmptyState message={t('sessions.noSessions')} icon={MessageSquare} />
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-3 md:grid-cols-3 xl:grid-cols-4">
                {recentSessions.map((sess) => (
                  <Link
                    key={`${sess.project}-${sess.id}`}
                    to={`/chat/${sess.project}`}
                    className="block min-w-0 overflow-hidden rounded-card bg-surface p-4 ring-1 ring-hairline transition-[box-shadow,background-color] duration-state ease-ui-standard hover:ring-hairline-strong"
                  >
                    <div className="mb-3 flex items-center gap-2.5">
                      <span
                        className={`h-2 w-2 shrink-0 rounded-full ${sess.active ? 'bg-emerald-500' : 'bg-hairline-strong'}`}
                        aria-hidden
                      />
                      <p className="truncate text-sm font-medium text-ink">
                        {sess.name || sess.id}
                      </p>
                    </div>
                    <Badge className="mb-2">{shownNames(projects)(sess.project)}</Badge>
                    {sess.last_message && (
                      <p className="mb-2 truncate text-xs text-ink-mute">
                        {sess.last_message.content.slice(0, 60)}
                      </p>
                    )}
                    <div className="flex items-center gap-1 text-xs text-ink-mute">
                      <Clock size={10} />
                      {formatTime(sess.updated_at)}
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
