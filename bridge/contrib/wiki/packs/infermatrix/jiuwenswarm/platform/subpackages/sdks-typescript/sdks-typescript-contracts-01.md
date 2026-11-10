---
name: sdks-typescript-contracts-01
description: sdks-typescript 源码接口 01：sdks/typescript/src 的 index.ts（子进程 spawn、Event、RunInput、RunResult 等类型）与 protocol.ts（Json、Mode、Workspace、AgentDefinition 等词法类型声明）和导入依赖
metadata:
  scope: 只收 index.ts 与 protocol.ts 的记录；目录入口归 sdks-typescript-overview
---
# sdks-typescript 源码接口与集成边界 01

## 现状

- 本页逐文件说明这一源码模块声明的接口、类型与依赖。记录来自静态源码声明，不证明控制流、配置生效、外部服务可用或测试通过；功能语义与设计取舍沿上级功能页继续阅读。
- **`sdks/typescript/src/index.ts`**
- 源码声明的类型、组件或调用边界：`ChildProcessWithoutNullStreams`, `Event`, `JsonObject`, `QueryOperation`, `QueryResult`, `RunInput`, `RunResult`, `Workspace`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";`；`import { randomUUID } from "node:crypto";`；`import {`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/sdks/typescript/src/index.ts#L1-L392)。
- **`sdks/typescript/src/protocol.ts`**
- 源码声明的类型、组件或调用边界：`Json`, `JsonObject`, `Mode`, `Workspace`, `AgentDefinition`, `RunInput`, `QueryOperation`, `RuntimeErrorInfo`；这是词法声明索引，不把局部变量当成对外导出 API。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/sdks/typescript/src/protocol.ts#L1-L219)。

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/subpackages/sdks-typescript/source-contracts-01.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
