/**
 * 触觉反馈的单元测试：钉住速度阈值、时长映射与冷却窗口。
 *
 * 只测纯逻辑：`vibrate` 与时钟都注入，不碰真实硬件（Node 里也没有 Vibration API）。
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { createHaptics, HAPTIC_COOLDOWN_MS, HAPTIC_MIN_SPEED, pulseMsFor } from './haptics.ts';

describe('pulseMsFor —— 速度到单次时长', () => {
  test('低于下限、非数字 → 不震', () => {
    for (const speed of [0, HAPTIC_MIN_SPEED - 1, Number.NaN, Number.POSITIVE_INFINITY]) {
      assert.equal(pulseMsFor(speed), null, `${speed} 不该震`);
    }
  });

  test('下限处震最短，软碰与硬砸之间单调递增', () => {
    assert.equal(pulseMsFor(HAPTIC_MIN_SPEED), 10);
    assert.equal(pulseMsFor(300), 10);
    const mid = pulseMsFor(900);
    assert.ok(mid !== null && mid > 10 && mid < 28, `中速应落在区间内，实际 ${mid}`);
    assert.ok((pulseMsFor(2000) ?? 0) > (pulseMsFor(400) ?? 0), '越快越久');
  });

  test('超过硬锚点封顶 28ms', () => {
    assert.equal(pulseMsFor(1500), 28);
    assert.equal(pulseMsFor(9000), 28);
  });
});

describe('createHaptics —— 一次碰撞一次脉冲', () => {
  /** 假硬件：记录每次调用的时长。 */
  const fake = () => {
    const calls: number[] = [];
    let clock = 0;
    const haptics = createHaptics({
      vibrate: (ms) => calls.push(ms),
      now: () => clock,
      enabled: () => true,
    });
    return {
      calls,
      haptics,
      advance: (ms: number) => {
        clock += ms;
      },
    };
  };

  test('冷却窗口内同类撞击只震一次（贴地弹跳会连续多帧回报）', () => {
    const f = fake();
    f.haptics.hit('floor', 900);
    f.advance(HAPTIC_COOLDOWN_MS - 1);
    f.haptics.hit('floor', 900);
    assert.deepEqual(f.calls, [pulseMsFor(900)], '第二次应被吞掉');
    f.advance(2);
    f.haptics.hit('floor', 900);
    assert.equal(f.calls.length, 2, '过了窗口应重新震');
  });

  test('不同种类的撞击各有自己的冷却：撞墙不会吞掉落地', () => {
    const f = fake();
    f.haptics.hit('floor', 900);
    f.haptics.hit('left', 900);
    assert.equal(f.calls.length, 2);
  });

  test('速度不够不震', () => {
    const f = fake();
    f.haptics.hit('pet', 50);
    assert.deepEqual(f.calls, []);
  });

  test('开关关掉时完全静默', () => {
    const calls: number[] = [];
    const haptics = createHaptics({ vibrate: (ms) => calls.push(ms), now: () => 0, enabled: () => false });
    haptics.hit('floor', 2000);
    assert.deepEqual(calls, []);
  });
});
