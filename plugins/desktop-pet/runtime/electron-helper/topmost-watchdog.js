/**
 * 桌面 Helper 的置顶看门狗（纯判定，可被 node:test 直接加载）。
 * `WS_EX_TOPMOST` 只是样式位：不经 SetWindowPos(HWND_TOPMOST) 就不算真的落带，而点击穿透的读-改-写
 * 又会把位写回来——查位永远得 true，宠物却已经沉底。看门狗按节拍重钉一次，不移动、不缩放、不重绘、
 * 不抢焦点；代价是会把宠物抬到所有置顶窗口之上，打断全屏游戏与截图。
 * 默认关闭：成因未查明前不长时间挂一个高副作用的后台动作，重开前先接受上述代价。
 * @module dsh-pet/runtime/electron-helper/topmost-watchdog
 */

'use strict';

/** 看门狗节拍（ms）：多久做一次判定。判定本身不碰窗口，只决定这一拍要不要重钉 */
const TOPMOST_WATCHDOG_TICK_MS = 1000;

/** 重新置顶的最小间隔（ms）：真正的 SetWindowPos 至多这么频繁（避开与别的置顶窗抢带） */
const TOPMOST_REASSERT_MS = 5000;

/** macOS 使用普通悬浮层，为更高层级的截图窗口让位；其它平台保持原行为 */
function topmostLevel(platform) {
  return platform === 'darwin' ? 'floating' : 'screen-saver';
}

/**
 * 置顶看门狗总开关（唯一开关）。当前关闭：一次 SetWindowPos 都不发。
 *
 * 关闭后定时器仍按节拍空转（每秒一次纯判定，开销可忽略），因为源码守卫测试锚在
 * `topmostTimer = setInterval(...)` 上。
 */
const TOPMOST_WATCHDOG_ENABLED = false;

/**
 * 这一拍要不要重新置顶。
 *
 * 只在窗口健在、可见、未被冒烟自检挂起且距上次重钉已够久时返回 true：隐藏期间钉了没意义，
 * 自检期间钉了会干扰断言；这些条件随时会变，所以每秒判定一次、这一拍被拦就下一拍补上。
 *
 * @param state - nowMs/lastAssertMs/destroyed/visible/paused。
 * @param enabled - 默认 true，是判定逻辑本身的口径；生产由 main.js 显式传入总开关。
 * @returns 是否重钉。
 */
function shouldReassertTopmost(state, enabled = true) {
  if (!enabled) return false;
  const { nowMs, lastAssertMs, destroyed, visible, paused } = state || {};
  if (destroyed || !visible || paused) return false;
  const elapsed = nowMs - lastAssertMs;
  // 只有「时间正常流逝且还没到点」才不钉；时钟回拨/时间戳异常一律按到点处理（重钉无副作用）
  return !(elapsed >= 0 && elapsed < TOPMOST_REASSERT_MS);
}

module.exports = {
  TOPMOST_WATCHDOG_TICK_MS,
  TOPMOST_REASSERT_MS,
  TOPMOST_WATCHDOG_ENABLED,
  shouldReassertTopmost,
  topmostLevel,
};
