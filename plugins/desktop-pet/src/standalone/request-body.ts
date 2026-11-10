/**
 * 本机 HTTP 请求正文的读取边界：限制大小、时限与读取次数。
 *
 * 负责把正文一次读进内存，再以有界回放流交给插件路由；不解析 JSON，也不做鉴权。
 * 必须始终成立：超限、超时或连接异常时不调用插件，并直接回结构化错误。
 * @module dsh-pet/src/standalone/request-body
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import { rejectRequest } from './request-security.ts';

/** 普通请求的字节上限。 */
export const MAX_REQUEST_BYTES = 1024 * 1024;
/** 设置提交的字节上限，比普通请求更紧。 */
export const MAX_SETTINGS_BYTES = 16 * 1024;
/** 单次读取的默认时限。 */
export const BODY_TIMEOUT_MS = 5000;

/** 先整体读入再调用插件：插件内部的 readBody 只会消费一段有界回放流。 */
export async function boundedRequest(
  req: IncomingMessage,
  res: ServerResponse,
  limit: number,
  timeoutMs = BODY_TIMEOUT_MS,
): Promise<IncomingMessage | undefined> {
  const length = req.headers['content-length'];
  if (length !== undefined && (!/^\d+$/.test(length) || Number(length) > limit)) {
    rejectRequest(res, 413, '请求正文过大');
    return undefined;
  }
  const chunks: Buffer[] = [];
  const body = await new Promise<Buffer | undefined>((resolve) => {
    let size = 0;
    const finish = (status?: number): void => {
      clearTimeout(timer);
      req.off('data', onData);
      req.off('end', onEnd);
      req.off('error', onError);
      req.off('aborted', onError);
      if (status !== undefined) {
        // 先暂停原请求再回错误，避免继续读取对端仍在发送的正文。
        req.pause();
        if (!res.writableEnded && !res.destroyed)
          rejectRequest(res, status, status === 408 ? '读取请求超时' : '请求正文无效或过大');
        resolve(undefined);
      } else resolve(Buffer.concat(chunks));
    };
    const onData = (chunk: Buffer): void => {
      size += chunk.length;
      if (size > limit) finish(413);
      else chunks.push(Buffer.from(chunk));
    };
    const onEnd = (): void => finish();
    const onError = (): void => finish(400);
    const timer = setTimeout(() => finish(408), timeoutMs);
    timer.unref();
    req.on('data', onData);
    req.once('end', onEnd);
    req.once('error', onError);
    req.once('aborted', onError);
  });
  if (body === undefined) return undefined;
  return Object.assign(Readable.from([body]), {
    method: req.method,
    url: req.url,
    headers: req.headers,
    rawHeaders: req.rawHeaders,
    socket: req.socket,
    httpVersion: req.httpVersion,
  }) as IncomingMessage;
}
