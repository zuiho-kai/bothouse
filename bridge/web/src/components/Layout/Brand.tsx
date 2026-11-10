import { cn } from '@/lib/utils';

/** The bothouse mark: a rounded tile in the accent with a small "house" notch, legible at 16px. */
export function BrandMark({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        'relative grid h-7 w-7 shrink-0 place-items-center rounded-[9px] bg-accent text-white shadow-ui-gloss-1 dark:text-black yellow:text-gray-900',
        className,
      )}
    >
      <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M2.5 7.2 8 2.8l5.5 4.4V13a.7.7 0 0 1-.7.7H3.2a.7.7 0 0 1-.7-.7Z" />
        <circle cx="6" cy="9.4" r=".6" fill="currentColor" />
        <circle cx="10" cy="9.4" r=".6" fill="currentColor" />
      </svg>
    </span>
  );
}

export function isFramed(): boolean {
  try {
    return window.self !== window.top;
  } catch {
    return true; // a cross-origin parent throws on access: that is still a frame
  }
}
