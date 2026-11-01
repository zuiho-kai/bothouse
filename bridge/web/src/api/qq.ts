import api from './client';

export interface QQSettings {
  ws_url: string; http_url: string; token_set: boolean; allow_from: string; share_session_in_channel: boolean;
}
export interface QQSettingsResponse {
  configured: boolean; settings: QQSettings;
  capabilities: { key: string; available: boolean; reason: string }[];
}
export type QQSettingsUpdate = Omit<QQSettings, 'token_set' | 'allow_from'> & { token?: string };
const endpoint = (project: string) => `/projects/${encodeURIComponent(project)}/qq/settings`;
export const getQQSettings = (project: string) => api.get<QQSettingsResponse>(endpoint(project));
export const saveQQSettings = (project: string, body: QQSettingsUpdate) =>
  api.patch<{ changed: string[]; restart_required: boolean; settings?: QQSettings }>(endpoint(project), body);
