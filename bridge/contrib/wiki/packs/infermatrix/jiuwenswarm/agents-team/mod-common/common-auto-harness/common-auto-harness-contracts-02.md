---
name: common-auto-harness-contracts-02
description: common-auto-harness 源码接口与集成边界 02：run_log_status.py、scheduler.py、task_store.py
metadata:
  scope: 只收 common/auto_harness 下 run_log_status.py 至 task_store.py 共 3 个源码文件的静态声明（接口、类型、依赖与源码依据链接）；同目录其余契约页是 common-auto-harness-contracts-01
---
# common-auto-harness 源码接口与集成边界 02

## 现状

- 本页逐文件说明这一源码模块声明的接口、类型与依赖。记录来自静态源码声明，不证明控制流、配置生效、外部服务可用或测试通过；功能语义与设计取舍沿上级功能页继续阅读。
- **`jiuwenswarm/agents/harness/common/auto_harness/run_log_status.py`**
- 源码对模块职责的说明：Structured run-log status helpers for scheduled auto-harness tasks.。
- 调用入口 `infer_skipped_stages_from_message(content, inferers)`；声明返回 `tuple[str, ...]`。
- 调用入口 `classify_failure(error, last_message)`；声明返回 `str`。
- 调用入口 `resolve_latest_task_log_path(task, runs_dir)`；声明返回 `Path / None`。
- 调用入口 `format_progress_summary(progress)`；声明返回 `str`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import json`；`import logging`；`from pathlib import Path`。
- 模块级配置或常量名称：`META_EVOLVE_STAGE_ORDER`, `STAGE_DISPLAY_NAMES`, `TERMINAL_STATUSES`, `KEY_EVENT_TYPES`；实际值与使用条件见源码。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/auto_harness/run_log_status.py#L1-L438)。
- **`jiuwenswarm/agents/harness/common/auto_harness/scheduler.py`**
- 源码对模块职责的说明：Scheduler for recurring auto_harness task execution.。
- `Scheduler` 定义类型边界；方法入口：`__init__`, `start`, `stop`, `cancel_execution`, `trigger_immediate`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import asyncio`；`import json`；`import logging`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/auto_harness/scheduler.py#L1-L454)。
- **`jiuwenswarm/agents/harness/common/auto_harness/task_store.py`**
- 源码对模块职责的说明：Task metadata storage for scheduled auto_harness tasks.。
- `TaskStore` 定义类型边界；方法入口：`__init__`, `add_task`, `update_task`, `get_task`, `list_tasks`, `register_run_log_status_extension`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import asyncio`；`import json`；`import logging`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/auto_harness/task_store.py#L1-L501)。

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/agents-team/common-auto-harness/source-contracts-02.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
