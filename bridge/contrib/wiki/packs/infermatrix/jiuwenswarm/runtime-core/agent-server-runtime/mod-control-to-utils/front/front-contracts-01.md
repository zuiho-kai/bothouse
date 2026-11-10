---
name: front-contracts-01
description: front 源码接口与集成边界 01：jiuwenswarm/server/front 下 __init__、admission、connection、event_forwarder、protocol、request_registry、router、server 八个模块的静态声明
metadata:
  scope: 只收 front 目录八个模块的静态声明，不证明运行行为；入口说明归 front-overview
---
# front 源码接口与集成边界 01

## 现状

- 本页逐文件说明这一源码模块声明的接口、类型与依赖。记录来自静态源码声明，不证明控制流、配置生效、外部服务可用或测试通过；功能语义与设计取舍沿上级功能页继续阅读。
- **`jiuwenswarm/server/front/__init__.py`**
- 源码对模块职责的说明：Lightweight AgentServer Front: transport, protocol, router, readiness.。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`from typing import Any`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/front/__init__.py#L1-L17)。
- **`jiuwenswarm/server/front/admission.py`**
- 源码对模块职责的说明：Bounded queue for execution requests while Runtime is warming.。
- `RuntimeBackend` 继承 `Protocol`；方法入口：`dispatch_parsed_request`, `attach_gateway_connection`, `on_gateway_disconnect`。
- `ExecutionAdmission` 定义类型边界；方法入口：`__init__`, `backend`, `registry`, `attach_backend`, `detach_backend`, `dispatch`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import asyncio`；`import logging`；`from typing import Any, Protocol`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/front/admission.py#L1-L250)。
- **`jiuwenswarm/server/front/connection.py`**
- 源码对模块职责的说明：WebSocket connection accept, origin check, and per-connection dispatch.。
- 异步入口 `process_handshake(*args)`；声明返回 `Any`。
- `ConnectionHandler` 定义类型边界；方法入口：`__init__`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import asyncio`；`import logging`；`from typing import Any`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/front/connection.py#L1-L145)。
- **`jiuwenswarm/server/front/event_forwarder.py`**
- 源码对模块职责的说明：Front-owned Gateway stream writer.。
- `EventForwarder` 定义类型边界；方法入口：`__init__`, `attach`, `detach`, `current_ws`, `current_send_lock`, `send`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import asyncio`；`import logging`；`from typing import Any`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/front/event_forwarder.py#L1-L53)。
- **`jiuwenswarm/server/front/protocol.py`**
- 源码对模块职责的说明：Front-safe E2A parse/encode helpers. No OpenJiuwen or Agent Runtime imports.。
- 调用入口 `payload_to_request(data)`；声明返回 `AgentRequest`。
- 调用入口 `parse_raw_message(raw)`；声明返回 `AgentRequest / dict[str, Any]`。
- 调用入口 `encode_response(response, response_id)`；声明返回 `dict[str, Any]`。
- 调用入口 `encode_chunk(chunk, response_id, sequence)`；声明返回 `dict[str, Any]`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import json`；`import logging`；`from typing import Any`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/front/protocol.py#L1-L161)。
- **`jiuwenswarm/server/front/request_registry.py`**
- 源码对模块职责的说明：Front-owned in-flight request table.。
- `TrackedRequest` 定义类型边界；方法入口：`request_id`, `session_id`。
- `RequestRegistry` 定义类型边界；方法入口：`__init__`, `register`, `mark_dispatched`, `complete`, `cancel`, `cancel_session`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import asyncio`；`import time`；`from dataclasses import dataclass, field`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/front/request_registry.py#L1-L101)。
- **`jiuwenswarm/server/front/router.py`**
- 源码对模块职责的说明：Method router: control-plane services vs execution admission.。
- 调用入口 `is_control_method(request)`；声明返回 `bool`。
- `MethodRouter` 定义类型边界；方法入口：`__init__`, `dispatch`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import asyncio`；`import logging`；`from typing import Any`。
- 模块级配置或常量名称：`CONTROL_METHODS`；实际值与使用条件见源码。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/front/router.py#L1-L328)。
- **`jiuwenswarm/server/front/server.py`**
- 源码对模块职责的说明：Lightweight AgentServer Front WebSocket listener.。
- `AgentServerFront` 定义类型边界；方法入口：`__init__`, `host`, `port`, `attach_runtime_backend`, `start`, `begin_drain`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import logging`；`from typing import Any`；`from jiuwenswarm.common.ws_limits import AGENT_WS_MAX_MESSAGE_BYTES`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/front/server.py#L1-L119)。

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/agent-server-runtime/front/source-contracts-01.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
