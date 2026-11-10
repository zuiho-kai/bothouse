---
name: stores-contracts-01
description: web-frontend stores 源码接口与集成边界 01：src/stores 下字母序前十四个 store 文件（agentCatalogStore、agentGroupCatalogSeed、authStore、chatStore、connectorStore、cronStore、ensureSessionRuntimes、goalStore、harnessStore、pendingQuestionQueue、personalContextStore、planStore、pluginPackageStore、sessionStore）的静态声明与导入
metadata:
  scope: 只收这十四个 store 文件的静态声明索引与导入，不证明运行行为；subagentStore、teamTaskNormalize、todoStore、toolResultLifecycle、workspaceStore 归 stores-contracts-02，入口说明归 stores-overview
---
# stores 源码接口与集成边界 01

## 现状

- 本页逐文件说明这一源码模块声明的接口、类型与依赖。记录来自静态源码声明，不证明控制流、配置生效、外部服务可用或测试通过；功能语义与设计取舍沿上级功能页继续阅读。
- **`jiuwenswarm/channels/web/frontend/src/stores/agentCatalogStore.ts`**
- 源码声明的类型、组件或调用边界：`AgentCatalogStatus`, `AgentCatalogState`, `catalogGeneration`, `pendingLoad`, `useAgentCatalogStore`, `publishAgentCatalog`, `seedAgentCatalog`, `invalidateAgentCatalog`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { create } from 'zustand';`；`import type { AgentCatalogItem } from '../features/agentManagement/types';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/stores/agentCatalogStore.ts#L1-L79)。
- **`jiuwenswarm/channels/web/frontend/src/stores/agentGroupCatalogSeed.ts`**
- 源码声明的类型、组件或调用边界：`selectedGroup`, `seedSelectedAgentGroup`, `getSelectedAgentGroup`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import type { AgentGroupCatalogItem } from '../features/agentManagement/types';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/stores/agentGroupCatalogSeed.ts#L1-L11)。
- **`jiuwenswarm/channels/web/frontend/src/stores/authStore.ts`**
- 源码声明的类型、组件或调用边界：`RETRY_DELAYS_MS`, `DEFAULT_ACCOUNT_CENTER_URL`, `LoginPhase`, `AuthState`, `pendingLogin`, `detachTriggers`, `claimInFlight`, `claimRequestedAgain`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { create } from 'zustand';`；`import { webClient } from '../services/webClient';`；`import {`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/stores/authStore.ts#L1-L425)。
- **`jiuwenswarm/channels/web/frontend/src/stores/chatStore.ts`**
- 源码声明的类型、组件或调用边界：`TOOL_TIMEOUT_MS`, `EVOLUTION_STATUS_END_VISIBLE_MS`, `reasoningSegmentSeq`, `createReasoningSegmentId`, `computeTimeoutAt`, `resolveExecutionStatus`, `TaskInputStatus`, `TaskInputReceipt`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { create } from 'zustand';`；`import { subscribeWithSelector } from 'zustand/middleware';`；`import {`；`import { useTodoStore } from './todoStore';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/stores/chatStore.ts#L1-L2188)。
- **`jiuwenswarm/channels/web/frontend/src/stores/connectorStore.ts`**
- 源码声明的类型、组件或调用边界：`ConnectorState`, `patchConnection`, `patchConnectionAll`, `mergeByName`, `map`, `item`, `invalidateDetail`, `next`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { scheduleCatalogRefresh, catalogScope } from '../features/catalogCache';`；`import { create } from 'zustand';`；`import i18n from '../i18n';`；`import { connectorApi } from '../services/connectorApi';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/stores/connectorStore.ts#L1-L621)。
- **`jiuwenswarm/channels/web/frontend/src/stores/cronStore.ts`**
- 源码声明的类型、组件或调用边界：`SidebarCronJob`, `isWebChannelJob`, `s`, `CronState`, `persistCronUnread`, `useCronStore`, `value`, `next`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { create } from 'zustand';`；`import { webRequest } from '../services/webClient';`；`import { projectRegistryClient } from '../features/workspace/projectRegistryClient';`；`import type { Session } from '../types';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/stores/cronStore.ts#L1-L165)。
- **`jiuwenswarm/channels/web/frontend/src/stores/ensureSessionRuntimes.ts`**
- 源码声明的类型、组件或调用边界：`ensureSessionRuntimes`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { useChatStore } from './chatStore';`；`import { useGoalStore } from './goalStore';`；`import { useHarnessStore } from './harnessStore';`；`import { usePlanStore } from './planStore';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/stores/ensureSessionRuntimes.ts#L1-L15)。
- **`jiuwenswarm/channels/web/frontend/src/stores/goalStore.ts`**
- 源码声明的类型、组件或调用边界：`GoalRuntime`, `createEmptyRuntime`, `LOCAL_CREATED_AT_STORAGE_KEY`, `LOCAL_CREATED_AT_MAX_ENTRIES`, `loadLocalCreatedAtFromStorage`, `raw`, `parsed`, `saveLocalCreatedAtToStorage`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { create } from 'zustand';`；`import { GoalAction, GoalRecord } from '../types';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/stores/goalStore.ts#L1-L401)。
- **`jiuwenswarm/channels/web/frontend/src/stores/harnessStore.ts`**
- 源码声明的类型、组件或调用边界：`HarnessStageStatus`, `ExtensionProgressStatus`, `HarnessStageDefinition`, `HarnessStageInfo`, `HarnessMessageEntry`, `ExtensionReadyInfo`, `RuntimeExtensionInfo`, `ExtensionProgressInfo`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { create } from 'zustand';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/stores/harnessStore.ts#L1-L550)。
- **`jiuwenswarm/channels/web/frontend/src/stores/pendingQuestionQueue.ts`**
- 源码声明的类型、组件或调用边界：`PERMISSION_SOURCES`, `boundedIdentity`, `normalized`, `pendingQuestionIdentity`, `kind`, `requestId`, `permissionQuestionKind`, `enqueuePendingQuestions`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import type {`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/stores/pendingQuestionQueue.ts#L1-L95)。
- **`jiuwenswarm/channels/web/frontend/src/stores/personalContextStore.ts`**
- 源码声明的类型、组件或调用边界：`AuthorizationResult`, `ContextGraph`, `FetchServiceConfig`, `FetchServicePatch`, `FetchProvider`, `FetchRunRecord`, `PersonalContextConfig`, `PersonalContextStatus`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { create } from 'zustand';`；`import {`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/stores/personalContextStore.ts#L1-L499)。
- **`jiuwenswarm/channels/web/frontend/src/stores/planStore.ts`**
- 源码声明的类型、组件或调用边界：`PlanRuntime`, `createEmptyRuntime`, `SetActiveOptions`, `PlanState`, `usePlanStore`, `runtimes`, `current`, `pendingExplicitEntry`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { create } from 'zustand';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/stores/planStore.ts#L1-L133)。
- **`jiuwenswarm/channels/web/frontend/src/stores/pluginPackageStore.ts`**
- 源码声明的类型、组件或调用边界：`LOCAL_STORAGE_KEY`, `PersistedLocalState`, `loadPersistedLocalState`, `raw`, `parsed`, `persistLocalState`, `PluginPackageState`, `persisted`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { scheduleCatalogRefresh, catalogScope } from '../features/catalogCache';`；`import { create } from 'zustand';`；`import { extractRpcErrorMessage } from '../features/agentManagement/upload';`；
  - `import { PluginInstallPendingError, pluginPackagesApi } from '../services/pluginPackagesApi';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/stores/pluginPackageStore.ts#L1-L384)。
- **`jiuwenswarm/channels/web/frontend/src/stores/sessionStore.ts`**
- 源码声明的类型、组件或调用边界：`TaskProgressBaseline`, `TeamConnectionPresentation`, `WorkflowAgent`, `WorkflowPhase`, `WorkflowRun`, `TeamLeaderIdentity`, `MODE_STORAGE_KEY`, `MODEL_STORAGE_KEY`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { create } from 'zustand';`；`import {`；`import {`；`import {`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/stores/sessionStore.ts#L1-L1968)。

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/web-frontend/stores/source-contracts-01.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
