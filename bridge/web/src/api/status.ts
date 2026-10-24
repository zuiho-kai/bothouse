import api from './client';

export interface SystemStatus {
  version: string;
  uptime_seconds: number;
  connected_platforms: string[];
  projects_count: number;
  bridge_adapters: { platform: string; project: string; capabilities: string[] }[];
}

export const getStatus = () => api.get<SystemStatus>('/status');
export const restartSystem = (body?: { session_key?: string; platform?: string }) => api.post('/restart', body);
export const reloadConfig = () => api.post<{ message: string; projects_added: string[]; projects_removed: string[]; projects_updated: string[] }>('/reload');

// How long to wait for the service to come back after restartSystem(); same value the
// project page already used for its restart waits (ProjectDetail.tsx).
export const RESTART_WAIT_MS = 8000;

// Poll /status until it answers or maxMs passes; resolves either way.
export const waitForService = (maxMs: number = RESTART_WAIT_MS) =>
  new Promise<void>((resolve) => {
    const start = Date.now();
    const poll = () => {
      fetch('/api/v1/status')
        .then((r) => { if (r.ok) resolve(); else throw new Error(); })
        .catch(() => {
          if (Date.now() - start > maxMs) { resolve(); return; }
          setTimeout(poll, 500);
        });
    };
    setTimeout(poll, 1500);
  });
