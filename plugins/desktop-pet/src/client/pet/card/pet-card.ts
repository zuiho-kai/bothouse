/**
 * 单只宠物组件：装配根给出渲染输入，本组件只把输入交给视图。
 * 不持有状态、不做判定——状态在 card-state，判定在各驱动与 shared。
 * @module dsh-pet/src/client/pet/card/pet-card
 */
import { makeCardView } from './view.ts';
import { createCardRuntime } from './runtime.ts';
import type { PetCardProps } from './props.ts';
import type { PetRuntime } from '../types.ts';
import type { FunctionComponent } from 'react';

/**
 * 造宠物卡组件。
 *
 * @param rt - 注入的 react 能力。
 * @returns 接收容器 props 的组件。
 */
export function createPetCard(rt: PetRuntime): FunctionComponent<PetCardProps> {
  const { h } = rt;
  /** 宠物卡的 DOM 结构：只拼装，不持有状态。 */
  const CardView = makeCardView({ h });
  const useCardRuntime = createCardRuntime(rt);

  /** 单个宠物实例，配置由容器传入。 */
  function PetCard(props: PetCardProps) {
    return h(CardView, useCardRuntime(props));
  }

  return PetCard;
}
