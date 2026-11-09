'use strict';
/**
 * 显示器热更新：分辨率、缩放、插拔与旋转都会让桌面几何失效，这里重算并推给所有窗口。
 *
 * 事件会连发，去抖后只重算一次；主屏缩放可能一起变，线性化生效时只刷新缓存、提示重启。
 * @module dsh-pet/runtime/electron-helper/main/displays
 */

/**
 * 订阅显示器变化并推送。
 *
 * @param deps.screen - Electron screen。
 * @param deps.petWindows - 窗口能力（几何、窗口表、任务栏）。
 * @param deps.dpi - DPI 能力（forcedScale / primaryScale / probePrimaryScale）。
 * @returns 立即重算一次与去抖重算两个入口。
 */
function createDisplaySync({ screen, petWindows, dpi }) {
  // 显示器热更新：分辨率/缩放变化、插拔屏、旋转都会让桌面几何失效（原先只在建窗时经 query 注入
  // 一次，运行期永不更新）。这里重算并推给所有窗口，渲染端就地重挂。
  let displaysTimer = null;
  const pushDisplays = () => {
    const geo = petWindows.geometry();
    petWindows.state.lastRequestedBounds.clear(); // 坐标系变了，去重缓存作废，下一帧必须真的重设一次
    for (const win of petWindows.state.windows.values()) {
      if (win.isDestroyed()) continue;
      // 显示器拓扑变化同样是任务栏按钮重建的时机
      petWindows.keepOffTaskbar(win);
      win.webContents.send('pet:displays', geo);
    }
    console.error('[dsh-pet-desktop-helper] displays changed: ' + JSON.stringify(geo));
    // 主屏缩放可能一起变了：线性化生效期间 screen API 只报被强制的值，真实值只能靠探测子进程拿；
    // 不一致就刷新缓存，下次启动自动用上。
    if (dpi.forcedScale > 0) {
      setTimeout(() => {
        const real = dpi.probePrimaryScale();
        if (real > 0 && Math.abs(real - dpi.primaryScale) > 1e-6) {
          console.error(
            '[dsh-pet-desktop-helper] primary scaleFactor changed ' +
              dpi.primaryScale +
              ' -> ' +
              real +
              '; restart the desktop pet to resize',
          );
        }
      }, 1000).unref?.();
    }
  };
  /** 显示器事件会连发（一次改动能来好几条），去抖后只重算一次 */
  const scheduleDisplays = () => {
    if (displaysTimer) clearTimeout(displaysTimer);
    displaysTimer = setTimeout(() => {
      displaysTimer = null;
      pushDisplays();
    }, 300);
  };
  screen.on('display-metrics-changed', scheduleDisplays);
  screen.on('display-added', scheduleDisplays);
  screen.on('display-removed', scheduleDisplays);

  return { push: pushDisplays, schedule: scheduleDisplays };
}

module.exports = { createDisplaySync };
