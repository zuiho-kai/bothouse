import { useTranslation } from 'react-i18next';
import { X, MessageSquare, Plus } from 'lucide-react';
import type { Session } from '@/api/sessions';
import { cn } from '@/lib/utils';
import Avatar from './parts/Avatar';
import { formatRelative, useChatCopy } from './copy';

interface Props {
  open: boolean;
  onClose: () => void;
  sessions: Session[];
  currentSessionId: string;
  onSelect: (session: Session) => void;
  onNewSession?: () => void;
}

export default function SessionDrawer({ open, onClose, sessions, currentSessionId, onSelect, onNewSession }: Props) {
  const { t } = useTranslation();
  const copy = useChatCopy();

  return (
    <>
      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/20 transition-opacity duration-200 dark:bg-black/50"
          onClick={onClose}
        />
      )}

      <aside
        aria-label={t('chat.sessions')}
        aria-hidden={!open}
        className={cn(
          'fixed right-0 top-0 z-50 flex h-full w-[320px] max-w-[88vw] flex-col transition-transform duration-300 ease-out',
          open ? 'translate-x-0' : 'translate-x-full',
        )}
        style={{
          background: 'var(--ch-panel)',
          borderLeft: '1px solid var(--ch-line)',
          boxShadow: 'var(--ch-e3)',
          color: 'var(--ch-ink)',
        }}
      >
        <header
          className="flex h-14 shrink-0 items-center justify-between px-4"
          style={{ borderBottom: '1px solid var(--ch-line)' }}
        >
          <h3 className="text-[14px] font-semibold">{t('chat.sessions')}</h3>
          <div className="flex items-center gap-1">
            {onNewSession && (
              <button
                type="button"
                onClick={onNewSession}
                className="ch-focus flex h-9 w-9 items-center justify-center rounded-full text-[color:var(--ch-ink3)] transition-colors hover:text-[color:var(--ch-accent-ink)]"
                title={t('cmd.new')}
                aria-label={t('cmd.new')}
              >
                <Plus size={16} />
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="ch-focus flex h-9 w-9 items-center justify-center rounded-full text-[color:var(--ch-ink3)] transition-colors hover:text-[color:var(--ch-ink)]"
              aria-label={t('common.close', 'Close')}
            >
              <X size={16} />
            </button>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {sessions.length === 0 ? (
            <div className="px-3 py-10 text-center text-[13px] text-[color:var(--ch-ink3)]">
              {t('sessions.noSessions')}
            </div>
          ) : (
            sessions.map((s) => {
              const isCurrent = s.id === currentSessionId;
              const label = s.name || s.user_name || s.id.slice(0, 8);
              const ts = s.updated_at || s.created_at;
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => onSelect(s)}
                  aria-current={isCurrent}
                  data-active={isCurrent}
                  className="ch-row ch-focus flex w-full items-start gap-3 px-2.5 py-2.5 text-left"
                >
                  <Avatar name={label} size={40} live={s.live} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline gap-2">
                      <span className="truncate text-[13.5px] font-semibold leading-5">{label}</span>
                      <span className="ml-auto shrink-0 text-[11px] tabular-nums text-[color:var(--ch-ink3)]">
                        {formatRelative(ts, copy)}
                      </span>
                    </span>
                    {s.last_message ? (
                      <span className="mt-0.5 block truncate text-[12px] leading-[18px] text-[color:var(--ch-ink2)]">
                        {s.last_message.content.replace(/\n/g, ' ')}
                      </span>
                    ) : (
                      <span className="mt-0.5 block truncate text-[12px] leading-[18px] text-[color:var(--ch-ink3)]">
                        {t('chat.noMessages')}
                      </span>
                    )}
                    <span className="mt-1 flex items-center gap-1.5">
                      {s.platform && (
                        <span
                          className="rounded-full px-1.5 py-[1px] text-[10px] leading-4 text-[color:var(--ch-ink3)]"
                          style={{ boxShadow: 'inset 0 0 0 1px var(--ch-line)' }}
                        >
                          {s.platform}
                        </span>
                      )}
                      <span className="ml-auto text-[10px] tabular-nums text-[color:var(--ch-ink3)]">
                        {copy.messages(s.history_count)}
                      </span>
                    </span>
                  </span>
                </button>
              );
            })
          )}
        </div>

        <div
          className="flex shrink-0 items-center gap-1.5 px-4 py-2 text-[11px] text-[color:var(--ch-ink3)]"
          style={{ borderTop: '1px solid var(--ch-line)' }}
        >
          <MessageSquare size={12} />
          {copy.showingCount(sessions.length, sessions.length)}
        </div>
      </aside>
    </>
  );
}
