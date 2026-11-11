/**
 * 请求解析与取消：把外部输入收成已校验的对象，并让模型调用可中止。
 *
 * 不发起网络请求；只负责解析与把 AbortSignal 接到 Promise 上。
 * 必须始终成立：解析失败必须有明确错误，不返回半成品。
 * @module dsh-pet/src/standalone/ai-provider/request
 */
import { type AiRequest } from '../ai-transport.ts';
import { MAX_INPUT_CHARS, inputSchema, textBlock } from './limits.ts';

/**
 * 把调用方输入收敛为纯文本消息。
 * @param options - 调用方请求。
 * @param model - 当前选中的模型。
 * @returns 规范化请求与可选的取消信号。
 * @throws 输入越界、角色顺序不合法或模型不匹配时抛出。
 */
export function parseRequest(options: unknown, model: string): { request: AiRequest; signal?: AbortSignal } {
  const parsed = inputSchema.safeParse(options);
  if (!parsed.success || parsed.data.model !== model)
    throw new Error('Invalid standalone AI model selection or input.');
  const { data } = parsed;
  const messages = data.messages
    .map((message) => ({
      role: message.role,
      content:
        typeof message.content === 'string'
          ? message.content
          : message.content
              .map((block) => {
                // 非文本块与 DSH 来源元数据不进入请求：服务商只该看到文本。
                if (typeof block !== 'object' || block === null || !('type' in block) || block.type !== 'text')
                  return '';
                const result = textBlock.safeParse(block);
                if (!result.success) throw new Error('Invalid standalone AI text input.');
                return result.data.text;
              })
              .join(''),
    }))
    .filter((message) => message.content.trim().length > 0);
  const system = data.system ?? '';
  const size = system.length + messages.reduce((sum, message) => sum + message.content.length, 0);
  if (
    size > MAX_INPUT_CHARS ||
    messages.length === 0 ||
    messages[0].role !== 'user' ||
    messages[messages.length - 1]?.role !== 'user'
  ) {
    throw new Error('Standalone AI input is empty or exceeds limits.');
  }
  return { request: { system, messages }, signal: data.signal };
}

/** 让等待中的读取也能响应取消。 */
export function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new Error('Standalone AI request cancelled.'));
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(new Error('Standalone AI request cancelled.'));
    signal.addEventListener('abort', abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}
