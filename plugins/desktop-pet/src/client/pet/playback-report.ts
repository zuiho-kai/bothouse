/**
 * 第三方点播的状态回执：host 只知道受理，真实播放结果只有浏览器侧知道，所以这里必须如实上报。
 * `playing` / `cancelled` / `failed` 三种终态各自带原因，host 据此收敛队列，不做二次推断。
 * 失败只 warn 不抛：回执丢了不影响用户看动画。
 * @module dsh-pet/src/client/pet/playback-report
 */
import { ROUTE_PATH } from '../../shared/constants.ts';
import type { ReportableStatus } from '../../shared/playback.ts';
import { postAction } from '../../shared/state.ts';

/** 点播状态：渲染端只报这四种之一，词汇表在 `shared/playback.ts`。 */

/** 一次回执的请求形状。 */
export interface PlaybackReportRequest {
  url: string;
  body: Record<string, unknown>;
}

/**
 * 拼回执请求。
 *
 * @param playbackId - host 分配的播放编号。
 * @param status - 终态或 `playing`。
 * @param reason - 终态原因（`superseded` / `decode-error` / `asset-load` 等），不影响 URL。
 * @returns 可直接交给 `postAction` 的地址与请求体。
 */
export function playbackReportRequest(
  playbackId: string,
  status: ReportableStatus,
  reason?: string,
): PlaybackReportRequest {
  return {
    url: ROUTE_PATH + '/playback/' + encodeURIComponent(playbackId) + '/report',
    body: reason === undefined ? { status } : { status, reason },
  };
}

/**
 * 造回执函数。
 *
 * @param o - 回执上下文：`petId` 只用于失败日志，不参与地址。
 * @returns 上报一次点播状态；自播动画不要调。
 */
export function makePlaybackReporter(o: { petId: string }) {
  return (playbackId: string, status: ReportableStatus, reason?: string): void => {
    const request = playbackReportRequest(playbackId, status, reason);
    void postAction(request.url, request.body).then((ok: boolean) => {
      if (!ok) {
        console.warn('[dsh-pet] 播放回执未送达 pet=' + o.petId + ' id=' + playbackId + ' status=' + status);
      }
    });
  };
}
