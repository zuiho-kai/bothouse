import api from './client';

export interface LocalCLI {
  agent_type: string; label: string; binary: string; path: string; version?: string;
  login: 'logged_in' | 'not_logged_in' | 'unknown'; protocol: string; supported: boolean; note?: string;
}
export interface WizardVendor {
  id: string; label: string; openai_base: string; endpoints: Record<string, string>;
  model?: string; signup_url?: string; source: string;
}
export interface MatrixCell { vendor: string; agent_type: string; mode: 'native' | 'convert'; base_url: string }
export interface PersonaPreset { id: string; name: string; model: string; new?: boolean; text: string }
export interface DiscordGuild { id: string; name: string }
export interface DiscordChannel { id: string; name: string; type: number; position: number }
export interface DiscordBotInfo {
  bot_id: string; username: string; application_id: string; message_content_intent: boolean;
  guilds: DiscordGuild[]; invite_url: string;
}
export interface ExistingBot { project: string; agent_type: string; work_dir?: string; bot_id?: string; guild_id?: string; username?: string; error?: string }
export interface JevTest { reachable: boolean; logprobs: boolean; latency_ms: number; error?: string }
export interface SetupStateResp {
  system_language: string; hardware: boolean; data_dir: string; has_projects: boolean; projects?: string[];
  setup: { platform?: string; guild_id?: string; channel_id?: string; fallback_role?: string; team?: { project: string; name: string }[] };
  jev?: { url: string; model: string; has_key: boolean; logprobs: boolean };
  jev_hint: string;
}

export interface WizardRole {
  project?: string; name?: string; token?: string; reuse_project?: string; agent_type?: string;
  work_dir?: string; persona?: string; edit_persona?: boolean; reply_language?: string;
  provider?: { vendor: string; base_url?: string; api_key?: string; model?: string };
}
export interface WizardRequest {
  platform: 'discord' | 'feishu' | 'lark'; language?: string;
  discord?: { guild_id: string; channel_id: string };
  feishu?: { app_id: string; app_secret: string; platform_type?: string; owner_open_id?: string; chat_id?: string };
  roles: WizardRole[]; fallback_role?: string; fallback_bot_id?: string;
  jev?: { base_url: string; api_key?: string; model: string; remove?: boolean };
  dry_run?: boolean;
}
export interface WizardResult {
  ok: boolean; dry_run: boolean; error?: string;
  steps: { step: string; ok: boolean; detail?: string }[];
  roles: { project: string; name: string; agent_type: string; work_dir: string; persona_file: string; bot_id?: string;
    invite_url?: string; in_guild?: boolean; provider?: string; provider_via?: string; fallback: boolean; reused: boolean; persona_written: boolean }[];
  fallback_role?: string; jev_test?: JevTest; jev_ok: boolean; jev_reason?: string; jev_in_use?: string; jev_hint: string; hardware: boolean; restart_required: boolean; config_backup?: string;
}

export const getSetupState = (lang: string, fallbackName = '') => api.get<SetupStateResp>('/setup/state', { lang, fallback_name: fallbackName });
export const getCLIs = () => api.get<{ clis: LocalCLI[] }>('/setup/clis');
export const getMatrix = () => api.get<{ vendors: WizardVendor[]; agents: string[]; matrix: MatrixCell[] }>('/setup/matrix');
export const getPersonas = (lang: string) => api.get<{ language: string; presets: PersonaPreset[] }>('/setup/personas', { lang });
export const getExistingBots = () => api.get<{ bots: ExistingBot[] }>('/setup/discord/bots');
export const checkDiscord = (body: { token?: string; reuse_project?: string }) => api.post<DiscordBotInfo>('/setup/discord/check', body);
export const listChannels = (body: { token?: string; reuse_project?: string; guild_id: string }) =>
  api.post<{ channels: DiscordChannel[] }>('/setup/discord/channels', body);
export const listFeishuChats = (body: { app_id: string; app_secret: string; platform_type?: string }) =>
  api.post<{ chats: { chat_id: string; name: string }[] }>('/setup/feishu/chats', body);
export const testJev = (body: { base_url: string; api_key?: string; model: string; lang: string; fallback_name: string }) =>
  api.post<{ test: JevTest; usable: boolean; reason?: string; in_use?: string; hint: string }>('/setup/jev/test', body);
export const saveJev = (body: { base_url: string; api_key?: string; model: string; remove?: boolean; lang: string; fallback_name: string }) =>
  api.post<{ saved: boolean; cleared: boolean; reason?: string; in_use?: string; test?: JevTest; hint: string }>('/setup/jev/save', body);
export const getSetupPersona = (agentType: string, workDir: string) =>
  api.get<{ path: string; exists: boolean; content: string }>('/setup/persona', { agent_type: agentType, work_dir: workDir });
export const getProjectPersona = (project: string) =>
  api.get<{ path: string; exists: boolean; content: string }>(`/projects/${encodeURIComponent(project)}/persona`);
export const saveProjectPersona = (project: string, content: string) =>
  api.put<{ path: string; saved: boolean }>(`/projects/${encodeURIComponent(project)}/persona`, { content });

/** POST /setup/apply returns ok:false with the result in data; keep the result either way. */
export async function applyWizard(req: WizardRequest): Promise<WizardResult> {
  const res = await fetch('/api/v1/setup/apply', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(api.getToken() ? { Authorization: `Bearer ${api.getToken()}` } : {}) },
    body: JSON.stringify(req),
  });
  const json = await res.json();
  if (json.data) return json.data as WizardResult;
  throw new Error(json.error || `HTTP ${res.status}`);
}
