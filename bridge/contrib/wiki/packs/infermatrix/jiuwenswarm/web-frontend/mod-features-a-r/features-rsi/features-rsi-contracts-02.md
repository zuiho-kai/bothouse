---
name: features-rsi-contracts-02
description: features-rsi 源码接口与集成边界 02：features/rsi 根目录十个非组件文件（featureConfig、latexPreview、mockData、rsiApi、rsiArtifactFiles、rsiPresentation、rsiStore、rsiTreeLayout、types、useRsiEvents）的静态声明与导入
metadata:
  scope: 只收 features/rsi 根目录的配置、API、store、布局、类型与事件 hook 文件声明，不证明运行行为；RsiPage 与 components/ 下组件归 features-rsi-contracts-01，入口说明归 features-rsi-overview
---
# features-rsi 源码接口与集成边界 02

## 现状

- 本页逐文件说明这一源码模块声明的接口、类型与依赖。记录来自静态源码声明，不证明控制流、配置生效、外部服务可用或测试通过；功能语义与设计取舍沿上级功能页继续阅读。
- **`jiuwenswarm/channels/web/frontend/src/features/rsi/featureConfig.ts`**
- 源码声明的类型、组件或调用边界：`rsiFeatureEnabled`, `rsiFeatureListeners`, `setRSIFeatureEnabled`, `isRSIFeatureEnabled`, `subscribeRSIFeatureEnabled`, `useRSIFeatureEnabled`, `normalizeRSIEnabled`, `text`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { useSyncExternalStore } from 'react';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/rsi/featureConfig.ts#L1-L33)。
- **`jiuwenswarm/channels/web/frontend/src/features/rsi/latexPreview.ts`**
- 源码声明的类型、组件或调用边界：`LatexPreviewOptions`, `stripComments`, `findMatchingBrace`, `depth`, `i`, `ch`, `unwrapSizingCommands`, `pattern`；这是词法声明索引，不把局部变量当成对外导出 API。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/rsi/latexPreview.ts#L1-L458)。
- **`jiuwenswarm/channels/web/frontend/src/features/rsi/mockData.ts`**
- 源码声明的类型、组件或调用边界：`LATENCY`, `delay`, `RSI_LOCAL_ARTIFACT_PATH`, `LOCAL_TEST_ARTIFACT_PATH`, `rsiMockModelList`, `mockTasks`, `buildMockTree`, `mk`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import type {`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/rsi/mockData.ts#L1-L414)。
- **`jiuwenswarm/channels/web/frontend/src/features/rsi/rsiApi.ts`**
- 源码声明的类型、组件或调用边界：`RSI_EVENTS`, `METHOD`, `RSI_MOCK_STORAGE_KEY`, `isMockEnabled`, `RSI_SESSION_STORAGE_KEY`, `inMemoryRsiSessionId`, `getRsiSessionId`, `stored`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { webRequest } from '../../services/webClient';`；`import { rsiMock } from './mockData';`；`import type {`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/rsi/rsiApi.ts#L1-L763)。
- **`jiuwenswarm/channels/web/frontend/src/features/rsi/rsiArtifactFiles.ts`**
- 源码声明的类型、组件或调用边界：`RsiArtifactSource`, `RsiArtifactFileEntry`, `RsiArtifactLoadResult`, `BINARY_EXTENSIONS`, `MIME_BY_EXTENSION`, `LATEX_TEXT_EXTENSIONS`, `normalizePath`, `relativePathFor`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import type { RsiArtifactFileGetResult, RsiTreeNode } from './types';`；`import { rsiArtifactFilesGet, rsiArtifactFilesList } from './rsiApi';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/rsi/rsiArtifactFiles.ts#L1-L167)。
- **`jiuwenswarm/channels/web/frontend/src/features/rsi/rsiPresentation.ts`**
- 源码声明的类型、组件或调用边界：`NodeStatusKind`, `nodeTypeToStatusKind`, `statusKindClass`, `legendDotClass`, `JsonRecord`, `asRecord`, `asText`, `text`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import type {`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/rsi/rsiPresentation.ts#L1-L975)。
- **`jiuwenswarm/channels/web/frontend/src/features/rsi/rsiStore.ts`**
- 源码声明的类型、组件或调用边界：`RsiDetailState`, `RsiState`, `emptyDetail`, `detailRequests`, `useRsiStore`, `list`, `pending`, `request`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { create } from 'zustand';`；`import type {`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/rsi/rsiStore.ts#L1-L326)。
- **`jiuwenswarm/channels/web/frontend/src/features/rsi/rsiTreeLayout.ts`**
- 源码声明的类型、组件或调用边界：`NodeRuntimeKind`, `LayoutNode`, `LayoutEdge`, `TreeLayout`, `NODE_W`, `NODE_H`, `DEPTH_GAP`, `SIBLING_GAP`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import type { RsiTreeNode } from './types';`；`import { nodeMetrics, nodeRuntimeKindForNode, type NodeRuntimeKind } from './rsiPresentation';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/rsi/rsiTreeLayout.ts#L1-L201)。
- **`jiuwenswarm/channels/web/frontend/src/features/rsi/types.ts`**
- 源码声明的类型、组件或调用边界：`RsiScenario`, `RsiArtifactType`, `RsiTaskStatus`, `RsiNodeType`, `RsiUsage`, `RsiDatasetValidateParams`, `RsiDatasetValidateResult`, `RsiTaskCreateBase`；这是词法声明索引，不把局部变量当成对外导出 API。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/rsi/types.ts#L1-L258)。
- **`jiuwenswarm/channels/web/frontend/src/features/rsi/useRsiEvents.ts`**
- 源码声明的类型、组件或调用边界：`useRsiEvents`, `applyStatusChanged`, `applyProgress`, `applyTreeDelta`, `offStatus`, `normalized`, `offProgress`, `normalized`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { useEffect } from 'react';`；`import { webClient } from '../../services/webClient';`；`import { useRsiStore } from './rsiStore';`；`import {`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/rsi/useRsiEvents.ts#L1-L42)。

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/web-frontend/features-rsi/source-contracts-02.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
