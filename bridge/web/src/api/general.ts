import api from './client';
import { withBase } from '@/lib/basePath';

export interface GeneralMember {
  project: string;
  display_name: string;
}

export interface GeneralMessage {
  id: string;
  kind: 'user' | 'agent' | 'notice';
  author_id: string;
  author: string;
  text: string;
  reply_to?: string;
  target?: string;
  created_at: string;
}

export const listGeneralMembers = () => api.get<{ members: GeneralMember[] }>('/general/members');
export const listGeneralMessages = () => api.get<{ messages: GeneralMessage[] }>('/general/messages');
export const postGeneralMessage = (text: string) => api.post<GeneralMessage>('/general/messages', { text });

export function subscribeGeneralMessages(after: string, handlers: {
  open: () => void;
  message: (message: GeneralMessage) => void;
  disconnect: (willReconnect: boolean) => void;
}): () => void {
  const query = new URLSearchParams({ after });
  const token = api.getToken();
  if (token) query.set('token', token);

  // EventSource sends Last-Event-ID on reconnect. The initial cursor covers the
  // interval between fetching history and opening the stream.
  const stream = new EventSource(`${withBase('/api/v1/general/events')}?${query}`);
  stream.onopen = handlers.open;
  stream.onmessage = (event) => handlers.message(JSON.parse(event.data));
  stream.onerror = () => handlers.disconnect(stream.readyState !== EventSource.CLOSED);
  return () => stream.close();
}
