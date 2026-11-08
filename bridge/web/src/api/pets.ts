import api from './client';

export interface InstalledPetPack {
  id: string;
  name: string;
  format: 'webp-sprite' | 'webm' | '';
  localPath: string;
  actionCount: number;
  manifest?: Record<string, unknown>;
  actions?: Array<Record<string, unknown>>;
  notice?: string;
  error?: string;
}

export interface PetPacksApiResponse {
  installed: InstalledPetPack[];
  baseDir: string;
}

export async function listInstalledPetPacks(): Promise<PetPacksApiResponse> {
  return api.get<PetPacksApiResponse>('/plugins/pets');
}
