/**
 * 形态到展示规则的分发表，也是余额展示按形态分发的唯一入口。
 *
 * 刻意写成 `Record<BalanceShape, ShapeHandler>` 而不是若干 if/switch：给 BalanceShape 加形态却
 * 忘了补 handler 时，类型检查会直接报缺少属性，而不是静默走进别的分支。
 *
 * @module dsh-pet/src/shared/balance/handlers/index
 */

import type { BalanceShape } from '../types.ts';
import { customHandler } from './custom.ts';
import { moneyHandler } from './money.ts';
import { pointsHandler } from './points.ts';
import type { ShapeHandler } from './shape.ts';
import { windowsHandler } from './windows.ts';

/** 每种形态的展示规则；新增形态必须在此补齐，否则类型检查报错。 */
export const HANDLERS: Record<BalanceShape, ShapeHandler> = {
  windows: windowsHandler,
  money: moneyHandler,
  points: pointsHandler,
  custom: customHandler,
};
