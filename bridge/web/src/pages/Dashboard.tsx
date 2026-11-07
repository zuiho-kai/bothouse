import { useEffect, useRef, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import {
  Server, Layers, MessageSquare, Clock, ChevronRight, Gauge,
} from 'lucide-react';
import { StatCard, Badge, EmptyState, PageHeader, LoadingState, Bars, Ring } from '@/components/ui';
import { getStatus, type SystemStatus } from '@/api/status';
import { listProjects, shownName, shownNames, type ProjectSummary } from '@/api/projects';
import { listSessions, type Session } from '@/api/sessions';
import { connectedSources, dshStatus, getDSHSummary, type DSHSummary } from '@/api/dsh';
import { DSHNotice, errorMessage } from '@/components/DSHNotice';
import { dshChannelsUrl } from '@/lib/collabPages';
import { goToDsh } from '@/lib/openDsh';
import { getDSHStatus, openDSHDesktop } from '@/api/wizard';
import { listModules } from '@/api/modules';
import { dshOnlyRows } from '@/lib/dshMerge';
import api from '@/api/client';
import { formatUptime, formatTime } from '@/lib/utils';
import { usePageRefresh } from '@/lib/usePageRefresh';

const MAX_ITEMS = 4;

export default function Dashboard() {
  const { t, i18n } = useTranslation();
  const [status, setStatus] = useState<SystemStatus | null>(null);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [recentSessions, setRecentSessions] = useState<(Session & { project: string })[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  // DSH's own members and channels (only DSH, no bridge project: the counts would read 0 otherwise)
  const [sessionError, setSessionError] = useState('');
  const [dshError, setDshError] = useState('');
  const [dsh, setDsh] = useState<DSHSummary | null>(null);
  const requestId = useRef(0);
  const loaded = useRef(false);

  const fetchData = useCallback(async () => {
    const request = ++requestId.current;
    try {
      if (!loaded.current) setLoading(true);
      setError('');
      const [s, p, result] = await Promise.all([getStatus(), listProjects(), Promise.allSettled([getDSHSummary()])]);
      const d = result[0];
      const projs = p.projects || [];

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
      if (request !== requestId.current) return;
      setDshError(d.status === 'rejected' ? errorMessage(d.reason) : '');
      setStatus(s);
      setDsh(d.status === 'fulfilled' ? d.value : null);
      setProjects(projs);
      setSessionError(sessResults.filter((r) => r.status === 'rejected').map((r) => errorMessage(r.reason)).join('; '));
      setRecentSessions(allSessions.slice(0, MAX_ITEMS));
    } catch (e: any) {
      if (request === requestId.current) setError(e.message);
    } finally {
      if (request === requestId.current) { loaded.current = true; setLoading(false); }
    }
  }, []);

  usePageRefresh(fetchData);
  useEffect(() => () => { requestId.current++; }, []);

  // 两处派生数据都直接来自 status/projects，不引入新的请求，也不推测缺失值。
  const platformNames = connectedSources(status?.connected_platforms ?? [], dsh);
  const platformCount = platformNames.length;
  const projectRows = projects.map((p) => ({
    label: shownName(p),
    value: p.sessions_count ?? 0,
    display: String(p.sessions_count ?? 0),
  }));
  // DSH lists the bots that registered into it as members; on a machine where those bots are the
  // bridge's own projects the same agents arrive twice, so only the leftovers are counted/listed.
  const dshMembers = dshOnlyRows(dsh?.members ?? [], projects.map((p) => p.name));
  const dshChannels = dsh?.channels ?? [];
  const dshUrl = dshChannelsUrl(undefined, api.getToken());
  const [dshWait, setDshWait] = useState<number | null>(null);
  // 打开 DSH only where DSH is set up: elsewhere 「DSH 未运行」 needs no button
  const [dshSetUp, setDshSetUp] = useState(false);
  useEffect(() => { listModules().then((r) => setDshSetUp(r.modules.some((x) => x.name === 'dsh' && x.state === 'enabled'))).catch(() => {}); }, []);
  // the channels are in DeepSeek Harness Desktop too (setup wizard's default route): open it there first
  const [dshDesktop, setDshDesktop] = useState(false);
  useEffect(() => { if (dshSetUp) getDSHStatus().then((s) => setDshDesktop(!!s.desktop_app && !!s.desktop_plugin_installed)).catch(() => {}); }, [dshSetUp]);
  const openDsh = (e?: { preventDefault: () => void }) => { e?.preventDefault(); setDshWait(0); void goToDsh(dshUrl, setDshWait).finally(() => setDshWait(null)); };
  const openDesktop = () => { setDshWait(0); void openDSHDesktop(i18n.language).catch(() => openDsh()).finally(() => setDshWait(null)); };
  const btn = 'shrink-0 rounded-control px-2.5 py-1 text-xs font-medium text-ink ring-1 ring-hairline hover:bg-surface disabled:opacity-60';
  const openDshButton = dshDesktop ? (
    <span className="inline-flex shrink-0 gap-1.5">
      <button type="button" onClick={openDesktop} disabled={dshWait !== null} data-testid="dashboard-open-dsh-desktop" className={btn}>
        {t('dshManage.openDshDesktop', '在桌面版打开')}</button>
      <button type="button" onClick={() => openDsh()} disabled={dshWait !== null} data-testid="dashboard-open-dsh" className={btn}>
        {dshWait === null ? t('dshManage.openDshWeb', '网页版') : `${t('dshManage.openDshWeb', '网页版')}… ${dshWait}s`}</button>
    </span>
  ) : (
    <button type="button" onClick={() => openDsh()} disabled={dshWait !== null} data-testid="dashboard-open-dsh" className={btn}>
      {dshWait === null ? t('dshManage.openDsh', '打开 DSH') : `${t('dshManage.openDsh', '打开 DSH')}… ${dshWait}s`}</button>
  );
  // Recent sessions: bridge sessions and DSH channels together, newest first.
  const recentItems = [
    ...recentSessions.map((sess) => ({ kind: 'bridge' as const, at: sess.updated_at, sess })),
    ...dshChannels.map((ch) => ({ kind: 'dsh' as const, at: ch.updated_at, ch })),
  ]
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
    .slice(0, MAX_ITEMS);

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
      ) : error && !status ? (
        <div className="rounded-card bg-red-500/10 p-4 text-sm text-red-700 ring-1 ring-red-500/25 dark:text-red-400">{error}</div>
      ) : (
        <>
          {error && <p role="alert">{error}</p>}
          {sessionError && <p role="alert">{sessionError}</p>}
          <DSHNotice status={dshError ? 'error' : dsh ? dshStatus(dsh) : undefined} error={dshError || dsh?.error} action={dshSetUp ? openDshButton : undefined} />
          <p className="text-xs text-ink-mute">{t('dshManage.projectScope')}</p>
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
                    ? platformNames.join(' · ')
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
                  <Bars
                    data={[
                      ...projectRows,
                    ].slice(0, MAX_ITEMS)}
                    labelWidth={88}
                  />
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

          {dshMembers.length > 0 && <section><div className="mb-3 flex items-center justify-between gap-2"><h3 className="text-sm font-semibold">{t('dsh.members', 'DSH 成员')}</h3>
                {openDshButton}</div><div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                {dshMembers.slice(0, MAX_ITEMS).map((m) => (
                  <a
                    key={m.name}
                    href={dshUrl} onClick={openDsh}
                    className="block min-w-0 overflow-hidden rounded-card bg-surface p-4 ring-1 ring-hairline transition-[box-shadow,background-color] duration-state ease-ui-standard hover:ring-hairline-strong"
                  >
                    <div className="mb-3 flex items-center gap-2.5">
                      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-control bg-surface-sunken text-ink-mute ring-1 ring-hairline">
                        <Server size={14} strokeWidth={1.6} />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-ink">{m.display_name || m.name}</p>
                        <p className="truncate font-mono text-xs text-ink-mute">{m.agent_type}</p>
                      </div>
                    </div>
                    <div className="mb-2 flex flex-wrap gap-1">
                      <Badge>dsh</Badge>
                    </div>
                    <p className="text-xs text-ink-mute">{m.online ? (m.busy ? m.current_task : '在线') : '不在线'}</p>
                  </a>
                ))}
          </div></section>}
          {/* Recent Sessions */}
          <section>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="flex items-center gap-1.5 text-sm font-semibold text-ink">
                <MessageSquare size={14} strokeWidth={1.6} className="text-ink-mute" />
                {t('dsh.recentConversations', '最近会话和频道')}
              </h3>
              <Link to="/chat" className="flex items-center gap-0.5 text-xs text-accent-text hover:underline">
                {t('common.viewAll')} <ChevronRight size={12} />
              </Link>
            </div>
            {recentItems.length === 0 ? (
              <div className="rounded-card bg-surface p-8 ring-1 ring-hairline">
                <EmptyState message={t('sessions.noSessions')} icon={MessageSquare} />
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-3 md:grid-cols-3 xl:grid-cols-4">
                {recentItems.map((item) => item.kind === 'dsh' ? (
                  <a
                    key={`dsh-${item.ch.id}`}
                    href={dshUrl} onClick={openDsh}
                    className="block min-w-0 overflow-hidden rounded-card bg-surface p-4 ring-1 ring-hairline transition-[box-shadow,background-color] duration-state ease-ui-standard hover:ring-hairline-strong"
                  >
                    <div className="mb-3 flex items-center gap-2.5">
                      <span className="h-2 w-2 shrink-0 rounded-full bg-hairline-strong" aria-hidden />
                      <p className="truncate text-sm font-medium text-ink">#{item.ch.name}</p>
                    </div>
                    <Badge className="mb-2">DSH</Badge>
                    {item.ch.error && <p>{t('dsh.messagesError', '消息读取失败')}: {item.ch.error}</p>}
                    {item.ch.last_message && (
                      <p className="mb-2 truncate text-xs text-ink-mute">
                        {item.ch.last_message.name}：{item.ch.last_message.content.slice(0, 60)}
                      </p>
                    )}
                    <div className="flex items-center gap-1 text-xs text-ink-mute">
                      <Clock size={10} />
                      {formatTime(item.ch.updated_at)}
                    </div>
                  </a>
                ) : ((sess) => (
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
                ))(item.sess))}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
