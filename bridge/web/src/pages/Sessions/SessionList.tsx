import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MessagesSquare, Trash2, X } from 'lucide-react';
import { Badge, Button, EmptyState, Modal } from '@/components/ui';
import { cn } from '@/lib/utils';
import { useEntrance } from '@/lib/useEntrance';
import { listProjects, shownName, type ProjectSummary } from '@/api/projects';
import { deleteSession, listSessions, type Session } from '@/api/sessions';
import { dshStatus, getDSHSummary, type DSHChannel, type DSHSummary } from '@/api/dsh';
import { DSHNotice, errorMessage } from '@/components/DSHNotice';
import { dshChannelsUrl } from '@/lib/collabPages';
import api from '@/api/client';
import { SessionCard, SessionRow, sessionKey } from './SessionCard';
import { SessionDrawer } from './SessionDrawer';
import { SessionFiltersBar } from './SessionFilters';
import {
  emptySessionFilters,
  filterSessions,
  flattenSessions,
  sessionProjectFacets,
  sessionTotals,
  type FlatSession,
  type SessionFilters,
  type SessionView,
} from './sessionListModel';

/** 视图存本机，理由同项目页：没有账号体系，localStorage 是唯一能记住偏好的地方。 */
const VIEW_KEY = 'cc.sessions.view';

function initialView(): SessionView {
  try {
    return localStorage.getItem(VIEW_KEY) === 'row' ? 'row' : 'card';
  } catch {
    return 'card';
  }
}

