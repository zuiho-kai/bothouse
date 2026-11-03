import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { ArrowRight, HeartPulse, Plug, X } from 'lucide-react';
import { Badge } from '@/components/ui';
import { cn } from '@/lib/utils';
import { getProject, shownName, type ProjectDetail, type ProjectSummary } from '@/api/projects';

interface DrawerProps {
  project: ProjectSummary | null;
  onClose: () => void;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2">
      <span className="shrink-0 text-xs text-ink-mute">{label}</span>
      <span className="min-w-0 truncate text-right text-sm text-ink">{children}</span>
    </div>
  );
}

/**
 * 详情抽屉：从右侧滑入，不离开列表上下文（关掉就能继续翻）。
 * 数据先用列表里的 ProjectSummary 立即画出骨架，再补一次 getProject 换真实平台连接状态——
 * 打开不空白，是一步到位的观感差别。
 */
export function ProjectDrawer({ project, onClose }: DrawerProps) {
  const { t } = useTranslation();
  const [detail, setDetail] = useState<ProjectDetail | null>(null);
  const [entered, setEntered] = useState(false);

  useEffect(() => {
    if (!project) {
      setEntered(false);
      return;
    }
    setDetail(null);
    let alive = true;
    getProject(project.name)
      .then((d) => alive && setDetail(d))
      .catch(() => alive && setDetail(null));
    const raf = requestAnimationFrame(() => alive && setEntered(true));
    return () => {
      alive = false;
      cancelAnimationFrame(raf);
    };
  }, [project]);

  useEffect(() => {
    if (!project) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [project, onClose]);

  if (!project) return null;

  const platforms = detail?.platforms ?? (project.platforms ?? []).map((type) => ({ type, connected: true }));

  return (
    <div className="fixed inset-0 z-[9998]" role="presentation">
      <div
        className={cn(
          'absolute inset-0 bg-black/25 transition-opacity duration-state ease-ui-standard',
          entered ? 'opacity-100' : 'opacity-0'
        )}
        onClick={onClose}
        role="presentation"
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={shownName(project)}
        className={cn(
          'absolute inset-y-0 right-0 flex w-full max-w-[420px] flex-col bg-surface shadow-ui-3',
          'transition-transform duration-state ease-ui-out',
          entered ? 'translate-x-0' : 'translate-x-full'
        )}
      >
        <header data-ui="drawer-header" className="flex items-start justify-between gap-3 border-b border-hairline px-5 py-4">
          <div className="min-w-0">
            <h2 className="truncate text-base font-semibold tracking-tight text-ink">{shownName(project)}</h2>
            <p className="mt-0.5 truncate text-xs text-ink-mute">{project.name}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('common.close', '关闭')}
            className="grid h-11 w-11 shrink-0 place-items-center rounded-control text-ink-mute transition-colors duration-base ease-ui-out hover:bg-surface-sunken hover:text-ink focus-visible:outline-none focus-visible:shadow-ui-ring sm:h-9 sm:w-9"
          >
            <X size={17} />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-3">
          <section className="divide-y divide-hairline">
            <Field label={t('projects.agent', 'Agent')}>
              <span className="text-ink">{project.agent_type}</span>
            </Field>
            <Field label={t('nav.sessions', '会话')}>
              <span className="tabular-nums">{project.sessions_count ?? 0}</span>
            </Field>
            <Field label={t('projects.heartbeat', '心跳')}>
              {project.heartbeat_enabled ? (
                <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                  <HeartPulse size={13} /> {t('projects.on', '开启')}
                </span>
              ) : (
                <span className="text-ink-mute">{t('projects.off', '关闭')}</span>
              )}
            </Field>
            {detail?.work_dir && (
              <Field label={t('projects.workDir', '工作目录')}>
                <code className="font-mono text-xs text-ink-soft" title={detail.work_dir}>
                  {detail.work_dir}
                </code>
              </Field>
            )}
            {detail?.settings?.language && (
              <Field label={t('projects.language', '语言')}>{detail.settings.language}</Field>
            )}
          </section>

          <h3 className="mb-2 mt-5 text-xs font-medium text-ink-mute">
            {t('projects.platforms', '平台')}
          </h3>
          {platforms.length === 0 ? (
            <p className="text-sm text-ink-mute">{t('projects.noPlatforms', '未连接平台')}</p>
          ) : (
            <ul className="space-y-1.5">
              {platforms.map((pl) => (
                <li
                  key={pl.type}
                  className="flex items-center justify-between rounded-control bg-surface-sunken px-3 py-2"
                >
                  <span className="inline-flex items-center gap-2 text-sm text-ink">
                    <Plug size={14} className="text-ink-mute" />
                    {pl.type}
                  </span>
                  <Badge variant={pl.connected ? 'success' : 'outline'}>
                    {pl.connected ? t('projects.connected', '已连接') : t('projects.disconnected', '未连接')}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </div>

        <footer data-ui="drawer-footer" className="border-t border-hairline p-4">
          <Link
            to={`/projects/${project.name}`}
            className={cn(
              'inline-flex h-11 w-full items-center justify-center gap-2 rounded-control',
              'bg-accent text-white dark:text-black yellow:text-gray-900 shadow-ui-gloss-1',
              'text-sm font-medium transition-colors duration-base ease-ui-out hover:bg-accent-dim',
              'focus-visible:outline-none focus-visible:shadow-ui-ring'
            )}
          >
            {t('projects.openDetail', '打开项目页')}
            <ArrowRight size={15} />
          </Link>
        </footer>
      </aside>
    </div>
  );
}
