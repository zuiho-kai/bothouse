/**
 * 抛掷指令的初速换算单元测试 —— 钉住 `POST /throw` 文档里那张表。
 *
 * 为什么单独钉：契约里写死了两件容易被无声改掉的事——
 *   1. 角度方向：`0` = 正右、逆时针为正（屏幕坐标 y 向下，所以 `vy` 取负号）。
 *      搞反了第三方会发现"往上抛"变成了往下砸，而代码本身不会报任何错；
 *   2. 力度锚点：`power = 1.0` 对应软钳速前的 1200 px/s，实际初速约 1021 px/s。
 *      调一下锚点或限速公式，文档里的数字就成假话了。
 *
 * 跑法：node --experimental-strip-types --test src/shared/physics.test.ts
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  MAX_STEP_DT,
  MAX_THROW_SPEED,
  SUBSTEP_MAX,
  SUBSTEP_PX,
  THROW_SPEED_ANCHOR,
  pullAngle,
  slingshotPower,
  slingshotRefDist,
  slingshotVelocity,
  softClampSpeed,
  throwSubsteps,
  throwVelocity,
} from './physics.ts';

/** 初速大小（throwVelocity 的模长） */
const speedOf = (angle: number, power: number): number => {
  const v = throwVelocity(angle, power);
  return Math.hypot(v.vx, v.vy);
};

describe('throwVelocity —— 角度方向（0 = 正右，逆时针为正）', () => {
  test('0° 正右：vx > 0 且 vy ≈ 0', () => {
    const v = throwVelocity(0, 1);
    assert.ok(v.vx > 0, 'vx 应为正');
    assert.ok(Math.abs(v.vy) < 1e-9, 'vy 应为 0');
  });

  test('90° 正上：vy < 0（屏幕坐标 y 向下，故取负号）且 vx ≈ 0', () => {
    const v = throwVelocity(90, 1);
    assert.ok(v.vy < 0, '90° 必须是往上抛——vy 为负');
    assert.ok(Math.abs(v.vx) < 1e-9, 'vx 应为 0');
  });

  test('-90° 正下：vy > 0', () => {
    assert.ok(throwVelocity(-90, 1).vy > 0);
  });

  test('180° 正左：vx < 0', () => {
    assert.ok(throwVelocity(180, 1).vx < 0);
  });

  test('任意实数角度都成立（超出 0~360 按周期折算，调用方不必自己归一化）', () => {
    const a = throwVelocity(450, 1);
    const b = throwVelocity(90, 1);
    assert.ok(Math.abs(a.vx - b.vx) < 1e-9 && Math.abs(a.vy - b.vy) < 1e-9, '450° 应等价于 90°');
  });
});

describe('throwVelocity —— 力度锚点与软上限', () => {
  test('power = 1.0 的实际初速 ≈ 1021 px/s（软钳速前是 1200）', () => {
    const speed = speedOf(0, 1);
    assert.ok(Math.abs(speed - 1020.5) < 1, `实际初速应约 1020.5，得到 ${speed}`);
    assert.ok(speed < THROW_SPEED_ANCHOR, '软上限必须真的压低了它——否则文档那张表是错的');
  });

  test('power = 3.0 的实际初速 ≈ 2276 px/s', () => {
    assert.ok(Math.abs(speedOf(0, 3) - 2275.6) < 1);
  });

  test('随 power 单调递增，且恒不超过 MAX_THROW_SPEED', () => {
    let prev = 0;
    for (const p of [0.001, 0.1, 0.5, 1, 2, 3, 5, 10, 100, 1e6]) {
      const s = speedOf(45, p);
      assert.ok(s > prev, `power=${p} 的初速应严格大于更小的 power（单调可区分）`);
      assert.ok(s <= MAX_THROW_SPEED, `power=${p} 的初速不得超过软上限`);
      prev = s;
    }
    assert.ok(speedOf(45, 1e6) > MAX_THROW_SPEED * 0.99, '极大 power 应渐近软上限');
  });

  test('方向与力度解耦：任意角度下模长只由 power 决定', () => {
    const want = speedOf(0, 2);
    for (const angle of [0, 37, 90, -123, 271]) {
      assert.ok(Math.abs(speedOf(angle, 2) - want) < 1e-9, `angle=${angle}`);
    }
  });
});

