/**
 * 独立模式 AI 服务的公开出口：创建服务与依赖形状。
 *
 * 只做再导出；限额与 schema 在 ./ai-provider/limits，请求解析在 ./ai-provider/request。
 * 必须始终成立：输入输出都有硬上限，超出即截断或拒绝，绝不透传。
 * @module dsh-pet/src/standalone/ai-provider
 */
export type { StandaloneAiDependencies, StandaloneAiService } from './ai-provider/types.ts';
export { createStandaloneAi } from './ai-provider/create.ts';
