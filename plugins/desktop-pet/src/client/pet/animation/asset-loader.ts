/**
 * 素材字节加载：把一次动画素材取成可播的 blob 地址，带超时与在途登记。
 * 一次拿全文件而不是让 video 流式加载——后者在 DSH WebServer 上偶发 stalled，表现为点了没反应。
 * 只负责「拿到地址」与「释放地址」；播哪一段、A/B 哪个槽位归动画链。
 * cache 用默认策略：服务端给了 max-age，有效期内不走网络；不能用 force-cache，否则换掉同名素材后仍读旧缓存。
 * @module dsh-pet/src/client/pet/animation/asset-loader
 */
/** 一次加载的两个结局。 */
export interface AssetHandlers {
  /** 拿到可直接赋给 `video.src` 的对象地址；调用方负责稍后 `release`。 */
  onObjectUrl: (objectUrl: string) => void;
  /** 拿不到字节（超时、非 2xx、被中断）；调用方决定是否上报。 */
  onError: (error: unknown) => void;
}

/** 素材加载器。 */
export interface AssetLoader {
  /** 取一次素材。 */
  load: (url: string, handlers: AssetHandlers) => void;
  /** 中断所有在途请求（卸载时调）。 */
  abortAll: () => void;
  /** 释放一个由本加载器创建的对象地址。 */
  release: (objectUrl: string) => void;
}

/**
 * 造素材加载器。
 *
 * @param timeoutMs - 单次请求的超时（ms）；到点即中断，避免请求无限挂着。
 * @returns 加载、批量中断与释放。
 */
export function createAssetLoader(timeoutMs: number): AssetLoader {
  /** 在途请求：销毁时统一中断，否则卸载后完成的响应会创建无人回收的地址。 */
  const inflight = new Set<AbortController>();

  return {
    load: (url, handlers) => {
      const controller = new AbortController();
      inflight.add(controller);
      const timer = window.setTimeout(() => controller.abort(), timeoutMs);
      const settle = (): void => {
        window.clearTimeout(timer);
        inflight.delete(controller);
      };
      fetch(url, { cache: 'default', signal: controller.signal })
        .then((response) => {
          if (!response.ok) throw new Error('asset HTTP ' + response.status);
          return response.blob();
        })
        .then((blob) => {
          settle();
          handlers.onObjectUrl(URL.createObjectURL(blob));
        })
        .catch((error: unknown) => {
          settle();
          handlers.onError(error);
        });
    },
    abortAll: () => {
      for (const controller of inflight) controller.abort();
      inflight.clear();
    },
    release: (objectUrl) => {
      URL.revokeObjectURL(objectUrl);
    },
  };
}
