/**
 * 自主走位规划（src/client/pet/motion/move-action.ts）的契约测试。
 *
 * 三条契约：
 *   1. 没有走位动作、或点播的名字不在池里 → `null`（调用方退回原地动作）；
 *   2. 距离随宠物尺寸等比缩放，方向只看朝向（right → +1，left → -1）；
 *   3. 目标越出边界 → `null`，绝不返回一个越界落点。
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { planMoveAction, type MoveActionInput } from './move-action.ts';
import { PET_REF_WIDTH } from '../../../shared/constants.ts';
import type { MovesConfig } from '../../../shared/types.ts';

const moves: MovesConfig = {
  default: { minDist: 80, maxDist: 120, margin: 16, leadSec: 0.2, tailSec: 0.3 },
  actions: [{ name: 'walk1' }, { name: 'walk2', params: { maxDist: 200 } }],
} as unknown as MovesConfig;

const base: MoveActionInput = {
  moves,
  facing: 'right',
  size: PET_REF_WIDTH,
  center: { x: 640, y: 400 },
  viewport: { width: 1280, height: 800 },
  halfW: 130,
  sideAllow: 20,
  // 固定取第 0 个动作，避免随机导致用例飘。
  random: () => 0,
};

describe('planMoveAction —— 自主走位规划', () => {
  test('没有走位动作：返回 null', () => {
    assert.equal(planMoveAction({ ...base, moves: { default: {}, actions: [] } as unknown as MovesConfig }), null);
  });

  test('点播名字不在池里：返回 null', () => {
    assert.equal(planMoveAction({ ...base, preferredName: 'nope' }), null);
  });

  test('点播命中：用池里那个动作的参数（maxDist 覆盖生效）', () => {
    const action = planMoveAction({ ...base, preferredName: 'walk2' });
    assert.ok(action);
    assert.equal(action.anim, 'walk2');
    // 基准尺寸下最大 200px：目标比例不会超过起点 + 200/视口宽
    assert.ok(action.pending.totalRatio <= 200 / base.viewport.width + 1e-9);
  });

  test('方向只看朝向：right → +1，left → -1', () => {
    const right = planMoveAction({ ...base, preferredName: 'walk1' });
    const left = planMoveAction({ ...base, facing: 'left', preferredName: 'walk1' });
    assert.equal(right?.pending.dir, 1);
    assert.equal(left?.pending.dir, -1);
    assert.ok((left?.pending.targetRatio ?? 0) < (right?.pending.targetRatio ?? 0));
  });

  test('距离随尺寸等比缩放：尺寸翻倍时走得更远', () => {
    const normal = planMoveAction({ ...base, preferredName: 'walk1', size: PET_REF_WIDTH });
    const big = planMoveAction({ ...base, preferredName: 'walk1', size: PET_REF_WIDTH * 2 });
    assert.ok((big?.pending.totalRatio ?? 0) > (normal?.pending.totalRatio ?? 0));
  });

  test('目标越界：返回 null，不返回越界落点', () => {
    // 贴着右边界、只剩 1px 余量时，最小 80px 的移动必然越界。
    const nearEdge = { ...base, center: { x: base.viewport.width - base.halfW - 18, y: 400 } };
    assert.equal(planMoveAction({ ...nearEdge, preferredName: 'walk1' }), null);
  });

  test('首尾留白随动作参数带出（rAF 驱动要用）', () => {
    const action = planMoveAction({ ...base, preferredName: 'walk1' });
    assert.equal(action?.pending.leadSec, 0.2);
    assert.equal(action?.pending.tailSec, 0.3);
  });
});
