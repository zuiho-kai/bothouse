import { useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { MessageSquare, ChevronRight, Search } from 'lucide-react';
import { EmptyState } from '@/components/ui';
import { LibraryAvatar } from '@/components/library/LibraryAvatar';
import { backendLabel } from '@/lib/roleIdentity';
import { listProjects, shownName, type ProjectSummary } from '@/api/projects';
import { listSessions, type Session } from '@/api/sessions';

interface ChatEntry {
  project: ProjectSummary;
  latestSession: Session | null;
}

function timeAgo(iso: string, t: (k: string) => string): string {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return t('sessions.justNow');
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

export default function ChatList() {
  const { t } = useTranslation();
  const [entries, setEntries] = useState<ChatEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const { projects: projs } = await listProjects();
      if (!projs?.length) {
        setEntries([]);
        return;
      }
      const results = await Promise.all(
        projs.map(async (p) => {
          try {
            const { sessions } = await listSessions(p.name);
            const sorted = (sessions || []).sort(
              (a, b) => (b.updated_at || b.created_at || '').localeCompare(a.updated_at || a.created_at || ''),
            );
            return { project: p, latestSession: sorted[0] || null };
          } catch {
            return { project: p, latestSession: null };
          }
        }),
      );
      results.sort((a, b) => {
        const ta = a.latestSession?.updated_at || a.latestSession?.created_at || '';
        const tb = b.latestSession?.updated_at || b.latestSession?.created_at || '';
        return tb.localeCompare(ta);
      });
      setEntries(results);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const handler = () => fetchData();
    window.addEventListener('cc:refresh', handler);
    return () => window.removeEventListener('cc:refresh', handler);
  }, [fetchData]);

  const [q, setQ] = useState('');
  const shown = q.trim()
    ? entries.filter(({ project }) => `${shownName(project)} ${project.name} ${project.agent_type}`.toLowerCase().includes(q.trim().toLowerCase()))
    : entries;

  return (
    <div className="mx-auto w-full max-w-4xl animate-fade-in space-y-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-[28px] font-semibold leading-tight tracking-tight text-ink">{t('nav.chat')}</h1>
          <p className="mt-1.5 text-sm text-ink-soft">{t('chat.subtitle', '每个角色一条对话，最近说过话的排在前面')}</p>
        </div>
        {entries.length > 3 && (
          <label className="relative block sm:w-72">
            <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-mute" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={t('chat.search', '找角色')}
              aria-label={t('chat.search', '找角色')}
              className="h-10 w-full rounded-control border border-hairline bg-surface pl-9 pr-3 text-sm text-ink shadow-ui-1 placeholder:text-ink-mute focus:border-accent-text focus:outline-none"
            />
          </label>
        )}
      </header>

      {loading && entries.length === 0 ? (
        <div className="overflow-hidden rounded-card bg-surface shadow-ui-1" aria-busy="true">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="flex items-center gap-3 border-b border-hairline px-4 py-4 last:border-0">
              <span className="h-11 w-11 animate-pulse rounded-full bg-surface-sunken" />
              <span className="h-4 flex-1 animate-pulse rounded bg-surface-sunken" />
            </div>
          ))}
        </div>
      ) : entries.length === 0 ? (
        <div className="rounded-card bg-surface p-8 shadow-ui-1">
          <EmptyState message={t('chat.noChats')} icon={MessageSquare} />
        </div>
      ) : (
        // #579 v2: an inbox, not a wall of cards: avatar, name, last line, time — the way chat apps list threads
        <ul className="divide-y divide-hairline overflow-hidden rounded-card bg-surface shadow-ui-1" role="list">
          {shown.map(({ project, latestSession }) => {
            const hasLive = latestSession?.live;
            const lastMsg = latestSession?.last_message;
            const ts = latestSession?.updated_at || latestSession?.created_at || '';
            const name = shownName(project);

            return (
              <li key={project.name}>
                <Link
                  to={`/chat/${project.name}`}
                  className="group flex min-h-[72px] min-w-0 items-center gap-3.5 px-4 py-3.5 transition-colors duration-base hover:bg-surface-sunken/60 focus-visible:bg-surface-sunken focus-visible:outline-none sm:px-5"
                >
                  <span className="relative shrink-0">
                    <LibraryAvatar name={name} size={48} />
                    {hasLive && <span className="absolute -bottom-0.5 -right-0.5 rounded-full bg-surface p-[2px]"><span className="block h-2.5 w-2.5 rounded-full bg-emerald-500" /></span>}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 items-baseline gap-2">
                      <h3 className="truncate text-[15px] font-semibold text-ink">{name}</h3>
                      <span className="hidden shrink-0 text-xs text-ink-mute sm:inline">{backendLabel(project.agent_type)}</span>
                      <span className="ml-auto shrink-0 text-xs tabular-nums text-ink-mute">{ts ? timeAgo(ts, t) : ''}</span>
                    </div>
                    {lastMsg ? (
                      <p className="mt-0.5 truncate text-sm text-ink-soft">
                        <span className="text-ink-mute">{lastMsg.role === 'user' ? t('chat.you', '你') : name}：</span>
                        {lastMsg.content.replace(/\n/g, ' ').slice(0, 160)}
                      </p>
                    ) : (
                      <p className="mt-0.5 truncate text-sm text-ink-mute">{t('chat.empty', t('chat.noMessages'))}</p>
                    )}
                    <p className="mt-1 flex min-w-0 items-center gap-1.5 overflow-hidden whitespace-nowrap text-[11px] text-ink-mute" data-testid="chat-card-footer">
                      <span className="shrink-0 sm:hidden">{backendLabel(project.agent_type)}</span>
                      <span className="shrink-0 sm:hidden" aria-hidden>·</span>
                      <span className="shrink-0 tabular-nums" data-testid="chat-card-count-time">{t('chat.sessionCount', { count: project.sessions_count, defaultValue: `${project.sessions_count}` })}</span>
                      {(project.platforms?.length ?? 0) > 0 && <><span aria-hidden>·</span><span className="truncate">{project.platforms!.join(' / ')}</span></>}
                    </p>
                  </div>
                  <ChevronRight size={16} className="shrink-0 text-ink-mute opacity-0 transition-opacity duration-base group-hover:opacity-100" />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
