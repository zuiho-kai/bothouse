---
name: ui-components-contracts-01
description: tui-client ui-components 源码接口 01：src/ui/components 下 checkbox-list、team-panel、team-shared、team-status-pill，messages 子目录的 content-components、diff-component、history-entry、meta-components、presentation-rules、render-compact-entry、render-detailed-entry、shared、types，以及 tools/tool-render-types 的声明与导入依赖
metadata:
  scope: 只收本页所列 14 个文件的静态声明；todo-list 与 tools 下其余渲染文件归 ui-components-contracts-02，入口说明归 ui-components-overview
---
# ui-components 源码接口与集成边界 01

## 现状

- 本页逐文件说明这一源码模块声明的接口、类型与依赖。记录来自静态源码声明，不证明控制流、配置生效、外部服务可用或测试通过；功能语义与设计取舍沿上级功能页继续阅读。
- **`jiuwenswarm/channels/tui/frontend/src/ui/components/checkbox-list.ts`**
- 源码声明的类型、组件或调用边界：`CheckboxItem`, `CheckboxGroup`, `FlatItem`, `CheckboxTheme`, `defaultTheme`, `CheckboxList`, `gi`, `ii`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import chalk from "chalk";`；`import { matchesKey } from "@mariozechner/pi-tui/dist/keys.js";`；`import { visibleWidth, wrapTextWithAnsi } from "@mariozechner/pi-tui";`；`import { padToWidth } from "../rendering/text.js";`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/tui/frontend/src/ui/components/checkbox-list.ts#L1-L270)。
- **`jiuwenswarm/channels/tui/frontend/src/ui/components/messages/content-components.ts`**
- 源码声明的类型、组件或调用边界：`Component`, `renderAssistantLines`, `body`, `lines`, `lastIndex`, `renderThinkingLabel`, `label`, `focus`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { truncateToWidth, type Component } from "@mariozechner/pi-tui";`；`import type { HistoryItem } from "../../../core/types.js";`；`import { chalk, palette } from "../../theme.js";`；`import {`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/tui/frontend/src/ui/components/messages/content-components.ts#L1-L145)。
- **`jiuwenswarm/channels/tui/frontend/src/ui/components/messages/diff-component.ts`**
- 源码声明的类型、组件或调用边界：`DiffComponent`, `lines`, `turns`, `gitDiff`, `innerWidth`, `hasTurns`, `hasGitDiff`, `trackedFiles`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import type { Component } from "@mariozechner/pi-tui";`；`import type { HistoryItem, FileDiff, GitDiffFile } from "../../../core/types.js";`；`import { palette } from "../../theme.js";`；`import { renderWrappedText } from "../../rendering/text.js";`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/tui/frontend/src/ui/components/messages/diff-component.ts#L1-L126)。
- **`jiuwenswarm/channels/tui/frontend/src/ui/components/messages/history-entry.ts`**
- 源码声明的类型、组件或调用边界：`renderHistoryEntry`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import type { HistoryItem } from "../../../core/types.js";`；`import { renderCompactEntry } from "./render-compact-entry.js";`；`import { renderDetailedEntry } from "./render-detailed-entry.js";`；`import type { MessageRenderOptions, RenderedHistoryEntry } from "./types.js";`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/tui/frontend/src/ui/components/messages/history-entry.ts#L1-L15)。
- **`jiuwenswarm/channels/tui/frontend/src/ui/components/messages/meta-components.ts`**
- 源码声明的类型、组件或调用边界：`renderGroupedHelpView`, `lines`, `innerWidth`, `version`, `versionText`, `group`, `groupTitle`, `groupPadding`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { visibleWidth } from "@mariozechner/pi-tui";`；`import type { Component } from "@mariozechner/pi-tui";`；`import type { HistoryItem } from "../../../core/types.js";`；`import { palette } from "../../theme.js";`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/tui/frontend/src/ui/components/messages/meta-components.ts#L1-L244)。
- **`jiuwenswarm/channels/tui/frontend/src/ui/components/messages/presentation-rules.ts`**
- 源码声明的类型、组件或调用边界：`COMPACT_EXPANDED_TOOL_NAMES`, `shouldExpandCompactToolGroup`, `shouldGapAfterEntry`, `shouldEmphasizeAssistantTransition`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import type { HistoryItem } from "../../../core/types.js";`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/tui/frontend/src/ui/components/messages/presentation-rules.ts#L1-L54)。
- **`jiuwenswarm/channels/tui/frontend/src/ui/components/messages/render-compact-entry.ts`**
- 源码声明的类型、组件或调用边界：`shouldRenderInfoExpanded`, `meta`, `renderCompactEntry`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import type { HistoryItem } from "../../../core/types.js";`；`import {`；`import { CollapsedToolGroupMessageComponent, ToolGroupMessageComponent } from "../tools/index.js";`；`import type { MessageRenderOptions, RenderedHistoryEntry } from "./types.js";`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/tui/frontend/src/ui/components/messages/render-compact-entry.ts#L1-L79)。
- **`jiuwenswarm/channels/tui/frontend/src/ui/components/messages/render-detailed-entry.ts`**
- 源码声明的类型、组件或调用边界：`renderDetailedEntry`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import type { HistoryItem } from "../../../core/types.js";`；`import {`；`import { CollapsedToolGroupMessageComponent, ToolGroupMessageComponent } from "../tools/index.js";`；`import type { MessageRenderOptions, RenderedHistoryEntry } from "./types.js";`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/tui/frontend/src/ui/components/messages/render-detailed-entry.ts#L1-L88)。
- **`jiuwenswarm/channels/tui/frontend/src/ui/components/messages/shared.ts`**
- 源码声明的类型、组件或调用边界：`renderClaudeResponseLines`, `renderMediaItems`, `lines`, `item`, `kind`, `label`, `image`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { Image as TuiImage } from "@mariozechner/pi-tui";`；`import type { MediaItem } from "../../../core/types.js";`；`import { palette } from "../../theme.js";`；`import { prefixedLines, renderWrappedText, summarize } from "../../rendering/text.js";`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/tui/frontend/src/ui/components/messages/shared.ts#L1-L46)。
- **`jiuwenswarm/channels/tui/frontend/src/ui/components/messages/types.ts`**
- 源码声明的类型、组件或调用边界：`MessageRenderOptions`, `RenderedHistoryEntry`；这是词法声明索引，不把局部变量当成对外导出 API。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/tui/frontend/src/ui/components/messages/types.ts#L1-L13)。
- **`jiuwenswarm/channels/tui/frontend/src/ui/components/team-panel.ts`**
- 源码声明的类型、组件或调用边界：`TeamMemberSummary`, `compactMemberPreview`, `colorMemberLine`, `colorTreeContextLine`, `renderMemberTree`, `lines`, `leader`, `teammates`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import type { TeamMemberEvent, TeamMessageEvent, TeamTaskEvent } from "../../core/types.js";`；`import { padToWidth } from "../rendering/text.js";`；`import { palette } from "../theme.js";`；`import {`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/tui/frontend/src/ui/components/team-panel.ts#L1-L432)。
- **`jiuwenswarm/channels/tui/frontend/src/ui/components/team-shared.ts`**
- 源码声明的类型、组件或调用边界：`TeamMemberSummary`, `truncate`, `formatElapsed`, `diff`, `seconds`, `minutes`, `hours`, `normalizeStatusValue`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import type { TeamMemberEvent, TeamMessageEvent, TeamTaskEvent } from "../../core/types.js";`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/tui/frontend/src/ui/components/team-shared.ts#L1-L200)。
- **`jiuwenswarm/channels/tui/frontend/src/ui/components/team-status-pill.ts`**
- 源码声明的类型、组件或调用边界：`renderTeamStatusPill`, `members`, `workingCount`, `parts`, `latestTask`, `content`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import type { TeamMemberEvent, TeamMessageEvent, TeamTaskEvent } from "../../core/types.js";`；`import { padToWidth } from "../rendering/text.js";`；`import { palette } from "../theme.js";`；`import {`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/tui/frontend/src/ui/components/team-status-pill.ts#L1-L39)。
- **`jiuwenswarm/channels/tui/frontend/src/ui/components/tools/tool-render-types.ts`**
- 源码声明的类型、组件或调用边界：`DetailedToolRenderOptions`；这是词法声明索引，不把局部变量当成对外导出 API。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/tui/frontend/src/ui/components/tools/tool-render-types.ts#L1-L4)。

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/tui-client/ui-components/source-contracts-01.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
