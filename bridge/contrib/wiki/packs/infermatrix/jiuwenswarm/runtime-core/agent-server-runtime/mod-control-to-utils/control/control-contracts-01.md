---
name: control-contracts-01
description: control 源码接口与集成边界 01：jiuwenswarm/server/control 下 a2ui_config、config_service、health_service、history_service、methods、project_service、responses、session_service 八个模块的静态声明
metadata:
  scope: 只收 control 目录八个模块的静态声明，不证明运行行为；repositories 与 store 子目录模块归 control-repositories-contracts-01、control-store-contracts-01，入口说明归 control-overview
---
# control 源码接口与集成边界 01

## 现状

- 本页逐文件说明这一源码模块声明的接口、类型与依赖。记录来自静态源码声明，不证明控制流、配置生效、外部服务可用或测试通过；功能语义与设计取舍沿上级功能页继续阅读。
- **`jiuwenswarm/server/control/a2ui_config.py`**
- 源码对模块职责的说明：Front-safe A2UI switches. Parses a config dict and env; no Runtime imports.。
- `A2UIConfig` 定义类型边界。
- 调用入口 `get_a2ui_config(config)`；声明返回 `A2UIConfig`。
- 调用入口 `is_a2ui_enabled(config)`；声明返回 `bool`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import os`；`from dataclasses import dataclass`；`from typing import Any`。
- 模块级配置或常量名称：`SUPPORTED_A2UI_PROTOCOL_VERSIONS`；实际值与使用条件见源码。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/control/a2ui_config.py#L1-L73)。
- **`jiuwenswarm/server/control/config_service.py`**
- 源码对模块职责的说明：Config query Control Service.。
- 调用入口 `get_panel()`；声明返回 `dict[str, Any]`。
- 异步入口 `handle_config_request(request)`；声明返回 `AgentResponse`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import json`；`import logging`；`import os`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/control/config_service.py#L1-L512)。
- **`jiuwenswarm/server/control/health_service.py`**
- 源码对模块职责的说明：Health and readiness Control Service owned by Front.。
- 调用入口 `handle_readiness(request, readiness)`；声明返回 `AgentResponse`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`from jiuwenswarm.common.schema.agent import AgentRequest, AgentResponse`；`from jiuwenswarm.common.schema.message import ReqMethod`；`from jiuwenswarm.server.control.methods import CONTROL_HEALTH_METHODS`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/control/health_service.py#L1-L25)。
- **`jiuwenswarm/server/control/history_service.py`**
- 源码对模块职责的说明：History query Control Service. Reads session history files only.。
- 调用入口 `load_history_page(session_id, page_idx, subagent_id)`；声明返回 `dict[str, Any] / None`。
- 调用入口 `load_history_cursor_page(session_id, cursor, limit, subagent_id)`；声明返回 `dict[str, Any]`。
- 调用入口 `load_history_todo_snapshot(session_id)`；声明返回 `list[dict[str, Any]]`。
- 调用入口 `sanitize_history_messages(messages)`；声明返回 `list[dict[str, Any]]`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import math`；`from typing import Any`；`from jiuwenswarm.common.mode_matrix import is_team_mode`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/control/history_service.py#L1-L239)。
- **`jiuwenswarm/server/control/methods.py`**
- 源码对模块职责的说明：Control-plane method sets. Import-safe for Front classification.。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`from jiuwenswarm.common.schema.message import ReqMethod`。
- 模块级配置或常量名称：`CONTROL_HEALTH_METHODS`, `CONTROL_SESSION_METHODS`, `CONTROL_PROJECT_METHODS`, `CONTROL_CONFIG_METHODS`, `CONTROL_HISTORY_METHODS`, `ALL_CONTROL_METHODS`；实际值与使用条件见源码。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/control/methods.py#L1-L52)。
- **`jiuwenswarm/server/control/project_service.py`**
- 源码对模块职责的说明：Project query Control Service. Uses the project state store.。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`from jiuwenswarm.server.control.repositories.project_repository import hand`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/control/project_service.py#L1-L11)。
- **`jiuwenswarm/server/control/responses.py`**
- 源码对模块职责的说明：Front/Control-safe E2A error and param helpers. No Runtime adapter imports.。
- 调用入口 `parse_int_param(params, key, default, minimum, maximum)`；声明返回 `int`。
- 调用入口 `build_error_response(request, error, code, ok, extra)`；声明返回 `AgentResponse`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`from typing import Any`；`from jiuwenswarm.common.schema.agent import AgentRequest, AgentResponse`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/control/responses.py#L1-L54)。
- **`jiuwenswarm/server/control/session_service.py`**
- 源码对模块职责的说明：Session query/list Control Service. Does not create, switch, or delete sessions.。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`from jiuwenswarm.server.control.repositories.session_repository import hand`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/control/session_service.py#L1-L11)。

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/agent-server-runtime/control/source-contracts-01.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
