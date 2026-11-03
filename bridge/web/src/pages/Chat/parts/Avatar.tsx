import type { CSSProperties } from 'react';
import { cn } from '@/lib/utils';
import { avatarHue, avatarInitials } from './avatarName';

const SIZES = {
  28: 'h-7 w-7 text-[11px]',
  40: 'h-10 w-10 text-[13px]',
  44: 'h-11 w-11 text-[14px]',
  56: 'h-14 w-14 text-[17px]',
} as const;

export type AvatarSize = keyof typeof SIZES;

interface Props {
  name: string;
  size?: AvatarSize;
  /** Presence ring in the bottom-right corner. */
  live?: boolean;
  className?: string;
}

/** One person. Light tinted disc with dark glyph: every pair stays well above 4.5:1. */
export default function Avatar({ name, size = 40, live, className }: Props) {
  return (
    <span
      className={cn(
        'ch-avatar relative inline-flex shrink-0 select-none items-center justify-center rounded-full font-semibold',
        SIZES[size],
        className,
      )}
      style={{ '--av-h': avatarHue(name) } as CSSProperties}
    >
      {avatarInitials(name)}
      {live && (
        <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-emerald-500 ring-2 ring-[var(--ch-panel)]" />
      )}
    </span>
  );
}
