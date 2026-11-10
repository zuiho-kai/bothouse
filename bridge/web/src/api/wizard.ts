import api from './client';
import { withBase } from '@/lib/basePath';

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
  bot_id: string; username: string; application_id: string; message_content_intent: boolean; intent_known?: boolean;
  owner_id?: string; guilds: DiscordGuild[]; invite_url: string;
}
export interface ExistingBot { project: string; agent_type: string; work_dir?: string; bot_id?: string; guild_id?: string; username?: string; error?: string }
export interface JevTest { reachable: boolean; logprobs: boolean; latency_ms: number; error?: string }
export interface SetupStateResp {
  system_language: string; hardware: boolean; data_dir: string; has_projects: boolean; gate_enabled?: boolean; gate_modes?: Record<string, 'smart' | 'addressed' | 'off'>; projects?: string[]; project_display_names?: string[];
  /** platform types already in config.toml (lark counts as feishu) */
  configured_platforms?: Record<string, boolean>;
  setup: { platform?: string; guild_id?: string; channel_id?: string; fallback_role?: string; team?: { project: string; name: string }[];
    cloud_web_url?: string; cloud_web_fallback?: string; cloud_web_team?: { project: string; name: string }[] };
  jev?: { url: string; model: string; has_key: boolean; logprobs: boolean };
  jev_hint: string;
  /** the memory wiki (core/setup_wiki.go); absent = no ~/wiki/bin/ingest.py on this machine */
  wiki?: { dir: string; engines: WikiEngine[]; defaults: WizardWiki; current: WizardWiki };
  /** bothouse's memory / guard hooks are in the user's own Claude Code settings (core/global_hooks.go) */
  global_memory?: boolean; global_guards?: boolean;
}
export interface WikiEngine { id: string; label: string; agent_type: string }
/** model of each kind of wiki work; omitted = keep */
export interface WizardWiki { daily?: string; night?: string; split?: string }

export interface WizardRole {
  name_customized?: boolean; keep_persona_name?: boolean; project?: string; name?: string; token?: string; reuse_project?: string; agent_type?: string;
  work_dir?: string; persona?: string; edit_persona?: boolean; reply_language?: string;
  provider?: { vendor: string; base_url?: string; api_key?: string; model?: string };
  /** library persona slug / avatar slug; omitted = keep what setup state has, "" = clear */
  persona_preset?: string; avatar?: string;
}
export interface WizardRequest {
  platform: 'discord' | 'feishu' | 'lark' | 'cloud_web' | 'qq'; language?: string;
  discord?: { guild_id: string; channel_id: string };
  feishu?: { app_id: string; app_secret: string; platform_type?: string; owner_open_id?: string; chat_id?: string };
  /** 自建平台: empty url/token = the hub this wizard started on this machine (filled in server-side) */
  cloud_web?: { url?: string; token?: string };
  /** QQ: NapCat / OneBot forward WebSocket; allow_from = QQ numbers that may give orders (or *).
   * http_url = file sending, optional; share_session_in_channel is only sent when ticked, so a
   * rerun leaves an existing value as it is (#710 件 5). */
  qq?: { ws_url: string; token?: string; clear_token?: boolean; allow_from: string; http_url?: string; share_session_in_channel?: boolean };
  roles: WizardRole[]; fallback_role?: string; fallback_bot_id?: string;
  jev?: { base_url: string; api_key?: string; model: string; remove?: boolean };
  gate?: { enabled: boolean; mode?: 'smart' | 'addressed' };
  allow_from?: string;
  wiki?: WizardWiki;
  /** also install the memory / guard hooks into ~/.claude (terminal Claude Code); omitted = keep */
  global_memory?: boolean; global_guards?: boolean;
  /** a team: every person who joins gets a personal directory and their own GitHub authorization (core/member_workspace.go) */
  member_workspaces?: boolean;
  dry_run?: boolean;
  append_only?: boolean; // the panel's add-role entry: only new roles, a taken name is refused
}
export interface WizardWarning { code: string; project?: string; blocking: boolean; message: string; fix: string; url?: string }
export interface WizardResult {
  ok: boolean; dry_run: boolean; error?: string;
  saved?: boolean; needs_user_action?: boolean; warnings?: WizardWarning[]; invite_urls?: string[]; allow_from?: string;
  gate_running?: boolean; gate_status?: 'off' | 'running' | 'starting' | 'python_missing' | 'python_too_old' | 'jev_missing';
  gate_hint?: string; next_steps?: string[];
  steps: { step: string; ok: boolean; detail?: string }[];
  roles: { project: string; name: string; agent_type: string; work_dir: string; persona_file: string; bot_id?: string;
    invite_url?: string; in_guild?: boolean; provider?: string; provider_via?: string; fallback: boolean; reused: boolean; persona_written: boolean;
    reply_language?: string; reply_language_name?: string; reply_language_from?: string }[];
  cloud_web?: CloudWebTest;
  qq?: { code: string; message: string; fix?: string; user_id?: string; nickname?: string };
  fallback_role?: string; jev_test?: JevTest; jev_ok: boolean; jev_reason?: string; jev_in_use?: string; jev_hint: string; hardware: boolean; restart_required: boolean; config_backup?: string;
  // the running service started the roles this save added: projects_added are online, projects_failed says why one is not
  // projects_removed: failed roles taken back out of config.toml; restart_keys / reload_error: why the running roles still need a restart
  hot_load?: { projects_added: string[]; projects_failed?: Record<string, string>; hot_load_error?: string; projects_removed?: string[]; rollback_error?: string; restart_keys?: string[]; reload_error?: string };
}

