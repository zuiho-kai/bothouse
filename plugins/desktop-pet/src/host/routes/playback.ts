/**
 * 播放回执：/playback/<id> 查询（可挂起等待）与 /playback/<id>/report 上报。
 *
 * 不驱动播放，记录只由渲染端上报推进。
 * 依赖（PetRouteDeps）显式传入，模块内不读全局、不建状态。
 * @module dsh-pet/src/host/routes/playback
 */
import { parsePlaybackPath, parseWaitQuery } from '../playback.ts';
import { type RouteResult } from '../http.ts';
import type { PetRouteDeps, RouteInput } from './types.ts';
import { failResult, invalidJson, methodNotAllowed, okResult } from './result.ts';

/** 播放回执领域：未命中返回 undefined，命中返回应答。 */
export async function handlePlaybackRoutes(deps: PetRouteDeps, input: RouteInput): Promise<RouteResult | undefined> {
  const { playback } = deps;
  const { body, method, rest, signal, url } = input;

  // 播放回执：GET /playback/<id> 查询（可挂起等待），POST /playback/<id>/report 由渲染端上报。
  // 记录由渲染端上报驱动：host 只知道「受理了」，没有 /report 就没有真实回执，查询永远停在 accepted。
  // 播放记录是 per-caller 资源（只有发起方关心、有生命周期、数量随调用方增长），不进 1s 全局广播。
  // 前缀守卫写成字面量比较，让 scripts/check-openapi.mjs 能认出这条路由（纯正则匹配它看不见；
  // 注释里也别把这个比较原样写出来，会被当成一条真实路由）。
  const playbackPath = rest === 'playback' || rest.startsWith('playback/') ? parsePlaybackPath(rest) : undefined;

  if (playbackPath) {
    const playbackId = playbackPath.playbackId;
    if (playbackPath.isReport) {
      if (method !== 'POST') return methodNotAllowed();
      let reported: unknown;
      try {
        reported = JSON.parse(body ?? 'null');
      } catch {
        return invalidJson();
      }
      const o = reported && typeof reported === 'object' ? (reported as Record<string, unknown>) : {};
      const outcome = playback.report(playbackId, o.status, o.reason);
      // 未知回执与非法 status 都是业务结论（调用方自己给错了），仍回 200 + reason
      if (outcome === 'unknown') return failResult('unknown-playback', 'unknown playback');
      if (outcome === 'invalid') return failResult('bad-request', 'invalid status');
      // ok / ignored 都回 200：上报是幂等的，「已经这样了」对上报方就是成功
      // （迟到的 ended 不许覆盖 cancelled——终态保护在 ./playback 里）
      return okResult({ ok: true });
    }
    if (method !== 'GET') return methodNotAllowed();
    const record = playback.get(playbackId);
    if (!record) return failResult('unknown-playback', 'unknown playback');
    const parsed = parseWaitQuery(url.searchParams.get('wait'), url.searchParams.get('timeout'));
    if (parsed.kind === 'error') return failResult('bad-request', parsed.error);
    // 两者都没传 = 立刻返回（兜底 / 调试 / 只想知道当下状态的调用方）
    if (parsed.kind === 'none') {
      return okResult({ ...record, matched: false });
    }
    const { wait: waitList, timeoutMs } = parsed;
    // 已经是等的状态之一 → 立刻返回，别白等一整个 timeout
    if (waitList.includes(record.status)) {
      return okResult({ ...record, matched: true });
    }
    // 挂起等待：状态进入 wait 集合立刻唤醒（matched:true）；到点回当时的记录（matched:false）。
    // timeout=0 时 playback.wait 下一拍就唤醒，等价「立刻返回」，这里不特判。
    return await new Promise<RouteResult>((resolveWait) => {
      let settled = false;
      /** 收尾：只认第一次（唤醒 / 超时 / 取消 / 调用方断开 都可能先后到达） */
      const settle = (result: RouteResult): void => {
        if (settled) return;
        settled = true;
        resolveWait(result);
      };
      const cancel = playback.wait({
        playbackId,
        wait: waitList,
        timeoutMs,
        // 唤醒时不需要再取消：store 在回调前已把等待者摘掉（超时定时器也清了）
        onWake: (r, matched) => settle(okResult({ ...r, matched })),
      });
      // get 之后记录被清理（极端竞态）→ 立刻回未知回执，不挂
      if (cancel === undefined) {
        settle(failResult('unknown-playback', 'unknown playback'));
        return;
      }
      // 调用方断开：取消等待者（清掉它的超时定时器），以「无需应答」收尾。
      // 监听不摘也无妨：signal 只被这次请求持有，请求结束后整条引用链一起回收。
      const onAbort = (): void => {
        cancel();
        settle({ kind: 'none' });
      };
      if (signal?.aborted) {
        onAbort();
        return;
      }
      signal?.addEventListener('abort', onAbort, { once: true });
    });
  }

  return undefined;
}
