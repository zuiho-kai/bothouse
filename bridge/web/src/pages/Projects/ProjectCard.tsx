import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Check, ChevronRight, HeartPulse, MessageSquareText } from 'lucide-react';
import { Badge } from '@/components/ui';
import { cn } from '@/lib/utils';
import { shownName, type ProjectSummary } from '@/api/projects';
import { monogram } from './projectListModel';

interface ProjectItemProps {
  project: ProjectSummary;
  selected: boolean;
  onToggleSelect: (name: string) => void;
  onPreview: (project: ProjectSummary) => void;
}

/** 名字首字母牌。同一块底、同一色，不按 agent 换色——彩虹牌是列表里最廉价的东西。 */
function Monogram({ name, size = 'md' }: { name: string; size?: 'md' | 'sm' }) {
  return (
    <span
      aria-hidden
      className={cn(
        'grid shrink-0 place-items-center rounded-control font-semibold ring-1 ring-hairline',
        'bg-accent-wash text-accent-text',
        size === 'md' ? 'h-10 w-10 text-sm' : 'h-8 w-8 text-xs'
      )}
    >
      {monogram(name)}
    </span>
  );
}

/** 选择方块：静止时藏起来，hover / 键盘聚焦 / 已选中时出现。
 *  外层撑到 44px 命中区（README 手机点按线），内层才是 24px 的视觉方块。 */
function SelectBox({
  selected,
  label,
  onToggle,
  className,
}: {
  selected: boolean;
  label: string;
  onToggle: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={selected}
      aria-label={label}
      onClick={(e) => {
        e.stopPropagation();
        e.preventDefault();
        onToggle();
      }}
      className={cn(
        'grid h-11 w-11 shrink-0 place-items-center rounded-control',
        'focus-visible:outline-none focus-visible:shadow-ui-ring',
        className
      )}
    >
      <span
        className={cn(
          'grid h-6 w-6 place-items-center rounded-[7px] transition-all duration-state ease-ui-standard',
          selected
            ? 'bg-accent-text text-white opacity-100 ring-1 ring-accent-text'
            : 'bg-surface text-transparent ring-1 ring-hairline opacity-0 group-hover/card:opacity-100 group-focus-within/card:opacity-100'
        )}
      >
        <Check size={14} strokeWidth={3} />
      </span>
    </button>
  );
}

function PlatformTags({ platforms, max = 3 }: { platforms: string[]; max?: number }) {
  const shown = platforms.slice(0, max);
  const rest = platforms.length - shown.length;
  return (
    <div className="flex flex-wrap items-center gap-1">
      {shown.map((pl) => (
        <Badge key={pl} variant="outline" className="font-normal">
          {pl}
        </Badge>
      ))}
      {rest > 0 && (
        <Badge variant="outline" className="font-normal tabular-nums">
          +{rest}
        </Badge>
      )}
    </div>
  );
}