describe('softClampSpeed —— 抛掷指令与拖拽甩抛共用同一条限速', () => {
  test('非正数 → 0（不产生反向速度）', () => {
    assert.equal(softClampSpeed(0), 0);
    assert.equal(softClampSpeed(-100), 0);
  });

  test('渐近不超过 MAX_THROW_SPEED（极大输入下取等号，不是超过）', () => {
    assert.ok(softClampSpeed(MAX_THROW_SPEED) < MAX_THROW_SPEED);
    // exp(-1000) 在 float64 下下溢成 0，所以这里会恰好取到上限——契约是"不超过"，取等合法
    assert.equal(softClampSpeed(MAX_THROW_SPEED * 1000), MAX_THROW_SPEED);
  });
});

describe('pullAngle —— 弹射方向是拉的**反方向**', () => {
  test('往左拉 → 正右（0°，与 throwVelocity 的「0 = 正右」同一套）', () => {
    assert.equal(pullAngle(-100, 0), 0);
    assert.ok(slingshotVelocity(pullAngle(-100, 0), 1).vx > 0);
  });

  test('往上拉 → 向下落（-90°，vy 为正 = 屏幕向下）', () => {
    const angle = pullAngle(0, -100);
    assert.ok(Math.abs(angle + 90) < 1e-9, `角度应为 -90°，得到 ${angle}`);
    assert.ok(slingshotVelocity(angle, 1).vy > 0, '往上拉必须往下落（反方向）');
  });

  test('往下拉 → 向上弹（90°，vy 为负）', () => {
    const angle = pullAngle(0, 100);
    assert.ok(Math.abs(angle - 90) < 1e-9);
    assert.ok(slingshotVelocity(angle, 1).vy < 0);
  });

  test('往右拉 → 向左弹（180°）', () => {
    assert.ok(Math.abs(Math.abs(pullAngle(100, 0)) - 180) < 1e-9);
    assert.ok(slingshotVelocity(pullAngle(100, 0), 1).vx < 0);
  });

  test('斜向左下拉 → 向右上弹（vx > 0 且 vy < 0）', () => {
    const v = slingshotVelocity(pullAngle(-100, 100), 1);
    assert.ok(v.vx > 0, '往左拉要往右弹');
    assert.ok(v.vy < 0, '往下拉要往上弹');
  });
});

describe('slingshotPower —— 距离即力度：线性、单调、无上限', () => {
  const SIZE = 462;

  test('拉距 = 参考距离 → 恰好 1 倍力度', () => {
    assert.equal(slingshotPower(slingshotRefDist(SIZE), SIZE), 1);
  });

  test('线性：2 倍 / 10 倍拉距 = 2 倍 / 10 倍力度', () => {
    const ref = slingshotRefDist(SIZE);
    assert.equal(slingshotPower(ref * 2, SIZE), 2);
    assert.equal(slingshotPower(ref * 10, SIZE), 10);
  });

  test('没有上界：再远的拉距也不会被夹到 1（这正是「按距离给力度」的意义）', () => {
    let prev = 0;
    for (const dist of [1, 10, 100, 1000, 10000, 100000]) {
      const p = slingshotPower(dist, SIZE);
      assert.ok(p > prev, `拉距 ${dist} 的力度必须严格大于更近的拉距`);
      prev = p;
    }
    assert.ok(slingshotPower(slingshotRefDist(SIZE) * 100, SIZE) === 100, '100 倍拉距就该是 100 倍力度');
  });

  test('0 / 负数 / 非有限 / 尺寸非法 → 0（不产生反向或 NaN 力度）', () => {
    for (const dist of [0, -50, NaN, Infinity]) {
      assert.equal(slingshotPower(dist, SIZE), 0, `dist=${dist}`);
    }
    assert.equal(slingshotPower(100, 0), 0, 'size=0 不该除出 Infinity');
  });

  test('参考距离随尺寸缩放：同样拉距，小宠物力度更大', () => {
    assert.ok(slingshotPower(200, 300) > slingshotPower(200, 600));
  });
});

