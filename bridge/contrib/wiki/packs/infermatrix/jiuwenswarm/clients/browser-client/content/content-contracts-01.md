---
name: content-contracts-01
description: content 源码接口与集成边界 01：Annotator.ts、Extractor.ts、FormAssist.ts、PageTypeDetector.ts、SelectionMonitor.ts、index.ts
metadata:
  scope: 只收 content 下 Annotator.ts 至 index.ts 共 6 个源码文件的静态声明（接口、类型、依赖与源码依据链接）
---
# content 源码接口与集成边界 01

## 现状

- 本页逐文件说明这一源码模块声明的接口、类型与依赖。记录来自静态源码声明，不证明控制流、配置生效、外部服务可用或测试通过；功能语义与设计取舍沿上级功能页继续阅读。
- **`jiuwenswarm/channels/browser/frontend/src/content/Annotator.ts`**
- 源码声明的类型、组件或调用边界：`TRANSIENT_CLASS`, `STYLE_ID`, `startAnnotator`, `action`, `m`, `_applyTransient`, `walker`, `node`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { MSG } from "@shared/constants";`；`import { HighlightMsg } from "@shared/types";`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/browser/frontend/src/content/Annotator.ts#L1-L78)。
- **`jiuwenswarm/channels/browser/frontend/src/content/Extractor.ts`**
- 源码声明的类型、组件或调用边界：`extractPageContext`, `url`, `pageType`, `capturedAt`, `title`, `text`, `originalLength`, `truncateAtParagraphBoundary`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { Readability } from "@mozilla/readability";`；`import { PageContext } from "@shared/types";`；`import { MAX_CONTEXT_CHARS } from "@shared/constants";`；`import { detectPageType } from "./PageTypeDetector";`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/browser/frontend/src/content/Extractor.ts#L1-L140)。
- **`jiuwenswarm/channels/browser/frontend/src/content/FormAssist.ts`**
- 源码声明的类型、组件或调用边界：`startFormAssist`, `fillForm`, `input`, `nativeInputValueSetter`, `findInput`, `byId`, `byName`, `label`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { MSG } from "@shared/constants";`；`import { FillFormMsg } from "@shared/types";`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/browser/frontend/src/content/FormAssist.ts#L1-L67)。
- **`jiuwenswarm/channels/browser/frontend/src/content/PageTypeDetector.ts`**
- 源码声明的类型、组件或调用边界：`PageType`, `detectPageType`, `ogType`；这是词法声明索引，不把局部变量当成对外导出 API。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/browser/frontend/src/content/PageTypeDetector.ts#L1-L68)。
- **`jiuwenswarm/channels/browser/frontend/src/content/SelectionMonitor.ts`**
- 源码声明的类型、组件或调用边界：`_lastSelection`, `startSelectionMonitor`, `getLastSelection`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { MSG } from "@shared/constants";`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/browser/frontend/src/content/SelectionMonitor.ts#L1-L26)。
- **`jiuwenswarm/channels/browser/frontend/src/content/index.ts`**
- 源码声明的类型、组件或调用边界：`log`, `el`, `pushContext`, `context`, `_lastUrl`, `_observer`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { createLogger } from "@shared/logger";`；`import { MSG } from "@shared/constants";`；`import { extractPageContext } from "./Extractor";`；`import { startSelectionMonitor } from "./SelectionMonitor";`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/browser/frontend/src/content/index.ts#L1-L75)。

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/browser-client/content/source-contracts-01.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
