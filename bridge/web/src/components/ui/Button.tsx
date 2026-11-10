import { cn } from '@/lib/utils';
import type { ButtonHTMLAttributes, ReactNode } from 'react';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  children: ReactNode;
  loading?: boolean;
}

// One transition for every variant: colour + elevation + a 1px press. Durations and curves come
// from the token ladder (--ui-dur-base 240ms / --ui-dur-press 120ms, --ui-ease-out) instead of
// ad-hoc values, so all buttons move at the same rhythm.
const base =
  'relative inline-flex items-center justify-center gap-2 overflow-hidden font-medium select-none ' +
  'transition-[background-color,box-shadow,transform,color,border-color] duration-base ease-ui-out ' +
  'active:translate-y-px active:duration-press ' +
  'focus-visible:outline-none focus-visible:shadow-ui-ring ' +
  'disabled:opacity-50 disabled:pointer-events-none';

const variants = {
  // Filled accent with a top-edge gloss instead of a coloured glow (glow reads cheap, §4).
  primary:
    'bg-accent text-white dark:text-black yellow:text-gray-900 shadow-ui-gloss-1 ' +
    'hover:bg-accent-dim hover:shadow-ui-gloss-2',
  // #579: 次按钮 = 白底 + 1px 描边 + 顶光（与 DSH「新会话」按钮同一手法），不再是灰块
  secondary:
    'bg-surface text-ink border border-hairline shadow-ui-gloss-1 hover:border-hairline-strong hover:bg-surface-sunken',
  danger: 'bg-surface text-red-600 dark:text-red-400 border border-red-500/30 hover:bg-red-500/10',
  ghost:
    'text-ink-soft hover:bg-surface-sunken hover:text-ink focus-visible:bg-surface-sunken',
};

// Control radius is 8px for sm/md; lg steps to the card radius (14) so a big CTA reads as a card.
const sizes = {
  sm: 'h-8 px-3 text-xs rounded-control',
  md: 'h-9 px-3.5 text-sm rounded-control',
  lg: 'h-11 px-5 text-sm rounded-control',
};

export function Button({
  variant = 'primary',
  size = 'md',
  className,
  children,
  loading,
  disabled,
  ...props
}: ButtonProps) {
  return (
    <button
      className={cn(base, variants[variant], sizes[size], className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading && (
        <svg className="animate-spin h-4 w-4 shrink-0" viewBox="0 0 24 24" aria-hidden>
          <circle
            className="opacity-25"
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            strokeWidth="4"
            fill="none"
          />
          <path
            className="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
          />
        </svg>
      )}
      {children}
    </button>
  );
}
