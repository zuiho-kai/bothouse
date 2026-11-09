/**
 * `@deepseek-ai/dsh-home-paths` 的独立模式替身。
 *
 * 直接转调插件自己的 dshHomeDir，避免出现第二套 DSH_HOME 口径。
 * 因此独立模式与 DSH 内运行读的是同一个主目录。
 * 只在独立模式构建里生效，由 alias 指向本文件。
 * @module dsh-pet/src/standalone/shims/dsh-home-paths
 */

/** 转调插件自己的主目录解析，保证与 DSH 内运行同口径。 */
export { dshHomeDir as resolveDshHome } from '../../host/helper-process.ts';
