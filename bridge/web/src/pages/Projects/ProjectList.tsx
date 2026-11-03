import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { FolderKanban, Plus, Settings2, Trash2, X } from 'lucide-react';
import { Badge, Button, EmptyState, Modal } from '@/components/ui';
import { cn } from '@/lib/utils';
import { useEntrance } from '@/lib/useEntrance';
import { deleteProject, listProjects, type ProjectSummary } from '@/api/projects';
import { ProjectCard, ProjectRow } from './ProjectCard';
import { ProjectDrawer } from './ProjectDrawer';
import { ProjectFilterBar } from './ProjectFilterBar';
import { ProjectWizard } from './ProjectWizard';
import {
  agentFacets,
  emptyProjectFilters,
  filterProjects,
  projectTotals,
  type ProjectFilters,
  type ProjectView,
} from './projectListModel';

/** 视图选择存本机：同一个人下次进来还在自己习惯的那种排布（无账号体系，localStorage 是唯一去处）。 */
const VIEW_KEY = 'cc.projects.view';

function initialView(): ProjectView {
  try {
    const saved = localStorage.getItem(VIEW_KEY);
    return saved === 'list' ? 'list' : 'grid';
  } catch {
    return 'grid';
  }
}

export default function ProjectList() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const scope = useEntrance<HTMLDivElement>();

  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState<ProjectFilters>(emptyProjectFilters);
  const [view, setView] = useState<ProjectView>(initialView);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [preview, setPreview] = useState<ProjectSummary | null>(null);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteNote, setDeleteNote] = useState('');

  const fetchProjects = useCallback(async () => {
    try {
      setLoading(true);
      const data = await listProjects();
      setProjects(data.projects || []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchProjects();
    const handler = () => fetchProjects();
    window.addEventListener('cc:refresh', handler);
    return () => window.removeEventListener('cc:refresh', handler);
  }, [fetchProjects]);

  // 老入口：?manual=1 直接进手动向导（兼容旧链接）。
  useEffect(() => {
    if (params.get('manual') === '1') setWizardOpen(true);
  }, [params]);

  // 一个项目都没有时不摆空页面，直接去 setup：这里是配置入口不是展示页。
  useEffect(() => {
    if (!loading && projects.length === 0 && params.get('manual') !== '1') {
      navigate('/setup', { replace: true });
    }
  }, [loading, projects.length, params, navigate]);

  const shown = useMemo(() => filterProjects(projects, filters), [projects, filters]);
  const facets = useMemo(() => agentFacets(projects), [projects]);
  const totals = useMemo(() => projectTotals(projects), [projects]);

  const toggleSelect = useCallback((name: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }, []);

  const changeView = (next: ProjectView) => {
    setView(next);
    try {
      localStorage.setItem(VIEW_KEY, next);
    } catch {
      /* 隐私模式写不进就算了，视图仍在本轮生效 */
    }
  };

  const selectedNames = useMemo(() => [...selected], [selected]);
  const allShownSelected = shown.length > 0 && shown.every((p) => selected.has(p.name));

  const toggleSelectAll = () => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allShownSelected) shown.forEach((p) => next.delete(p.name));
      else shown.forEach((p) => next.add(p.name));
      return next;
    });
  };

  const runDelete = async () => {
    setDeleting(true);
    setDeleteNote('');
    const failed: string[] = [];
    let restart = false;
    for (const name of selectedNames) {
      try {
        const res = await deleteProject(name);
        if (res?.restart_required) restart = true;
      } catch {
        failed.push(name);
      }
    }
    setDeleting(false);
    setConfirmDelete(false);
    setSelected(new Set());
    await fetchProjects();
    if (failed.length) {
      setDeleteNote(t('projects.deleteFailed', '{{count}} 个没删掉：{{names}}', { count: failed.length, names: failed.join(', ') }));
    } else if (restart) {
      setDeleteNote(t('projects.deleteNeedsRestart', '已删除，重启服务后生效。'));
    } else {
      setDeleteNote('');
    }
  };

  if (loading && projects.length === 0) {
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
          <h1 className="text-xl font-semibold tracking-tight text-ink">{t('projects.title')}</h1>
          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-ink-mute">
            <span className="tabular-nums">
              {totals.projects} {t('projects.title')}
            </span>
            <span className="tabular-nums">
              {totals.sessions} {t('nav.sessions').toLowerCase()}
            </span>
            {totals.platforms > 0 && (
              <span className="tabular-nums">
                {totals.platforms} {t('projects.platforms')}
              </span>
            )}
            {totals.heartbeat > 0 && (
              <span className="tabular-nums text-emerald-600 dark:text-emerald-400">
                {totals.heartbeat} {t('projects.heartbeat')}
              </span>
            )}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button size="sm" variant="ghost" className="h-11 sm:h-7" onClick={() => setWizardOpen(true)}>
            <Settings2 size={14} /> {t('setup.manualSetup', '手动配置')}
          </Button>
          <Button size="sm" className="h-11 sm:h-7" onClick={() => navigate('/setup')} data-testid="open-setup-wizard">
            <Plus size={14} /> {t('setup.addProject', '新建项目')}
          </Button>
        </div>
      </header>

      <ProjectFilterBar
        filters={filters}
        facets={facets}
        view={view}
        onChange={setFilters}
        onViewChange={changeView}
        shown={shown.length}
        total={projects.length}
      />

      {/* 批量条：只在选中时出现，贴着内容顶部；高度固定，不跳版。 */}
      <div
        data-testid="project-bulk-bar"
        data-ui="bulk-bar"
        className={cn(
          'sticky top-0 z-20 flex min-h-11 flex-wrap items-center gap-2 overflow-hidden rounded-card px-3 py-1',
          'border border-hairline bg-surface transition-[border-color] duration-state ease-ui-standard',
          selectedNames.length > 0
            ? 'pointer-events-auto translate-y-0 opacity-100'
            : 'pointer-events-none -translate-y-1 opacity-0'
        )}
        aria-hidden={selectedNames.length === 0}
      >
        <button
          type="button"
          onClick={toggleSelectAll}
          className="min-h-11 px-1 text-[13px] font-medium text-accent-text hover:underline focus-visible:outline-none sm:min-h-0"
        >
          {allShownSelected ? t('projects.unselectAll', '取消全选') : t('projects.selectAll', '全选当前')}
        </button>
        <Badge variant="info" className="tabular-nums">
          {selectedNames.length}
        </Badge>
        <span className="hidden min-w-0 flex-1 truncate text-[13px] text-ink-mute sm:block">
          {t('projects.selectedHint', '已选中的项目可批量删除')}
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

      {deleteNote && (
        <p className="rounded-control bg-surface-sunken px-3 py-2 text-[13px] text-ink-soft" role="status">
          {deleteNote}
        </p>
      )}

      {shown.length === 0 ? (
        projects.length === 0 ? (
          <EmptyState
            message={t('projects.noProjects')}
            icon={FolderKanban}
            hint={t('projects.emptyHint', '点右上角「新建项目」接入第一个 agent。')}
          />
        ) : (
          <EmptyState
            message={t('projects.noMatch', '没有符合筛选的项目')}
            icon={FolderKanban}
            hint={t('projects.noMatchHint', '换个关键词，或清掉筛选条件。')}
          />
        )
      ) : view === 'grid' ? (
        <div ref={scope} className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {shown.map((p) => (
            <ProjectCard
              key={p.name}
              project={p}
              selected={selected.has(p.name)}
              onToggleSelect={toggleSelect}
              onPreview={setPreview}
            />
          ))}
        </div>
      ) : (
        <div ref={scope} className="flex flex-col gap-1.5">
          {shown.map((p) => (
            <ProjectRow
              key={p.name}
              project={p}
              selected={selected.has(p.name)}
              onToggleSelect={toggleSelect}
              onPreview={setPreview}
            />
          ))}
        </div>
      )}

      <ProjectDrawer project={preview} onClose={() => setPreview(null)} />

      <ProjectWizard
        open={wizardOpen}
        onClose={() => setWizardOpen(false)}
        onCreated={() => {
          setWizardOpen(false);
          fetchProjects();
        }}
      />

      <Modal
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title={t('projects.deleteTitle', '删除项目')}
      >
        <p className="text-sm text-ink-soft">
          {t('projects.deleteBody', '将删除选中的 {{count}} 个项目及其配置，此操作不可撤销。', {
            count: selectedNames.length,
          })}
        </p>
        <ul className="mt-3 max-h-40 space-y-1 overflow-y-auto text-[13px] text-ink-mute">
          {selectedNames.map((n) => (
            <li key={n} className="truncate">
              {n}
            </li>
          ))}
        </ul>
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
