import type { CSSProperties } from 'react';
import { cn } from '@/lib/utils';
import { avatarHue, avatarInitials } from './avatarName';
import { mosaicLayout } from './mosaic';

interface Props {
  names: string[];
  size?: number;
  className?: string;
}

/** Group avatar: up to four members in one disc, each own hue. */
export default function AvatarMosaic({ names, size = 44, className }: Props) {
  const members = names.slice(0, 4);
  const cells = mosaicLayout(members.length);
  const gap = members.length > 1 ? 1.5 : 0;
  // Cell type scales with the disc so a 4-up cell still reads (>= 8px).
  const fontSize = Math.max(8, Math.round(size / (members.length > 2 ? 4.6 : 3.4)));

  return (
    <span
      className={cn(
        'inline-grid shrink-0 overflow-hidden rounded-full bg-[var(--ch-sub)] ring-1 ring-[var(--ch-line)]',
        className,
      )}
      style={{ width: size, height: size, gridTemplateColumns: '1fr 1fr', gridTemplateRows: '1fr 1fr', gap }}
      aria-hidden
    >
      {members.map((name, i) => (
        <span
          key={`${name}-${i}`}
          className="ch-avatar flex items-center justify-center font-semibold leading-none"
          style={
            {
              gridColumn: cells[i].col,
              gridRow: cells[i].row,
              '--av-h': avatarHue(name),
              fontSize,
            } as CSSProperties
          }
        >
          {avatarInitials(name)}
        </span>
      ))}
    </span>
  );
}
