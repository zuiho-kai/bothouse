/**
 * DSH 账号路由（provider id deepseek-account）：免费额度与平台登录的账户金额。
 *
 * 没有 API Key，也不发 HTTP：凭证是 DSH 账号服务持有的授权记录，只经调用方注入的
 * resolveAccount 取快照。展示口径与 deepseek-official 一致，差异只在取数。
 * 档位基准与峰谷取自 ./deepseek-common.ts。
 *
 * @module dsh-pet/src/host/balance/providers/deepseek-account
 */
import { deepseekFullBalance, deepseekPricingTier } from '../deepseek-common.ts';
import { money, obj, sumMoney } from '../internal.ts';
import type { AccountBalanceSnapshot, BalanceProvider, BalanceSuccess } from '../types.ts';

/**
 * 账号余额快照 → 成功结果（纯函数，测试可直接喂真实结构）。
 * @param snapshot - 账号服务返回的快照；未登录时为 null 或 undefined。
 * @param provider - 回填结果的 provider id。
 * @returns money 形态，每个币种一条钱包。
 * @throws 未登录、查询失败、无充值钱包或金额非法时，不伪造 0 余额
 */
export function parseAccountBalance(
  snapshot: AccountBalanceSnapshot | null | undefined,
  provider: string,
): BalanceSuccess {
  if (!snapshot) throw new Error('dsh-pet: 账号未登录（deepseek-account）');
  if (snapshot.status !== 'ready') throw new Error('dsh-pet: 账号余额查询失败');
  const wallets = Array.isArray(snapshot.value) ? snapshot.value : [];
  // 充值钱包为空 = 没有可展示的余额（如只送不充的新号），报错而非显示 ¥0.00。
  if (wallets.length === 0) throw new Error('dsh-pet: 账号没有充值钱包余额');
  // 全部钱包按币种搬出，由展示层决定显示哪些；只取首条会把排在前面的空 USD 钱包当成余额。
  const candidates = wallets.map((w) => obj(w as unknown)).filter((w): w is Record<string, unknown> => w !== undefined);
  if (candidates.length === 0) throw new Error('dsh-pet: 账号钱包结构非法');

  // 同币种可能有多条钱包，按币种累加，不丢钱。
  const toppedUpBy = new Map<string, string>();
  for (const w of candidates) {
    const currency = typeof w.currency === 'string' && w.currency.length > 0 ? w.currency : 'CNY';
    const amount = money(w.balance, 'balance');
    const prev = toppedUpBy.get(currency);
    toppedUpBy.set(currency, prev === undefined ? amount : sumMoney(prev, amount));
  }
  // 币种非法的赠金钱包无法归属，跳过，不硬配。
  const grantedBy = new Map<string, string>();
  for (const raw of Array.isArray(snapshot.bonusWallets) ? snapshot.bonusWallets : []) {
    const w = obj(raw as unknown);
    if (!w || typeof w.currency !== 'string' || w.currency.length === 0) continue;
    const amount = money(w.balance, 'bonus balance');
    const prev = grantedBy.get(w.currency);
    grantedBy.set(w.currency, prev === undefined ? amount : sumMoney(prev, amount));
  }
  // 只出现在赠金钱包里的币种也补一条：余额真实可用，不能因没有充值钱包而消失。
  for (const currency of grantedBy.keys()) {
    if (!toppedUpBy.has(currency)) toppedUpBy.set(currency, '0.00');
  }

  const walletsOut = [...toppedUpBy.entries()].map(([currency, toppedUp]) => {
    const granted = grantedBy.get(currency) ?? '0.00';
    const fullBalance = deepseekFullBalance(currency);
    return {
      currency,
      // 与官方路由同构：total = 赠送 + 充值，这里由两个钱包相加。
      total: sumMoney(granted, toppedUp),
      granted,
      toppedUp,
      ...(fullBalance === undefined ? {} : { fullBalance }),
    };
  });
  return {
    ok: true,
    provider,
    shape: 'money',
    data: { wallets: walletsOut, tier: deepseekPricingTier() },
  };
}

/** DSH 账号路由的内置定义。 */
export const deepseekAccount: BalanceProvider = {
  id: 'deepseek-account',
  credential: { mode: 'none' },
  async fetch({ provider, resolveAccount }) {
    // 上游已保证 none 路由的 resolveAccount 在场；此处只在不变量被破坏时触发。
    if (!resolveAccount) throw new Error('dsh-pet: 缺少账号服务（' + provider + '）');
    return parseAccountBalance(await resolveAccount(), provider);
  },
};
