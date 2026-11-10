---
name: types-contracts-01
description: web-frontend types 源码接口与集成边界 01：src/types 下 assetPublish、beamSearch、connector、contextUsage、cron、electron、goal、heartbeat、index、message、pluginPackage、skillTree、subagent、todo、websocket 共十五个类型文件的静态声明与导入
metadata:
  scope: 只收这十五个类型文件的静态声明索引与导入，不证明运行行为；入口说明归 types-overview
---
# types 源码接口与集成边界 01

## 现状

- 本页逐文件说明这一源码模块声明的接口、类型与依赖。记录来自静态源码声明，不证明控制流、配置生效、外部服务可用或测试通过；功能语义与设计取舍沿上级功能页继续阅读。
- **`jiuwenswarm/channels/web/frontend/src/types/assetPublish.ts`**
- 源码声明的类型、组件或调用边界：`PublishAssetKind`, `AssetReference`, `AssetPublishOpenRequest`, `PublishMetadata`, `PublishIssue`, `PublishRecord`, `PublishDescription`, `PublishDraft`；这是词法声明索引，不把局部变量当成对外导出 API。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/types/assetPublish.ts#L1-L47)。
- **`jiuwenswarm/channels/web/frontend/src/types/beamSearch.ts`**
- 源码声明的类型、组件或调用边界：`BeamNodeStatus`, `BeamSearchNode`, `BeamSearchEdge`, `BeamSearchGraph`, `BeamSearchProgress`, `asRecord`, `parseBeamSearchProgress`, `record`；这是词法声明索引，不把局部变量当成对外导出 API。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/types/beamSearch.ts#L1-L48)。
- **`jiuwenswarm/channels/web/frontend/src/types/connector.ts`**
- 源码声明的类型、组件或调用边界：`ConnectorIntegrationType`, `ConnectorConnectionState`, `ConnectorSource`, `McpBusyKind`, `ConnectorSummary`, `ConnectorInstallResponse`, `ConnectorUninstallResponse`, `ConnectorTool`；这是词法声明索引，不把局部变量当成对外导出 API。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/types/connector.ts#L1-L138)。
- **`jiuwenswarm/channels/web/frontend/src/types/contextUsage.ts`**
- 源码声明的类型、组件或调用边界：`ContextUsagePart`, `ContextUsageSnapshot`；这是词法声明索引，不把局部变量当成对外导出 API。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/types/contextUsage.ts#L1-L28)。
- **`jiuwenswarm/channels/web/frontend/src/types/cron.ts`**
- 源码声明的类型、组件或调用边界：`CronJobDTO`, `CronTaskUI`, `CronTemplateUI`, `CronScheduleKind`, `CronSchedule`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import type { AgentMode } from './index';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/types/cron.ts#L1-L67)。
- **`jiuwenswarm/channels/web/frontend/src/types/electron.ts`**
- 源码声明的类型、组件或调用边界：`ElectronBrowserState`, `ElectronBrowserBounds`, `JiuwenElectronDesktopApi`；这是词法声明索引，不把局部变量当成对外导出 API。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/types/electron.ts#L1-L72)。
- **`jiuwenswarm/channels/web/frontend/src/types/goal.ts`**
- 源码声明的类型、组件或调用边界：`GoalStatus`, `GoalTokenUsage`, `GoalAssessment`, `GoalRecord`, `GoalAction`；这是词法声明索引，不把局部变量当成对外导出 API。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/types/goal.ts#L1-L45)。
- **`jiuwenswarm/channels/web/frontend/src/types/heartbeat.ts`**
- 源码声明的类型、组件或调用边界：`HeartbeatJobStatus`, `HeartbeatRunStatus`, `HeartbeatConcurrencyPolicy`, `HeartbeatSessionDeletedPolicy`, `HeartbeatScheduleKind`, `HeartbeatScheduleDTO`, `HeartbeatAutomationMetadata`, `HeartbeatRunState`；这是词法声明索引，不把局部变量当成对外导出 API。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/types/heartbeat.ts#L1-L139)。
- **`jiuwenswarm/channels/web/frontend/src/types/index.ts`**
- 源码声明的类型、组件或调用边界：`Session`, `AgentMode`, `SessionStatus`, `Permission`, `ModelPlan`, `ModelReasoningCapability`, `ModelReasoningProtocols`, `ModelReasoningRule`；这是词法声明索引，不把局部变量当成对外导出 API。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/types/index.ts#L1-L187)。
- **`jiuwenswarm/channels/web/frontend/src/types/message.ts`**
- 源码声明的类型、组件或调用边界：`MessageRole`, `OutputOrder`, `MediaItem`, `UsageSummary`, `FileDownloadItem`, `AutoReviewerStatus`, `AutoReviewerMetadata`, `ContextCompressionRuntime`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import type { SkillTreePath } from './skillTree';`；`import type { BeamSearchProgress } from './beamSearch';`；`import type { HeartbeatAutomationMetadata } from './heartbeat';`；`import type { CrossSessionMessageMetadata } from '../utils/crossSessionMessage';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/types/message.ts#L1-L244)。
- **`jiuwenswarm/channels/web/frontend/src/types/pluginPackage.ts`**
- 源码声明的类型、组件或调用边界：`LocalizedText`, `PluginPackageSource`, `PluginConnectionState`, `PluginPackageSummary`, `PluginCapabilityRef`, `PluginPackageDetail`, `localizedText`；这是词法声明索引，不把局部变量当成对外导出 API。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/types/pluginPackage.ts#L1-L83)。
- **`jiuwenswarm/channels/web/frontend/src/types/skillTree.ts`**
- 源码声明的类型、组件或调用边界：`SkillTreeNamedId`, `SkillTreeEventType`, `SkillTreeStep`, `SkillTreeCandidate`, `SkillTreePath`, `asRecord`, `parseSkillTreePath`, `source`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`source = JSON.parse(source);`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/types/skillTree.ts#L1-L98)。
- **`jiuwenswarm/channels/web/frontend/src/types/subagent.ts`**
- 源码声明的类型、组件或调用边界：`SubagentStatus`, `SubagentTurnOutcome`, `SubagentLifecycle`, `SubagentClosedReason`, `SubagentActivityKind`, `SubagentError`, `Subagent`, `SubagentActivity`；这是词法声明索引，不把局部变量当成对外导出 API。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/types/subagent.ts#L1-L83)。
- **`jiuwenswarm/channels/web/frontend/src/types/todo.ts`**
- 源码声明的类型、组件或调用边界：`TodoStatus`, `TodoItem`；这是词法声明索引，不把局部变量当成对外导出 API。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/types/todo.ts#L1-L16)。
- **`jiuwenswarm/channels/web/frontend/src/types/websocket.ts`**
- 源码声明的类型、组件或调用边界：`WebConnectionState`, `WsRequest`, `WsResponse`, `WsEvent`, `WebMessage`, `WebRequestOptions`, `WebConnectOptions`, `WebError`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import type { AutoReviewerMetadata } from './message';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/types/websocket.ts#L1-L204)。

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/web-frontend/types/source-contracts-01.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
