import { cn } from '@/lib/utils';
import type { InputHTMLAttributes, TextareaHTMLAttributes } from 'react';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
}

// Hairline ring at rest, a 2px ring + 2px offset on focus. The ring colour is accent-text (the
// darker accent) because the fill accent is only 2.2:1 on white in the yellow theme.
const field =
  'w-full px-3 py-2 text-sm rounded-control text-ink bg-surface ' +
  'border border-hairline hover:border-hairline-strong ' +
  'transition-[border-color,box-shadow,background-color] duration-base ease-ui-out ' +
  'placeholder:text-ink-mute ' +
  'focus:outline-none focus:ring-2 focus:ring-accent-text focus:ring-offset-2 focus:ring-offset-canvas ' +
  'disabled:opacity-60 disabled:cursor-not-allowed';

export function Input({ label, className, ...props }: InputProps) {
  return (
    <div className="space-y-1.5">
      {label && <label className="block text-sm font-medium text-ink-soft">{label}</label>}
      <input className={cn(field, className)} {...props} />
    </div>
  );
}

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
}

export function Textarea({ label, className, ...props }: TextareaProps) {
  return (
    <div className="space-y-1.5">
      {label && <label className="block text-sm font-medium text-ink-soft">{label}</label>}
      <textarea className={cn(field, 'resize-none', className)} {...props} />
    </div>
  );
}
