import api from './client';

export interface TeamRemoteSettings {
  enabled: boolean;
  remote_host: string;
  relay_host: string;
  work_dir: string;
  ssh_args?: string[];
  projects?: string[];
}

export interface GlobalSettings {
  team_remote?: TeamRemoteSettings;
  team_remote_projects?: { name: string; display_name: string }[];
  language: string;
  attachment_send: string;
  log_level: string;
  idle_timeout_mins: number;
  thinking_messages: boolean;
  thinking_max_len: number;
  tool_messages: boolean;
  tool_max_len: number;
  stream_preview_enabled: boolean;
  stream_preview_interval_ms: number;
  rate_limit_max_messages: number;
  rate_limit_window_secs: number;
  /** role (project name) that verifies simple handbacks; "" = no preference */
  review_simple_role?: string;
  /** role that verifies handbacks escalated with board tier <id> complex */
  review_complex_role?: string;
  /** model ID (from the simple role's list) the simple review runs on; "" = the role's own */
  review_simple_model?: string;
  /** model ID the complex review runs on; "" = the role's own */
  review_complex_model?: string;
  /** read-only: the latest review whose tier model did not take effect (backend lacks it) */
  review_model_notice?: ReviewModelNotice;
  /** built-in role avatar set: 'brand' (vendors' own icons, default) or 'chibi' (Q-style set) */
  avatar_style?: 'brand' | 'chibi';
}

export interface ReviewModelNotice {
  at: string;
  board: number;
  tier: 'simple' | 'complex';
  role: string;
  model: string;
  reason: string;
}

export const getGlobalSettings = () => api.get<GlobalSettings>('/settings');
export const updateGlobalSettings = (body: Partial<Omit<GlobalSettings, 'team_remote_projects'>>) => api.patch<GlobalSettings>('/settings', body);