/** 卡片：整块点开预览抽屉，右上角箭头直达项目页；选择方块盖在左上。 */
export function ProjectCard({ project, selected, onToggleSelect, onPreview }: ProjectItemProps) {
  const { t } = useTranslation();
  const name = shownName(project);
  const platforms = project.platforms ?? [];

  return (
    <article
      data-selected={selected || undefined}
      className={cn(
        'group/card relative flex h-full flex-col rounded-card bg-surface p-4 shadow-ui-gloss-1',
        'transition-[box-shadow,transform] duration-state ease-ui-standard',
        'hover:-translate-y-0.5 hover:shadow-ui-gloss-2',
        selected && 'shadow-[0_0_0_2px_rgb(var(--color-accent-text)/0.45),var(--ui-shadow-2)]'
      )}
    >
      <SelectBox
        selected={selected}
        label={`${t('projects.select', '选择')} ${name}`}
        onToggle={() => onToggleSelect(project.name)}
        className="absolute left-0.5 top-0.5 z-10"
      />
      <button
        type="button"
        onClick={() => onPreview(project)}
        className="flex flex-1 flex-col text-left focus-visible:outline-none focus-visible:shadow-ui-ring focus-visible:rounded-card"
        aria-label={`${t('projects.preview', '预览')} ${name}`}
      >
        <div className="flex items-start gap-3">
          <Monogram name={name} />
          <div className="min-w-0 flex-1 pt-0.5">
            <h3 className="truncate text-[15px] font-semibold tracking-tight text-ink">{name}</h3>
            <p className="mt-0.5 truncate text-xs text-ink-mute">{project.agent_type}</p>
          </div>
        </div>

        <div className="mt-3 min-h-[22px]">
          {platforms.length > 0 ? (
            <PlatformTags platforms={platforms} />
          ) : (
            <span className="text-xs text-ink-mute">{t('projects.noPlatforms', '未连接平台')}</span>
          )}
        </div>

        <div className="mt-auto flex items-center gap-3 pt-3 text-xs text-ink-soft">
          <span className="inline-flex items-center gap-1 tabular-nums">
            <MessageSquareText size={13} strokeWidth={1.75} className="text-ink-mute" />
            {project.sessions_count ?? 0}
          </span>
          {project.heartbeat_enabled && (
            <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
              <HeartPulse size={13} strokeWidth={1.75} />
              {t('projects.heartbeat', '心跳')}
            </span>
          )}
        </div>
      </button>

      <Link
        to={`/projects/${project.name}`}
        aria-label={`${t('projects.detail', '详情')} ${name}`}
        className={cn(
          'absolute right-0.5 top-0.5 grid h-11 w-11 place-items-center rounded-control text-ink-mute sm:right-2.5 sm:top-2.5 sm:h-8 sm:w-8',
          'transition-colors duration-base ease-ui-out hover:bg-surface-sunken hover:text-ink',
          'focus-visible:outline-none focus-visible:shadow-ui-ring'
        )}
      >
        <ChevronRight size={16} />
      </Link>
    </article>
  );
}

/** 紧凑行：一屏能扫十几个项目，用在「列表」视图；同样的信息密度靠对齐而不是缩小字号。 */
export function ProjectRow({ project, selected, onToggleSelect, onPreview }: ProjectItemProps) {
  const { t } = useTranslation();
  const name = shownName(project);
  const platforms = project.platforms ?? [];

  return (
    <div
      data-selected={selected || undefined}
      className={cn(
        'group/card relative flex items-center gap-3 rounded-card bg-surface px-3 py-2.5 shadow-ui-gloss-1',
        'transition-[box-shadow,background-color] duration-base ease-ui-out hover:shadow-ui-gloss-2',
        selected && 'shadow-[0_0_0_2px_rgb(var(--color-accent-text)/0.45),var(--ui-shadow-2)]'
      )}
    >
      <SelectBox
        selected={selected}
        label={`${t('projects.select', '选择')} ${name}`}
        onToggle={() => onToggleSelect(project.name)}
      />
      <button
        type="button"
        onClick={() => onPreview(project)}
        className="flex min-h-11 min-w-0 flex-1 items-center gap-3 text-left focus-visible:outline-none"
        aria-label={`${t('projects.preview', '预览')} ${name}`}
      >
        <Monogram name={name} size="sm" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-ink">{name}</span>
          <span className="block truncate text-[11px] text-ink-mute">{project.agent_type}</span>
        </span>
        <span className="hidden shrink-0 items-center gap-1 sm:flex">
          <PlatformTags platforms={platforms} max={2} />
        </span>
        <span className="w-14 shrink-0 text-right text-xs tabular-nums text-ink-soft">
          {project.sessions_count ?? 0}
        </span>
        {project.heartbeat_enabled ? (
          <HeartPulse size={14} className="shrink-0 text-emerald-600 dark:text-emerald-400" />
        ) : (
          <span className="w-[14px] shrink-0" aria-hidden />
        )}
      </button>
      <Link
        to={`/projects/${project.name}`}
        aria-label={`${t('projects.detail', '详情')} ${name}`}
        className="grid h-11 w-11 shrink-0 place-items-center rounded-control text-ink-mute transition-colors duration-base ease-ui-out hover:bg-surface-sunken hover:text-ink focus-visible:outline-none focus-visible:shadow-ui-ring sm:h-8 sm:w-8"
      >
        <ChevronRight size={16} />
      </Link>
    </div>
  );
}
