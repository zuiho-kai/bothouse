import api from './client';

/** Official QQ Bot (platform type "qqbot"). Neither credential is ever returned:
 *  app_id_set / app_secret_set only say whether one is stored (#710 件 5). */
export interface QQBotSettings {
  app_id_set: boolean;
  app_secret_set: boolean;
  sandbox: boolean;
  allow_from: string;
  share_session_in_channel: boolean;
  markdown_support: boolean;
}
export interface QQBotSettingsResponse {
  configured: boolean;
  settings: QQBotSettings;
}
/** app_secret is write-only: leaving it out (or sending "") keeps the stored one. */
export interface QQBotSettingsUpdate {
  app_secret?: string;
  sandbox?: boolean;
  share_session_in_channel?: boolean;
  markdown_support?: boolean;
}
const endpoint = (project: string) => `/projects/${encodeURIComponent(project)}/qqbot/settings`;
export const getQQBotSettings = (project: string) => api.get<QQBotSettingsResponse>(endpoint(project));
export const saveQQBotSettings = (project: string, body: QQBotSettingsUpdate) =>
  api.patch<{ changed: string[]; restart_required: boolean; settings?: QQBotSettings }>(endpoint(project), body);