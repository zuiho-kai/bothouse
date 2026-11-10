/**
 * 余额查询入口（host 半侧）：按当前服务商取余额并归一化结果。
 *
 * 只负责路由与失败归一，不负责展示：服务商口径在 ./providers/，名录在 ./registry.ts。
 * 凭证由调用方经 DSH credentialRef 解析后注入，插件不直接读凭证存储；账号路由走注入的
 * resolveAccount。第三方经 registerBalanceProvider 注册，拿不到 key 与 resolveAccount。
 * 始终成立：服务商只走成功路径，任何失败都在此落成 fetch-error，绝不伪造 0 余额。
 *
 * @module dsh-pet/src/host/balance/index
 */
import { BUILTIN_PROVIDERS, matchBalanceProvider } from './registry.ts';
import type { AccountBalanceSnapshot, BalanceResult } from './types.ts';

export { BUILTIN_PROVIDERS, listBalanceProviders, matchBalanceProvider, registerBalanceProvider } from './registry.ts';

/** 内置服务商名录；沿用此导出名，避免既有调用方改动。 */
export const BALANCE_PROVIDERS = BUILTIN_PROVIDERS;

/** 第三方取数等待上限（ms）；内置 HTTP 服务商走各自的超时与重试。 */
const PLUGIN_FETCH_TIMEOUT_MS = 20_000;

/**
 * 构造失败结果：三种 reason 走同一个出口，避免各处手写字段。
 * `message` 缺省时不写这个键——叶子形状是对外契约，多一个 undefined 键会破坏严格比对。
 */
function failed(
  provider: string,
  reason: 'unsupported' | 'credential-missing' | 'fetch-error',
  message?: string,
): BalanceResult {
  return message === undefined ? { ok: false, provider, reason } : { ok: false, provider, reason, message };
}

/** 把取数异常归一成 fetch-error（内置与第三方同一口径）。 */
function fetchFailed(provider: string, e: unknown): BalanceResult {
  return failed(provider, 'fetch-error', e instanceof Error ? e.message : String(e));
}

/**
 * 按当前服务商查询余额。
 * @param provider - 当前服务商 id（agentDefaultModel.currentSelection().provider）。
 * @param resolveKey - 凭证解析：ref 名 → key。
 * @param resolveAccount - 账号余额查询；仅 deepseek-account 使用，缺省时该路由报 credential-missing。
 * @returns 成功、不支持、缺凭证或抓取失败；失败绝不返回伪造数字。
 */
export async function queryBalance(
  provider: string,
  resolveKey: (ref: string) => Promise<string | undefined>,
  resolveAccount?: () => Promise<AccountBalanceSnapshot | null | undefined>,
): Promise<BalanceResult> {
  const def = matchBalanceProvider(provider);
  if (!def) return failed(provider, 'unsupported');

  // 第三方 provider 没有 credential：不解析 key、也不给 resolveAccount，
  // 否则等于允许它顺带查用户的 DSH 账号余额。
  if (!('credential' in def)) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('余额查询超时（20 秒），请稍后重试')), PLUGIN_FETCH_TIMEOUT_MS);
        timer.unref();
      });
      // 超时只结束宿主等待，不宣称取消第三方请求；迟到结果由 race 丢弃。
      return await Promise.race([def.fetch({ provider }), timeout]);
    } catch (e) {
      return fetchFailed(provider, e);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  // 凭证检查放在 try 之外：解析凭证抛错属意外，由调用方兜底；账号路由改判账号服务是否在场。
  let key = '';
  if (def.credential.mode === 'ref') {
    const resolved = await resolveKey(def.credential.ref);
    if (!resolved) return failed(provider, 'credential-missing', '缺少凭证 ' + def.credential.ref);
    key = resolved;
  } else if (!resolveAccount) {
    return failed(provider, 'credential-missing', '缺少账号服务（' + provider + '）');
  }

  try {
    return await def.fetch({ provider, key, resolveAccount });
  } catch (e) {
    return fetchFailed(provider, e);
  }
}

/** 对外再导出：调用方（宿主与测试）只需认这一个入口。 */
export { parseAccountBalance } from './providers/deepseek-account.ts';
export { parseCommandCode } from './providers/commandcode.ts';
export type {
  AccountBalanceSnapshot,
  BalanceFetchContext,
  BalanceProvider,
  BalanceResult,
  BalanceShape,
  BalanceSuccess,
  CredentialSpec,
  CustomBalance,
  CustomNode,
  CustomTag,
  MoneyBalance,
  PluginFetchContext,
  PluginProvider,
  PointsBalance,
  PricingTier,
  WindowsUsage,
} from './types.ts';
