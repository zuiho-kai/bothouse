---
name: core-commands-contracts-01
description: tui-client core-commands 源码接口 01：src/core/commands 下 CommandService.ts 与 builtins 下 _placeholder、agents、auto-harness-issue-fix、auto-harness、autofix-pr.prompts、autofix-pr.status、branch、btw、cancel、chrome、clear、collapse、color 的声明与导入依赖
metadata:
  scope: 只收 CommandService.ts 与按字母序排到 color.ts 为止的内置命令文件 的静态声明；其余命令文件归 core-commands-contracts-02、core-commands-contracts-03、core-commands-contracts-04、core-commands-contracts-05、core-commands-contracts-06，入口说明归 core-commands-overview
---
# core-commands 源码接口与集成边界 01

## 现状

- 本页逐文件说明这一源码模块声明的接口、类型与依赖。记录来自静态源码声明，不证明控制流、配置生效、外部服务可用或测试通过；功能语义与设计取舍沿上级功能页继续阅读。
- **`jiuwenswarm/channels/tui/frontend/src/core/commands/CommandService.ts`**
- 源码声明的类型、组件或调用边界：`parseSlashCommand`, `trimmed`, `parts`, `currentCommands`, `command`, `parentCommand`, `pathIndex`, `canonicalPath`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import type { CommandContext, CommandSuggestion, SlashCommand } from "./types.js";`；`import { flattenArrayPayload, makeItem, parseArgs } from "./helpers.js";`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/tui/frontend/src/core/commands/CommandService.ts#L1-L261)。
- **`jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/_placeholder.ts`**
- 源码声明的类型、组件或调用边界：`SlashCommand`, `createPlaceholderCommand`, `message`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { addInfo } from "../helpers.js";`；`import { CommandKind, type SlashCommand } from "../types.js";`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/_placeholder.ts#L1-L29)。
- **`jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/agents.ts`**
- 源码声明的类型、组件或调用边界：`SlashCommand`, `AgentDef`, `SOURCE_LABELS`, `formatSource`, `label`, `shadow`, `listAgents`, `payload`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { flattenArrayPayload, makeItem } from "../helpers.js";`；`import { CommandKind, type SlashCommand } from "../types.js";`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/agents.ts#L1-L414)。
- **`jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/auto-harness-issue-fix.ts`**
- 源码声明的类型、组件或调用边界：`AutoHarnessIssueStageProgress`, `AutoHarnessIssueProgress`, `IssueFixTaskStatus`, `IssueFixWatchItem`, `IssueWatchArgs`, `IssueFixArgs`, `IssueWatchResult`, `PipelineNameResolver`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { parseArgs } from "../helpers.js";`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/auto-harness-issue-fix.ts#L1-L683)。
- **`jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/auto-harness.ts`**
- 源码声明的类型、组件或调用边界：`SlashCommand`, `IssueListRow`, `IssueMatrixResult`, `PIPELINE_DISPLAY_NAMES`, `PIPELINE_DISPLAY_KEYS`, `PIPELINE_BACKEND_VALUES`, `resolvePipelineName`, `PIPELINE_OPTIONS`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { addError, addInfo, parseArgs } from "../helpers.js";`；`import { CommandKind, type SlashCommand, type CommandContext } from "../types.js";`；`import {`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/auto-harness.ts#L1-L2704)。
- **`jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/autofix-pr.prompts.ts`**
- 源码声明的类型、组件或调用边界：`AutofixPrPlatform`, `BuildAutofixPrPromptArgs`, `AUTOFIX_PR_PROMPT_TEMPLATE`, `buildAutofixPrPrompt`, `tail`, `hint`, `target`, `prompt`；这是词法声明索引，不把局部变量当成对外导出 API。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/autofix-pr.prompts.ts#L1-L182)。
- **`jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/autofix-pr.status.ts`**
- 源码声明的类型、组件或调用边界：`GITCODE_V5`, `GITCODE_V2`, `BROWSER_UA`, `HTTP_TIMEOUT_MS`, `CMD_TIMEOUT_MS`, `ChecksVerdict`, `PrState`, `PrStatus`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { execFile } from "node:child_process";`；`import type { PreferredLanguage } from "../types.js";`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/autofix-pr.status.ts#L1-L423)。
- **`jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/branch.ts`**
- 源码声明的类型、组件或调用边界：`SlashCommand`, `SessionForkPayload`, `createBranchCommand`, `hasMainConversation`, `message`, `customTitle`, `payload`, `forkSessionId`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { addCommandEcho, addError, addInfo } from "../helpers.js";`；`import { CommandKind, type SlashCommand } from "../types.js";`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/branch.ts#L1-L79)。
- **`jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/btw.ts`**
- 源码声明的类型、组件或调用边界：`SlashCommand`, `BtwResponse`, `NO_CONTEXT_MSG`, `FAILED_MSG`, `EMPTY_QUESTION_MSG`, `CANCELLED_MSG`, `createBtwCommand`, `question`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { addError, addInfo } from "../helpers.js";`；`import { CommandKind, type SlashCommand } from "../types.js";`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/btw.ts#L1-L110)。
- **`jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/cancel.ts`**
- 源码声明的类型、组件或调用边界：`SlashCommand`, `createCancelCommand`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { addInfo } from "../helpers.js";`；`import { CommandKind, type SlashCommand } from "../types.js";`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/cancel.ts#L1-L17)。
- **`jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/chrome.ts`**
- 源码声明的类型、组件或调用边界：`SlashCommand`, `createChromeCommand`, `message`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { addError, addInfo } from "../helpers.js";`；`import { CommandKind, type SlashCommand } from "../types.js";`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/chrome.ts#L1-L27)。
- **`jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/clear.ts`**
- 源码声明的类型、组件或调用边界：`SlashCommand`, `shouldPersistSessionFromArgs`, `parts`, `createClearCommand`, `persistSession`, `created`, `nextId`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { generateCreateToken } from "../../session-state.js";`；`import { addCommandEcho, addError, addInfo, parseArgs } from "../helpers.js";`；`import { CommandKind, type SlashCommand } from "../types.js";`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/clear.ts#L1-L50)。
- **`jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/collapse.ts`**
- 源码声明的类型、组件或调用边界：`SlashCommand`, `COLLAPSE_SCOPES`, `createCollapseCommand`, `scope`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { makeItem } from "../helpers.js";`；`import { CommandKind, type SlashCommand } from "../types.js";`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/collapse.ts#L1-L32)。
- **`jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/color.ts`**
- 源码声明的类型、组件或调用边界：`SlashCommand`, `AccentColorName`, `COLOR_OPTIONS`, `RESET_ALIASES`, `normalizeColorArg`, `createColorCommand`, `value`, `normalizedColor`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { addError, addInfo } from "../helpers.js";`；`import { CommandKind, type SlashCommand } from "../types.js";`；`import { getAccentColorOptions, type AccentColorName } from "../../../ui/theme.js";`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/color.ts#L1-L60)。

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/tui-client/core-commands/source-contracts-01.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
