---
name: runtime-gateway-adapter-contracts-01
description: runtime-gateway-adapter 源码接口与集成边界 01：jiuwenswarm/server/runtime/gateway_adapter 下 __init__、base、config_adapter、harmonyos_adapter、memory_adapter、project_adapter、session_adapter、workspace_file_adapter 八个文件的静态声明
metadata:
  scope: 只收 gateway_adapter 目录八个文件的静态声明，不证明运行行为；入口说明归 runtime-gateway-adapter-overview
---
# runtime-gateway-adapter 源码接口与集成边界 01

## 现状

- 本页逐文件说明这一源码模块声明的接口、类型与依赖。记录来自静态源码声明，不证明控制流、配置生效、外部服务可用或测试通过；功能语义与设计取舍沿上级功能页继续阅读。
- **`jiuwenswarm/server/runtime/gateway_adapter/__init__.py`**
- 源码对模块职责的说明：Gateway 用户业务适配器层（AgentServer 侧）。。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`from importlib import import_module`；`from typing import Any`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/gateway_adapter/__init__.py#L1-L58)。
- **`jiuwenswarm/server/runtime/gateway_adapter/base.py`**
- 源码对模块职责的说明：适配器层协议底座：GatewayAdapter 基类与 AdapterRegistry 注册表。。
- `GatewayAdapter` 定义类型边界；方法入口：`handle`。
- `AdapterRegistry` 定义类型边界；方法入口：`__init__`, `register`, `get`, `contains`, `methods`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import logging`；`from typing import ClassVar`；`from jiuwenswarm.common.schema.agent import AgentRequest, AgentResponse`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/gateway_adapter/base.py#L1-L77)。
- **`jiuwenswarm/server/runtime/gateway_adapter/config_adapter.py`**
- 源码对模块职责的说明：Configuration-panel adapter.。
- `ConfigAdapter` 继承 `GatewayAdapter`；方法入口：`handle`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import sys`；`from typing import Any`；`from jiuwenswarm.common.config import resolve_env_vars`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/gateway_adapter/config_adapter.py#L1-L318)。
- **`jiuwenswarm/server/runtime/gateway_adapter/harmonyos_adapter.py`**
- 源码对模块职责的说明：HarmonyOSAdapter: TUI HarmonyOS DevEco bootstrap executed in AgentServer.。
- `HarmonyOSAdapter` 继承 `GatewayAdapter`；方法入口：`handle`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import logging`；`from jiuwenswarm.common.schema.agent import AgentRequest, AgentResponse`；`from jiuwenswarm.common.schema.message import ReqMethod`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/gateway_adapter/harmonyos_adapter.py#L1-L65)。
- **`jiuwenswarm/server/runtime/gateway_adapter/memory_adapter.py`**
- 源码对模块职责的说明：MemoryAdapter: execute TUI memory management in the user AgentServer.。
- `MemoryAdapter` 继承 `GatewayAdapter`；方法入口：`handle`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import logging`；`from typing import Any`；`from jiuwenswarm.agents.harness.common.memory_rpc import handle_memory_edit`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/gateway_adapter/memory_adapter.py#L1-L109)。
- **`jiuwenswarm/server/runtime/gateway_adapter/project_adapter.py`**
- 源码对模块职责的说明：ProjectAdapter: project-domain requests executed in AgentServer.。
- `ProjectAdapter` 继承 `GatewayAdapter`；方法入口：`__init__`, `handle`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import asyncio`；`import logging`；`import os`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/gateway_adapter/project_adapter.py#L1-L1302)。
- **`jiuwenswarm/server/runtime/gateway_adapter/session_adapter.py`**
- 源码对模块职责的说明：SessionAdapter：会话域用户业务适配器。。
- `SessionAdapter` 继承 `GatewayAdapter`；方法入口：`handle`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import asyncio`；`import logging`；`import time`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/gateway_adapter/session_adapter.py#L1-L529)。
- **`jiuwenswarm/server/runtime/gateway_adapter/workspace_file_adapter.py`**
- 源码对模块职责的说明：WorkspaceFileAdapter：工作区与文件域用户业务适配器。。
- `WorkspaceFileAdapter` 继承 `GatewayAdapter`；方法入口：`handle`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import asyncio`；`import base64`；`import logging`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/gateway_adapter/workspace_file_adapter.py#L1-L674)。

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/agent-server-runtime/runtime-gateway-adapter/source-contracts-01.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
