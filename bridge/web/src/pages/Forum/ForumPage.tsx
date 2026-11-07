import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { MessagesSquare, RotateCw } from 'lucide-react';
import { Button, LoadingState, PageHeader } from '@/components/ui';
import { cn } from '@/lib/utils';
import { getForum, type ForumPost, type ForumResp, type ForumThread, type ForumVoter } from '@/api/forum';
import { forumTexts, type ForumTexts } from './texts';

/**
 * 记忆论坛 (#1143): the memories each role gets per turn, as forum posts — a one-line title, up/down
 * votes and score, how often it was pushed and cited, the page it came from and the [#id] that
 * `bothouse ctx` takes. Ranking is the gate's (forum_scores.py, Reddit best); this page only shows
 * it. Ported from the static page the user approved on 11-06 (vps-arm /opt/overflow-site/forum.py),
 * minus the full push/vote log the user did not ask for.
 *
 * 楼层帖 (#1177, user 11-07: one thread per question, every answer under it carries its own weight):
 * the list shows threads; opening one (?t=<tid>) shows its answers ranked by votes, each with its floor
 * number (by time), date and source page. Threads come from the gate (forum_page.threads).
 */

/** Same tokens as wiki_search.toks / forum.py: CJK bigrams, latin words >= 2, numbers >= 3, #ids. */
export function toks(text: string): string[] {
  const t = text.toLowerCase();
  const out: string[] = [];
  for (const s of t.match(/[一-鿿]+/g) || []) {
    if (s.length === 1) out.push(s);
    for (let i = 0; i < s.length - 1; i++) out.push(s.slice(i, i + 2));
  }
  for (const w of t.match(/[a-z][a-z0-9_.-]{1,}|\d{3,}|#[0-9a-f]{4,}/g) || []) out.push(w);
  return out;
}

const haystack = (p: ForumPost) =>
  [p.title, p.rest, p.page, p.page_title, p.page_desc, '#' + p.id].join(' ').toLowerCase();

/** unix seconds → "11-06 13:33" in the viewer's time zone (like the static page's 北京时间). */
export function when(sec: number): string {
  if (!sec) return '';
  const d = new Date(sec * 1000);
  const two = (n: number) => String(n).padStart(2, '0');
  return `${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())}`;
}

function voterLabel(T: ForumTexts, v: ForumVoter) {
  return v.who === 'outcome' ? T.outcome : T.self(v.who.replace(/^self:/, ''));
}

function Post({ p, rank, T, tags }: { p: ForumPost; rank: number | null; T: ForumTexts; tags?: string[] }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard?.writeText(p.id).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 800);
    });
  };
  return (
    <div
      className={cn('flex gap-3 rounded-card bg-surface-raised px-3 py-2.5 ring-1 ring-hairline', p.folded && 'opacity-55')}
      data-testid="forum-post"
    >
      <div className="flex min-w-[52px] flex-col items-center text-[13px] tabular-nums">
        <b className="text-green-700 dark:text-green-400">▲ {p.ups}</b>
        <b className="text-red-700 dark:text-red-400">▼ {p.downs}</b>
        <span className="text-xs text-ink-mute">{T.score} {p.score.toFixed(2)}</span>
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-2">
          {rank !== null && <span className="text-xs text-ink-mute">{rank}</span>}
          {tags?.map((t) => (
            <span key={t} className="rounded bg-surface-sunken px-1.5 text-[11px] text-ink-soft ring-1 ring-hairline">{t}</span>
          ))}
          <span className="text-base font-semibold text-ink">{p.title || T.noText}</span>
          <button
            type="button"
            onClick={copy}
            title={T.copy}
            className={cn(
              'rounded border px-1.5 font-mono text-[13px] font-semibold',
              copied
                ? 'border-green-300 bg-green-100 text-green-800'
                : 'border-orange-300 bg-orange-50 text-orange-700 dark:border-orange-700 dark:bg-orange-950 dark:text-orange-300',
            )}
          >
            {copied ? T.copied : `[#${p.id}]`}
          </button>
          {p.folded && <span className="rounded border border-red-600 px-1 text-[11px] text-red-600">{T.folded}</span>}
        </div>
        {p.rest && <div className="mt-0.5 text-sm text-ink-soft">{p.rest}</div>}
        <div className="mt-1 text-xs text-ink-soft">
          {p.page_title}
          {p.page_desc && <> — {p.page_desc.slice(0, 60)}</>}
          <span className="ml-2 text-ink-mute">{p.page}</span>
        </div>
        <div className="mt-0.5 text-xs text-ink-mute">
          {T.stats(p.pushed, p.cited, when(p.last))}
          {p.voters.length > 0 && ' · ' + p.voters.map((v) => `${voterLabel(T, v)} ×${v.n}`).join('；')}
        </div>
      </div>
    </div>
  );
}

