---
name: core-commands-contracts-06
description: tui-client core-commands 源码接口 06：src/core/commands 下 registry.ts（BuiltinCommandsOptions、isHarmonyOSCommandsEnabled、createBuiltinCommands，导入各内置命令工厂）与 types.ts（CommandContext、SlashCommand、CommandSuggestion 等类型）的声明
metadata:
  scope: 只收 registry.ts 与 types.ts 两个文件的静态声明；其余命令文件归 core-commands-contracts-01 至 core-commands-contracts-05，入口说明归 core-commands-overview
---
# core-commands 源码接口与集成边界 06

## 现状

- 本页逐文件说明这一源码模块声明的接口、类型与依赖。记录来自静态源码声明，不证明控制流、配置生效、外部服务可用或测试通过；功能语义与设计取舍沿上级功能页继续阅读。
- **`jiuwenswarm/channels/tui/frontend/src/core/commands/registry.ts`**
- 源码声明的类型、组件或调用边界：`BuiltinCommandsOptions`, `isHarmonyOSCommandsEnabled`, `createBuiltinCommands`, `commands`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import type { SlashCommand } from "./types.js";`；`import { createBranchCommand } from "./builtins/branch.js";`；`import { createBtwCommand } from "./builtins/btw.js";`；`import { createClearCommand } from "./builtins/clear.js";`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/tui/frontend/src/core/commands/registry.ts#L1-L143)。
- **`jiuwenswarm/channels/tui/frontend/src/core/commands/types.ts`**
- 源码声明的类型、组件或调用边界：`ConnectionStatus`, `PreferredLanguage`, `StatusViewTab`, `CommandKind`, `CommandSuggestion`, `CommandContext`, `SlashCommand`, `SlashCommandListProvider`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import type { HistoryItem, TeamMessageEvent } from "../types.js";`；`import type { AccentColorName, ThemeName } from "../../ui/theme.js";`；`import type { PendingQuestionItem, UserAnswer } from "../event-handlers.js";`；`import type { FileAttachment } from "../protocol.js";`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/tui/frontend/src/core/commands/types.ts#L1-L201)。

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/tui-client/core-commands/source-contracts-06.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
