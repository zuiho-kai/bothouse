---
name: features-trajectory-contracts-03
description: features-trajectory 源码接口 03：trajectory 的 projector（attribute-resolver、otel-trajectory-projector、trajectory-v2-reducer）、semconv（attributes、constants、两个 generated 文件）、shared/otlp.ts、teamTrajectoryLanes.ts、theme/context.tsx 与 trajectory 子目录的 compaction、model、preview、record 的声明与导入依赖
metadata:
  scope: 只收 trajectory 的 projector、semconv、shared、teamTrajectoryLanes.ts、theme 及 trajectory/trajectory 下 compaction.ts 至 record.ts 的接口记录；primitives 归 features-trajectory-contracts-02，search-index.ts 起及顶层 trajectory*.ts 归 features-trajectory-contracts-04
---
# features-trajectory 源码接口与集成边界 03

## 现状

- 本页逐文件说明这一源码模块声明的接口、类型与依赖。记录来自静态源码声明，不证明控制流、配置生效、外部服务可用或测试通过；功能语义与设计取舍沿上级功能页继续阅读。
- **`jiuwenswarm/channels/web/frontend/src/features/trajectory/projector/attribute-resolver.ts`**
- 源码声明的类型、组件或调用边界：`NormalizedTrajectoryAttributes`, `NormalizedTrajectoryStreamEvent`, `MutableNormalized`, `Resolved`, `NormalizedPart`, `NormalizedMessage`, `COMPATIBILITY`, `TRAJECTORY_KINDS`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import {`；`import {`；`import type { OtlpAttributeMap } from '../semconv/attributes.ts'`；`import type { OtlpAnyValue, OtlpKeyValue, OtlpSpanEvent } from '../shared/otlp.ts'`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/trajectory/projector/attribute-resolver.ts#L1-L848)。
- **`jiuwenswarm/channels/web/frontend/src/features/trajectory/projector/otel-trajectory-projector.ts`**
- 源码声明的类型、组件或调用边界：`ProjectedSpan`, `TrajectoryProjectionCheckpoint`, `TrajectoryLineageSeed`, `TrajectoryProjectionOptions`, `NO_UNRESOLVED_ATTRIBUTES`, `StructuredPart`, `StructuredMessage`, `MutableGroup`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import {`；`import {`；`import {`；`import type {`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/trajectory/projector/otel-trajectory-projector.ts#L1-L2311)。
- **`jiuwenswarm/channels/web/frontend/src/features/trajectory/projector/trajectory-v2-reducer.ts`**
- 源码声明的类型、组件或调用边界：`ContextMessage`, `ContextDelta`, `ContextCommitPayload`, `HeldCompactionContext`, `ParsedEvent`, `TrajectoryV2EventProjection`, `TrajectoryV2SubjectProjection`, `TrajectoryV2Reduction`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { OPENJIUWEN_ATTRIBUTES, STANDARD_ATTRIBUTES } from '../semconv/constants.ts'`；`import { attributeMap } from '../shared/otlp.ts'`；`import type { OtlpExportTraceServiceRequest, OtlpKeyValue, OtlpSpan } from '../shared/otlp.ts'`；
  - `import type { TrajectoryDiagnostic, TrajectoryPromptSnapshot } from '../trajectory/model.ts'`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/trajectory/projector/trajectory-v2-reducer.ts#L1-L1610)。
- **`jiuwenswarm/channels/web/frontend/src/features/trajectory/semconv/attributes.ts`**
- 源码声明的类型、组件或调用边界：`OtlpAttributeMap`, `exactAttributeMap`, `readStringAttribute`, `value`, `readBooleanAttribute`, `value`, `readInt64Attribute`, `value`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import type { OtlpAnyValue, OtlpKeyValue } from '../shared/otlp.ts'`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/trajectory/semconv/attributes.ts#L1-L146)。
- **`jiuwenswarm/channels/web/frontend/src/features/trajectory/semconv/constants.ts`**
- 源码声明的类型、组件或调用边界：`OTEL_SPEC_VERSION`, `OTLP_PROTO_VERSION`, `OTEL_SEMCONV_VERSION`, `STANDARD_ATTRIBUTES`, `OPENJIUWEN_ATTRIBUTES`, `OPENJIUWEN_EVENTS`, `STREAM_FRAME_KINDS`, `REQUEST_PURPOSES`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { GEN_AI_ATTRIBUTES } from './gen-ai-semconv.generated.ts'`；`import { OPENJIUWEN_SEMCONV } from './openjiuwen-semconv.generated.ts'`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/trajectory/semconv/constants.ts#L1-L159)。
- **`jiuwenswarm/channels/web/frontend/src/features/trajectory/semconv/gen-ai-semconv.generated.ts`**
- 源码声明的类型、组件或调用边界：`GEN_AI_SEMCONV_REVISION`, `GEN_AI_SEMCONV_SCHEMA_URL`, `GEN_AI_CORE_SEMCONV_SCHEMA_URL`, `GEN_AI_SEMCONV_ATTRIBUTE_COUNT`, `GEN_AI_ATTRIBUTES`, `GEN_AI_OPERATIONS`；这是词法声明索引，不把局部变量当成对外导出 API。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/trajectory/semconv/gen-ai-semconv.generated.ts#L1-L112)。
- **`jiuwenswarm/channels/web/frontend/src/features/trajectory/semconv/openjiuwen-semconv.generated.ts`**
- 源码声明的类型、组件或调用边界：`TRAJECTORY_SPAN_SCHEMA_VERSION`, `SEQUENCE_REFERENCE_PREFIX`, `SEQUENCE_REFERENCE_VERSION`, `OPENJIUWEN_SEMCONV`, `TRAJECTORY_RECORD_KINDS`, `TRAJECTORY_EVENT_KINDS`；这是词法声明索引，不把局部变量当成对外导出 API。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/trajectory/semconv/openjiuwen-semconv.generated.ts#L1-L124)。
- **`jiuwenswarm/channels/web/frontend/src/features/trajectory/shared/otlp.ts`**
- 源码声明的类型、组件或调用边界：`OtlpAnyValue`, `OtlpKeyValue`, `OtlpResource`, `OtlpInstrumentationScope`, `OtlpSpanEvent`, `OtlpSpanLink`, `OtlpStatus`, `OtlpSpan`；这是词法声明索引，不把局部变量当成对外导出 API。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/trajectory/shared/otlp.ts#L1-L142)。
- **`jiuwenswarm/channels/web/frontend/src/features/trajectory/teamTrajectoryLanes.ts`**
- 源码声明的类型、组件或调用边界：`TeamMemberLaneStatus`, `TeamMemberLaneModel`, `laneStatusOf`, `hasRecords`, `hasRunning`, `hasError`, `lifecycle`, `buildTeamMemberLanes`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import type { TrajectorySubjectGroup } from './trajectorySubjects';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/trajectory/teamTrajectoryLanes.ts#L1-L57)。
- **`jiuwenswarm/channels/web/frontend/src/features/trajectory/theme/context.tsx`**
- 源码声明的类型、组件或调用边界：`ReactNode`, `TrajectoryColorMode`, `TrajectoryColorModeContext`, `TrajectoryThemeProvider`, `useTrajectoryColorMode`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { createContext, type ReactNode, useContext } from 'react'`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/trajectory/theme/context.tsx#L1-L28)。
- **`jiuwenswarm/channels/web/frontend/src/features/trajectory/trajectory/compaction.ts`**
- 源码声明的类型、组件或调用边界：`CompactionMetric`, `CompactionModifiedMessage`, `CompactionFacts`, `PHASE_TRIGGERS`, `record`, `nonEmptyString`, `finiteNumber`, `metric`；这是词法声明索引，不把局部变量当成对外导出 API。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/trajectory/trajectory/compaction.ts#L1-L162)。
- **`jiuwenswarm/channels/web/frontend/src/features/trajectory/trajectory/model.ts`**
- 源码声明的类型、组件或调用边界：`TrajectoryRequestConfig`, `TrajectoryRecordedFacts`, `TrajectoryToolSchema`, `TrajectorySystemMessage`, `TrajectoryPromptSnapshot`, `TrajectoryGroupModel`, `TrajectoryTurnModel`, `TrajectoryUsage`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import type { TrajectoryCell } from './record.ts'`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/trajectory/trajectory/model.ts#L1-L151)。
- **`jiuwenswarm/channels/web/frontend/src/features/trajectory/trajectory/preview.ts`**
- 源码声明的类型、组件或调用边界：`PREVIEW_SOURCE_CHARACTERS`, `PREVIEW_OUTPUT_CHARACTERS`, `trajectoryPreviewText`, `source`, `compact`, `preview`, `trajectoryDisplayText`, `preview`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { extractMarkdownPlainText } from '../primitives/markdown/plain-text.ts'`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/trajectory/trajectory/preview.ts#L1-L37)。
- **`jiuwenswarm/channels/web/frontend/src/features/trajectory/trajectory/record.ts`**
- 源码声明的类型、组件或调用边界：`TrajectoryCellKind`, `AssistantMetricDetail`, `TrajectorySourceBlock`, `TrajectoryCell`, `TrajectoryCellProps`, `trajectoryRecordId`, `formatDurationMillis`, `integer`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import type { TrajectoryPromptSnapshot } from './model.ts'`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/trajectory/trajectory/record.ts#L1-L143)。

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/web-frontend/features-trajectory/source-contracts-03.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
