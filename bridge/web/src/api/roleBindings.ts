import api from './client';

export interface RolePluginBinding {
  plugin_id: string;
  enabled: boolean;
  avatar_pack?: string;
}

export type RoleBindings = Record<string, RolePluginBinding[]>;

export const getRoleBindings = () => api.get<{ bindings: RoleBindings }>('/plugins/role-bindings');
export const saveRoleBindings = (bindings: RoleBindings) =>
  api.put<{ bindings: RoleBindings }>('/plugins/role-bindings', { bindings });
