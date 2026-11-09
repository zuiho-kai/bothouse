/**
 * 对话图片的挑选与本地预览：判断是不是图、读成 data URL 给缩略图。
 * 不压缩、不编码、不发网络——真正送图的那一步在接入时另加，预算逻辑也会落在这里。
 * @module dsh-pet/src/shared/chat/image-pick
 */

/** 与宿主附件服务白名单一致的图片类型。 */
export const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] as const;

/** 图片媒体类型。 */
export type PetImageMediaType = (typeof IMAGE_TYPES)[number];

/** `<input type=file>` 的 accept 值，与 {@link IMAGE_TYPES} 保持同一份事实。 */
export const IMAGE_ACCEPT = IMAGE_TYPES.join(',');

/** 扩展名兜底：拖拽或部分系统来源不给 `file.type`。 */
const IMAGE_EXT: Record<string, PetImageMediaType> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
};

/**
 * 文件的图片媒体类型：声明类型在白名单内就用它，否则按扩展名兜底。
 *
 * @param file - 用户选中、拖入或粘贴的文件。
 * @returns 白名单内的类型；认不出返回 undefined。
 */
export function imageMediaTypeOf(file: File): PetImageMediaType | undefined {
  const declared = String(file.type || '').toLowerCase();
  if ((IMAGE_TYPES as readonly string[]).includes(declared)) return declared as PetImageMediaType;
  const ext = String(file.name || '')
    .split('.')
    .pop()
    ?.toLowerCase();
  return ext === undefined ? undefined : IMAGE_EXT[ext];
}

/**
 * 这个文件是不是可发送的图片。
 *
 * @param file - 用户选中或拖入的文件。
 * @returns 声明类型在白名单内，或扩展名命中兜底表时为 true。
 */
export function isImageFile(file: File): boolean {
  return imageMediaTypeOf(file) !== undefined;
}

/** 这次拖拽是否带着文件（决定 dragover 要不要 preventDefault）。 */
export function dragHasFiles(e: { readonly dataTransfer: DataTransfer | null }): boolean {
  const types = e.dataTransfer?.types;
  if (!types) return false;
  return Array.from(types).includes('Files');
}

/** 拖入的文件里第一张可发送的图片；没有返回 undefined。 */
export function firstImageFile(dataTransfer: DataTransfer | null): File | undefined {
  const files = dataTransfer?.files;
  if (!files) return undefined;
  for (const file of Array.from(files)) {
    if (isImageFile(file)) return file;
  }
  return undefined;
}

/** 剪贴板数据的结构子集：只需要 files 与 items，测试可以喂假对象。 */
export interface ClipboardLike {
  readonly files?: ArrayLike<File> | null;
  readonly items?: ArrayLike<{ readonly kind: string; getAsFile(): File | null }> | null;
}

/**
 * 剪贴板里第一张可发送的图片。
 *
 * 先看 `files`（截图工具、资源管理器复制文件都会填），再回退 `items`：
 * 个别来源只把图放进 items（`kind === 'file'`），只读 files 会表现为"粘了没反应"且不报错。
 *
 * @param data - 粘贴事件的 clipboardData 或其结构子集。
 * @returns 第一张图片；纯文本粘贴返回 undefined（调用方据此不拦截默认行为）。
 */
export function firstImageFromClipboard(data: ClipboardLike | null | undefined): File | undefined {
  if (!data) return undefined;
  const files = data.files;
  if (files) {
    for (const file of Array.from(files)) {
      if (isImageFile(file)) return file;
    }
  }
  const items = data.items;
  if (!items) return undefined;
  for (const item of Array.from(items)) {
    if (item.kind !== 'file') continue;
    const file = item.getAsFile();
    if (file && isImageFile(file)) return file;
  }
  return undefined;
}
