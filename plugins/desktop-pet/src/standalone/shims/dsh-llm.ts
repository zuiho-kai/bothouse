/**
 * `@deepseek-ai/dsh-llm` 的独立模式替身：消息工厂、文本块拼装与 reasoning 标识。
 *
 * 独立模式没有模型后端，这些实现只为让静态 import 的模块图能加载。
 * 形状必须与 DSH 契约一致：配置里显式写了模型时，生成侧会真的走到这里。
 * 只在独立模式构建里生效，由 alias 指向本文件。
 * @module dsh-pet/src/standalone/shims/dsh-llm
 */

/** 消息的最小形状：只有角色、内容与来源。 */
export interface StandaloneLlmMessage {
  role: 'user' | 'assistant';
  content: unknown;
  source: unknown;
}

/** 创建用户消息。 */
export function createUserMessage(input: { content: unknown; source: unknown }): StandaloneLlmMessage {
  return { role: 'user', content: input.content, source: input.source };
}

/** 创建助手消息。 */
export function createAssistantMessage(input: { content: unknown; source: unknown }): StandaloneLlmMessage {
  return { role: 'assistant', content: input.content, source: input.source };
}

/** 文本块形状。 */
export interface StandaloneTextBlock {
  type: 'text';
  text: string;
}

/** 流式文本拼装：只收集文本块，独立模式只会有空流。 */
export class BlockAssembler {
  /** 已收集的文本片段。 */
  private readonly chunks: string[] = [];

  /** 收集一个文本块；其他类型忽略。 */
  push(chunk: unknown): void {
    if (chunk !== null && typeof chunk === 'object' && (chunk as { type?: unknown }).type === 'text') {
      const text = (chunk as { text?: unknown }).text;
      if (typeof text === 'string') this.chunks.push(text);
    }
  }

  /** 返回当前拼装结果。 */
  blocks(): StandaloneTextBlock[] {
    const text = this.chunks.join('');
    return text === '' ? [] : [{ type: 'text', text }];
  }
}

/** reasoning effort 标识工厂：原样返回传入值。 */
export function ReasoningEffortId(id: string): string {
  return id;
}
