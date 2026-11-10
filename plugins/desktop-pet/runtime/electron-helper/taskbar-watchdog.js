/**
 * 桌面任务栏看门狗（纯判定，可被 node:test 直接加载）。
 * Windows 上 `skipTaskbar` 只是一次 `ITaskbarList::DeleteTab`，不写 `WS_EX_TOOLWINDOW`：shell 一旦
 * 重建任务栏（explorer 崩溃重启、唤醒、显示器拓扑变化），按钮就会重新登记出来，而重建时机不可枚举。
 * 看门狗按固定节拍重新摘一次——`DeleteTab` 幂等、无视觉副作用，重复调用不会打断全屏或抢焦点。
 * @module dsh-pet/runtime/electron-helper/taskbar-watchdog
 */

'use strict';

/** 看门狗节拍（ms）：shell 重建任务栏后，最迟这么久把按钮摘回去 */
const TASKBAR_WATCHDOG_TICK_MS = 3000;

/** 看门狗默认开关；生产由 main.js 按 DSH_PET_TASKBAR_WATCHDOG 环境变量覆盖 */
const TASKBAR_WATCHDOG_ENABLED = true;

/**
 * 这一拍要不要重申 skipTaskbar。
 *
 * @param platform - process.platform。
 * @param enabled - 总开关；缺省取 TASKBAR_WATCHDOG_ENABLED。
 * @returns 仅 Windows 且开启时为 true。
 */
function shouldRunTaskbarWatchdog(platform, enabled = TASKBAR_WATCHDOG_ENABLED) {
  return enabled && platform === 'win32';
}

/**
 * 解析环境变量开关：只有显式 `0` / `false` 才关闭，缺失或写坏时保持开启。
 *
 * @param raw - `DSH_PET_TASKBAR_WATCHDOG` 的原始值。
 * @returns 是否启用看门狗。
 */
function taskbarWatchdogEnabledFromEnv(raw) {
  return raw !== '0' && raw !== 'false';
}

module.exports = {
  TASKBAR_WATCHDOG_ENABLED,
  TASKBAR_WATCHDOG_TICK_MS,
  shouldRunTaskbarWatchdog,
  taskbarWatchdogEnabledFromEnv,
};
