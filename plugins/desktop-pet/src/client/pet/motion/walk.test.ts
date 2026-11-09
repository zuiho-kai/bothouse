/**
 * 自主走位（src/client/pet/motion/walk.ts）的契约测试：起脚与收脚窗口内不位移、中途按播放时间线性插值、
 * 结束时提交目标比例只一次；停走取消帧且迟到的帧不再写样式；飞行中不发起新走位。
 * 用假 rAF 驱动，位置断言读写入的 style。
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { createWalk, type WalkDeps } from './walk.ts';
import type { MovesConfig } from '../../../shared/types.ts';

const viewport = { width: 1000, height: 500 };
const metrics = { size: 200, halfW: 100, halfH: 56.25, sideAllow: 62.5 };
const moves = {
  default: { minDist: 80, maxDist: 120, margin: 16, leadSec: 0.2, tailSec: 0.3 },
  actions: [{ name: 'walk1' }],
} as unknown as MovesConfig;

/** 假根节点：只留被写的四个 style 字段。 */
function fakeRoot() {
  return { style: { left: '', top: '', right: '', bottom: '' } } as unknown as HTMLDivElement;
}

/** 假视频：只看时长与播放进度。 */
function fakeVideo(duration: number) {
  return { duration, currentTime: 0 } as unknown as HTMLVideoElement;
}

/** 装假 rAF。 */
function withFakeFrames() {
  const previousRaf = globalThis.requestAnimationFrame;
  const previousCancel = globalThis.cancelAnimationFrame;
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
  return {
    tick(): void {
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
    },
  };
}

/** 造一套依赖：记录播放的动画、提交的位置与朝向。 */
function harness(extra: Partial<WalkDeps> = {}) {
  const root = fakeRoot();
  const played: string[] = [];
  const commits: Array<{ rx: number; ry: number }> = [];
  const boxes: Array<{ x: number; y: number }> = [];
  const deps: WalkDeps = {
    root: () => root,
    center: () => ({ x: 500, y: 250 }),
    metrics: () => metrics,
    moves: () => moves,
    facing: () => 'right',
    viewport: () => viewport,
    isFlying: () => false,
    play: (anim) => played.push(anim),
    setBox: (box) => boxes.push(box),
    commit: (center) => commits.push(center),
    ...extra,
  };
  return { walk: createWalk(deps), root, played, commits, boxes };
}

describe('createWalk —— 规划与占用', () => {
  test('没有可用走位动作：tryMove 返回 false，且不占用', () => {
    const frames = withFakeFrames();
    try {
      const { walk, played } = harness({ moves: () => ({ default: {}, actions: [] }) as unknown as MovesConfig });
      assert.equal(walk.tryMove(), false);
      assert.equal(walk.hasPending(), false);
      assert.deepEqual(played, []);
    } finally {
      frames.restore();
    }
  });

  test('规划成功：返回动作名、播该动作并留下待走的走位', () => {
    const frames = withFakeFrames();
    try {
      const { walk, played } = harness();
      assert.equal(walk.tryMove(), 'walk1');
      assert.equal(walk.hasPending(), true);
      assert.deepEqual(played, ['walk1']);
    } finally {
      frames.restore();
    }
  });

  test('飞行中不发起走位：吞掉这一拍（返回 true），不播也不排队', () => {
    const frames = withFakeFrames();
    try {
      const { walk, played } = harness({ isFlying: () => true });
      assert.equal(walk.tryMove(), true);
      assert.equal(walk.hasPending(), false);
      assert.deepEqual(played, []);
    } finally {
      frames.restore();
    }
  });

  test('走位进行中再发一次：返回 true，不覆盖当前这条', () => {
    const frames = withFakeFrames();
    try {
      const { walk, played } = harness();
      walk.tryMove();
      walk.start(fakeVideo(10));
      assert.equal(walk.tryMove(), true);
      assert.equal(played.length, 1);
      assert.equal(frames.queued, 1);
    } finally {
      frames.restore();
    }
  });
});

