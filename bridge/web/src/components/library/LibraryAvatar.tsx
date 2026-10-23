import { useState } from 'react';
import { cn } from '@/lib/utils';

const PALETTE = ['#5865f2', '#eb459e', '#3ba55c', '#faa61a', '#ed4245', '#00a8fc', '#9b59b6', '#e67e22']; // same badge colors as the DSH channel page
const colorOf = (key: string) => { let h = 7; for (const c of key) h = (h * 31 + c.charCodeAt(0)) >>> 0; return PALETTE[h % PALETTE.length]; };

/** Round portrait; without a picture (or when it fails to load) a colored circle with the first letter. */
export function LibraryAvatar({ url, name, size = 48, className }: { url?: string; name: string; size?: number; className?: string }) {
  const [broken, setBroken] = useState('');
  const show = !!url && broken !== url;
  return (
    <span className={cn('relative inline-grid place-items-center shrink-0 rounded-full overflow-hidden text-white font-bold select-none', className)}
      style={{ width: size, height: size, fontSize: size * 0.42, background: colorOf(name || '?') }} aria-hidden data-testid="lib-avatar">
      {(name || '?').slice(0, 1)}
      {show && <img src={url} alt="" className="absolute inset-0 w-full h-full object-cover" onError={() => setBroken(url!)} />}
    </span>
  );
}
