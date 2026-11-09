/**
 * 体感换算的单元测试：钉住三角函数映射、死区、横屏旋转、摇一摇的力度/方向，
 * 以及权限申请只问用得上的那一种传感器。
 *
 * 只测纯函数与可注入的全局对象——真实传感器与事件订阅要设备，不在这里覆盖。
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  requestMotionPermission,
  SHAKE_THRESHOLD,
  shakeImpulse,
  TILT_DEAD_ZONE_DEG,
  tiltGravity,
  type TiltSample,
} from './device-tilt.ts';

const FLAT: TiltSample = { beta: 0, gamma: 0 };

describe('tiltGravity —— 倾斜角度到重力向量', () => {
  test('没有倾斜 → 零向量', () => {
    assert.deepEqual(tiltGravity(FLAT, FLAT, 1400), { gx: 0, gy: 0 });
  });

  test('死区内 → 零向量（手抖不该让宠物一直滑）', () => {
    const near: TiltSample = { beta: TILT_DEAD_ZONE_DEG - 0.5, gamma: TILT_DEAD_ZONE_DEG - 0.5 };
    assert.deepEqual(tiltGravity(near, FLAT, 1400), { gx: 0, gy: 0 });
  });

  test('左右倾 30° → 水平分量是重力的一半', () => {
    const out = tiltGravity({ beta: 0, gamma: 30 }, FLAT, 1400);
    assert.ok(Math.abs(out.gx - 700) < 1e-9, `应为 700，实际 ${out.gx}`);
    assert.equal(out.gy, 0);
  });

  test('竖直 90° → 取满重力（配置值就是上限）', () => {
    const out = tiltGravity({ beta: 90, gamma: 0 }, FLAT, 1400);
    assert.ok(Math.abs(out.gy - 1400) < 1e-9, `应为 1400，实际 ${out.gy}`);
  });

  test('横屏（屏幕角 90°）→ 轴要换过来', () => {
    const out = tiltGravity({ beta: 0, gamma: 30 }, FLAT, 1400, 90);
    assert.ok(Math.abs(out.gx) < 1e-9, `横屏时水平倾斜不该进 gx，实际 ${out.gx}`);
    assert.ok(Math.abs(out.gy + 700) < 1e-9, `应为 -700，实际 ${out.gy}`);
  });

  test('重力为 0 或负数 → 零向量（不会凭空产生加速度）', () => {
    assert.deepEqual(tiltGravity({ beta: 30, gamma: 30 }, FLAT, 0), { gx: 0, gy: 0 });
    assert.deepEqual(tiltGravity({ beta: 30, gamma: 30 }, FLAT, -100), { gx: 0, gy: 0 });
  });

  test('基线附近跨越 ±90° 时取最近的角差，不反向', () => {
    const out = tiltGravity({ beta: 0, gamma: -89 }, { beta: 0, gamma: 89 }, 1400);
    assert.ok(out.gx > 0, `跨过 ±90 仍应指向同一侧，实际 ${out.gx}`);
  });
});

describe('shakeImpulse —— 摇一摇的冲量', () => {
  test('低于阈值 → null', () => {
    assert.equal(shakeImpulse(SHAKE_THRESHOLD - 1, 0, 0, 1), null);
    assert.equal(shakeImpulse(0, 0, 0, 1), null);
  });

  test('只有垂直方向（横向为零）→ null（方向不可用，不随机乱甩）', () => {
    assert.equal(shakeImpulse(0, 0, 100, 1), null);
  });

  test('方向与甩动方向一致（沿横向/纵向加速度向量）', () => {
    const out = shakeImpulse(30, 40, 0, 1);
    assert.ok(out);
    assert.ok(out.vx > 0 && out.vy > 0);
    assert.ok(Math.abs(out.vy / out.vx - 40 / 30) < 1e-9, '方向应为 3:4');
  });

  test('力度 = 基准 × throwPower', () => {
    const once = shakeImpulse(30, 40, 0, 1);
    const twice = shakeImpulse(30, 40, 0, 2);
    assert.ok(once && twice);
    assert.ok(Math.abs(twice.vx - once.vx * 2) < 1e-9, '总力度翻倍应让冲量翻倍');
    assert.ok(Math.abs(twice.vy - once.vy * 2) < 1e-9);
  });

  test('加速度越大力度越大，但有上限', () => {
    const soft = shakeImpulse(20, 0, 0, 1);
    const hard = shakeImpulse(100, 0, 0, 1);
    const insane = shakeImpulse(10000, 0, 0, 1);
    assert.ok(soft && hard && insane);
    assert.ok(hard.vx > soft.vx, '加速度更大应更猛');
    assert.equal(hard.vx, insane.vx, '超过封顶后不再涨');
  });
});

/** 临时装上假的传感器构造器（模拟 iOS 13+ 的 requestPermission）；返回撤销函数。 */
function stubSensorGlobals(stubs: Record<string, unknown>): () => void {
  const previous = new Map<string, unknown>();
  for (const [key, value] of Object.entries(stubs)) {
    previous.set(key, Reflect.get(globalThis, key));
    Reflect.set(globalThis, key, value);
  }
  return () => {
    for (const [key, value] of previous) Reflect.set(globalThis, key, value);
  };
}

