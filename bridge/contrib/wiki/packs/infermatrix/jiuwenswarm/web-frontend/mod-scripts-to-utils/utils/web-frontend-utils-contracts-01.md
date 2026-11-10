---
name: web-frontend-utils-contracts-01
description: web-frontend utils 源码接口与集成边界 01：src/utils 下 chatFinalProtocol 至 skillNetUrl 共十七个工具文件（含 desktopSave、env、finalContent、gitcodeOAuth、mySkills）的静态声明与导入
metadata:
  scope: 只收字母序前十七个 utils 文件的静态声明索引与导入，不证明运行行为；skillPackageFile 起归 web-frontend-utils-contracts-02，入口说明归 web-frontend-utils-overview
---
# utils 源码接口与集成边界 01

## 现状

- 本页逐文件说明这一源码模块声明的接口、类型与依赖。记录来自静态源码声明，不证明控制流、配置生效、外部服务可用或测试通过；功能语义与设计取舍沿上级功能页继续阅读。
- **`jiuwenswarm/channels/web/frontend/src/utils/chatFinalProtocol.ts`**
- 源码声明的类型、组件或调用边界：`ChatFinalMode`, `ChatFinalAction`, `A2UI_OPEN_TAG`, `contentHasA2UIBlock`, `parseChatFinalMode`, `raw`, `mode`, `parseChatFinalSegmentId`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { collapseWs } from './finalContent';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/utils/chatFinalProtocol.ts#L1-L138)。
- **`jiuwenswarm/channels/web/frontend/src/utils/contextCompression.ts`**
- 源码声明的类型、组件或调用边界：`contextCompressionRunningText`, `key`；这是词法声明索引，不把局部变量当成对外导出 API。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/utils/contextCompression.ts#L1-L22)。
- **`jiuwenswarm/channels/web/frontend/src/utils/crossSessionMessage.ts`**
- 源码声明的类型、组件或调用边界：`CROSS_SESSION_MESSAGE_ORIGIN`, `CrossSessionMessageMetadata`, `readString`, `extractCrossSessionMessage`, `raw`, `crossSession`, `messageId`, `sourceSessionId`；这是词法声明索引，不把局部变量当成对外导出 API。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/utils/crossSessionMessage.ts#L1-L53)。
- **`jiuwenswarm/channels/web/frontend/src/utils/desktopSave.ts`**
- 源码声明的类型、组件或调用边界：`DesktopSaveResult`, `DesktopSaveApiResult`, `DesktopSaveOutcome`, `BlobSaveTransport`, `BlobSaveResult`, `BlobSaveOptions`, `BrowserWritableFileStream`, `BrowserFileHandle`；这是词法声明索引，不把局部变量当成对外导出 API。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/utils/desktopSave.ts#L1-L201)。
- **`jiuwenswarm/channels/web/frontend/src/utils/documentMessage.ts`**
- 源码声明的类型、组件或调用边界：`UPLOAD_DOCUMENT_BLOCK_HEADER`, `UploadDocumentHint`, `formatAtPath`, `stripUploadDocumentBlocks`, `toDisplaySessionTitle`, `withUploadDocumentBlock`, `base`, `lines`；这是词法声明索引，不把局部变量当成对外导出 API。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/utils/documentMessage.ts#L1-L87)。
- **`jiuwenswarm/channels/web/frontend/src/utils/enabledExtensions.ts`**
- 源码声明的类型、组件或调用边界：`pruneEnabledExtensions`, `sessionStore`, `runtime`, `mcpConnectionByName`, `plugins`, `id`, `installedState`, `connectionState`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { useSessionStore } from '../stores/sessionStore';`；`import { usePluginPackageStore } from '../stores/pluginPackageStore';`；`import { useConnectorStore } from '../stores/connectorStore';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/utils/enabledExtensions.ts#L1-L91)。
- **`jiuwenswarm/channels/web/frontend/src/utils/env.ts`**
- 源码声明的类型、组件或调用边界：`normalizeBase`, `getApiBase`, `desktopApiBase`, `raw`, `getWsBase`, `desktopWsBase`, `raw`, `apiBase`；这是词法声明索引，不把局部变量当成对外导出 API。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/utils/env.ts#L1-L27)。
- **`jiuwenswarm/channels/web/frontend/src/utils/fileDownloadDedup.ts`**
- 源码声明的类型、组件或调用边界：`FileIdentitySource`, `decodeBase64UrlUtf8`, `base64`, `padded`, `binary`, `bytes`, `getTokenPayload`, `payloadPart`；这是词法声明索引，不把局部变量当成对外导出 API。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/utils/fileDownloadDedup.ts#L1-L138)。
- **`jiuwenswarm/channels/web/frontend/src/utils/finalContent.ts`**
- 源码声明的类型、组件或调用边界：`unescapeLiteralNewlines`, `realNl`, `litNl`, `normalizeFinalDisplayText`, `collapseWs`, `resolveStreamFinalContent`, `streamedN`, `finalN`；这是词法声明索引，不把局部变量当成对外导出 API。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/utils/finalContent.ts#L1-L118)。
- **`jiuwenswarm/channels/web/frontend/src/utils/formatters.ts`**
- 源码声明的类型、组件或调用边界：`formatTimestamp`, `date`, `pad`, `dateStr`, `timeStr`, `formatDate`, `date`, `formatRelativeTime`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import i18n from '../i18n';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/utils/formatters.ts#L1-L73)。
- **`jiuwenswarm/channels/web/frontend/src/utils/frontendPlatform.ts`**
- 源码声明的类型、组件或调用边界：`FrontendPlatform`, `SidebarNavKey`, `DEFAULT_FRONTEND_PLATFORM`, `PLATFORM_ALIASES`, `HIDDEN_NAV_ITEMS_BY_PLATFORM`, `normalizeFrontendPlatform`, `key`, `resolveFrontendPlatform`；这是词法声明索引，不把局部变量当成对外导出 API。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/utils/frontendPlatform.ts#L1-L57)。
- **`jiuwenswarm/channels/web/frontend/src/utils/gitcodeOAuth.ts`**
- 源码声明的类型、组件或调用边界：`TOKEN_KEY`, `PROVIDER_KEY`, `USER_KEY`, `AUTHORIZATION_CLOSE_GRACE_MS`, `OAuthProvider`, `HubOAuthAttempt`, `OAuthUser`, `responseJson`；这是词法声明索引，不把局部变量当成对外导出 API。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/utils/gitcodeOAuth.ts#L1-L125)。
- **`jiuwenswarm/channels/web/frontend/src/utils/heartbeatAutomation.ts`**
- 源码声明的类型、组件或调用边界：`extractAutomation`, `meta`, `automation`, `parsed`, `normalizeAutomation`, `obj`, `jobId`, `runId`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import type { HeartbeatAutomationMetadata } from '../types/heartbeat';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/utils/heartbeatAutomation.ts#L1-L86)。
- **`jiuwenswarm/channels/web/frontend/src/utils/mySkills.ts`**
- 源码声明的类型、组件或调用边界：`computeMySkills`, `installed`, `isCandidate`, `buildInstalledSkillNames`, `set`, `plugin`, `skill`, `isSkillInstalled`；这是词法声明索引，不把局部变量当成对外导出 API。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/utils/mySkills.ts#L1-L64)。
- **`jiuwenswarm/channels/web/frontend/src/utils/proactiveRecommendation.ts`**
- 源码声明的类型、组件或调用边界：`proactiveAssistantMessageId`, `clean`；这是词法声明索引，不把局部变量当成对外导出 API。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/utils/proactiveRecommendation.ts#L1-L11)。
- **`jiuwenswarm/channels/web/frontend/src/utils/skillAvatar.ts`**
- 源码声明的类型、组件或调用边界：`avatarPalette`, `AvatarStyle`, `hexToRgba`, `r`, `g`, `b`, `getSkillAvatar`, `trimmed`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import type { CSSProperties } from 'react';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/utils/skillAvatar.ts#L1-L47)。
- **`jiuwenswarm/channels/web/frontend/src/utils/skillNetUrl.ts`**
- 源码声明的类型、组件或调用边界：`normalizeSkillNetUrl`, `s`, `u`, `path`, `buildClawHubOrigin`, `s`, `owner`, `isClawHubOriginInstalled`；这是词法声明索引，不把局部变量当成对外导出 API。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/utils/skillNetUrl.ts#L1-L127)。

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/web-frontend/utils/source-contracts-01.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
