/**
 * 独立模式的日志出口：给了文件就落盘，否则只写控制台。
 *
 * 文件模式复用宿主半侧的文件日志器——这个 logger 会挂到伪 ctx.logger 上，插件据此共用同一个
 * 文件出口，避免两份缓冲互相踩。不决定级别与格式（归 ../host/log-file），不判断该不该记。
 * @module dsh-pet/src/standalone/logger
 */
import { createFileLogger } from '../host/log-file.ts';
import type { StandaloneLogger } from './context.ts';

/** 创建独立模式日志器的选项。 */
export interface StandaloneLoggerOptions {
  /** 落盘文件；不给则只写控制台。 */
  file?: string;
}

/** 创建独立模式日志器。 */
export function createStandaloneLogger(options: StandaloneLoggerOptions = {}): StandaloneLogger {
  if (options.file) {
    return createFileLogger({
      file: options.file,
      base: console,
      debugEnabled: process.env.DSH_PET_LOG_DEBUG === '1',
    });
  }
  const stamp = (): string => new Date().toISOString().replace('T', ' ').slice(0, 19);
  const write = (level: string, message: string): void => {
    console.log(`[dsh-pet-standalone ${stamp()}] ${level} ${message}`);
  };
  return {
    info: (message) => write('INFO ', message),
    warn: (message) => write('WARN ', message),
    error: (message) => write('ERROR', message),
    debug: (message) => {
      if (process.env.DSH_PET_STANDALONE_DEBUG === '1') write('DEBUG', message);
    },
  };
}
