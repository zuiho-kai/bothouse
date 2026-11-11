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

export interface PetFetchStatus {
  state: 'downloading' | 'done' | 'failed' | string;
  done: number;
  total: number;
  error?: string;
}

/** 展示用的开源形象包：仓库里只有清单，点了才从作者仓库下载并校验。 */
export interface PetShowcasePack {
  id: string;
  dir: string;
  name: string;
  description: string;
  forRole: string;
  license: string;
  bytes: number;
  source: string;
  installed: boolean;
  fetch?: PetFetchStatus;
}

export interface PetPacksApiResponse {
  installed: InstalledPetPack[];
  baseDir: string;
  showcase?: PetShowcasePack[];
}

export async function listInstalledPetPacks(): Promise<PetPacksApiResponse> {
  return api.get<PetPacksApiResponse>('/plugins/pets');
}

export async function fetchShowcasePack(pack: string): Promise<PetFetchStatus> {
  return api.post<PetFetchStatus>('/plugins/pets/fetch', { pack });
}

