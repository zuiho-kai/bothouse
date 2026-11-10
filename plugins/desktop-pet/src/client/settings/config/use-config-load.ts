/**
 * 成品配置的加载与重试：进页面拉一次 `GET /config`，失败给出「重试」入口。
 * 卸载或重试时用 AbortController 中断上一次请求，迟到的响应不会再写状态。
 * 解析与字段映射不在本文件：拉回来的聚合交给调用方的 `onMerged`（设置页的 `applyConfig`）。
 * @module dsh-pet/src/client/settings/config/use-config-load
 */
import { loadConfig } from './http.ts';
import type { MergedConfig } from './read.ts';
import type { SettingsRuntime } from '../runtime.ts';

/** 加载状态：`error` 时表单整体禁用并显示重试。 */
export type LoadState = 'loading' | 'ready' | 'error';

/** 加载与重试入口。 */
export interface ConfigLoad {
  /** 当前加载状态。 */
  loadState: LoadState;
  /** 重新拉一次（按钮用）；会先回到 `loading`。 */
  retry: () => void;
}

/**
 * 拉取成品配置。
 *
 * @param rt - 只用到 `useState`、`useEffect`。
 * @param onMerged - 拿到聚合后的处理函数；必须是稳定引用（`useCallback`），否则会反复重拉。
 * @returns 加载状态与重试入口。
 */
export function useConfigLoad(
  rt: Pick<SettingsRuntime, 'useState' | 'useEffect'>,
  onMerged: (merged: MergedConfig) => void,
): ConfigLoad {
  const { useState, useEffect } = rt;
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let alive = true;
    const controller = new AbortController();
    void loadConfig(controller.signal)
      .then((merged) => {
        if (!alive) return;
        if (merged === null) {
          setLoadState('error');
          return;
        }
        onMerged(merged);
        setLoadState('ready');
      })
      // onMerged 抛错（配置形状不可用）同样要落地：否则 loadState 永远停在 loading，
      // 整页禁用且没有重试入口。与「响应不可用」走同一条出路。
      .catch(() => {
        if (alive) setLoadState('error');
      });
    return () => {
      alive = false;
      controller.abort();
    };
  }, [onMerged, attempt]);

  const retry = (): void => {
    setLoadState('loading');
    setAttempt((value) => value + 1);
  };

  return { loadState, retry };
}
