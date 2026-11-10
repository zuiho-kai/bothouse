---
name: features-contracts-02
description: features 源码接口 02：web 前端 src/features 目录下 sessionInput、sessionOutput、shareImage 系列（Archive、Export.tsx、Job、Png.worker、PngEncoder、Raster）、singleAgentPanelState、streamingPng、teamConnectionPresentation、teamHistoryPanelRestore、teamLeaderIdentity、teamLeaderMessages、teamPanelStateNormalize 共十五个文件的声明与导入依赖
metadata:
  scope: 只收 sessionInput 至 teamPanelStateNormalize 十五个文件的静态声明记录，不证明运行行为；agentIdentity 至 historyRestore 归 features-contracts-01，teamPanelState 与 teamTaskProgressBaseline 归 features-contracts-03，入口说明归 features-overview
---
# features 源码接口与集成边界 02

## 现状

- 本页逐文件说明这一源码模块声明的接口、类型与依赖。记录来自静态源码声明，不证明控制流、配置生效、外部服务可用或测试通过；功能语义与设计取舍沿上级功能页继续阅读。
- **`jiuwenswarm/channels/web/frontend/src/features/sessionInput.ts`**
- 源码声明的类型、组件或调用边界：`SendRequest`, `deliveryFailedStatus`, `payload`, `code`, `sendQueuedTaskInput`, `task`, `startedWhileIdle`, `requestId`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { useChatStore } from '../stores/chatStore';`；`import { useSessionStore } from '../stores/sessionStore';`；`import { readOutputOrder } from './sessionOutput';`；`import { extractCrossSessionMessage } from '../utils/crossSessionMessage';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/sessionInput.ts#L1-L168)。
- **`jiuwenswarm/channels/web/frontend/src/features/sessionOutput.ts`**
- 源码声明的类型、组件或调用边界：`readOutputOrder`, `value`, `order`, `isSuppressedOutput`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import type { OutputOrder } from '../types/message';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/sessionOutput.ts#L1-L14)。
- **`jiuwenswarm/channels/web/frontend/src/features/shareImageArchive.ts`**
- 源码声明的类型、组件或调用边界：`ShareImageExportArtifact`, `normalizedPngFilename`, `safeFilename`, `shareImageFilenameStem`, `getShareImagePartFilename`, `digits`, `part`, `total`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import JSZip from 'jszip';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/shareImageArchive.ts#L1-L62)。
- **`jiuwenswarm/channels/web/frontend/src/features/shareImageExport.tsx`**
- 源码声明的类型、组件或调用边界：`ParsedTeamEvent`, `ShareImageExportArtifact`, `ShareImageMetadata`, `ShareImageSnapshot`, `ShareImageDocumentProps`, `GroupMessage`, `OPENJIUWEN_WEBSITE_URL`, `JIUWENSWARM_REPO_URL`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { forwardRef, useEffect, useMemo, useRef, useState } from 'react';`；`import { applyStyle } from 'html-to-image/es/apply-style';`；`import { cloneNode as cloneHtmlNode } from 'html-to-image/es/clone-node';`；`import { embedImages } from 'html-to-image/es/embed-images';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/shareImageExport.tsx#L1-L1659)。
- **`jiuwenswarm/channels/web/frontend/src/features/shareImageJob.ts`**
- 源码声明的类型、组件或调用边界：`ShareImageExportJobStatus`, `ShareImageJobStorage`, `ShareImageJobFetch`, `PENDING_SHARE_IMAGE_JOB_KEY_PREFIX`, `pendingShareImageJobKey`, `readPendingShareImageJobId`, `jobId`, `rememberPendingShareImageJob`；这是词法声明索引，不把局部变量当成对外导出 API。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/shareImageJob.ts#L1-L103)。
- **`jiuwenswarm/channels/web/frontend/src/features/shareImagePng.worker.ts`**
- 源码声明的类型、组件或调用边界：`workerScope`, `encoder`, `operation`, `postResponse`, `handleRequest`, `blob`, `request`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { StreamingPngEncoder } from './streamingPng';`；`import type { ShareImagePngWorkerRequest, ShareImagePngWorkerResponse } from './shareImagePngEncoder`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/shareImagePng.worker.ts#L1-L53)。
- **`jiuwenswarm/channels/web/frontend/src/features/shareImagePngEncoder.ts`**
- 源码声明的类型、组件或调用边界：`ShareImagePngWorkerRequest`, `ShareImagePngWorkerResponse`, `WithoutRequestId`, `ShareImagePngWorkerRequestPayload`, `PendingRequest`, `EncoderState`, `exactArrayBuffer`, `errorMessage`；这是词法声明索引，不把局部变量当成对外导出 API。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/shareImagePngEncoder.ts#L1-L168)。
- **`jiuwenswarm/channels/web/frontend/src/features/shareImageRaster.ts`**
- 源码声明的类型、组件或调用边界：`SHARE_IMAGE_WIDTH`, `SHARE_IMAGE_PIXEL_RATIO`, `SHARE_IMAGE_TILE_WORKING_BYTE_LIMIT`, `SHARE_IMAGE_MAX_PART_OUTPUT_HEIGHT`, `SHARE_IMAGE_FLOW_CONTAINER_SELECTOR`, `SHARE_IMAGE_FLOW_BLOCK_SELECTOR`, `SHARE_IMAGE_KATEX_ATOM_SELECTOR`, `SHARE_IMAGE_CLONE_BLOCK_SELECTOR`；
  - 这是词法声明索引，不把局部变量当成对外导出 API。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/shareImageRaster.ts#L1-L404)。
