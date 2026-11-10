---
name: runtime-agent-adapter-contracts-01
description: runtime-agent-adapter 源码接口 01：agent_adapter 前十三个文件（agent_adapters、browser_runtime_security、code_agent_rail、permission_continuation、permission_dispatch、sensitive_answers 等）的声明与导入依赖
metadata:
  scope: 只收 agent_adapter 前十三个文件的接口记录；session_input 等后八个文件归 runtime-agent-adapter-contracts-02，规则归 runtime-agent-adapter-rules
---
# runtime-agent-adapter 源码接口与集成边界 01

## 现状

- 本页逐文件说明这一源码模块声明的接口、类型与依赖。记录来自静态源码声明，不证明控制流、配置生效、外部服务可用或测试通过；功能语义与设计取舍沿上级功能页继续阅读。
- **`jiuwenswarm/server/runtime/agent_adapter/agent_adapters.py`**
- 源码对模块职责的说明：Unified adapter protocol for JiuWenSwarm SDK backends.。
- `AgentAdapter` 继承 `Protocol`；方法入口：`create_instance`, `reload_agent_config`, `process_message_impl`, `process_message_stream_impl`, `process_interrupt`, `handle_user_answer`。
- 调用入口 `resolve_sdk_choice()`；声明返回 `str`。
- 调用入口 `create_adapter(sdk, mode)`；声明返回 `AgentAdapter`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import logging`；`import os`；`from typing import Any, AsyncIterator, Protocol, runtime_checkable`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/agent_adapter/agent_adapters.py#L1-L159)。
- **`jiuwenswarm/server/runtime/agent_adapter/browser_runtime_network_guard.js`**
- 源码声明的类型、组件或调用边界：`INTERNAL_HOSTS`, `METADATA_HOSTS`, `PUBLIC_SUFFIX_ONLY_HOSTS`, `context`, `guardKey`, `isAllowedRequestUrl`, `parsed`, `host`；这是词法声明索引，不把局部变量当成对外导出 API。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/agent_adapter/browser_runtime_network_guard.js#L1-L67)。
- **`jiuwenswarm/server/runtime/agent_adapter/browser_runtime_security.py`**
- 源码对模块职责的说明：Fail-closed security profile for the current local Playwright MCP runtime.。
- `BrowserRuntimeSecurityProfile` 定义类型边界。
- 调用入口 `apply_browser_runtime_security_profile(mcp_cfg)`；声明返回 `tuple[McpServerConfig, BrowserRuntimeSecurityProfile]`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import hashlib`；`import os`；`import re`。
- 模块级配置或常量名称：`GUARD_PROVIDER`, `GUARD_VERSION`, `GUARD_INIT_PAGE_PATH`, `GUARD_SHA256`；实际值与使用条件见源码。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/agent_adapter/browser_runtime_security.py#L1-L187)。
- **`jiuwenswarm/server/runtime/agent_adapter/code_agent_rail.py`**
- 源码对模块职责的说明：CodeAgentRail — 管理 /agents 创建的自定义子智能体。。
- `AgentTool` 继承 `Tool`；方法入口：`__init__`, `invoke`, `stream`。
- `CodeAgentRail` 继承 `DeepAgentRail`；方法入口：`__init__`, `init`, `uninit`, `set_workspace_dir`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import asyncio`；`import uuid`；`from pathlib import Path`。
- 模块级配置或常量名称：`DISALLOWED_FOR_SUBAGENTS`, `TOOL_GROUPS`；实际值与使用条件见源码。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/agent_adapter/code_agent_rail.py#L1-L454)。
- **`jiuwenswarm/server/runtime/agent_adapter/evolution_slash.py`**
- 源码对模块职责的说明：Rail-independent handlers for active Skill evolution slash commands.。
- `EvolutionSlashContext` 定义类型边界。
- 异步入口 `handle_evolution_slash_command(query, context)`；声明返回 `dict[str, Any] / None`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import logging`；`from dataclasses import dataclass`；`from typing import Any`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/agent_adapter/evolution_slash.py#L1-L455)。
- **`jiuwenswarm/server/runtime/agent_adapter/interface.py`**
- 源码对模块职责的说明：JiuWenSwarm Facade - 统一入口与 SDK 适配层.。
- 调用入口 `compute_chat_send_mcp_needed(params)`；声明返回 `list[str]`。
- 调用入口 `restore_chat_send_equipment_params(session_id, params)`；声明返回 `dict[str, Any]`。
- 调用入口 `is_external_user_authored_dispatch(params, channel_id, request_method, metadata)`；声明返回 `bool`。
- 调用入口 `build_user_prompt(content, files, channel, language, trusted_dirs, metadata, skills, origin_kind)`；声明返回 `str`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import asyncio`；`from contextlib import aclosing`；`from copy import deepcopy`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/agent_adapter/interface.py#L1-L5286)。
- **`jiuwenswarm/server/runtime/agent_adapter/output_handoff.py`**
- 源码对模块职责的说明：Host-owned output drain barrier, independent of Core's private lease fields.。
- `OutputHandoff` 定义类型边界；方法入口：`__init__`, `wait`, `close`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import asyncio`；`from typing import Any`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/agent_adapter/output_handoff.py#L1-L47)。
- **`jiuwenswarm/server/runtime/agent_adapter/permission_continuation.py`**
- 源码对模块职责的说明：OpenJiuwen permission-continuation operations, without a Host adapter owner.。
- 调用入口 `prepare_permission_wrappers(loop_session, queue, answer)`；声明返回 `tuple[RootPermissionWrapperResume, ...]`。
- 异步入口 `discard_permission_continuation(instance, target_sid, loop_session_id, frozen_keys)`；声明返回 `bool`。
- 调用入口 `validate_manual_resume(loop_session, query)`；声明返回 `None`。
- 调用入口 `prepare_nonpermission_resume(loop_session, inputs, query, root_session_id)`；声明返回 `dict[str, Any]`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import logging`；`from collections.abc import Iterator, Mapping`；`from typing import Any`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/agent_adapter/permission_continuation.py#L1-L284)。
- **`jiuwenswarm/server/runtime/agent_adapter/permission_dispatch.py`**
- 源码对模块职责的说明：Root approval dispatch transactions; the queue alone owns permission cards.。
- `RootPermissionDispatchHandoff` 定义类型边界。
- `RootPermissionDispatch` 定义类型边界；方法入口：`__init__`, `prepare_resume`, `has_live`, `acquire`, `abort_preparation`, `publish_cutover`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import asyncio`；`from collections.abc import Awaitable, Callable, MutableMapping`；`from dataclasses import dataclass`。
- 模块级配置或常量名称：`ROOT_PERMISSION_ANSWER_KEY`, `ROOT_PERMISSION_HANDOFF_KEY`；实际值与使用条件见源码。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/agent_adapter/permission_dispatch.py#L1-L267)。
- **`jiuwenswarm/server/runtime/agent_adapter/permission_rail_group.py`**
- 源码对模块职责的说明：One permission rail recipe for cold installation and session replacement.。
- `PermissionRailGroup` 定义类型边界；方法入口：`rails`, `validate_composition`, `verify`。
- 调用入口 `build_permission_group(config, permission_builder, permission_inputs, queue, answer_claimed, sandboxed, language)`；声明返回 `PermissionRailGroup`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from collections.abc import Callable`；`from dataclasses import dataclass`；`from typing import Any`；`from openjiuwen.harness.rails.security.tool_security_rail import Permission`。
- 模块级配置或常量名称：`PERMISSION_RAIL_TYPES`, `PERMISSION_GROUP_TYPES`；实际值与使用条件见源码。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/agent_adapter/permission_rail_group.py#L1-L122)。
- **`jiuwenswarm/server/runtime/agent_adapter/permission_runtime_state.py`**
- 源码对模块职责的说明：Session permission installation state; the caller owns SDK rails and locks.。
- `SessionPermissionState` 定义类型边界；方法入口：`stage_pending_permission_capture`, `clear_pending_permission`, `begin_permission_isolation`, `updating`, `publish`, `track_cleanup`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`from contextlib import contextmanager`；`from dataclasses import dataclass, field`；`from typing import Any`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/agent_adapter/permission_runtime_state.py#L1-L56)。
- **`jiuwenswarm/server/runtime/agent_adapter/recap_prompts.py`**
- 源码对模块职责的说明：/recap 命令的 prompt 模板与常量。
- 调用入口 `build_recap_prompt(memory, language, current_mode)`；声明返回 `str`。
- 模块级配置或常量名称：`RECENT_MESSAGE_WINDOW`；实际值与使用条件见源码。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/agent_adapter/recap_prompts.py#L1-L99)。
- **`jiuwenswarm/server/runtime/agent_adapter/sensitive_answers.py`**
- 源码对模块职责的说明：Redact credential answers before durable chat-history storage.。
- 调用入口 `redact_sensitive_answers(value)`；声明返回 `Any`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`from copy import deepcopy`；`from typing import Any`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/agent_adapter/sensitive_answers.py#L1-L43)。

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/agent-server-runtime/runtime-agent-adapter/source-contracts-01.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
