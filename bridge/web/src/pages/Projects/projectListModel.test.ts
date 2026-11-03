import { describe, expect, it } from 'vitest';
import type { ProjectSummary } from '@/api/projects';
import {
  agentFacets,
  emptyProjectFilters,
  filterProjects,
  monogram,
  projectMatches,
  projectTotals,
  selectionSummary,
} from './projectListModel';

const project = (over: Partial<ProjectSummary> = {}): ProjectSummary => ({
  name: 'coder',
  display_name: 'Codex',
  agent_type: 'codex',
  platforms: ['telegram'],
  sessions_count: 2,
  heartbeat_enabled: false,
  ...over,
});

describe('projectListModel', () => {
  it('matches on display name, project name, agent and platform', () => {
    const p = project();
    expect(projectMatches(p, { ...emptyProjectFilters, query: 'codex' })).toBe(true);
    expect(projectMatches(p, { ...emptyProjectFilters, query: 'coder' })).toBe(true);
    expect(projectMatches(p, { ...emptyProjectFilters, query: 'telegram' })).toBe(true);
    expect(projectMatches(p, { ...emptyProjectFilters, query: 'nope' })).toBe(false);
  });

  it('treats the query as trimmed and case insensitive', () => {
    expect(projectMatches(project(), { ...emptyProjectFilters, query: '  CoDeX  ' })).toBe(true);
  });

  it('ANDs every active filter instead of ORing them', () => {
    const heartbeat = project({ name: 'hb', display_name: 'hb', heartbeat_enabled: true, sessions_count: 0 });
    const plain = project({ name: 'plain', display_name: 'plain', sessions_count: 5 });

    expect(filterProjects([heartbeat, plain], { ...emptyProjectFilters, onlyHeartbeat: true })).toEqual([heartbeat]);
    expect(filterProjects([heartbeat, plain], { ...emptyProjectFilters, onlyWithSessions: true })).toEqual([plain]);
    expect(
      filterProjects([heartbeat, plain], { ...emptyProjectFilters, onlyHeartbeat: true, onlyWithSessions: true })
    ).toEqual([]);
  });

  it('filters by agent type only when at least one chip is on', () => {
    const codex = project({ name: 'a', agent_type: 'codex' });
    const claude = project({ name: 'b', agent_type: 'claudecode' });
    const list = [codex, claude];

    expect(filterProjects(list, emptyProjectFilters)).toHaveLength(2);
    expect(filterProjects(list, { ...emptyProjectFilters, agents: ['codex'] })).toEqual([codex]);
    expect(filterProjects(list, { ...emptyProjectFilters, agents: ['codex', 'claudecode'] })).toEqual(list);
  });

  it('counts agent facets and puts the biggest group first', () => {
    const facets = agentFacets([
      project({ name: 'a', agent_type: 'codex' }),
      project({ name: 'b', agent_type: 'codex' }),
      project({ name: 'c', agent_type: 'claudecode' }),
    ]);
    expect(facets).toEqual([
      { key: 'codex', count: 2 },
      { key: 'claudecode', count: 1 },
    ]);
  });

  it('sums sessions and counts distinct platforms', () => {
    const totals = projectTotals([
      project({ name: 'a', sessions_count: 3, heartbeat_enabled: true, platforms: ['telegram', 'discord'] }),
      project({ name: 'b', sessions_count: 4, platforms: ['discord'] }),
    ]);
    expect(totals).toEqual({ projects: 2, sessions: 7, heartbeat: 1, platforms: 2 });
  });

  it('falls back to # for a nameless project instead of rendering undefined', () => {
    expect(monogram('')).toBe('#');
    expect(monogram('  ')).toBe('#');
    expect(monogram('codex')).toBe('C');
    expect(monogram('肥鱼')).toBe('肥');
  });

  it('reports a whole-list selection apart from a partial one', () => {
    expect(selectionSummary(0, 5)).toBe('none');
    expect(selectionSummary(2, 5)).toBe('some');
    expect(selectionSummary(5, 5)).toBe('all');
  });
});
