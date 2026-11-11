/**
 * 档位百分比入口与档位索引：宠物动画的驱动依据。
 *
 * 百分比口径按形态分派给各自的 handler（windows 取三窗口最大，money 与 points 按基准折算），
 * 这里只保留入口与服务商无关的档位切分。
 *
 * @module dsh-pet/src/shared/balance/percent
 */

import { HANDLERS } from './handlers/index.ts';
import type { BalanceView } from './types.ts';

/**
 * 取已用百分比（0 = 未消耗，100 = 耗尽）；给不出百分比语义的形态返回 undefined，不替服务商猜一个。
 *
 * 具体口径见各 handler：windows 取三窗口最大，money 按各币种自己的基准折算后叠加（不需要汇率），
 * points 按同一单位内的比值折算。
 */
export function balancePercent(v: BalanceView): number | undefined {
  return HANDLERS[v.shape].percent(v);
}

/**
 * 已用百分比对应的档位索引：20% 一档，仅恰好 100% 取最高档 5。
 *
 * 索引与成品配置里的余额档位动画一一对应。
 */
export function balanceEventIndex(p: number): number {
  if (p === 100) return 5;
  const i = Math.floor(p / 20);
  return i < 5 ? i : 4;
}
