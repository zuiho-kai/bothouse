/**
 * 全局 DPI 线性化的纯判定与纯换算（不 require electron，可被 node:test 直接加载）。
 * Windows 的 DIP↔物理换算是逐显示器仿射变换，骑缝时两套坐标系横跳：启动前强制 device scale
 * factor = 1 把各屏塌缩成恒等映射，再按探测到的真实主屏缩放补偿回原观感。macOS 的 DIP 即「点」，
 * 该开关只改 backing store、不产生需要补偿的差异，故 darwin 一律不启用；探测与接线不在本文件。
 * @module dsh-pet/runtime/electron-helper/dpi-linearization
 */

'use strict';

/**
 * 是否启用全局 DPI 线性化（并强制 device scale factor）。
 *
 * @param o.platform - process.platform。
 * @param o.dpiProbe - 本进程是否就是探测子进程（探测子进程再做一次会无限递归）。
 * @param o.forceDsf - DSH_PET_FORCE_DSF 原始值（'0' = 关闭本机制；正数 = 排障用覆盖）。
 * @returns 是否启用。
 */
function shouldLinearize(o = {}) {
  if (o.dpiProbe) return false; // 探测子进程自己不做
  if (String(o.forceDsf ?? '') === '0') return false; // 排障开关：整个机制关掉
  if (o.platform === 'darwin') return false; // macOS：DIP 已是「点」，没有可补偿的东西
  return true;
}

/**
 * 实际要强制成的 device scale factor（0 = 不启用）。
 *
 * 正数覆盖优先；探测到真实主屏缩放才锁死 1（恒等映射）；探测失败返回 0——
 * 宁可退回逐屏 DIP 行为，也不做没有补偿的缩放。
 *
 * @param o.forceDsf - 排障覆盖值。
 * @param o.primaryScale - 探测到的主屏缩放。
 * @returns 强制值。
 */
function resolveForcedScale(o = {}) {
  const override = Number(o.forceDsf);
  if (Number.isFinite(override) && override > 0) return override;
  return Number(o.primaryScale) > 0 ? 1 : 0;
}

/**
 * 渲染端的 CONFIG.scale = 宿主给的基准 × 物理像素补偿。
 *
 * 只有线性化确实生效且探测到真实主屏缩放时才补偿，否则等于基准（base 缺省/非法回落 1）。
 */
function resolvePetScale(o = {}) {
  const base = Number(o.baseScale ?? '1') || 1;
  const forced = Number(o.forcedScale) || 0;
  const primary = Number(o.primaryScale) || 0;
  return forced > 0 && primary > 0 ? base * (primary / forced) : base;
}

module.exports = {
  shouldLinearize,
  resolveForcedScale,
  resolvePetScale,
};
