/**
 * custom 形态：把第三方交来的节点树从视图里取出来。
 *
 * 本文件不产生文案，也不决定长什么样——布局、字号、颜色、进度条全由对方在树里声明。校验不在这里：
 * 解析层（parseCustomNode）已把 tag、样式与容量裁过一遍，到这里的数据视为可信，渲染器不再过滤。
 *
 * @module dsh-pet/src/shared/balance/handlers/custom
 */

import type { BalanceBubbleRow } from '../types.ts';
import type { ShapeHandler } from './shape.ts';

/** custom 形态的展示规则：只有百分比与节点树有值，行数据一律为空。 */
export const customHandler: ShapeHandler = {
  /** 百分比由第三方直接给（他才知道自己那套额度的分母）；没给则不播档位动画 */
  percent: (v) => v.custom?.percent,
  /** 行数据是内置形态的展示语言，custom 不参与，返回空数组兜底而不是错乱的行 */
  rows: (): BalanceBubbleRow[] => [],
  detail: (): BalanceBubbleRow[] => [],
  views: (v) => v.custom?.views,
};
