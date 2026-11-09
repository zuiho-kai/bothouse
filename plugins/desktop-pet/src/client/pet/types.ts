/**
 * 宠物页的共享类型：注入的 react 能力与拍平后的成品宠物实例。
 * @module dsh-pet/src/client/pet/types
 */
import type { Animations, Pet, PhysicsParams, Weights } from '../../shared/types.ts';
import type * as ReactNS from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { jsx } from 'react/jsx-runtime';

/** 运行期宠物：拍平后的成品实例，条目级字段已补齐且必填。 */
export type RuntimePet = Pet & {
  animations: Animations;
  animationWeights: Weights;
  eventsRefreshSec: Record<string, number>;
  physics: PhysicsParams;
};

/** 注入的 react 能力：由模块工厂提供，本目录不直接 import react 运行时。 */
export interface PetRuntime {
  /** 创建元素。 */
  h: typeof jsx;
  /** 状态。 */
  useState: <T>(init: T) => [T, Dispatch<SetStateAction<T>>];
  /** 副作用。 */
  useEffect: (effect: ReactNS.EffectCallback, deps?: ReactNS.DependencyList) => void;
  /** 引用。 */
  useRef: <T>(initial: T) => ReactNS.MutableRefObject<T>;
}
