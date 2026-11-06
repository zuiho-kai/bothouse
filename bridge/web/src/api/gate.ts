import api from './client';

/** 闸门设置页 (#217): 装好以后也能改谁在什么时候接话，以及判断用的模型 API。 */
export type GateMode = 'smart' | 'addressed' | 'off';

export interface GateBot {
  project: string;
  /** the name the owner gave this role (team_name) */
  name: string;
  mode: GateMode;
  /** the gate is consulted for this role at all */
  enabled: boolean;
  gate_url: string;
  gate_fallback: string;
  platforms: string[];
  /** hears messages that name no one (the platform lets them through) */
  listens: boolean;
  /** a gate_url written by hand, not by this product: 关 leaves it alone */
  custom_gate: boolean;
  note?: string;
}

export interface GateStatus {
  /** running | starting | python_missing | python_too_old | off */
  status: string;
  running: boolean;
  managed: boolean;
  wanted: boolean;
  addr: string;
  url: string;
  hint: string;
}

export interface GateJev {
  url: string;
  model: string;
  has_key: boolean;
}

export interface GateSettings {
  gate: GateStatus;
  jev?: GateJev;
  jev_hint: string;
  /** the three big buttons' current choice; '' when the roles disagree */
  mode: GateMode | '';
  bots: GateBot[];
  lead: string;
  lang: string;
}

export interface GateSaveResult {
  saved: boolean;
  backup?: string;
  mode: GateMode;
  mode_current: GateMode | '';
  bots: GateBot[];
  gate: GateStatus;
  notes?: string[];
  /** option keys that only take effect after a restart (cloud_web's group_reply_all) */
  restart_keys?: string[];
  reload_error?: string;
}

export interface GateStartResult {
  running: boolean;
  started: boolean;
  /** python_missing | python_too_old | not_managed | starting */
  reason?: string;
}

export const getGateSettings = (lang: string) => api.get<GateSettings>('/setup/gate', { lang });

export const saveGate = (body: { mode: GateMode; bots: Record<string, boolean>; lang: string }) =>
  api.post<GateSaveResult>('/setup/gate/save', body);

export const startGate = (lang: string) =>
  api.post<GateStartResult>(`/setup/gate/start?lang=${encodeURIComponent(lang)}`);
