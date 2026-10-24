// #144: files and images the owner attaches to a channel message.
// Bytes are kept on disk (one file per attachment, named by a random id) and the
// message row only stores {id, name, mime, size}. Bots receive them through the
// cloud_web wire format they already understand (bridge/platform/cloud-web/protocol.go
// wireImage / wireFile: base64 data + mime_type + file_name).
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CollabError } from './store.mjs';

const ID = /^[0-9a-f-]{36}$/;
// Raster images are shown in the page and sent to bots as images; anything else
// (svg, bmp, heic, tiff, html, ...) is served as a download and sent as a file,
// since model APIs only take png/jpeg/gif/webp images (Anthropic Messages API
// image block media_type; others reject the request with 400).
export const INLINE_IMAGE = /^image\/(png|jpeg|gif|webp)$/;
// Larger images go to bots as files: Anthropic's Messages API rejects an image
// over 5 MB (docs "Vision" / image size limits).
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export class Attachments {
  constructor(dir) { this.dir = dir; }

  /** Save [{name, mime, data(base64)}] from a POST body; returns the metadata to store on the message. */
  save(list) {
    if (list == null) return [];
    if (!Array.isArray(list)) throw new CollabError('invalid', 'attachments must be a list');
    if (list.length) mkdirSync(this.dir, { recursive: true });
    return list.map((item) => {
      const data = Buffer.from(String(item?.data ?? ''), 'base64');
      if (data.length === 0) throw new CollabError('invalid', 'attachment is empty');
      const id = randomUUID();
      writeFileSync(join(this.dir, id), data);
      const name = String(item?.name ?? '').replace(/[\\/]/g, '_').slice(0, 200) || id;
      const mime = String(item?.mime ?? '') || 'application/octet-stream';
      return { id, name, mime, size: data.length };
    });
  }

  /** The stored bytes of one attachment, or undefined. */
  read(id) {
    if (!ID.test(String(id))) return undefined;
    try { return readFileSync(join(this.dir, id)); } catch { return undefined; }
  }

  /** cloud_web inbound frame fields (images / files) for a message's attachments. */
  wire(metas) {
    const images = [];
    const files = [];
    for (const a of metas ?? []) {
      const bytes = this.read(a.id);
      if (bytes === undefined) continue;
      const item = { mime_type: a.mime, data: bytes.toString('base64'), file_name: a.name };
      (INLINE_IMAGE.test(a.mime) && bytes.length <= MAX_IMAGE_BYTES ? images : files).push(item);
    }
    const out = {};
    if (images.length) out.images = images;
    if (files.length) out.files = files;
    return out;
  }
}
