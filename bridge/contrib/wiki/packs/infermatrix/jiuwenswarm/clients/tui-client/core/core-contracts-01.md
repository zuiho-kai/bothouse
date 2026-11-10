---
name: core-contracts-01
description: tui-client core 源码接口 01：src/core 下 app-state-helpers、attachments、compression-formatters、event-handlers、final-content、history-parser、modes、pasted-text、plan-entry-source、protocol、session-state、statusline-runner、transcript-timeline、tui-config-store、tui-trusted-dirs-store、types 共 16 个文件的声明与导入依赖
metadata:
  scope: 只收 src/core 本页所列 16 个文件的静态声明；workflows.ts 与 ws-client.ts 归 core-contracts-02，入口说明归 core-overview
---
# core 源码接口与集成边界 01

## 现状

- 本页逐文件说明这一源码模块声明的接口、类型与依赖。记录来自静态源码声明，不证明控制流、配置生效、外部服务可用或测试通过；功能语义与设计取舍沿上级功能页继续阅读。
- **`jiuwenswarm/channels/tui/frontend/src/core/app-state-helpers.ts`**
- 源码声明的类型、组件或调用边界：`createId`, `findLastIndex`, `index`, `item`, `isIgnorableHistoryRestoreError`, `message`, `TOOL_TIMEOUT_MS`, `computeTimeoutAt`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { applyToolResult, createToolCallDisplay } from "./history-parser.js";`；`import type { HistoryItem, ToolCallDisplay, ToolExecution } from "./types.js";`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/tui/frontend/src/core/app-state-helpers.ts#L1-L162)。
- **`jiuwenswarm/channels/tui/frontend/src/core/attachments.ts`**
- 源码声明的类型、组件或调用边界：`IMAGE_MIME_TYPES`, `SUPPORTED_FILE_EXTENSIONS`, `AT_MENTION_RE`, `candidate`, `extractAgentMentions`, `results`, `quotedAgentRegex`, `match`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { basename, extname, resolve } from "node:path";`；`import type { FileAttachment } from "./protocol.js";`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/tui/frontend/src/core/attachments.ts#L1-L253)。
- **`jiuwenswarm/channels/tui/frontend/src/core/compression-formatters.ts`**
- 源码声明的类型、组件或调用边界：`readNumber`, `formatNumber`, `n`, `formatPercent`, `n`, `formatCompressionUsage`, `parts`, `COMPRESSION_STARTED_LABELS`；这是词法声明索引，不把局部变量当成对外导出 API。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/tui/frontend/src/core/compression-formatters.ts#L1-L48)。
- **`jiuwenswarm/channels/tui/frontend/src/core/event-handlers.ts`**
- 源码声明的类型、组件或调用边界：`ContextCompressionStats`, `HistoryItem`, `JsonObject`, `SubtaskState`, `TeamMemberEvent`, `TeamMessageEvent`, `TeamTaskEvent`, `TodoItem`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import {`；`import { normalizeFinalContent } from "./final-content.js";`；`import {`；`import type { EventFrame } from "./protocol.js";`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/tui/frontend/src/core/event-handlers.ts#L1-L1566)。
- **`jiuwenswarm/channels/tui/frontend/src/core/final-content.ts`**
- 源码声明的类型、组件或调用边界：`decodeQuotedPythonLikeString`, `normalizeFinalDisplayText`, `normalizeFinalContent`, `rawContent`, `trimmed`, `parsed`, `singleQuoted`；这是词法声明索引，不把局部变量当成对外导出 API。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/tui/frontend/src/core/final-content.ts#L1-L49)。
- **`jiuwenswarm/channels/tui/frontend/src/core/history-parser.ts`**
- 源码声明的类型、组件或调用边界：`mergeAssistantFragmentContents`, `p`, `withoutLast`, `last`, `sortAssistantGroupByTime`, `ta`, `tb`, `sameAssistantTurn`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { normalizeFinalContent } from "./final-content.js";`；`import type { EventFrame } from "./protocol.js";`；`import type { HistoryItem, InfoMeta, JsonValue, MediaItem, ToolCallDisplay } from "./types.js";`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/tui/frontend/src/core/history-parser.ts#L1-L993)。
- **`jiuwenswarm/channels/tui/frontend/src/core/modes.ts`**
- 源码声明的类型、组件或调用边界：`ClientMode`, `isClientMode`, `LEGACY_MODE_TO_NEW`, `normalizeToClientMode`, `isTeamMode`, `formatModeForDisplay`；这是词法声明索引，不把局部变量当成对外导出 API。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/tui/frontend/src/core/modes.ts#L1-L75)。
- **`jiuwenswarm/channels/tui/frontend/src/core/pasted-text.ts`**
- 源码声明的类型、组件或调用边界：`PASTED_TEXT_MARKER_RE`, `PASTED_TEXT_LINE_THRESHOLD`, `PASTED_TEXT_CHAR_THRESHOLD`, `stripBracketedPasteMarkers`, `normalizePastedText`, `countPastedTextLines`, `shouldCollapsePastedText`, `formatPastedTextMarker`；这是词法声明索引，不把局部变量当成对外导出 API。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/tui/frontend/src/core/pasted-text.ts#L1-L37)。
- **`jiuwenswarm/channels/tui/frontend/src/core/plan-entry-source.ts`**
- 源码声明的类型、组件或调用边界：`PLAN_ENTRY_SOURCE_SLASH_COMMAND`, `PLAN_ENTRY_SOURCE_PLAN_TOGGLE`, `PLAN_ENTRY_SOURCES`, `PlanEntrySource`；这是词法声明索引，不把局部变量当成对外导出 API。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/tui/frontend/src/core/plan-entry-source.ts#L1-L46)。
- **`jiuwenswarm/channels/tui/frontend/src/core/protocol.ts`**
- 源码声明的类型、组件或调用边界：`FileAttachment`, `ReqFrame`, `ResFrame`, `EventFrame`, `Frame`, `isResFrame`, `isEventFrame`；这是词法声明索引，不把局部变量当成对外导出 API。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/tui/frontend/src/core/protocol.ts#L1-L49)。
- **`jiuwenswarm/channels/tui/frontend/src/core/session-state.ts`**
- 源码声明的类型、组件或调用边界：`generateCreateToken`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import crypto from "node:crypto";`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/tui/frontend/src/core/session-state.ts#L1-L5)。
- **`jiuwenswarm/channels/tui/frontend/src/core/statusline-runner.ts`**
- 源码声明的类型、组件或调用边界：`ChildProcess`, `StatusLineShellInvocation`, `PathExists`, `gitBashCandidates`, `candidates`, `pathDirs`, `dir`, `findGitBash`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { execFile, type ChildProcess } from "node:child_process";`；`import { existsSync } from "node:fs";`；`import { win32 } from "node:path";`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/tui/frontend/src/core/statusline-runner.ts#L1-L74)。
- **`jiuwenswarm/channels/tui/frontend/src/core/transcript-timeline.ts`**
- 源码声明的类型、组件或调用边界：`TimelineItem`, `toTimestampMs`, `ts`, `compareTimelineItems`, `aValid`, `bValid`, `buildTimelineItems`, `messageItems`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import type { HistoryItem, ToolExecution } from "./types.js";`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/tui/frontend/src/core/transcript-timeline.ts#L1-L247)。
- **`jiuwenswarm/channels/tui/frontend/src/core/tui-config-store.ts`**
- 源码声明的类型、组件或调用边界：`CONFIG_DIR`, `CONFIG_FILE`, `StatusLineSetting`, `TuiConfig`, `loadTuiConfig`, `raw`, `saveTuiConfig`, `existing`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";`；`import { homedir } from "node:os";`；`import { join } from "node:path";`；`import type { ThemeName } from "../ui/theme.js";`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/tui/frontend/src/core/tui-config-store.ts#L1-L67)。
- **`jiuwenswarm/channels/tui/frontend/src/core/tui-trusted-dirs-store.ts`**
- 源码声明的类型、组件或调用边界：`_trustedDirsByProject`, `normalizePath`, `trimmed`, `expanded`, `resolved`, `migrateLegacyFormat`, `raw`, `projectCwd`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { readdirSync, statSync } from "node:fs";`；`import { homedir } from "node:os";`；`import { resolve } from "node:path";`；`import { loadTuiConfig, saveTuiConfig } from "./tui-config-store.js";`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/tui/frontend/src/core/tui-trusted-dirs-store.ts#L1-L336)。
- **`jiuwenswarm/channels/tui/frontend/src/core/types.ts`**
- 源码声明的类型、组件或调用边界：`StreamingState`, `JsonPrimitive`, `JsonValue`, `JsonObject`, `MediaItem`, `SystemMeta`, `InfoMeta`, `ToolCallDisplay`；这是词法声明索引，不把局部变量当成对外导出 API。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/tui/frontend/src/core/types.ts#L1-L272)。

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/tui-client/core/source-contracts-01.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
