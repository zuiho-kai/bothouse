/**
 * 余额服务商注册表：内置（编译期）与第三方（运行时）的名录与查找。
 *
 * 不含服务商知识，内置定义都在 ./providers/；不负责取数与凭证解析。
 * 新增内置服务商：加一个 provider 文件，并在本表登记一行。
 * 始终成立：内置优先，第三方不得占用内置 id；同一 id 重复注册抛错；注销只删自己登记的那份。
 *
 * @module dsh-pet/src/host/balance/registry
 */
import { commandCode } from './providers/commandcode.ts';
import { deepseekAccount } from './providers/deepseek-account.ts';
import { deepseekOfficial } from './providers/deepseek-official.ts';
import { opencodeGo } from './providers/opencode-go.ts';
import type { BalanceProvider, PluginProvider } from './types.ts';

/** 内置服务商：编译期登记，顺序即优先级。 */
export const BUILTIN_PROVIDERS: BalanceProvider[] = [opencodeGo, commandCode, deepseekOfficial, deepseekAccount];

/** 第三方运行时登记表：provider id → 定义。 */
const external = new Map<string, PluginProvider>();

/**
 * 注册一个第三方服务商。
 * @param def - 服务商定义；id 必须与 agentDefaultModel 报告的 id 一致。
 * @returns 注销函数；同一 id 被重新注册后，旧注销函数不会误删新的那份。
 * @throws 定义非法、id 与内置冲突或已被第三方注册时
 */
export function registerBalanceProvider(def: PluginProvider): () => void {
  if (!def || typeof def !== 'object') throw new TypeError('provider 定义必须是对象');
  if (typeof def.id !== 'string' || def.id.length === 0) throw new TypeError('id 必须是非空字符串');
  if (typeof def.fetch !== 'function') throw new TypeError('fetch 必须是函数');
  if (BUILTIN_PROVIDERS.some((p) => p.id === def.id)) throw new Error('不能覆盖内置服务商: ' + def.id);
  if (external.has(def.id)) throw new Error('该服务商 id 已被注册: ' + def.id);

  external.set(def.id, def);
  return () => {
    // 只删仍属于自己的那份，防止迟到的注销顶掉后来者。
    if (external.get(def.id) === def) external.delete(def.id);
  };
}

/**
 * 列出当前可用的服务商 id，用于排障「当前服务商为何不支持」。
 * @returns builtin 为内置 id，external 为第三方已注册 id（每次调用返回新数组）。
 */
export function listBalanceProviders(): { builtin: string[]; external: string[] } {
  return { builtin: BUILTIN_PROVIDERS.map((p) => p.id), external: [...external.keys()] };
}

/** 按 id 查找定义：先内置再第三方，都找不到即不支持。 */
export function matchBalanceProvider(provider: string): BalanceProvider | PluginProvider | undefined {
  return BUILTIN_PROVIDERS.find((p) => p.id === provider) ?? external.get(provider);
}
