/**
 * 桌面 Helper 的管道协议：渲染端经 main.js 转发的一次请求与应答形状。
 *
 * 管道两端（宿主与 Electron 主进程）各按本文件对齐消息格式。
 * 必须始终成立：URL 已含路由前缀，宿主侧不得再拼一次。
 * @module dsh-pet/src/host/helper/bridge
 */

/** 协议行前缀：stdout/stdin 里以此开头的整行 JSON 属于 bridge 协议，其余为日志。 */
export const BRIDGE_PREFIX = 'dsh-pet-bridge:';

/** 渲染端（经 main.js 转发）的一次请求：URL 是 /dsh-pet-7340/... 路径 + 查询串；
 *  cb = main.js 本地回调服务器地址（宿主把应答 POST 回去；Electron 主进程读不到 piped stdin，
 *  故应答不走 0 号管道 —— electron#4218） */
export interface BridgeRequest {
  id: number;
  method: string;
  url: string;
  body?: string;
  cb?: string;
}

/** 宿主对一次请求的应答：json/text 走 body；素材走 file（文件绝对路径，main.js 自行读盘）。 */
export interface BridgeResponse {
  id: number;
  status: number;
  contentType?: string;
  body?: string;
  file?: string;
}

/** bridge 请求处理器（宿主半侧与 handlePetRoute 对接；main.js 不在收到请求时带出宿主动作）。 */
export type BridgeHandler = (req: BridgeRequest) => Promise<BridgeResponse>;
