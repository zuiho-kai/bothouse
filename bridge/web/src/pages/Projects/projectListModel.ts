import type { ProjectSummary } from '@/api/projects';
import { shownName } from '@/api/projects';

/** 两种视图读同一份筛选结果：切换视图不重新取数，也不重排滚动位置以外的状态。 */
export type ProjectView = 'grid' | 'list';

export interface ProjectFilters {
  query: string;
  agents: string[];
  onlyHeartbeat: boolean;
  onlyWithSessions: boolean;
}

export const emptyProjectFilters: ProjectFilters = {
  query: '',
  agents: [],
  onlyHeartbeat: false,
  onlyWithSessions: false,
};

export function projectMatches(p: ProjectSummary, f: ProjectFilters): boolean {
  if (f.onlyHeartbeat && !p.heartbeat_enabled) return false;
  if (f.onlyWithSessions && (p.sessions_count ?? 0) === 0) return false;
  if (f.agents.length > 0 && !f.agents.includes(p.agent_type)) return false;
  const q = f.query.trim().toLowerCase();
  if (!q) return true;
  const hay = [shownName(p), p.name, p.agent_type, ...(p.platforms ?? [])].join(' ').toLowerCase();
  return hay.includes(q);
}

export function filterProjects(list: ProjectSummary[], f: ProjectFilters): ProjectSummary[] {
  return list.filter((p) => projectMatches(p, f));
}

export interface AgentFacet {
  key: string;
  count: number;
}

/** 筛选项只列真实存在的 agent 类型，按数量降序；0 项的按钮不出现，免得点了个空列表。 */
export function agentFacets(list: ProjectSummary[]): AgentFacet[] {
  const counts = new Map<string, number>();
  for (const p of list) counts.set(p.agent_type, (counts.get(p.agent_type) ?? 0) + 1);
  return [...counts.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}

export interface ProjectTotals {
  projects: number;
  sessions: number;
  heartbeat: number;
  platforms: number;
}

export function projectTotals(list: ProjectSummary[]): ProjectTotals {
  let sessions = 0;
  let heartbeat = 0;
  const platforms = new Set<string>();
  for (const p of list) {
    sessions += p.sessions_count ?? 0;
    if (p.heartbeat_enabled) heartbeat += 1;
    for (const pl of p.platforms ?? []) platforms.add(pl);
  }
  return { projects: list.length, sessions, heartbeat, platforms: platforms.size };
}

/** 名字首字母牌：中文取首字，拉丁取首字母大写；空名回落 #，只是占位不是数据。 */
export function monogram(name: string): string {
  const s = (name || '').trim();
  return s ? s.charAt(0).toUpperCase() : '#';
}

/** 批量条上的一句汇总，读起来像人话：全部、还是筛过的一部分。 */
export function selectionSummary(selectedCount: number, total: number): 'all' | 'some' | 'none' {
  if (selectedCount === 0) return 'none';
  return selectedCount === total ? 'all' : 'some';
}
