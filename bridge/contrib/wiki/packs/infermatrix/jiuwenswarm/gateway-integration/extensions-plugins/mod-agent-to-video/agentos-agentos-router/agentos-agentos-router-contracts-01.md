---
name: agentos-agentos-router-contracts-01
description: agentos-agentos-router 源码接口与集成边界 01：extensions/agentos/agentos_router 十二个文件的声明（agent_manager、agentos_authenticator、config、extension、logutil、models、registry_client、router_client、ssh_relay、stale_cleanup、third_agent 等）
metadata:
  scope: 只收 agentos_router 目录的静态声明；入口说明与审查规则链接归 agentos-agentos-router-overview，JW-AGENTOS-REG-1a 规则正文归 agentos-agentos-router-rules，auth 目录声明归 agentos-auth-contracts-01
---
# agentos-agentos-router 源码接口与集成边界 01

## 现状

- 本页逐文件说明这一源码模块声明的接口、类型与依赖。记录来自静态源码声明，不证明控制流、配置生效、外部服务可用或测试通过；功能语义与设计取舍沿上级功能页继续阅读。
- **`jiuwenswarm/extensions/agentos/agentos_router/__init__.py`**
- 集成依赖（导入声明，不等于全部运行时依赖）：`from jiuwenswarm.extensions.agentos.agentos_router.agent_manager import BUI`；`from jiuwenswarm.extensions.agentos.agentos_router.extension import AgentOS`；`from jiuwenswarm.extensions.agentos.agentos_router.models import AgentInfo,`；
  - `from jiuwenswarm.extensions.agentos.agentos_router.registry_client import I`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/extensions/agentos/agentos_router/__init__.py#L1-L67)。
