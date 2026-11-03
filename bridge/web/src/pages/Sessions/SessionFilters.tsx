import { useTranslation } from 'react-i18next';
import { LayoutGrid, Rows3, Search, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ProjectFacet, SessionFilters, SessionView } from './sessionListModel';

interface SessionFiltersBarProps {
  filters: SessionFilters;
  facets: ProjectFacet[];
  view: SessionView;
  onChange: (next: SessionFilters) => void;
  onViewChange: (view: SessionView) => void;
  shown: number;
  total: number;
}

function Chip({
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
        'inline-flex h-11 shrink-0 items-center gap-1.5 rounded-pill px-3 text-[13px] font-medium sm:h-8',
        'ring-1 transition-[background-color,color,box-shadow] duration-base ease-ui-out',
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

/** 项目筛选走横滚 chips：手机上比下拉框少一次点击，也看得见每个项目有几条会话。 */
export function SessionFiltersBar({
  filters,
  facets,
  view,
  onChange,
  onViewChange,
  shown,
  total,
}: SessionFiltersBarProps) {
  const { t } = useTranslation();

  const toggleProject = (key: string) => {
    const projects = filters.projects.includes(key)
      ? filters.projects.filter((p) => p !== key)
      : [...filters.projects, key];
    onChange({ ...filters, projects });
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
            placeholder={t('sessions.searchPlaceholder', '搜索会话、成员或内容')}
            aria-label={t('sessions.searchPlaceholder', '搜索会话、成员或内容')}
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
          aria-label={t('sessions.view', '视图')}
        >
          <button
            type="button"
            aria-pressed={view === 'card'}
            onClick={() => onViewChange('card')}
            aria-label={t('sessions.viewCards', '卡片视图')}
            className={cn(
              'grid h-11 w-11 place-items-center rounded-[6px] transition-colors duration-base ease-ui-out sm:h-8 sm:w-8',
              view === 'card' ? 'bg-surface text-ink shadow-ui-1' : 'text-ink-mute hover:text-ink'
            )}
          >
            <LayoutGrid size={15} />
          </button>
          <button
            type="button"
            aria-pressed={view === 'row'}
            onClick={() => onViewChange('row')}
            aria-label={t('sessions.viewRows', '紧凑视图')}
            className={cn(
              'grid h-11 w-11 place-items-center rounded-[6px] transition-colors duration-base ease-ui-out sm:h-8 sm:w-8',
              view === 'row' ? 'bg-surface text-ink shadow-ui-1' : 'text-ink-mute hover:text-ink'
            )}
          >
            <Rows3 size={15} />
          </button>
        </div>
      </div>

      <div className="-mx-1 flex items-center gap-1.5 overflow-x-auto px-1 pb-0.5">
        <span className="shrink-0 text-[13px] tabular-nums text-ink-mute">
          {shown === total ? total : `${shown} / ${total}`}
        </span>
        <Chip active={filters.onlyLive} onClick={() => onChange({ ...filters, onlyLive: !filters.onlyLive })}>
          <span
            aria-hidden
            className={cn('h-1.5 w-1.5 rounded-full', filters.onlyLive ? 'bg-emerald-500' : 'bg-ink-mute')}
          />
          {t('sessions.liveOnly', '在线')}
        </Chip>
        <Chip
          active={filters.onlyWithMessages}
          onClick={() => onChange({ ...filters, onlyWithMessages: !filters.onlyWithMessages })}
        >
          {t('sessions.withMessages', '有消息')}
        </Chip>
        {facets.length > 0 && <span data-ui="facet-divider" className="mx-0.5 h-5 w-px shrink-0 bg-hairline" aria-hidden />}
        {facets.map((f) => (
          <Chip key={f.key} active={filters.projects.includes(f.key)} onClick={() => toggleProject(f.key)}>
            {f.label}
            <span className="tabular-nums text-ink-mute">{f.count}</span>
          </Chip>
        ))}
      </div>
    </div>
  );
}