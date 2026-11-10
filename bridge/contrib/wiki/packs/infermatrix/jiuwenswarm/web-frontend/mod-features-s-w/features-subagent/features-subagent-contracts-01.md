---
name: features-subagent-contracts-01
description: features-subagent 源码接口 01：subagent/subagentActivityPresentation.ts、subagentNormalizer.ts、subagentStatusPresentation.ts 三个文件的 SubagentTask、ACTIVITY_KINDS、getSubagentStatusTone 等声明与导入依赖
metadata:
  scope: 只收 subagent 下 subagentActivityPresentation.ts、subagentNormalizer.ts、subagentStatusPresentation.ts 三个文件的接口记录；目录入口归 features-subagent-overview
---
# features-subagent 源码接口与集成边界 01

## 现状

- 本页逐文件说明这一源码模块声明的接口、类型与依赖。记录来自静态源码声明，不证明控制流、配置生效、外部服务可用或测试通过；功能语义与设计取舍沿上级功能页继续阅读。
- **`jiuwenswarm/channels/web/frontend/src/features/subagent/subagentActivityPresentation.ts`**
- 源码声明的类型、组件或调用边界：`SubagentActivityGroup`, `SubagentTaskStatus`, `SubagentTaskStatusChange`, `SubagentTask`, `firstNonEmptyLine`, `boundedPreview`, `line`, `unescapeQuotedValue`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import type { SubagentActivity } from '../../types/subagent';`；`source: SubagentTaskStatusChange['source'],`；`const source: SubagentTaskStatusChange['source'] = toolName.includes('create')`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/subagent/subagentActivityPresentation.ts#L1-L306)。
- **`jiuwenswarm/channels/web/frontend/src/features/subagent/subagentNormalizer.ts`**
- 源码声明的类型、组件或调用边界：`RecordValue`, `ACTIVITY_KINDS`, `asRecord`, `asString`, `asNumber`, `asNonNegativeInteger`, `number`, `normalizeLifecycle`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import type {`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/subagent/subagentNormalizer.ts#L1-L317)。
- **`jiuwenswarm/channels/web/frontend/src/features/subagent/subagentStatusPresentation.ts`**
- 源码声明的类型、组件或调用边界：`SubagentStatusTone`, `getSubagentStatusTone`, `getSubagentStatusLabelKey`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import type { SubagentClosedReason, SubagentStatus, SubagentTurnOutcome } from '../../types/subagent`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/subagent/subagentStatusPresentation.ts#L1-L32)。

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/web-frontend/features-subagent/source-contracts-01.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
