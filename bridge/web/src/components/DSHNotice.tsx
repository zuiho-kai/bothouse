import { useTranslation } from 'react-i18next';
export function DSHNotice({ status, error }: { status?: 'running' | 'stopped' | 'error'; error?: string }) {
  const { t } = useTranslation();
  if (!status || status === 'running') return null;
  return <p role="status" className="rounded-control bg-surface-sunken px-3 py-2 text-sm text-ink-soft">{status === 'error' ? t('dsh.readError', 'DSH 读取失败') : t('dsh.stopped', 'DSH 未运行')}{error ? `: ${error}` : ''}</p>;
}
export function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error); }
