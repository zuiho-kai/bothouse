---
name: gateway-cron-contracts-01
description: gateway-cron 源码接口与集成边界 01：gateway/cron 下 controller、scheduler、lifecycle_owners、proactive_cron_sync、cron_json_convert 的声明，及 cron_expr、factory、store 等指向 Agent Runtime 的兼容别名
metadata:
  scope: 只收 gateway/cron 目录各文件的静态声明；模块入口归 gateway-cron-overview
---
# gateway-cron 源码接口与集成边界 01

## 现状

- 本页逐文件说明这一源码模块声明的接口、类型与依赖。记录来自静态源码声明，不证明控制流、配置生效、外部服务可用或测试通过；功能语义与设计取舍沿上级功能页继续阅读。
- **`jiuwenswarm/gateway/cron/__init__.py`**
- 源码对模块职责的说明：Cron job scheduling for Gateway.。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from .controller import CronController`；`from .factory import create_gateway_cron_store`；`from .models import CronJob, CronTarget, CronTargetChannel`；`from .scheduler import CronSchedulerService`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/cron/__init__.py#L1-L26)。
- **`jiuwenswarm/gateway/cron/controller.py`**
- `CronController` 定义类型边界；方法入口：`__init__`, `store`, `scheduler`, `set_target_channel`, `get_instance`, `reset_instance`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import asyncio`；`import logging`；`from functools import wraps`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/cron/controller.py#L1-L939)。
- **`jiuwenswarm/gateway/cron/cron_expr.py`**
- 源码对模块职责的说明：Compatibility alias for cron expressions now owned by Agent Runtime.。
- 集成依赖（导入声明，不等于全部运行时依赖）：`import sys`；`from jiuwenswarm.runtime.cron import cron_expr as _implementation`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/cron/cron_expr.py#L1-L7)。
- **`jiuwenswarm/gateway/cron/cron_json_convert.py`**
- 源码对模块职责的说明：CLI 工具：把 cron JSON 在「扁平结构」与「OpenClaw 嵌套结构」之间互转。。
- 调用入口 `convert_cron_job_dict_to_flat(data)`；声明返回 `dict[str, Any]`。
- 调用入口 `convert_flat_cron_job_to_openclaw_dict(flat_job)`；声明返回 `dict[str, Any]`。
- 调用入口 `convert_file(input_path, output_path, to_format)`；声明返回 `None`。
- 调用入口 `main(argv)`；声明返回 `int`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import argparse`；`import json`；`import sys`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/cron/cron_json_convert.py#L1-L264)。
- **`jiuwenswarm/gateway/cron/dingtalk_routing.py`**
- 源码对模块职责的说明：Compatibility alias for transport-neutral DingTalk cron bindings.。
- 集成依赖（导入声明，不等于全部运行时依赖）：`import sys`；`from jiuwenswarm.runtime.cron import dingtalk_routing as _implementation`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/cron/dingtalk_routing.py#L1-L7)。
- **`jiuwenswarm/gateway/cron/factory.py`**
- 源码对模块职责的说明：Compatibility alias for the cron store factory now owned by Agent Runtime.。
- 集成依赖（导入声明，不等于全部运行时依赖）：`import sys`；`from jiuwenswarm.runtime.cron import factory as _implementation`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/cron/factory.py#L1-L7)。
- **`jiuwenswarm/gateway/cron/lifecycle_owners.py`**
- 源码对模块职责的说明：Durable routing identities for project lifecycle recovery.。
- `LifecycleOwners` 定义类型边界；方法入口：`__init__`, `read`, `remember`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import json`；`import os`；`import uuid`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/cron/lifecycle_owners.py#L1-L47)。
- **`jiuwenswarm/gateway/cron/proactive_cron_sync.py`**
- 源码对模块职责的说明：Auto-register the proactive-recommendation tick cron job.。
- 异步入口 `sync_proactive_tick_job(cron_controller, config_payload)`；声明返回 `None`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import logging`；`from typing import Any`。
- 模块级配置或常量名称：`PROACTIVE_JOB_ID`, `PROACTIVE_JOB_NAME`, `DEFAULT_CRON_EXPR`, `DEFAULT_TARGET_CHANNEL`；实际值与使用条件见源码。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/cron/proactive_cron_sync.py#L1-L135)。
- **`jiuwenswarm/gateway/cron/scheduler.py`**
- `CronSchedulerService` 定义类型边界；方法入口：`__init__`, `is_running`, `start`, `stop`, `reload`, `remember_lifecycle_owner`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import asyncio`；`import heapq`；`import json`。
- 模块级配置或常量名称：`CRON_INTERRUPT_EVENT_TYPES`, `CRON_INTERRUPT_RESULT_TEXT`；实际值与使用条件见源码。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/cron/scheduler.py#L1-L2445)。
- **`jiuwenswarm/gateway/cron/store.py`**
- 源码对模块职责的说明：Compatibility alias for cron persistence now owned by Agent Runtime.。
- 集成依赖（导入声明，不等于全部运行时依赖）：`import sys`；`from jiuwenswarm.runtime.cron import store as _implementation`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/cron/store.py#L1-L7)。
- **`jiuwenswarm/gateway/cron/store_base.py`**
- 源码对模块职责的说明：Compatibility alias for cron store backend protocol now owned by Agent Runtime.。
- 集成依赖（导入声明，不等于全部运行时依赖）：`import sys`；`from jiuwenswarm.runtime.cron import store_base as _implementation`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/cron/store_base.py#L1-L7)。

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/gateway-channels/gateway-cron/source-contracts-01.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