export default function SessionList() {
  const { t } = useTranslation();
  const scope = useEntrance<HTMLDivElement>();
  const [data, setData] = useState<{ project: string; sessions: Session[] }[]>([]);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState<SessionFilters>(emptySessionFilters);
  const [view, setView] = useState<SessionView>(initialView);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [preview, setPreview] = useState<FlatSession | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [note, setNote] = useState('');
  // DSH's own channels: listed under the bridge sessions, opened on DSH's channels page.
  const [dshChannels, setDshChannels] = useState<DSHChannel[]>([]);
  const [dsh, setDsh] = useState<DSHSummary | null>(null);
  const [loadError, setLoadError] = useState('');
  const [dshError, setDshError] = useState('');

  const fetchData = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const { projects: projs } = await listProjects();
      setProjects(projs || []);
      const results = await Promise.all(
        (projs || []).map(async (p) => {
          try {
            const { sessions } = await listSessions(p.name);
            return { project: p.name, sessions: sessions || [] };
          } catch (e) {
            setLoadError(errorMessage(e));
            return { project: p.name, sessions: [] };
          }
        })
      );
      setData(results);
      try {
        const d = await getDSHSummary();
        setDsh(d); setDshError('');
        setDshChannels(dshStatus(d) === 'running' ? d.channels || [] : []);
      } catch (e) {
        setDsh(null); setDshChannels([]); setDshError(errorMessage(e));
      }
    } catch (e) {
      setLoadError(errorMessage(e));
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

  const all = useMemo(() => flattenSessions(data), [data]);
  const shown = useMemo(() => filterSessions(all, filters), [all, filters]);
  const facets = useMemo(() => sessionProjectFacets(data, projects), [data, projects]);
  const totals = useMemo(() => sessionTotals(all), [all]);
  const projectLabel = useMemo(() => {
    const byName = new Map(projects.map((p) => [p.name, shownName(p)]));
    return (name: string) => byName.get(name) || name;
  }, [projects]);

  const toggleSelect = useCallback((key: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const changeView = (next: SessionView) => {
    setView(next);
    try {
      localStorage.setItem(VIEW_KEY, next);
    } catch {
      /* 隐私模式下写不进，本轮仍然生效 */
    }
  };

  const selectedKeys = useMemo(() => [...selected], [selected]);
  const allShownSelected = shown.length > 0 && shown.every((s) => selected.has(sessionKey(s)));

  const toggleSelectAll = () => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allShownSelected) shown.forEach((s) => next.delete(sessionKey(s)));
      else shown.forEach((s) => next.add(sessionKey(s)));
      return next;
    });
  };

  const runDelete = async () => {
    setDeleting(true);
    setNote('');
    const failed: string[] = [];
    for (const key of selectedKeys) {
      const [project, id] = key.split('::');
      try {
        await deleteSession(project, id);
      } catch {
        failed.push(key);
      }
    }
    setDeleting(false);
    setConfirmDelete(false);
    setSelected(new Set());
    await fetchData();
    if (failed.length) {
      setNote(t('sessions.deleteFailed', '{{count}} 条没删掉。', { count: failed.length }));
    }
  };

  if (loading && all.length === 0) {
    return (
      <div className="grid flex-1 place-items-center py-24">
        <span className="text-sm text-ink-mute" role="status">{t('common.loading')}</span>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight text-ink">{t('sessions.title')}</h1>
          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-ink-mute">
            <span className="tabular-nums">
              {totals.sessions} {t('sessions.title')}
            </span>
            {totals.live > 0 && (
              <span className="inline-flex items-center gap-1.5 tabular-nums text-emerald-600 dark:text-emerald-400">
                <span className="relative flex h-1.5 w-1.5">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                </span>
                {totals.live} {t('sessions.active')}
              </span>
            )}
            <span className="tabular-nums">
              {totals.projects} {t('projects.title')}
            </span>
          </p>
        </div>
      </header>

      <SessionFiltersBar
        filters={filters}
        facets={facets}
        view={view}
        onChange={setFilters}
        onViewChange={changeView}
        shown={shown.length}
        total={all.length}
      />

      <div
        data-testid="session-bulk-bar"
        data-ui="bulk-bar"
        className={cn(
          'sticky top-0 z-20 flex min-h-11 flex-wrap items-center gap-2 overflow-hidden rounded-card px-3 py-1',
          'border border-hairline bg-surface transition-[border-color] duration-state ease-ui-standard',
          selectedKeys.length > 0
            ? 'pointer-events-auto translate-y-0 opacity-100'
            : 'pointer-events-none hidden'
        )}
        aria-hidden={selectedKeys.length === 0}
      >
        <button
          type="button"
          onClick={toggleSelectAll}
          className="min-h-11 px-1 text-[13px] font-medium text-accent-text hover:underline focus-visible:outline-none sm:min-h-0"
        >
          {allShownSelected ? t('projects.unselectAll', '取消全选') : t('projects.selectAll', '全选当前')}
        </button>
        <Badge variant="info" className="tabular-nums">
          {selectedKeys.length}
        </Badge>
        <span className="hidden min-w-0 flex-1 truncate text-[13px] text-ink-mute sm:block">
          {t('sessions.selectedHint', '批量删除只删会话记录，不影响项目配置')}
        </span>
        <Button size="sm" variant="danger" className="ml-auto h-11 sm:ml-0 sm:h-7" onClick={() => setConfirmDelete(true)}>
          <Trash2 size={13} /> {t('common.delete')}
        </Button>
        <button
          type="button"
          onClick={() => setSelected(new Set())}
          aria-label={t('projects.clearSelection', '清空选择')}
          className="grid h-11 w-11 place-items-center rounded-control text-ink-mute hover:bg-surface-sunken hover:text-ink sm:h-8 sm:w-8"
        >
          <X size={15} />
        </button>
      </div>

      {note && (
        <p className="rounded-control bg-surface-sunken px-3 py-2 text-[13px] text-ink-soft" role="status">
          {note}
        </p>
      )}

      {shown.length === 0 ? (
        all.length === 0 ? (
          dshChannels.length > 0 ? null :
          <EmptyState
            message={t('sessions.noSessions')}
            icon={MessagesSquare}
            hint={t('sessions.emptyHint', '在任意平台的对话里给机器人发一句话，会话就会出现在这里。')}
          />
        ) : (
          <EmptyState
            message={t('sessions.noMatch', '没有符合筛选的会话')}
            icon={MessagesSquare}
            hint={t('sessions.noMatchHint', '换个关键词，或清掉项目与状态筛选。')}
          />
        )
      ) : view === 'card' ? (
        <div ref={scope} className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {shown.map((s) => (
            <SessionCard
              key={sessionKey(s)}
              session={s}
              projectLabel={projectLabel(s._project)}
              selected={selected.has(sessionKey(s))}
              onToggleSelect={toggleSelect}
              onPreview={setPreview}
            />
          ))}
        </div>
      ) : (
        <div ref={scope} className="flex flex-col gap-1.5">
          {shown.map((s) => (
            <SessionRow
              key={sessionKey(s)}
              session={s}
              projectLabel={projectLabel(s._project)}
              selected={selected.has(sessionKey(s))}
              onToggleSelect={toggleSelect}
              onPreview={setPreview}
            />
          ))}
        </div>
      )}

      {loadError && <p role="alert">{loadError}</p>}
      <DSHNotice status={dshError ? 'error' : dsh ? dshStatus(dsh) : undefined} error={dshError || dsh?.error} />
      {dshChannels.length > 0 && (
        <section className="space-y-2">
          <h3 className="text-sm font-semibold text-ink">DSH 频道</h3>
          <div className="flex flex-col gap-1.5">
            {dshChannels.map((ch) => (
              <a
                key={ch.id}
                href={dshChannelsUrl(undefined, api.getToken())}
                className="flex min-w-0 items-center gap-3 rounded-control bg-surface px-3 py-2 ring-1 ring-hairline hover:ring-hairline-strong"
              >
                <span className="shrink-0 text-[13px] font-medium text-ink">#{ch.name}</span>
                <span className="min-w-0 flex-1 truncate text-xs text-ink-mute">
                  {ch.error ? t('dsh.messagesError', '消息读取失败') : ch.last_message ? `${ch.last_message.name}：${ch.last_message.content}` : t('dsh.noMessages', '还没有消息')}
                </span>
                {ch.updated_at && (
                  <span className="shrink-0 text-xs text-ink-mute tabular-nums">
                    {new Date(ch.updated_at).toLocaleString()}
                  </span>
                )}
              </a>
            ))}
          </div>
        </section>
      )}

      <SessionDrawer
        session={preview}
        projectLabel={preview ? projectLabel(preview._project) : ''}
        onClose={() => setPreview(null)}
      />

      <Modal
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title={t('sessions.deleteTitle', '删除会话')}
      >
        <p className="text-sm text-ink-soft">
          {t('sessions.deleteBody', '将删除选中的 {{count}} 条会话记录，此操作不可撤销。', {
            count: selectedKeys.length,
          })}
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setConfirmDelete(false)} disabled={deleting}>
            {t('common.cancel')}
          </Button>
          <Button variant="danger" onClick={runDelete} loading={deleting}>
            {t('common.delete')}
          </Button>
        </div>
      </Modal>
    </div>
  );
}
