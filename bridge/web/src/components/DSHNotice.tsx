import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
// action: shown next to 「DSH 未运行」 (the overview passes 打开 DSH, which starts it again)
export function DSHNotice({ status, error, action }: { status?: 'running' | 'stopped' | 'error'; error?: string; action?: ReactNode }) {
  const { t } = useTranslation();
  if (!status || status === 'running') return null;
  const text = `${status === 'error' ? t('dsh.readError', 'DSH 读取失败') : t('dsh.stopped', 'DSH 未运行')}${error ? `: ${error}` : ''}`;
  if (!action || status !== 'stopped') return <p role="status" className="rounded-control bg-surface-sunken px-3 py-2 text-sm text-ink-soft">{text}</p>;
  return <div role="status" className="flex items-center justify-between gap-3 rounded-control bg-surface-sunken px-3 py-2 text-sm text-ink-soft"><span>{text}</span>{action}</div>;
}
export function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error); }