/** The self-hosted platform on this machine (core/setup_cloudweb.go LocalHubStatus). */
export interface LocalHubStatus {
  running: boolean; url?: string; managed: boolean; token_known: boolean; open_url?: string;
  can_start: boolean; missing?: 'uv' | 'source'; hint?: string; log_file?: string;
}
/** code: ok | unauthorized | unreachable | not_found | bad_url | error */
export interface CloudWebTest { ok: boolean; code: string; status?: number; message?: string; fix?: string; page_url?: string }
export const getLocalHub = (lang: string) => api.get<LocalHubStatus>('/setup/cloudweb/local', { lang });
export const startLocalHub = (lang: string) => api.post<LocalHubStatus>('/setup/cloudweb/start', { lang });
export const testCloudWeb = (body: { url: string; token: string; lang: string }) => api.post<CloudWebTest>('/setup/cloudweb/test', body);

export const getSetupState = (lang: string, fallbackName = '') => api.get<SetupStateResp>('/setup/state', { lang, fallback_name: fallbackName });
export const getCLIs = () => api.get<{ clis: LocalCLI[] }>('/setup/clis');
export const getMatrix = () => api.get<{ vendors: WizardVendor[]; agents: string[]; matrix: MatrixCell[] }>('/setup/matrix');
export const getPersonas = (lang: string) => api.get<{ language: string; presets: PersonaPreset[] }>('/setup/personas', { lang });
export const getExistingBots = () => api.get<{ bots: ExistingBot[] }>('/setup/discord/bots');
export const checkDiscord = (body: { token?: string; reuse_project?: string; lang?: string }) => api.post<DiscordBotInfo>('/setup/discord/check', body);
export const listChannels = (body: { token?: string; reuse_project?: string; guild_id: string }) =>
  api.post<{ channels: DiscordChannel[] }>('/setup/discord/channels', body);
export const listFeishuChats = (body: { app_id: string; app_secret: string; platform_type?: string }) =>
  api.post<{ chats: { chat_id: string; name: string }[] }>('/setup/feishu/chats', body);
export const testJev = (body: { base_url: string; api_key?: string; model: string; lang: string; fallback_name: string }) =>
  api.post<{ test: JevTest; usable: boolean; reason?: string; in_use?: string; hint: string }>('/setup/jev/test', body);
export const saveJev = (body: { base_url: string; api_key?: string; model: string; remove?: boolean; lang: string; fallback_name: string }) =>
  api.post<{ saved: boolean; cleared: boolean; reason?: string; in_use?: string; test?: JevTest; hint: string }>('/setup/jev/save', body);
