import { describe, expect, it } from 'vitest';
import type { Session } from '@/api/sessions';
import type { ProjectSummary } from '@/api/projects';
import {
  emptySessionFilters,
  filterSessions,
  flattenSessions,
  relativeTime,
  sessionMatches,
  sessionProjectFacets,
  sessionTotals,
} from './sessionListModel';

const session = (over: Partial<Session> = {}): Session => ({
  id: 's1',
  session_key: 'telegram:1',
  name: '和肥鱼聊天',
  platform: 'telegram',
  agent_type: 'codex',
  active: true,
  live: true,
  created_at: '2026-11-03T10:00:00Z',
  updated_at: '2026-11-03T12:00:00Z',
  history_count: 3,
  last_message: { role: 'user', content: '帮我看下构建日志', timestamp: '2026-11-03T12:00:00Z' },
  ...over,
});

describe('sessionListModel', () => {
  it('flattens projects into sessions and keeps the project on each row', () => {
    const flat = flattenSessions([
      { project: 'coder', sessions: [session({ id: 'a' })] },
      { project: 'writer', sessions: [session({ id: 'b' })] },
    ]);
    expect(flat.map((s) => `${s._project}/${s.id}`)).toEqual(['coder/a', 'writer/b']);
  });

  it('sorts newest first using updated_at and falls back to created_at', () => {
    const flat = flattenSessions([
      {
        project: 'p',
        sessions: [
          session({ id: 'old', updated_at: '2026-11-01T00:00:00Z' }),
          session({ id: 'new', updated_at: '2026-11-03T00:00:00Z' }),
          session({ id: 'mid', updated_at: '', created_at: '2026-11-02T00:00:00Z' }),
        ],
      },
    ]);
    expect(flat.map((s) => s.id)).toEqual(['new', 'mid', 'old']);
  });

  it('matches the last message text, member and chat names', () => {
    const flat = { ...session({ user_name: '主人', chat_name: '工位群' }), _project: 'p' };
    expect(sessionMatches(flat, { ...emptySessionFilters, query: '构建日志' })).toBe(true);
    expect(sessionMatches(flat, { ...emptySessionFilters, query: '主人' })).toBe(true);
    expect(sessionMatches(flat, { ...emptySessionFilters, query: '工位群' })).toBe(true);
    expect(sessionMatches(flat, { ...emptySessionFilters, query: '无关' })).toBe(false);
  });

  it('treats a session as "has messages" when either the counter or a last message exists', () => {
    const withCount = { ...session({ history_count: 2, last_message: null }), _project: 'p' };
    const withLast = { ...session({ history_count: 0, last_message: session().last_message }), _project: 'p' };
    const empty = { ...session({ history_count: 0, last_message: null }), _project: 'p' };
    const filters = { ...emptySessionFilters, onlyWithMessages: true };

    expect(sessionMatches(withCount, filters)).toBe(true);
    expect(sessionMatches(withLast, filters)).toBe(true);
    expect(sessionMatches(empty, filters)).toBe(false);
  });

  it('filters by live state and by project', () => {
    const live = { ...session({ id: 'a', live: true }), _project: 'coder' };
    const offline = { ...session({ id: 'b', live: false }), _project: 'writer' };
    const list = [live, offline];

    expect(filterSessions(list, { ...emptySessionFilters, onlyLive: true })).toEqual([live]);
    expect(filterSessions(list, { ...emptySessionFilters, projects: ['writer'] })).toEqual([offline]);
    expect(filterSessions(list, emptySessionFilters)).toHaveLength(2);
  });

  it('builds project facets labelled with the display name and skips projects with no sessions', () => {
    const projects = [
      { name: 'coder', display_name: '鲸鱼娘', agent_type: 'codex', platforms: [], sessions_count: 2, heartbeat_enabled: false },
      { name: 'writer', agent_type: 'codex', platforms: [], sessions_count: 0, heartbeat_enabled: false },
      { name: 'idle', agent_type: 'codex', platforms: [], sessions_count: 0, heartbeat_enabled: false },
    ] as ProjectSummary[];

    const facets = sessionProjectFacets(
      [
        { project: 'coder', sessions: [session(), session({ id: 's2' })] },
        { project: 'writer', sessions: [] },
      ],
      projects
    );

    expect(facets).toEqual([{ key: 'coder', label: '鲸鱼娘', count: 2 }]);
  });

  it('counts sessions, live sessions and projects', () => {
    const totals = sessionTotals([
      { ...session({ id: 'a', live: true }), _project: 'coder' },
      { ...session({ id: 'b', live: false }), _project: 'coder' },
      { ...session({ id: 'c', live: true }), _project: 'writer' },
    ]);
    expect(totals).toEqual({ sessions: 3, live: 2, projects: 2 });
  });

  it('formats relative time down to one unit', () => {
    const now = Date.now();
    const ago = (ms: number) => new Date(now - ms).toISOString();
    expect(relativeTime(ago(5_000), '刚刚')).toBe('刚刚');
    expect(relativeTime(ago(5 * 60_000), '刚刚')).toBe('5m');
    expect(relativeTime(ago(3 * 3_600_000), '刚刚')).toBe('3h');
    expect(relativeTime(ago(2 * 86_400_000), '刚刚')).toBe('2d');
    expect(relativeTime('', '刚刚')).toBe('');
  });
});
