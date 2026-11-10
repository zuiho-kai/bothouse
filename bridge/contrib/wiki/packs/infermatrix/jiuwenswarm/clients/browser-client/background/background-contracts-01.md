---
name: background-contracts-01
description: background 源码接口与集成边界 01：ContextCache.ts、ContextMenu.ts、PanelManager.ts、SessionManager.ts、TabWatcher.ts、ToolDispatcher.ts 等 7 个模块
metadata:
  scope: 只收 background 下 ContextCache.ts 至 WsClient.ts 共 7 个源码文件的静态声明（接口、类型、依赖与源码依据链接）
---
# background 源码接口与集成边界 01

## 现状

- 本页逐文件说明这一源码模块声明的接口、类型与依赖。记录来自静态源码声明，不证明控制流、配置生效、外部服务可用或测试通过；功能语义与设计取舍沿上级功能页继续阅读。
- **`jiuwenswarm/channels/browser/frontend/src/background/ContextCache.ts`**
- 源码声明的类型、组件或调用边界：`ContextCache`, `parts`, `total`, `id`, `ctx`, `header`, `block`, `remaining`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { PageContext } from "@shared/types";`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/browser/frontend/src/background/ContextCache.ts#L1-L57)。
- **`jiuwenswarm/channels/browser/frontend/src/background/ContextMenu.ts`**
- 源码声明的类型、组件或调用边界：`log`, `MENU_ASK`, `MENU_PIN`, `MENU_SUMMARIZE`, `MENU_READER`, `MENU_SEARCH`, `DynamicMenuApi`, `dynMenu`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { createLogger } from "@shared/logger";`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/browser/frontend/src/background/ContextMenu.ts#L1-L149)。
- **`jiuwenswarm/channels/browser/frontend/src/background/PanelManager.ts`**
- 源码声明的类型、组件或调用边界：`log`, `PANEL_URL`, `hasSidePanel`, `_popupWindowId`, `openPanel`, `win`, `tracked`, `onRemoved`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { createLogger } from "@shared/logger";`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/browser/frontend/src/background/PanelManager.ts#L1-L76)。
- **`jiuwenswarm/channels/browser/frontend/src/background/SessionManager.ts`**
- 源码声明的类型、组件或调用边界：`log`, `ServerSessionRow`, `ChangeListener`, `SessionManager`, `n`, `payload`, `rows`, `payload`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { createLogger } from "@shared/logger";`；`import { loadActiveSessionId, saveActiveSessionId, loadSessionDisplayNames, saveSessionDisplayName }`；`import { ResearchSession } from "@shared/types";`；`import { GW_METHOD } from "@shared/protocol";`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/browser/frontend/src/background/SessionManager.ts#L1-L202)。
- **`jiuwenswarm/channels/browser/frontend/src/background/TabWatcher.ts`**
- 源码声明的类型、组件或调用边界：`log`, `TabWatcher`, `cached`, `age`, `response`, `response`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { createLogger } from "@shared/logger";`；`import { MSG } from "@shared/constants";`；`import type { ContextCache } from "./ContextCache";`；`import type { PageContext } from "@shared/types";`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/browser/frontend/src/background/TabWatcher.ts#L1-L93)。
- **`jiuwenswarm/channels/browser/frontend/src/background/ToolDispatcher.ts`**
- 源码声明的类型、组件或调用边界：`log`, `ToolDispatcher`, `result`, `tab`, `resp`, `tab`, `tab`, `tab`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { createLogger } from "@shared/logger";`；`import { InboundEnvelope, GW_METHOD } from "@shared/protocol";`；`import { MSG } from "@shared/constants";`；`import { addPinnedPage } from "@shared/storage";`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/browser/frontend/src/background/ToolDispatcher.ts#L1-L277)。
- **`jiuwenswarm/channels/browser/frontend/src/background/WsClient.ts`**
- 源码声明的类型、组件或调用边界：`EventHandler`, `StatusChangeHandler`, `log`, `BACKOFF_MS`, `PendingRequest`, `REQUEST_TIMEOUT_MS`, `WsClient`, `settings`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { createLogger } from "@shared/logger";`；`import { InboundEnvelope, makeRequest, GW_EVENT } from "@shared/protocol";`；`import { loadSettings } from "@shared/storage";`；`import { WS_URL } from "@shared/constants";`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/browser/frontend/src/background/WsClient.ts#L1-L230)。

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/browser-client/background/source-contracts-01.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
