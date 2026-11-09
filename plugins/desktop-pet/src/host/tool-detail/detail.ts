/**
 * 详情生成：把工具调用折叠成一句话，必要时按命令内容细化。
 *
 * 不决定档位与气泡其他字段（归 ./work-status），也不发通知。
 * 必须始终成立：输出长度 ≤ TASK_TEXT_MAX + 1（含省略号），复合命令一律不猜。
 * @module dsh-pet/src/host/tool-detail/detail
 */
import {
  COMMAND_LIKE,
  COMPOUND_COMMAND,
  SUBCOMMAND_LIKE,
  TARGET_DISPLAY_MAX,
  clip,
  compactTarget,
  fill,
  parseArgs,
  pickLine,
  str,
  tokenizeCommand,
} from './target.ts';
import {
  COMMAND_COPY,
  COMMAND_FALLBACK,
  COMMAND_NAME_TOO_LONG,
  SILENT_TOOLS,
  TOOL_COPY,
  TOOL_RULES,
  UNKNOWN_TOOL_LINE,
} from './copy.ts';

/**
 * 按外部给的键查表，只认自有属性。
 *
 * 表是普通对象，而键来自模型给的工具名与命令名：`constructor` / `toString` / `__proto__`
 * 会命中原型链，查回来的不是文案而是函数。这类名字没有特殊语义，一律按「表里没有」处理。
 */
function own<T>(table: Readonly<Record<string, T>>, key: string): T | undefined {
  return Object.prototype.hasOwnProperty.call(table, key) ? table[key] : undefined;
}

/**
 * `pwsh` 的文案：按命令名（必要时加子命令）查表，查不到走兜底。
 *
 * 复合命令 → null，让前端回落配置文案（无法判断真正在做什么）；`git log` 这类命中「命令 + 子命令」
 * 用子命令文案，只命中命令（`git`、`cd`）用通用文案，都没命中（`npm`、`python`、`node`…）走兜底——
 * 兜底带命令名，至少知道在跑什么。
 */
function pwshDetail(args: Record<string, unknown> | null): string | null {
  const command = args === null ? null : str(args.command);
  if (command === null) return null;
  if (COMPOUND_COMMAND.test(command)) return null;
  const tokens = tokenizeCommand(command);
  const nameAt = tokens.findIndex((token) => COMMAND_LIKE.test(token));
  if (nameAt < 0) return null;
  const rawCmd = tokens[nameAt] as string;
  const lookup = rawCmd.toLowerCase();
  // 子命令：命令名后面第一个「像子命令」的词（跳过开关与参数值）
  const subAt = tokens.findIndex((token, index) => index > nameAt && SUBCOMMAND_LIKE.test(token));
  const sub = subAt < 0 ? null : (tokens[subAt] as string).toLowerCase();
  const lines = (sub === null ? undefined : own(COMMAND_COPY, `${lookup} ${sub}`)) ?? own(COMMAND_COPY, lookup);
  if (lines !== undefined) return clip(pickLine(lines));
  // 命令名本身太长（Get-NetTCPConnection 这种）→ 退回不带名字的兜底
  if (Array.from(rawCmd).length > TARGET_DISPLAY_MAX) return clip(COMMAND_NAME_TOO_LONG);
  return clip(fill(pickLine(COMMAND_FALLBACK), { cmd: rawCmd }));
}

/**
 * `tool/call` 事件 → 气泡详情；跳过、无法解析、无信息量 → null。
 *
 * 返回值可以直接写进 `sections.workStatus.data.task`（长度 ≤ TASK_TEXT_MAX + 1）。
 */
export function toolDetailFromEvent(
  event: { data?: { name?: unknown; arguments?: unknown } } | null | undefined,
): string | null {
  const name = str(event?.data?.name);
  if (name === null) return null;
  if (SILENT_TOOLS.has(name)) return null;
  const args = parseArgs(event?.data?.arguments);
  // pwsh 走命令表（它没有「文件目标」，目标就是命令本身）
  if (name === 'pwsh') return pwshDetail(args);
  const entry = own(TOOL_COPY, name);
  // 未知工具：不猜参数，也不报工具名
  if (entry === undefined) return clip(UNKNOWN_TOOL_LINE);
  const rule = own(TOOL_RULES, name);
  const line = pickLine(entry.lines);
  // workflow 这类整句不带对象的，直接给（不需要目标）
  if (!line.includes('{target}')) return clip(line);
  const target = args === null || rule === undefined ? null : rule.pick(args);
  // 拿不到目标 → null，不覆盖气泡里已有的文案（todo 文案比半句话有信息量）
  if (target === null) return null;
  const shown = compactTarget(target, rule?.path === true);
  // 目标太长 → 换一句不带名字的氛围兜底（硬塞会撑破气泡，见 TARGET_DISPLAY_MAX 的说明）
  if (Array.from(shown).length > TARGET_DISPLAY_MAX) return clip(entry.short);
  return clip(fill(line, { target: shown }));
}
