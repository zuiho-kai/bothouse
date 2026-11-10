---
name: personal-context-contracts-01
description: personal-context 源码接口与集成边界 01：jiuwenswarm/server/personal_context 下 __init__、error_messages、host_api（PersonalContextHostAPI）、ws_handler（handle_personal_context_request）四个文件的静态声明
metadata:
  scope: 只收personal_context 目录四个文件的静态声明，不证明运行行为；入口说明归 personal-context-overview
---
# personal-context 源码接口与集成边界 01

## 现状

- 本页逐文件说明这一源码模块声明的接口、类型与依赖。记录来自静态源码声明，不证明控制流、配置生效、外部服务可用或测试通过；功能语义与设计取舍沿上级功能页继续阅读。
- **`jiuwenswarm/server/personal_context/__init__.py`**
- 源码对模块职责的说明：JiuwenSwarm's in-process personal-context host boundary.。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from jiuwenswarm.server.personal_context.host_api import PersonalContextHos`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/personal_context/__init__.py#L1-L5)。
- **`jiuwenswarm/server/personal_context/error_messages.py`**
- 源码对模块职责的说明：Localized public errors; internal diagnostics never become display text.。
- 调用入口 `localize_error(error, language, reason)`；声明返回 `str`。
- 调用入口 `localize_payload(value, language)`；声明返回 `object`。
- 调用入口 `log_error(error)`；声明返回 `None`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import logging`；`import re`；`from collections.abc import Mapping`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/personal_context/error_messages.py#L1-L201)。
- **`jiuwenswarm/server/personal_context/host_api.py`**
- 源码对模块职责的说明：JiuwenSwarm's in-process owner of the embedded PersonalContext runtime.。
- `PersonalContextHostAPI` 定义类型边界；方法入口：`__init__`, `error_language`, `localize_error`, `configure`, `get_overview`, `get_runtime_config`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import asyncio`；`import contextlib`；`from copy import deepcopy`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/personal_context/host_api.py#L1-L2061)。
- **`jiuwenswarm/server/personal_context/ws_handler.py`**
- 源码对模块职责的说明：PersonalContext WebSocket request dispatch on JiuwenSwarm's existing E2A wire path.。
- 异步入口 `handle_personal_context_request(host, ws, request, send_lock, runtime_enabled_changed)`；声明返回 `None`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import asyncio`；`import logging`；`from collections.abc import Awaitable, Callable`。
- 模块级配置或常量名称：`PERSONAL_CONTEXT_REQUEST_METHODS`；实际值与使用条件见源码。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/personal_context/ws_handler.py#L1-L412)。

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/agent-server-runtime/personal-context/source-contracts-01.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
