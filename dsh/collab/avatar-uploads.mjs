import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CollabError } from './store.mjs';

export const UPLOAD_FILE = /^[a-z0-9-]+\.png$/;
export const MAX_AVATAR_BYTES = 256 * 1024;
const SIGNATURE = Buffer.from('89504e470d0a1a0a', 'hex');

/** Local portraits; only validated filenames ever reach the filesystem. */
export class AvatarUploads {
  constructor(dir) { this.dir = dir; }

  filename(id) {
    const file = `${id}.png`;
    if (!UPLOAD_FILE.test(file)) throw new CollabError('invalid', '头像文件名无效');
    return file;
  }

  save(id, png) {
    const file = this.filename(id);
    if (typeof png !== 'string' || !png || (png.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(png))) {
      throw new CollabError('invalid', '头像必须是有效的 PNG base64 数据（不含 data: 前缀）');
    }
    const bytes = Buffer.from(png, 'base64');
    if (bytes.length > MAX_AVATAR_BYTES) throw new CollabError('invalid', '头像不能超过 256KB');
    if (bytes.length < 33 || !bytes.subarray(0, 8).equals(SIGNATURE) || bytes.readUInt32BE(8) !== 13 || bytes.toString('ascii', 12, 16) !== 'IHDR') {
      throw new CollabError('invalid', '头像必须是 PNG 图片');
    }
    if (bytes.readUInt32BE(16) !== 256 || bytes.readUInt32BE(20) !== 256) throw new CollabError('invalid', '头像尺寸必须是 256×256 像素');
    mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    const temporary = join(this.dir, `${file}.${randomUUID()}.tmp`);
    try {
      writeFileSync(temporary, bytes, { mode: 0o600, flag: 'wx' });
      renameSync(temporary, join(this.dir, file));
    } finally {
      try { unlinkSync(temporary); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    return `upload:${file}`;
  }

  read(file) {
    if (!UPLOAD_FILE.test(file)) return undefined;
    try { return readFileSync(join(this.dir, file)); } catch (error) { if (error.code === 'ENOENT') return undefined; throw error; }
  }

  remove(id) {
    // Older member ids may contain underscores; those members never had an upload.
    const file = `${id}.png`;
    if (!UPLOAD_FILE.test(file)) return;
    try { unlinkSync(join(this.dir, file)); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
}
