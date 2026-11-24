import { api } from './client';

export interface CloudWebConnection {
  id: string;
  name: string;
  url: string;
}

interface ConnectionInput {
  name: string;
  url: string;
  token?: string;
}

const path = '/cloud-web/connections';

export const listCloudWebConnections = () => api.get<{ connections: CloudWebConnection[] }>(path);
export const createCloudWebConnection = (input: ConnectionInput) => api.post<CloudWebConnection>(path, input);
export const updateCloudWebConnection = (id: string, input: ConnectionInput) =>
  api.put<CloudWebConnection>(`${path}/${encodeURIComponent(id)}`, input);
export const removeCloudWebConnection = (id: string) => api.delete(`${path}/${encodeURIComponent(id)}`);
