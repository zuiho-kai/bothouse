import type { ElementType, ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface PageHeaderProps {
  title: string;
  description?: string;
  icon?: ElementType<{ size?: number; strokeWidth?: number; className?: string }>;
  actions?: ReactNode;
  className?: string;
}

// Every settings/monitoring page starts with the same header rhythm: icon disc, title,
// one-line description, actions parked on the right. Keeping it here is what makes the seven
// pages read as one product instead of seven screens (#98 U13).
export function PageHeader({ title, description, icon: Icon, actions, className }: PageHeaderProps) {
  return (
    <header className={cn('flex flex-wrap items-end justify-between gap-x-4 gap-y-3', className)}>
      <div className="min-w-0">
        {/* #579: 标题是页面的锚点：22px 紧字距，图标退成标题前的小记号，不再占一个灰盒子 */}
        {/* #579 v2: 与概览/角色/对话同一档大标题；图标退成标题前的小方块 */}
        <h1 className="flex items-center gap-3 text-[28px] font-semibold leading-tight tracking-tight text-ink">
          {Icon && <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[11px] bg-accent-wash text-accent-text"><Icon size={18} strokeWidth={1.9} /></span>}
          {title}
        </h1>
        {description && <p className="mt-1.5 max-w-2xl text-sm leading-6 text-ink-soft">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

interface SectionProps {
  title?: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}

// Section = a titled Card. Card already carries the elevation and radius ladder, so this only
// adds the label row — no second shadow stack, no second border.
export function Section({ title, description, actions, children, className }: SectionProps) {
  return (
    <section className={cn('rounded-card bg-surface p-5 shadow-ui-1', className)}>
      {(title || actions) && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <div>
            {title && <h2 className="text-sm font-semibold text-ink">{title}</h2>}
            {description && <p className="mt-0.5 text-xs text-ink-mute">{description}</p>}
          </div>
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

interface LoadingStateProps {
  label?: string;
  className?: string;
}

// Inline skeleton instead of a pulsing word: three bars at the card radius, 320ms state fade
// from the token ladder, and it respects prefers-reduced-motion through the global override.
export function LoadingState({ label, className }: LoadingStateProps) {
  return (
    <div className={cn('space-y-3', className)} aria-busy="true" aria-live="polite">
      {label && <p className="text-xs text-ink-mute">{label}</p>}
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="h-16 rounded-card bg-surface shadow-ui-1 animate-pulse"
          style={{ animationDelay: `${i * 90}ms` }}
        />
      ))}
    </div>
  );
}
