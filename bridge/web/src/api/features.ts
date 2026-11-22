import api from './client';

/** 功能开关 (#1861): one row of the bridge's feature switch registry (config/features.go). */
export interface FeatureState {
  /** config.toml path; a role's switch is relative to its [[projects]] block */
  key: string;
  scope: 'global' | 'project';
  name: string;
  name_en: string;
  desc: string;
  desc_en: string;
  /** the running bridge reads it only at start */
  restart: boolean;
  /** the config key means "off": on = the key is false */
  inverted?: boolean;
  project?: string;
  on: boolean;
  default: boolean;
  /** what the running bridge uses now */
  running: boolean;
  pending_restart: boolean;
}

export interface FeatureList {
  features: FeatureState[];
  lang: string;
  /** set on a save: this switch only acts after a restart */
  restart_required?: boolean;
  reload_error?: string;
}

export const getFeatures = () => api.get<FeatureList>('/features');

export const setFeature = (body: { project?: string; key: string; on: boolean }) =>
  api.post<FeatureList>('/features', body);
