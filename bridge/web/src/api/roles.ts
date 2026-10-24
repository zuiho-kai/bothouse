import api from './client';

export interface RoleInfo {
  name: string;
  agent_type: string;
  model: string;
  online: boolean;
  busy: boolean;
  current_task: string;
  paused: boolean;
  platforms: string[];
  sessions_count: number;
}

export async function listRoles(): Promise<{ roles: RoleInfo[] }> {
  return api.get<{ roles: RoleInfo[] }>('/roles');
}

export async function restartRole(name: string): Promise<{ role: string; status: string; message: string }> {
  return api.post(`/roles/${name}/restart`);
}

export async function togglePauseRole(name: string): Promise<{ role: string; paused: boolean; message: string }> {
  return api.post(`/roles/${name}/pause`);
}
