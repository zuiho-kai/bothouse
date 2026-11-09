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
  /** 做成桌面桌宠形象准备到哪一步（bothouse pet run 转换时写）。 */
  desktop?: PetDesktopStatus;
}

export interface PetPacksApiResponse {
  installed: InstalledPetPack[];
  baseDir: string;
}

export async function listInstalledPetPacks(): Promise<PetPacksApiResponse> {
  return api.get<PetPacksApiResponse>('/plugins/pets');
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
