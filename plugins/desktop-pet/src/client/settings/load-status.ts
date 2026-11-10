/**
 * 加载态条：配置还在拉或拉失败时显示一行状态，失败时给「重试」。
 * 就绪后整块不出现，也不占位——它就是设置页顶部那条临时提示。
 * @module dsh-pet/src/client/settings/load-status
 */
import type { FunctionComponent } from 'react';
import type { SettingsRuntime } from './runtime.ts';
import type { LoadState } from './config/index.ts';

/** 加载态条的输入。 */
export interface LoadStatusProps {
  /** 当前加载状态；`ready` 时不渲染。 */
  loadState: LoadState;
  /** 重新拉一次配置。 */
  onRetry: () => void;
}

/**
 * 造加载态条。
 *
 * @param rt - 注入的 react 能力与翻译函数。
 * @returns 状态条组件。
 */
export function makeLoadStatus(rt: Pick<SettingsRuntime, 'h' | 't'>): FunctionComponent<LoadStatusProps> {
  const { h, t } = rt;

  return function LoadStatus(props: LoadStatusProps) {
    if (props.loadState === 'ready') return null;
    const failed = props.loadState === 'error';
    return h('div', {
      role: failed ? 'alert' : 'status',
      className: 'dsh-pet-cfg__actions',
      children: [
        h('span', { children: t(failed ? 'loadError' : 'loading') }),
        failed
          ? h('button', {
              type: 'button',
              className: 'dsh-pet-cfg__btn',
              onClick: props.onRetry,
              children: t('retry'),
            })
          : null,
      ],
    });
  };
}
