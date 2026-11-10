import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Bot, Check, ChevronRight, MessageSquareText, User } from 'lucide-react';
import { Badge } from '@/components/ui';
import { cn } from '@/lib/utils';
import { relativeTime, type FlatSession } from './sessionListModel';
import { LibraryAvatar } from '@/components/library/LibraryAvatar';

interface SessionItemProps {
  session: FlatSession;
  projectLabel: string;
  selected: boolean;
  onToggleSelect: (key: string) => void;
  onPreview: (session: FlatSession) => void;
}

/** 稳定键：同一项目里 id 唯一，跨项目就不再唯一，所以筛选用「项目 + id」。 */
export const sessionKey = (s: FlatSession) => `${s._project}::${s.id}`;

function LiveDot({ live }: { live: boolean }) {
  return (
    <span className="relative inline-flex h-2 w-2 shrink-0" aria-hidden>
      <span className={cn('relative h-2 w-2 rounded-full', live ? 'bg-emerald-500' : 'bg-ink-mute/50')} />
    </span>
  );
}

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
          'grid h-6 w-6 place-items-center rounded-[7px] transition-[background-color,opacity,box-shadow] duration-state ease-ui-standard',
          selected
            ? 'bg-accent-text text-white opacity-100 ring-1 ring-accent-text'
            : 'bg-surface text-ink-mute ring-1 ring-hairline opacity-0 group-hover/session:opacity-100 group-focus-within/session:opacity-100'
        )}
      >
        <Check size={14} strokeWidth={3} />
      </span>
    </button>
  );
}

function Preview({ session }: { session: FlatSession }) {
  const { t } = useTranslation();
  const last = session.last_message;
  if (!last) return <span className="text-[13px] text-ink-mute">{t('sessions.noMessages')}</span>;
  const fromUser = last.role === 'user';
  return (
    <span className="flex items-center gap-1.5 text-[13px] text-ink-soft">
      {fromUser ? (
        <User size={12} strokeWidth={1.75} className="shrink-0 text-ink-mute" />
      ) : (
        <Bot size={12} strokeWidth={1.75} className="shrink-0 text-accent-text" />
      )}
      <span className="truncate">{last.content}</span>
    </span>
  );
}

/** 卡片：留白够大，看得到最后一句在聊什么；点开抽屉而不是直接跳走。 */
export function SessionCard({ session, projectLabel, selected, onToggleSelect, onPreview }: SessionItemProps) {
  const { t } = useTranslation();
  const updated = relativeTime(session.updated_at || session.created_at, t('sessions.justNow'));

  return (
    <article
      data-ui="session-card"
      data-entrance=""
      data-selected={selected || undefined}
      className={cn(
        'group/session relative flex h-full flex-col rounded-card bg-surface p-4 shadow-ui-1',
        'transition-[box-shadow,transform] duration-state ease-ui-standard',
        'hover:-translate-y-0.5 hover:shadow-ui-2 motion-reduce:hover:translate-y-0',
        selected && 'ring-2 ring-accent-text'
      )}
    >
      <div className="mb-2 flex items-center gap-2">
        {/* 角色头像占住选择框的位置；悬停或已选时换成选择框 */}
        <span className="relative -ml-2 grid h-11 w-11 shrink-0 place-items-center">
          <span className={cn('transition-opacity duration-base', selected ? 'opacity-0' : 'group-hover/session:opacity-0 group-focus-within/session:opacity-0')} aria-hidden>
            <LibraryAvatar name={projectLabel} size={28} />
          </span>
          <SelectBox
            selected={selected}
            label={`${t('sessions.select', '选择')} ${session.name}`}
            onToggle={() => onToggleSelect(sessionKey(session))}
            className="absolute inset-0"
          />
        </span>
        <LiveDot live={session.live} />
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink-soft">
          {projectLabel}
        </span>
        <span className="shrink-0 text-[13px] tabular-nums text-ink-mute">{updated}</span>
      </div>

      <button
        type="button"
        onClick={() => onPreview(session)}
        aria-label={`${t('sessions.preview', '预览')} ${session.name}`}
        className="flex flex-1 flex-col text-left focus-visible:rounded-card focus-visible:outline-none focus-visible:shadow-ui-ring"
      >
        <h3 className="truncate text-[15px] font-semibold tracking-tight text-ink">{session.name}</h3>
        <div className="mt-1.5 min-h-[18px]">
          <Preview session={session} />
        </div>
        <div className="mt-auto flex items-center gap-2 pt-3">
          {session.platform && (
            <Badge variant="outline" className="font-normal">
              {session.platform}
            </Badge>
          )}
          <span className="inline-flex items-center gap-1 text-[13px] tabular-nums text-ink-mute">
            <MessageSquareText size={12} strokeWidth={1.75} />
            {session.history_count ?? 0}
          </span>
          {session.active && (
            <Badge variant="info" className="ml-auto">
              {t('sessions.active')}
            </Badge>
          )}
        </div>
      </button>

      <Link
        to={`/sessions/${session._project}/${session.id}`}
        aria-label={t('sessions.enterSession')}
        className="absolute bottom-2 right-2 grid h-11 w-11 place-items-center rounded-control text-ink-mute opacity-0 transition-[opacity,color,background-color] duration-base ease-ui-out hover:bg-surface-sunken hover:text-ink focus-visible:opacity-100 focus-visible:outline-none focus-visible:shadow-ui-ring group-hover/session:opacity-100 sm:h-8 sm:w-8"
      >
        <ChevronRight size={16} />
      </Link>
    </article>
  );
}

