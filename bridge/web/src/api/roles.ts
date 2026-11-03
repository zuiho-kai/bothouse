import api from './client';

export interface PlatformStatus {
  name: string;
  ready: boolean;
}

export interface RoleQuotaWindow {
  name: string;
  label?: string;
  used_percent: number;
  remaining_percent: number;
  window_seconds?: number;
  reset_after_seconds?: number;
}

export interface RoleQuota {
  windows?: RoleQuotaWindow[];
}

export interface RoleInfo {
  name: string;
  /** the name people see: team_name (e.g. 橘), else the project name */
  display_name?: string;
  agent_type: string;
  model: string;
  online: boolean;
  busy: boolean;
  current_task: string;
  paused: boolean;
  platforms: PlatformStatus[];
  sessions_count: number;
  quota?: RoleQuota;
}

export async function listRoles(): Promise<{ roles: RoleInfo[] }> {
  return api.get<{ roles: RoleInfo[] }>('/roles');
}

export async function restartRole(name: string): Promise<{ role: string; status: string; message: string }> {
  return api.post(`/roles/${name}/restart`);
}

export async function setRolePaused(name: string, paused: boolean): Promise<{ role: string; paused: boolean; message: string }> {
  return api.post(`/roles/${name}/pause`, { paused });
}
