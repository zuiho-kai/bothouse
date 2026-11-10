---
name: services-contracts-01
description: web-frontend services 源码接口与集成边界 01：src/services 下 assetPublishApi、authClient、connectorApi、personalContextApi、pluginPackagesApi、sessionEventGate、streamDeltaBatcher、webClient 共八个服务文件的静态声明与导入
metadata:
  scope: 只收这八个 services 文件的静态声明索引与导入，不证明运行行为；入口说明归 services-overview
---
# services 源码接口与集成边界 01

## 现状

- 本页逐文件说明这一源码模块声明的接口、类型与依赖。记录来自静态源码声明，不证明控制流、配置生效、外部服务可用或测试通过；功能语义与设计取舍沿上级功能页继续阅读。
- **`jiuwenswarm/channels/web/frontend/src/services/assetPublishApi.ts`**
- 源码声明的类型、组件或调用边界：`request`, `assetPublishApi`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { webRequest } from './webClient';`；`import { getStoredOAuthProvider, getStoredOAuthToken } from '../utils/gitcodeOAuth';`；`import type {`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/services/assetPublishApi.ts#L1-L40)。
- **`jiuwenswarm/channels/web/frontend/src/services/authClient.ts`**
- 源码声明的类型、组件或调用边界：`SESSION_HEADER`, `SESSION_STORAGE_KEY`, `AUTH_REQUEST_HEADER`, `AUTH_CALLBACK_CHANNEL`, `AUTH_CALLBACK_MESSAGE`, `AuthorizeResponse`, `CampaignState`, `AuthStatus`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { getApiBase } from '../utils/env';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/services/authClient.ts#L1-L286)。
- **`jiuwenswarm/channels/web/frontend/src/services/connectorApi.ts`**
- 源码声明的类型、组件或调用边界：`CatalogItems`, `RawConnectorSummary`, `fromRawSummary`, `identity`, `source`, `RawConnectorTool`, `RawConnectorDetail`, `fromRawDetail`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { withCatalogCache, type CatalogItems, type CatalogCacheMetadata } from '../features/catalogC`；`import { webRequest } from './webClient';`；`import type {`；`import { normalizeEquipmentIdentity, normalizeEquipmentSource } from '../features/equipmentMarketpla`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/services/connectorApi.ts#L1-L278)。
- **`jiuwenswarm/channels/web/frontend/src/services/personalContextApi.ts`**
- 源码声明的类型、组件或调用边界：`PersonalContextRuntimeState`, `FetchServiceState`, `FetchRunState`, `FetchItemError`, `FetchRunProgress`, `FetchRunRecord`, `FetchRunStatusService`, `FetchRunStatusResponse`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { webClient, webRequest } from './webClient';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/services/personalContextApi.ts#L1-L772)。
- **`jiuwenswarm/channels/web/frontend/src/services/pluginPackagesApi.ts`**
- 源码声明的类型、组件或调用边界：`CatalogItems`, `PluginInstallPendingError`, `RawPluginPackageSummary`, `fromRawSummary`, `RawPluginPackageDetail`, `fromRawDetail`, `extractPendingConnectors`, `payload`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { withCatalogCache, type CatalogItems, type CatalogCacheMetadata } from '../features/catalogC`；`import { webRequest } from './webClient';`；`import type { WebError } from '../types/websocket';`；`import type {`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/services/pluginPackagesApi.ts#L1-L174)。
- **`jiuwenswarm/channels/web/frontend/src/services/sessionEventGate.ts`**
- 源码声明的类型、组件或调用边界：`EventDispatcher`, `SuspendedSessionEvents`, `IMMEDIATE_SESSION_EVENTS`, `normalizeSessionId`, `isRecord`, `getEventSessionId`, `payload`, `direct`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import type { WsEvent } from '../types';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/services/sessionEventGate.ts#L1-L105)。
- **`jiuwenswarm/channels/web/frontend/src/services/streamDeltaBatcher.ts`**
- 源码声明的类型、组件或调用边界：`TimerHandle`, `FlushCallback`, `StreamDeltaBatcherOptions`, `PendingDelta`, `createStreamDeltaBatcher`, `delayMs`, `schedule`, `cancel`；这是词法声明索引，不把局部变量当成对外导出 API。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/services/streamDeltaBatcher.ts#L1-L62)。
- **`jiuwenswarm/channels/web/frontend/src/services/webClient.ts`**
- 源码声明的类型、组件或调用边界：`EventHandler`, `TypedEventHandler`, `StateHandler`, `PendingRequest`, `MAX_RECONNECT_ATTEMPTS`, `DEFAULT_TIMEOUT_MS`, `LEGACY_EVENT_MAP`, `DevWsLogEntry`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import {`；`import { getWsBase } from '../utils/env';`；`import { resolveUserId } from '../utils/userId';`；`import i18n from '../i18n';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/services/webClient.ts#L1-L799)。

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/web-frontend/services/source-contracts-01.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
