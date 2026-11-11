/**
 * 目标提取：从工具参数或命令行里取出「在操作什么」，并做长度收口。
 *
 * 只解析、不渲染；解析不出就返回 undefined，由上层回落到氛围短句。
 * 必须始终成立：命令只看命令名与参数形状，参数值一律不进气泡。
 * @module dsh-pet/src/host/tool-detail/target
 */
import { TASK_TEXT_MAX } from '../work-status.ts';
import type { CopyLine } from './copy.ts';

/** 非空字符串（去首尾空白），否则 null——所有取参都先过它。 */
export function str(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/** 按候选顺序取第一个非空字符串：同名工具在不同版本里字段叫法可能不同（file_path / filePath / path）。 */
export function firstStr(args: Record<string, unknown>, keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = str(args[key]);
    if (value !== null) return value;
  }
  return null;
}

/** 文件类工具：`file_path` 是主流，`path` 是部分工具的写法。 */
export function fileTarget(args: Record<string, unknown>): string | null {
  return firstStr(args, ['file_path', 'filePath', 'path']);
}

/** 网页：给主机名就够（完整 URL 又长又带查询串，气泡放不下也没必要）。 */
export function urlHost(args: Record<string, unknown>): string | null {
  const raw = str(args.url);
  if (raw === null) return null;
  try {
    const host = new URL(raw).host;
    return host === '' ? null : host;
  } catch {
    // 不是合法 URL（缺协议等）：退化成「去掉协议后取第一段」，绝不抛
    const rest = raw.replace(/^[a-zA-Z][a-zA-Z\d+.-]*:\/\//, '');
    const head = rest.split(/[/?#]/)[0] ?? '';
    return head === '' ? null : head;
  }
}

/** 网络搜索：`queries` 可能是数组（主流）或单数字符串，两种都认。 */
export function queryTarget(args: Record<string, unknown>): string | null {
  const queries = args.queries;
  if (Array.isArray(queries)) {
    for (const item of queries) {
      const value = str(item);
      if (value !== null) return value;
    }
    return null;
  }
  return firstStr(args, ['queries', 'query']);
}

/** 展示文件：`files` 是 `[{ path, description }]`，取第一个的 path（没有就取 description）。 */
export function filesTarget(args: Record<string, unknown>): string | null {
  const files = args.files;
  if (!Array.isArray(files)) return null;
  for (const item of files) {
    if (item === null || typeof item !== 'object') continue;
    const picked = firstStr(item as Record<string, unknown>, ['path', 'description']);
    if (picked !== null) return picked;
  }
  return null;
}

/**
 * 命令名长什么样：ASCII 字母开头、至少两个字符、只含字母数字与 `_ . -`。
 * 纯数字（`18016`）、中文串（`监听`）、符号（`==`）、开关（`-v`）、单字母变量（`x`）全部落选——
 * 它们几乎只会是字符串字面量或参数，而不是命令本身。
 */
export const COMMAND_LIKE = /^[A-Za-z][A-Za-z\d_.-]+$/;

/** 子命令长什么样：单词形态（`status` / `log` / `push`），不接受开关与路径。 */
export const SUBCOMMAND_LIKE = /^[A-Za-z][A-Za-z\d-]*$/;

/** 复合命令：`;` `|` `&&` `||` 换行一律不猜（引号内的竖线也会被判成复合，宁保守）。 */
export const COMPOUND_COMMAND = /[;|]|&&|\|\||\r?\n/;

/**
 * 取命令名时要剥掉的边角字符（运算符、括号、重定向、引号、变量前缀…）。
 * 例：`(Get-NetTCPConnection` → `Get-NetTCPConnection`；`$env:FOO` → `env:FOO`（随后判定落选）。
 */
const EDGE_CHARS = new Set('&.([{!@$^+:=,;|"\'`)]}>#');

/** 剥掉词首词尾的边角字符。 */
function trimEdges(token: string): string {
  let start = 0;
  let end = token.length;
  while (start < end && EDGE_CHARS.has(token.charAt(start))) start += 1;
  while (end > start && EDGE_CHARS.has(token.charAt(end - 1))) end -= 1;
  return token.slice(start, end);
}

/**
 * 把命令行切成「词」：引号内的整体算一个词（`"C:\Program Files\node.exe"` 不会被空格劈开），
 * 引号本身丢弃，`;` / `|` 当分隔符。
 *
 * 这不是通用 shell 解析器，只为「找命令名」服务，所以只处理引号与分隔符，不解释变量、转义与管道。
 */
export function tokenizeCommand(command: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let quote: string | null = null;
  for (const ch of command) {
    if (quote !== null) {
      if (ch === quote) quote = null;
      else current += ch;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
      continue;
    }
    if (/\s/.test(ch) || ch === ';' || ch === '|') {
      if (current !== '') tokens.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  if (current !== '') tokens.push(current);
  return tokens.map(trimEdges).filter((token) => token !== '');
}

/** arguments 的解析上限（UTF-16 码元数）：超过就不解析（write / edit 会带上整个文件内容）。 */
const MAX_ARGS_CHARS = 64 * 1024;

/** 气泡里目标的展示上限（码点）：超过就只留文件名。 */
const TARGET_MAX = 22;

/**
 * 目标上屏的长度上限（码点）：超过就整句换成该工具的氛围兜底。
 * 比 TARGET_MAX 小是有意的——路径压缩后仍超过这个数的（长文件名、长 grep 正则、长 query）
 * 硬塞进句子会撑破气泡（真实案例：`grep` 的 pattern 是 `WORK_STATE_GAP_MS|busyFlip|…`）。
 */
export const TARGET_DISPLAY_MAX = 20;

/** 解析 tool/call 的 arguments（JSON 字符串；个别版本可能直接给对象）→ 参数对象；失败或超大 → null。 */
export function parseArgs(raw: unknown): Record<string, unknown> | null {
  if (raw !== null && typeof raw === 'object' && !Array.isArray(raw)) return raw as Record<string, unknown>;
  if (typeof raw !== 'string' || raw === '' || raw.length > MAX_ARGS_CHARS) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** 按码点截断（与 ./work-status 的 currentTaskFromTodo 同口径：超长留 TASK_TEXT_MAX 个 + 省略号）。 */
export function clip(text: string): string {
  const points = Array.from(text);
  return points.length > TASK_TEXT_MAX ? `${points.slice(0, TASK_TEXT_MAX).join('')}…` : text;
}

/** 随机取一句（同一句连着出现很假，这里按调用随机）。 */
export function pickLine(lines: readonly CopyLine[]): CopyLine {
  return lines[Math.floor(Math.random() * lines.length)] ?? lines[0] ?? '';
}

/** 填占位符（`{target}` / `{cmd}` / `{tool}`）；未知占位符原样保留。 */
export function fill(line: CopyLine, vars: Readonly<Record<string, string>>): string {
  let out = line;
  for (const [key, value] of Object.entries(vars)) out = out.split(`{${key}}`).join(value);
  return out;
}

/**
 * 目标压短：短路径原样，长路径只留文件名。
 * 统一成 `/` 是为了跨平台文案一致（Windows 的 `\` 在气泡里更占宽度也更难读）。
 */
export function compactTarget(raw: string, pathLike: boolean): string {
  if (!pathLike) return raw;
  const text = raw.replace(/\\/g, '/').replace(/\/+$/, '');
  if (Array.from(text).length <= TARGET_MAX) return text;
  const parts = text.split('/').filter((part) => part !== '');
  return parts.length > 0 ? (parts[parts.length - 1] as string) : text;
}
