---
name: core-commands-contracts-04
description: tui-client core-commands 源码接口 04：src/core/commands 下 builtins 下 permissions、persist、plan、plugin、recap、reload-plugins、rename、resume、review、rewind、sandbox、security-review、session、sessions 的声明与导入依赖
metadata:
  scope: 只收 内置命令 permissions.ts 至 sessions.ts 的静态声明；其余命令文件归 core-commands-contracts-01、core-commands-contracts-02、core-commands-contracts-03、core-commands-contracts-05、core-commands-contracts-06，入口说明归 core-commands-overview
---
# core-commands 源码接口与集成边界 04

## 现状

- 本页逐文件说明这一源码模块声明的接口、类型与依赖。记录来自静态源码声明，不证明控制流、配置生效、外部服务可用或测试通过；功能语义与设计取舍沿上级功能页继续阅读。
- **`jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/permissions.ts`**
- 源码声明的类型、组件或调用边界：`SlashCommand`, `VALID_LEVELS`, `RULE_MATCH_RE`, `PATTERN_WRAP_WIDTH`, `PATTERN_CONT_INDENT`, `wrapLongToken`, `lines`, `i`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { addError, addInfo, makeItem } from "../helpers.js";`；`import { CommandKind, type SlashCommand } from "../types.js";`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/permissions.ts#L1-L554)。
- **`jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/persist.ts`**
- 源码声明的类型、组件或调用边界：`SlashCommand`, `normalizePersistContent`, `createPersistCommand`, `content`, `created`, `nextId`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { generateCreateToken } from "../../session-state.js";`；`import { addError, addInfo } from "../helpers.js";`；`import { CommandKind, type SlashCommand } from "../types.js";`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/persist.ts#L1-L51)。
- **`jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/plan.ts`**
- 源码声明的类型、组件或调用边界：`SlashCommand`, `PLAN_TO_NORMAL`, `resolvePlanTarget`, `resolveNormalTarget`, `createPlanCommand`, `value`, `isPlan`, `exitPlan`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { addInfo } from "../helpers.js";`；`import type { ClientMode } from "../../modes.js";`；`import { CommandKind, type SlashCommand } from "../types.js";`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/plan.ts#L1-L95)。
- **`jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/plugin.ts`**
- 源码声明的类型、组件或调用边界：`SlashCommand`, `PluginEntry`, `PluginListPayload`, `MarketPlaceItem`, `listPlugins`, `payload`, `plugins`, `enabled`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { addError, addInfo, flattenArrayPayload, parseArgs } from "../helpers.js";`；`import { CommandKind, type SlashCommand, type CommandContext } from "../types.js";`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/plugin.ts#L1-L290)。
- **`jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/recap.ts`**
- 源码声明的类型、组件或调用边界：`CommandContext`, `RecapResponse`, `NO_TURN_MSG`, `FAILED_MSG`, `CANCELLED_MSG`, `waitForInterrupt`, `check`, `createRecapCommand`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { addError, addInfo } from "../helpers.js";`；`import { CommandKind, type CommandContext, type SlashCommand } from "../types.js";`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/recap.ts#L1-L82)。
- **`jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/reload-plugins.ts`**
- 源码声明的类型、组件或调用边界：`SlashCommand`, `ReloadPluginsPayload`, `createReloadPluginsCommand`, `payload`, `message`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { addError, addInfo } from "../helpers.js";`；`import { CommandKind, type SlashCommand, type CommandContext } from "../types.js";`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/reload-plugins.ts#L1-L42)。
- **`jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/rename.ts`**
- 源码声明的类型、组件或调用边界：`SlashCommand`, `RenamePayload`, `createRenameCommand`, `value`, `payload`, `currentTitle`, `payload`, `message`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { addError, addInfo } from "../helpers.js";`；`import { CommandKind, type SlashCommand } from "../types.js";`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/rename.ts#L1-L63)。
- **`jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/resume.ts`**
- 源码声明的类型、组件或调用边界：`SlashCommand`, `SessionMeta`, `SessionListPayload`, `ResumeResumePayload`, `normalizeSessionId`, `trimmed`, `trimmed`, `sanitizeSessionList`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { addError, addInfo } from "../helpers.js";`；`import { CommandKind, type SlashCommand } from "../types.js";`；`import type { AccentColorName } from "../../../ui/theme.js";`；`import { isTeamMode, normalizeToClientMode } from "../../modes.js";`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/resume.ts#L1-L279)。
- **`jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/review.ts`**
- 源码声明的类型、组件或调用边界：`SlashCommand`, `createReviewCommand`, `command`, `requestId`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { makeItem } from "../helpers.js";`；`import { CommandKind, type SlashCommand } from "../types.js";`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/review.ts#L1-L31)。
- **`jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/rewind.ts`**
- 源码声明的类型、组件或调用边界：`SlashCommand`, `TurnFileChange`, `TurnInfo`, `ListTurnsPayload`, `RewindPayload`, `RestoreOption`, `GREEN`, `RED`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { addCommandEcho, addError, addInfo, makeItem } from "../helpers.js";`；`import { CommandKind, type SlashCommand } from "../types.js";`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/rewind.ts#L1-L426)。
- **`jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/sandbox.ts`**
- 源码声明的类型、组件或调用边界：`CommandContext`, `SandboxFileEntry`, `SandboxRuntime`, `SandboxEffectiveFiles`, `SandboxMount`, `SandboxResponse`, `SandboxProviderType`, `cachedProviderType`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { addError, addInfo } from "../helpers.js";`；`import { CommandKind, type CommandContext, type SlashCommand } from "../types.js";`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/sandbox.ts#L1-L413)。
- **`jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/security-review.ts`**
- 源码声明的类型、组件或调用边界：`SlashCommand`, `createSecurityReviewCommand`, `command`, `requestId`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { makeItem } from "../helpers.js";`；`import { CommandKind, type SlashCommand } from "../types.js";`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/security-review.ts#L1-L38)。
- **`jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/session.ts`**
- 源码声明的类型、组件或调用边界：`SlashCommand`, `createSessionCommand`, `payload`, `message`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { addError, addInfo } from "../helpers.js";`；`import { CommandKind, type SlashCommand } from "../types.js";`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/session.ts#L1-L37)。
- **`jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/sessions.ts`**
- 源码声明的类型、组件或调用边界：`SlashCommand`, `createSessionsCommand`, `payload`, `items`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { flattenArrayPayload, formatValue, makeItem } from "../helpers.js";`；`import { CommandKind, type SlashCommand } from "../types.js";`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/sessions.ts#L1-L32)。

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/tui-client/core-commands/source-contracts-04.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
