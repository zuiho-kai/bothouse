import { InboxIcon } from 'lucide-react';
import type { ElementType } from 'react';
import { cn } from '@/lib/utils';

interface EmptyStateProps {
  message: string;
  icon?: ElementType<{ size?: number; strokeWidth?: number; className?: string }>;
  /** Optional second line — what the user can do next. */
  hint?: string;
  className?: string;
}

// Empty is a state, not an error: the icon sits inside a hairline disc with one 3%-opacity accent
// wash behind it (§2 "1px ring instead of shadow", §9 ambient drift at 3000ms only).
export function EmptyState({ message, icon: Icon = InboxIcon, hint, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center py-16 text-center animate-[ui-rise_320ms_var(--ui-ease-out)]',
        className
      )}
    >
      <div className="relative mb-4 grid h-16 w-16 place-items-center">
        <span
          aria-hidden
          className="absolute inset-0 rounded-pill bg-accent-wash animate-[ui-drift_3200ms_ease-in-out_infinite]"
        />
        <span className="relative grid h-12 w-12 place-items-center rounded-pill bg-surface ring-1 ring-hairline">
          <Icon size={22} strokeWidth={1.25} className="text-ink-mute" />
        </span>
      </div>
      <p className="text-sm font-medium text-ink-soft">{message}</p>
      {hint && <p className="mt-1 text-xs text-ink-mute max-w-xs">{hint}</p>}
    </div>
  );
}
