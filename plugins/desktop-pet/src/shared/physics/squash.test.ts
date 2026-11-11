/**
 * 落地挤压的纯决策测试：冲击速度 → 压扁比例，以及 Q 弹曲线的两端与过冲。
 *
 * 钉住的不变式：
 *   - landingSquash 落在 [SQ_MAX_SQUASH, 0.8] 且随冲击速度非增（速度越大压得越狠）；
 *   - squashScale 两端都回到 1，中段下压到 squash，回弹段带回约 4% 过冲但不超过 1.12。
 *
 * 跑法：node --experimental-strip-types --test src/shared/physics/squash.test.ts
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { landingSquash, squashScale } from './squash.ts';
import { SQ_HARD_SPEED, SQ_MAX_SQUASH, SQ_SOFT_SPEED, SQ_SQUASH } from './constants.ts';

describe('landingSquash —— 冲击速度 → 压扁比例', () => {
  test('低于软阈值不压：结果停在上界 0.8（Math.min 夹住）', () => {
    assert.equal(landingSquash(0), 0.8);
    assert.equal(landingSquash(SQ_SOFT_SPEED), 0.8);
    assert.equal(landingSquash(SQ_SOFT_SPEED - 1), 0.8);
  });

  test('高于硬阈值压到最扁：结果恒为 SQ_MAX_SQUASH', () => {
    assert.ok(Math.abs(landingSquash(SQ_HARD_SPEED) - SQ_MAX_SQUASH) < 1e-9);
    assert.equal(landingSquash(SQ_HARD_SPEED * 10), SQ_MAX_SQUASH);
  });

  test('取绝对值：向左落地与向右落地压得一样扁', () => {
    assert.equal(landingSquash(-900), landingSquash(900));
  });

  test('随冲击速度非增：更大速度不会压得更浅', () => {
    let prev = Infinity;
    for (const speed of [0, 200, 300, 600, 900, 1200, 1500, 2000]) {
      const value = landingSquash(speed);
      assert.ok(value <= prev + 1e-12, `speed=${speed} 时 ${value} 不应大于前一次的 ${prev}`);
      prev = value;
    }
  });

  test('结果始终落在 [SQ_MAX_SQUASH, 0.8]', () => {
    for (const speed of [-5000, -1, 0, 1, 300, 1500, 5000]) {
      const value = landingSquash(speed);
      assert.ok(value >= SQ_MAX_SQUASH && value <= 0.8, `speed=${speed} → ${value} 越界`);
    }
  });
});

describe('squashScale —— Q 弹曲线', () => {
  test('两端都回到 1：起手不压、收尾复原', () => {
    assert.equal(squashScale(0), 1);
    assert.ok(Math.abs(squashScale(1) - 1) < 1e-9);
  });

  test('下压段结束（u=0.45）恰好等于 squash 参数', () => {
    assert.ok(Math.abs(squashScale(0.45) - SQ_SQUASH) < 1e-9);
    const custom = 0.7;
    assert.ok(Math.abs(squashScale(0.45, custom) - custom) < 1e-9);
  });

  test('回弹段有 4% 左右的过冲，但被 1.12 夹住', () => {
    let peak = 0;
    for (let u = 0.45; u <= 1; u += 0.01) peak = Math.max(peak, squashScale(u));
    assert.ok(peak > 1, `回弹应过冲，实际峰值 ${peak}`);
    assert.ok(peak <= 1.12, `过冲不得超过 1.12，实际 ${peak}`);
  });

  test('squash 越接近 1，压得越浅（同一进度下）', () => {
    assert.ok(squashScale(0.2, 0.9) > squashScale(0.2, 0.55));
  });
});
