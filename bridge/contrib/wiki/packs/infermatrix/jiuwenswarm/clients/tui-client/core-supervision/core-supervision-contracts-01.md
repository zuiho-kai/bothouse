---
name: core-supervision-contracts-01
description: tui-client core-supervision 源码接口 01：src/core/supervision 下 handoff-port、protocol、reauth-port、supervised-env、task-lifecycle-port、ui-lifecycle 共 6 个文件的声明与导入依赖
metadata:
  scope: 只收 src/core/supervision 下本页所列文件的静态声明；入口说明归 core-supervision-overview
---
# core-supervision 源码接口与集成边界 01

## 现状

- 本页逐文件说明这一源码模块声明的接口、类型与依赖。记录来自静态源码声明，不证明控制流、配置生效、外部服务可用或测试通过；功能语义与设计取舍沿上级功能页继续阅读。
- **`jiuwenswarm/channels/tui/frontend/src/core/supervision/handoff-port.ts`**
- 源码声明的类型、组件或调用边界：`LAUNCHER_EXIT_INTERNAL_ERROR`, `HandoffPortImpl`, `check`, `exitCode`, `parsed`, `handoffPayload`, `handoffMessage`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import type {`；`import { HANDOFF_TARGET_CC_TUI } from "./protocol.js";`；`import type { SupervisionEnv } from "./supervised-env.js";`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/tui/frontend/src/core/supervision/handoff-port.ts#L1-L130)。
- **`jiuwenswarm/channels/tui/frontend/src/core/supervision/protocol.ts`**
- 源码声明的类型、组件或调用边界：`HANDOFF_TARGET_CC_TUI`, `HandoffTarget`, `HandoffErrorCode`, `HandoffCheckResult`, `CancelErrorCode`, `CancelError`, `CancelAndWaitOptions`, `TaskLifecyclePort`；这是词法声明索引，不把局部变量当成对外导出 API。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/tui/frontend/src/core/supervision/protocol.ts#L1-L111)。
- **`jiuwenswarm/channels/tui/frontend/src/core/supervision/reauth-port.ts`**
- 源码声明的类型、组件或调用边界：`LAUNCHER_EXIT_INTERNAL_ERROR`, `ReauthenticationPortImpl`, `exitCode`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import type { ReauthenticationPort, ReauthenticationReason, UiLifecyclePort } from "./protocol.js";`；`import type { SupervisionEnv } from "./supervised-env.js";`；`import type { HandoffPortImpl } from "./handoff-port.js";`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/tui/frontend/src/core/supervision/reauth-port.ts#L1-L71)。
- **`jiuwenswarm/channels/tui/frontend/src/core/supervision/supervised-env.ts`**
- 源码声明的类型、组件或调用边界：`SupervisionEnv`, `readSupervisionEnv`, `supervised`, `switchCcExitCode`, `reauthExitCode`, `ccTuiExecutable`, `parseExitCode`, `n`；这是词法声明索引，不把局部变量当成对外导出 API。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/tui/frontend/src/core/supervision/supervised-env.ts#L1-L43)。
- **`jiuwenswarm/channels/tui/frontend/src/core/supervision/task-lifecycle-port.ts`**
- 源码声明的类型、组件或调用边界：`CancelAndWaitOptions`, `Waiter`, `TaskLifecycleDeps`, `InterruptResultHandler`, `DEFAULT_TIMEOUT_MS`, `TaskLifecyclePortImpl`, `timeoutMs`, `showNotice`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { CancelError, type CancelAndWaitOptions, type TaskLifecyclePort } from "./protocol.js";`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/tui/frontend/src/core/supervision/task-lifecycle-port.ts#L1-L175)。
- **`jiuwenswarm/channels/tui/frontend/src/core/supervision/ui-lifecycle.ts`**
- 源码声明的类型、组件或调用边界：`UiLifecycleDeps`, `UiLifecyclePortImpl`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import type { UiExitReason, UiLifecyclePort } from "./protocol.js";`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/tui/frontend/src/core/supervision/ui-lifecycle.ts#L1-L86)。

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/tui-client/core-supervision/source-contracts-01.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
