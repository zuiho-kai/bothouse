/**
 * 落地挤压：按冲击速度换算出瞬时压扁比例。
 *
 * 不做碰撞检测、不改位置；只回答「这一下该压多扁」。
 * 必须始终成立：返回值落在 [SQ_MAX_SQUASH, 0.8]，超出即视为调用方算错了速度。
 * @module dsh-pet/src/shared/physics/squash
 */
import { SQ_HARD_SPEED, SQ_MAX_SQUASH, SQ_SOFT_SPEED, SQ_SQUASH } from './constants.ts';

/** 落地冲击速度 → 下压幅度（速度越大压得越狠），结果作为 startSquash 的 squash 参数。 */
export const landingSquash = (impactSpeed: number): number => {
  const t = Math.min(Math.max((Math.abs(impactSpeed) - SQ_SOFT_SPEED) / (SQ_HARD_SPEED - SQ_SOFT_SPEED), 0), 1);
  return Math.min(0.8, 1 - t * (1 - SQ_MAX_SQUASH));
};

/** Q 弹挤压曲线：u∈[0,1] 进度 → scaleY。
 *  下压段（0~0.45）ease-in 压缩，回弹段（0.45~1）easeOutBack 带回约 4% 过冲，两端共用同一曲线。 */
export const squashScale = (u: number, squash: number = SQ_SQUASH): number => {
  if (u < 0.45) {
    const p = u / 0.45;
    return 1 - (1 - squash) * p * p;
  }
  const p = (u - 0.45) / 0.55;
  // easeOutBack 的标准过冲系数
  const c1 = 1.70158;
  const c3 = c1 + 1;
  const f = 1 + c3 * Math.pow(p - 1, 3) + c1 * Math.pow(p - 1, 2);
  return Math.min(1.12, squash + (1 - squash) * Math.max(f, 0));
};
