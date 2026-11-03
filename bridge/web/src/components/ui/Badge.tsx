import { cn } from '@/lib/utils';

interface BadgeProps {
  children: React.ReactNode;
  variant?: 'default' | 'success' | 'warning' | 'danger' | 'info' | 'outline';
  className?: string;
}

// Status colours stay semantic (success / warning / danger); everything else rides the ink ramp,
// so a badge never introduces a colour outside the palette (§0 "one accent at a time").
const variants = {
  default: 'bg-surface-sunken text-ink-soft ring-1 ring-hairline',
  success: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 ring-1 ring-emerald-500/25',
  warning: 'bg-amber-500/10 text-amber-700 dark:text-amber-400 ring-1 ring-amber-500/25',
  danger: 'bg-red-500/10 text-red-700 dark:text-red-400 ring-1 ring-red-500/25',
  info: 'bg-accent-wash text-accent ring-1 ring-accent/25',
  outline: 'bg-transparent text-ink-mute ring-1 ring-hairline-strong',
};

export function Badge({ children, variant = 'default', className }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 px-2 py-0.5 rounded-pill text-xs font-medium',
        'transition-colors duration-base ease-ui-out',
        variants[variant],
        className,
      )}
    >
      {children}
    </span>
  );
}
