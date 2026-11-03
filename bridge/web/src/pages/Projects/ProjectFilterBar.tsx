import { useTranslation } from 'react-i18next';
import { HeartPulse, LayoutGrid, List, Search, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { AgentFacet, ProjectFilters, ProjectView } from './projectListModel';

interface FilterBarProps {
  filters: ProjectFilters;
  facets: AgentFacet[];
  view: ProjectView;
  onChange: (next: ProjectFilters) => void;
  onViewChange: (view: ProjectView) => void;
  /** 已筛选出的条数，写在左侧，让「筛完剩几个」随时可见。 */
  shown: number;
  total: number;
}

function Toggle({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'inline-flex h-11 items-center gap-1.5 rounded-pill px-3 text-xs font-medium sm:h-8',
        'ring-1 transition-all duration-base ease-ui-out',
        'focus-visible:outline-none focus-visible:shadow-ui-ring',
        active
          ? 'bg-accent-wash text-accent-text ring-accent-text/40'
          : 'bg-surface text-ink-soft ring-hairline hover:ring-hairline-strong hover:text-ink'
      )}
    >
      {children}
    </button>
  );
}

/** 一条横栏装下全部筛选：搜索优先占宽，其余控件在窄屏换行而不挤压输入框。 */
export function ProjectFilterBar({
  filters,
  facets,
  view,
  onChange,
  onViewChange,
  shown,
  total,
}: FilterBarProps) {
  const { t } = useTranslation();

  const toggleAgent = (key: string) => {
    const agents = filters.agents.includes(key)
      ? filters.agents.filter((a) => a !== key)
      : [...filters.agents, key];
    onChange({ ...filters, agents });
  };

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] flex-1">
          <Search
            size={15}
            strokeWidth={1.75}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-mute"
          />
          <input
            type="search"
            value={filters.query}
            onChange={(e) => onChange({ ...filters, query: e.target.value })}
            placeholder={t('projects.searchPlaceholder', '搜索项目、agent 或平台')}
            aria-label={t('projects.searchPlaceholder', '搜索项目、agent 或平台')}
            className={cn(
              'h-11 w-full rounded-control bg-surface pl-9 pr-10 text-sm text-ink sm:h-10',
              'ring-1 ring-hairline placeholder:text-ink-mute',
              'transition-[box-shadow] duration-base ease-ui-out',
              'hover:ring-hairline-strong focus:outline-none focus:ring-2 focus:ring-accent-text'
            )}
          />
          {filters.query && (
            <button
              type="button"
              onClick={() => onChange({ ...filters, query: '' })}
              aria-label={t('common.clearSearch', '清除')}
              className="absolute right-0 top-1/2 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-control text-ink-mute hover:bg-surface-sunken hover:text-ink sm:right-1.5 sm:h-7 sm:w-7"
            >
              <X size={14} />
            </button>
          )}
        </div>

        <div
          className="flex items-center gap-0.5 rounded-control bg-surface-sunken p-0.5 ring-1 ring-hairline"
          role="group"
          aria-label={t('projects.view', '视图')}
        >
          <button
            type="button"
            aria-pressed={view === 'grid'}
            onClick={() => onViewChange('grid')}
            aria-label={t('projects.viewGrid', '卡片视图')}
            className={cn(
              'grid h-11 w-11 place-items-center rounded-[6px] transition-colors duration-base ease-ui-out sm:h-8 sm:w-8',
              view === 'grid' ? 'bg-surface text-ink shadow-ui-1' : 'text-ink-mute hover:text-ink'
            )}
          >
            <LayoutGrid size={15} />
          </button>
          <button
            type="button"
            aria-pressed={view === 'list'}
            onClick={() => onViewChange('list')}
            aria-label={t('projects.viewList', '列表视图')}
            className={cn(
              'grid h-11 w-11 place-items-center rounded-[6px] transition-colors duration-base ease-ui-out sm:h-8 sm:w-8',
              view === 'list' ? 'bg-surface text-ink shadow-ui-1' : 'text-ink-mute hover:text-ink'
            )}
          >
            <List size={15} />
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-xs tabular-nums text-ink-mute">
          {shown === total ? total : `${shown} / ${total}`}
        </span>
        {facets.map((f) => (
          <Toggle key={f.key} active={filters.agents.includes(f.key)} onClick={() => toggleAgent(f.key)}>
            {f.key}
            <span className="tabular-nums text-ink-mute">{f.count}</span>
          </Toggle>
        ))}
        {facets.length > 0 && <span className="mx-1 h-5 w-px bg-hairline" aria-hidden />}
        <Toggle
          active={filters.onlyHeartbeat}
          onClick={() => onChange({ ...filters, onlyHeartbeat: !filters.onlyHeartbeat })}
        >
          <HeartPulse size={13} strokeWidth={1.75} />
          {t('projects.heartbeatOn', '有心跳')}
        </Toggle>
        <Toggle
          active={filters.onlyWithSessions}
          onClick={() => onChange({ ...filters, onlyWithSessions: !filters.onlyWithSessions })}
        >
          {t('projects.withSessions', '有会话')}
        </Toggle>
      </div>
    </div>
  );
}
