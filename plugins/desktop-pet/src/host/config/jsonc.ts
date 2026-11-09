/**
 * JSONC 容忍读取：把用户手写、带 // 注释的配置解析成对象。
 *
 * 不校验字段，不做合并；解析失败一律抛出，由调用方决定回退还是报错。
 * 必须始终成立：只做去注释与解析，绝不改写用户文件内容。
 * @module dsh-pet/src/host/config/jsonc
 */
import { existsSync, readFileSync } from 'node:fs';
import type { ConfigPaths } from './constants.ts';

/** 仅删除字符串之外的 JSONC 注释，保留字符串转义、换行与相邻 JSON token 的分隔。 */
function stripJsonc(src: string): string {
  let out = '';
  let inString = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inString) {
      out += ch;
      if (ch === '\\' && i + 1 < src.length) {
        out += src[++i];
      } else if (ch === '"') {
        inString = false;
      }
    } else if (ch === '"') {
      inString = true;
      out += ch;
    } else if (ch === '/' && src[i + 1] === '/') {
      out += ' ';
      while (i + 1 < src.length && src[i + 1] !== '\r' && src[i + 1] !== '\n') i++;
    } else if (ch === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      if (end === -1) throw new SyntaxError('Unterminated JSONC block comment');
      out += src.slice(i, end + 2).replace(/[^\r\n]/g, ' ');
      i = end + 1;
    } else {
      out += ch;
    }
  }
  return out.trim();
}

/** 读取并解析 JSONC 文件；不存在/解析失败 → undefined（调用方决定处理） */
export function readJsonc(path: string): Record<string, unknown> | undefined {
  try {
    const raw = JSON.parse(stripJsonc(readFileSync(path, 'utf8'))) as unknown;
    return raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * 读磁盘上的用户层原对象（JSONC 容忍，与读取路径共用同一份解析器）。
 * 写路径必须用它：PUT /config 的透传保留要把用户手改的高级字段原样带回，而用户层可能是带 // 注释
 * 的 config.jsonc 原文；若用严格 JSON.parse，解析抛错被吞 → existing 变 undefined → 白名单重建
 * → 高级字段全部丢失。文件不存在 / 损坏 → undefined。
 */
export function readUserConfig(paths: ConfigPaths): Record<string, unknown> | undefined {
  const file = effectiveUserFile(paths);
  return file ? readJsonc(file) : undefined;
}

/**
 * 用户层存在但解析不了（真损坏：连 JSONC 剥注释都救不回来）。
 * 用途：PUT /config 的损坏预检——保存是白名单重建，existing 读不出来会让原有内容被整份静默丢掉，
 * 所以先不写盘、回 200 + `reason=user-config-unparsable` 让设置页弹窗确认。文件不存在 → false。
 */
export function userConfigUnparsable(paths: ConfigPaths): boolean {
  const file = effectiveUserFile(paths);
  return file !== undefined && readJsonc(file) === undefined;
}

export function effectiveUserFile(paths: ConfigPaths): string | undefined {
  if (existsSync(paths.userFile)) return paths.userFile;
  if (paths.legacyUserFile && existsSync(paths.legacyUserFile)) return paths.legacyUserFile;
  return undefined;
}
