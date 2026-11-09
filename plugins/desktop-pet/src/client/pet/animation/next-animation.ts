/**
 * 「下一个自播动画」的决策：把掷骰结果与移动尝试折成「切哪个动画、日志里算什么类别」。
 * 只决定该做什么，不碰 ref、不 setState——调用方负责真正切动画并推进世代号。
 * 移动那一档由调用方先试一次走位：占用中就别重播、无法移动才退回原地动作。
 * @module dsh-pet/src/client/pet/animation/next-animation
 */
import { pick, pickCategoryAction, type RollKind } from '../../../shared/pickers.ts';
import type { Animations } from '../../../shared/types.ts';

/** 一次自播的决策结果。 */
export interface NextAnimation {
  /** 日志与调试用的类别：`IDLE` / `TURN` / `MOVES` 或分类动作的 id。 */
  kind: string;
  /** 要切的动画名；走位占用中时为 `null`。 */
  anim: string | null;
  /** 是否真要 `setAnim`：走位档不切——走位自己已经切了，再切会重跑换源、打断那一步。 */
  play: boolean;
}

/** 决策输入。 */
export interface NextAnimationInput {
  /** 掷骰得到的类别。 */
  kind: RollKind;
  /** 该宠物的动画池。 */
  animations: Animations;
  /** 朝向：镜像会颠倒的分类动作在 facing=right 时要跳过。 */
  facing: 'left' | 'right';
  /** 当前正在播的动画名，用于「不连抽自己」。 */
  current: string;
  /** 走位尝试结果，仅 `kind === 'move'` 时有意义：动作名 = 成功，`true` = 占用中，`false` = 无法移动。 */
  move?: string | true | false;
}

/**
 * 决定下一个自播动画。
 *
 * @param input - 掷骰类别、动画池与走位结果。
 * @returns 类别、要切的动画名，以及「这次是否需要切」。
 */
export function decideNextAnimation(input: NextAnimationInput): NextAnimation {
  const { kind, animations, facing, current, move } = input;
  if (kind === 'idle') return { kind: 'IDLE', anim: pick(animations.idle, current), play: true };
  if (kind === 'turn') return { kind: 'TURN', anim: pick(animations.turn, current), play: true };
  if (kind === 'move' && move !== false && move !== undefined) {
    // 占用中（true）不重播；成功则是那次走位已经切好的动作名，只用于日志。
    return { kind: 'MOVES', anim: typeof move === 'string' ? move : null, play: false };
  }
  const action = pickCategoryAction(animations.categories, animations.idle, facing, current);
  return { kind: action.id, anim: action.name, play: true };
}
