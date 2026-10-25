import api from './client';

/**
 * supervisor: self = the bothouse service runs this panel (switch works);
 * external = another service entry runs it (managed outside, switch disabled);
 * none = not running as a service (switch disabled).
 */
export interface AutostartState {
  supervisor: 'self' | 'external' | 'none';
  enabled: boolean;
  platform?: string;
  label?: string;
}

export const getAutostart = () => api.get<AutostartState>('/autostart');
export const setAutostart = (enabled: boolean) => api.put<AutostartState>('/autostart', { enabled });
