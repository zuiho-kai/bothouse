import api from './client';

// The persona / avatar library (core/library.go, core/library_api.go). Items merge by slug:
// "mine" > installed packs > the default pack; items of other packs are hidden, never deleted.
export interface PackManifest { id: string; name: string; author?: string; version?: string; license?: string; description?: string }
export interface LibraryPack extends PackManifest { enabled: boolean; builtin: boolean; writable: boolean; personas: number; avatars: number }
export interface LibraryPersona {
  slug: string; name: string; intro: string; avatar?: string; text: string; pack: string;
  overrides?: string; hidden?: boolean; in_use?: string[];
}
export interface LibraryAvatar { slug: string; url: string; pack: string; overrides?: string; hidden?: boolean; in_use?: string[] }
export interface Library { personas: LibraryPersona[]; avatars: LibraryAvatar[]; packs: LibraryPack[] }
export interface PackPreview {
  staging: string; manifest: PackManifest; personas: LibraryPersona[]; avatars: LibraryAvatar[];
  replaces?: string; skipped?: string[]; conflicts?: string[];
}
export type LibraryKind = 'personas' | 'avatars';
/** roles whose persona file followed the change, and ones left alone (hand-written) */
export interface ApplyResult { slug: string; applied?: string[]; skipped?: string[] }

export const MINE_PACK = 'mine';

export const getLibrary = (lang: string) => api.get<Library>('/library', { lang });
export const createPersona = (lang: string, p: Partial<LibraryPersona>) => api.request<ApplyResult>('POST', '/library/personas', p, { lang });
export const updatePersona = (lang: string, slug: string, p: Partial<LibraryPersona>) =>
  api.request<ApplyResult>('PUT', `/library/personas/${encodeURIComponent(slug)}`, p, { lang });
export const uploadAvatar = (lang: string, file: Blob, opts: { slug?: string; name?: string } = {}) => {
  const f = new FormData();
  f.append('file', file, 'avatar.png');
  if (opts.name) f.append('name', opts.name);
  if (!opts.slug) return api.form<{ slug: string; url: string }>('/library/avatars', f, { lang });
  return api.form<{ slug: string; url: string }>(`/library/avatars/${encodeURIComponent(opts.slug)}`, f, { lang });
};
/** "deleted" = only in mine, went to the trash; "hidden" = another pack has it */
export const deleteItem = (lang: string, kind: LibraryKind, slug: string) =>
  api.request<{ result: 'deleted' | 'hidden' }>('DELETE', `/library/${kind}/${encodeURIComponent(slug)}`, undefined, { lang });
/** brings back a deleted / reset item and shows a hidden one again */
export const undoItem = (lang: string, kind: LibraryKind, slug: string) =>
  api.request<ApplyResult>('POST', `/library/${kind}/${encodeURIComponent(slug)}/undo`, {}, { lang });
/** drops the edited copy in mine: the pack's own version shows again */
export const resetItem = (lang: string, kind: LibraryKind, slug: string) =>
  api.request<ApplyResult>('POST', `/library/${kind}/${encodeURIComponent(slug)}/reset`, {}, { lang });

export const previewPackFile = (lang: string, file: File) => {
  const f = new FormData();
  f.append('file', file, file.name);
  return api.form<PackPreview>('/library/packs/preview', f, { lang });
};
export const previewPackURL = (lang: string, url: string) => api.request<PackPreview>('POST', '/library/packs/preview', { url }, { lang });
export const installPack = (lang: string, staging: string) => api.request<PackManifest>('POST', '/library/packs/install', { staging }, { lang });
export const setPackEnabled = (lang: string, id: string, on: boolean) =>
  api.request<{ id: string; enabled: boolean }>('POST', `/library/packs/${encodeURIComponent(id)}/${on ? 'enable' : 'disable'}`, {}, { lang });
export const uninstallPack = (lang: string, id: string) => api.request<{ id: string }>('DELETE', `/library/packs/${encodeURIComponent(id)}`, undefined, { lang });
export const exportPack = (lang: string, manifest: PackManifest, personas: string[], avatars: string[]) =>
  api.blob('/library/packs/export', { manifest, personas, avatars }, { lang });
