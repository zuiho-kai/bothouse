import type { Session } from '@/api/sessions';
import type { ProjectSummary } from '@/api/projects';
import { shownName } from '@/api/projects';

export interface FlatSession extends Session {
  /** 会话本身不带项目名，展平后必须记住它从哪个项目来，否则点击和筛选都无从谈起。 */
  _project: string;
}

export type SessionView = 'card' | 'row';

export interface SessionFilters {
  query: string;
  projects: string[];
  onlyLive: boolean;
  onlyWithMessages: boolean;
}

export const emptySessionFilters: SessionFilters = {
  query: '',
  projects: [],
  onlyLive: false,
  onlyWithMessages: false,
};

export function sessionMatches(s: FlatSession, f: SessionFilters): boolean {
  if (f.onlyLive && !s.live) return false;
  if (f.onlyWithMessages && (s.history_count ?? 0) === 0 && !s.last_message) return false;
  if (f.projects.length > 0 && !f.projects.includes(s._project)) return false;
  const q = f.query.trim().toLowerCase();
  if (!q) return true;
  const hay = [s.name, s.user_name, s.chat_name, s.platform, s.agent_type, s.last_message?.content]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return hay.includes(q);
}

/** 展平 + 新到旧排序：列表永远比「按项目分组」更常用——人找的是最近聊过的那条。 */
export function flattenSessions(data: { project: string; sessions: Session[] }[]): FlatSession[] {
  return data
    .flatMap((d) => (d.sessions ?? []).map((s) => ({ ...s, _project: d.project })))
    .sort((a, b) => (b.updated_at || b.created_at || '').localeCompare(a.updated_at || a.created_at || ''));
}

export function filterSessions(list: FlatSession[], f: SessionFilters): FlatSession[] {
  return list.filter((s) => sessionMatches(s, f));
}

export interface ProjectFacet {
  key: string;
  label: string;
  count: number;
}

/** 项目筛选项：只列真的有会话的项目，按会话数降序，名字用展示名。 */
export function sessionProjectFacets(
  data: { project: string; sessions: Session[] }[],
  projects: ProjectSummary[]
): ProjectFacet[] {
  const byName = new Map(projects.map((p) => [p.name, shownName(p)]));
  return data
    .map((d) => ({ key: d.project, label: byName.get(d.project) || d.project, count: (d.sessions ?? []).length }))
    .filter((f) => f.count > 0)
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

export interface SessionTotals {
  sessions: number;
  live: number;
  projects: number;
}

export function sessionTotals(list: FlatSession[]): SessionTotals {
  const projects = new Set<string>();
  let live = 0;
  for (const s of list) {
    projects.add(s._project);
    if (s.live) live += 1;
  }
  return { sessions: list.length, live, projects: projects.size };
}

/** 相对时间：1 分钟内「刚刚」，然后是 m/h/d；超过一天就不必更精确。 */
export function relativeTime(iso: string, justNow: string): string {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return justNow;
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}