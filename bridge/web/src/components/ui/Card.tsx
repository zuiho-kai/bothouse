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
        // #579 v2: 白卡浮在暖灰画布上，用 1px 环 + 极浅投影（shadow-ui-1）代替单纯描边
        'bg-surface shadow-ui-1',
        'transition-[box-shadow,transform,background-color] duration-state ease-ui-standard',
        hover &&
          'cursor-pointer hover:-translate-y-0.5 hover:shadow-ui-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-text',
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
    <Card>
      <p className="text-xs font-medium text-ink-mute">{label}</p>
      <p className={cn('mt-2.5 text-[28px] font-semibold leading-none tracking-tight tabular-nums', accent ? 'text-accent-text' : 'text-ink')}>
        {value}
      </p>
    </Card>
  );
}
