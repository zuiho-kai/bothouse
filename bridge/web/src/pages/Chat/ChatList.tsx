import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, Circle, MessageSquare, Search } from 'lucide-react';
import { EmptyState } from '@/components/ui';
import { listProjects, shownName, type ProjectSummary } from '@/api/projects';
import { listSessions, type Session } from '@/api/sessions';
import { cn } from '@/lib/utils';
import Avatar from './parts/Avatar';
import AvatarMosaic from './parts/AvatarMosaic';
import { formatRelative, useChatCopy } from './copy';
import './chat.css';

interface ChatEntry {
  project: ProjectSummary;
  latestSession: Session | null;
}

export default function ChatList() {
  const { t } = useTranslation();
  const copy = useChatCopy();
  const navigate = useNavigate();
  const [entries, setEntries] = useState<ChatEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [onlineOnly, setOnlineOnly] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const searchRef = useRef<HTMLInputElement>(null);

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

  const view = useMemo(() => {
    const q = query.trim().toLowerCase();
    return entries.filter(({ project, latestSession }) => {
      if (onlineOnly && !latestSession?.live) return false;
      if (!q) return true;
      const name = shownName(project).toLowerCase();
      return name.includes(q) || project.name.toLowerCase().includes(q) || (latestSession?.name || '').toLowerCase().includes(q);
    });
  }, [entries, query, onlineOnly]);

  useEffect(() => {
    setActiveIdx((i) => Math.max(0, Math.min(i, view.length - 1)));
  }, [view.length]);

  const go = useCallback((name: string) => navigate(`/chat/${name}`), [navigate]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, view.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && view[activeIdx]) {
      e.preventDefault();
      go(view[activeIdx].project.name);
    }
  };

  const active = view[activeIdx];

  if (loading && entries.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center text-sm text-gray-400 animate-pulse">
        Loading…
      </div>
    );
  }

  return (
    <div className="chat-page -m-1 flex min-h-0 flex-1 flex-col gap-4 sm:-m-2 lg:flex-row">
      {/* Conversation list */}
      <section
        className="ch-panel flex min-h-0 flex-1 flex-col overflow-hidden lg:w-[360px] lg:flex-none"
        aria-label={copy.listTitle}
      >
        <header className="flex items-baseline justify-between px-4 pb-2 pt-4">
          <div>
            <h1 className="ch-ink text-[17px] font-semibold leading-6">{copy.listTitle}</h1>
            <p className="ch-ink3 mt-0.5 text-[12px]">{copy.listSubtitle}</p>
          </div>
          <span className="ch-ink3 text-[11px] tabular-nums">{copy.showingCount(view.length, entries.length)}</span>
        </header>

        <div className="px-3 pb-2">
          <div
            className="flex items-center gap-2 rounded-[14px] px-3 py-2"
            style={{ background: 'var(--ch-sub)', boxShadow: 'inset 0 0 0 1px var(--ch-line)' }}
          >
            <Search size={14} className="ch-ink3 shrink-0" />
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={copy.search}
              aria-label={copy.search}
              className="ch-ink flex-1 bg-transparent text-[13px] outline-none placeholder:text-[color:var(--ch-ink3)]"
            />
            <button
              type="button"
              onClick={() => setOnlineOnly((v) => !v)}
              aria-pressed={onlineOnly}
              className={cn(
                'ch-focus flex shrink-0 items-center gap-1 rounded-full px-2 py-1 text-[11px] transition-colors',
                onlineOnly ? 'font-semibold' : 'ch-ink3',
              )}
              style={onlineOnly ? { background: 'var(--ch-own)', color: 'var(--ch-accent-ink)' } : undefined}
            >
              <Circle size={6} className={onlineOnly ? 'fill-current' : 'fill-current opacity-40'} />
              {copy.onlineOnly}
            </button>
          </div>
        </div>

        <div
          role="listbox"
          aria-label={copy.listTitle}
          tabIndex={0}
          onKeyDown={onKeyDown}
          className="ch-focus min-h-0 flex-1 overflow-y-auto px-2 pb-3"
        >
          {view.length === 0 ? (
            entries.length === 0 ? (
              <EmptyState message={copy.emptyList} icon={MessageSquare} />
            ) : (
              <div className="px-3 py-10 text-center">
                <p className="ch-ink text-[14px] font-medium">{copy.noMatch}</p>
                <p className="ch-ink3 mt-1 text-[12px]">{copy.noMatchHint}</p>
              </div>
            )
          ) : (
            view.map(({ project, latestSession }, i) => {
              const displayName = latestSession?.chat_name || latestSession?.name || shownName(project);
              const lastMsg = latestSession?.last_message;
              const ts = latestSession?.updated_at || latestSession?.created_at || '';
              const memberNames: string[] = (latestSession as any)?.members?.map?.((m: any) => m.name) ?? [];
              return (
                <button
                  key={project.name}
                  type="button"
                  role="option"
                  aria-selected={i === activeIdx}
                  data-active={i === activeIdx}
                  onMouseEnter={() => setActiveIdx(i)}
                  onFocus={() => setActiveIdx(i)}
                  onClick={() => go(project.name)}
                  className="ch-row ch-focus flex w-full items-center gap-3 px-2.5 py-2.5 text-left"
                >
                  {memberNames.length > 1 ? (
                    <AvatarMosaic names={memberNames} size={44} />
                  ) : (
                    <Avatar name={displayName} size={44} live={latestSession?.live} />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline gap-2">
                      <span className="ch-ink truncate text-[14px] font-semibold leading-5">{displayName}</span>
                      <span className="ch-ink3 ml-auto shrink-0 text-[11px] tabular-nums">
                        {formatRelative(ts, copy)}
                      </span>
                    </span>
                    <span className="ch-ink2 mt-0.5 line-clamp-1 text-[12.5px] leading-[18px]">
                      {lastMsg ? lastMsg.content.replace(/\n/g, ' ') : copy.pickOne}
                    </span>
                    <span className="mt-1 flex items-center gap-1.5">
                      {project.platforms?.slice(0, 2).map((pl) => (
                        <span
                          key={pl}
                          className="ch-ink3 rounded-full px-1.5 py-[1px] text-[10px] leading-4"
                          style={{ boxShadow: 'inset 0 0 0 1px var(--ch-line)' }}
                        >
                          {pl}
                        </span>
                      ))}
                      {latestSession?.live && (
                        <span className="text-[10px] font-medium leading-4 text-emerald-600 dark:text-emerald-400">
                          {copy.onlineNow}
                        </span>
                      )}
                      <span className="ch-ink3 ml-auto text-[10px] tabular-nums">
                        {copy.messages(latestSession?.history_count ?? 0)}
                      </span>
                    </span>
                  </span>
                </button>
              );
            })
          )}
        </div>
      </section>

      {/* Welcome / preview rail — desktop only, keeps the list readable on phones */}
      <section className="ch-panel hidden min-h-0 flex-1 flex-col items-center justify-center overflow-hidden p-10 lg:flex">
        {active ? (
          <div className="ch-enter flex w-full max-w-[420px] flex-col items-center text-center">
            <Avatar name={active.latestSession?.chat_name || active.latestSession?.name || shownName(active.project)} size={56} live={active.latestSession?.live} />
            <h2 className="ch-ink mt-4 text-[17px] font-semibold leading-6">
              {active.latestSession?.chat_name || active.latestSession?.name || shownName(active.project)}
            </h2>
            <p className="ch-ink3 mt-1 text-[12px]">
              {active.project.agent_type} · {copy.messages(active.latestSession?.history_count ?? 0)}
            </p>
            <p className="ch-ink2 mt-4 line-clamp-3 text-[13px] leading-[21px]">
              {active.latestSession?.last_message?.content.replace(/\n/g, ' ') || copy.welcomeBody}
            </p>
            <button
              type="button"
              onClick={() => go(active.project.name)}
              className="ch-focus mt-6 inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-[13px] font-semibold text-black transition-transform active:translate-y-px"
              style={{ background: 'var(--ch-accent)', boxShadow: 'var(--ch-e1)' }}
            >
              {copy.startChat}
              <ArrowRight size={14} />
            </button>
          </div>
        ) : (
          <div className="max-w-[380px] text-center">
            <h2 className="ch-ink text-[17px] font-semibold leading-6">{copy.welcomeTitle}</h2>
            <p className="ch-ink2 mt-2 text-[13px] leading-[21px]">{copy.welcomeBody}</p>
          </div>
        )}
      </section>
    </div>
  );
}
