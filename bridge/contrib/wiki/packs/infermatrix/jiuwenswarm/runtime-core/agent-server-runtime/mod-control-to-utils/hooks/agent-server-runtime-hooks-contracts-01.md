---
name: agent-server-runtime-hooks-contracts-01
description: hooks 源码接口与集成边界 01：jiuwenswarm/server/hooks 下 executor.py（HookExecutor、HookResult、HookOutcome）与 user_hook_rail.py（UserHookRail）的静态声明
metadata:
  scope: 只收hooks 目录两个文件的静态声明，不证明运行行为；入口说明归 agent-server-runtime-hooks-overview
---
# hooks 源码接口与集成边界 01

## 现状

- 本页逐文件说明这一源码模块声明的接口、类型与依赖。记录来自静态源码声明，不证明控制流、配置生效、外部服务可用或测试通过；功能语义与设计取舍沿上级功能页继续阅读。
- **`jiuwenswarm/server/hooks/executor.py`**
- 源码对模块职责的说明：Hook 执行器 —— 执行 command / prompt 两类 hook，返回统一 HookResult.。
- `HookOutcome` 定义类型边界。
- `HookResult` 定义类型边界。
- `HookExecutor` 定义类型边界；方法入口：`run_all`, `parse_command_output`, `extract_json_from_response`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import asyncio`；`import json`；`import logging`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/hooks/executor.py#L1-L299)。
- **`jiuwenswarm/server/hooks/user_hook_rail.py`**
- 源码对模块职责的说明：UserHookRail —— 将用户配置的 hooks 以 Rail 形态注册到 DeepAgent，拦截工具调用和 Agent 生命周期.。
- `UserHookRail` 继承 `DeepAgentRail`；方法入口：`__init__`, `before_invoke`, `before_task_iteration`, `before_tool_call`, `after_tool_call`, `after_task_iteration`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import logging`；`from contextvars import ContextVar`；`from openjiuwen.core.foundation.llm import ToolMessage`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/hooks/user_hook_rail.py#L1-L286)。

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/agent-server-runtime/hooks/source-contracts-01.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
