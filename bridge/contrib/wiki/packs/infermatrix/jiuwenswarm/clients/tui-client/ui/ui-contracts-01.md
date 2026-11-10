---
name: ui-contracts-01
description: tui-client ui 源码接口 01：TUI 前端 src/ui 的 app-screen、keymap、memory-view、screen-layout、theme、transcript-entry-selection、transcript-renderer、welcome 的声明与导入依赖
metadata:
  scope: 只收 channels/tui/frontend/src/ui 八个文件的接口记录；目录入口归 ui-overview
---
# ui 源码接口与集成边界 01

## 现状

- 本页逐文件说明这一源码模块声明的接口、类型与依赖。记录来自静态源码声明，不证明控制流、配置生效、外部服务可用或测试通过；功能语义与设计取舍沿上级功能页继续阅读。
- **`jiuwenswarm/channels/tui/frontend/src/ui/app-screen.ts`**
- 源码声明的类型、组件或调用边界：`SelectItem`, `SelectListTruncatePrimaryContext`, `AutocompleteItem`, `AutocompleteProvider`, `Component`, `Focusable`, `SlashCommand`, `InstalledSkillEntry`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import {`；`import { spawnSync } from "node:child_process";`；`import * as fs from "node:fs";`；`import * as path from "node:path";`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/tui/frontend/src/ui/app-screen.ts#L1-L10368)。
- **`jiuwenswarm/channels/tui/frontend/src/ui/keymap.ts`**
- 源码声明的类型、组件或调用边界：`lastInterruptTime`, `AppScreenKeymapDelegate`, `KeyBindingDisplay`, `runCtrlC`, `now`, `commandCancelled`, `runCtrlD`, `now`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { matchesKey } from "@mariozechner/pi-tui";`；`import type { KeybindingAction } from "../core/keybindings/actions.js";`；`import { resolveAction } from "../core/keybindings/resolver.js";`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/tui/frontend/src/ui/keymap.ts#L1-L149)。
- **`jiuwenswarm/channels/tui/frontend/src/ui/memory-view.ts`**
- 源码声明的类型、组件或调用边界：`TUI`, `MemoryFile`, `memoryPathKey`, `resolved`, `errorCode`, `assertDirectoryWritable`, `assertFileWritable`, `fd`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import {`；`import { dirname, resolve } from "node:path";`；`import { type TUI, type SelectItem, SelectList } from "@mariozechner/pi-tui";`；`import { addInfo } from "../core/commands/helpers.js";`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/tui/frontend/src/ui/memory-view.ts#L1-L699)。
- **`jiuwenswarm/channels/tui/frontend/src/ui/screen-layout.ts`**
- 源码声明的类型、组件或调用边界：`ScreenLayoutOptions`, `formatSubtaskStatus`, `formatElapsed`, `totalSeconds`, `minutes`, `seconds`, `formatTokenCount`, `renderRunningStatus`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { visibleWidth } from "@mariozechner/pi-tui";`；`import type { AppSnapshot } from "../app-state.js";`；`import { formatModeForDisplay, isTeamMode } from "../core/modes.js";`；`import { renderTeamPanel } from "./components/team-panel.js";`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/tui/frontend/src/ui/screen-layout.ts#L1-L445)。
- **`jiuwenswarm/channels/tui/frontend/src/ui/theme.ts`**
- 源码声明的类型、组件或调用边界：`highlightLine`, `result`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import chalk from "chalk";`；`import type { EditorTheme, MarkdownTheme, SelectListTheme } from "@mariozechner/pi-tui";`；`import { loadTuiConfig, saveTuiConfig } from "../core/tui-config-store.js";`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/tui/frontend/src/ui/theme.ts#L1-L354)。
- **`jiuwenswarm/channels/tui/frontend/src/ui/transcript-entry-selection.ts`**
- 源码声明的类型、组件或调用边界：`isTodoTool`, `normalized`, `filterTodoToolEntry`, `tools`, `SelectedTranscriptEntries`, `selectTranscriptEntries`, `entries`, `latestUserIndex`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import type { AppSnapshot } from "../app-state.js";`；`import type { HistoryItem, ToolCallDisplay } from "../core/types.js";`；`import { buildTranscriptEntries } from "../core/transcript-timeline.js";`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/tui/frontend/src/ui/transcript-entry-selection.ts#L1-L114)。
- **`jiuwenswarm/channels/tui/frontend/src/ui/transcript-renderer.ts`**
- 源码声明的类型、组件或调用边界：`renderPendingUserInput`, `lines`, `isToolEntry`, `computeHiddenToolIndices`, `hidden`, `runStart`, `runLength`, `flushRun`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import type { AppSnapshot } from "../app-state.js";`；`import type { HistoryItem } from "../core/types.js";`；`import { renderHistoryEntry } from "./components/messages/index.js";`；`import { shouldEmphasizeAssistantTransition } from "./components/messages/presentation-rules.js";`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/tui/frontend/src/ui/transcript-renderer.ts#L1-L145)。
- **`jiuwenswarm/channels/tui/frontend/src/ui/welcome.ts`**
- 源码声明的类型、组件或调用边界：`PreferredLanguage`, `ART_TITLE_RAW`, `BG_MAGENTA`, `GRADIENT_COLORS`, `applyGradient`, `color`, `centerLine`, `lineWidth`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { visibleWidth, wrapTextWithAnsi } from "@mariozechner/pi-tui";`；`import { formatModeForDisplay } from "../core/modes.js";`；`import type { ConnectionStatus } from "../core/ws-client.js";`；`import { padToWidth } from "./rendering/text.js";`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/tui/frontend/src/ui/welcome.ts#L1-L168)。

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/tui-client/ui/source-contracts-01.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
