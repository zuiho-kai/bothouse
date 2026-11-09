/**
 * 余额不可用时「要不要弹文字说明」的判定。
 *
 * 判定本身无状态：只比对传入的 lastKey，调用方负责保存返回的 key。
 * 两端（浏览器 overlay 与桌面外壳）必须走同一份判定，各写一份必然漂移。
 *
 * @module dsh-pet/src/shared/balance/notice
 */

import type { BalanceNoticeDecision, BalanceState } from './types.ts';

/**
 * 判定本次是否弹气泡，并给出供下次比较的原因 key。
 *
 * 显式请求（`/balance` 命令、桌面「查看余额」菜单）一律弹：用户问了就该有答复，包括「不支持」这件事；
 * 自动轮询只在原因（含服务商）变化时弹一次，首次检测到也算变化，否则每 30 分钟刷同一句话。
 *
 * @param state - 当前余额状态；只读，本函数不修改它。
 * @param lastKey - 上次提示的原因 key，null 表示尚未提示过。
 * @param explicit - 是否由用户显式请求触发。
 * @returns 是否弹，以及本次要存下的 key（ok 状态为 null）。
 */
export function decideBalanceNotice(
  state: BalanceState,
  lastKey: string | null,
  explicit: boolean,
): BalanceNoticeDecision {
  if (state.ok) return { show: false, key: null };
  const key = state.reason + ':' + state.provider;
  return { show: explicit || key !== lastKey, key };
}
