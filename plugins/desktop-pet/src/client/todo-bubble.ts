/**
 * 待办面板的气泡外壳：把共享面板塞进气泡槽，显隐与优先级都由槽位决定。
 * 只做挂载与卸载，不碰数据与定位；面板本体在 shared/todo/panel。
 * @module dsh-pet/src/client/todo-bubble
 */
import { createTodoPanel } from '../shared/todo/panel.ts';
import type * as ReactNS from 'react';
import type { jsx } from 'react/jsx-runtime';

/** 注入的 react 能力。 */
export interface TodoBubbleRuntime {
  /** 创建元素。 */
  h: typeof jsx;
  /** 引用。 */
  useRef: <T>(initial: T) => ReactNS.MutableRefObject<T>;
  /** 副作用；面板挂载一次，卸载时 dispose。 */
  useEffect: (effect: ReactNS.EffectCallback, deps?: ReactNS.DependencyList) => void;
}

/** 面板气泡的 props。 */
export interface TodoBubbleProps {
  /** 是否显示；槽位为 `todo` 时为真。 */
  on: boolean;
  /** 点面板关闭按钮时回调，由槽位收起。 */
  onClose: () => void;
}

/**
 * 制造待办面板气泡组件（工厂）。
 *
 * @param rt - 注入的 react 能力。
 * @returns 待办面板的气泡组件。
 */
export function makeTodoBubble(rt: TodoBubbleRuntime) {
  const { h, useRef, useEffect } = rt;

  return function TodoBubble({ on, onClose }: TodoBubbleProps) {
    const hostRef = useRef<HTMLDivElement | null>(null);
    // 回调存 ref：面板只在挂载时拿一次 onClose，直接闭包会捕获旧的那份。
    const closeRef = useRef(onClose);
    closeRef.current = onClose;

    useEffect(() => {
      const host = hostRef.current;
      if (host === null) return;
      const panel = createTodoPanel({
        onClose: () => closeRef.current(),
        // 点宠物本体不收起：拖它走是常见需求，收起就没法一边看清单一边挪位置。
        keepOpenOn: (target) => target instanceof Element && target.closest('.dsh-pet-hit') !== null,
      });
      host.appendChild(panel.el);
      return () => panel.dispose();
    }, []);

    return h('div', {
      ref: hostRef,
      className: 'dsh-pet-bubble dsh-pet-todo-bubble' + (on ? ' is-on' : ''),
    });
  };
}
