/**
 * 宠物之间的碰撞：包围盒换算、重叠判定与一次弹性分离。
 *
 * 不做多体求解，也不改渲染；只回答「撞没撞、撞后速度多少」。
 * 必须始终成立：只算一次分离，不迭代求解。
 * @module dsh-pet/src/shared/physics/collide
 */
import { HIT_BOX } from '../constants.ts';
import { PET_BOUNCE_E } from './constants.ts';

/** 一只参与碰撞的宠物：位置（包围盒左上角，px）+ 速度（px/s）+ 宽（px，质量 ∝ size²）。 */
export interface PetCollider {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
}

/** 身体包围盒（HIT_BOX 命中框比例换算到视口像素）：碰撞相交检测的几何。
 *  box = 宠物包围盒左上角（浏览器 root 的 left/top、桌面窗口位置）；
 *  bottomPad = 舞台脚底垫高（stage 被 translateY 下移的量）。 */
export const bodyPixelBox = (o: {
  x: number;
  y: number;
  size: number;
  bottomPad: number;
}): { left: number; top: number; right: number; bottom: number } => {
  const h = (o.size * 9) / 16;
  return {
    left: o.x + (HIT_BOX.x0 / 640) * o.size,
    top: o.y + o.bottomPad + (HIT_BOX.y0 / 360) * h,
    right: o.x + (HIT_BOX.x1 / 640) * o.size,
    bottom: o.y + o.bottomPad + (HIT_BOX.y1 / 360) * h,
  };
};

/** 两矩形是否相交（碰撞检测）。 */
export const rectsOverlap = (
  a: { left: number; top: number; right: number; bottom: number },
  b: { left: number; top: number; right: number; bottom: number },
): boolean => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;

/** 飞行中的宠物撞到另一只：近乎弹性碰撞（动量守恒 + 恢复系数 0.995），质量 ∝ size²。
 *  法向 = 两包围盒中心连线，法向速度按一维动量公式重分配，切向分量各自保留（无切向摩擦）。
 *  返回 null = 中心重合定不出法向，或两者正在分离（避免重叠帧反复弹跳抖动）。
 *  impactSpeed 是法向相对速度，供触觉反馈换算强度。 */
export const collidePet = (
  fly: PetCollider,
  hit: PetCollider,
): { fvx: number; fvy: number; hvx: number; hvy: number; impactSpeed: number } | null => {
  const hf = (fly.size * 9) / 16 / 2;
  const hh = (hit.size * 9) / 16 / 2;
  const cx = hit.x + hit.size / 2 - (fly.x + fly.size / 2);
  const cy = hit.y + hh - (fly.y + hf);
  const dist = Math.hypot(cx, cy);
  if (dist < 1e-6) return null; // 中心重合：无法定碰撞法向，跳过本帧
  const nx = cx / dist;
  const ny = cy / dist;
  // 相对速度在法向的投影（碰撞方向 = fly → hit，正 = 正在接近）
  const vrel = (fly.vx - hit.vx) * nx + (fly.vy - hit.vy) * ny;
  if (vrel <= 0) return null; // 正在分离：不再弹（避免重叠帧反复触发）
  const e = PET_BOUNCE_E;
  const m1 = fly.size * fly.size;
  const m2 = hit.size * hit.size;
  const v1n = fly.vx * nx + fly.vy * ny;
  const v2n = hit.vx * nx + hit.vy * ny;
  const v1n2 = ((m1 - e * m2) * v1n + (1 + e) * m2 * v2n) / (m1 + m2);
  const v2n2 = ((m2 - e * m1) * v2n + (1 + e) * m1 * v1n) / (m1 + m2);
  // 组合：切向分量（原速度 − 法向分量）不变 + 新法向分量
  return {
    fvx: fly.vx - v1n * nx + v1n2 * nx,
    fvy: fly.vy - v1n * ny + v1n2 * ny,
    hvx: hit.vx - v2n * nx + v2n2 * nx,
    hvy: hit.vy - v2n * ny + v2n2 * ny,
    impactSpeed: vrel,
  };
};

/**
 * 两个身体框重叠时的最短推出位移：只算几何、不碰速度。
 *
 * 速度交换（{@link collidePet}）在两者正在分离时返回 null，光靠它会让已经插在一起的两只
 * 直接穿过去；补这一个纯位移量才能把它们推开。
 *
 * @param a - 自己的身体框。
 * @param b - 对方的身体框。
 * @returns 推 a 离 b 的位移（各让一半）；不重叠时返回 `null`。
 */
export const overlapPush = (
  a: { left: number; top: number; right: number; bottom: number },
  b: { left: number; top: number; right: number; bottom: number },
): { dx: number; dy: number } | null => {
  const ox = Math.min(a.right, b.right) - Math.max(a.left, b.left);
  const oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
  if (ox <= 0 || oy <= 0) return null;
  const alongX = ox <= oy;
  const sign = alongX
    ? (a.left + a.right) / 2 >= (b.left + b.right) / 2
      ? 1
      : -1
    : (a.top + a.bottom) / 2 >= (b.top + b.bottom) / 2
      ? 1
      : -1;
  return alongX ? { dx: (sign * ox) / 2, dy: 0 } : { dx: 0, dy: (sign * oy) / 2 };
};

/** 共享碰撞站场的槽位（每只宠物注册一个；浏览器半侧 PetMulti 与桌面端的碰撞 broker 共用）。 */
export interface PetCollisionSlot {
  /** 宠物宽（px，质量 ∝ size²） */
  size: number;
  /** 舞台脚底垫高（bodyPixelBox 需要） */
  bottomPad: number;
  /** 当前包围盒左上角（px）；null = 未挂载或无位置 */
  getBox: () => { x: number; y: number } | null;
  /** 当前速度（px/s）；没在运动时为 0 */
  getVel: () => { vx: number; vy: number };
  /** 写入碰撞结算后的**绝对**速度（px/s）：由宠物自己按当前模式落地——在动就改速度，没动就以此起飞。 */
  applyVelocity: (vx: number, vy: number) => void;
}
