/**
 * 第三方语音实现的注册表：单槽，后注册的覆盖先注册的。
 *
 * 与余额注册表不同，语音没有「按服务商名匹配」的键——一句话念出来就完事，
 * 不存在多实现并存的语义，所以这里是一个槽而不是 Map。
 * 模块单例：注册返回 disposer；测试用 {@link resetVoiceProviders} 复位。
 * 只登记与查找，不合成、不缓存、不读配置。
 * @module dsh-pet/src/host/voice/registry
 */

/** 内置实现的名字；缓存键与排障都用它，第三方不能占用。 */
export const BUILTIN_VOICE_ID = 'edge';

/** 第三方语音实现：给一段文本，返回 mp3 字节。 */
export interface VoiceProvider {
  /** 唯一标识；参与缓存键，换实现不会命中旧音频。 */
  readonly id: string;
  /** 展示名，只用于排障。 */
  readonly name: string;
  /**
   * 把一段文本合成为 mp3。
   *
   * 失败必须抛错——宿主会归一成 `generate-error` 并记日志；自己吞掉会让上层以为成功。
   * 不接收音色：`voiceName` 是内置实现的白名单，第三方的嗓子由它自己决定。
   */
  synthesize(input: { readonly text: string; readonly rate: string }): Promise<Uint8Array>;
}

/** 当前生效的第三方实现；`null` = 没注册，合成走内置实现。 */
let current: VoiceProvider | null = null;

/**
 * 注册一个第三方语音实现，覆盖当前生效的那个。
 *
 * @param def - 实现定义；`id` 不能与内置实现同名（那会让缓存键撞在一起）。
 * @returns 注销函数；只在「当前仍是这一份」时才清空，迟到的注销不会顶掉后来者。
 * @throws {TypeError} 定义非法、`synthesize` 不是函数或 id 与内置同名时。
 */
export function registerVoiceProvider(def: VoiceProvider): () => void {
  if (!def || typeof def !== 'object') throw new TypeError('voice provider 定义必须是对象');
  if (typeof def.id !== 'string' || def.id.length === 0) throw new TypeError('id 必须是非空字符串');
  if (def.id === BUILTIN_VOICE_ID) throw new TypeError('不能与内置实现同名: ' + BUILTIN_VOICE_ID);
  if (typeof def.synthesize !== 'function') throw new TypeError('synthesize 必须是函数');

  current = def;
  return () => {
    if (current === def) current = null;
  };
}

/**
 * 当前该用哪个第三方实现。
 * @returns 已注册的实现；没注册时返回 `null`，调用方据此回落到内置实现。
 */
export function activeVoiceProvider(): VoiceProvider | null {
  return current;
}

/**
 * 列出可用实现，用于排障「为什么没走我注册的那个」。
 * @returns `builtin` 恒为内置实现；`external` 是当前生效的第三方 id（没有则为空数组）。
 */
export function listVoiceProviders(): { builtin: string[]; external: string[] } {
  return { builtin: [BUILTIN_VOICE_ID], external: current ? [current.id] : [] };
}

/**
 * 清空注册，供测试隔离用例。
 * @internal
 */
export function resetVoiceProviders(): void {
  current = null;
}
