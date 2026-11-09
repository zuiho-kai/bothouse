/**
 * 桌面几何：把逐显示器的 bounds/workArea 汇总成渲染端要的 hull、逐屏区域与完整面板（纯计算，不碰 Electron）。
 * macOS 把工作区顶边放开到面板顶边（宠物可进入菜单栏条带），但保留 Dock 一侧的排除。
 * @module dsh-pet/runtime/electron-helper/desktop-geometry
 */
'use strict';

const { HIT_BOX, STAGE_W, CANVAS_H, FEET_Y } = require('./pointer-target.js');

/**
 * 由显示器列表算出桌面几何（屏幕坐标）。
 *
 * @param displays - 显示器列表（含 bounds/workArea/id）。
 * @param primaryId - 主屏 id。
 * @param platform - process.platform。
 */
function buildDeskGeometry(displays, primaryId, platform) {
  const workAreas = displays.map((d) => ({ ...d.workArea }));
  const panels = displays.map((d) => ({ ...d.bounds }));
  const areas = workAreas.map((a, i) => {
    if (platform !== 'darwin') return { ...a };
    // 保留 Dock 的底部/两侧排除，但可见高度要顶到面板上沿。
    return { ...a, y: panels[i].y, height: a.y + a.height - panels[i].y };
  });
  const x = Math.min(...areas.map((a) => a.x));
  const y = Math.min(...areas.map((a) => a.y));
  return {
    hull: {
      x,
      y,
      width: Math.max(...areas.map((a) => a.x + a.width)) - x,
      height: Math.max(...areas.map((a) => a.y + a.height)) - y,
    },
    areas,
    workAreas,
    panels,
    primaryIndex: Math.max(
      0,
      displays.findIndex((d) => d.id === primaryId),
    ),
    topInsetRatio: platform === 'darwin' ? (HIT_BOX.y0 + CANVAS_H - FEET_Y) / STAGE_W : 0,
  };
}

module.exports = { buildDeskGeometry };
