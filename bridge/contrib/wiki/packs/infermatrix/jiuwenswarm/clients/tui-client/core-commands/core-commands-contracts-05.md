---
name: core-commands-contracts-05
description: tui-client core-commands 源码接口 05：src/core/commands 下 builtins 下 simplify、skills、status、statusline、swarmflow、swarmflows、switch、teamskills、theme、usage、view、workspace-dir，以及 commands 下 clipboard.ts、helpers.ts 的声明与导入依赖
metadata:
  scope: 只收 内置命令 simplify.ts 至 workspace-dir.ts，加 clipboard.ts 与 helpers.ts 的静态声明；其余命令文件归 core-commands-contracts-01、core-commands-contracts-02、core-commands-contracts-03、core-commands-contracts-04、core-commands-contracts-06，入口说明归 core-commands-overview
---
# core-commands 源码接口与集成边界 05

## 现状

- 本页逐文件说明这一源码模块声明的接口、类型与依赖。记录来自静态源码声明，不证明控制流、配置生效、外部服务可用或测试通过；功能语义与设计取舍沿上级功能页继续阅读。
- **`jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/simplify.ts`**
- 源码声明的类型、组件或调用边界：`SlashCommand`, `SimplifyResponse`, `createSimplifyCommand`, `target`, `payload`, `prompt`, `requestId`, `message`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { addError, addInfo } from "../helpers.js";`；`import { CommandKind, type SlashCommand } from "../types.js";`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/simplify.ts#L1-L94)。
- **`jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/skills.ts`**
- 源码声明的类型、组件或调用边界：`SlashCommand`, `ONLINE_SKILL_SOURCES`, `SkillNetItem`, `MarketPlaceItem`, `listMarketplaces`, `payload`, `items`, `pollSkillNetInstall`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { flattenArrayPayload, makeItem } from "../helpers.js";`；`import { CommandKind, type SlashCommand } from "../types.js";`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/skills.ts#L1-L877)。
- **`jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/status.ts`**
- 源码声明的类型、组件或调用边界：`SlashCommand`, `MemoryWarning`, `StatusPayload`, `showOverview`, `mcpItems`, `sourceItems`, `warnings`, `showUsage`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { addError, addInfo } from "../helpers.js";`；`import { CommandKind, type SlashCommand } from "../types.js";`；`import type { SessionUsageSummary } from "../../../app-state.js";`；`import { formatModeForDisplay } from "../../modes.js";`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/status.ts#L1-L182)。
- **`jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/statusline.ts`**
- 源码声明的类型、组件或调用边界：`StatusLineSetting`, `CommandContext`, `getStatusLineConfig`, `showCurrentConfig`, `sl`, `lines`, `stripOuterQuotes`, `trimmed`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { makeItem } from "../helpers.js";`；`import { loadTuiConfig, saveTuiConfig, type StatusLineSetting } from "../../tui-config-store.js";`；`import { CommandKind, type CommandContext, type SlashCommand } from "../types.js";`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/statusline.ts#L1-L283)。
- **`jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/swarmflow.ts`**
- 源码声明的类型、组件或调用边界：`ClientMode`, `SlashCommand`, `SwarmflowToggleTarget`, `BudgetValue`, `SwarmflowTogglePlan`, `parseSwarmflowEnabled`, `value`, `parseSwarmflowBudget`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { addInfo, addError } from "../helpers.js";`；`import { formatModeForDisplay, isTeamMode, type ClientMode } from "../../modes.js";`；`import { CommandKind, type SlashCommand } from "../types.js";`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/swarmflow.ts#L1-L273)。
- **`jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/swarmflows.ts`**
- 源码声明的类型、组件或调用边界：`SlashCommand`, `createSwarmFlowsCommand`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { addInfo } from "../helpers.js";`；`import { CommandKind, type SlashCommand } from "../types.js";`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/swarmflows.ts#L1-L22)。
- **`jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/switch.ts`**
- 源码声明的类型、组件或调用边界：`CommandContext`, `SWITCH_CANCEL_TIMEOUT_MS`, `ThirdAgentEntry`, `ThirdAgentListPayload`, `performSwitch`, `check`, `answers`, `selected`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { makeItem } from "../helpers.js";`；`import { HANDOFF_TARGET_CC_TUI } from "../../supervision/protocol.js";`；`import { CommandKind, type CommandContext, type SlashCommand } from "../types.js";`；`import type { PendingQuestionOption } from "../../event-handlers.js";`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/switch.ts#L1-L275)。
- **`jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/teamskills.ts`**
- 源码声明的类型、组件或调用边界：`SlashCommand`, `TeamSkillsPublishParams`, `TeamSkillsDeleteParams`, `TeamSkillsInitParams`, `TeamSkillsValidateParams`, `TeamSkillsPackParams`, `TeamSkillsInfoParams`, `TeamSkillsSearchParams`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { flattenArrayPayload, makeItem, parseArgs } from "../helpers.js";`；`import { CommandKind, type SlashCommand } from "../types.js";`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/teamskills.ts#L1-L810)。
- **`jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/theme.ts`**
- 源码声明的类型、组件或调用边界：`SlashCommand`, `DISPLAY_OPTIONS`, `createThemeCommand`, `value`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { addError, addInfo } from "../helpers.js";`；`import { CommandKind, type SlashCommand } from "../types.js";`；`import type { ThemeName } from "../../../ui/theme.js";`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/theme.ts#L1-L46)。
- **`jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/usage.ts`**
- 源码声明的类型、组件或调用边界：`SlashCommand`, `showUsage`, `summary`, `fmt`, `items`, `entry`, `createUsageCommand`, `message`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { addInfo, addError } from "../helpers.js";`；`import { CommandKind, type SlashCommand } from "../types.js";`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/usage.ts#L1-L54)。
- **`jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/view.ts`**
- 源码声明的类型、组件或调用边界：`SlashCommand`, `createViewCommand`, `nextMode`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { makeItem } from "../helpers.js";`；`import { CommandKind, type SlashCommand } from "../types.js";`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/view.ts#L1-L23)。
- **`jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/workspace-dir.ts`**
- 源码声明的类型、组件或调用边界：`CommandContext`, `completeDirPath`, `trimmed`, `input`, `searchDir`, `prefixFilter`, `d`, `entries`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { readdirSync, statSync } from "node:fs";`；`import { homedir } from "node:os";`；`import { basename, dirname, isAbsolute, join, resolve } from "node:path";`；`import { addError, addInfo } from "../helpers.js";`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/workspace-dir.ts#L1-L318)。
- **`jiuwenswarm/channels/tui/frontend/src/core/commands/clipboard.ts`**
- 源码声明的类型、组件或调用边界：`tryClipboardAsync`, `settled`, `child`, `timer`, `tryCommandAsync`, `settled`, `child`, `timer`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { spawn } from "node:child_process";`；`import { writeFileSync, unlinkSync } from "node:fs";`；`import { join } from "node:path";`；`import { tmpdir } from "node:os";`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/tui/frontend/src/core/commands/clipboard.ts#L1-L243)。
- **`jiuwenswarm/channels/tui/frontend/src/core/commands/helpers.ts`**
- 源码声明的类型、组件或调用边界：`now`, `makeItem`, `id`, `addInfo`, `addError`, `addCommandEcho`, `addDiff`, `id`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import type { HistoryItem, DiffMeta } from "../types.js";`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/tui/frontend/src/core/commands/helpers.ts#L1-L75)。

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/tui-client/core-commands/source-contracts-05.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