describe('slingshotVelocity —— 同一力度锚点，但不吃软上限', () => {
  test('power = 1 就是 1200 px/s（THROW_SPEED_ANCHOR，不被软钳速压到 1021）', () => {
    const v = slingshotVelocity(0, 1);
    assert.ok(Math.abs(Math.hypot(v.vx, v.vy) - THROW_SPEED_ANCHOR) < 1e-9);
    assert.ok(Math.abs(v.vx - THROW_SPEED_ANCHOR) < 1e-9);
  });

  test('power = 5 → 6000 px/s，可以超过 MAX_THROW_SPEED（弹弓无上限）', () => {
    const speed = Math.hypot(slingshotVelocity(0, 5).vx, slingshotVelocity(0, 5).vy);
    assert.equal(speed, THROW_SPEED_ANCHOR * 5);
    assert.ok(speed > MAX_THROW_SPEED, '必须真的突破软钳速——否则「无上限」是假的');
  });

  test('同一 power 下 throwVelocity 被压住、slingshotVelocity 不被压', () => {
    const clamped = Math.hypot(throwVelocity(0, 10).vx, throwVelocity(0, 10).vy);
    const raw = Math.hypot(slingshotVelocity(0, 10).vx, slingshotVelocity(0, 10).vy);
    assert.ok(clamped < raw);
    assert.ok(Math.abs(raw - THROW_SPEED_ANCHOR * 10) < 1e-9);
  });

  test('physics.throwPower（总力度）线性生效：与拖拽甩抛共用同一个配置', () => {
    const base = Math.hypot(slingshotVelocity(30, 2).vx, slingshotVelocity(30, 2).vy);
    const strong = Math.hypot(slingshotVelocity(30, 2, 2).vx, slingshotVelocity(30, 2, 2).vy);
    assert.equal(strong, base * 2);
  });

  test('负的 power / throwPower 一律按 0 处理，不反向', () => {
    assert.deepEqual(slingshotVelocity(45, -3), { vx: 0, vy: 0 });
    assert.deepEqual(slingshotVelocity(45, 1, -2), { vx: 0, vy: 0 });
  });

  test('方向与力度解耦：任意角度下模长只由 power 决定', () => {
    const want = Math.hypot(slingshotVelocity(0, 3).vx, slingshotVelocity(0, 3).vy);
    for (const angle of [0, 37, 90, -123, 271]) {
      const v = slingshotVelocity(angle, 3);
      assert.ok(Math.abs(Math.hypot(v.vx, v.vy) - want) < 1e-9, `angle=${angle}`);
    }
  });
});

describe('throwSubsteps —— 细分是积分精度，不是力度上限', () => {
  test('普通甩抛（每帧位移 ≤ 8px）→ 1 步，与旧的单步积分逐位相同', () => {
    assert.equal(throwSubsteps(300, 0, 1 / 60), 1); // 5px/帧
    assert.equal(throwSubsteps(0, 0, 1 / 60), 1); // 静止也是 1 步（不能除 0）
  });

  test('高速弹射按单步位移上限拆步', () => {
    const dt = 1 / 60;
    const speed = 8000;
    assert.equal(throwSubsteps(speed, 0, dt), Math.ceil((speed * dt) / SUBSTEP_PX));
    // 拆完每一步都不超过上限
    const n = throwSubsteps(speed, 0, dt);
    assert.ok((speed * dt) / n <= SUBSTEP_PX);
  });

  test('步数上限 SUBSTEP_MAX 兜底（极端速度不会把一帧拖成几百次积分）', () => {
    assert.equal(throwSubsteps(1e6, 0, 1 / 60), SUBSTEP_MAX);
  });

  test('dt 按 MAX_STEP_DT 夹取：巨帧与上限帧算出同样的步数', () => {
    assert.equal(throwSubsteps(1000, 0, 10), throwSubsteps(1000, 0, MAX_STEP_DT));
  });
});
