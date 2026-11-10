/**
 * 宠物碰撞的纯决策测试：包围盒换算、重叠判定、一次弹性分离。
 *
 * 钉住的不变式：
 *   - 只算一次分离，不迭代求解；中心重合与「正在分离」都返回 null（否则重叠帧会反复弹跳）；
 *   - 法向按一维动量公式重分配，动量守恒，质量 ∝ size²；切向分量各自保留（无切向摩擦）。
 *
 * 跑法：node --experimental-strip-types --test src/shared/physics/collide.test.ts
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { bodyPixelBox, collidePet, overlapPush, rectsOverlap, type PetCollider } from './collide.ts';
import { PET_BOUNCE_E } from './constants.ts';
import { HIT_BOX } from '../constants.ts';

/** 造一只宠物（包围盒左上角 + 速度 + 宽）。 */
const pet = (x: number, y: number, vx: number, vy: number, size = 462): PetCollider => ({ x, y, vx, vy, size });

describe('bodyPixelBox —— 命中框比例换算到像素', () => {
  test('size=640 时换算成整数边界（命中框 200/50 → 440/335，按 640×360 折算）', () => {
    const box = bodyPixelBox({ x: 100, y: 200, size: 640, bottomPad: 30 });
    assert.deepEqual(box, {
      left: 100 + HIT_BOX.x0,
      top: 230 + HIT_BOX.y0,
      right: 100 + HIT_BOX.x1,
      bottom: 230 + HIT_BOX.y1,
    });
  });

  test('bottomPad 只作用在纵向：横向边界不随它移动', () => {
    const a = bodyPixelBox({ x: 0, y: 0, size: 462, bottomPad: 0 });
    const b = bodyPixelBox({ x: 0, y: 0, size: 462, bottomPad: 40 });
    assert.equal(a.left, b.left);
    assert.equal(a.right, b.right);
    assert.equal(b.top - a.top, 40);
    assert.equal(b.bottom - a.bottom, 40);
  });
});

describe('overlapPush —— 重叠时的几何推出', () => {
  const r = (left: number, top: number, right: number, bottom: number) => ({ left, top, right, bottom });

  test('不重叠 / 恰好贴边 → null', () => {
    assert.equal(overlapPush(r(0, 0, 10, 10), r(20, 0, 30, 10)), null);
    assert.equal(overlapPush(r(0, 0, 10, 10), r(10, 0, 20, 10)), null);
  });

  test('横向重叠更浅时沿水平推开，各让一半', () => {
    // 横向重叠 4，纵向重叠 8 → 沿 x 推 2
    assert.deepEqual(overlapPush(r(0, 0, 10, 10), r(6, 2, 16, 12)), { dx: -2, dy: 0 });
  });

  test('纵向重叠更浅时沿垂直推开', () => {
    assert.deepEqual(overlapPush(r(0, 0, 10, 10), r(2, 8, 12, 18)), { dx: 0, dy: -1 });
  });
});

describe('rectsOverlap —— 相交判定', () => {
  const r = (left: number, top: number, right: number, bottom: number) => ({ left, top, right, bottom });

  test('正常相交 → true', () => {
    assert.equal(rectsOverlap(r(0, 0, 10, 10), r(5, 5, 15, 15)), true);
  });

  test('边贴边不算相交（严格小于）：共享一条边就是恰好分开', () => {
    assert.equal(rectsOverlap(r(0, 0, 10, 10), r(10, 0, 20, 10)), false);
  });

  test('完全包含与完全分离', () => {
    assert.equal(rectsOverlap(r(0, 0, 100, 100), r(10, 10, 20, 20)), true);
    assert.equal(rectsOverlap(r(0, 0, 10, 10), r(20, 20, 30, 30)), false);
  });
});

describe('collidePet —— 一次弹性分离', () => {
  /** 质量 ∝ size² 的一维动量守恒检查。 */
  const momentum = (c: PetCollider, vn: number): number => c.size * c.size * vn;

  test('中心重合 → null（定不出法向，跳过本帧）', () => {
    assert.equal(collidePet(pet(0, 0, 100, 0), pet(0, 0, -100, 0)), null);
  });

  test('正在分离（相对速度沿法向为负）→ null，避免重叠帧反复触发', () => {
    // fly 在左、hit 在右，fly 却向左飞：两者在远离
    assert.equal(collidePet(pet(0, 0, -100, 0), pet(500, 0, 100, 0)), null);
  });

  test('正碰：法向速度按动量守恒重分配，总动量不变', () => {
    const fly = pet(0, 0, 200, 0);
    const hit = pet(500, 0, 0, 0);
    const out = collidePet(fly, hit);
    assert.ok(out, '应当判为碰撞');
    // 法向 = fly → hit 的方向 = +x
    const before = momentum(fly, fly.vx) + momentum(hit, hit.vx);
    const after = momentum(fly, out.fvx) + momentum(hit, out.hvx);
    assert.ok(Math.abs(before - after) < 1e-6, `动量应守恒：${before} vs ${after}`);
  });

  test('等质量正碰：接近交换速度（恢复系数 0.995 而非 1，故略小于完全交换）', () => {
    const fly = pet(0, 0, 100, 0);
    const hit = pet(500, 0, 0, 0);
    const out = collidePet(fly, hit);
    assert.ok(out);
    assert.ok(out.fvx >= 0 && out.fvx < 5, `飞宠应几乎停住，实际 ${out.fvx}`);
    assert.ok(out.hvx > 95 && out.hvx <= 100, `被撞宠应接近原速，实际 ${out.hvx}`);
  });

  test('质量差：小宠被撞后速度增幅更大（质量 ∝ size²）', () => {
    const out = collidePet(pet(0, 0, 200, 0, 640), pet(500, 0, 0, 0, 320));
    assert.ok(out);
    assert.ok(out.hvx > 200, `小宠应获得超过入射速度的分量，实际 ${out.hvx}`);
  });

  test('切向分量保留：纵向速度不因横向正碰而改变', () => {
    const fly = pet(0, 0, 200, 37);
    const hit = pet(500, 0, 0, -11);
    const out = collidePet(fly, hit);
    assert.ok(out);
    assert.ok(Math.abs(out.fvy - 37) < 1e-9, `飞宠切向应保持 37，实际 ${out.fvy}`);
    assert.ok(Math.abs(out.hvy - -11) < 1e-9, `被撞宠切向应保持 -11，实际 ${out.hvy}`);
  });

  test('impactSpeed 就是法向接近速度（触觉强度按它换算）', () => {
    const out = collidePet(pet(0, 0, 120, 0), pet(500, 0, 20, 0));
    assert.ok(out);
    assert.ok(Math.abs(out.impactSpeed - 100) < 1e-9, `应为 120-20=100，实际 ${out.impactSpeed}`);
  });

  test('恢复系数小于 1：相对法向速度的绝对值被按 e 缩小', () => {
    const fly = pet(0, 0, 100, 0);
    const hit = pet(500, 0, -100, 0);
    const out = collidePet(fly, hit);
    assert.ok(out);
    const before = Math.abs(fly.vx - hit.vx);
    const after = Math.abs(out.hvx - out.fvx);
    // 分离速度 = e × 接近速度
    assert.ok(Math.abs(after - e_ratio(before)) < 1e-6, `分离速度应为 e×接近速度：${after} vs ${e_ratio(before)}`);
  });
});

/** 弹性碰撞的分离速度：恢复系数 × 接近速度。 */
const e_ratio = (approach: number): number => PET_BOUNCE_E * approach;
