import { cn } from '@/lib/utils';
import type { ReactNode } from 'react';

interface CardProps {
  children: ReactNode;
  className?: string;
  hover?: boolean;
}

// Elevation ladder: L1 at rest (ring + near shadow), L2 on hover (12/40 far shadow). Cards never
// animate width/height — only transform + shadow + border colour (§3 "卡片状态切换").
export function Card({ children, className, hover }: CardProps) {
  return (
    <div
      className={cn(
        'relative rounded-card p-5 animate-float-in',
        'bg-surface shadow-ui-1',
        'transition-[box-shadow,transform,background-color] duration-state ease-ui-standard',
        hover &&
          'cursor-pointer hover:-translate-y-0.5 hover:shadow-ui-2 focus-visible:outline-none focus-visible:shadow-ui-2',
        className
      )}
    >
      {children}
    </div>
  );
}

interface StatCardProps {
  label: string;
  value: string | number;
  accent?: boolean;
}

export function StatCard({ label, value, accent }: StatCardProps) {
  return (
    <Card hover>
      <p className="text-xs font-medium text-ink-mute uppercase tracking-wide">{label}</p>
      <p className={cn('text-2xl font-bold mt-1 tabular-nums', accent ? 'text-accent' : 'text-ink')}>
        {value}
      </p>
    </Card>
  );
}
