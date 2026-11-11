/**
 * 一种展示形态需要提供的展示规则，由 handlers/index.ts 装配成 `Record<BalanceShape, ShapeHandler>`。
 *
 * 拆成 percent、rows、detail 与 views，是为了让一个形态的全部展示知识待在一个文件里：
 * 加形态只需写一个新 handler，不必在主流程里插分支。
 *
 * @module dsh-pet/src/shared/balance/handlers/shape
 */

import type { BalanceBubbleRow, BalanceView, CustomNode } from '../types.ts';

/** 一种展示形态向两端的展示层提供的全部规则。 */
export interface ShapeHandler {
  /** 已用百分比，驱动宠物档位动画；undefined 表示该形态给不出百分比语义 */
  percent(v: BalanceView): number | undefined;
  /** 收起态气泡行 */
  rows(v: BalanceView): BalanceBubbleRow[];
  /** 展开态气泡行；缺省表示没有额外读数，调用方回落到 rows */
  detail?(v: BalanceView): BalanceBubbleRow[];
  /** 第三页：区间累计用量；返回 undefined 表示该服务商没有这项数据，气泡只有两页 */
  usage?(v: BalanceView): BalanceBubbleRow[] | undefined;
  /** custom：多页节点树，第一项为初始页；缺省表示该形态不走树 */
  views?(v: BalanceView): CustomNode[] | undefined;
}
