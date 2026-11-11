/**
 * `@deepseek-ai/dsh-credentials` 的独立模式替身。
 *
 * 插件只用 credentialRef 构造引用，而独立模式的凭证解析恒为空，
 * 因此引用本身无需结构，原样返回即可；余额路由会走明确失败分支。
 * 只在独立模式构建里生效，由 alias 指向本文件。
 * @module dsh-pet/src/standalone/shims/dsh-credentials
 */

/** 原样返回引用：独立模式不解析凭证，只保证模块图能加载。 */
export function credentialRef(ref: unknown): unknown {
  return ref;
}
