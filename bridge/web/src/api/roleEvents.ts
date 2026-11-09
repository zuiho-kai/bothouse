import api from './client';
import { withBase } from '@/lib/basePath';
import type { RoleEventType } from '@/pages/Plugins/roleAggregation';

export interface RoleState {
  role_key: string;
  source: string;
  name: string;
  display_name: string;
  online: boolean;
  status: RoleEventType;
  busy_count: number;
  sessions: { session_key: string; status: RoleEventType; busy: boolean }[];
}

export interface RoleSnapshot {
  roles: RoleState[];
  time: string;
  dsh: { status: string; error?: string };
}

export interface RoleStateEvent {
  type: RoleEventType;
  role_key: string;
  session_key: string;
  status: RoleEventType;
  text?: string;
  time: string;
  role: RoleState;
}

/** The browser reconnects automatically; every connection starts with a new snapshot. */
export function subscribeRoleEvents(handlers: {
  snapshot: (snapshot: RoleSnapshot) => void;
  event: (event: RoleStateEvent) => void;
  error: () => void;
}): () => void {
  const token = api.getToken();
  const query = token ? `?${new URLSearchParams({ token })}` : '';
  const stream = new EventSource(withBase('/api/v1/roles/events') + query);
  const receive = (kind: string, callback: (data: any) => void) => {
    stream.addEventListener(kind, (event) => {
      try { callback(JSON.parse((event as MessageEvent).data)); }
      catch { handlers.error(); }
    });
  };
  receive('snapshot', handlers.snapshot);
  for (const kind of ['idle', 'working', 'thinking', 'celebrate', 'error', 'speech']) {
    receive(kind, handlers.event);
  }
  // A named business "error" event is a MessageEvent too; it is not a disconnect.
  stream.onerror = (event) => {
    if (!(event instanceof MessageEvent)) handlers.error();
  };
  return () => stream.close();
}
