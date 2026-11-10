---
name: core-contracts-02
description: tui-client core 源码接口 02：src/core/workflows.ts（WorkflowStatus、WorkflowRun 等类型）与 ws-client.ts（WsClient、ConnectionStatus、FrameHandler，导入 ws 与 protocol）的声明
metadata:
  scope: 只收 workflows.ts 与 ws-client.ts 两个文件的静态声明；其余 core 文件归 core-contracts-01，入口说明归 core-overview
---
# core 源码接口与集成边界 02

## 现状

- 本页逐文件说明这一源码模块声明的接口、类型与依赖。记录来自静态源码声明，不证明控制流、配置生效、外部服务可用或测试通过；功能语义与设计取舍沿上级功能页继续阅读。
- **`jiuwenswarm/channels/tui/frontend/src/core/workflows.ts`**
- 源码声明的类型、组件或调用边界：`WorkflowStatus`, `WorkflowAgentActivity`, `WorkflowNodeType`, `WorkflowBudget`, `WorkflowAgentPart`, `WorkflowAgent`, `WorkflowPhase`, `WorkflowRun`；这是词法声明索引，不把局部变量当成对外导出 API。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/tui/frontend/src/core/workflows.ts#L1-L849)。
- **`jiuwenswarm/channels/tui/frontend/src/core/ws-client.ts`**
- 源码声明的类型、组件或调用边界：`FrameHandler`, `ConnectionStatus`, `PendingRequest`, `WsClient`, `ws`, `frame`, `timer`, `listener`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import WebSocket from "ws";`；`import type { Frame, ReqFrame, ResFrame } from "./protocol.js";`；`import { isResFrame } from "./protocol.js";`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/tui/frontend/src/core/ws-client.ts#L1-L266)。

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/tui-client/core/source-contracts-02.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
