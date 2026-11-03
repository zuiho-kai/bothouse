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

// 空态是一个状态，不是插画面：只有一枚 1px 描边的圆托图标、一句说明和一个下一步。
// 不做循环装饰动效（房规：动效只作反馈），底色靠画布本身（§2「1px 描边代替阴影」）。
export function EmptyState({ message, icon: Icon = InboxIcon, hint, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center py-16 text-center animate-[ui-rise_320ms_var(--ui-ease-out)]',
        className
      )}
    >
      {/* 空态是一句话，不是一个插画面：只留 1px 描边的圆托图标，不做循环装饰动效 */}
      <div className="mb-4 grid h-16 w-16 place-items-center">
        <span className="grid h-12 w-12 place-items-center rounded-pill border border-hairline bg-surface">
          <Icon size={22} strokeWidth={1.25} className="text-ink-mute" />
        </span>
      </div>
      <p className="text-sm font-medium text-ink">{message}</p>
      {hint && <p className="mt-1 max-w-xs text-[13px] text-ink-soft">{hint}</p>}
    </div>
  );
}
