---
name: components-connectormarket-contracts-02
description: components-connectormarket 源码接口与集成边界 02：web/frontend/src/components/ConnectorMarket 下 RegisterMcpPage.tsx、Toast.tsx、TruncatedText.tsx、UploadFileCreateModal.tsx、icons.tsx、index.tsx、mcpState.ts、useClickOutside.ts、usePendingConnectorFlow.tsx 共 9 个前端文件的静态声明（类型、组件与导入边界）
metadata:
  scope: 只收上列 9 个前端文件的静态声明，不证明运行行为；其余前端文件的声明归 components-connectormarket-contracts-01；入口说明归 components-connectormarket-overview
---
# components-connectormarket 源码接口与集成边界 02

## 现状

- 本页逐文件说明这一源码模块声明的接口、类型与依赖。记录来自静态源码声明，不证明控制流、配置生效、外部服务可用或测试通过；功能语义与设计取舍沿上级功能页继续阅读。
- **`jiuwenswarm/channels/web/frontend/src/components/ConnectorMarket/RegisterMcpPage.tsx`**
- 源码声明的类型、组件或调用边界：`McpConfigType`, `KeyValueRow`, `rowSeq`, `newRow`, `rowsFromArray`, `rowsFromRecord`, `entries`, `ParsedMcpConfig`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { useEffect, useState } from 'react';`；`import { useTranslation } from 'react-i18next';`；`import { Minus, Plus } from 'lucide-react';`；`import { useConnectorStore } from '../../stores/connectorStore';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/ConnectorMarket/RegisterMcpPage.tsx#L1-L480)。
- **`jiuwenswarm/channels/web/frontend/src/components/ConnectorMarket/Toast.tsx`**
- 源码声明的类型、组件或调用边界：`ToastProps`, `Toast`, `isError`, `timer`, `palette`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { useEffect } from 'react';`；`import { AlertCircle, CheckCircle2, X } from 'lucide-react';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/ConnectorMarket/Toast.tsx#L1-L55)。
- **`jiuwenswarm/channels/web/frontend/src/components/ConnectorMarket/TruncatedText.tsx`**
- 源码声明的类型、组件或调用边界：`TruncatedTextProps`, `TruncatedText`, `ref`, `el`, `check`, `observer`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { useLayoutEffect, useRef, useState } from 'react';`；`import { useAdaptiveTooltip } from '../../hooks/useAdaptiveTooltip';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/ConnectorMarket/TruncatedText.tsx#L1-L37)。
- **`jiuwenswarm/channels/web/frontend/src/components/ConnectorMarket/UploadFileCreateModal.tsx`**
- 源码声明的类型、组件或调用边界：`LocalFilePick`, `UploadFileCreateModalProps`, `ACCEPTED_EXTENSIONS`, `DROP_ZONE_CLASS`, `DROP_ACCEPT_WINDOW_MS`, `isAcceptedFilename`, `lower`, `formatFileSize`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { useEffect, useRef, useState } from 'react';`；`import { createPortal } from 'react-dom';`；`import { useTranslation } from 'react-i18next';`；`import { X, UploadCloud, Info, FileArchive, Loader2 } from 'lucide-react';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/ConnectorMarket/UploadFileCreateModal.tsx#L1-L243)。
- **`jiuwenswarm/channels/web/frontend/src/components/ConnectorMarket/icons.tsx`**
- 源码声明的类型、组件或调用边界：`ExtensionIcon`, `NewConversationIcon`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import ExtensionAsset from '../../assets/agent-management/extension.svg?react';`；`import NewConversationAsset from '../../assets/agent-management/new-conversation.svg?react';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/ConnectorMarket/icons.tsx#L1-L10)。
- **`jiuwenswarm/channels/web/frontend/src/components/ConnectorMarket/index.tsx`**
- 源码声明的类型、组件或调用边界：`TopTab`, `pendingManageView`, `requestManageView`, `View`, `ConnectorMarketPanelProps`, `ConnectorMarketPanel`, `kind`, `loadConnectorList`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { useEffect, useState } from 'react';`；`import { useTranslation } from 'react-i18next';`；`import { useConnectorStore } from '../../stores/connectorStore';`；`import { usePluginPackageStore } from '../../stores/pluginPackageStore';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/ConnectorMarket/index.tsx#L1-L320)。
- **`jiuwenswarm/channels/web/frontend/src/components/ConnectorMarket/mcpState.ts`**
- 源码声明的类型、组件或调用边界：`McpCardState`, `McpCardInput`, `deriveCardState`, `busyLabelKey`, `deriveMcpAvailability`, `nextMcpQuickAction`, `derivePluginCardState`, `cardStateToStatusFilter`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import type { ConnectorSummary, McpBusyKind } from '../../types/connector';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/ConnectorMarket/mcpState.ts#L1-L130)。
- **`jiuwenswarm/channels/web/frontend/src/components/ConnectorMarket/useClickOutside.ts`**
- 源码声明的类型、组件或调用边界：`useClickOutside`, `handler`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { useEffect } from 'react';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/ConnectorMarket/useClickOutside.ts#L1-L13)。
- **`jiuwenswarm/channels/web/frontend/src/components/ConnectorMarket/usePendingConnectorFlow.tsx`**
- 源码声明的类型、组件或调用边界：`PendingConnectorAbortReason`, `PendingConnectorFlow`, `findStoredConnector`, `state`, `ensurePendingConnector`, `store`, `connector`, `assetId`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { useState } from 'react';`；`import { useConnectorStore } from '../../stores/connectorStore';`；`import type { ConnectorConnectResponse, ConnectorSummary } from '../../types/connector';`；`import { ConnectTokenModal } from './ConnectTokenModal';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/ConnectorMarket/usePendingConnectorFlow.tsx#L1-L198)。

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/web-frontend/components-connectormarket/source-contracts-02.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
