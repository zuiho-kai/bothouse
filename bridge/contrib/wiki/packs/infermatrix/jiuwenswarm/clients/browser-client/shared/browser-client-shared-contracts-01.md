---
name: browser-client-shared-contracts-01
description: browser-client 前端源码接口与集成边界 01：shared 目录 constants、i18n、logger、messages、protocol、storage、types、url 八个模块（WS_URL、GW_METHOD、PinnedPage、ExtensionSettings、normalizeUrl 等声明）
metadata:
  scope: 只收 jiuwenswarm/channels/browser/frontend/src/shared 一个目录的静态声明记录：各模块的声明索引与相互导入关系；该目录入口归 browser-client-shared-overview
---
# shared 源码接口与集成边界 01

## 现状

- 本页逐文件说明这一源码模块声明的接口、类型与依赖。记录来自静态源码声明，不证明控制流、配置生效、外部服务可用或测试通过；功能语义与设计取舍沿上级功能页继续阅读。
- **`jiuwenswarm/channels/browser/frontend/src/shared/constants.ts`**
- 源码声明的类型、组件或调用边界：`DEFAULT_HOST`, `DEFAULT_PORT`, `CHANNEL_ID`, `APP_ID`, `WS_URL`, `STORAGE_KEYS`, `MAX_PINNED_PAGES`, `MAX_CONTEXT_CHARS`；这是词法声明索引，不把局部变量当成对外导出 API。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/browser/frontend/src/shared/constants.ts#L1-L81)。
- **`jiuwenswarm/channels/browser/frontend/src/shared/i18n.ts`**
- 源码声明的类型、组件或调用边界：`Dict`, `EN`, `ZH`, `_dict`, `initI18n`, `lang`, `t`, `applyStaticI18n`；这是词法声明索引，不把局部变量当成对外导出 API。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/browser/frontend/src/shared/i18n.ts#L1-L250)。
- **`jiuwenswarm/channels/browser/frontend/src/shared/logger.ts`**
- 源码声明的类型、组件或调用边界：`LogLevel`, `LEVEL_RANK`, `IS_PROD`, `MIN_LEVEL`, `Logger`, `line`, `createLogger`；这是词法声明索引，不把局部变量当成对外导出 API。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/browser/frontend/src/shared/logger.ts#L1-L72)。
- **`jiuwenswarm/channels/browser/frontend/src/shared/messages.ts`**
- 源码声明的类型、组件或调用边界：`SidePanelRequest`, `SidePanelAction`, `RequestOf`, `BackgroundReply`, `replyKey`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { MSG } from "./constants";`；`import { PinnedPage, ResearchSession } from "./types";`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/browser/frontend/src/shared/messages.ts#L1-L62)。
- **`jiuwenswarm/channels/browser/frontend/src/shared/protocol.ts`**
- 源码声明的类型、组件或调用边界：`GW_METHOD`, `GW_EVENT`, `WsRequest`, `ChatParams`, `ToolResultParams`, `makeRequest`, `InboundMsgType`, `InboundEnvelope`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { CHANNEL_ID } from "./constants";`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/browser/frontend/src/shared/protocol.ts#L1-L137)。
- **`jiuwenswarm/channels/browser/frontend/src/shared/storage.ts`**
- 源码声明的类型、组件或调用边界：`loadActiveSessionId`, `result`, `saveActiveSessionId`, `loadPinnedPages`, `result`, `savePinnedPages`, `addPinnedPage`, `pages`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { STORAGE_KEYS } from "./constants";`；`import {`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/browser/frontend/src/shared/storage.ts#L1-L168)。
- **`jiuwenswarm/channels/browser/frontend/src/shared/types.ts`**
- 源码声明的类型、组件或调用边界：`PageMeta`, `PageContext`, `PinnedPage`, `ResearchSession`, `ChatEntry`, `ExtensionSettings`, `DEFAULT_SETTINGS`, `PageContextMsg`；这是词法声明索引，不把局部变量当成对外导出 API。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/browser/frontend/src/shared/types.ts#L1-L116)。
- **`jiuwenswarm/channels/browser/frontend/src/shared/url.ts`**
- 源码声明的类型、组件或调用边界：`normalizeUrl`, `u`；这是词法声明索引，不把局部变量当成对外导出 API。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/browser/frontend/src/shared/url.ts#L1-L10)。

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/browser-client/shared/source-contracts-01.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
