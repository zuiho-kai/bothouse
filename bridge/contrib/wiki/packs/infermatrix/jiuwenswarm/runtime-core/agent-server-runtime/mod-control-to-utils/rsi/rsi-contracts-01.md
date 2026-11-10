---
name: rsi-contracts-01
description: rsi 源码接口与集成边界 01：jiuwenswarm/server/rsi 下 __init__ 与 rsi_handlers.py（RsiAgentServerHandlers 及 RSI_PUSH_* 常量名）的静态声明
metadata:
  scope: 只收rsi 目录两个文件的静态声明，不证明运行行为；入口说明归 rsi-overview
---
# rsi 源码接口与集成边界 01

## 现状

- 本页逐文件说明这一源码模块声明的接口、类型与依赖。记录来自静态源码声明，不证明控制流、配置生效、外部服务可用或测试通过；功能语义与设计取舍沿上级功能页继续阅读。
- **`jiuwenswarm/server/rsi/__init__.py`**
- 源码对模块职责的说明：AgentServer RSI 分发层（B2）。核心实现见 ''rsi_handlers.RsiAgentServerHandlers''。。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`from jiuwenswarm.server.rsi.rsi_handlers import RSI_PUSH_PROGRESS, RSI_PUSH`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/rsi/__init__.py#L1-L17)。
- **`jiuwenswarm/server/rsi/rsi_handlers.py`**
- 源码对模块职责的说明：AgentServer RSI 分发层：16 个 ''_handle_rsi_*'' 的统一接线面（B2）。。
- `RsiAgentServerHandlers` 定义类型边界；方法入口：`__init__`, `handle`, `handle_async`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import asyncio`；`import inspect`；`import logging`。
- 模块级配置或常量名称：`RSI_PUSH_STATUS_CHANGED`, `RSI_PUSH_PROGRESS`, `RSI_PUSH_TREE_DELTA`；实际值与使用条件见源码。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/rsi/rsi_handlers.py#L1-L322)。

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/agent-server-runtime/rsi/source-contracts-01.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
