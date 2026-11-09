/**
 * 碰撞触觉反馈：把撞击速度换成一个单脉冲振动。
 *
 * 只做浏览器半侧——Vibration API 在 iOS 与桌面端都不存在，调用方不必为此分支。
 * 一次碰撞只震一下：贴地弹跳会连续多帧回报同一次落地，靠「同类撞击冷却窗口」吞掉。
 * @module dsh-pet/src/client/pet/haptics
 */

/** 同类撞击的冷却窗口（ms）：窗口内重复命中只震一次。 */
export const HAPTIC_COOLDOWN_MS = 120;

/** 低于这个撞击速度不震（px/s）：轻碰与静止都不该有反馈。 */
export const HAPTIC_MIN_SPEED = 150;

/** 手感锚点：与落地挤压同一组速度阈值——软碰取最短，硬砸取最长。 */
const SOFT_SPEED = 300;
const HARD_SPEED = 1500;
const SHORT_PULSE_MS = 10;
const LONG_PULSE_MS = 28;

/** 撞击种类，取值与物理侧的边名一致，另加宠物互撞。 */
export type ImpactKind = 'left' | 'right' | 'ceiling' | 'floor' | 'pet';

/**
 * 撞击速度 → 单次振动时长。
 *
 * @param speed - 撞击前的法向速度（px/s）。
 * @returns 时长（ms）；不该震时返回 `null`。
 */
export function pulseMsFor(speed: number): number | null {
  if (!Number.isFinite(speed) || speed < HAPTIC_MIN_SPEED) return null;
  const t = Math.min(1, Math.max(0, (speed - SOFT_SPEED) / (HARD_SPEED - SOFT_SPEED)));
  return Math.round(SHORT_PULSE_MS + (LONG_PULSE_MS - SHORT_PULSE_MS) * t);
}

/** 触觉反馈入口：一次撞击调一次。 */
export interface Haptics {
  /** 按撞击种类与速度决定要不要震、震多久。 */
  hit(kind: ImpactKind, speed: number): void;
}

/** 造触觉反馈；依赖可注入，便于在 Node 里断言而不碰真实硬件。 */
export function createHaptics(deps?: {
  vibrate?: (ms: number) => void;
  now?: () => number;
  enabled?: () => boolean;
}): Haptics {
  const vibrate = deps?.vibrate ?? hardwareVibrate;
  const now = deps?.now ?? (() => performance.now());
  const enabled = deps?.enabled ?? (() => true);
  /** 每类撞击上次震动的时刻；`undefined` = 还没震过。 */
  const lastAt = new Map<ImpactKind, number>();
  return {
    hit(kind: ImpactKind, speed: number): void {
      if (!enabled()) return;
      const ms = pulseMsFor(speed);
      if (ms === null) return;
      const at = now();
      const prev = lastAt.get(kind);
      if (prev !== undefined && at - prev < HAPTIC_COOLDOWN_MS) return;
      lastAt.set(kind, at);
      vibrate(ms);
    },
  };
}

/** 真实硬件：无 API、页面不可见或 WebView 抛错时静默跳过——触觉不是关键路径。 */
function hardwareVibrate(ms: number): void {
  if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return;
  if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
  try {
    navigator.vibrate(ms);
  } catch {
    // 部分 WebView 要求宿主声明 VIBRATE 权限，未声明时会抛；忽略即可。
  }
}
