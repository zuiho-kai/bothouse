/**
 * 设置页浮层定位的契约测试。
 *
 * 四条契约：
 *   1. 默认向下展开：浮层顶边贴触发器底边往下 4px，高度不超过 360px；
 *   2. 下方放不下且上方更宽裕才翻上去，翻上去时给的是 `bottom`（贴着触发器顶边往上）；
 *   3. 宽度夹在 [下限, min(上限, 视口宽 - 16)] 内，左右钳制到视口内不越界；
 *   4. 下限与上限可由调用方覆盖：单行下拉传 0 即跟触发器等宽。
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { computePanelPlacement } from './placement.ts';

const anchor = { left: 100, top: 300, bottom: 328, width: 340 };

describe('computePanelPlacement —— 浮层定位', () => {
  test('空间充足：向下展开，宽度取触发器宽度', () => {
    const pos = computePanelPlacement(anchor, { width: 1280, height: 900 });
    assert.equal(pos.left, 100);
    assert.equal(pos.top, 332, '触发器底边 + 4px 偏移');
    assert.equal(pos.bottom, undefined, '向下展开时不能同时给 bottom');
    assert.equal(pos.width, 340);
    assert.equal(pos.maxHeight, Math.min(360, 900 - 328 - 12), '高度受下方剩余空间限制');
  });

  test('下方不足且上方更宽裕：翻到上方，底边贴触发器顶边', () => {
    // 视口高 400，触发器底边 380 → 下方只剩 8；上方 288 更宽裕。
    const pos = computePanelPlacement({ left: 100, top: 352, bottom: 380, width: 340 }, { width: 1280, height: 400 });
    assert.equal(pos.top, undefined, '翻上去时不能同时给 top');
    assert.equal(pos.bottom, 400 - 352 + 4, '底边 = 视口高 - 触发器顶边 + 4px');
    assert.equal(pos.maxHeight, Math.min(360, 352 - 12), '高度受上方剩余空间限制');
  });

  test('下方不足但上方更小：仍然向下展开，只是高度被压缩', () => {
    // 触发器靠近顶部：上方 88、下方 250；下方 250 >= 240 阈值，不翻。
    const pos = computePanelPlacement({ left: 100, top: 100, bottom: 128, width: 340 }, { width: 1280, height: 400 });
    assert.equal(pos.top, 132);
    assert.equal(pos.maxHeight, 400 - 128 - 12);
  });

  test('宽度下限 240：窄触发器也按 240 渲染', () => {
    const pos = computePanelPlacement({ left: 10, top: 300, bottom: 320, width: 60 }, { width: 1280, height: 900 });
    assert.equal(pos.width, 240);
  });

  test('宽度上限：视口很宽也不超过 420', () => {
    const pos = computePanelPlacement({ left: 10, top: 300, bottom: 320, width: 900 }, { width: 2000, height: 900 });
    assert.equal(pos.width, 420);
  });

  test('视口很窄：宽度让位给视口（不留 16px 以外的余量），且左右不越界', () => {
    const pos = computePanelPlacement({ left: 200, top: 300, bottom: 320, width: 340 }, { width: 300, height: 900 });
    assert.equal(pos.width, 284, '视口 300 - 16');
    assert.equal(pos.left, 8, '右侧放不下就贴左边界 8px');
  });

  test('左边界钳制：触发器贴视口左边时浮层不越出左侧', () => {
    const pos = computePanelPlacement({ left: 0, top: 300, bottom: 320, width: 340 }, { width: 1280, height: 900 });
    assert.equal(pos.left, 8);
  });

  test('覆盖下限为 0：单行下拉跟触发器等宽，不被撑到 240', () => {
    const pos = computePanelPlacement(
      { left: 100, top: 300, bottom: 328, width: 120 },
      { width: 1280, height: 900 },
      { minWidthPx: 0 },
    );
    assert.equal(pos.width, 120);
  });

  test('覆盖高度上限与翻面阈值：小清单不因空间富余就撑到 360', () => {
    const pos = computePanelPlacement(anchor, { width: 1280, height: 900 }, { maxHeightPx: 200, flipThresholdPx: 100 });
    assert.equal(pos.maxHeight, 200);
    assert.equal(pos.top, 332);
  });
});
