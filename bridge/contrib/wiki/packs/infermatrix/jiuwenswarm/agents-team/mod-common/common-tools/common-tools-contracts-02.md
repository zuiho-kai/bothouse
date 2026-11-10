---
name: common-tools-contracts-02
description: common-tools 源码接口与集成边界 02：mcp_toolkits.py、memory_tools.py、multi_session_toolkits.py、pdf_tools.py、search_tools.py、send_file_to_user.py 等 13 个模块
metadata:
  scope: 只收 common/tools 下 mcp_toolkits.py 至 todo_toolkits.py 共 13 个源码文件的静态声明（接口、类型、依赖与源码依据链接）；同目录其余契约页是 common-tools-contracts-01、common-tools-contracts-03、common-tools-contracts-04、common-tools-contracts-05
---
# common-tools 源码接口与集成边界 02

## 现状

- 本页逐文件说明这一源码模块声明的接口、类型与依赖。记录来自静态源码声明，不证明控制流、配置生效、外部服务可用或测试通过；功能语义与设计取舍沿上级功能页继续阅读。
- **`jiuwenswarm/agents/harness/common/tools/mcp_toolkits.py`**
- 源码对模块职责的说明：MCP toolkit aggregator for openjiuwen tools.。
- 调用入口 `track_mcp_search_tools(ability_manager)`；声明返回 `None`。
- 调用入口 `refresh_mcp_paid_search_tools()`；声明返回 `None`。
- 调用入口 `get_mcp_tools()`；声明返回 `list[Tool]`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import os`；`from weakref import WeakSet`；`from openjiuwen.core.foundation.tool import Tool`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/mcp_toolkits.py#L1-L81)。
- **`jiuwenswarm/agents/harness/common/tools/memory_tools.py`**
- 源码对模块职责的说明：Memory tools for JiuWenSwarm - Using @tool decorator for openjiuwen.。
- 调用入口 `set_group_chat_mode(enabled)`；声明返回 `contextvars.Token`。
- 调用入口 `is_group_chat_mode()`；声明返回 `bool`。
- 调用入口 `set_global_memory_manager(manager, workspace_dir, settings, agent_id)`。
- 异步入口 `init_memory_manager_async(workspace_dir, agent_id)`；声明返回 `Optional[MemoryIndexManager]`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`import contextvars`；`import logging`；`import os`；`import re`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/memory_tools.py#L1-L536)。
- **`jiuwenswarm/agents/harness/common/tools/multi_session_toolkits.py`**
- 源码对模块职责的说明：Session Toolkit 生命周期：Agent创建新session开始，到所有session协程结束。
- `Status` 继承 `str, Enum`。
- `SessionTask` 继承 `BaseModel`。
- `MultiSessionToolkit` 定义类型边界；方法入口：`__init__`, `get_sub_agent`, `notify`, `create_new_sessions`, `cancel_session`, `list_all_sessions`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import asyncio`；`import json`；`import logging`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/multi_session_toolkits.py#L1-L508)。
- **`jiuwenswarm/agents/harness/common/tools/pdf_tools.py`**
- 源码对模块职责的说明：Page-level PDF reading tool.。
- `ReadPdfRequest` 定义类型边界。
- 异步入口 `read_pdf(pdf_path, pages, max_chars, **kwargs)`；声明返回 `str`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import asyncio`；`import logging`；`from dataclasses import dataclass`。
- 模块级配置或常量名称：`DEFAULT_MAX_CHARS`；实际值与使用条件见源码。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/pdf_tools.py#L1-L275)。
- **`jiuwenswarm/agents/harness/common/tools/search_tools.py`**
- 源码对模块职责的说明：Neutral structured search providers and result renderers.。
- 调用入口 `normalize_search_max_results(value)`；声明返回 `int`。
- 调用入口 `run_free_search_structured(query, max_results, timeout_seconds)`；声明返回 `tuple[str, list[dict[str, str]]]`。
- 调用入口 `render_free_search_result(query, engine_used, rows)`；声明返回 `str`。
- 调用入口 `configured_paid_search_providers()`；声明返回 `list[str]`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import asyncio`；`import base64`；`import os`。
- 模块级配置或常量名称：`DEFAULT_SEARCH_MAX_RESULTS`, `MIN_SEARCH_MAX_RESULTS`, `MAX_SEARCH_MAX_RESULTS`；实际值与使用条件见源码。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/search_tools.py#L1-L610)。
- **`jiuwenswarm/agents/harness/common/tools/send_file_to_user.py`**
- 源码对模块职责的说明：Send File Toolkit。
- 调用入口 `looks_like_skill_package(path)`；声明返回 `bool`。
- 调用入口 `clear_sent_files_for_session(session_id)`；声明返回 `None`。
- `SendFileToolkit` 定义类型边界；方法入口：`__init__`, `update_runtime_context`, `send_file`, `get_tools`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import asyncio`；`import copy`；`import logging`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/send_file_to_user.py#L1-L832)。
- **`jiuwenswarm/agents/harness/common/tools/session_messaging_toolkit.py`**
- 源码对模块职责的说明：Agent tools for discovering and messaging other product Sessions.。
- `SessionMessagingRoute` 定义类型边界；方法入口：`source_for_call`, `source_for_list`, `to_wire`。
- 调用入口 `bind_session_messaging_route(session_id, request_id, user_id, cross_session)`；声明返回 `Token[SessionMessagingRoute / None]`。
- 调用入口 `reset_session_messaging_route(token)`；声明返回 `None`。
- 调用入口 `current_session_messaging_route()`；声明返回 `SessionMessagingRoute / None`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import hashlib`；`import json`；`import logging`。
- 模块级配置或常量名称：`SESSION_MESSAGING_ROUTE_EXTRA_KEY`；实际值与使用条件见源码。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/session_messaging_toolkit.py#L1-L613)。
- **`jiuwenswarm/agents/harness/common/tools/skill_retrieval_toolkits.py`**
- 源码对模块职责的说明：JiuwenSwarm adaptation for Symphony's DCI-compatible Skill discovery.。
- 调用入口 `is_valid_skill_retrieval_session_profile(profile)`；声明返回 `bool`。
- 调用入口 `skill_sources_from_manager(manager)`；声明返回 `dict[str, str]`。
- 调用入口 `is_skill_retrieval_enabled(config_base)`；声明返回 `bool`。
- 调用入口 `is_skill_retrieval_index_enabled(config_base)`；声明返回 `bool`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import os`；`import logging`；`from collections.abc import Callable, Iterable, Mapping, Sequence`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/skill_retrieval_toolkits.py#L1-L651)。
- **`jiuwenswarm/agents/harness/common/tools/skill_toolkits.py`**
- 源码对模块职责的说明：面向 agent 的 skill 管理工具封装。。
- `SkillToolkit` 定义类型边界；方法入口：`__init__`, `search_skill`, `install_skill`, `uninstall_skill`, `get_tools`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import asyncio`；`import hashlib`；`import logging`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/skill_toolkits.py#L1-L902)。
- **`jiuwenswarm/agents/harness/common/tools/ssl_config.py`**
- 源码对模块职责的说明：Shared SSL verification configuration for HTTP tools.。
- 调用入口 `get_ssl_verify()`；声明返回 `bool`。
- 调用入口 `get_requests_verify()`；声明返回 `bool`。
- 调用入口 `get_insecure_ssl_context()`；声明返回 `ssl.SSLContext`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import os`；`import ssl`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/ssl_config.py#L1-L35)。
- **`jiuwenswarm/agents/harness/common/tools/symphony_toolkits.py`**
- 源码对模块职责的说明：Agent-facing Symphony tools.。
- `SymphonyToolkit` 定义类型边界；方法入口：`__init__`, `graph_status`, `refresh_graph`, `plan`, `is_enabled`, `get_tools`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import asyncio`；`import json`；`import logging`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/symphony_toolkits.py#L1-L454)。
- **`jiuwenswarm/agents/harness/common/tools/todo_compat.py`**
- 源码对模块职责的说明：Compatibility shims for OpenJiuWen todo tools.。
- `CompatibleTodoModifyTool` 继承 `_OpenJiuWenTodoModifyTool`。
- 调用入口 `install_todo_modify_compat_patch()`；声明返回 `None`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`from typing import Any`；`from openjiuwen.core.common.exception.codes import StatusCode`；`from openjiuwen.core.common.exception.errors import build_error`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/todo_compat.py#L1-L94)。
- **`jiuwenswarm/agents/harness/common/tools/todo_toolkits.py`**
- 源码对模块职责的说明：Todo toolkit for agent task tracking.。
- `TaskStatus` 继承 `str, Enum`。
- `TodoTask` 继承 `BaseModel`。
- `TodoToolkit` 定义类型边界；方法入口：`__init__`, `todo_create`, `todo_complete`, `todo_insert`, `todo_remove`, `todo_list`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import os`；`import threading`；`from enum import Enum`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/todo_toolkits.py#L1-L367)。

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/agents-team/common-tools/source-contracts-02.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
