---
name: ui-components-contracts-02
description: tui-client ui-components 源码接口 02：src/ui/components 下 todo-list.ts，以及 tools 子目录的 collapsed-tool-group-message、command-tool-renderers、compact-tool-renderers、detailed-tool-renderers、file-tool-renderers、search-tool-renderers、tool-group-message、tool-kind-utils、tool-line-renderers、tool-render-shared、tool-structured-data 的声明与导入依赖
metadata:
  scope: 只收本页所列 12 个文件的静态声明；checkbox-list、team、messages 与 tool-render-types 归 ui-components-contracts-01，入口说明归 ui-components-overview
---
# ui-components 源码接口与集成边界 02

## 现状

- 本页逐文件说明这一源码模块声明的接口、类型与依赖。记录来自静态源码声明，不证明控制流、配置生效、外部服务可用或测试通过；功能语义与设计取舍沿上级功能页继续阅读。
- **`jiuwenswarm/channels/tui/frontend/src/ui/components/todo-list.ts`**
- 源码声明的类型、组件或调用边界：`normalizeTodoText`, `trimmed`, `todoLabel`, `spinner`, `text`, `prefix`, `todoLine`, `prefix`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import type { TodoItem } from "../../core/types.js";`；`import { padToWidth } from "../rendering/text.js";`；`import { chalk, palette } from "../theme.js";`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/tui/frontend/src/ui/components/todo-list.ts#L1-L98)。
- **`jiuwenswarm/channels/tui/frontend/src/ui/components/tools/collapsed-tool-group-message.ts`**
- 源码声明的类型、组件或调用边界：`CollapsedToolGroupMessageComponent`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import type { Component } from "@mariozechner/pi-tui";`；`import type { HistoryItem } from "../../../core/types.js";`；`import { renderCollapsedCompactSummaryLines } from "./compact-tool-renderers.js";`；`import { ToolGroupMessageComponent } from "./tool-group-message.js";`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/tui/frontend/src/ui/components/tools/collapsed-tool-group-message.ts#L1-L34)。
- **`jiuwenswarm/channels/tui/frontend/src/ui/components/tools/command-tool-renderers.ts`**
- 源码声明的类型、组件或调用边界：`firstNonEmptyLines`, `value`, `lines`, `renderRunTool`, `args`, `payload`, `command`, `lines`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import type { ToolCallDisplay } from "../../../core/types.js";`；`import { palette } from "../../theme.js";`；`import { summarize } from "../../rendering/text.js";`；`import type { DetailedToolRenderOptions } from "./tool-render-types.js";`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/tui/frontend/src/ui/components/tools/command-tool-renderers.ts#L1-L174)。
- **`jiuwenswarm/channels/tui/frontend/src/ui/components/tools/compact-tool-renderers.ts`**
- 源码声明的类型、组件或调用边界：`summarizeCompactHint`, `normalized`, `compactActionLabel`, `compactToolTitle`, `args`, `path`, `query`, `url`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import type { ToolCallDisplay } from "../../../core/types.js";`；`import { palette } from "../../theme.js";`；`import { summarize } from "../../rendering/text.js";`；`import {`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/tui/frontend/src/ui/components/tools/compact-tool-renderers.ts#L1-L192)。
- **`jiuwenswarm/channels/tui/frontend/src/ui/components/tools/detailed-tool-renderers.ts`**
- 源码声明的类型、组件或调用边界：`renderDetailedToolLines`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import type { ToolCallDisplay } from "../../../core/types.js";`；`import { renderFetchTool, renderRunTool } from "./command-tool-renderers.js";`；`import {`；`import {`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/tui/frontend/src/ui/components/tools/detailed-tool-renderers.ts#L1-L65)。
- **`jiuwenswarm/channels/tui/frontend/src/ui/components/tools/file-tool-renderers.ts`**
- 源码声明的类型、组件或调用边界：`renderSessionTool`, `args`, `description`, `index`, `total`, `label`, `lines`, `previewLines`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import type { ToolCallDisplay } from "../../../core/types.js";`；`import { palette } from "../../theme.js";`；`import { summarize } from "../../rendering/text.js";`；`import type { DetailedToolRenderOptions } from "./tool-render-types.js";`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/tui/frontend/src/ui/components/tools/file-tool-renderers.ts#L1-L326)。
- **`jiuwenswarm/channels/tui/frontend/src/ui/components/tools/search-tool-renderers.ts`**
- 源码声明的类型、组件或调用边界：`renderGlobTool`, `args`, `payload`, `parsedValue`, `pattern`, `lines`, `root`, `payloadMatchLines`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import type { ToolCallDisplay } from "../../../core/types.js";`；`import { palette } from "../../theme.js";`；`import { summarize } from "../../rendering/text.js";`；`import type { DetailedToolRenderOptions } from "./tool-render-types.js";`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/tui/frontend/src/ui/components/tools/search-tool-renderers.ts#L1-L326)。
- **`jiuwenswarm/channels/tui/frontend/src/ui/components/tools/tool-group-message.ts`**
- 源码声明的类型、组件或调用边界：`ToolGroupMessageComponent`, `lines`, `allTools`, `tools`, `visibleTools`, `hiddenCount`, `tool`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import type { Component } from "@mariozechner/pi-tui";`；`import type { HistoryItem } from "../../../core/types.js";`；`import { renderCompactToolLines, renderHiddenToolsLine } from "./compact-tool-renderers.js";`；
  - `import { renderDetailedToolLines } from "./detailed-tool-renderers.js";`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/tui/frontend/src/ui/components/tools/tool-group-message.ts#L1-L49)。
- **`jiuwenswarm/channels/tui/frontend/src/ui/components/tools/tool-kind-utils.ts`**
- 源码声明的类型、组件或调用边界：`summarizePath`, `parts`, `summarizeToolArguments`, `obj`, `normalized`, `pattern`, `root`, `keys`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import type { ToolCallDisplay } from "../../../core/types.js";`；`import { summarize } from "../../rendering/text.js";`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/tui/frontend/src/ui/components/tools/tool-kind-utils.ts#L1-L226)。
- **`jiuwenswarm/channels/tui/frontend/src/ui/components/tools/tool-line-renderers.ts`**
- 源码声明的类型、组件或调用边界：`TOOL_BODY_PREFIX`, `TOOL_BODY_CONTINUATION`, `TOOL_TAIL_PREFIX`, `TOOL_TAIL_CONTINUATION`, `TOOL_EXPAND_HINT`, `MAX_STRUCTURED_LINES_COLLAPSED`, `MAX_STRUCTURED_LINES_EXPANDED`, `toolPrefix`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import type { ToolCallDisplay } from "../../../core/types.js";`；`import { palette } from "../../theme.js";`；`import { prefixedLines, renderWrappedText } from "../../rendering/text.js";`；`import { isToolRunning } from "./tool-kind-utils.js";`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/tui/frontend/src/ui/components/tools/tool-line-renderers.ts#L1-L170)。
- **`jiuwenswarm/channels/tui/frontend/src/ui/components/tools/tool-render-shared.ts`**
- 源码声明的类型、组件或调用边界：`MAX_VISIBLE_TOOLS`, `summarizeStructuredPayload`, `parsed`, `keys`, `summarizeToolResultByKind`, `normalized`, `lines`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { summarize } from "../../rendering/text.js";`；`import { isPlainObject, tryParseStructuredText } from "./tool-structured-data.js";`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/tui/frontend/src/ui/components/tools/tool-render-shared.ts#L1-L39)。
- **`jiuwenswarm/channels/tui/frontend/src/ui/components/tools/tool-structured-data.ts`**
- 源码声明的类型、组件或调用边界：`normalizePythonLiteralToJson`, `normalized`, `formatStructuredValue`, `output`, `append`, `visit`, `parsed`, `compactLines`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import type { ToolCallDisplay } from "../../../core/types.js";`；`import { summarize } from "../../rendering/text.js";`；`import { getStringArg, isEditTool, isWriteTool } from "./tool-kind-utils.js";`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/tui/frontend/src/ui/components/tools/tool-structured-data.ts#L1-L307)。

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/tui-client/ui-components/source-contracts-02.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
