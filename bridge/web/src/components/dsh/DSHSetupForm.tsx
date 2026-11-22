import { useState, type FormEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { errorMessage } from '@/components/DSHNotice';
import { Button } from '@/components/ui';
import { cn } from '@/lib/utils';

interface Props {
  children: ReactNode;
  onCancel: () => void;
  cancelLabel?: string;
  submit?: { run: () => Promise<void>; label?: string; disabled?: boolean };
  secondaryAction?: ReactNode;
  className?: string;
}

export function DSHSetupForm({ children, onCancel, cancelLabel, submit, secondaryAction, className }: Props) {
  const { t } = useTranslation();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!submit || submit.disabled || saving) return;
    setSaving(true);
    setError('');
    try {
      await submit.run();
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className={cn('space-y-4', className)} onSubmit={save} onChange={() => setError('')}>
      <fieldset className="min-w-0 space-y-4" disabled={saving}>{children}</fieldset>
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onCancel} disabled={saving}>{cancelLabel ?? t('common.cancel')}</Button>
        {secondaryAction}
        {submit && <Button type="submit" disabled={submit.disabled} loading={saving}>{saving ? t('common.loading') : submit.label ?? t('common.save')}</Button>}
      </div>
    </form>
  );
}
