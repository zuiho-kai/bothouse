---
name: team-a2x-contracts-01
description: team-a2x 源码接口与集成边界 01：harness/team/a2x 的 a2x_registry_runtime 与 client 子包（_internal、async_client、client、errors、models、ownership、transport）声明
metadata:
  scope: 只收 harness/team/a2x 下的静态声明；team 根目录文件归 team-contracts-01
---
# team-a2x 源码接口与集成边界 01

## 现状

- 本页逐文件说明这一源码模块声明的接口、类型与依赖。记录来自静态源码声明，不证明控制流、配置生效、外部服务可用或测试通过；功能语义与设计取舍沿上级功能页继续阅读。
- **`jiuwenswarm/agents/harness/team/a2x/a2x_registry_runtime.py`**
- 源码对模块职责的说明：Small runtime helpers for A2X registry integration.。
- `ReservedBlankAgent` 定义类型边界；方法入口：`release`, `close`。
- 调用入口 `build_teammate_agent_card(member_name)`；声明返回 `dict[str, Any]`。
- 调用入口 `resolve_a2x_config(config_base)`；声明返回 `dict[str, Any]`。
- 异步入口 `init_a2x_client(config_base)`；声明返回 `tuple[Any, dict[str, Any]]`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import asyncio`；`import logging`；`import re`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/team/a2x/a2x_registry_runtime.py#L1-L548)。
- **`jiuwenswarm/agents/harness/team/a2x/client/__init__.py`**
- 源码对模块职责的说明：A2X Registry client SDK.。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from .async_client import AsyncA2XRegistryClient`；`from .client import A2XRegistryClient`；`from .errors import A2XConnectionError, A2XError, A2XHTTPError, NotFoundErr`；`from .models import AgentDetail, DatasetCreateResponse, DatasetDeleteRespon`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/team/a2x/client/__init__.py#L1-L60)。
- **`jiuwenswarm/agents/harness/team/a2x/client/_internal.py`**
- 源码对模块职责的说明：Shared helpers used by the sync and async client classes.。
- 调用入口 `dataset_path(dataset)`；声明返回 `str`。
- 调用入口 `services_path(dataset)`；声明返回 `str`。
- 调用入口 `service_path(dataset, service_id)`；声明返回 `str`。
- 调用入口 `a2a_register_path(dataset)`；声明返回 `str`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`from pathlib import Path`；`from typing import Any, Final`；`from urllib.parse import quote`。
- 模块级配置或常量名称：`UNSET`, `DEFAULT_FORMATS`, `DEFAULT_EMBEDDING_MODEL`, `DEFAULT_OWNERSHIP_FILE`, `STATUS_FIELD`, `STATUS_ONLINE`, `STATUS_BUSY`, `STATUS_OFFLINE`；实际值与使用条件见源码。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/team/a2x/client/_internal.py#L1-L304)。
- **`jiuwenswarm/agents/harness/team/a2x/client/async_client.py`**
- 源码对模块职责的说明：Asynchronous client entry point.。
- `AsyncA2XRegistryClient` 定义类型边界；方法入口：`__init__`, `base_url`, `timeout`, `api_key`, `aclose`, `create_dataset`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import asyncio`；`import warnings`；`from pathlib import Path`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/team/a2x/client/async_client.py#L1-L393)。
- **`jiuwenswarm/agents/harness/team/a2x/client/client.py`**
- 源码对模块职责的说明：Synchronous client entry point.。
- `A2XRegistryClient` 定义类型边界；方法入口：`__init__`, `base_url`, `timeout`, `api_key`, `close`, `create_dataset`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`from pathlib import Path`；`from typing import Any, Literal`；`import warnings`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/team/a2x/client/client.py#L1-L530)。
- **`jiuwenswarm/agents/harness/team/a2x/client/errors.py`**
- 源码对模块职责的说明：Exception hierarchy for the A2X Registry client SDK.。
- `A2XError` 继承 `Exception`；方法入口：`__init__`。
- `A2XConnectionError` 继承 `A2XError`。
- `A2XHTTPError` 继承 `A2XError`。
- `NotFoundError` 继承 `A2XHTTPError`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`from typing import Any`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/team/a2x/client/errors.py#L1-L73)。
- **`jiuwenswarm/agents/harness/team/a2x/client/models.py`**
- 源码对模块职责的说明：Response dataclasses for the A2X Registry client SDK.。
- `DatasetCreateResponse` 继承 `_FromDictMixin`。
- `DatasetDeleteResponse` 继承 `_FromDictMixin`。
- `RegisterResponse` 继承 `_FromDictMixin`。
- `PatchResponse` 继承 `_FromDictMixin`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import logging`；`from dataclasses import dataclass, field, fields`；`from typing import Any, TypeVar`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/team/a2x/client/models.py#L1-L168)。
- **`jiuwenswarm/agents/harness/team/a2x/client/ownership.py`**
- 源码对模块职责的说明：Persistent tracker for services registered by this client.。
- `OwnershipStore` 定义类型边界；方法入口：`__init__`, `contains`, `add`, `remove`, `remove_dataset`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import json`；`import os`；`import sys`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/team/a2x/client/ownership.py#L1-L225)。
- **`jiuwenswarm/agents/harness/team/a2x/client/transport.py`**
- 源码对模块职责的说明：Thin httpx wrappers — the SDK's only network exit.。
- `HTTPTransport` 定义类型边界；方法入口：`__init__`, `request`, `close`。
- `AsyncHTTPTransport` 定义类型边界；方法入口：`__init__`, `request`, `aclose`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`from typing import Any, Literal`；`import httpx`；`from .errors import A2XConnectionError, A2XHTTPError, NotFoundError, Server`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/team/a2x/client/transport.py#L1-L134)。

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/agents-team/team-a2x/source-contracts-01.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
