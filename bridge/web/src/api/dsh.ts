import api from './client';
import type { RoleInfo } from './roles';

/** One DSH channel (chat, workspace or private chat), shown as a session. */
export interface DSHChannel {
  id: string;
  name: string;
  kind: string;
  /** RFC3339 of the last message; empty when the channel has none */
  updated_at: string;
  error?: string;
  last_message: { role: string; name: string; content: string; timestamp: string } | null;
}

/** GET /dsh/summary (bridge/core/management_roles_dsh.go): DSH's own members and channels. */
export interface DSHSummary {
  status?: 'running' | 'stopped' | 'error';
  error?: string;
  running: boolean;
  members: RoleInfo[];
  channels: DSHChannel[];
}

export const getDSHSummary = () => api.get<DSHSummary>('/dsh/summary');

export type DSHCli = 'codex' | 'claude' | 'gemini';
export interface DSHManagedMember {
  id: string; name: string; source: 'ui' | 'config' | 'external';
  can_edit: boolean; can_delete: boolean; persona: string; cli: DSHCli | null;
  model: { provider: string; model: string } | null;
  cliConfig: { model?: string; reasoningEffort?: string } | null;
  apply: { timing: 'next_turn'; status: 'pending' | 'applied' | 'failed' | 'not_configured'; error?: string };
}
export interface DSHMemberInput {
  name?: string; persona?: string; cli?: DSHCli | null;
  model?: { provider: string; model: string } | null;
  cliConfig?: { model?: string | null; reasoningEffort?: string | null } | null;
}
export interface DSHModelRoute { provider: string; name: string; models: { id: string; name: string }[]; error?: string }
export interface DSHCliOptions {
  supported: boolean;
  model: { current: string | null; options: { value: string; name: string }[] } | null;
  reasoningEffort: { current: string | null; options: { value: string; name: string }[] } | null;
  error?: string;
}
export const listDSHMembers = () => api.get<{ members: DSHManagedMember[] }>('/dsh/members');
export const createDSHMember = (body: DSHMemberInput) => api.post<{ member: DSHManagedMember }>('/dsh/members', body);
export const updateDSHMember = (id: string, body: DSHMemberInput) => api.patch<{ member: DSHManagedMember }>(`/dsh/members/${encodeURIComponent(id)}`, body);
export const deleteDSHMember = (id: string) => api.delete<{ id: string }>(`/dsh/members/${encodeURIComponent(id)}`);
export const getDSHModelRoutes = () => api.get<{ routes: DSHModelRoute[] }>('/dsh/model-routes');
export const getDSHCliOptions = (body: { cli: 'codex'; memberId?: string; model?: string }) => api.post<DSHCliOptions>('/dsh/cli-options', body);

export function dshStatus(dsh: DSHSummary): 'running' | 'stopped' | 'error' {
  return dsh.status ?? (dsh.running ? 'running' : 'stopped');
}

export function connectedSources(platforms: string[], dsh: DSHSummary | null): string[] {
  const names = [...platforms];
  if (dsh && dshStatus(dsh) === 'running') names.push('dsh');
  return names.filter((name, index) => names.findIndex((other) => other.toLowerCase() === name.toLowerCase()) === index);
}
