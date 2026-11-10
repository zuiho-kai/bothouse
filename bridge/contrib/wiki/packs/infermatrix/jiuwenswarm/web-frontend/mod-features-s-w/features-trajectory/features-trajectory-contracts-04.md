---
name: features-trajectory-contracts-04
description: features-trajectory 源码接口 04：trajectory/trajectory 的 search-index、timeline、virtual-rows 与顶层 trajectoryArchive、trajectoryCheckpoints、trajectoryClient、trajectoryFrames、trajectoryLayout、trajectorySequences、trajectorySubjects、trajectoryTurnGaps、trajectoryWindow 的声明与导入依赖
metadata:
  scope: 只收 trajectory/trajectory 下 search-index.ts、timeline.ts、virtual-rows.ts 与顶层 trajectory*.ts 各文件的接口记录；compaction.ts 至 record.ts 归 features-trajectory-contracts-03
---
# features-trajectory 源码接口与集成边界 04

## 现状

- 本页逐文件说明这一源码模块声明的接口、类型与依赖。记录来自静态源码声明，不证明控制流、配置生效、外部服务可用或测试通过；功能语义与设计取舍沿上级功能页继续阅读。
- **`jiuwenswarm/channels/web/frontend/src/features/trajectory/trajectory/search-index.ts`**
- 源码声明的类型、组件或调用边界：`SearchEntry`, `searchableJson`, `sameSources`, `markdownPreview`, `resultPreview`, `recordSources`, `blocks`, `TrajectorySearchIndex`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import type { TrajectoryTurnModel } from './model.ts'`；`import type { TrajectoryCellProps } from './record.ts'`；`import { trajectoryRecordId } from './record.ts'`；`import { trajectoryDisplayText, trajectoryPreviewText } from './preview.ts'`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/trajectory/trajectory/search-index.ts#L1-L138)。
- **`jiuwenswarm/channels/web/frontend/src/features/trajectory/trajectory/timeline.ts`**
- 源码声明的类型、组件或调用边界：`TrajectoryTimelineMode`, `TrajectoryTimelineSegment`, `TrajectoryTimeRange`, `TrajectoryTimelineSpan`, `TrajectoryTimelineTurnBoundary`, `TrajectoryTimelineModel`, `clamp`, `boundedViewport`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import type { TrajectoryTurnModel } from './model.ts'`；`import { formatDurationMillis, liveElapsedSeconds } from './record.ts'`；`import type { TrajectoryCellKind, TrajectoryCellProps } from './record.ts'`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/trajectory/trajectory/timeline.ts#L1-L416)。
- **`jiuwenswarm/channels/web/frontend/src/features/trajectory/trajectory/virtual-rows.ts`**
- 源码声明的类型、组件或调用边界：`CONTENT_ROW_HEIGHT`, `COLLAPSED_SUMMARY_HEIGHT`, `TERMINAL_BOUNDARY_HEIGHT`, `VirtualizableTrajectoryRecord`, `TrajectoryVirtualRowEntry`, `TrajectoryVirtualRow`, `trajectoryVirtualRecordKey`, `identity`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import type { TrajectoryCellProps } from './record.ts'`；`import { trajectoryRecordId } from './record.ts'`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/trajectory/trajectory/virtual-rows.ts#L1-L89)。
- **`jiuwenswarm/channels/web/frontend/src/features/trajectory/trajectoryArchive.ts`**
- 源码声明的类型、组件或调用边界：`UnzipFile`, `TrajectoryRetentionCheckpoints`, `TrajectoryDetailRecord`, `TrajectoryRecordVersion`, `TrajectoryChainBucket`, `TRAJECTORY_ARCHIVE_FORMAT`, `TRAJECTORY_ARCHIVE_VERSION`, `TRAJECTORY_ARCHIVE_ENTRY_NAME`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { Unzip, UnzipInflate, type UnzipFile } from 'fflate';`；`import type { WebConnectionState } from '../../types';`；`import { isTeamAgentMode } from '../planMode/wireMode';`；`import type { OtlpExportTraceServiceRequest } from './shared/otlp';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/trajectory/trajectoryArchive.ts#L1-L812)。
- **`jiuwenswarm/channels/web/frontend/src/features/trajectory/trajectoryCheckpoints.ts`**
- 源码声明的类型、组件或调用边界：`TrajectoryV2SubjectSeed`, `SequenceCache`, `TRAJECTORY_CHECKPOINT_STATE_VERSION`, `TrajectoryRetentionCheckpoints`, `EMPTY_TRAJECTORY_CHECKPOINTS`, `SUBJECT_KINDS`, `object`, `count`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import type {`；`import {`；`import type { OtlpExportTraceServiceRequest } from './shared/otlp';`；`import type { TrajectoryDetailRecord } from './trajectoryClient';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/trajectory/trajectoryCheckpoints.ts#L1-L259)。
- **`jiuwenswarm/channels/web/frontend/src/features/trajectory/trajectoryClient.ts`**
- 源码声明的类型、组件或调用边界：`TrajectorySubjectSummary`, `TrajectorySubjectListResponse`, `TrajectorySessionUsageItem`, `TrajectorySessionUsageResponse`, `TrajectoryDetailRecord`, `TrajectoryStreamFrame`, `TrajectoryStreamFramesResponse`, `TrajectorySubjectRecordsResponse`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { getApiBase } from '../../utils/env';`；`import type { OtlpExportTraceServiceRequest } from './shared/otlp';`；`import type { TrajectoryUsage } from './trajectory/model';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/trajectory/trajectoryClient.ts#L1-L615)。
- **`jiuwenswarm/channels/web/frontend/src/features/trajectory/trajectoryFrames.ts`**
- 源码声明的类型、组件或调用边界：`StreamingSpanText`, `StreamFrameState`, `emptyStreamFrameState`, `spanKey`, `blank`, `withFrame`, `next`, `callId`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import type {`；`import type { TrajectoryStreamFrame } from './trajectoryClient'`；`import {`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/trajectory/trajectoryFrames.ts#L1-L233)。
- **`jiuwenswarm/channels/web/frontend/src/features/trajectory/trajectoryLayout.ts`**
- 源码声明的类型、组件或调用边界：`RAW_INSPECTOR_DEFAULT_HEIGHT`, `RAW_INSPECTOR_MIN_HEIGHT`, `RAW_INSPECTOR_MAX_RATIO`, `RAW_INSPECTOR_KEYBOARD_STEP`, `RawInspectorHeightBounds`, `shouldInsetTrajectoryForFloatingTasks`, `trajectoryComposerClearance`, `rawInspectorHeightBounds`；这是词法声明索引，不把局部变量当成对外导出 API。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/trajectory/trajectoryLayout.ts#L1-L90)。
- **`jiuwenswarm/channels/web/frontend/src/features/trajectory/trajectorySequences.ts`**
- 源码声明的类型、组件或调用边界：`SequenceCache`, `createSequenceCache`, `parseSequenceReference`, `parts`, `depth`, `absorbSequencePage`, `missingSequenceContent`, `missing`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import type { TrajectoryDetailRecord } from './trajectoryClient'`；`import type { OtlpExportTraceServiceRequest } from './shared/otlp'`；`import {`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/trajectory/trajectorySequences.ts#L1-L239)。
- **`jiuwenswarm/channels/web/frontend/src/features/trajectory/trajectorySubjects.ts`**
- 源码声明的类型、组件或调用边界：`OtlpExportTraceServiceRequest`, `MAIN_TRAJECTORY_SUBJECT_ID`, `UNASSIGNED_TRAJECTORY_SUBJECT_ID`, `TrajectorySubjectKind`, `TrajectorySubject`, `TrajectorySubjectGroup`, `TrajectorySubjectGroups`, `TrajectoryRetiredSubject`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { OPENJIUWEN_ATTRIBUTES } from './semconv/constants';`；`import { stringAttribute, type OtlpExportTraceServiceRequest } from './shared/otlp';`；`import type { TrajectoryDetailRecord } from './trajectoryClient';`；
  - `import { detailRecordIdentity, spansOf } from './trajectoryWindow';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/trajectory/trajectorySubjects.ts#L1-L435)。
- **`jiuwenswarm/channels/web/frontend/src/features/trajectory/trajectoryTurnGaps.ts`**
- 源码声明的类型、组件或调用边界：`TrajectoryTurnRange`, `unrecordedTurnRanges`, `numbers`, `ranges`, `expected`, `turn`, `countTurns`；这是词法声明索引，不把局部变量当成对外导出 API。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/trajectory/trajectoryTurnGaps.ts#L1-L54)。
- **`jiuwenswarm/channels/web/frontend/src/features/trajectory/trajectoryWindow.ts`**
- 源码声明的类型、组件或调用边界：`TrajectoryChainBucket`, `TrajectoryRecordVersion`, `TrajectoryWindowState`, `SubjectRefreshWindow`, `TrajectoryOperationCoordinator`, `TrajectoryTraceHintCoordinator`, `StagedTrajectoryChain`, `TrajectoryContentMode`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import type {`；`import type { TrajectoryUsage } from './trajectory/model';`；`import type {`；`import { emptyStreamFrameState } from './trajectoryFrames';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/trajectory/trajectoryWindow.ts#L1-L495)。

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/web-frontend/features-trajectory/source-contracts-04.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