export interface SetupPersona { path: string; exists: boolean; content: string; reply_language?: string; reply_language_line?: string }
export const getSetupPersona = (agentType: string, workDir: string) =>
  api.get<SetupPersona>('/setup/persona', { agent_type: agentType, work_dir: workDir });
export const getProjectPersona = (project: string) =>
  api.get<{ path: string; exists: boolean; content: string }>(`/projects/${encodeURIComponent(project)}/persona`);
export const saveProjectPersona = (project: string, content: string) =>
  api.put<{ path: string; saved: boolean }>(`/projects/${encodeURIComponent(project)}/persona`, { content });

/** POST /setup/apply returns ok:false with the result in data; keep the result either way. */
export async function applyWizard(req: WizardRequest): Promise<WizardResult> {
  const res = await fetch(withBase('/api/v1/setup/apply'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(api.getToken() ? { Authorization: `Bearer ${api.getToken()}` } : {}) },
    body: JSON.stringify(req),
  });
  const json = await res.json();
  if (json.data) return json.data as WizardResult;
  throw new Error(json.error || `HTTP ${res.status}`);
}

export interface DSHStatus {
  found: boolean; version?: string; plugin_installed: boolean; profile: string;
  open_command: string; log?: string; has_deepseek_key?: boolean;
  node_version?: string; pnpm_found?: boolean; dependency_error?: string;
  /** DeepSeek Harness Desktop (core/setup_dsh_desktop.go): the wizard's default route. */
  desktop_app?: string; desktop_profile_ready?: boolean; desktop_plugin_installed?: boolean;
  desktop_running?: boolean; desktop_download_url?: string; node_from_desktop?: boolean;
}
/** Where the roles live: the DeepSeek Harness Desktop window, or the DSH web page in a browser tab. */
export type DSHTarget = 'desktop' | 'web';
export const getDSHStatus = (lang = 'en') => api.get<DSHStatus>('/setup/dsh/status?lang=' + encodeURIComponent(lang));

/** One line of the POST /setup/dsh/install NDJSON stream (core/setup_dsh_platform.go handleSetupDSHInstall). */
export interface DSHInstallEvent { step?: string; line?: string; done?: boolean; status?: DSHStatus; error?: string; log?: string }

/** Runs the plugin install, calling onEvent per streamed line; resolves with the final status or throws the readable error. */
export async function installDSHPlugin(lang: string, onEvent: (e: DSHInstallEvent) => void, target: DSHTarget = 'web'): Promise<DSHStatus> {
  const res = await fetch(withBase('/api/v1/setup/dsh/install'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(api.getToken() ? { Authorization: `Bearer ${api.getToken()}` } : {}) },
    body: JSON.stringify({ lang, target }),
  });
  if (!res.ok || !res.body) {
    const text = await res.text();
    let msg = text;
    try { msg = JSON.parse(text).error || text; } catch { /* plain-text body */ }
    throw new Error(msg || `HTTP ${res.status}`);
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    buf += dec.decode(value, { stream: !done });
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line) continue;
      const ev = JSON.parse(line) as DSHInstallEvent;
      onEvent(ev);
      if (ev.error) throw Object.assign(new Error(ev.error), { log: ev.log });
      if (ev.done && ev.status) return ev.status;
    }
    if (done) throw new Error('install stream ended without a result');
  }
}

export interface DSHMember { name: string; cli?: 'claude' | 'codex' | 'gemini'; persona?: string; name_customized?: boolean }
export const configureDSH = (body: { deepseek_api_key?: string; members: DSHMember[] }) =>
  api.post<{ key_saved: boolean; members_file: string; members: number }>('/setup/dsh/configure', body);
/** Opens (restarting when it must load new plugins or roles) DeepSeek Harness Desktop. */
export const openDSHDesktop = (lang = 'en', restart = false) => api.post<{ app: string; pid?: number; restarted: boolean }>('/setup/dsh/open-desktop', { lang, restart });
export const openDSHWeb = () => api.post<{ url: string; pid: number; log: string; starting?: boolean; elapsed_sec?: number; log_tail?: string }>('/setup/dsh/open', {});
