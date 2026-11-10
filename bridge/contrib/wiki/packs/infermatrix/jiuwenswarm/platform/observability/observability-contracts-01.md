---
name: observability-contracts-01
description: observability 源码接口 01：jiuwenswarm/observability 的 __init__、config（会话库路径与设置加载）、gateway_hints（TrajectoryGatewayHintBridge）、runtime（轨迹运行时生命周期）、turn（TurnIdentity、SessionTurnTracker）的声明与导入依赖
metadata:
  scope: 只收 __init__.py、config.py、gateway_hints.py、runtime.py、turn.py 五个文件的接口记录；目录入口归 observability-overview
---
# observability 源码接口与集成边界 01

## 现状

- 本页逐文件说明这一源码模块声明的接口、类型与依赖。记录来自静态源码声明，不证明控制流、配置生效、外部服务可用或测试通过；功能语义与设计取舍沿上级功能页继续阅读。
- **`jiuwenswarm/observability/__init__.py`**
- 源码对模块职责的说明：JiuwenSwarm persistence and delivery for OTLP trajectory records.。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from jiuwenswarm.observability.config import TrajectoryStoreSettings, load_`；`from jiuwenswarm.observability.models import CommittedTraceUpdate, OtlpSpan`；`from jiuwenswarm.observability.sink import TrajectoryRecordSink, Trajectory`；
  - `from jiuwenswarm.observability.runtime import get_trajectory_runtime_sink, `。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/observability/__init__.py#L1-L41)。
- **`jiuwenswarm/observability/config.py`**
- 源码对模块职责的说明：Configuration resolution for the local trajectory read store.。
- `TrajectoryStoreSettings` 定义类型边界。
- 调用入口 `session_database_path(database_root, session_id)`；声明返回 `Path`。
- 调用入口 `database_files(database_path)`；声明返回 `tuple[Path, Path, Path]`。
- 调用入口 `load_trajectory_store_settings(config, workspace)`；声明返回 `TrajectoryStoreSettings`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import hashlib`；`from collections.abc import Mapping`；`from dataclasses import dataclass`。
- 模块级配置或常量名称：`DEFAULT_QUEUE_SIZE`, `DEFAULT_BATCH_SIZE`, `DEFAULT_FLUSH_INTERVAL_MS`, `DEFAULT_RETENTION_DAYS`, `DEFAULT_DETAIL_MAX_BYTES`, `DEFAULT_SESSION_DATABASE_DIRECTORY`, `DEFAULT_DISCARD_FINAL_SPAN_FRAMES`；实际值与使用条件见源码。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/observability/config.py#L1-L165)。
- **`jiuwenswarm/observability/gateway_hints.py`**
- 源码对模块职责的说明：Cross-process delivery of committed trajectory revision hints.。
- `TrajectoryGatewayHintBridge` 定义类型边界；方法入口：`__init__`, `bind`, `unbind`, `publish`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import asyncio`；`import logging`；`import threading`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/observability/gateway_hints.py#L1-L167)。
- **`jiuwenswarm/observability/runtime.py`**
- 源码对模块职责的说明：AgentServer lifecycle for the Core OTLP record consumer.。
- 调用入口 `sync_trajectory_runtime(settings, on_commit, demand)`；声明返回 `TrajectorySessionSinkRouter / None`。
- 调用入口 `start_trajectory_runtime(settings, on_commit)`；声明返回 `TrajectorySessionSinkRouter / None`。
- 调用入口 `shutdown_trajectory_runtime(timeout, demand)`；声明返回 `bool`。
- 调用入口 `get_trajectory_runtime_sink()`；声明返回 `TrajectorySessionSinkRouter / None`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import logging`；`import threading`；`from typing import Protocol`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/observability/runtime.py#L1-L222)。
- **`jiuwenswarm/observability/turn.py`**
- 源码对模块职责的说明：Trajectory turn identity for a session.。
- `TurnIdentity` 定义类型边界；方法入口：`to_dict`, `from_dict`。
- `SessionTurnTracker` 定义类型边界；方法入口：`__init__`, `current`, `resolve`, `sync`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import logging`；`import uuid`；`from dataclasses import dataclass`。
- 模块级配置或常量名称：`SESSION_STATE_KEY`；实际值与使用条件见源码。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/observability/turn.py#L1-L182)。

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/observability/source-contracts-01.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
