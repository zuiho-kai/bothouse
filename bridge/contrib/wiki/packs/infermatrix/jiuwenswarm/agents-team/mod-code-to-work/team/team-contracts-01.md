---
name: team-contracts-01
description: team 源码接口与集成边界 01：harness/team 的 __init__、bootstrap、config_loader、event_types、exceptions、remote_member_bootstrap、team_name_generator、team_runtime_inheritance 声明
metadata:
  scope: 只收 harness/team 根目录八个文件的静态声明；a2x、handlers、rails 子目录归 team-a2x-contracts-01、team-handlers-contracts-01、team-rails-contracts-01
---
# team 源码接口与集成边界 01

## 现状

- 本页逐文件说明这一源码模块声明的接口、类型与依赖。记录来自静态源码声明，不证明控制流、配置生效、外部服务可用或测试通过；功能语义与设计取舍沿上级功能页继续阅读。
- **`jiuwenswarm/agents/harness/team/__init__.py`**
- 源码对模块职责的说明：Agent Team 模块 - 多智能体协作团队支持.。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`from jiuwenswarm.agents.harness.team.config_loader import get_team_template`；`from jiuwenswarm.agents.harness.team.team_manager import cancel_all_team_st`；`from jiuwenswarm.agents.harness.team.team_name_generator import TeamNameGen`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/team/__init__.py#L1-L53)。
- **`jiuwenswarm/agents/harness/team/bootstrap.py`**
- 源码对模块职责的说明：Bootstrap helpers for JiuwenSwarm team integrations.。
- 调用入口 `configure_agent_teams_home()`；声明返回 `None`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`from jiuwenswarm.common.utils import get_user_workspace_dir`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/team/bootstrap.py#L1-L14)。
- **`jiuwenswarm/agents/harness/team/config_loader.py`**
- 源码对模块职责的说明：Team configuration loader.。
- `TeamTemplateNotFoundError` 继承 `ValueError`。
- 调用入口 `list_team_template_summaries(config_base)`；声明返回 `list[dict[str, Any]]`。
- 调用入口 `get_team_template_snapshot(config_base, template_id)`；声明返回 `dict[str, Any]`。
- 调用入口 `resolve_team_sqlite_db_path(config_base)`；声明返回 `Path / None`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import hashlib`；`import json`；`import logging`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/team/config_loader.py#L1-L707)。
- **`jiuwenswarm/agents/harness/team/event_types.py`**
- 源码对模块职责的说明：Team 事件类型定义.。
- `TeamEventCategory` 继承 `str, Enum`。
- 调用入口 `resolve_team_event(sdk_event_type)`；声明返回 `tuple[str, TeamEventCategory] / None`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from enum import Enum`；`from openjiuwen.agent_teams.monitor.models import MonitorEventType`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/team/event_types.py#L1-L66)。
- **`jiuwenswarm/agents/harness/team/exceptions.py`**
- 源码对模块职责的说明：Team 异常定义.。
- `TeamError` 继承 `Exception`。
- `TeamCreateError` 继承 `TeamError`。
- `TeamRecoverError` 继承 `TeamError`。
- `TeamInteractError` 继承 `TeamError`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/team/exceptions.py#L1-L48)。
- **`jiuwenswarm/agents/harness/team/remote_member_bootstrap.py`**
- 源码对模块职责的说明：Wrap team spawn_teammate so remote blank claws receive a bootstrap envelope.。
- `RemoteSpawnPrecheck` 继承 `NamedTuple`。
- 调用入口 `remote_member_names(config_base)`；声明返回 `set[str]`。
- 调用入口 `remote_all_spawn_members(config_base)`；声明返回 `bool`。
- 调用入口 `resolve_team_lifecycle(team_agent)`；声明返回 `str`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import asyncio`；`import contextlib`；`import json`。
- 模块级配置或常量名称：`REMOTE_BOOTSTRAP_ACK_TYPE`, `REMOTE_BOOTSTRAP_DIRECT_EVENT_TYPE`, `REMOTE_TEAM_DESTROY_DIRECT_EVENT_TYPE`, `REMOTE_MEMBER_SHUTDOWN_DIRECT_EVENT_TYPE`；实际值与使用条件见源码。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/team/remote_member_bootstrap.py#L1-L3108)。
- **`jiuwenswarm/agents/harness/team/team_name_generator.py`**
- 源码对模块职责的说明：Generate an internal team identifier with an ephemeral TinyAgent.。
- `TeamNameGenerationError` 继承 `RuntimeError`。
- 异步入口 `generate_team_name(description, config_base, template_id, timeout_seconds, max_attempts)`；声明返回 `str`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import asyncio`；`import hashlib`；`import logging`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/team/team_name_generator.py#L1-L179)。
- **`jiuwenswarm/agents/harness/team/team_runtime_inheritance.py`**
- 源码对模块职责的说明：Team 成员运行时继承模块.。
- `MemberInfo` 定义类型边界。
- `RuntimeInfo` 定义类型边界。
- `TeamWorkspaceInfo` 定义类型边界。
- 调用入口 `build_member_rails(member_info, runtime, team_workspace)`；声明返回 `list[Any]`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import logging`；`from dataclasses import dataclass`；`from pathlib import Path`。
- 模块级配置或常量名称：`RAIL_WHITELIST`, `TOOL_WHITELIST`；实际值与使用条件见源码。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/team/team_runtime_inheritance.py#L1-L637)。

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/agents-team/team/source-contracts-01.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
