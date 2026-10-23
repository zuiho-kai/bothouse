import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { RefreshCw, ExternalLink, AlertCircle, Clock, Undo2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { getUpdate, getUpdateLocal, applyUpdate, ackUpdate, type UpdateInfo, type UpdateFailReason } from '@/api/update';
import { getStatus } from '@/api/status';

// Reconnect poll while the program restarts after an update. A restart takes about 10 s
// (bots reconnect in ~10 s, im-bridge/claude/CLAUDE.md), so 2 s keeps the wait short.
const RECONNECT_POLL_MS = 2000;
// Give up waiting after this long. 来源：后端自检最多等 90 s 新版回应、再给 15 s 让旧版被拉起
// （core/update_guard.go UpdateGuardTimeout / updateGuardGrace），之后旧版还要启动；
// 取 150 s，保证回退结果先于超时提示出现。
const RESTART_WAIT_MS = 150_000;

type Phase = 'idle' | 'updating' | 'restarting' | 'failed' | 'timeout' | 'rolledBack' | 'rollbackFailed';

const v = (s: string) => (s && !s.startsWith('v') && s !== 'dev' ? `v${s}` : s);

export default function VersionBadge({ collapsed }: { collapsed: boolean }) {
  const { t } = useTranslation();
  const [info, setInfo] = useState<UpdateInfo | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState('');
  const [reason, setReason] = useState<UpdateFailReason>('other');
  const [rb, setRb] = useState<{ from: string; to: string }>({ from: '', to: '' });
  const [downloadUrl, setDownloadUrl] = useState('');
  const timer = useRef<number | undefined>(undefined);

  const showLastResult = (i: UpdateInfo) => {
    const lr = i.last_result;
    if (!lr) return false;
    setRb({ from: v(lr.from), to: v(lr.to) });
    setError(lr.detail || '');
    setDownloadUrl(i.download_url);
    setPhase(lr.status === 'rolled_back' ? 'rolledBack' : 'rollbackFailed');
    return true;
  };

  useEffect(() => {
    getUpdate().then(i => { setInfo(i); showLastResult(i); }).catch(() => {
      getStatus().then(s => setInfo({ current: s.version, latest: '', has_update: false, dev: false, download_url: '', error: '' })).catch(() => {});
    });
    return () => window.clearInterval(timer.current);
  }, []);

  if (!info) return null;

  const waitForRestart = (from: string) => {
    const started = Date.now();
    timer.current = window.setInterval(() => {
      if (Date.now() - started > RESTART_WAIT_MS) {
        window.clearInterval(timer.current);
        setDownloadUrl(info.download_url);
        setPhase('timeout');
        return;
      }
      getStatus()
        .then(s => {
          if (s.version && s.version !== from) {
            window.clearInterval(timer.current);
            window.location.reload();
          } else if (s.version === from) {
            // Old version answering: either not restarted yet, or the self-check rolled back.
            getUpdateLocal().then(i => {
              if (i.last_result) {
                window.clearInterval(timer.current);
                setInfo({ ...i, latest: info.latest, has_update: info.has_update, download_url: info.download_url });
                showLastResult(i);
              }
            }).catch(() => {});
          }
        })
        .catch(() => { /* still restarting */ });
    }, RECONNECT_POLL_MS);
  };

  const onUpdate = async () => {
    setPhase('updating');
    setError('');
    try {
      const r = await applyUpdate();
      if (r.status === 'restarting') {
        setPhase('restarting');
        waitForRestart(info.current);
      } else if (r.status === 'up_to_date') {
        setPhase('idle');
        setInfo({ ...info, has_update: false });
      } else {
        setPhase('failed');
        setError(r.error || '');
        setReason(r.reason || 'other');
        setDownloadUrl(r.download_url || info.download_url);
      }
    } catch (e: any) {
      setPhase('failed');
      setError(e?.message || String(e));
      setReason('other');
      setDownloadUrl(info.download_url);
    }
  };

  const dismiss = () => {
    ackUpdate().catch(() => {});
    setInfo({ ...info, last_result: undefined });
    setPhase('idle');
  };

  const current = v(info.current);
  const busy = phase === 'updating' || phase === 'restarting';
  const notice = phase === 'failed' || phase === 'timeout' || phase === 'rolledBack' || phase === 'rollbackFailed';
  const showUpdate = info.has_update && !notice;
  const label = phase === 'updating'
    ? t('update.updating', { version: v(info.latest) })
    : phase === 'restarting'
      ? t('update.restarting')
      : t('update.button', { version: v(info.latest) });
  const title = info.dev ? t('update.dev') : info.error ? `${t('update.checkFailed')}: ${info.error}` : undefined;

  const noticeText = phase === 'failed'
    ? t(`update.reason.${reason}`)
    : phase === 'timeout'
      ? t('update.timeout')
      : phase === 'rolledBack'
        ? t('update.rolledBack', rb)
        : t('update.rollbackFailed', rb);
  const noticeHead = phase === 'failed' ? t('update.failed') : undefined;
  // rolled back = working again, so it is a warning (amber), not an error (red)
  const tone = phase === 'rolledBack' || phase === 'timeout'
    ? 'bg-amber-500/10 text-amber-700 dark:text-amber-300'
    : 'bg-red-500/10 text-red-600 dark:text-red-400';
  const NoticeIcon = phase === 'timeout' ? Clock : phase === 'rolledBack' ? Undo2 : AlertCircle;

  if (collapsed) {
    return (
      <div className="flex flex-col items-center gap-1 pb-1" data-testid="version-badge">
        <span className="text-[10px] leading-none text-gray-400 dark:text-gray-500 truncate max-w-full" title={title}>{current}</span>
        {showUpdate && (
          <button
            type="button"
            onClick={onUpdate}
            disabled={busy}
            title={label}
            aria-label={label}
            className="p-1.5 rounded-lg bg-accent/12 text-accent ring-1 ring-accent/25 hover:bg-accent/20 disabled:opacity-60"
          >
            <RefreshCw size={14} className={cn(busy && 'animate-spin')} />
          </button>
        )}
        {notice && (
          <a href={downloadUrl} target="_blank" rel="noopener noreferrer" title={noticeText} aria-label={noticeText} className={cn('p-1.5 rounded-lg', tone)}>
            <NoticeIcon size={14} />
          </a>
        )}
      </div>
    );
  }

  return (
    <div className="px-2 pb-1 space-y-1.5" data-testid="version-badge">
      <div className="text-xs text-gray-400 dark:text-gray-500 select-none" title={title}>
        bothouse {current}
        {info.dev && <span className="ml-1">· {t('update.devShort')}</span>}
      </div>
      {showUpdate && (
        <button
          type="button"
          onClick={onUpdate}
          disabled={busy}
          className={cn(
            'flex items-center justify-center gap-1.5 w-full px-2 py-1.5 rounded-lg text-xs font-medium transition-colors',
            'bg-accent/12 text-accent ring-1 ring-accent/25 hover:bg-accent/20 disabled:opacity-70',
          )}
        >
          <RefreshCw size={13} className={cn(busy && 'animate-spin')} />
          <span className="truncate">{label}</span>
        </button>
      )}
      {notice && (
        <div className={cn('rounded-lg px-2 py-1.5 text-xs space-y-1', tone)} data-testid="update-notice">
          <div className="flex items-start gap-1">
            <NoticeIcon size={13} className="shrink-0 mt-px" />
            <span className="min-w-0 [overflow-wrap:anywhere]">
              {noticeHead && <span className="font-medium">{noticeHead}：</span>}
              {noticeText}
            </span>
          </div>
          {error && (
            <details className="opacity-80">
              <summary className="cursor-pointer select-none">{t('update.details')}</summary>
              <div className="mt-1 font-mono text-[11px] [overflow-wrap:anywhere]">{error}</div>
            </details>
          )}
          <div className="flex items-center gap-3">
            <a href={downloadUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-medium underline">
              <ExternalLink size={12} />
              {t('update.openDownload')}
            </a>
            {(phase === 'rolledBack' || phase === 'rollbackFailed') && (
              <button type="button" onClick={dismiss} className="underline opacity-80">{t('update.dismiss')}</button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
