import api from './client';

export interface SkillInfo {
  name: string;
  display_name?: string;
  description?: string;
  source: string;
  global?: boolean;
}

export interface ManagedSkill {
  name: string;
  description?: string;
  owner?: string;
  learned?: boolean;
  version: number;
  enabled?: Record<string, boolean>;
  uses?: Record<string, number>;
  body?: string;
}

export interface ProjectSkills {
  project: string;
  agent_type: string;
  dirs: string[];
  skills: SkillInfo[];
}

export interface SkillSource {
  provider: string;
  name?: string;
  url?: string;
}

export interface SkillPricing {
  type: 'free' | 'paid' | 'freemium';
  price?: number;
  currency?: string;
}

export interface SkillPreset {
  name: string;
  display_name: string;
  description?: string;
  description_zh?: string;
  version?: string;
  author?: string;
  url?: string;
  install_url?: string;
  agent_types?: string[];
  tags?: string[];
  featured?: boolean;
  source?: SkillSource;
  pricing?: SkillPricing;
}

export interface SkillPresetsResponse {
  version: number;
  updated_at?: string;
  skills: SkillPreset[];
}

export const listSkills = () =>
  api.get<{ projects: ProjectSkills[]; managed_skills: ManagedSkill[]; pending_skills: ManagedSkill[] }>('/skills');

export const fetchSkillPresets = () =>
  api.get<SkillPresetsResponse>('/skills/presets');

export const getManagedSkill = (name: string) => api.get<ManagedSkill>(`/skills/managed/${encodeURIComponent(name)}`);
export const editManagedSkill = (name: string, body: string) => api.put(`/skills/managed/${encodeURIComponent(name)}`, { body });
export const deleteManagedSkill = (name: string) => api.delete(`/skills/managed/${encodeURIComponent(name)}`);
export const setManagedSkillEnabled = (name: string, project: string, enabled: boolean) =>
  api.put(`/skills/managed/${encodeURIComponent(name)}/enabled`, { project, enabled });
export const approveManagedSkill = (name: string, project: string) =>
  api.post(`/skills/managed/${encodeURIComponent(name)}/approve`, { project });
export const installSkillPreset = (name: string, project: string) => api.post('/skills/install', { name, project });
