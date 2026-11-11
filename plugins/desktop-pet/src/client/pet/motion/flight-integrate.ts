/**
 * 抛掷的逐帧细分积分：一帧拆成若干子步，避免高速时整帧跨过落地与反弹。
 *
 * 不碰 DOM、rAF 与宠物互撞，只把状态往前积一帧；子步数由 {@link throwSubsteps} 决定。
 * @module dsh-pet/src/client/pet/motion/flight-integrate
 */
import { throwBounds, throwStep, throwSubsteps, type GravityVector, type ThrowState } from '../../../shared/physics.ts';
import type { PhysicsParams } from '../../../shared/types.ts';

/** 一帧积分的产出：状态加两个标志。 */
export type FlightStep = ReturnType<typeof throwStep>;

/** 抛掷边界：由视口与宠物尺寸算出。 */
export type FlightBounds = ReturnType<typeof throwBounds>;

/**
 * 一帧的细分积分。
 *
 * 一帧可能跨过上百 px，不拆会跳过落地与反弹帧，漏掉落地挤压与落定判定。
 *
 * @param state - 本帧起点的飞行状态。
 * @param dt - 本帧时长（秒）。
 * @param bounds - 碰撞边界。
 * @param physics - 物理参数。
 * @param gravity - 本帧重力；缺省竖直向下。
 * @returns 本帧终点的状态，附带是否碰边与是否落定。
 */
export function integrateFlight(
  state: ThrowState,
  dt: number,
  bounds: FlightBounds,
  physics: PhysicsParams,
  gravity?: GravityVector,
): FlightStep {
  const substeps = throwSubsteps(state.vx, state.vy, dt);
  let res = throwStep(state, dt / substeps, bounds, physics, gravity);
  /** 子步里只保留最重的一次撞击：一帧震一下就够了。 */
  let hit = res.hit;
  for (let i = 1; i < substeps && !res.atRest; i++) {
    res = throwStep(res, dt / substeps, bounds, physics, gravity);
    if (res.hit !== null && (hit === null || res.hit.speed > hit.speed)) hit = res.hit;
  }
  return { ...res, hit };
}
