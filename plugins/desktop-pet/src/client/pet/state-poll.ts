/**
 * `/state` 的自调度轮询：请求 → 分发 → 立刻再请求，宿主没变化时挂起。
 * 首拍用无 since 的普通请求探出宿主是否支持长轮询（`counter` 存在即支持），之后带上 since 挂起等待。
 * 失败或老宿主退避一个间隔，避免变成忙等；卸载由 `isAlive` 判断，循环自行退出。
 * @module dsh-pet/src/client/pet/state-poll
 */
import type { PollState } from '../../shared/state.ts';

/** 轮询器依赖。 */
export interface StatePollDeps {
  /** 拉一次状态；`timeoutMs` 已按宿主能力决定，`undefined` 表示普通请求。 */
  fetch: (options?: { since: number; timeoutMs: number }) => Promise<PollState | null>;
  /** 拿到有效快照后分发叶子。 */
  onState: (state: PollState) => void;
  /** 长轮询的挂起时长（ms）。 */
  waitMs: number;
  /** 失败或老宿主时的退避间隔（ms）。 */
  fallbackMs: number;
  /** 组件是否仍然挂载；false 时循环立刻退出。 */
  isAlive: () => boolean;
}

/** 一个不会 resolve 的等待：单纯让出这一拍，用定时器而不是忙等。 */
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * 启动自调度轮询（调用方不 await：它一直跑到 `isAlive()` 返回 false）。
 *
 * @param deps - 拉取、分发与节奏参数。
 * @returns 无返回值；循环结束后自然收尾。
 */
export async function runStatePoll(deps: StatePollDeps): Promise<void> {
  /** 宿主是否支持长轮询：首拍带 counter 就是支持。 */
  let longPoll = false;
  /** 上次拿到的 counter，作为长轮询的 since。 */
  let since: number | undefined;
  while (deps.isAlive()) {
    let state: PollState | null = null;
    try {
      state = await deps.fetch(longPoll && since !== undefined ? { since, timeoutMs: deps.waitMs } : undefined);
    } catch {
      /* 轻量轮询失败静默，下一拍再试。 */
    }
    if (!deps.isAlive()) return;
    if (state !== null) {
      longPoll = typeof state.counter === 'number';
      if (longPoll && typeof state.counter === 'number') since = state.counter;
      deps.onState(state);
    }
    // 长轮询命中或首拉时立刻再请求；失败或老宿主则退避一个间隔。
    if (state === null || !longPoll) await sleep(deps.fallbackMs);
  }
}
