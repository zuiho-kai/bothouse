import api from './client';

export interface PetDesktopStatus {
  state: 'converting' | 'ready' | 'failed' | string;
  done: number;
  total: number;
  error?: string;
}

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
  /** 桌面桌宠用的透明视频准备到哪一步（bothouse pet run 转换精灵图时写）。 */
  desktop?: PetDesktopStatus;
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

/** 导入一个形象包：zip 文件，或浏览器里选的文件夹（每个文件带相对路径）。 */
export async function importPetPack(input: { zip?: File; files?: File[]; name?: string }): Promise<InstalledPetPack> {
  const form = new FormData();
  if (input.name) form.append('name', input.name);
  if (input.zip) form.append('zip', input.zip, input.zip.name);
  for (const f of input.files ?? []) {
    const rel = (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name;
    form.append('p:' + rel, f, f.name);
  }
  return api.form<InstalledPetPack>('/plugins/pets/import', form);
}
