---
name: runtime-agent-adapter-contracts-02
description: runtime-agent-adapter 源码接口 02：session_input、session_message_input、statusline_setup_agent、sysop_builder、task_tool_events、team_helpers、trusted_web_search、user_turn
metadata:
  scope: 只收 agent_adapter 后八个文件的接口记录；前十三个文件归 runtime-agent-adapter-contracts-01，规则归 runtime-agent-adapter-rules
---
# runtime-agent-adapter 源码接口与集成边界 02

## 现状

- 本页逐文件说明这一源码模块声明的接口、类型与依赖。记录来自静态源码声明，不证明控制流、配置生效、外部服务可用或测试通过；功能语义与设计取舍沿上级功能页继续阅读。
- **`jiuwenswarm/server/runtime/agent_adapter/session_input.py`**
- 源码对模块职责的说明：SDK adaptation for supplemental input, without starting another chat turn.。
- `QueuedSessionInput` 继承 `str`。
- 调用入口 `enqueue_bound_session_input(instance, target_round, request, sdk_request)`；声明返回 `QueuedSessionInput`。
- `SessionInputDeliveryUnknown` 继承 `RuntimeError`。
- 调用入口 `sdk_input_mode(params)`；声明返回 `InputDispatchMode / None`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`import asyncio`；`import time`；`from collections.abc import Mapping`；`from typing import Any`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/agent_adapter/session_input.py#L1-L292)。
- **`jiuwenswarm/server/runtime/agent_adapter/session_message_input.py`**
- 源码对模块职责的说明：Represent Host-delivered Agent messages at tool authority in model history.。
- 调用入口 `cross_session_model_messages(content, cross_session)`；声明返回 `list`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from hashlib import sha256`；`from uuid import uuid4`；`from openjiuwen.core.foundation.llm.schema.message import OPENJIUWEN_MESSAG`；`from openjiuwen.core.foundation.llm.schema.tool_call import ToolCall`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/agent_adapter/session_message_input.py#L1-L41)。
- **`jiuwenswarm/server/runtime/agent_adapter/statusline_setup_agent.py`**
- 源码对模块职责的说明：Built-in subagent used by the TUI ''/statusline'' command.。
- 调用入口 `build_statusline_setup_dispatch(description)`；声明返回 `str`。
- 调用入口 `build_statusline_setup_agent_config(model, workspace, sys_operation, language, max_iterations)`；声明返回 `SubAgentConfig`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import json`；`from typing import Any`；`from openjiuwen.core.single_agent import AgentCard`。
- 模块级配置或常量名称：`STATUSLINE_SETUP_AGENT_TYPE`, `DEFAULT_STATUSLINE_SETUP_MAX_ITERATIONS`, `STATUSLINE_SETUP_AGENT_DESCRIPTION`, `STATUSLINE_SETUP_SYSTEM_PROMPT`；实际值与使用条件见源码。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/agent_adapter/statusline_setup_agent.py#L1-L129)。
- **`jiuwenswarm/server/runtime/agent_adapter/sysop_builder.py`**
- 调用入口 `validate_sandbox_files_runtime(files)`；声明返回 `None`。
- 调用入口 `find_nested_files_conflict(path, bucket, files)`；声明返回 `str / None`。
- 调用入口 `build_yuanrong_sandbox_status_view()`；声明返回 `dict[str, Any]`。
- 调用入口 `build_filesystem_policy(files_runtime, project_dir, is_code_agent, startup_mode)`；声明返回 `tuple[dict[str, Any], list[dict[str, str]]]`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import hashlib`；`import logging`；`import os`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/agent_adapter/sysop_builder.py#L1-L996)。
- **`jiuwenswarm/server/runtime/agent_adapter/task_tool_events.py`**
- 源码对模块职责的说明：Emit subagent roster events for SDK TaskTool synchronous delegations.。
- 调用入口 `apply_task_tool_event_patch()`；声明返回 `None`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import logging`；`import time`；`from typing import Any`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/agent_adapter/task_tool_events.py#L1-L169)。
- **`jiuwenswarm/server/runtime/agent_adapter/team_helpers.py`**
- 源码对模块职责的说明：Team agent streaming helpers.。
- 调用入口 `bind_team_heartbeat_service(service)`；声明返回 `Token[Any / None]`。
- 调用入口 `reset_team_heartbeat_service(token)`；声明返回 `None`。
- 调用入口 `get_background_task_controller(session_id)`；声明返回 `BackgroundTaskController`。
- 调用入口 `classify_swarmflow_control_miss(channel_id, session_id, run_id)`；声明返回 `dict / None`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import asyncio`；`import inspect`；`import logging`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/agent_adapter/team_helpers.py#L1-L4411)。
- **`jiuwenswarm/server/runtime/agent_adapter/trusted_web_search.py`**
- 源码对模块职责的说明：Trusted URL provenance adapter for OpenJiuwen's free-search tool.。
- `TrustedWebFreeSearchTool` 继承 `WebFreeSearchTool`；方法入口：`invoke`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`from typing import Any`；`from openjiuwen.harness.tools import WebFreeSearchTool`；`from openjiuwen.harness.tools.web import free_search as openjiuwen_free_sea`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/agent_adapter/trusted_web_search.py#L1-L112)。
- **`jiuwenswarm/server/runtime/agent_adapter/user_turn.py`**
- 源码对模块职责的说明：One user turn and the single way it is rendered into an agent prompt.。
- `UserTurn` 定义类型边界；方法入口：`with_text`, `render`。
- 调用入口 `render_cross_session_history_content(content, cross_session, language)`；声明返回 `str`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import json`；`import logging`；`from dataclasses import dataclass, replace`。
- 模块级配置或常量名称：`TEAM_USER_TURN_KEY`；实际值与使用条件见源码。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/agent_adapter/user_turn.py#L1-L358)。

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/agent-server-runtime/runtime-agent-adapter/source-contracts-02.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
