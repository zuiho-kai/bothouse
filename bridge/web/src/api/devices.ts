import api from './client';

export interface Device {
  id: string;
  name: string;
  type: string;
  version: string;
  enabled: boolean;
  status: 'online' | 'offline';
  last_seen: string;
  registered_at: string;
  metadata?: Record<string, any>;
}

export async function listDevices(): Promise<{ devices: Device[] }> {
  return api.get<{ devices: Device[] }>('/devices');
}

export async function getDevice(id: string): Promise<{ device: Device }> {
  return api.get<{ device: Device }>(`/devices/${id}`);
}

export async function updateDevice(id: string, patch: { enabled?: boolean; name?: string; metadata?: Record<string, any> }): Promise<{ device: Device }> {
  return api.patch<{ device: Device }>(`/devices/${id}`, patch);
}

export async function deleteDevice(id: string): Promise<{ message: string }> {
  return api.delete<{ message: string }>(`/devices/${id}`);
}
