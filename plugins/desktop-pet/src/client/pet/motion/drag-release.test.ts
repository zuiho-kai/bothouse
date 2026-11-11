/**
 * 松手结算（src/client/pet/motion/drag-release.ts）的契约测试：弹弓按拉距给力度、方向与拉向相反；
 * 非弹弓时轨迹够快就甩抛、轨迹为空或太慢就原地放下。
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { DEFAULT_PHYSICS } from '../../../shared/physics/constants.ts';
import { decideRelease, type ReleaseInput } from './drag-release.ts';

/** 基准输入：盒 200×112.5，按在中心，没拉也没动。 */
function input(overrides: Partial<ReleaseInput> = {}): ReleaseInput {
  return {
    box: { x: 400, y: 300 },
    anchor: { x: 500, y: 356.25 },
    half: { w: 100, h: 56.25 },
    size: 200,
    sling: false,
    trail: [],
    now: 1000,
    physics: DEFAULT_PHYSICS,
    ...overrides,
  };
}

describe('decideRelease —— 原地放下', () => {
  test('没有轨迹也不弹弓：原地放下', () => {
    assert.deepEqual(decideRelease(input()), { kind: 'place' });
  });

  test('轨迹太慢：原地放下', () => {
    const trail = [
      { t: 800, x: 500, y: 356 },
      { t: 900, x: 502, y: 356 },
    ];
    assert.deepEqual(decideRelease(input({ trail })), { kind: 'place' });
  });

  test('轨迹太旧：当作停下，原地放下', () => {
    const trail = [
      { t: 500, x: 500, y: 356 },
      { t: 520, x: 700, y: 356 },
    ];
    assert.deepEqual(decideRelease(input({ trail, now: 1000 })), { kind: 'place' });
  });
});

describe('decideRelease —— 甩抛', () => {
  test('向右快速划动：按位移方向起飞', () => {
    const trail = [
      { t: 950, x: 500, y: 356 },
      { t: 970, x: 600, y: 356 },
      { t: 990, x: 700, y: 356 },
    ];
    const decision = decideRelease(input({ trail }));
    assert.equal(decision.kind, 'throw');
    if (decision.kind !== 'throw') return;
    assert.ok(decision.velocity.vx > 0, `应向右飞：${decision.velocity.vx}`);
    assert.equal(Math.round(decision.velocity.vy), 0);
  });
});

describe('decideRelease —— 弹弓', () => {
  test('拉得越远力度越大，方向与拉向相反', () => {
    const near = decideRelease(input({ sling: true, box: { x: 480, y: 340 } }));
    const far = decideRelease(input({ sling: true, box: { x: 300, y: 250 } }));
    assert.equal(near.kind, 'sling');
    assert.equal(far.kind, 'sling');
    if (near.kind !== 'sling' || far.kind !== 'sling') return;
    assert.ok(far.power > near.power, `拉得远力度应更大：${far.power} vs ${near.power}`);
    // 拉到左上方 → 往右下飞。
    assert.ok(far.velocity.vx > 0, `应向右飞：${far.velocity.vx}`);
    assert.ok(far.velocity.vy > 0, `应向下飞：${far.velocity.vy}`);
  });

  test('没拉开就松手：力度为 0，速度也是 0', () => {
    const decision = decideRelease(input({ sling: true, box: { x: 400, y: 300 } }));
    assert.equal(decision.kind, 'sling');
    if (decision.kind !== 'sling') return;
    assert.equal(decision.dist, 0);
    assert.equal(decision.power, 0);
    assert.deepEqual(decision.velocity, { vx: 0, vy: 0 });
  });

  test('弹弓不看手速：慢慢拉到位再松手一样有速度', () => {
    const decision = decideRelease(
      input({
        sling: true,
        box: { x: 300, y: 300 },
        trail: [
          { t: 700, x: 300, y: 300 },
          { t: 990, x: 300, y: 300 },
        ],
      }),
    );
    assert.equal(decision.kind, 'sling');
    if (decision.kind !== 'sling') return;
    assert.ok(Math.hypot(decision.velocity.vx, decision.velocity.vy) > 0, '弹弓应产生速度');
  });
});
