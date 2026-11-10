/**
 * Q 弹挤压（src/client/pet/motion/squash.ts）的契约测试：逐帧缩放且结束帧复原 origin 与镜像；
 * 新的挤压取消旧的（迟到的帧不再写样式）；系统开了「减少动效」时完全不改样式。
 * 用假 rAF / performance.now / matchMedia 驱动，不依赖真实动画时钟。
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { createSquashDriver } from './squash.ts';

/** 假视频元素：只留被写的三个 style 字段。 */
function fakeVideo() {
  return { style: { transform: '', transformOrigin: '' } } as unknown as HTMLVideoElement;
}

/** 装一套假时钟与 rAF，返回推进一帧的入口与还原函数。 */
function withFakeFrames(options: { reducedMotion?: boolean } = {}) {
  const previousRaf = globalThis.requestAnimationFrame;
  const previousCancel = globalThis.cancelAnimationFrame;
  const previousNow = performance.now;
  const previousWindow = (globalThis as { window?: unknown }).window;
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
  // Node 里没有 window：只补上被测代码用到的 matchMedia。
  (globalThis as { window?: unknown }).window = {
    matchMedia: (query: string) => ({ matches: options.reducedMotion === true, media: query }),
  };

  return {
    /** 推进若干毫秒并跑掉当前排队的帧。 */
    tick(ms: number): void {
      now += ms;
      const due = pending;
      pending = [];
      for (const entry of due) entry.cb();
    },
    /** 还有没有排队中的帧。 */
    get queued(): number {
      return pending.length;
    },
    restore(): void {
      (globalThis as { requestAnimationFrame?: unknown }).requestAnimationFrame = previousRaf;
      (globalThis as { cancelAnimationFrame?: unknown }).cancelAnimationFrame = previousCancel;
      performance.now = previousNow;
      (globalThis as { window?: unknown }).window = previousWindow;
    },
  };
}

describe('createSquashDriver —— Q 弹挤压', () => {
  test('逐帧压扁，结束帧复原 origin 与镜像', () => {
    const frames = withFakeFrames();
    try {
      const el = fakeVideo();
      const driver = createSquashDriver({ facing: () => 'right' });
      driver.start(el);
      frames.tick(0);
      assert.equal(el.style.transformOrigin, 'bottom', '挤压期间以底边为原点');
      assert.ok(el.style.transform.includes('scaleY('), '逐帧写纵向缩放');
      assert.ok(el.style.transform.includes('scaleX(-1)'), '朝向是右时要保留镜像');

      frames.tick(10_000); // 远超时长，落到结束帧
      assert.equal(el.style.transformOrigin, '', 'origin 复原');
      assert.equal(el.style.transform, 'scaleX(-1)', '结束只留镜像');
      assert.equal(frames.queued, 0, '结束后不再排队');
    } finally {
      frames.restore();
    }
  });

  test('新的挤压取消旧的：旧帧迟到也要作废', () => {
    const frames = withFakeFrames();
    try {
      const first = fakeVideo();
      const second = fakeVideo();
      const driver = createSquashDriver({ facing: () => 'left' });
      driver.start(first);
      frames.tick(0);
      const firstTransform = first.style.transform;

      driver.start(second);
      frames.tick(50);
      // 旧元素不该再被写；它停在取消前那一帧。
      assert.equal(first.style.transform, firstTransform, '被取消的那次不再写样式');
      assert.ok(second.style.transform.includes('scaleY('), '新的一次继续跑');
    } finally {
      frames.restore();
    }
  });

  test('stop 后不再写样式', () => {
    const frames = withFakeFrames();
    try {
      const el = fakeVideo();
      const driver = createSquashDriver({ facing: () => 'left' });
      driver.start(el);
      frames.tick(0);
      const frozen = el.style.transform;
      driver.stop();
      frames.tick(100);
      assert.equal(el.style.transform, frozen);
      assert.equal(frames.queued, 0);
    } finally {
      frames.restore();
    }
  });

  test('减少动效：完全不碰样式', () => {
    const frames = withFakeFrames({ reducedMotion: true });
    try {
      const el = fakeVideo();
      const driver = createSquashDriver({ facing: () => 'left' });
      driver.start(el);
      assert.equal(el.style.transform, '');
      assert.equal(el.style.transformOrigin, '');
      assert.equal(frames.queued, 0, '一次帧都不该排');
    } finally {
      frames.restore();
    }
  });
});