/** 造一个会记录被问过哪种、并返回指定结果的假构造器。 */
function fakeCtor(label: string, asked: string[], answer: string): { requestPermission: () => Promise<string> } {
  return {
    requestPermission: async () => {
      asked.push(label);
      return answer;
    },
  };
}

describe('requestMotionPermission —— 只问用得上的种类', () => {
  test('只开倾斜：只申请 deviceorientation', async () => {
    const asked: string[] = [];
    const restore = stubSensorGlobals({
      DeviceOrientationEvent: fakeCtor('tilt', asked, 'granted'),
      DeviceMotionEvent: fakeCtor('shake', asked, 'granted'),
    });
    try {
      assert.equal(await requestMotionPermission({ tilt: true, shake: false }), true);
      assert.deepEqual(asked, ['tilt']);
    } finally {
      restore();
    }
  });

  test('只开摇一摇：只申请 devicemotion', async () => {
    const asked: string[] = [];
    const restore = stubSensorGlobals({
      DeviceOrientationEvent: fakeCtor('tilt', asked, 'granted'),
      DeviceMotionEvent: fakeCtor('shake', asked, 'granted'),
    });
    try {
      assert.equal(await requestMotionPermission({ tilt: false, shake: true }), true);
      assert.deepEqual(asked, ['shake']);
    } finally {
      restore();
    }
  });

  test('两个都关：不申请任何权限，直接成功', async () => {
    const asked: string[] = [];
    const restore = stubSensorGlobals({
      DeviceOrientationEvent: fakeCtor('tilt', asked, 'denied'),
      DeviceMotionEvent: fakeCtor('shake', asked, 'denied'),
    });
    try {
      assert.equal(await requestMotionPermission({ tilt: false, shake: false }), true);
      assert.deepEqual(asked, []);
    } finally {
      restore();
    }
  });

  test('任一种被拒 → false', async () => {
    const asked: string[] = [];
    const restore = stubSensorGlobals({
      DeviceOrientationEvent: fakeCtor('tilt', asked, 'granted'),
      DeviceMotionEvent: fakeCtor('shake', asked, 'denied'),
    });
    try {
      assert.equal(await requestMotionPermission({ tilt: true, shake: true }), false);
      assert.deepEqual(asked, ['tilt', 'shake'], '两种都要问过再下结论');
    } finally {
      restore();
    }
  });

  test('事件类型不存在（HTTP 非安全上下文）→ false', async () => {
    const restore = stubSensorGlobals({ DeviceOrientationEvent: undefined, DeviceMotionEvent: undefined });
    try {
      assert.equal(await requestMotionPermission({ tilt: true, shake: true }), false);
    } finally {
      restore();
    }
  });
});
