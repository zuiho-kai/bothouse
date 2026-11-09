import api from './client';

export interface QQSettings {
  ws_url: string; http_url: string; token_set: boolean; allow_from: string; share_session_in_channel: boolean;
  split_bubbles: boolean; allow_groups_with: string; command_allow_from: string; save_images_dir: string;
  allow_qzone: boolean; allow_avatar: boolean;
}
export interface QQSettingsResponse {
  configured: boolean; settings: QQSettings;
}
export type QQSettingsUpdate = Omit<QQSettings, 'token_set' | 'allow_from'> & { token?: string };
const endpoint = (project: string) => `/projects/${encodeURIComponent(project)}/qq/settings`;
export const getQQSettings = (project: string) => api.get<QQSettingsResponse>(endpoint(project));
export const saveQQSettings = (project: string, body: QQSettingsUpdate) =>
  api.patch<{ changed: string[]; restart_required: boolean; settings?: QQSettings }>(endpoint(project), body);
