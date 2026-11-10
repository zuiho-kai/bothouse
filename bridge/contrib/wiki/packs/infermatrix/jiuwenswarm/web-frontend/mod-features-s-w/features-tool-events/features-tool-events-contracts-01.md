---
name: features-tool-events-contracts-01
description: features-tool-events 源码接口 01：tool-events/reviewerMetadata.ts（REVIEWER_STATUSES、normalizeReviewerStatus、reviewerIndicatesFailure）与 toolEventNormalizer.ts（SkillTreePath、BeamSearchProgress、MERMAID_DIRECT_ID_PATTERN 等）的声明与导入依赖
metadata:
  scope: 只收 tool-events 下 reviewerMetadata.ts 与 toolEventNormalizer.ts 两个文件的接口记录；目录入口归 features-tool-events-overview
---
# features-tool-events 源码接口与集成边界 01

## 现状

- 本页逐文件说明这一源码模块声明的接口、类型与依赖。记录来自静态源码声明，不证明控制流、配置生效、外部服务可用或测试通过；功能语义与设计取舍沿上级功能页继续阅读。
- **`jiuwenswarm/channels/web/frontend/src/features/tool-events/reviewerMetadata.ts`**
- 源码声明的类型、组件或调用边界：`UnknownPayload`, `REVIEWER_STATUSES`, `asRecord`, `asString`, `normalizeReviewerStatus`, `status`, `effectiveReviewerStatus`, `reviewerIndicatesFailure`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import type { AutoReviewerMetadata, AutoReviewerStatus } from '../../types';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/tool-events/reviewerMetadata.ts#L1-L57)。
- **`jiuwenswarm/channels/web/frontend/src/features/tool-events/toolEventNormalizer.ts`**
- 源码声明的类型、组件或调用边界：`SkillTreePath`, `BeamSearchProgress`, `UnknownPayload`, `MERMAID_DIRECT_ID_PATTERN`, `UNICODE_CAPABILITY_ID_PATTERN`, `MERMAID_RESERVED_IDS`, `PLANNED_GRAPH_NODE_RADIUS`, `PLANNED_GRAPH_FONT_FAMILY`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { readOutputOrder } from '../sessionOutput';`；`import type { OutputOrder } from '../../types/message';`；`import { parseSkillTreePath, type SkillTreePath } from '../../types/skillTree';`；
  - `import { parseBeamSearchProgress, type BeamSearchProgress } from '../../types/beamSearch';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/tool-events/toolEventNormalizer.ts#L1-L415)。

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/web-frontend/features-tool-events/source-contracts-01.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
