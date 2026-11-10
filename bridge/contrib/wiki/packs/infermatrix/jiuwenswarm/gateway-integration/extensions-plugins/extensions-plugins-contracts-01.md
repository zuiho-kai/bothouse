---
name: extensions-plugins-contracts-01
description: extensions-plugins 源码接口与集成边界 01：extensions/ 下 __init__、clawee、hook_event、hooks_context、types、yuanrong_frontend_client 各文件的声明接口、类型与导入依赖
metadata:
  scope: 只收 jiuwenswarm/extensions/ 顶层六个文件的静态声明记录；扩展框架行为归 jiuwenswarm-extensions，设计取舍归 extensions-plugins-design-tradeoffs
---
# extensions-plugins 源码接口与集成边界 01

## 现状

- 本页逐文件说明这一源码模块声明的接口、类型与依赖。记录来自静态源码声明，不证明控制流、配置生效、外部服务可用或测试通过；功能语义与设计取舍沿上级功能页继续阅读。
- **`jiuwenswarm/extensions/__init__.py`**
- 源码对模块职责的说明：Extension public surface with transport adapters loaded lazily.。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`from importlib import import_module`；`from typing import Any`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/extensions/__init__.py#L1-L48)。
- **`jiuwenswarm/extensions/clawee.py`**
- 源码对模块职责的说明：OpenYuanRong 函数入口 - clawee handler.。
- 调用入口 `payload_to_request(request)`；声明返回 `AgentRequest`。
- 调用入口 `to_json(msg)`；声明返回 `str`。
- 调用入口 `chunk_to_payload(chunk)`；声明返回 `str`。
- 调用入口 `response_to_payload(resp)`；声明返回 `str`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`import asyncio`；`import json`；`import threading`；`from concurrent.futures import Future`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/extensions/clawee.py#L1-L339)。
- **`jiuwenswarm/extensions/hook_event.py`**
- `GatewayHookEvents` 继承 `HookEventBase`。
- `AgentServerHookEvents` 继承 `HookEventBase`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from jiuwenswarm.common.schema.event_base import HookEventBase`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/extensions/hook_event.py#L1-L30)。
- **`jiuwenswarm/extensions/hooks_context.py`**
- `MemoryHookContext` 定义类型边界；方法入口：`to_dict`。
- `GatewayChatHookContext` 定义类型边界；方法入口：`to_dict`。
- `AgentServerChatHookContext` 定义类型边界；方法入口：`to_dict`。
- `SystemPromptHookContext` 定义类型边界；方法入口：`to_dict`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`from dataclasses import asdict, dataclass, field`；`from typing import Any`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/extensions/hooks_context.py#L1-L60)。
- **`jiuwenswarm/extensions/types.py`**
- `ExtensionMetadata` 定义类型边界。
- `ExtensionConfig` 定义类型边界。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`from dataclasses import dataclass`；`from typing import Any`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/extensions/types.py#L1-L26)。
- **`jiuwenswarm/extensions/yuanrong_frontend_client.py`**
- 源码对模块职责的说明：YuanrongFrontendAgentClient - openYuanRong Frontend HTTP 客户端.。
- 调用入口 `normalize_trace_id(value)`；声明返回 `str`。
- 调用入口 `bind_southbound_trace_id(value)`；声明返回 `str`。
- 调用入口 `current_southbound_trace_id()`；声明返回 `str`。
- 调用入口 `clear_southbound_trace_id()`；声明返回 `None`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import asyncio`；`import json`；`import logging`。
- 模块级配置或常量名称：`TRACE_ID_HEADER`, `DEFAULT_RUNTIME_PROBE_SETTINGS`, `DEFAULT_THIRD_AGENT_PROBE_SETTINGS`；实际值与使用条件见源码。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/extensions/yuanrong_frontend_client.py#L1-L2028)。

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/extensions-plugins/source-contracts-01.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
