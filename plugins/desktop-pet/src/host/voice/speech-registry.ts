/**
 * 第三方语音识别的注册表：单槽，后注册的覆盖先注册的。
 *
 * 与合成注册表的差别只有一处：内置来源是宿主的 `speechToText`（可能根本不存在），
 * 不是随包内置的实现，所以保留名是 `dsh` 而不是 `edge`。
 * 模块单例：注册返回 disposer；测试用 {@link resetSpeechProviders} 复位。
 * 只登记与查找：不识别、不排队、不设超时（那些归 hear.ts）。
 * @module dsh-pet/src/host/voice/speech-registry
 */

/** 内置来源的名字：宿主自带的识别能力，第三方不能占用。 */
export const BUILTIN_SPEECH_ID = 'dsh';

/** 第三方识别实现：给一段 WAV，返回文字。 */
export interface SpeechProvider {
  /** 唯一标识；参与排障输出，不能与内置来源同名。 */
  readonly id: string;
  /** 展示名，只用于排障。 */
  readonly name: string;
  /**
   * 把一段 WAV 识别成文字。
   *
   * 失败必须抛错——宿主会归一成 `generate-error` 并记日志；自己吞掉会让上层以为识别成功。
   * 返回空串表示「这段没人说话」，是合法结果，不属于失败。
   * `signal` 是调用方的中止信号：可以不理，但宿主会立刻停止等待。
   */
  transcribe(input: { readonly audio: Uint8Array; readonly language?: string }, signal?: AbortSignal): Promise<string>;
}

/** 当前生效的第三方实现；`null` = 没注册，识别走宿主自带能力。 */
let current: SpeechProvider | null = null;

/**
 * 注册一个第三方识别实现，覆盖当前生效的那个。
 *
 * @param def - 实现定义；`id` 不能与内置来源同名（排障时会分不清谁在跑）。
 * @returns 注销函数；只在「当前仍是这一份」时才清空，迟到的注销不会顶掉后来者。
 * @throws {TypeError} 定义非法、`transcribe` 不是函数或 id 与内置来源同名时。
 */
export function registerSpeechProvider(def: SpeechProvider): () => void {
  if (!def || typeof def !== 'object') throw new TypeError('speech provider 定义必须是对象');
  if (typeof def.id !== 'string' || def.id.length === 0) throw new TypeError('id 必须是非空字符串');
  if (def.id === BUILTIN_SPEECH_ID) throw new TypeError('不能与内置来源同名: ' + BUILTIN_SPEECH_ID);
  if (typeof def.transcribe !== 'function') throw new TypeError('transcribe 必须是函数');

  current = def;
  return () => {
    if (current === def) current = null;
  };
}

/**
 * 当前该用哪个第三方实现。
 * @returns 已注册的实现；没注册时返回 `null`，调用方据此回落到宿主自带能力。
 */
export function activeSpeechProvider(): SpeechProvider | null {
  return current;
}

/**
 * 列出可用实现，用于排障「为什么没走我注册的那个」。
 * @returns `builtin` 恒为宿主自带来源；`external` 是当前生效的第三方 id（没有则为空数组）。
 */
export function listSpeechProviders(): { builtin: string[]; external: string[] } {
  return { builtin: [BUILTIN_SPEECH_ID], external: current ? [current.id] : [] };
}

/**
 * 清空注册，供测试隔离用例。
 * @internal
 */
export function resetSpeechProviders(): void {
  current = null;
}
