---
name: team-handlers-contracts-01
description: team-handlers 源码接口与集成边界 01：harness/team/handlers 的 __init__、base_monitor_handler、team_monitor_handler、workflow_monitor_handler 声明
metadata:
  scope: 只收 harness/team/handlers 下四个文件的静态声明；team 根目录文件归 team-contracts-01
---
# team-handlers 源码接口与集成边界 01

## 现状

- 本页逐文件说明这一源码模块声明的接口、类型与依赖。记录来自静态源码声明，不证明控制流、配置生效、外部服务可用或测试通过；功能语义与设计取舍沿上级功能页继续阅读。
- **`jiuwenswarm/agents/harness/team/handlers/__init__.py`**
- 源码对模块职责的说明：Team event handlers — monitor and workflow status.。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`from jiuwenswarm.agents.harness.team.handlers.team_monitor_handler import T`；`from jiuwenswarm.agents.harness.team.handlers.workflow_monitor_handler impo`；`from jiuwenswarm.agents.harness.team.handlers.workflow_state import Workflo`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/team/handlers/__init__.py#L1-L23)。
- **`jiuwenswarm/agents/harness/team/handlers/base_monitor_handler.py`**
- 源码对模块职责的说明：Base class for TeamMonitor-backed event handlers.。
- `DropOldestQueue` 继承 `asyncio.Queue`；方法入口：`__init__`, `put_nowait`, `put`。
- `BaseMonitorHandler` 定义类型边界；方法入口：`__init__`, `session_id`, `is_running`, `set_consumer_task`, `start`, `stop`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import asyncio`；`import logging`；`from typing import Any, AsyncIterator, Optional`。
- 模块级配置或常量名称：`MONITOR_EVENT_QUEUE_MAXSIZE`；实际值与使用条件见源码。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/team/handlers/base_monitor_handler.py#L1-L238)。
- **`jiuwenswarm/agents/harness/team/handlers/team_monitor_handler.py`**
- 源码对模块职责的说明：Team Monitor 处理器.。
- `TeamMonitorHandler` 继承 `BaseMonitorHandler`；方法入口：`__init__`, `team_id`, `get_team_snapshot`, `get_member_list`, `get_member_list_from_db`, `get_team_snapshot_from_db`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import asyncio`；`import json`；`import logging`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/team/handlers/team_monitor_handler.py#L1-L656)。
- **`jiuwenswarm/agents/harness/team/handlers/workflow_monitor_handler.py`**
- 源码对模块职责的说明：Workflow Monitor Handler — bridges WorkflowProgressTeamEvent to workflow.updated events.。
- `WorkflowMonitorHandler` 继承 `BaseMonitorHandler`；方法入口：`__init__`, `channel_id`, `get_workflow_snapshot`, `finalize_pending_runs`, `get_run_states`, `stop_run`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import logging`；`from typing import Any, Literal, Optional`；`from openjiuwen.agent_teams.monitor.team_monitor import TeamMonitor`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/team/handlers/workflow_monitor_handler.py#L1-L343)。

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/agents-team/team-handlers/source-contracts-01.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