describe('createWalk —— 按播放时间推进', () => {
  test('没有待走的走位：start 不开帧', () => {
    const frames = withFakeFrames();
    try {
      const { walk } = harness();
      walk.start(fakeVideo(10));
      assert.equal(frames.queued, 0);
    } finally {
      frames.restore();
    }
  });

  test('起脚窗口内停在起点，收脚窗口外到目标并只提交一次', () => {
    const frames = withFakeFrames();
    try {
      const { walk, root, commits } = harness();
      walk.tryMove();
      const video = fakeVideo(10);
      walk.start(video);

      video.currentTime = 0.1; // <= leadSec 0.2：仍在起点
      frames.tick();
      const startX = parseFloat(root.style.left);
      assert.ok(Math.abs(startX - (0.5 * viewport.width - metrics.halfW)) < 1e-6, `起点应为 0.5 比例：${startX}`);

      video.currentTime = 5; // 行进中：位置应已离开起点
      frames.tick();
      assert.ok(parseFloat(root.style.left) !== startX, '行进中位置应变化');
      assert.equal(commits.length, 0);

      video.currentTime = 9.8; // >= duration - tailSec：已经到位
      frames.tick();
      assert.equal(frames.queued, 0, '到位后不再排帧');
    } finally {
      frames.restore();
    }
  });

  test('到位后提交的是目标比例，不是终点处的插值', () => {
    const frames = withFakeFrames();
    try {
      const { walk, commits } = harness();
      walk.tryMove();
      const video = fakeVideo(10);
      walk.start(video);
      video.currentTime = 10;
      frames.tick();
      assert.equal(commits.length, 1);
      const target = commits[0]!;
      assert.ok(target.rx > 0.5, `向右走应落在起点右侧：${target.rx}`);
      assert.equal(target.ry, 0.5);
    } finally {
      frames.restore();
    }
  });
  test('负距离：向 facing 反方向走 → 行进中在起点左侧，结束停在左侧', () => {
    const frames = withFakeFrames();
    try {
      const negative = {
        default: { minDist: -120, maxDist: -80, margin: 16, leadSec: 0.2, tailSec: 0.3 },
        actions: [{ name: 'walk1' }],
      } as unknown as MovesConfig;
      const { walk, root, commits } = harness({ moves: () => negative });
      walk.tryMove();
      const video = fakeVideo(10);
      walk.start(video);

      const startX = 0.5 * viewport.width - metrics.halfW;
      video.currentTime = 3; // 行进中：应已离开起点、且落在起点左侧
      frames.tick();
      assert.ok(parseFloat(root.style.left) < startX, `负距离应往左走：${root.style.left}`);

      video.currentTime = 9.8; // 收脚：停在规划落点，不跳回起点右侧
      frames.tick();
      assert.equal(commits.length, 1);
      assert.ok(commits[0]!.rx < 0.5, `目标应在起点左侧：${commits[0]!.rx}`);
    } finally {
      frames.restore();
    }
  });

  test('每帧回写包围盒：与写进 DOM 的 left 同源', () => {
    const frames = withFakeFrames();
    try {
      const { walk, root, boxes } = harness();
      walk.tryMove();
      const video = fakeVideo(10);
      walk.start(video);
      video.currentTime = 5;
      frames.tick();
      assert.equal(boxes.length, 1, '每帧只写一次包围盒');
      assert.equal(boxes[0]!.x + 'px', root.style.left, '包围盒与 DOM 应来自同一次计算');
    } finally {
      frames.restore();
    }
  });
});

describe('createWalk —— 停走', () => {
  test('停走取消帧：之后不再写样式、不提交位置', () => {
    const frames = withFakeFrames();
    try {
      const { walk, root, commits } = harness();
      walk.tryMove();
      const video = fakeVideo(10);
      walk.start(video);
      video.currentTime = 5;
      frames.tick();
      const leftBeforeStop = root.style.left;

      walk.stop();
      assert.equal(frames.queued, 0, '停走后不应还有排队的帧');
      video.currentTime = 6;
      frames.tick();
      assert.equal(root.style.left, leftBeforeStop, '停走后位置应冻结');
      assert.equal(commits.length, 0);
    } finally {
      frames.restore();
    }
  });

  test('停走清掉待走的走位：之后视频就绪也不会开跑', () => {
    const frames = withFakeFrames();
    try {
      const { walk } = harness();
      walk.tryMove();
      walk.stop();
      assert.equal(walk.hasPending(), false);
      walk.start(fakeVideo(10));
      assert.equal(frames.queued, 0);
    } finally {
      frames.restore();
    }
  });
});
