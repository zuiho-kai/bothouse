import { useEffect, useState, type ReactNode } from 'react';
import { dshIsSetUp } from '@/api/modules';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, PowerOff } from 'lucide-react';
// action: shown next to 「DSH 未运行」 (the overview passes 打开 DSH, which starts it again)
// always: the page itself needs DSH (Wiki 星河), so 「DSH 未运行」 shows even where DSH is not set up
export function DSHNotice({ status, error, action, always }: { status?: 'running' | 'stopped' | 'error'; error?: string; action?: ReactNode; always?: boolean }) {
  const { t } = useTranslation();
  const [setUp, setSetUp] = useState<boolean | undefined>(undefined);
  useEffect(() => { if (status === 'stopped' && !always) void dshIsSetUp().then(setSetUp); }, [status, always]);
  if (!status || status === 'running') return null;
  if (status === 'stopped' && !always && setUp === false) return null; // #2113: no DSH here, nothing to start
  const text = `${status === 'error' ? t('dsh.readError', 'DSH 读取失败') : t('dsh.stopped', 'DSH 未运行')}${error ? `: ${error}` : ''}`;
  // #579: 提示条 = 左侧状态图标 + 文字 + 右侧操作；读取失败用琥珀色，未运行用中性色
  const tone = status === 'error'
    ? 'border-amber-500/30 bg-amber-500/[0.07] text-amber-900 dark:text-amber-200 yellow:text-amber-900'
    : 'border-hairline bg-surface-sunken text-ink-soft';
  const Icon = status === 'error' ? AlertTriangle : PowerOff;
  return (
    <div role="status" className={`flex items-start gap-3 rounded-card border px-4 py-3 text-sm leading-6 ${tone}`}>
      <Icon size={16} className="mt-1 shrink-0 opacity-80" aria-hidden />
      <span className="min-w-0 flex-1 break-words">{text}</span>
      {action && status === 'stopped' && <span className="shrink-0">{action}</span>}
    </div>
  );
}
export function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error); }