- **`jiuwenswarm/extensions/agentos/agentos_router/agent_manager.py`**
- 调用入口 `is_third_party_agent_type(agent_type)`；声明返回 `bool`。
- 调用入口 `normalize_agent_key_fields(raw)`；声明返回 `tuple[str, ...]`。
- `AgentCreatingTimeout` 继承 `TimeoutError`。
- `AgentDeleted` 继承 `RuntimeError`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import asyncio`；`import logging`；`import time`。
- 模块级配置或常量名称：`BUILTIN_AGENT_TYPE`, `SUPPORTED_AGENT_KEY_FIELDS`, `DEFAULT_AGENT_KEY_FIELDS`；实际值与使用条件见源码。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/extensions/agentos/agentos_router/agent_manager.py#L1-L603)。
- **`jiuwenswarm/extensions/agentos/agentos_router/agentos_authenticator.py`**
- `AgentOSAuthenticator` 继承 `CredentialAuthenticator`；方法入口：`__init__`, `authenticate`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`import logging`；`import httpx`；`from jiuwenswarm.extensions.agentos.agentos_router.logutil import log_agent`；`from jiuwenswarm.extensions.agentos.auth.credential_authenticator import Cr`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/extensions/agentos/agentos_router/agentos_authenticator.py#L1-L128)。
- **`jiuwenswarm/extensions/agentos/agentos_router/config.py`**
- `SshChannelEndpoint` 定义类型边界。
- `RouterConfig` 定义类型边界。
- 调用入口 `agentos_router_selected(config)`；声明返回 `bool`。
- 调用入口 `load_ssh_channel_endpoint(config)`；声明返回 `SshChannelEndpoint / None`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import logging`；`import os`；`from dataclasses import dataclass, replace`。
- 模块级配置或常量名称：`DEFAULT_AGENT_WORKSPACE_ROOT`, `SANDBOX_IDLE_TIMEOUT_ENV`, `DISCONNECT_CLEANUP_TIMEOUT_ENV`, `WAIT_RUNNING_TIMEOUT_ENV`, `WAIT_RUNNING_INTERVAL_ENV`, `PROBE_STARTUP_INITIAL_DELAY_ENV`, `PROBE_STARTUP_PERIOD_ENV`, `PROBE_STARTUP_TIMEOUT_ENV`；实际值与使用条件见源码。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/extensions/agentos/agentos_router/config.py#L1-L393)。
- **`jiuwenswarm/extensions/agentos/agentos_router/extension.py`**
- `AgentOSRouter` 继承 `AgentServerClientExtension, ThirdAgentExtension`；方法入口：`__init__`, `initialize`, `get_client`, `get_third_agent`, `set_key_issuer`, `shutdown`。
- 异步入口 `register_extensions(registry)`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`from jiuwenswarm.common.config import get_config`；`from jiuwenswarm.extensions.agentos.agentos_router.agent_manager import Age`；`from jiuwenswarm.extensions.agentos.agentos_router.agentos_authenticator im`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/extensions/agentos/agentos_router/extension.py#L1-L109)。
- **`jiuwenswarm/extensions/agentos/agentos_router/logutil.py`**
- 源码对模块职责的说明：Stable AgentOS log lines for grep / future RuntimeLogFormatter columns.。
- 调用入口 `agentos_extra(session_id, sandbox_id)`；声明返回 `dict[str, str]`。
- 调用入口 `format_agentos(event, **fields)`；声明返回 `str`。
- 调用入口 `log_agentos(logger, level, event, **fields)`；声明返回 `None`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import logging`；`from typing import Any`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/extensions/agentos/agentos_router/logutil.py#L1-L105)。
- **`jiuwenswarm/extensions/agentos/agentos_router/models.py`**
- `AgentStatus` 继承 `str, Enum`。
- `ImageInfo` 定义类型边界。
- `AgentInfo` 定义类型边界；方法入口：`copy`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import time`；`import uuid`；`from dataclasses import dataclass, field, replace`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/extensions/agentos/agentos_router/models.py#L1-L40)。
- **`jiuwenswarm/extensions/agentos/agentos_router/registry_client.py`**
- 源码对模块职责的说明：Gateway-side Agent OS registry SDK.。
- `RegistryConfig` 定义类型边界。
- `LaunchSpec` 定义类型边界；方法入口：`from_dict`。
- `InstanceRecord` 定义类型边界；方法入口：`from_dict`。
- 调用入口 `compute_backoff_delay(attempt, initial_delay, multiplier, max_delay)`；声明返回 `float`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import hashlib`；`import logging`；`from dataclasses import dataclass, field`。
- 模块级配置或常量名称：`KIND_THIRD_PARTY`, `KIND_JIUWEN`, `PENDING_INSTANCE_ADDRESS`；实际值与使用条件见源码。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/extensions/agentos/agentos_router/registry_client.py#L1-L875)。
- **`jiuwenswarm/extensions/agentos/agentos_router/router_client.py`**
- `UnsupportedAgentType` 继承 `ValueError`。
- `EphemeralKeyIssueError` 继承 `RuntimeError`。
- `AgentOSFileTransferError` 继承 `RuntimeError`；方法入口：`__init__`。
- 调用入口 `normalize_agent_file_upload_path(path, dir_prefix, user_id)`；声明返回 `str`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import asyncio`；`import logging`；`import os`。
- 模块级配置或常量名称：`USER_DIRECTORY_ENV_KEY`；实际值与使用条件见源码。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/extensions/agentos/agentos_router/router_client.py#L1-L3037)。
- **`jiuwenswarm/extensions/agentos/agentos_router/ssh_relay.py`**
- 源码对模块职责的说明：Southbound SSH relay into YuanRong agent instances.。
- `SshSouthConnectError` 继承 `Exception`；方法入口：`__init__`。
- 调用入口 `resolve_client_keys_dir(template, user_id)`；声明返回 `Path`。
- 调用入口 `list_client_key_paths(keys_dir)`；声明返回 `list[str]`。
- `YuanrongSshSettings` 定义类型边界。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import asyncio`；`import logging`；`import re`。
- 模块级配置或常量名称：`DEFAULT_SSH_PORT`, `DEFAULT_SSH_USER_TEMPLATE`, `DEFAULT_CLIENT_KEYS_DIR`；实际值与使用条件见源码。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/extensions/agentos/agentos_router/ssh_relay.py#L1-L535)。
- **`jiuwenswarm/extensions/agentos/agentos_router/stale_cleanup.py`**
- 源码对模块职责的说明：Startup clean-slate: list registry instances and destroy leftover sandboxes.。
- 异步入口 `cleanup_stale_sandboxes(yuanrong, registry, agent_manager, is_closed)`；声明返回 `int`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import logging`；`from collections.abc import Callable`；`from jiuwenswarm.extensions.agentos.agentos_router.agent_manager import Age`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/extensions/agentos/agentos_router/stale_cleanup.py#L1-L229)。
- **`jiuwenswarm/extensions/agentos/agentos_router/third_agent.py`**
- `AgentOSThirdAgent` 继承 `ThirdAgent`；方法入口：`__init__`, `normalize_agent_type`, `thirdagent_list`, `thirdagent_switch`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`from typing import TYPE_CHECKING, Any`；`from jiuwenswarm.extensions.agentos.agentos_router.agent_manager import Age`；`from jiuwenswarm.gateway.routing.third_agent import ThirdAgent`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/extensions/agentos/agentos_router/third_agent.py#L1-L51)。

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/extensions-plugins/agentos-agentos-router/source-contracts-01.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
