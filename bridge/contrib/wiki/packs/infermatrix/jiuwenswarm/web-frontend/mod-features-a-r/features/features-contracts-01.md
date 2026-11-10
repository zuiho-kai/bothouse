---
name: features-contracts-01
description: features 源码接口 01：web 前端 src/features 目录下 agentIdentity、assetPublication、assetPublishErrors/Events/State、browserAgentActivity、catalogCache、desktopBrowserFile、equipmentListRequest、equipmentMarketplace、fileTreeFilters、goalPendingObjectiveBubble、historyFilePreview、historyPagination、historyRecordReassembler、historyRestore 共十六个文件的声明与导入依赖
metadata:
  scope: 只收字母序 agentIdentity 至 historyRestore 十六个文件的静态声明记录，不证明运行行为；sessionInput 起的文件归 features-contracts-02，teamPanelState 与 teamTaskProgressBaseline 归 features-contracts-03，入口说明归 features-overview
---
# features 源码接口与集成边界 01

## 现状

- 本页逐文件说明这一源码模块声明的接口、类型与依赖。记录来自静态源码声明，不证明控制流、配置生效、外部服务可用或测试通过；功能语义与设计取舍沿上级功能页继续阅读。
- **`jiuwenswarm/channels/web/frontend/src/features/agentIdentity.ts`**
- 源码声明的类型、组件或调用边界：`normalizeAgentTemplateName`, `normalized`, `readAgentTemplateName`；这是词法声明索引，不把局部变量当成对外导出 API。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/agentIdentity.ts#L1-L14)。
- **`jiuwenswarm/channels/web/frontend/src/features/assetPublication.ts`**
- 源码声明的类型、组件或调用边界：`PublicationState`, `PublicationFilter`, `matchesPublicationFilter`, `publicationLabel`, `labels`, `publicationDetailLabel`；这是词法声明索引，不把局部变量当成对外导出 API。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/assetPublication.ts#L1-L20)。
- **`jiuwenswarm/channels/web/frontend/src/features/assetPublishErrors.ts`**
- 源码声明的类型、组件或调用边界：`SAFE_FAILURE_KEYS`, `PublishFailureKey`, `errorCode`, `candidate`, `payload`, `publishIssueKey`, `normalized`, `publishFailureKey`；这是词法声明索引，不把局部变量当成对外导出 API。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/assetPublishErrors.ts#L1-L33)。
- **`jiuwenswarm/channels/web/frontend/src/features/assetPublishEvents.ts`**
- 源码声明的类型、组件或调用边界：`openAssetPublish`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import type { AssetPublishOpenRequest } from '../types/assetPublish';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/assetPublishEvents.ts#L1-L4)。
- **`jiuwenswarm/channels/web/frontend/src/features/assetPublishState.ts`**
- 源码声明的类型、组件或调用边界：`canShowAssetPublish`, `publishOutcome`, `result`, `validateMetadata`, `errors`, `createCommitAttempt`, `pending`, `completed`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import type { PublishMetadata, PublishRecord } from '../types/assetPublish';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/assetPublishState.ts#L1-L61)。
- **`jiuwenswarm/channels/web/frontend/src/features/browserAgentActivity.ts`**
- 源码声明的类型、组件或调用边界：`useBrowserAgentActivity`, `desktop`, `isTeam`, `active`, `receivedEvent`, `update`, `unsubscribe`, `hasBrowserSubagent`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { useEffect, useState } from 'react';`；`import { useSessionStore } from '../stores/sessionStore';`；`import { useSubagentStore } from '../stores/subagentStore';`；`import type { ElectronBrowserState } from '../types/electron';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/browserAgentActivity.ts#L1-L60)。
- **`jiuwenswarm/channels/web/frontend/src/features/catalogCache.ts`**
- 源码声明的类型、组件或调用边界：`CatalogCacheMetadata`, `CatalogCacheNoticeModel`, `catalogCacheNotice`, `failed`, `catalogCacheTimestamp`, `numeric`, `parsed`, `formatCatalogCacheUpdatedAt`；这是词法声明索引，不把局部变量当成对外导出 API。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/catalogCache.ts#L1-L109)。
- **`jiuwenswarm/channels/web/frontend/src/features/desktopBrowserFile.ts`**
- 源码声明的类型、组件或调用边界：`DESKTOP_BROWSER_TAB_EVENT`, `DESKTOP_BROWSER_TAB_FLAGS_KEY`, `DESKTOP_BROWSER_FILE_EXTENSIONS`, `DesktopBrowserTabFlags`, `EMPTY_TAB_FLAGS`, `tabFlagsStorageKey`, `loadDesktopBrowserTabFlags`, `raw`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { useEffect, useState } from 'react';`；`import { getApiBase } from '../utils/env';`；`import { useChatStore } from '../stores/chatStore';`；`import { useSessionStore } from '../stores/sessionStore';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/desktopBrowserFile.ts#L1-L128)。
- **`jiuwenswarm/channels/web/frontend/src/features/equipmentListRequest.ts`**
- 源码声明的类型、组件或调用边界：`EquipmentListRequest`, `EQUIPMENT_LIST_TIMEOUT_MS`, `requestEquipmentList`；这是词法声明索引，不把局部变量当成对外导出 API。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/equipmentListRequest.ts#L1-L20)。
- **`jiuwenswarm/channels/web/frontend/src/features/equipmentMarketplace.ts`**
- 源码声明的类型、组件或调用边界：`EquipmentKind`, `EquipmentScope`, `EquipmentSource`, `equipmentListFilter`, `equipmentListFilter`, `equipmentListFilter`, `normalizeEquipmentSource`, `normalizeEquipmentIdentity`；这是词法声明索引，不把局部变量当成对外导出 API。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/equipmentMarketplace.ts#L1-L51)。
- **`jiuwenswarm/channels/web/frontend/src/features/fileTreeFilters.ts`**
- 源码声明的类型、组件或调用边界：`IGNORED_DIRECTORY_NAMES`, `IGNORED_DIRECTORY_SET`, `containsIgnoredDirectory`；这是词法声明索引，不把局部变量当成对外导出 API。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/fileTreeFilters.ts#L1-L16)。
- **`jiuwenswarm/channels/web/frontend/src/features/goalPendingObjectiveBubble.ts`**
- 源码声明的类型、组件或调用边界：`flushPendingGoalObjectiveBubble`, `queueOrAddGoalObjectiveMessage`, `trimmed`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { useChatStore } from '../stores/chatStore';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/goalPendingObjectiveBubble.ts#L1-L26)。
- **`jiuwenswarm/channels/web/frontend/src/features/historyFilePreview.ts`**
- 源码声明的类型、组件或调用边界：`isHistoryPreviewFile`, `lowerName`, `parseHistoryFileContent`, `trimmed`, `parsed`；这是词法声明索引，不把局部变量当成对外导出 API。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/historyFilePreview.ts#L1-L20)。
- **`jiuwenswarm/channels/web/frontend/src/features/historyPagination.ts`**
- 源码声明的类型、组件或调用边界：`HistoryCursorBatchDescriptor`, `HistoryCursorApplyState`, `HistoryCursorApplyCandidate`, `canApplyHistoryCursorBatch`, `filterPublishedHistoryBatch`, `HistoryPrefetchOutcome`, `PrefetchHistoryBatchesOptions`, `prefetchHistoryBatches`；这是词法声明索引，不把局部变量当成对外导出 API。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/historyPagination.ts#L1-L121)。
- **`jiuwenswarm/channels/web/frontend/src/features/historyRecordReassembler.ts`**
- 源码声明的类型、组件或调用边界：`HistoryRecordReassembler`, `part`, `rid`, `idx`, `total`, `bucket`, `ordered`, `merged`；这是词法声明索引，不把局部变量当成对外导出 API。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/historyRecordReassembler.ts#L1-L60)。
- **`jiuwenswarm/channels/web/frontend/src/features/historyRestore.ts`**
- 源码声明的类型、组件或调用边界：`HISTORY_GET_METHOD`, `HISTORY_MESSAGE_EVENT`, `HISTORY_RESTORE_TIMEOUT_MS`, `ALLOWED_ASSISTANT_EVENT_TYPES`, `HISTORY_RESTORE_DONE_CONTENT`, `HistoryToolReplayItem`, `mergeHistoryToolReplayItems`, `merged`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { readOutputOrder, isSuppressedOutput } from './sessionOutput';`；`import type { OutputOrder } from '../types/message';`；`import { Message, MessageRole, UsageSummary, FileDownloadItem, MediaItem, WsEvent, ToolExecution, As`；`import { webClient } from '../services/webClient';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/historyRestore.ts#L1-L2582)。

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/web-frontend/features/source-contracts-01.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
