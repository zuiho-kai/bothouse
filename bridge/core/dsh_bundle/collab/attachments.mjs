// #144: files and images the owner attaches to a channel message.
// Bytes are kept on disk (one file per attachment, named by a random id) and the
// message row only stores {id, name, mime, size}. Bots receive them through the
// cloud_web wire format they already understand (bridge/platform/cloud-web/protocol.go
// wireImage / wireFile: base64 data + mime_type + file_name).
import { randomUUID } from 'node:crypto';
import { createWriteStream, mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { CollabError, messageAttachments } from './store.mjs';

const ID = /^[0-9a-f-]{36}$/;
// Raster images are shown in the page and sent to bots as images; anything else
// (svg, bmp, heic, tiff, html, ...) is served as a download and sent as a file,
// since model APIs only take png/jpeg/gif/webp images (Anthropic Messages API
// image block media_type; others reject the request with 400).
export const INLINE_IMAGE = /^image\/(png|jpeg|gif|webp)$/;
// Larger images go to bots as files: Anthropic's Messages API rejects an image
// over 5 MB (docs "Vision" / image size limits).
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

// #197: cap of one streamed upload when the overlay sets no maxUploadBytes. The
// old 8 MiB came from #228 aligning the message POST with the bot socket, which
// capped a file at ~6 MB once base64 was added. The default follows the owner's
// 「需要大一些 尽可能大」 (2026-11-05 21:01) at the largest size measured on this
// machine; the measurements are in the PR and in attachments.test.mjs.
export const DEFAULT_MAX_UPLOAD_BYTES = 1024 * 1024 * 1024;

// cc-connect accepts attachments up to 50 MiB by default (DefaultMaxAttachmentSize in
// bridge/core/api.go) and a bot frame carries them base64-encoded (x4/3) plus JSON
// fields; plugin.mjs derives BOT_WS_MAX_PAYLOAD from this. A bigger file is not sent
// over the socket at all: the bot gets its local path in the prompt instead (#197).
export const MAX_BOT_ATTACHMENT_BYTES = 50 * 1024 * 1024;

/** Bytes as the UI writes them (MiB/GiB), for limits in messages. */
export function formatBytes(bytes) {
  if (bytes >= 1024 ** 3) return `${+(bytes / 1024 ** 3).toFixed(2)} GB`;
  return `${+(bytes / 1024 ** 2).toFixed(bytes >= 100 * 1024 ** 2 ? 0 : 1)} MB`;
}

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

  /** #197: absolute path of a stored attachment (the bot reads it when it is too big for a frame). */
  path(id) {
    return ID.test(String(id)) ? join(this.dir, id) : undefined;
  }

  /**
   * #197: accept the metadata a streamed upload returned, for a message POST that no
   * longer carries the bytes. The size is read from disk, never from the request.
   */
  adopt(list) {
    return list.map((item) => {
      const id = String(item?.id ?? '');
      if (!ID.test(id)) throw new CollabError('invalid', 'attachment id is invalid');
      let stats;
      try { stats = statSync(this.path(id)); } catch { throw new CollabError('invalid', 'attachment is missing'); }
      if (!stats?.isFile() || stats.size === 0) throw new CollabError('invalid', 'attachment is empty');
      const name = String(item?.name ?? '').replace(/[\\/]/g, '_').slice(0, 200) || id;
      return { id, name, mime: String(item?.mime ?? '') || 'application/octet-stream', size: stats.size };
    });
  }

  /** #197: a message POST either carries base64 payloads (old clients, bots) or streamed ids. */
  receive(list) {
    if (list == null) return [];
    if (!Array.isArray(list)) throw new CollabError('invalid', 'attachments must be a list');
    if (list.length === 0) return [];
    const streamed = list.filter(item => item?.id !== undefined).length;
    if (streamed === 0) return this.save(list);
    if (streamed !== list.length) throw new CollabError('invalid', 'attachments must be all streamed uploads or all inline');
    return this.adopt(list);
  }

  /**
   * #197: receive one upload straight from the request body onto disk. Bytes are
   * never held whole in memory (the old path base64'd them into the message JSON),
   * they stream through a byte counter into a temp file beside the final one and
   * are renamed into place only when the whole body arrived. A body over
   * `maxBytes`, a broken connection or an empty upload leaves no file behind.
   * Returns the metadata to store on the message; throws CollabError.
   */
  async saveStream(body, { name, mime, maxBytes }) {
    if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) throw new CollabError('invalid', 'attachment size limit is not configured');
    mkdirSync(this.dir, { recursive: true });
    const id = randomUUID();
    const temporary = join(this.dir, `${id}.part`);
    let size = 0;
    let over = false;
    const counter = new Transform({
      transform(chunk, _encoding, done) {
        size += chunk.length;
        // Past the cap the rest of the body is still read and dropped, so the browser
        // gets the 413 instead of a reset connection (same trade as readBody in plugin.mjs).
        if (size > maxBytes) { over = true; return done(); }
        done(null, chunk);
      },
    });
    try {
      await pipeline(body, counter, createWriteStream(temporary, { mode: 0o600, flags: 'wx' }));
      if (over) throw new CollabError('too-large', `附件不能超过 ${formatBytes(maxBytes)}`);
      if (size === 0) throw new CollabError('invalid', 'attachment is empty');
      renameSync(temporary, join(this.dir, id));
    } catch (error) {
      try { unlinkSync(temporary); } catch (cleanup) { if (cleanup.code !== 'ENOENT') throw cleanup; }
      if (error instanceof CollabError) throw error;
      throw new CollabError('invalid', '上传中断了，文件没有存下');
    }
    // The name travels in the query string (a header cannot carry 中文); keep only
    // the last path segment so a generated name never reaches outside the dir.
    const clean = String(name ?? '').replace(/[\\/]/g, '_').slice(0, 200) || id;
    return { id, name: clean, mime: String(mime ?? '') || 'application/octet-stream', size };
  }

  /**
   * #197: attachments of a message that are too big to travel over a bot
   * connection (cloud_web frame or ACP block). The bot gets their local path in
   * the prompt text instead of the bytes (oversizedNote).
   */
  oversized(metas) {
    return (metas ?? []).filter(a => (a.size ?? 0) > MAX_BOT_ATTACHMENT_BYTES)
      .map(a => ({ ...a, path: this.path(a.id) }));
  }

  /** cloud_web inbound frame fields (images / files) for a message's attachments. */
  wire(metas) {
    const images = [];
    const files = [];
    for (const a of metas ?? []) {
      // #197: a file over the frame cap is not encoded at all; the bot is told its path.
      if ((a.size ?? 0) > MAX_BOT_ATTACHMENT_BYTES) continue;
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

/**
 * #197: one line per attachment that was not sent over the connection, with the
 * path on this machine, so a bot can read or move the file itself.
 */
export function oversizedNote(oversized) {
  return (oversized ?? []).map(a =>
    `📎 ${a.name}（${formatBytes(a.size)}）太大，没有随消息发送；本机文件：${a.path ?? '（文件已不在）'}`).join('\n');
}

/** Shared wire admission, projected into the ACP prompt format, each block with its file name. */
export function namedAttachmentBlocks(files, messages) {
  const wire = files?.wire(messages.flatMap(messageAttachments)) ?? {};
  return [
    ...(wire.images ?? []).map(a => ({ name: a.file_name, block: { type: 'image', data: a.data, mimeType: a.mime_type } })),
    ...(wire.files ?? []).map(a => ({ name: a.file_name, block: { type: 'resource', resource: {
      uri: `attachment:///${encodeURIComponent(a.file_name)}`, mimeType: a.mime_type, blob: a.data,
    } } })),
  ];
}

export function attachmentBlocks(files, messages) {
  return namedAttachmentBlocks(files, messages).map(b => b.block);
}

/**
 * Native DSH requires durable attachment references, not inline ACP blocks.
 * DSH validates the images as one batch (count, total bytes, type, pixels) and its
 * error does not say which image failed, so when the batch is refused each block is
 * re-admitted on top of the ones already accepted: an image DSH refuses on its own or
 * that would push the batch over a limit is dropped, the rest are still delivered.
 * Admission is content-addressed, so re-admitting the same bytes stores nothing new.
 * Returns { parts, dropped: [{ name, reason, code? }] }.
 */
export async function nativeAttachmentBlocks(attachments, named) {
  const dropped = [];
  const parts = [];
  const reason = err => String(err?.message ?? err);
  const code = err => (typeof err?.code === 'string' ? err.code : undefined);
  for (const { name, block: b } of named) {
    if (b.type === 'image') { parts.push({ name, part: { type: 'image', mediaType: b.mimeType, data: b.data } }); continue; }
    try {
      parts.push({ name, part: { type: 'file', attachment: await attachments.admitEncodedFile({
        data: b.resource.blob, name: decodeURIComponent(b.resource.uri.slice('attachment:///'.length)),
      }) } });
    } catch (err) { dropped.push({ name, reason: reason(err), code: code(err) }); }
  }
  if (parts.length === 0) return { parts: [], dropped };
  try {
    return { parts: await attachments.admitPromptContent(parts.map(p => p.part)), dropped };
  } catch (batchErr) {
    if (parts.length === 1) return { parts: [], dropped: [...dropped, { name: parts[0].name, reason: reason(batchErr), code: code(batchErr) }] };
  }
  const kept = [];
  let admitted = [];
  for (const p of parts) {
    try {
      admitted = await attachments.admitPromptContent([...kept, p.part]);
      kept.push(p.part);
    } catch (err) { dropped.push({ name: p.name, reason: reason(err), code: code(err) }); }
  }
  return { parts: admitted, dropped };
}

// DSH's attachment errors (dsh-attachment-local AttachmentError: English message + code).
// The channel's system notes are Chinese, so the reason shown there is translated by code,
// falling back to the exact English message, then to the original text.
const UNDELIVERED_ZH = {
  IMAGE_TOO_MANY_PIXELS: '图片太大，超过像素上限',
  IMAGE_DIMENSION_TOO_LARGE: '图片太长或太宽，超过单边像素上限',
  IMAGE_TOO_LARGE: '图片文件太大，超过大小上限',
  INVALID_IMAGE: '图片格式不支持或已损坏',
  IMAGE_TYPE_MISMATCH: '图片实际格式和扩展名/类型不符',
  ATTACHMENT_NOT_FOUND: '附件文件找不到了',
  ATTACHMENT_CORRUPT: '附件校验失败，可能已损坏',
  ATTACHMENT_READ_FAILED: '附件读取失败',
  ATTACHMENT_WRITE_FAILED: '附件处理失败',
  INVALID_ATTACHMENT_REF: '附件引用无效',
};
const UNDELIVERED_MESSAGE_CODE = {
  'Image exceeds the configured decoded-pixel limit.': 'IMAGE_TOO_MANY_PIXELS',
  'Image exceeds the configured per-side pixel limit.': 'IMAGE_DIMENSION_TOO_LARGE',
  'Image exceeds the configured byte limit.': 'IMAGE_TOO_LARGE',
  'Unsupported or malformed image data.': 'INVALID_IMAGE',
  'Image is empty.': 'INVALID_IMAGE',
  'Declared image type does not match its bytes.': 'IMAGE_TYPE_MISMATCH',
};

/** Chinese reason for a dropped attachment ({ reason, code? } from nativeAttachmentBlocks). */
export function undeliveredReasonZh({ reason, code }) {
  return UNDELIVERED_ZH[code] ?? UNDELIVERED_ZH[UNDELIVERED_MESSAGE_CODE[String(reason).trim()]] ?? reason;
}
