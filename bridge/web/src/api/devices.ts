import api from './client';

export interface DeviceAdapter {
  platform: string;
  project: string;
  capabilities: string[];
}

export async function listDevices(): Promise<{ devices: DeviceAdapter[] }> {
  return api.get<{ devices: DeviceAdapter[] }>('/devices');
}
