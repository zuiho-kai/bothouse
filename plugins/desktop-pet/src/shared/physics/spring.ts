/**
 * 跟手弹簧与限速：把指针位移变成平滑的跟手速度。
 *
 * 不读时钟、不写状态；dt 由调用方按帧传入。
 * 必须始终成立：dt 需小于 MAX_STEP_DT，否则阶跃过大。
 * @module dsh-pet/src/shared/physics/spring
 */
import { DEFAULT_THROW_POWER, MAX_THROW_SPEED, SPRING_C, SPRING_K } from './constants.ts';

/** 过阻尼弹簧单轴速度步进：调用方随后 x += v*dt。
 *  power = 总力度（K/C 同乘：系统形态不变，收敛速度快 p 倍，即更跟手或更松）。 */
export const springStep = (
  v: number,
  x: number,
  target: number,
  dt: number,
  power: number = DEFAULT_THROW_POWER,
): number => v + ((target - x) * SPRING_K - v * SPRING_C) * power * dt;

/** 软钳速：cap×(1-e^(-s/cap))，任意速度下单调可区分、渐近不超过 cap。
 *  抛掷指令与拖拽甩抛走同一条限速，手感一致。 */
export const softClampSpeed = (speed: number): number => {
  if (speed <= 0) return 0;
  return MAX_THROW_SPEED * (1 - Math.exp(-speed / MAX_THROW_SPEED));
};
