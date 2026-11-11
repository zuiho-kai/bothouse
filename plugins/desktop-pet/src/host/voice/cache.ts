/**
 * 语音缓存：按「音色 + 语速 + 文本」算键，落盘为 mp3，并按总量与条数淘汰最旧的。
 *
 * 命中即免合成——同一句话不管是自动播报还是用户点历史，都只合成一次。缓存只是加速，
 * 删掉任意文件都不影响正确性：下一次请求会重新合成。不负责合成与队列。
 * @module dsh-pet/src/host/voice/cache
 */
import { createHash } from 'node:crypto';
import { mkdir, readdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';

/** 缓存总量上限（字节）：超过后从最旧的开始删。 */
export const CACHE_MAX_BYTES = 20 * 1024 * 1024;
/** 缓存文件条数上限。 */
export const CACHE_MAX_FILES = 200;

/** 缓存文件的完整路径：`<userRoot>/voice-cache/<key>.mp3`。 */
export function cachePath(userRoot: string, key: string): string {
  return join(userRoot, 'voice-cache', `${key}.mp3`);
}

/**
 * 计算缓存键。
 *
 * 四个输入都影响音频内容。`source` 是合成来源——内置实现的 id 或第三方 provider 的 id：
 * 不含它的话，切换实现后会命中上一家的旧音频，听起来像「注册了没生效」。
 * `text` 不做归一化——同一句话多一个空格就是另一份音频，宁可多存也不冒「听起来不对」的风险。
 * @param source - 合成来源。
 * @param voice - 音色 id；第三方实现没有音色概念，传空串。
 * @param rate - 语速表达式（如 `+0%`）。
 * @param text - 待合成文本。
 * @returns 十六进制 sha1。
 */
export function cacheKey(source: string, voice: string, rate: string, text: string): string {
  return createHash('sha1').update(`${source}\n${voice}\n${rate}\n${text}`).digest('hex');
}

/**
 * 确保缓存目录存在。
 * @param userRoot - 用户数据根。
 * @returns 缓存目录绝对路径。
 */
export async function ensureCacheDir(userRoot: string): Promise<string> {
  const dir = join(userRoot, 'voice-cache');
  await mkdir(dir, { recursive: true });
  return dir;
}

/**
 * 按「总量 + 条数」淘汰最旧的文件；两个上限都满足时立刻停手。
 * @param dir - 缓存目录。
 * @param limits - 上限，缺省用模块常量。
 * @returns 实际删除的文件数。
 */
export async function pruneCache(dir: string, limits: { maxBytes?: number; maxFiles?: number } = {}): Promise<number> {
  const maxBytes = limits.maxBytes ?? CACHE_MAX_BYTES;
  const maxFiles = limits.maxFiles ?? CACHE_MAX_FILES;
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return 0; // 目录还不存在：没有可淘汰的
  }
  const entries: { file: string; size: number; mtimeMs: number }[] = [];
  for (const name of names) {
    if (!name.endsWith('.mp3')) continue;
    const file = join(dir, name);
    try {
      const info = await stat(file);
      entries.push({ file, size: info.size, mtimeMs: info.mtimeMs });
    } catch {
      /* 这条正被别的请求删掉，跳过 */
    }
  }
  entries.sort((a, b) => a.mtimeMs - b.mtimeMs);
  let totalBytes = entries.reduce((sum, entry) => sum + entry.size, 0);
  let totalFiles = entries.length;
  let removed = 0;
  for (const entry of entries) {
    if (totalBytes <= maxBytes && totalFiles <= maxFiles) break;
    try {
      await rm(entry.file, { force: true });
      removed += 1;
      totalBytes -= entry.size;
      totalFiles -= 1;
    } catch {
      /* 删不掉就留着，不影响本次请求 */
    }
  }
  return removed;
}
