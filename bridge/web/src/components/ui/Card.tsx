import { cn } from '@/lib/utils';
import type { ReactNode } from 'react';

interface CardProps {
  children: ReactNode;
  className?: string;
  hover?: boolean;
}

// 静置卡片只有 1px 边框：应用界面房规「边框或阴影，不可同时」，阴影留给真正浮起来的东西。
// hover 只改 transform 与边框色，不改宽高（§3「卡片状态切换」不重排）。
export function Card({ children, className, hover }: CardProps) {
  return (
    <div
      className={cn(
        'relative rounded-card p-5',
        // 房规：静置卡片「边框或阴影，不可同时」；浮层才用阴影
        'border border-hairline bg-surface',
        'transition-[box-shadow,transform,background-color] duration-state ease-ui-standard',
        hover &&
          'cursor-pointer hover:-translate-y-0.5 hover:border-hairline-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-text',
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
      <p className="text-[13px] font-medium text-ink-soft">{label}</p>
      <p className={cn('text-2xl font-bold mt-1 tabular-nums', accent ? 'text-accent' : 'text-ink')}>
        {value}
      </p>
    </Card>
  );
}
