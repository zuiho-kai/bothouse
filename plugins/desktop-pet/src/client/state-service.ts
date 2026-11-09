/**
 * 轮询状态的客户端出口：留下最近一拍，供同页插件经 Cordis 服务读取。
 * 只存引用、不比对也不分发状态变化：比对在 shared/state，分发在 pet/multi，本模块没有第二份判据。
 * 页面级单例，标签页之间不共享；`/state` 首拍之前为 `null`。
 * @module dsh-pet/src/client/state-service
 */
import type { PollState } from '../shared/state.ts';

/** 最近一拍的状态；`null` = 本页还没拉到过。 */
let latest: PollState | null = null;

/** 订阅者：每来一拍通知一次。 */
const listeners = new Set<(state: PollState) => void>();

/**
 * 记下最近一拍的状态（唯一调用点是 pet/multi 的分发入口）。
 *
 * 逐个通知订阅者并各自兜错：某个面板的回调抛了，不能连累这一拍继续分发——
 * 轮询是整页宠物渲染的入口，一个消费方出错不该让所有人都停在旧画面。
 *
 * @param state - 刚拉到的轮询状态；整包替换，不深拷贝——每拍本来就是新对象。
 */
export function setStateSnapshot(state: PollState): void {
  latest = state;
  for (const listener of listeners) {
    try {
      listener(state);
    } catch (error) {
      console.error('[dsh-pet] 状态订阅回调出错（已忽略，不影响轮询）：', error);
    }
  }
}

/** 读最近一拍的状态；本页 `/state` 还没回来时为 `null`。 */
export function getStateSnapshot(): PollState | null {
  return latest;
}

/**
 * 订阅后续每一拍（不补发当前这拍：调用方自己决定要不要先读一次）。
 *
 * @param listener - 收到新一拍时调用。
 * @returns 退订函数。
 */
export function subscribeStateSnapshot(listener: (state: PollState) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** 清空快照与订阅；测试用，让每个用例从不含状态的页面开始。
 * @internal 只给测试重置全局单例，不对外承诺。 */
export function resetStateSnapshot(): void {
  latest = null;
  listeners.clear();
}
