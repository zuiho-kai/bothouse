/**
 * Command Code（provider id commandcode）：三窗口用量，走未文档化的控制面 /alpha/*。
 *
 * 用量在官方 CLI 使用的控制面上，与推理数据面不同：先 whoami 取 orgId，再串行取额度、
 * 订阅与当期消耗。订阅接口可选，失败只缺重置时间，不因此整体失败。
 * summary 同时给出本期 token 与请求数，作为 windows 形态的第三页；给不全就整页不出。
 * 展示形态同 opencode（windows）；不负责展示层选择最紧迫窗口。
 *
 * @module dsh-pet/src/host/balance/providers/commandcode
 */
import { fetchWithRetry, looseNum, num, obj, queryString, readWindow } from '../internal.ts';
import type { BalanceProvider, BalanceSuccess, BalanceUsage, WindowsUsage } from '../types.ts';

/** 控制面基址（/alpha/* 固定在根域名）。 */
const API_BASE = 'https://api.commandcode.ai';

/** 滚动窗的展示名：本服务商的 5h 窗口即 windowLimits.fiveHour。 */
const ROLLING_LABEL = '5h';

/** 抓一次 JSON，HTTP 非 2xx 抛错；label 是接口路径，只用于错误信息。 */
async function fetchJson(url: string, key: string, label: string): Promise<unknown> {
  const res = await fetchWithRetry(url, key);
  if (!res.ok) throw new Error('commandcode ' + label + ' HTTP ' + res.status);
  return (await res.json()) as unknown;
}

/**
 * 从 usage 响应读区间用量（本期累计）；五个字段齐全才返回，缺一个即视为没有这项数据。
 *
 * 这些字段来自批量聚合（窗口百分比才是实时的），所以宁可整页不出，也不拿半份数字拼一张会漂的卡片。
 */
function readUsage(summary: Record<string, unknown> | undefined): BalanceUsage | undefined {
  const totalTokens = looseNum(summary?.totalTokens);
  const inputTokens = looseNum(summary?.totalTokensIn);
  const outputTokens = looseNum(summary?.totalTokensOut);
  const requests = looseNum(summary?.totalCount);
  const spentUsd = looseNum(summary?.totalCost);
  if (
    totalTokens === undefined ||
    inputTokens === undefined ||
    outputTokens === undefined ||
    requests === undefined ||
    spentUsd === undefined
  ) {
    return undefined;
  }
  return { totalTokens, inputTokens, outputTokens, requests, spentUsd };
}

/**
 * 解析额度、订阅与用量三份响应（纯函数，测试直接喂真实报文）。
 * 月度百分比 = 当期消耗 /（消耗 + 剩余）；剩余 = monthlyCredits + purchasedCredits + freeCredits。
 * 窗口只在 limited 为真时读取；订阅只提供月度重置时间。
 * @throws 必填字段缺失或非法时，不伪造 0 余额
 */
export function parseCommandCode(
  creditsBody: unknown,
  subscriptionBody: unknown,
  summaryBody: unknown,
  provider: string,
): BalanceSuccess {
  const root = obj(creditsBody);
  const credits = obj(root?.credits);
  if (!credits) throw new Error('dsh-pet: commandcode 响应缺少 credits');

  // 三个额度字段全缺即认不出响应形态：宁可报错，也不把分母当 0 算出「已用 100%」。
  const creditFields = [credits.monthlyCredits, credits.purchasedCredits, credits.freeCredits];
  if (creditFields.every((v) => looseNum(v) === undefined)) {
    throw new Error('dsh-pet: commandcode credits 响应缺少额度字段');
  }
  const remaining = creditFields.reduce<number>((sum, v) => sum + Math.max(0, looseNum(v) ?? 0), 0);

  const summary = obj(summaryBody);
  const spentRaw = summary?.totalCost;
  if (spentRaw === undefined || spentRaw === null) throw new Error('dsh-pet: commandcode usage 响应缺少 totalCost');
  const spent = Math.max(0, num(spentRaw, 'totalCost'));

  const pool = spent + remaining;
  const data: WindowsUsage = { monthly: pool > 0 ? (spent / pool) * 100 : 0 };
  if (pool > 0) data.monthlyCapUsd = pool;
  const usage = readUsage(summary);
  if (usage) data.usage = usage;

  const subscription = obj(obj(subscriptionBody)?.data);
  const periodEnd = subscription?.currentPeriodEnd;
  if (typeof periodEnd === 'string' && periodEnd.length > 0) data.monthlyResetsAt = periodEnd;

  // 实际报文把 windowLimits 放在 credits 同级，同时兼容嵌在 credits 内的变体。
  const limits = obj(root?.windowLimits) ?? obj(credits.windowLimits);
  if (limits?.limited === true) {
    const fiveHour = readWindow(limits.fiveHour);
    if (fiveHour) {
      data.rolling = fiveHour.percent;
      data.rollingCapUsd = fiveHour.capUsd;
      data.rollingLabel = ROLLING_LABEL;
      if (fiveHour.resetsAt) data.rollingResetsAt = fiveHour.resetsAt;
    }
    const weekly = readWindow(limits.weekly);
    if (weekly) {
      data.weekly = weekly.percent;
      data.weeklyCapUsd = weekly.capUsd;
      if (weekly.resetsAt) data.weeklyResetsAt = weekly.resetsAt;
    }
  }

  return { ok: true, provider, shape: 'windows', data };
}

/** Command Code 的内置定义。 */
export const commandCode: BalanceProvider = {
  id: 'commandcode',
  credential: { mode: 'ref', ref: 'COMMANDCODE_API_KEY' },
  async fetch({ key, provider }) {
    const whoami = obj(
      await fetchJson(API_BASE + '/alpha/whoami' + queryString({ limits: '1' }), key, '/alpha/whoami'),
    );
    const org = obj(whoami?.org);
    const orgId = typeof org?.id === 'string' && org.id.length > 0 ? org.id : undefined;

    const credits = await fetchJson(
      API_BASE + '/alpha/billing/credits' + queryString({ orgId }),
      key,
      '/alpha/billing/credits',
    );

    // 订阅可选：按量付费账号没有订阅时该接口非 2xx，只缺月度重置时间，
    // 三个窗口的百分比不受影响，不因此整体失败，也不编造重置时间。
    let subscription: unknown;
    try {
      subscription = await fetchJson(
        API_BASE + '/alpha/billing/subscriptions' + queryString({ orgId }),
        key,
        '/alpha/billing/subscriptions',
      );
    } catch {
      subscription = undefined;
    }

    // 不带 since：服务端默认区间就是计费周期；实测带 since 会把本期请求数与花费算少一截
    // （两个响应的 periodStart 相同），所以以服务端默认区间为准。
    const summary = await fetchJson(
      API_BASE + '/alpha/usage/summary' + queryString({ orgId }),
      key,
      '/alpha/usage/summary',
    );

    return parseCommandCode(credits, subscription, summary, provider);
  },
};
