---
name: gateway-heartbeat-contracts-01
description: gateway-heartbeat 源码接口与集成边界 01：gateway/heartbeat 下 __init__.py 与 proxy.py（HeartbeatControllerProxy、HeartbeatServiceUnavailableError）的声明
metadata:
  scope: 只收 gateway/heartbeat 两个文件的静态声明；模块入口归 gateway-heartbeat-overview
---
# gateway-heartbeat 源码接口与集成边界 01

## 现状

- 本页逐文件说明这一源码模块声明的接口、类型与依赖。记录来自静态源码声明，不证明控制流、配置生效、外部服务可用或测试通过；功能语义与设计取舍沿上级功能页继续阅读。
- **`jiuwenswarm/gateway/heartbeat/__init__.py`**
- 源码对模块职责的说明：Gateway-side proxy for AgentServer-owned Heartbeat jobs.。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from .proxy import HeartbeatControllerProxy, HeartbeatServiceUnavailableErr`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/heartbeat/__init__.py#L1-L13)。
- **`jiuwenswarm/gateway/heartbeat/proxy.py`**
- 源码对模块职责的说明：Gateway proxy for the AgentServer-owned Heartbeat controller.。
- `HeartbeatServiceUnavailableError` 继承 `Exception`。
- `HeartbeatControllerProxy` 定义类型边界；方法入口：`__init__`, `list_jobs`, `get_meta`, `get_job`, `create_job`, `update_job`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import secrets`；`import time`；`from typing import Any`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/heartbeat/proxy.py#L1-L214)。

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/gateway-channels/gateway-heartbeat/source-contracts-01.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