- **`jiuwenswarm/channels/web/frontend/src/features/singleAgentPanelState.ts`**
- 源码声明的类型、组件或调用边界：`SingleAgentToolTab`, `SingleAgentPanelState`, `UseSingleAgentPanelStateResult`, `SINGLE_AGENT_PANEL_STATE_KEY`, `SINGLE_AGENT_PANEL_STATE_EVENT`, `DEFAULT_STATE`, `normalizeState`, `raw`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { useCallback, useEffect, useState } from 'react';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/singleAgentPanelState.ts#L1-L129)。
- **`jiuwenswarm/channels/web/frontend/src/features/streamingPng.ts`**
- 源码声明的类型、组件或调用边界：`PNG_SIGNATURE`, `PNG_MAX_DIMENSION`, `TEXT_ENCODER`, `RGBA_BYTES_PER_PIXEL`, `buildCrc32Table`, `table`, `n`, `value`；这是词法声明索引，不把局部变量当成对外导出 API。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/streamingPng.ts#L1-L152)。
- **`jiuwenswarm/channels/web/frontend/src/features/teamConnectionPresentation.ts`**
- 源码声明的类型、组件或调用边界：`TeamConnectionPresentation`, `STORAGE_PREFIX`, `loadTeamConnectionPresentation`, `memberIds`, `saveTeamConnectionPresentation`, `key`, `TeamMemberStatus`, `RUNNING_TASK_STATUSES`；这是词法声明索引，不把局部变量当成对外导出 API。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/teamConnectionPresentation.ts#L1-L89)。
- **`jiuwenswarm/channels/web/frontend/src/features/teamHistoryPanelRestore.ts`**
- 源码声明的类型、组件或调用边界：`TaskProgressBaseline`, `TeamMember`, `TeamTaskEvent`, `TeamHistoryPanelState`, `TeamHistoryGetResponse`, `TEAM_TASK_STATUSES`, `TEAM_STATE_EVENT_TYPES`, `HISTORY_RECORD_META_KEYS`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { webClient } from '../services/webClient';`；`import type { Message } from '../types';`；`import type {`；`import { normalizeFinalContent } from '../utils/finalContent';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/teamHistoryPanelRestore.ts#L1-L938)。
- **`jiuwenswarm/channels/web/frontend/src/features/teamLeaderIdentity.ts`**
- 源码声明的类型、组件或调用边界：`TeamLeaderIdentity`, `isSafeTeamLeaderAvatar`, `avatar`, `normalizeTeamLeaderIdentity`, `raw`, `rawAgentTemplateId`, `rawDisplayName`, `rawDisplayNameI18n`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import type { LocalizedText } from '../types/pluginPackage';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/teamLeaderIdentity.ts#L1-L65)。
- **`jiuwenswarm/channels/web/frontend/src/features/teamLeaderMessages.ts`**
- 源码声明的类型、组件或调用边界：`findLatestUserIndex`, `index`, `isTeamLeaderMessage`, `extractTeamLeaderRawContent`, `jsonStr`, `data`, `findActiveTeamLeaderMessage`, `latestUserIndex`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import type { Message } from '../types';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/teamLeaderMessages.ts#L1-L51)。
- **`jiuwenswarm/channels/web/frontend/src/features/teamPanelStateNormalize.ts`**
- 源码声明的类型、组件或调用边界：`TeamPanelActiveTab`, `TeamPanelDetailTab`, `TeamPanelState`, `DEFAULT_TEAM_PANEL_STATE`, `VALID_ACTIVE_TABS`, `VALID_DETAIL_TABS`, `normalizeTeamPanelState`, `raw`；这是词法声明索引，不把局部变量当成对外导出 API。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/teamPanelStateNormalize.ts#L1-L71)。

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/web-frontend/features/source-contracts-02.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
