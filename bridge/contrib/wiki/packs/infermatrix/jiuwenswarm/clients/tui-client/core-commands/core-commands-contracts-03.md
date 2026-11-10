---
name: core-commands-contracts-03
description: tui-client core-commands 源码接口 03：src/core/commands 下 builtins 下 harmonyos-project-init、help、history、hooks、init.prompts、init、keybindings、mcp、memory-path-utils、memory、mode、model、new 的声明与导入依赖
metadata:
  scope: 只收 内置命令 harmonyos-project-init.ts 至 new.ts 的静态声明；其余命令文件归 core-commands-contracts-01、core-commands-contracts-02、core-commands-contracts-04、core-commands-contracts-05、core-commands-contracts-06，入口说明归 core-commands-overview
---
# core-commands 源码接口与集成边界 03

## 现状

- 本页逐文件说明这一源码模块声明的接口、类型与依赖。记录来自静态源码声明，不证明控制流、配置生效、外部服务可用或测试通过；功能语义与设计取舍沿上级功能页继续阅读。
- **`jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/harmonyos-project-init.ts`**
- 源码声明的类型、组件或调用边界：`CommandContext`, `HarmonyProjectContext`, `RuntimeCheck`, `ProjectInitReport`, `pathError`, `result`, `showProjectReport`, `context`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { addError, addInfo } from "../helpers.js";`；`import { CommandKind, type CommandContext, type SlashCommand } from "../types.js";`；`import { switchMode } from "./mode.js";`；`import { completeDirPath, switchProjectScope } from "./workspace-dir.js";`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/harmonyos-project-init.ts#L1-L144)。
- **`jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/help.ts`**
- 源码声明的类型、组件或调用边界：`SlashCommand`, `COMMAND_GROUPS`, `getCommandGroup`, `createHelpCommand`, `commands`, `groupedCommands`, `ungroupedCommands`, `command`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { CommandKind, type SlashCommand, type SlashCommandListProvider } from "../types.js";`；`import { makeItem } from "../helpers.js";`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/help.ts#L1-L96)。
- **`jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/history.ts`**
- 源码声明的类型、组件或调用边界：`SlashCommand`, `createHistoryCommand`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { CommandKind, type SlashCommand } from "../types.js";`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/history.ts#L1-L15)。
- **`jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/hooks.ts`**
- 源码声明的类型、组件或调用边界：`SlashCommand`, `HookConfig`, `HookMatcherSummary`, `HookEventSummary`, `HooksListPayload`, `showHooksBrowser`, `payload`, `events`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { addError, addInfo, makeItem } from "../helpers.js";`；`import { CommandKind, type SlashCommand } from "../types.js";`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/hooks.ts#L1-L175)。
- **`jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/init.prompts.ts`**
- 源码声明的类型、组件或调用边界：`ScopeKey`, `ExistingFiles`, `BuildInitPromptArgs`, `resolveLanguage`, `lang`, `buildInitPrompt`, `buildInitPromptEn`, `scopeLine`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import type { CommandContext } from "../types.js";`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/init.prompts.ts#L1-L244)。
- **`jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/init.ts`**
- 源码声明的类型、组件或调用边界：`SlashCommand`, `ExistingFiles`, `ScopeKey`, `ScopeOption`, `getScopeOptions`, `createInitCommand`, `language`, `rootDir`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { existsSync } from "node:fs";`；`import { join } from "node:path";`；`import { addError, addInfo } from "../helpers.js";`；`import { CommandKind, type SlashCommand } from "../types.js";`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/init.ts#L1-L227)。
- **`jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/keybindings.ts`**
- 源码声明的类型、组件或调用边界：`CommandContext`, `KeybindingContextName`, `formatWarning`, `where`, `applyAndReport`, `warnings`, `openEditor`, `path`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";`；`import { dirname } from "node:path";`；`import { addError, addInfo } from "../helpers.js";`；`import { CommandKind, type CommandContext, type SlashCommand } from "../types.js";`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/keybindings.ts#L1-L160)。
- **`jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/mcp.ts`**
- 源码声明的类型、组件或调用边界：`SlashCommand`, `McpTransport`, `McpListItem`, `McpListPayload`, `McpShowPayload`, `VALID_TRANSPORTS`, `tokenize`, `re`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { addError, addInfo } from "../helpers.js";`；`import { CommandKind, type SlashCommand } from "../types.js";`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/mcp.ts#L1-L316)。
- **`jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/memory-path-utils.ts`**
- 源码声明的类型、组件或调用边界：`formatMemoryPathForDisplay`, `namespacedPath`, `getDisplayPath`, `fileSlashes`, `fileNorm`, `homeDir`, `homeDirSlashes`, `homeDirNorm`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { statSync } from "node:fs";`；`import { homedir } from "node:os";`；`import { dirname, join, parse, relative } from "node:path";`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/memory-path-utils.ts#L1-L192)。
- **`jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/memory.ts`**
- 源码声明的类型、组件或调用边界：`SlashCommand`, `MemoryFile`, `MemoryEditResult`, `MemoryStatusResult`, `MemoryToggleResult`, `MemoryOpenResult`, `PROJECT_MEMORY_FILES`, `LOCAL_MEMORY_FILES`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { existsSync, mkdirSync, readdirSync, statSync, readFileSync, writeFileSync } from "node:fs";`；`import { homedir } from "node:os";`；`import { dirname, join, parse, relative } from "node:path";`；`import { addError, addInfo, makeItem } from "../helpers.js";`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/memory.ts#L1-L1043)。
- **`jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/mode.ts`**
- 源码声明的类型、组件或调用边界：`CommandContext`, `switchMode`, `currentMode`, `displayNextMode`, `answers`, `selected`, `MODE_ALIASES`, `resolveModeTarget`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import type { AutocompleteItem } from "@mariozechner/pi-tui";`；`import type { ClientMode } from "../../modes.js";`；`import { formatModeForDisplay, isTeamMode } from "../../modes.js";`；`import { makeItem } from "../helpers.js";`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/mode.ts#L1-L159)。
- **`jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/model.ts`**
- 源码声明的类型、组件或调用边界：`SlashCommand`, `ModelMeta`, `ModelListPayload`, `RESERVED_MULTIMODAL_MODEL_KEYS`, `isReservedMultimodalModelKey`, `createModelCommand`, `raw`, `parts`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { addError, addInfo } from "../helpers.js";`；`import { CommandKind, type SlashCommand } from "../types.js";`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/model.ts#L1-L231)。
- **`jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/new.ts`**
- 源码声明的类型、组件或调用边界：`SlashCommand`, `shouldPersistSessionFromArgs`, `parts`, `createNewCommand`, `persistSession`, `created`, `nextId`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { generateCreateToken } from "../../session-state.js";`；`import { parseArgs } from "../helpers.js";`；`import { makeItem } from "../helpers.js";`；`import { CommandKind, type SlashCommand } from "../types.js";`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/new.ts#L1-L44)。

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/tui-client/core-commands/source-contracts-03.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