/** 紧凑行：一屏二十条，靠列对齐读，不靠留白。 */
export function SessionRow({ session, projectLabel, selected, onToggleSelect, onPreview }: SessionItemProps) {
  const { t } = useTranslation();
  const updated = relativeTime(session.updated_at || session.created_at, t('sessions.justNow'));

  return (
    <div
      data-ui="session-row"
      data-entrance=""
      data-selected={selected || undefined}
      className={cn(
        'group/session relative flex items-center gap-3 rounded-card border border-hairline bg-surface px-3 py-2.5',
        'transition-[border-color,background-color] duration-base ease-ui-out hover:border-hairline-strong',
        selected && 'ring-2 ring-accent-text'
      )}
    >
      <SelectBox
        selected={selected}
        label={`${t('sessions.select', '选择')} ${session.name}`}
        onToggle={() => onToggleSelect(sessionKey(session))}
      />
      <LiveDot live={session.live} />
      <button
        type="button"
        onClick={() => onPreview(session)}
        className="flex min-h-11 min-w-0 flex-1 items-center gap-3 text-left focus-visible:outline-none"
        aria-label={`${t('sessions.preview', '预览')} ${session.name}`}
      >
        <span className="min-w-0 flex-[1.2]">
          <span className="block truncate text-sm font-medium text-ink">{session.name}</span>
          <span className="block truncate text-[13px] text-ink-mute">{projectLabel}</span>
        </span>
        <span className="hidden min-w-0 flex-[2] sm:block">
          <Preview session={session} />
        </span>
        <span className="hidden w-16 shrink-0 truncate text-[13px] text-ink-mute md:block">
          {session.platform}
        </span>
        <span className="w-9 shrink-0 text-right text-[13px] tabular-nums text-ink-mute">{updated}</span>
        <span className="hidden w-8 shrink-0 text-right text-[13px] tabular-nums text-ink-mute sm:block">
          {session.history_count ?? 0}
        </span>
      </button>
      <Link
        to={`/sessions/${session._project}/${session.id}`}
        aria-label={t('sessions.enterSession')}
        className="grid h-11 w-11 shrink-0 place-items-center rounded-control text-ink-mute transition-colors duration-base ease-ui-out hover:bg-surface-sunken hover:text-ink focus-visible:outline-none focus-visible:shadow-ui-ring sm:h-8 sm:w-8"
      >
        <ChevronRight size={16} />
      </Link>
    </div>
  );
}
