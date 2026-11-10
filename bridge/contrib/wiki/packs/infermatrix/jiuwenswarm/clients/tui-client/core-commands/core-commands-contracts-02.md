---
name: core-commands-contracts-02
description: tui-client core-commands 源码接口 02：src/core/commands 下 builtins 下 compact、config、context、copy、cron、debug、diff、evolve、exit、expand、export、fold、harmonyos-dev-init、harmonyos-project-init.prompts 的声明与导入依赖
metadata:
  scope: 只收 内置命令 compact.ts 至 harmonyos-project-init.prompts.ts 的静态声明；其余命令文件归 core-commands-contracts-01、core-commands-contracts-03、core-commands-contracts-04、core-commands-contracts-05、core-commands-contracts-06，入口说明归 core-commands-overview
---
# core-commands 源码接口与集成边界 02

## 现状

- 本页逐文件说明这一源码模块声明的接口、类型与依赖。记录来自静态源码声明，不证明控制流、配置生效、外部服务可用或测试通过；功能语义与设计取舍沿上级功能页继续阅读。
- **`jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/compact.ts`**
- 源码声明的类型、组件或调用边界：`SlashCommand`, `CompactResponse`, `createCompactCommand`, `payload`, `result`, `stats`, `compactSummary`, `beforeK`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { addError, addInfo } from "../helpers.js";`；`import { CommandKind, type SlashCommand } from "../types.js";`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/compact.ts#L1-L75)。
- **`jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/config.ts`**
- 源码声明的类型、组件或调用边界：`CommandContext`, `COMPLETION_SCHEMA_TTL_MS`, `cachedSchemaKeys`, `cachedSchemaAt`, `ConfigItemSchema`, `FRONTEND_SCHEMA_KEYS`, `FRONTEND_SCHEMAS`, `getFrontendSchema`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { addError, addInfo, extractObject, formatValue } from "../helpers.js";`；`import { CommandKind, type CommandContext, type SlashCommand } from "../types.js";`；`import type { ThemeName } from "../../../ui/theme.js";`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/config.ts#L1-L649)。
- **`jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/context.ts`**
- 源码声明的类型、组件或调用边界：`SlashCommand`, `ContextUsagePayload`, `formatTokenCount`, `value`, `toLocale`, `renderBar`, `filled`, `clamped`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { addError, addInfo } from "../helpers.js";`；`import { CommandKind, type SlashCommand } from "../types.js";`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/context.ts#L1-L107)。
- **`jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/copy.ts`**
- 源码声明的类型、组件或调用边界：`SlashCommand`, `getRecentAssistantMessages`, `texts`, `index`, `entry`, `text`, `createCopyCommand`, `arg`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { copyToClipboard } from "../clipboard.js";`；`import { addError, addInfo } from "../helpers.js";`；`import { CommandKind, type SlashCommand } from "../types.js";`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/copy.ts#L1-L60)。
- **`jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/cron.ts`**
- 源码声明的类型、组件或调用边界：`SlashCommand`, `CronJobPayload`, `CronJobListPayload`, `CronJobMetaPayload`, `TARGET_CHANNELS`, `cachedCronMeta`, `loadCronJobMeta`, `payload`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { addError, addInfo, parseArgs } from "../helpers.js";`；`import { CommandKind, type SlashCommand, type CommandContext } from "../types.js";`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/cron.ts#L1-L902)。
- **`jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/debug.ts`**
- 源码声明的类型、组件或调用边界：`SlashCommand`, `EMPTY_PROMPT_MSG`, `createDebugCommand`, `prompt`, `requestId`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { addError, makeItem } from "../helpers.js";`；`import { CommandKind, type SlashCommand } from "../types.js";`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/debug.ts#L1-L41)。
- **`jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/diff.ts`**
- 源码声明的类型、组件或调用边界：`SlashCommand`, `DiffPayload`, `createDiffCommand`, `payload`, `turns`, `gitDiff`, `parts`, `summary`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { addError, addDiff } from "../helpers.js";`；`import { CommandKind, type SlashCommand } from "../types.js";`；`import type { TurnDiff, GitDiffData } from "../../types.js";`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/diff.ts#L1-L51)。
- **`jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/evolve.ts`**
- 源码声明的类型、组件或调用边界：`SlashCommand`, `EVOLUTION_SUPPORTED_MODES`, `unsupportedEvolutionModeMessage`, `createEvolveCommand`, `unsupportedMode`, `skillArg`, `text`, `requestId`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { makeItem, parseArgs } from "../helpers.js";`；`import { CommandKind, type SlashCommand } from "../types.js";`；`import type { ClientMode } from "../../modes.js";`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/evolve.ts#L1-L181)。
- **`jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/exit.ts`**
- 源码声明的类型、组件或调用边界：`SlashCommand`, `createExitCommand`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { CommandKind, type SlashCommand } from "../types.js";`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/exit.ts#L1-L15)。
- **`jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/expand.ts`**
- 源码声明的类型、组件或调用边界：`SlashCommand`, `EXPAND_SCOPES`, `createExpandCommand`, `scope`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { makeItem } from "../helpers.js";`；`import { CommandKind, type SlashCommand } from "../types.js";`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/expand.ts#L1-L32)。
- **`jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/export.ts`**
- 源码声明的类型、组件或调用边界：`SlashCommand`, `ensureTxtExtension`, `dir`, `base`, `finalBase`, `formatTimestamp`, `year`, `month`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { writeFileSync } from "node:fs";`；`import { basename, dirname, join, resolve } from "node:path";`；`import { copyToClipboard } from "../clipboard.js";`；`import { addError, addInfo } from "../helpers.js";`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/export.ts#L1-L266)。
- **`jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/fold.ts`**
- 源码声明的类型、组件或调用边界：`SlashCommand`, `FOLD_MODES`, `createFoldCommand`, `mode`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { makeItem } from "../helpers.js";`；`import { CommandKind, type SlashCommand } from "../types.js";`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/fold.ts#L1-L25)。
- **`jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/harmonyos-dev-init.ts`**
- 源码声明的类型、组件或调用边界：`CommandContext`, `RuntimeCheck`, `CommandResult`, `KnowledgeMcpConfig`, `KnowledgeMcpStatus`, `KnowledgeMcpReport`, `HarmonyDevReport`, `McpListPayload`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { addError, addInfo } from "../helpers.js";`；`import { CommandKind, type CommandContext, type SlashCommand } from "../types.js";`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/harmonyos-dev-init.ts#L1-L661)。
- **`jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/harmonyos-project-init.prompts.ts`**
- 源码声明的类型、组件或调用边界：`RuntimeCheck`, `HarmonyModule`, `HarmonyProjectContext`, `promptValue`, `text`, `clipped`, `buildHarmonyOSProjectInitPrompt`, `project`；这是词法声明索引，不把局部变量当成对外导出 API。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/harmonyos-project-init.prompts.ts#L1-L81)。

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/tui-client/core-commands/source-contracts-02.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
