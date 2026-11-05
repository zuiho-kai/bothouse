import api from './client';
import type { RoleInfo } from './roles';

/** One DSH channel (chat, workspace or private chat), shown as a session. */
export interface DSHChannel {
  id: string;
  name: string;
  kind: string;
  /** RFC3339 of the last message; empty when the channel has none */
  updated_at: string;
  last_message: { role: string; name: string; content: string; timestamp: string } | null;
}

/** GET /dsh/summary (bridge/core/management_roles_dsh.go): DSH's own members and channels. */
export interface DSHSummary {
  running: boolean;
  members: RoleInfo[];
  channels: DSHChannel[];
}

export const getDSHSummary = () => api.get<DSHSummary>('/dsh/summary');
