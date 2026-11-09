/**
 * 管道应答的形状转换：把一次路由结果（{@link RouteResult}）翻译成 Helper 的应答体。
 *
 * 只做形状转换，不算业务、不读写盘；两处消费（素材走文件路径、其余走 body）的口径都收在这里，
 * 因此可以脱离 Electron 与 HTTP 断言。素材分支恒 200——404/400 已由 text 分支表达。
 * @module dsh-pet/src/host/plugin/desktop/bridge-response
 */
import type { BridgeResponse } from '../../helper/bridge.ts';
import type { RouteResult } from '../../http.ts';

/** 纯文本应答的类型串；`text` 与 `none` 共用。 */
const TEXT_UTF8 = 'text/plain; charset=utf-8';

/** JSON 应答的类型串。 */
const JSON_UTF8 = 'application/json; charset=utf-8';

/**
 * 把路由结果翻译成管道应答。
 *
 * @param id - 本次请求的编号，应答必须原样带回（管道上并存的请求靠它配对）。
 * @param result - 业务处理结果。
 * @returns 应答体；`none` 落成空的 204。
 */
export function toBridgeResponse(id: number, result: RouteResult): BridgeResponse {
  if (result.kind === 'file') {
    // 素材只给绝对路径，主进程自行读盘：几十 MB 的视频不进管道。
    return { id, status: 200, contentType: result.contentType, file: result.file };
  }
  if (result.kind === 'text') {
    return { id, status: result.status, contentType: TEXT_UTF8, body: result.body };
  }
  if (result.kind === 'none') {
    // 无需应答：管道侧不传 abort signal，正常到不了这里；保底给个空 204。
    return { id, status: 204, contentType: TEXT_UTF8, body: '' };
  }
  // 业务失败是 200 + { ok: false, reason }：原样透传，不改状态码。
  return { id, status: result.status, contentType: JSON_UTF8, body: JSON.stringify(result.obj) };
}
