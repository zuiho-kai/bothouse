/**
 * 面板落点（`pickPanelPosition`）的几何测试。
 *
 * 钉住一条不变量：新面板不与任何已展开面板相交；窗口太窄时退化为夹取，不越界。
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { type PanelBox, pickPanelPosition } from './position.ts';

/** 视口坐标里的夹取范围（窗口 ∩ 工作区）。 */
const CLAMP = { x: 0, y: 0, w: 900, h: 520 };

/** 由左上角与尺寸造矩形。 */
const box = (left: number, top: number, w: number, h: number): PanelBox => ({
  left,
  top,
  right: left + w,
  bottom: top + h,
});

/** 两个矩形是否严格相交（边贴边不算）。 */
const overlaps = (a: PanelBox, b: PanelBox): boolean =>
  a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;

describe('pickPanelPosition —— 级联面板不重叠', () => {
  const panel = { w: 220, h: 320 };

  test('二级：父面板右侧放得下 → 贴父面板右边，且不相交', () => {
    const parent = box(100, 100, 220, 320);
    const p = pickPanelPosition({
      panel,
      item: { left: 100, right: 320, top: 120 },
      parent: { left: parent.left, right: parent.right, top: parent.top },
      others: [parent],
      clamp: CLAMP,
    });
    assert.ok(!overlaps(box(p.left, p.top, panel.w, panel.h), parent), '子面板不应压住父面板');
    assert.equal(p.left, parent.right + 4, '右侧放得下时应贴父面板右侧');
  });

  test('二级：右侧放不下 → 翻到父面板左侧（不是触发项左侧）', () => {
    const parent = box(560, 100, 220, 320);
    const p = pickPanelPosition({
      panel,
      item: { left: 560, right: 780, top: 120 },
      parent: { left: parent.left, right: parent.right, top: parent.top },
      others: [parent],
      clamp: CLAMP,
    });
    assert.ok(!overlaps(box(p.left, p.top, panel.w, panel.h), parent), '翻左后不应压住父面板');
    assert.equal(p.left, parent.left - 4 - panel.w, '应贴父面板左侧，而不是触发项左侧');
  });

  test('三级：右侧放不下时不得压到二级或一级', () => {
    const l1 = box(0, 100, 220, 320);
    const l2 = box(224, 120, 220, 320);
    const p = pickPanelPosition({
      panel,
      item: { left: 224, right: 444, top: 140 },
      parent: { left: l2.left, right: l2.right, top: l2.top },
      others: [l1, l2],
      clamp: CLAMP,
    });
    const rect = box(p.left, p.top, panel.w, panel.h);
    assert.ok(!overlaps(rect, l1), '三级不应压住一级');
    assert.ok(!overlaps(rect, l2), '三级不应压住二级');
  });

  test('候选全被占用时，优先选不重叠的位置（即使脱离紧贴父面板）', () => {
    const l1 = box(0, 0, 220, 520);
    const l2 = box(224, 0, 220, 520);
    const p = pickPanelPosition({
      panel: { w: 220, h: 200 },
      item: { left: 224, right: 444, top: 10 },
      parent: { left: l2.left, right: l2.right, top: l2.top },
      others: [l1, l2],
      clamp: CLAMP,
    });
    const rect = box(p.left, p.top, 220, 200);
    assert.ok(!overlaps(rect, l1) && !overlaps(rect, l2), '仍有重叠');
  });

  test('落点始终完整落在 clamp 内（含四个边界的极端父面板位置）', () => {
    const cases = [
      box(0, 0, 220, 320),
      box(680, 0, 220, 320),
      box(0, 200, 220, 320),
      box(680, 200, 220, 320),
      box(340, 100, 220, 320),
    ];
    for (const parent of cases) {
      const p = pickPanelPosition({
        panel: { w: 220, h: 200 },
        item: { left: parent.left, right: parent.right, top: parent.top + 10 },
        parent: { left: parent.left, right: parent.right, top: parent.top },
        others: [parent],
        clamp: CLAMP,
      });
      assert.ok(p.left >= 4 - 0.5, 'left 越界：' + JSON.stringify(p));
      assert.ok(p.left + 220 <= 896 + 0.5, 'right 越界：' + JSON.stringify(p));
      assert.ok(p.top >= 4 - 0.5, 'top 越界：' + JSON.stringify(p));
      assert.ok(p.top + 200 <= 516 + 0.5, 'bottom 越界：' + JSON.stringify(p));
    }
  });

  test('窗口很窄（任何位置都会重叠）时退化为夹取，而不是返回越界坐标', () => {
    const narrow = { x: 0, y: 0, w: 260, h: 200 };
    const parent = box(0, 0, 220, 180);
    const p = pickPanelPosition({
      panel: { w: 220, h: 120 },
      item: { left: 0, right: 220, top: 10 },
      parent: { left: 0, right: 220, top: 0 },
      others: [parent],
      clamp: narrow,
    });
    assert.ok(p.left >= 4 - 0.5 && p.left + 220 <= 260 - 4 + 0.5, 'left 越界');
    assert.ok(p.top >= 4 - 0.5 && p.top + 120 <= 200 - 4 + 0.5, 'top 越界');
  });

  test('没有其它面板时与旧行为一致（右侧展开、顶对齐触发项）', () => {
    const p = pickPanelPosition({
      panel: { w: 220, h: 320 },
      item: { left: 100, right: 320, top: 150 },
      parent: { left: 100, right: 320, top: 100 },
      others: [],
      clamp: CLAMP,
    });
    assert.deepEqual(p, { left: 324, top: 150 });
  });
});
