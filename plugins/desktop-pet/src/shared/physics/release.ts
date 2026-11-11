/**
 * 甩抛初速估算：把一串指针采样折成起手速度，并给出弹弓拉距对应的力度。
 *
 * 不做积分、不改位置；输出只作为 throwStep 的初值。
 * 必须始终成立：采样间隔超出窗口即视为松手，不得跨窗口拼接速度。
 * @module dsh-pet/src/shared/physics/release
 */ import { type PhysicsParams } from '../types.ts';
import type { DragSample } from './throw.ts';
import {
  ACCEL_GAIN_MAX,
  ACCEL_REF,
  DEAD_ZONE_SPEED,
  DEFAULT_PHYSICS,
  DEFAULT_THROW_POWER,
  MIN_SPAN_MS,
  PEAK_WEIGHT,
  RELEASE_STALE_MS,
  RELEASE_WINDOW_MS,
  SEG_MIN_DT_MS,
  SLINGSHOT_REF_RATIO,
  THROW_SPEED_ANCHOR,
  TRAIL_KEEP_MS,
} from './constants.ts';
import { softClampSpeed } from './spring.ts';

/** 剔除保留窗口外的旧采样；采样按时间追加，所以只需从头裁。 */
export const trimTrail = (trail: DragSample[], now: number): DragSample[] => {
  const cutoff = now - TRAIL_KEEP_MS;
  let i = 0;
  while (i < trail.length && trail[i].t < cutoff) i++;
  return i === 0 ? trail : trail.slice(i);
};

/** 抛掷指令（POST /throw 的 angle + power）→ 初速度 (vx, vy)，px/s。
 *  angle 单位度，0 = 正右、逆时针为正——屏幕 y 向下，所以 vy 取负（往上抛写 90，不是 270）。
 *  初速 = power × THROW_SPEED_ANCHOR 再过既有软上限，任意 power 都单调可区分且不超过 MAX_THROW_SPEED。
 *  两端共用本函数，保证接口抛掷的初速换算严格一致。 */
export const throwVelocity = (angleDeg: number, power: number): { vx: number; vy: number } => {
  const speed = softClampSpeed(power * THROW_SPEED_ANCHOR);
  const rad = (angleDeg * Math.PI) / 180;
  return { vx: Math.cos(rad) * speed, vy: -Math.sin(rad) * speed };
};

/** 「一倍力度」的参考拉距（px），随宠物尺寸缩放——小宠物不必拖同样远才炸。 */
export const slingshotRefDist = (size: number): number => (size > 0 ? size * SLINGSHOT_REF_RATIO : 0);

/** 拉距 → 力度倍率（px / 参考拉距）：线性、单调、不夹取；0 拉距 = 0 力度。 */
export const slingshotPower = (dist: number, size: number): number => {
  const ref = slingshotRefDist(size);
  if (!(ref > 0) || !(dist > 0) || !Number.isFinite(dist)) return 0;
  return dist / ref;
};

/** 拉向量（起点 → 松手点，屏幕坐标，y 向下）→ 弹射角度（度）：弹的是拉的反方向，角度约定同 throwVelocity。 */
export const pullAngle = (pullX: number, pullY: number): number => (Math.atan2(pullY, -pullX) * 180) / Math.PI;

/** 弹弓初速：角度约定与力度锚点同 throwVelocity，但没有软上限（任意 power 都单调可区分）。 */
export const slingshotVelocity = (
  angleDeg: number,
  power: number,
  throwPower: number = DEFAULT_THROW_POWER,
): { vx: number; vy: number } => {
  const speed = THROW_SPEED_ANCHOR * Math.max(0, power) * Math.max(0, throwPower);
  // 0 力度直接给 0（而不是算出来 cos/sin 的 -0）：叶子里的速度要能当普通数字比较
  if (speed === 0) return { vx: 0, vy: 0 };
  const rad = (angleDeg * Math.PI) / 180;
  return { vx: Math.cos(rad) * speed, vy: -Math.sin(rad) * speed };
};

/** 由拖拽轨迹估算松手初速 (vx, vy)，px/s。
 *  方向取窗口首末端点的位移（抗抖）；大小 = 端点平均与窗口峰值按 PEAK_WEIGHT 加权，
 *  末段仍在加速时按 ACCEL_REF 给增益（最多 ACCEL_GAIN_MAX），再过软钳速。
 *  软钳速之后整体乘 physics.throwPower，让初速与死区判定一起线性缩放。
 *  返回 null = 温柔放下（轨迹为空 / 停留过久 / 窗口太短 / 峰值低于死区），调用方不抛。 */
export const estimateReleaseVelocity = (
  trail: DragSample[],
  now: number,
  physics: PhysicsParams = DEFAULT_PHYSICS,
): { vx: number; vy: number } | null => {
  if (trail.length === 0) return null;
  const last = trail[trail.length - 1];
  if (now - last.t > RELEASE_STALE_MS) return null;
  const win = trail.filter((s) => now - s.t <= RELEASE_WINDOW_MS);
  if (win.length < 2) return null;
  const t0 = win[0].t;
  const x0 = win[0].x;
  const y0 = win[0].y;
  const t1 = win[win.length - 1].t;
  const x1 = win[win.length - 1].x;
  const y1 = win[win.length - 1].y;
  const spanMs = t1 - t0;
  if (spanMs < MIN_SPAN_MS) return null;
  const baseVx = ((x1 - x0) / spanMs) * 1000;
  const baseVy = ((y1 - y0) / spanMs) * 1000;
  const baseSpeed = Math.hypot(baseVx, baseVy);
  if (baseSpeed < 1e-6) return null; // 窗口内几乎纯抖动：没有可靠方向，按原地放下处理
  // 分段速度（过密采样向前合并，dt 下限 SEG_MIN_DT_MS）
  const segSpeeds: { speed: number; tEnd: number }[] = [];
  let px = x0;
  let py = y0;
  let pt = t0;
  for (const s of win.slice(1)) {
    const dt = s.t - pt;
    if (dt >= SEG_MIN_DT_MS) {
      segSpeeds.push({ speed: (Math.hypot(s.x - px, s.y - py) / dt) * 1000, tEnd: s.t });
      px = s.x;
      py = s.y;
      pt = s.t;
    }
  }
  const peakSpeed = segSpeeds.length ? Math.max(...segSpeeds.map((v) => v.speed)) : baseSpeed;
  // 末段加速度：末段峰值速度相对首段的斜率，仍在加速的甩动据此放大初速
  let accel = 0;
  if (segSpeeds.length >= 2) {
    const lastSeg = segSpeeds[segSpeeds.length - 1];
    const firstSeg = segSpeeds[0];
    accel = (lastSeg.speed - firstSeg.speed) / Math.max((lastSeg.tEnd - firstSeg.tEnd) / 1000, MIN_SPAN_MS / 1000);
  }
  const speedBeforeClamp =
    ((1 - PEAK_WEIGHT) * baseSpeed + PEAK_WEIGHT * peakSpeed) *
    (1 + Math.min(Math.max(accel, 0) / ACCEL_REF, 1) * ACCEL_GAIN_MAX);
  const speed = softClampSpeed(speedBeforeClamp) * physics.throwPower;
  if (speed < DEAD_ZONE_SPEED) return null;
  return { vx: (baseVx / baseSpeed) * speed, vy: (baseVy / baseSpeed) * speed };
};
