/**
 * 位置跟随（src/client/pet/motion/position-follow.ts）的契约测试：instant 一帧到位不起 rAF；
 * line 在像素空间线性插值、到点精确落位；spring 靠收敛判定收尾；
 * 用户按着宠物时整拍丢弃、stop 之后迟到的帧不再写样式。
 * 用假 rAF / performance.now 驱动，落位结果由 commit 回调与写入的 style 断言。
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { createPositionFollow, type PositionFollowDeps } from './position-follow.ts';
import type { Center } from './geometry.ts';

const viewport = { width: 1000, height: 500 };
const half = { w: 100, h: 50 };

/** 假根节点：只留被写的四个 style 字段。 */
function fakeRoot() {
  return { style: { left: '', top: '', right: '', bottom: '' } } as unknown as HTMLDivElement;
}

/** 装假时钟与 rAF。 */
function withFakeFrames() {
  const previousRaf = globalThis.requestAnimationFrame;
  const previousCancel = globalThis.cancelAnimationFrame;
  const previousNow = performance.now;
  let now = 0;
  let pending: Array<{ id: number; cb: () => void }> = [];
  let seq = 0;
  (globalThis as { requestAnimationFrame?: unknown }).requestAnimationFrame = (cb: () => void) => {
    const id = ++seq;
    pending.push({ id, cb });
    return id;
  };
  (globalThis as { cancelAnimationFrame?: unknown }).cancelAnimationFrame = (id: number) => {
    pending = pending.filter((entry) => entry.id !== id);
  };
  performance.now = () => now;
  return {
    tick(ms: number): void {
      now += ms;
      const due = pending;
      pending = [];
      for (const entry of due) entry.cb();
    },
    get queued(): number {
      return pending.length;
    },
    restore(): void {
      (globalThis as { requestAnimationFrame?: unknown }).requestAnimationFrame = previousRaf;
      (globalThis as { cancelAnimationFrame?: unknown }).cancelAnimationFrame = previousCancel;
      performance.now = previousNow;
    },
  };
}

/** 造一套依赖 + 记录用的数组。 */
function harness(extra: Partial<PositionFollowDeps> = {}) {
  const root = fakeRoot();
  let box: { x: number; y: number } | null = null;
  const commits: Center[] = [];
  let tookOver = 0;
  const deps: PositionFollowDeps = {
    root: () => root,
    box: () => box,
    setBox: (next) => {
      box = next;
    },
    commit: (center) => commits.push(center),
    viewport: () => viewport,
    half: () => half,
    // 成品默认 throwPower = 1；这个值下弹簧 60 帧左右收敛。
    spring: () => 1,
    isDragging: () => false,
    takeOver: () => {
      tookOver += 1;
    },
    ...extra,
  };
  return {
    root,
    deps,
    commits,
    get box() {
      return box;
    },
    get tookOver() {
      return tookOver;
    },
  };
}

describe('createPositionFollow —— 位置跟随', () => {
  test('instant：一帧到位并提交，不起 rAF', () => {
    const frames = withFakeFrames();
    try {
      const h = harness();
      const follow = createPositionFollow(h.deps);
      follow.apply(0.5, 0.5, 'instant', 0);
      assert.deepEqual(h.commits, [{ rx: 0.5, ry: 0.5 }]);
      assert.deepEqual(h.box, { x: 400, y: 200 }, '中心换算成左上角');
      assert.equal(frames.queued, 0);
      assert.equal(h.tookOver, 1, '先接管再落位');
    } finally {
      frames.restore();
    }
  });

  test('line 时长为 0 视同 instant', () => {
    const frames = withFakeFrames();
    try {
      const h = harness();
      createPositionFollow(h.deps).apply(0.2, 0.4, 'line', 0);
      assert.equal(frames.queued, 0);
      assert.equal(h.commits.length, 1);
    } finally {
      frames.restore();
    }
  });

  test('line：像素空间插值，到点精确落位', () => {
    const frames = withFakeFrames();
    try {
      const h = harness();
      // 起点：中心 (0.1, 0.1) → 左上角 (0, 0)
      h.deps.setBox({ x: 0, y: 0 });
      const follow = createPositionFollow(h.deps);
      // 目标：中心 (0.5, 0.5) → 左上角 (400, 200)
      follow.apply(0.5, 0.5, 'line', 100);
      frames.tick(50);
      assert.equal(h.root.style.left, '200px', '半程应在中点上（像素插值）');
      assert.equal(h.root.style.top, '100px');
      assert.equal(h.commits.length, 0, '还没到点，不提交');

      frames.tick(60);
      assert.equal(h.root.style.left, '400px', '终点精确落位');
      assert.equal(h.root.style.top, '200px');
      assert.deepEqual(h.commits, [{ rx: 0.5, ry: 0.5 }]);
      assert.equal(frames.queued, 0, '到点后不再排队');
    } finally {
      frames.restore();
    }
  });

  test('spring：逐步逼近目标，收敛后精确落位并提交', () => {
    const frames = withFakeFrames();
    try {
      const h = harness();
      h.deps.setBox({ x: 0, y: 0 });
      const follow = createPositionFollow(h.deps);
      follow.apply(0.5, 0.5, 'spring', 0);
      // 弹簧要走若干帧才收敛；每帧 16ms，跑 200 帧足够。
      for (let i = 0; i < 200 && frames.queued > 0; i += 1) frames.tick(16);
      assert.deepEqual(h.commits, [{ rx: 0.5, ry: 0.5 }], '收敛后提交终点');
      assert.equal(h.root.style.left, '400px');
      assert.equal(h.root.style.top, '200px');
      assert.equal(frames.queued, 0);
    } finally {
      frames.restore();
    }
  });

  test('用户按着宠物：整拍丢弃，不接管也不落位', () => {
    const h = harness({ isDragging: () => true });
    createPositionFollow(h.deps).apply(0.5, 0.5, 'instant', 0);
    assert.equal(h.commits.length, 0);
    assert.equal(h.tookOver, 0);
  });

  test('stop 之后迟到的帧不再写样式', () => {
    const frames = withFakeFrames();
    try {
      const h = harness();
      h.deps.setBox({ x: 0, y: 0 });
      const follow = createPositionFollow(h.deps);
      follow.apply(0.5, 0.5, 'line', 100);
      frames.tick(30);
      const frozen = h.root.style.left;
      follow.stop();
      frames.tick(200);
      assert.equal(h.root.style.left, frozen, '停止后不再写');
      assert.equal(frames.queued, 0);
      assert.equal(h.commits.length, 0, '被停掉的那次不提交');
    } finally {
      frames.restore();
    }
  });
});
