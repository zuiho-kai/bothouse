/**
 * 点击积分：飞行中的宠物被点击时按速度与体型算分，速度越快、宠物越小分越高。
 * 不负责达标判定与展示——阈值由调用方判，弹窗与粒子在 score-popup。
 * 依赖 constants 的基准宠物宽度换算体型加成。
 * @module dsh-pet/src/shared/score
 */
import { PET_REF_WIDTH } from './constants.ts';

/** 达标速度阈值（px/s）：飞行中被点击时低于它不给分（低速点击维持普通点击动画）。 */
export const SCORE_MIN_SPEED = 400;

/** 每 100 px/s 记 1 分（基准尺寸 462px 下）。 */
const SCORE_SPEED_PER_POINT = 100;

/** 点击积分：score = round(speed/100 × 462/size)，至少 1 分。
 *  小宠物目标小、飞行中更难命中，反而分高；speed ≤ 0 或 size ≤ 0 返回 0。 */
export const clickScore = (speed: number, size: number): number => {
  if (speed <= 0 || size <= 0) return 0;
  return Math.max(1, Math.round((speed / SCORE_SPEED_PER_POINT) * (PET_REF_WIDTH / size)));
};
