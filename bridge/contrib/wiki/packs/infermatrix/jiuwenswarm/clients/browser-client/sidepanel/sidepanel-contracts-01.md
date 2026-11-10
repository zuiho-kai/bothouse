---
name: sidepanel-contracts-01
description: browser-client 前端源码接口与集成边界 01：sidepanel 目录 ChatBridge、ContextBar、SessionExporter、SessionPicker、chat、markdown、privacy、reader、search、sidepanel.html、tour 的声明与导入
metadata:
  scope: 只收 jiuwenswarm/channels/browser/frontend/src/sidepanel 一个目录的静态声明记录：侧栏各模块的声明索引、导入边界与 sidepanel.html 装配；该目录入口归 sidepanel-overview
---
# sidepanel 源码接口与集成边界 01

## 现状

- 本页逐文件说明这一源码模块声明的接口、类型与依赖。记录来自静态源码声明，不证明控制流、配置生效、外部服务可用或测试通过；功能语义与设计取舍沿上级功能页继续阅读。
- **`jiuwenswarm/channels/browser/frontend/src/sidepanel/ChatBridge.ts`**
- 源码声明的类型、组件或调用边界：`log`, `ChatBridge`, `ids`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { createLogger } from "@shared/logger";`；`import { MSG } from "@shared/constants";`；`import { SidePanelRequest, BackgroundReply } from "@shared/messages";`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/browser/frontend/src/sidepanel/ChatBridge.ts#L1-L138)。
- **`jiuwenswarm/channels/browser/frontend/src/sidepanel/ContextBar.ts`**
- 源码声明的类型、组件或调用边界：`LOW_EXTRACTION_THRESHOLD`, `PREVIEW_CHARS`, `ContextBar`, `i`, `chip`, `charCount`, `isLow`, `isPdf`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { PinnedPage } from "@shared/types";`；`import { t } from "@shared/i18n";`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/browser/frontend/src/sidepanel/ContextBar.ts#L1-L177)。
- **`jiuwenswarm/channels/browser/frontend/src/sidepanel/SessionExporter.ts`**
- 源码声明的类型、组件或调用边界：`ExportPackage`, `exportSessionJson`, `pinnedPages`, `chatHistory`, `pkg`, `exportSessionMarkdown`, `pinnedPages`, `chatHistory`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { getPinnedPagesBySession, loadChatHistory } from "@shared/storage";`；`import { PinnedPage, ResearchSession, ChatEntry } from "@shared/types";`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/browser/frontend/src/sidepanel/SessionExporter.ts#L1-L126)。
- **`jiuwenswarm/channels/browser/frontend/src/sidepanel/SessionPicker.ts`**
- 源码声明的类型、组件或调用边界：`SessionPicker`, `id`, `active`, `item`, `i`, `session`, `item`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { ResearchSession } from "@shared/types";`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/browser/frontend/src/sidepanel/SessionPicker.ts#L1-L122)。
- **`jiuwenswarm/channels/browser/frontend/src/sidepanel/chat.ts`**
- 源码声明的类型、组件或调用边界：`formatTime`, `addTurnDivider`, `last`, `d`, `makeCopyIcon`, `btn`, `addMessageFooter`, `footer`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { t } from "@shared/i18n";`；`import { getPinnedPagesBySession } from "@shared/storage";`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/browser/frontend/src/sidepanel/chat.ts#L1-L118)。
- **`jiuwenswarm/channels/browser/frontend/src/sidepanel/markdown.ts`**
- 源码声明的类型、组件或调用边界：`escapeHtml`；这是词法声明索引，不把局部变量当成对外导出 API。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/browser/frontend/src/sidepanel/markdown.ts#L1-L141)。
- **`jiuwenswarm/channels/browser/frontend/src/sidepanel/privacy.ts`**
- 源码声明的类型、组件或调用边界：`privacyEl`, `privacyBody`, `privacyClose`, `openPrivacy`, `closePrivacy`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { t } from "@shared/i18n";`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/browser/frontend/src/sidepanel/privacy.ts#L1-L21)。
- **`jiuwenswarm/channels/browser/frontend/src/sidepanel/reader.ts`**
- 源码声明的类型、组件或调用边界：`readerEl`, `readerBack`, `readerContent`, `openReader`, `resp`, `ctx`, `article`, `h1`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { MSG } from "@shared/constants";`；`import { t } from "@shared/i18n";`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/browser/frontend/src/sidepanel/reader.ts#L1-L51)。
- **`jiuwenswarm/channels/browser/frontend/src/sidepanel/search.ts`**
- 源码声明的类型、组件或调用边界：`searchEl`, `searchInput`, `searchResults`, `searchClose`, `openSearch`, `closeSearch`, `runSearch`, `q`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { t } from "@shared/i18n";`；`import { loadPinnedPages } from "@shared/storage";`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/browser/frontend/src/sidepanel/search.ts#L1-L77)。
- **`jiuwenswarm/channels/browser/frontend/src/sidepanel/sidepanel.html`**
- 页面装配边界：body, script 标签；资源装载与宿主连接取决于对应属性和脚本实现。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/browser/frontend/src/sidepanel/sidepanel.html#L1-L484)。
- **`jiuwenswarm/channels/browser/frontend/src/sidepanel/tour.ts`**
- 源码声明的类型、组件或调用边界：`tourEl`, `tourTitle`, `tourBody`, `tourNext`, `tourPrev`, `tourSkip`, `tourDots`, `TOUR_STEPS`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { t } from "@shared/i18n";`；`import { hasSeenTour, markTourSeen } from "@shared/storage";`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/browser/frontend/src/sidepanel/tour.ts#L1-L71)。

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/browser-client/sidepanel/source-contracts-01.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
