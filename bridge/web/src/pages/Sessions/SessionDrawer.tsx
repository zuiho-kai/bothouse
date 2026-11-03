import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { ArrowRight, Bot, MessageSquareText, User, X } from 'lucide-react';
import { Badge } from '@/components/ui';
import { cn } from '@/lib/utils';
import { formatTime } from '@/lib/utils';
import { relativeTime, type FlatSession } from './sessionListModel';

interface DrawerProps {
  session: FlatSession | null;
  projectLabel: string;
  onClose: () => void;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2">
      <span className="shrink-0 text-xs text-ink-mute">{label}</span>
      <span className="min-w-0 truncate text-right text-sm text-ink">{children}</span>
    </div>
  );
}

/**
 * 会话抽屉：只用列表已拿到的字段，不再发请求——打开是零等待，翻会话时不会卡一下。
 * 「最后一句」被完整展开，长消息也不截断在这里。
 */
export function SessionDrawer({ session, projectLabel, onClose }: DrawerProps) {
  const { t } = useTranslation();
  const [entered, setEntered] = useState(false);

  useEffect(() => {
    if (!session) {
      setEntered(false);
      return;
    }
    const raf = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(raf);
  }, [session]);

  useEffect(() => {
    if (!session) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [session, onClose]);

  if (!session) return null;
  const last = session.last_message;

  return (
    <div className="fixed inset-0 z-[9998]" role="presentation">
      <div
        className={cn(
          'absolute inset-0 bg-black/25 transition-opacity duration-state ease-ui-standard',
          entered ? 'opacity-100' : 'opacity-0'
        )}
        onClick={onClose}
        role="presentation"
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={session.name}
        className={cn(
          'absolute inset-y-0 right-0 flex w-full max-w-[420px] flex-col bg-surface shadow-ui-3',
          'transition-transform duration-state ease-ui-out',
          entered ? 'translate-x-0' : 'translate-x-full'
        )}
      >
        <header data-ui="drawer-header" className="flex items-start justify-between gap-3 border-b border-hairline px-5 py-4">
          <div className="min-w-0">
            <h2 className="truncate text-base font-semibold tracking-tight text-ink">{session.name}</h2>
            <p className="mt-0.5 flex items-center gap-1.5 text-xs text-ink-mute">
              <span className="truncate">{projectLabel}</span>
              <span aria-hidden>·</span>
              <span className="tabular-nums">
                {relativeTime(session.updated_at || session.created_at, t('sessions.justNow'))}
              </span>
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('common.close', '关闭')}
            className="grid h-11 w-11 shrink-0 place-items-center rounded-control text-ink-mute transition-colors duration-base ease-ui-out hover:bg-surface-sunken hover:text-ink focus-visible:outline-none focus-visible:shadow-ui-ring sm:h-9 sm:w-9"
          >
            <X size={17} />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-3">
          <section className="divide-y divide-hairline">
            <Field label={t('sessions.platform')}>{session.platform || '-'}</Field>
            <Field label={t('projects.agent', 'Agent')}>{session.agent_type || '-'}</Field>
            <Field label={t('sessions.sessionKey')}>
              <code className="font-mono text-xs text-ink-soft">{session.session_key || '-'}</code>
            </Field>
            <Field label={t('sessions.history')}>
              <span className="inline-flex items-center gap-1 tabular-nums">
                <MessageSquareText size={13} className="text-ink-mute" />
                {session.history_count ?? 0}
              </span>
            </Field>
            <Field label={t('sessions.createdAt')}>{formatTime(session.created_at)}</Field>
            <Field label={t('sessions.active')}>
              {session.live ? (
                <Badge variant="success">{t('sessions.active')}</Badge>
              ) : (
                <Badge variant="outline">{t('sessions.offline')}</Badge>
              )}
            </Field>
            {session.user_name && <Field label={t('chat.user', '成员')}>{session.user_name}</Field>}
            {session.chat_name && <Field label={t('chat.chat', '会话名')}>{session.chat_name}</Field>}
          </section>

          <h3 className="mb-2 mt-5 text-xs font-medium text-ink-mute">
            {t('sessions.lastMessage', '最后一条')}
          </h3>
          {last ? (
            <div className="rounded-card bg-surface-sunken p-3">
              <div className="mb-1.5 flex items-center gap-1.5 text-xs text-ink-mute">
                {last.role === 'user' ? <User size={12} /> : <Bot size={12} className="text-accent-text" />}
                <span>{last.role}</span>
                {last.timestamp && <span className="ml-auto tabular-nums">{formatTime(last.timestamp)}</span>}
              </div>
              <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-ink-soft">
                {last.content}
              </p>
            </div>
          ) : (
            <p className="text-sm text-ink-mute">{t('sessions.noMessages')}</p>
          )}
        </div>

        <footer data-ui="drawer-footer" className="border-t border-hairline p-4">
          <Link
            to={`/sessions/${session._project}/${session.id}`}
            className={cn(
              'inline-flex h-11 w-full items-center justify-center gap-2 rounded-control',
              'bg-accent text-white dark:text-black yellow:text-gray-900 shadow-ui-gloss-1',
              'text-sm font-medium transition-colors duration-base ease-ui-out hover:bg-accent-dim',
              'focus-visible:outline-none focus-visible:shadow-ui-ring'
            )}
          >
            {t('sessions.enterSession')}
            <ArrowRight size={15} />
          </Link>
          {!session.live && (
            <p className="mt-2 text-center text-xs text-ink-mute">{t('sessions.notLiveHint')}</p>
          )}
        </footer>
      </aside>
    </div>
  );
}
