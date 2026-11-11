import { useEffect, useRef, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import {
  ChevronRight, Sparkles, AlertTriangle, CheckCircle2, ArrowUpRight, WifiOff, Radio,
} from 'lucide-react';
import { Badge, EmptyState, LoadingState, Bars, RoleAvatar, StatePill, roleState, type RoleState } from '@/components/ui';
import { listRoles, type RoleInfo } from '@/api/roles';
import { backendLabel } from '@/lib/roleIdentity';
import { cn } from '@/lib/utils';
import { getStatus, type SystemStatus } from '@/api/status';
import { listProjects, shownName, type ProjectSummary } from '@/api/projects';
import { connectedSources, dshStatus, getDSHSummary, type DSHSummary } from '@/api/dsh';
import { errorMessage } from '@/components/DSHNotice';
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  // DSH's own members and channels (only DSH, no bridge project: the counts would read 0 otherwise)
  const [dshError, setDshError] = useState('');
  const [dsh, setDsh] = useState<DSHSummary | null>(null);
  // #579 v2: the overview answers "who is busy, on what, and is anything wrong", so it reads roles too
  const [roles, setRoles] = useState<RoleInfo[] | null>(null);
  const requestId = useRef(0);
  const loaded = useRef(false);

  const fetchData = useCallback(async () => {
    const request = ++requestId.current;
    try {
      if (!loaded.current) setLoading(true);
      setError('');
      const [s, p, result] = await Promise.all([getStatus(), listProjects(), Promise.allSettled([getDSHSummary(), listRoles()])]);
      const d = result[0];
      const r = result[1];
      const projs = p.projects || [];

      if (request !== requestId.current) return;
      setDshError(d.status === 'rejected' ? errorMessage(d.reason) : '');
      setStatus(s);
      setDsh(d.status === 'fulfilled' ? d.value : null);
      if (r.status === 'fulfilled') {
        const all = r.value.roles || [];
        setRoles(dshOnlyRows(all, all.filter((x) => x.source !== 'dsh').map((x) => x.name)));
      } else setRoles(null);
      setProjects(projs);
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
  const btn = 'shrink-0 rounded-control bg-surface px-3 py-1.5 text-xs font-medium text-ink ring-1 ring-hairline transition-colors hover:bg-surface-sunken disabled:opacity-60';
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
  // Per-role conversations live on 对话 (/chat); the overview no longer repeats them. DSH channels
  // are not on that page, so they keep a short list here, newest first.
  const recentChannels = [...dshChannels]
    .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
    .slice(0, MAX_ITEMS);
  const failedChannels = recentChannels.filter((ch) => ch.error).length;

  // Who is doing what: roles from /roles, plus DSH members that /roles did not list (busy first).
  const ago = (iso: string) => {
    const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
    if (!(mins >= 0)) return '';
    if (mins < 1) return t('sessions.justNow');
    if (mins < 60) return `${mins}m`;
    if (mins < 1440) return `${Math.floor(mins / 60)}h`;
    return `${Math.floor(mins / 1440)}d`;
  };
  type LiveRow = { key: string; name: string; sub: string; state: RoleState; task: string; model: string; agentType?: string; avatar?: string; href?: string };
  const order: Record<RoleState, number> = { busy: 0, idle: 1, paused: 2, offline: 3 };
  const liveRows: LiveRow[] = [
    ...(roles ?? []).map((r) => ({
      key: `r-${r.name}`, name: shownName(r) || r.name, sub: backendLabel(r.agent_type),
      state: roleState(r), task: r.current_task, model: r.model, agentType: r.agent_type,
    })),
    ...dshMembers
      .filter((m) => !(roles ?? []).some((r) => (shownName(r) || r.name) === (m.display_name || m.name)))
      .map((m) => ({ key: `d-${m.name}`, name: m.display_name || m.name, sub: 'DSH', state: roleState(m), task: m.busy ? m.current_task : '', model: m.model || '', agentType: m.agent_type || 'dsh', href: dshUrl })),
  ].sort((a, b) => order[a.state] - order[b.state]);
  const tally = liveRows.reduce((acc, r) => { acc[r.state] += 1; return acc; }, { busy: 0, idle: 0, offline: 0, paused: 0 } as Record<RoleState, number>);

  // Things that need a look, gathered from what the page already read; nothing is inferred.
  type Issue = { key: string; text: string; tone: 'warn' | 'mute'; action?: React.ReactNode };
  const issues: Issue[] = [];
  if (error && status) issues.push({ key: 'err', text: error, tone: 'warn' });
  const dshState = dshError ? 'error' : dsh ? dshStatus(dsh) : undefined;
  if (dshState === 'error') issues.push({ key: 'dsh', text: `${t('dsh.readError', 'DSH 读取失败')}${dshError || dsh?.error ? `: ${dshError || dsh?.error}` : ''}`, tone: 'warn' });
  if (dshState === 'stopped') issues.push({ key: 'dsh', text: t('dsh.stopped', 'DSH 未运行'), tone: 'mute', action: dshSetUp ? openDshButton : undefined });
  for (const r of roles ?? []) {
    for (const p of r.platforms ?? []) if (p.notice) issues.push({ key: `n-${r.name}-${p.name}`, text: `${shownName(r) || r.name} · ${p.name}: ${p.notice}`, tone: 'warn' });
  }
  for (const r of liveRows) if (r.state === 'offline') issues.push({ key: `off-${r.key}`, text: `${r.name} ${t('dashboard.isOffline', '不在线')}`, tone: 'mute' });

  const headline = liveRows.length === 0
    ? t('dashboard.headlineEmpty', '还没有角色在这里')
    : tally.busy > 0
      ? t('dashboard.headlineBusy', { busy: tally.busy, idle: tally.idle, defaultValue: '{{busy}} 个角色在忙，{{idle}} 个空闲' })
      : t('dashboard.headlineIdle', { count: liveRows.length - tally.offline - tally.paused, defaultValue: '{{count}} 个角色都在待命' });
  const warnCount = issues.filter((i) => i.tone === 'warn').length;

  const metric = (label: string, value: string | number, testid?: string) => (
    <div className="min-w-0 rounded-card bg-surface px-3 py-2.5 shadow-ui-1 sm:px-4 sm:py-3" data-testid={testid}>
      <span className="block truncate text-[11px] text-ink-mute sm:text-xs">{label}</span>
      <span className="mt-1 block truncate text-lg font-semibold tabular-nums tracking-tight text-ink sm:text-xl">{value}</span>
    </div>
  );
  const cardHead = (title: string, to?: string, extra?: React.ReactNode) => (
    <div className="mb-3 flex items-center justify-between gap-2 px-1">
      <h2 className="text-[13px] font-semibold uppercase tracking-wider text-ink-mute">{title}</h2>
      <span className="flex items-center gap-2">
        {extra}
        {to && <Link to={to} className="flex items-center gap-0.5 text-xs font-medium text-accent-text hover:underline">{t('common.viewAll')} <ChevronRight size={12} /></Link>}
      </span>
    </div>
  );

  return (
    <div className="space-y-8 animate-fade-in">
      {/* Hero: one sentence on the state of the house, health underneath, numbers on the side */}
      <section className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-x-2 text-xs font-medium text-ink-mute">
            <span>{t('dashboard.title')}</span><span aria-hidden>·</span>
            <span className="tabular-nums">{t('dashboard.version')} {status?.version || '-'}</span><span aria-hidden>·</span>
            <span className="tabular-nums">{t('dashboard.uptime')} {status ? formatUptime(status.uptime_seconds) : '-'}</span>
          </p>
          <h1 className="mt-2 text-[28px] font-semibold leading-tight tracking-tight text-ink sm:text-[34px]" data-testid="dashboard-headline">{headline}</h1>
          <p className={cn('mt-3 inline-flex items-center gap-2 rounded-pill px-3 py-1.5 text-sm font-medium',
            warnCount > 0 ? 'bg-amber-500/10 text-amber-800 dark:text-amber-300 yellow:text-amber-900' : 'bg-emerald-500/10 text-emerald-800 dark:text-emerald-300')}>
            {warnCount > 0 ? <AlertTriangle size={15} /> : <CheckCircle2 size={15} />}
            {warnCount > 0 ? t('dashboard.needsLook', { count: warnCount, defaultValue: '{{count}} 件事需要看一下' }) : t('dashboard.allGood', '一切正常')}
          </p>
        </div>
        <div className="grid grid-cols-4 gap-2 lg:w-[460px]">
          {metric(t('nav.roles'), liveRows.length)}
          {metric(t('dashboard.platforms'), platformCount)}
          {metric(t('dashboard.projects'), status?.projects_count ?? 0)}
          {metric(t('dashboard.busyNow', '在忙'), tally.busy)}
        </div>
      </section>

      {loading && !status ? (
        <LoadingState label={t('common.loading')} />
      ) : error && !status ? (
        <div className="rounded-card bg-red-500/10 p-4 text-sm text-red-700 ring-1 ring-red-500/25 dark:text-red-400">{error}</div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
          <div className="min-w-0 space-y-6">
            {issues.length > 0 && (
              <section>
                {cardHead(t('dashboard.attention', '需要注意'))}
                <ul className="divide-y divide-hairline overflow-hidden rounded-card bg-surface shadow-ui-1" role="list">
                  {issues.map((i) => (
                    <li key={i.key} className="flex items-start gap-3 px-4 py-3 text-sm" role={i.tone === 'warn' ? 'alert' : undefined}>
                      <span className={cn('mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full', i.tone === 'warn' ? 'bg-amber-500/15 text-amber-700 dark:text-amber-400' : 'bg-surface-sunken text-ink-mute')}>
                        {i.tone === 'warn' ? <AlertTriangle size={13} /> : <WifiOff size={13} />}
                      </span>
                      <span className="min-w-0 flex-1 break-words leading-6 text-ink-soft">{i.text}</span>
                      {i.action && <span className="shrink-0">{i.action}</span>}
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <section>
              {cardHead(t('dashboard.live', '正在发生'), '/roles', dshMembers.length > 0 && dshSetUp ? openDshButton : undefined)}
              {liveRows.length === 0 ? (
                <div className="rounded-card bg-surface p-8 shadow-ui-1">
                  <EmptyState message={t('roles.noRoles', '暂无角色配置')} hint={t('shell.addRoleHint')} />
                </div>
              ) : (
                <ul className="divide-y divide-hairline overflow-hidden rounded-card bg-surface shadow-ui-1" role="list">
                  {liveRows.map((r) => {
                    const inner = (
                      <>
                        <RoleAvatar name={r.name} state={r.state} size={40} model={r.model} agentType={r.agentType} avatar={r.avatar} />
                        <div className="min-w-0 flex-1">
                          <div className="flex min-w-0 items-center gap-2">
                            <span className="truncate text-[15px] font-semibold text-ink">{r.name}</span>
                            <span className="hidden truncate text-xs text-ink-mute sm:inline">{r.sub}</span>
                          </div>
                          <p className={cn('mt-0.5 truncate text-sm', r.state === 'busy' ? 'text-ink' : 'text-ink-mute')}>
                            {r.state === 'busy' ? (r.task || t('dashboard.working', '正在处理')) : r.state === 'idle' ? t('dashboard.waiting', '待命中') : r.state === 'paused' ? t('dashboard.pausedNote', '已暂停，不接新消息') : t('dashboard.offlineNote', '连不上')}
                          </p>
                        </div>
                        {r.model && <span className="hidden max-w-[180px] truncate rounded-control bg-surface-sunken px-2 py-1 font-mono text-[11px] text-ink-soft xl:inline">{r.model}</span>}
                        <StatePill state={r.state} />
                      </>
                    );
                    const cls = 'flex items-center gap-3 px-4 py-3.5 transition-colors duration-base hover:bg-surface-sunken/60';
                    return (
                      <li key={r.key}>
                        {r.href ? <a href={r.href} onClick={openDsh} className={cls}>{inner}</a> : <Link to="/roles" className={cls}>{inner}</Link>}
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>

            {/* #610: sessions per project sit under 正在发生 so the two columns end at similar heights */}
            {projectRows.length > 0 && (
              <section>
                {cardHead(t('dashboard.projectSessions', '各项目会话数'), '/projects')}
                <div className="rounded-card bg-surface p-5 shadow-ui-1">
                  <Bars data={projectRows.slice(0, 6)} labelWidth={96} />
                </div>
              </section>
            )}
          </div>

          <aside className="min-w-0 space-y-6">
            {recentChannels.length > 0 && (
              <section>
                {cardHead(t('dsh.channels', 'DSH 频道'))}
                <ul className="divide-y divide-hairline overflow-hidden rounded-card bg-surface shadow-ui-1" role="list">
                  {recentChannels.map((ch) => {
                    const preview = ch.last_message ? `${ch.last_message.name}：${ch.last_message.content.slice(0, 80)}` : ch.error ? '' : t('dsh.noMessages', '还没有消息');
                    return (
                      <li key={`dsh-${ch.id}`}>
                        <a href={dshUrl} onClick={openDsh} className="flex items-center gap-3 px-4 py-3 transition-colors duration-base hover:bg-surface-sunken/60">
                          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] bg-sky-500/10 text-sky-700 dark:text-sky-300"><Radio size={16} /></span>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="truncate text-sm font-medium text-ink">#{ch.name}</span>
                              <span className="ml-auto shrink-0 text-[11px] tabular-nums text-ink-mute" title={formatTime(ch.updated_at)}>{ago(ch.updated_at)}</span>
                            </div>
                            {preview && <p className="mt-0.5 truncate text-xs text-ink-mute">{preview}</p>}
                          </div>
                        </a>
                      </li>
                    );
                  })}
                </ul>
                {failedChannels > 0 && (
                  <p className="mt-2 px-1 text-xs text-ink-mute" data-testid="dashboard-dsh-read-error">
                    {t('dsh.messagesErrorCount', { count: failedChannels, defaultValue: '{{count}} 个频道的消息暂时读不到' })}
                  </p>
                )}
              </section>
            )}

            <section>
              {cardHead(t('dashboard.platforms'))}
              <div className="rounded-card bg-surface p-4 shadow-ui-1">
                {platformCount > 0 ? (
                  <div className="flex flex-wrap gap-1.5">{platformNames.map((n) => <Badge key={n} variant="success">{n}</Badge>)}</div>
                ) : <p className="text-sm text-ink-mute">{t('dashboard.noData')}</p>}
                <p className="mt-3 text-xs leading-5 text-ink-mute">{t('dshManage.projectScope')}</p>
              </div>
            </section>

            <Link
              to="/wiki-galaxy"
              // base colour under the gradient: the light end of the gradient is only the fill accent at
              // 90%, so the card keeps a solid accent backdrop and the gradient rides on top of it
              className="group relative flex items-center gap-3 overflow-hidden rounded-card bg-accent bg-gradient-to-br from-accent/90 to-accent-dim p-4 text-white shadow-ui-1 transition-transform duration-base hover:-translate-y-0.5 dark:text-black yellow:text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-text"
            >
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[12px] bg-white/20"><Sparkles size={19} /></span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold">{t('wikiGalaxy.title')}</p>
                <p className="mt-0.5 truncate text-xs">{t('wikiGalaxy.subtitle')}</p>
              </div>
              <ArrowUpRight size={16} className="shrink-0 opacity-80 transition-transform duration-base group-hover:translate-x-0.5" />
            </Link>
          </aside>
        </div>
      )}
    </div>
  );
}
