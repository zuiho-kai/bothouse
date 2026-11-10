---
name: code-rails-contracts-01-2
description: code-rails 源码接口与集成边界 01 下半：harness/code/rails/heartbeat 的 __init__、controller、cron_schedule、execution、models、runtime、scheduler、session_resolver 声明
metadata:
  scope: 只收 heartbeat 子包前八个文件的静态声明；顶层 rail 文件归 code-rails-contracts-01-1，heartbeat/store 与 tools 及 sdd 归 code-rails-contracts-02
---
# code-rails 源码接口与集成边界 01（2/2）

## 现状

- 拆分说明：本页是源页 `source-contracts-01.md` 的第 2/2 部分；第 1 部分 [[code-rails-contracts-01-1]]
- **`jiuwenswarm/agents/harness/code/rails/heartbeat/__init__.py`**
- 源码对模块职责的说明：AgentServer-owned Heartbeat domain used by :mod:'heartbeat_rail'.。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from .controller import HeartbeatController`；`from .models import HeartbeatJob, HeartbeatSchedule`；`from .runtime import HeartbeatRuntimeUnavailableError`；`from .scheduler import HeartbeatSchedulerService`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/code/rails/heartbeat/__init__.py#L1-L20)。
- **`jiuwenswarm/agents/harness/code/rails/heartbeat/controller.py`**
- 源码对模块职责的说明：Heartbeat domain controller owned by the AgentServer Rail runtime.。
- `HeartbeatController` 定义类型边界；方法入口：`__init__`, `set_limits`, `limits`, `list_jobs`, `get_job`, `create_job`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import logging`；`import math`；`import time`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/code/rails/heartbeat/controller.py#L1-L576)。
- **`jiuwenswarm/agents/harness/code/rails/heartbeat/cron_schedule.py`**
- 源码对模块职责的说明：Shared Cron parsing and calculation for the Heartbeat domain.。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from jiuwenswarm.runtime.cron.cron_expr import next_cron_datetime, validate`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/code/rails/heartbeat/cron_schedule.py#L1-L8)。
- **`jiuwenswarm/agents/harness/code/rails/heartbeat/execution.py`**
- 源码对模块职责的说明：Heartbeat admission and AgentServer-local execution.。
- `SessionRunAdmission` 定义类型边界；方法入口：`__init__`, `set_heartbeat_preemptor`, `is_user_active`, `active_heartbeat_sessions`, `is_heartbeat_active`, `has_pending_interaction`。
- `HeartbeatExecutionService` 定义类型边界；方法入口：`__init__`, `set_scheduler`, `set_completion_hook`, `is_session_busy`, `has_active_run`, `active_session_ids`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import asyncio`；`import logging`；`import time`。
- 模块级配置或常量名称：`DEFAULT_EXECUTION_TIMEOUT_SECONDS`, `DEFAULT_USER_PREEMPTION_TIMEOUT_SECONDS`；实际值与使用条件见源码。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/code/rails/heartbeat/execution.py#L1-L770)。
- **`jiuwenswarm/agents/harness/code/rails/heartbeat/models.py`**
- 源码对模块职责的说明：新 Heartbeat 任务数据模型 — 绑定当前会话的自动续跑触发器.。
- 调用入口 `validate_metadata_source(raw)`；声明返回 `str`。
- `HeartbeatSchedule` 定义类型边界；方法入口：`to_dict`, `from_dict`, `validate`。
- `HeartbeatRunState` 定义类型边界；方法入口：`to_dict`, `from_dict`。
- `HeartbeatJob` 定义类型边界；方法入口：`to_dict`, `from_dict`, `check_invariants`, `source`, `is_terminal`, `is_schedulable`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`from dataclasses import dataclass, field`；`from typing import Any`；`from .cron_schedule import validate_cron_expression`。
- 模块级配置或常量名称：`HEARTBEAT_KIND`, `STATUS_SCHEDULED`, `STATUS_RUNNING`, `STATUS_COMPLETED`, `STATUS_EXPIRED`, `STATUS_DISABLED`, `HEARTBEAT_STATUSES`, `HEARTBEAT_TERMINAL_STATUSES`；实际值与使用条件见源码。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/code/rails/heartbeat/models.py#L1-L593)。
- **`jiuwenswarm/agents/harness/code/rails/heartbeat/runtime.py`**
- 源码对模块职责的说明：Process-level owner for the Heartbeat Rail domain.。
- `HeartbeatRuntimeUnavailableError` 继承 `RuntimeError`。
- `HeartbeatRailRuntime` 定义类型边界；方法入口：`__init__`, `is_available`, `should_retain_session`, `start`, `stop`, `retain_agent`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import asyncio`；`import logging`；`import os`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/code/rails/heartbeat/runtime.py#L1-L392)。
- **`jiuwenswarm/agents/harness/code/rails/heartbeat/scheduler.py`**
- 源码对模块职责的说明：HeartbeatSchedulerService — 心跳任务后台调度.。
- `HeartbeatExecution` 继承 `Protocol`；方法入口：`is_session_busy`, `has_active_run`, `dispatch`, `cancel`。
- `HeartbeatSchedulerService` 定义类型边界；方法入口：`__init__`, `set_limits`, `suspend_session`, `resume_session`, `is_running`, `start`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import asyncio`；`import logging`；`import secrets`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/code/rails/heartbeat/scheduler.py#L1-L980)。
- **`jiuwenswarm/agents/harness/code/rails/heartbeat/session_resolver.py`**
- 源码对模块职责的说明：HeartbeatSessionResolver — 会话存在性检查与会话删除通知.。
- `SessionSummary` 定义类型边界。
- `HeartbeatSessionResolver` 定义类型边界；方法入口：`__init__`, `set_scheduler`, `resolve`, `on_session_deleted`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import json`；`import logging`；`from dataclasses import dataclass`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/code/rails/heartbeat/session_resolver.py#L1-L160)。

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/agents-team/code-rails/source-contracts-01.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
