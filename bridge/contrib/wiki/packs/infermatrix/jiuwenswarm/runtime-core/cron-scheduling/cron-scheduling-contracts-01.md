---
name: cron-scheduling-contracts-01
description: cron-scheduling 源码接口与集成边界 01：runtime/cron 的 __init__.py 与 dingtalk_routing.py 声明的接口、返回类型与导入依赖
metadata:
  scope: 只收 runtime/cron 下两个文件的静态声明记录；任务模型与运行时行为归 jiuwenswarm-runtime-cron，存储归 jiuwenswarm-cron-store
---
# cron-scheduling 源码接口与集成边界 01

## 现状

- 本页逐文件说明这一源码模块声明的接口、类型与依赖。记录来自静态源码声明，不证明控制流、配置生效、外部服务可用或测试通过；功能语义与设计取舍沿上级功能页继续阅读。
- **`jiuwenswarm/runtime/cron/__init__.py`**
- 源码对模块职责的说明：Transport-neutral cron models and persistence used by Agent Runtime.。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from jiuwenswarm.runtime.cron.models import CronJob, CronRunState, CronTarg`；`from jiuwenswarm.runtime.cron.store import CronJobStore`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/runtime/cron/__init__.py#L1-L6)。
- **`jiuwenswarm/runtime/cron/dingtalk_routing.py`**
- 源码对模块职责的说明：DingTalk cron delivery session binding helpers (Issue #2449).。
- 调用入口 `is_usable_dingtalk_staff_id(value)`；声明返回 `bool`。
- 调用入口 `encode_dingtalk_cron_session_id(sender_id, conversation_id, conversation_type)`；声明返回 `str`。
- 调用入口 `parse_dingtalk_cron_session_id(session_id)`；声明返回 `dict[str, str] / None`。
- 调用入口 `dingtalk_chat_type_from_metadata(metadata)`；声明返回 `str / None`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`from typing import Any`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/runtime/cron/dingtalk_routing.py#L1-L150)。

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/cron-scheduling/source-contracts-01.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
