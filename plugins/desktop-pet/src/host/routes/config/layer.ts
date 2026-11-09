/**
 * 配置层的定位：把「条目名」解析成该层要写的文件、目录与磁盘原对象。
 *
 * 两条写端点（单只 display、整条目实例）共用这一份归属规则，否则「main 写用户层、文件宠物写
 * 自己的配置文件」会被各写一遍，改一处漏一处。
 * 不读合并成品、不校验宠物字段：entry 是否合法、找不到文件该报什么 reason，都由调用方决定。
 * @module dsh-pet/src/host/routes/config/layer
 */
import { readPetConfigEntry, readUserConfig } from '../../config.ts';
import type { PetRouteDeps } from '../types.ts';

/** 要写的那一层：文件路径、所在目录，以及该文件在磁盘上的原对象（透传递归用）。 */
export interface ConfigLayer {
  readonly path: string;
  readonly dir: string;
  readonly existing: Record<string, unknown> | undefined;
}

/** 定位结果：命中给出该层；未命中只说明「文件不存在」，具体 reason 由调用方按端点语义决定。 */
export type ConfigLayerLookup = { readonly ok: true; readonly layer: ConfigLayer } | { readonly ok: false };

/**
 * 定位目标层：`main` → 用户主配置，其余 → 文件宠物自己的配置。
 *
 * @param deps - 路由层依赖（路径集）。
 * @param entry - 宠物所属条目名（合并后由宿主反查得出，不接受调用方指定）。
 * @returns 命中给出该层；条目配置文件不存在时给出 `ok: false`。
 */
export function resolveConfigLayer(deps: PetRouteDeps, entry: string): ConfigLayerLookup {
  if (entry === 'main') {
    return {
      ok: true,
      layer: { path: deps.userConfigPath, dir: deps.userRoot, existing: readUserConfig(deps.configPaths) },
    };
  }
  const file = readPetConfigEntry(deps.configPaths, entry);
  if (!file) return { ok: false };
  return { ok: true, layer: { path: file.path, dir: deps.petConfigDir, existing: file.raw } };
}
