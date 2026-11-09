import { describe, expect, it } from 'vitest';
import { frameAt, frameIntervalMs, type SpriteSheet } from './frameAt';

/**
 * 帧位置计算 (#416-C)：精灵图按列数、行数切，第 n 帧贴在哪。
 *
 * 位置用百分比（background-position 的百分比是「元素宽 - 图宽」的几成），所以用例里能直接算出
 * 期望值，与元素最终多大无关。形状照 hunmer/aboutme-pets 的包：640×360、8 列、12fps。
 */

const sheet: SpriteSheet = { frameWidth: 640, frameHeight: 360, columns: 8, frames: 13 };

describe('frameAt', () => {
  it('第 0 帧在左上角', () => {
    expect(frameAt(0, sheet)).toEqual({ frame: 0, column: 0, row: 0, rows: 2, x: 0, y: 0 });
  });

  it('同一行的后续帧只往右挪，每列一格', () => {
    const box = frameAt(3, sheet);
    expect(box).toMatchObject({ frame: 3, column: 3, row: 0 });
    expect(box.x).toBeCloseTo((3 / 7) * 100);
    expect(box.y).toBe(0);
  });

  it('换行：第 8 帧回到第 1 列、第 2 行', () => {
    const box = frameAt(8, sheet);
    expect(box).toMatchObject({ frame: 8, column: 0, row: 1 });
    expect(box.x).toBe(0);
    expect(box.y).toBe(100);
  });

  it('最后一帧不满一行也在它自己的位置', () => {
    const box = frameAt(12, sheet);
    expect(box).toMatchObject({ frame: 12, column: 4, row: 1, rows: 2 });
  });

  it('超过最后一帧绕回开头，不越界', () => {
    expect(frameAt(13, sheet).frame).toBe(0);
    expect(frameAt(27, sheet).frame).toBe(1);
    expect(frameAt(13, sheet).x).toBe(0);
  });

  it('负数从末尾往前数', () => {
    expect(frameAt(-1, sheet).frame).toBe(12);
    expect(frameAt(-13, sheet).frame).toBe(0);
  });

  it('只有一列或一行时不做除零，停在原位', () => {
    const single = frameAt(0, { frameWidth: 10, frameHeight: 10, columns: 1, frames: 1 });
    expect(single).toEqual({ frame: 0, column: 0, row: 0, rows: 1, x: 0, y: 0 });
  });
});

describe('frameIntervalMs', () => {
  it('12fps 一帧约 83.3ms', () => {
    expect(frameIntervalMs(12)).toBeCloseTo(1000 / 12);
  });

  it('fps 不是正数时不播（0）', () => {
    expect(frameIntervalMs(0)).toBe(0);
    expect(frameIntervalMs(-1)).toBe(0);
  });
});
