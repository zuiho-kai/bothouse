import api from './client';

export interface UpdateInfo {
  current: string;
  latest: string;
  has_update: boolean;
  dev: boolean;
  download_url: string;
  error: string;
  // Set after a guarded update that did not stick (core/update_guard.go).
  last_result?: { status: 'rolled_back' | 'rollback_failed'; from: string; to: string; detail?: string };
}

export type UpdateFailReason = 'permission' | 'download' | 'checksum' | 'restart' | 'other';

export interface UpdateApplyResult {
  status: 'restarting' | 'failed' | 'up_to_date';
  version?: string;
  error?: string;
  reason?: UpdateFailReason;
  download_url?: string;
}

export const getUpdate = () => api.get<UpdateInfo>('/update');
// Local state only (rollback note), no GitHub check: used while polling during a restart.
export const getUpdateLocal = () => api.get<UpdateInfo>('/update', { local: '1' });
export const applyUpdate = () => api.post<UpdateApplyResult>('/update/apply');
export const ackUpdate = () => api.post<{ status: string }>('/update/ack');
