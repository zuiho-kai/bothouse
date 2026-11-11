/**
 * 测试进程专用的模块解析钩子：把 src/ 里无扩展名的相对 import 补成 `.ts`（含目录索引）。
 *
 * 共享层是给打包器吃的源码（moduleResolution: Bundler），相对 import 一律不写扩展名；
 * 单测走 node --experimental-strip-types 直连源文件，Node 的 ESM 解析器要求完整说明符。
 * 给源文件统一补 .ts 后缀会牵动 tsdown 与 rolldown 两条构建链，故只在测试进程里补这一层。
 * 只补相对说明符与目录索引，裸包名原样交给 Node。
 * @module dsh-pet/scripts/test-ts-resolver
 */
/** 为相对 import 依次补 `.ts` 与 `/index.ts`，都不成则落回原说明符交给 Node 报错。 */
export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('./') || specifier.startsWith('../')) {
    if (!/\.[cm]?[jt]sx?$/.test(specifier) && !specifier.endsWith('.json')) {
      for (const candidate of [specifier + '.ts', specifier + '/index.ts']) {
        try {
          return await nextResolve(candidate, context);
        } catch {
          /* 继续试下一个候选；都不行就落回原说明符，让 Node 报它自己的错 */
        }
      }
    }
  }
  return nextResolve(specifier, context);
}
