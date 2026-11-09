/**
 * 睡觉状态机：把宿主写定的一套三段名翻译成动画链上的动作，并在睡着时替随机链把关。
 *
 * 只管「播哪一段、到哪一步」；播完判定由 animation-flow 转交本模块的 consumeEnded()，
 * 醒来后回随机链由调用方传入的 pickNext 决定。不依赖 React。
 * 不变量：进入必须先播 start（once）再切 loop（无限播）；入睡过渡里退出时不播 end。
 * 循环段没有 ended——收到就说明前台已被别的动画顶掉，必须重新点名 loop，而不是重播前台。
 * @module dsh-pet/src/client/pet/card/sleep-machine
 */
import type { SleepState } from '../../../shared/state.ts';
import type { CardHub } from './hub.ts';

/** 睡觉阶段：`start` 入睡过渡、`loop` 睡眠循环、`end` 醒来过渡。 */
export type SleepPhase = 'start' | 'loop' | 'end';

/** 状态机对外面：进睡 / 收尾 / 查询。 */
export interface SleepMachine {
  /** 应用宿主写的叶子：进入播 start，退出播 end（入睡过渡中退出则直接作废、不播 end）。 */
  apply(state: SleepState): void;
  /** 播完判定：返回 true = 这次 ended 归睡觉管，调用方直接 return；false = 按常规处理。 */
  consumeEnded(): boolean;
  /** 此刻是否在睡（含入睡与醒来两段过渡）。 */
  sleeping(): boolean;
  /** 当前阶段；醒着为 null。 */
  phase(): SleepPhase | null;
}

/**
 * 造睡觉状态机。
 *
 * @param hub - 卡片共享运行时（取动画写入口与气泡槽）。
 * @param pickNext - 醒来后回到随机链的动作（由动画流提供，避免本模块反向 import）。
 * @param log - 一行日志出口（格式与动画流一致）。
 */
export function createSleepMachine(
  hub: CardHub,
  pickNext: () => void,
  log: (petId: string, message: string) => void,
): SleepMachine {
  let current: { set: { start: string; loop: string; end: string }; phase: SleepPhase } | null = null;

  /** 换一段：`once` 决定播完是否触发 ended（循环段必须 false）。 */
  const play = (name: string, once: boolean): void => {
    hub.card.actions.setOnce(once);
    hub.card.actions.setAnim(name);
    hub.card.actions.bumpSeq();
  };

  const apply = (state: SleepState): void => {
    const petId = hub.cfg().id;
    if (state.sleeping) {
      if (current !== null) return; // 已在睡（含过渡）：叶子重写一次不该从头再播
      hub.stopMotion();
      // 与占用锁同一口径：进入睡觉就收掉任务状态气泡（醒来不补亮，等下一次状态变化再对齐）
      hub.bubbles.hideWork();
      current = { set: { start: state.start, loop: state.loop, end: state.end }, phase: 'start' };
      log(petId, '睡觉 -> [' + state.start + ']');
      play(state.start, true);
      return;
    }
    // 醒来：只有真的在睡才播「起来」；本来醒着 = 幂等空操作
    if (current === null || current.phase === 'end') return;
    // 入睡过渡里被叫醒：取消这次入睡，不播「起来」——它不是真的睡着过。
    // 这里什么都不播：点击路径已自己播了点击回应；菜单叫醒时当前「开始」播完会自然回随机链。
    if (current.phase === 'start') {
      current = null;
      log(petId, '入睡被打断：不播起来');
      return;
    }
    current.phase = 'end';
    log(petId, '醒来 -> [' + current.set.end + ']');
    play(current.set.end, true);
  };

  return {
    apply,
    consumeEnded: (): boolean => {
      if (current === null) return false;
      if (current.phase === 'start') {
        current.phase = 'loop';
        play(current.set.loop, false); // 循环段：不触发 ended
        return true;
      }
      if (current.phase === 'loop') {
        // 睡着期间前台可能被外来动画顶掉（显式点播、hostInstruction）：ended 落到这里说明现在
        // 播的不是循环段。只重播前台会把顶进来的那段一次性动画续成死循环，必须重新点名循环段。
        play(current.set.loop, false);
        return true;
      }
      // phase === 'end'：醒来过渡播完，交回随机链
      current = null;
      pickNext();
      return true;
    },
    sleeping: (): boolean => current !== null,
    phase: (): SleepPhase | null => current?.phase ?? null,
  };
}