export default function ForumPage() {
  const { i18n } = useTranslation();
  const T = forumTexts(i18n.language || 'en');
  const [data, setData] = useState<ForumResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await getForum());
      setError('');
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const forum = data?.forum;
  const [params, setParams] = useSearchParams();
  const open = params.get('t') || '';
  const ts = useMemo(() => toks(q), [q]);
  const byKey = useMemo(() => {
    const m = new Map<string, ForumPost>();
    for (const p of forum?.posts ?? []) m.set(p.page + '#' + p.id, p);
    return m;
  }, [forum]);
  // old gate without threads: every answer is its own thread
  const threads: ForumThread[] = useMemo(
    () =>
      forum?.threads ??
      (forum?.posts ?? []).map((p) => {
        const k = p.page + '#' + p.id;
        return { tid: 'p' + k, title: p.title, desc: '', floors: [k], top: k, latest: k, ups: p.ups, downs: p.downs, pushed: p.pushed, last: p.last, alive: p.alive };
      }),
    [forum],
  );
  const { live, gone } = useMemo(() => {
    const hit = threads.filter((t) => {
      if (!ts.length) return true;
      const h = [t.title, t.desc, ...t.floors.map((k) => (byKey.get(k) ? haystack(byKey.get(k)!) : ''))].join(' ').toLowerCase();
      return ts.every((x) => h.includes(x));
    });
    return { live: hit.filter((t) => t.alive), gone: hit.filter((t) => !t.alive) };
  }, [threads, byKey, ts]);
  const liveTotal = useMemo(() => threads.filter((t) => t.alive).length, [threads]);
  const go = (tid: string) => setParams(tid ? { t: tid } : {});

  const row = (t: ForumThread, rank: number | null) => {
    const top = byKey.get(t.top);
    return (
      <button
        key={t.tid}
        type="button"
        onClick={() => go(t.tid)}
        data-testid="forum-thread"
        className={cn('flex w-full gap-3 rounded-card bg-surface-raised px-3 py-2.5 text-left ring-1 ring-hairline hover:ring-accent-text', top?.folded && 'opacity-55')}
      >
        <div className="flex min-w-[52px] flex-col items-center text-[13px] tabular-nums">
          <b className="text-ink">{T.floors(t.floors.length)}</b>
          <span className="text-xs text-green-700 dark:text-green-400">▲ {t.ups}</span>
          <span className="text-xs text-red-700 dark:text-red-400">▼ {t.downs}</span>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-2">
            {rank !== null && <span className="text-xs text-ink-mute">{rank}</span>}
            <span className="text-base font-semibold text-ink">{t.title || T.noText}</span>
            {t.latest !== t.top && <span className="rounded border border-amber-500 px-1 text-[11px] text-amber-600">{T.disagree}</span>}
          </div>
          {t.desc && <div className="mt-0.5 text-sm text-ink-soft">{t.desc}</div>}
          {top && (
            <div className="mt-1 truncate text-sm text-ink-soft">
              <span className="text-ink-mute">{T.best} · {T.floorNo(top.floor)}：</span>
              {top.title}
            </div>
          )}
          <div className="mt-0.5 text-xs text-ink-mute">{T.threadStats(t.pushed, when(t.last))}</div>
        </div>
      </button>
    );
  };

  const cur = open ? threads.find((t) => t.tid === open) : undefined;

  let body;
  if (loading && !data) body = <LoadingState label={T.loading} />;
  else if (error) body = <p className="text-sm text-red-600">{T.loadFailed}：{error}</p>;
  else if (!data?.running) body = <p className="text-sm text-ink-soft">{T.notRunning}</p>;
  else if (data.error || !forum) body = <p className="text-sm text-red-600">{T.loadFailed}：{data.error}</p>;
  else if (!forum.posts.length) body = <p className="text-sm text-ink-soft">{T.noData}</p>;
  else if (open)
    body = (
      <>
        <button type="button" onClick={() => go('')} className="text-sm text-accent-text hover:underline">
          {T.back}
        </button>
        {!cur ? (
          <p className="text-sm text-ink-soft">{T.threadMissing}</p>
        ) : (
          <>
            <div data-testid="forum-thread-head">
              <h2 className="text-lg font-semibold text-ink">{cur.title}</h2>
              {cur.desc && <p className="mt-1 text-sm text-ink-soft">{cur.desc}</p>}
              <p className="mt-1 text-xs text-ink-mute">{T.floors(cur.floors.length)} · ▲ {cur.ups} ▼ {cur.downs}</p>
            </div>
            <div className="space-y-2">
              {cur.floors.map((k) => {
                const p = byKey.get(k);
                if (!p) return null;
                const tags = [T.floorNo(p.floor)];
                if (k === cur.latest && cur.floors.length > 1) tags.push(T.latest);
                return <Post key={k} p={p} rank={null} T={T} tags={tags} />;
              })}
            </div>
          </>
        )}
      </>
    );
  else
    body = (
      <>
        <div className="text-[13px] leading-relaxed text-ink-soft">
          {T.threadsSummary(liveTotal, forum.posts.filter((p) => p.alive).length, forum.rounds, forum.ups, forum.downs, when(forum.last_vote))}
          <br />
          {T.howRanked}
        </div>
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={T.search}
          autoFocus
          className="w-full rounded-card border border-hairline-strong bg-surface-raised px-3 py-2.5 text-base text-ink outline-none focus:ring-2 focus:ring-accent-text"
        />
        {ts.length > 0 && <div className="-mt-2 px-0.5 text-xs text-ink-mute">{T.hits(live.length + gone.length)}</div>}
        <h2 className="text-base font-semibold text-ink">{T.posts}</h2>
        <div className="space-y-2">{live.map((t, i) => row(t, i + 1))}</div>
        {gone.length > 0 && (
          <details open={ts.length > 0}>
            <summary className="cursor-pointer text-sm text-ink-soft">{T.gone(gone.length)}</summary>
            <div className="mt-2 space-y-2">{gone.map((t) => row(t, null))}</div>
          </details>
        )}
      </>
    );

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <PageHeader
        title={T.title}
        description={T.subtitle}
        icon={MessagesSquare}
        actions={
          <Button variant="secondary" size="sm" onClick={load} disabled={loading}>
            <RotateCw size={14} className={cn(loading && 'animate-spin')} /> {T.refresh}
          </Button>
        }
      />
      {body}
    </div>
  );
}
