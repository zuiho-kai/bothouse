import { cn } from '@/lib/utils';
import { LibraryAvatar } from '@/components/library/LibraryAvatar';

export type RoleState = 'busy' | 'idle' | 'offline' | 'paused';

export function roleState(r: { paused?: boolean; online?: boolean; busy?: boolean }): RoleState {
  if (r.paused) return 'paused';
  if (!r.online) return 'offline';
  return r.busy ? 'busy' : 'idle';
}

export const ROLE_STATE_LABEL: Record<RoleState, string> = { busy: '在忙', idle: '空闲', offline: '不在线', paused: '已暂停' };

// #579 v2: four states, four looks. Busy is the one thing to look at, so it gets the accent and a
// live ping; idle is a calm green; offline is a hollow ring; paused is amber (a choice, not a fault).
const DOT: Record<RoleState, string> = {
  busy: 'bg-accent ui-live-dot',
  idle: 'bg-emerald-500',
  offline: 'border-[1.5px] border-ink-mute bg-transparent',
  paused: 'bg-amber-500',
};
const PILL: Record<RoleState, string> = {
  busy: 'bg-accent-wash text-accent-text',
  idle: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
  offline: 'bg-surface-sunken text-ink-mute',
  paused: 'bg-amber-500/10 text-amber-700 dark:text-amber-400',
};

export function StateDot({ state, className }: { state: RoleState; className?: string }) {
  return <span aria-hidden className={cn('inline-block h-2 w-2 shrink-0 rounded-full', DOT[state], className)} />;
}

export function StatePill({ state, className }: { state: RoleState; className?: string }) {
  return (
    <span className={cn('inline-flex shrink-0 items-center gap-1.5 rounded-pill px-2.5 py-1 text-xs font-medium leading-none', PILL[state], className)}>
      <StateDot state={state} className="h-1.5 w-1.5" />
      {ROLE_STATE_LABEL[state]}
    </span>
  );
}

/** Avatar with the state dot on its corner (the same letter disc the library uses). */
export function RoleAvatar({ name, state, size = 40 }: { name: string; state: RoleState; size?: number }) {
  return (
    <span className="relative inline-grid shrink-0">
      <LibraryAvatar name={name} size={size} className={cn(state === 'offline' && 'opacity-50 grayscale')} />
      <span className="absolute -bottom-0.5 -right-0.5 grid place-items-center rounded-full bg-surface p-[2px]">
        <StateDot state={state} className="h-2.5 w-2.5" />
      </span>
    </span>
  );
}
