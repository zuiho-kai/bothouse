/**
 * OpenCode Go（provider id opencode-go）：三窗口用量。
 *
 * 取 GET https://opencode.ai/zen/go/v1/usage；接口保证三窗口与三个重置时间齐全，缺一个即视为响应变形并报错。
 * 满额度是接口不回传的业务常量，随数据带出；滚动窗为 5 小时。
 * opencode-go 与 opencode 是两个 id，后者没有用量接口，不登记。
 *
 * @module dsh-pet/src/host/balance/providers/opencode-go
 */
import { fetchWithRetry, num, str } from '../internal.ts';
import type { BalanceProvider } from '../types.ts';

/** 各窗口满额度（USD）：滚动 12、周 30、月 60；接口不回传，属业务常量。 */
const QUOTA_USD = {
  rolling: 12,
  weekly: 30,
  monthly: 60,
} as const;

/** 滚动窗的展示名：本服务商是 5 小时。 */
const ROLLING_LABEL = '5h';

/** OpenCode Go 的内置定义。 */
export const opencodeGo: BalanceProvider = {
  id: 'opencode-go',
  credential: { mode: 'ref', ref: 'OPENCODE_GO_API_KEY' },
  async fetch({ key, provider }) {
    const res = await fetchWithRetry('https://opencode.ai/zen/go/v1/usage', key);
    if (!res.ok) throw new Error('opencode usage HTTP ' + res.status);
    const body: unknown = await res.json();
    const usage = (body as { usage?: unknown })?.usage;
    if (!usage || typeof usage !== 'object') throw new Error('dsh-pet: opencode usage 响应缺少 usage');
    const u = usage as Record<string, { percent?: unknown; resetsAt?: unknown }>;
    const rolling = u.rolling,
      weekly = u.weekly,
      monthly = u.monthly;
    if (!rolling || !weekly || !monthly) throw new Error('dsh-pet: opencode usage 响应缺少窗口');
    return {
      ok: true,
      provider,
      shape: 'windows',
      data: {
        rolling: num(rolling.percent, 'rolling.percent'),
        weekly: num(weekly.percent, 'weekly.percent'),
        monthly: num(monthly.percent, 'monthly.percent'),
        rollingCapUsd: QUOTA_USD.rolling,
        weeklyCapUsd: QUOTA_USD.weekly,
        monthlyCapUsd: QUOTA_USD.monthly,
        rollingLabel: ROLLING_LABEL,
        rollingResetsAt: str(rolling.resetsAt, 'rolling.resetsAt'),
        weeklyResetsAt: str(weekly.resetsAt, 'weekly.resetsAt'),
        monthlyResetsAt: str(monthly.resetsAt, 'monthly.resetsAt'),
      },
    };
  },
};
