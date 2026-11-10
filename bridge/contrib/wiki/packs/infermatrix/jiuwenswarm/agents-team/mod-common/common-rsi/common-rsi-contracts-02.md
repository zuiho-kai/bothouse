---
name: common-rsi-contracts-02
description: common-rsi 源码接口与集成边界 02：mock_artifact_provider.py、mock_harness_provider.py、model_resolver.py、models.py、paper_provider.py、plugin_catalog.py 等 14 个模块
metadata:
  scope: 只收 common/rsi 下 mock_artifact_provider.py 至 worker.py 共 14 个源码文件的静态声明（接口、类型、依赖与源码依据链接）；同目录其余契约页是 common-rsi-contracts-01
---
# common-rsi 源码接口与集成边界 02

## 现状

- 本页逐文件说明这一源码模块声明的接口、类型与依赖。记录来自静态源码声明，不证明控制流、配置生效、外部服务可用或测试通过；功能语义与设计取舍沿上级功能页继续阅读。
- **`jiuwenswarm/agents/harness/common/rsi/mock_artifact_provider.py`**
- 源码对模块职责的说明：Small in-process artifact Providers for service-layer integration.。
- `MockArtifactProvider` 定义类型边界；方法入口：`__init__`, `validate_input`, `run`, `pause`, `resume`, `read_state`。
- 调用入口 `build_mock_artifact_adapters(tasks_root, model_resolver, requires_model, iteration_delay, node_delay, branching_factor)`；声明返回 `dict[str, Any]`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import asyncio`；`import hashlib`；`import json`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/rsi/mock_artifact_provider.py#L1-L956)。
- **`jiuwenswarm/agents/harness/common/rsi/mock_harness_provider.py`**
- 源码对模块职责的说明：Deterministic Harness Provider for RSI service and Web E2E.。
- `MockHarnessProvider` 定义类型边界；方法入口：`__init__`, `validate_input`, `run`, `resume`, `pause`, `terminate`。
- 调用入口 `build_mock_harness_adapter(tasks_root)`；声明返回 `Any`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import asyncio`；`import hashlib`；`import json`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/rsi/mock_harness_provider.py#L1-L694)。
- **`jiuwenswarm/agents/harness/common/rsi/model_resolver.py`**
- 源码对模块职责的说明：Resolve JiuwenSwarm model selections into openjiuwen model files.。
- `ResolvedRsiModel` 定义类型边界；方法入口：`to_manifest`。
- `RsiModelConfigResolver` 定义类型边界；方法入口：`__init__`, `entries`, `resolve`, `resolve_to_file`。
- 调用入口 `select_rsi_model_entry(entries, model_ref)`；声明返回 `tuple[dict[str, Any], int / None]`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import hashlib`；`from copy import deepcopy`；`from dataclasses import dataclass`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/rsi/model_resolver.py#L1-L306)。
- **`jiuwenswarm/agents/harness/common/rsi/models.py`**
- 源码对模块职责的说明：RSI 服务域公共模型（与 web 契约 v0.3 / 内部接口 v3 对齐）。。
- 调用入口 `generate_task_id()`；声明返回 `str`。
- `TaskStatus` 继承 `str, Enum`；方法入口：`terminal`。
- `Scenario` 继承 `str, Enum`。
- `ArtifactType` 继承 `str, Enum`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import uuid`；`from dataclasses import asdict, dataclass, field`；`from datetime import datetime, timezone`。
- 模块级配置或常量名称：`TASK_ID_PREFIX`；实际值与使用条件见源码。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/rsi/models.py#L1-L331)。
- **`jiuwenswarm/agents/harness/common/rsi/paper_provider.py`**
- 源码对模块职责的说明：AgentServer Provider bridge for the OpenJiuwen paper optimizer.。
- `PaperProvider` 定义类型边界；方法入口：`__init__`, `validate_input`, `run`, `pause`, `resume`, `terminate`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import asyncio`；`import contextlib`；`import hashlib`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/rsi/paper_provider.py#L1-L1412)。
- **`jiuwenswarm/agents/harness/common/rsi/plugin_catalog.py`**
- 源码对模块职责的说明：Publish an RSI-owned copy through the existing extension catalog APIs.。
- 调用入口 `register_harness_plugin(source, installation_id)`；声明返回 `Callable[[], None]`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import hashlib`；`import json`；`import shutil`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/rsi/plugin_catalog.py#L1-L131)。
- **`jiuwenswarm/agents/harness/common/rsi/projector.py`**
- 源码对模块职责的说明：RsiProjector：单投影函数（事件 ↔ tree/进度/推送 同源；内部 v3 §4.4）。。
- `RsiProjector` 定义类型边界；方法入口：`__init__`, `register_root`, `on_node_created`, `on_provider_node`, `merge_provider_tree`, `sync_provider_tree`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import json`；`import threading`；`from pathlib import Path`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/rsi/projector.py#L1-L522)。
- **`jiuwenswarm/agents/harness/common/rsi/provider_factory.py`**
- 源码对模块职责的说明：RSI Provider assembly.。
- 调用入口 `build_mock_rsi_adapters(tasks_root, model_resolver)`；声明返回 `dict[str, Any]`。
- 调用入口 `build_rsi_adapters(tasks_root, mode, harness_provider, artifact_adapters, paper_provider, model_resolver)`；声明返回 `dict[str, Any]`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`from pathlib import Path`；`from typing import Any`；`from jiuwenswarm.agents.harness.common.rsi.artifact_adapter import Artifact`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/rsi/provider_factory.py#L1-L107)。
- **`jiuwenswarm/agents/harness/common/rsi/recovery.py`**
- 源码对模块职责的说明：Durable workspace recovery for interrupted RSI AgentServer tasks.。
- `RsiWorkspaceRecovery` 定义类型边界；方法入口：`__init__`, `recover`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import logging`；`from typing import Any`；`from jiuwenswarm.agents.harness.common.rsi.errors import failure_reason`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/rsi/recovery.py#L1-L119)。
- **`jiuwenswarm/agents/harness/common/rsi/services.py`**
- 源码对模块职责的说明：派生薄封装服务（内部 v3 §4.7）：RsiDatasetService / RsiTaskService / RsiReportService / RsiTreeService。。
- `RsiTaskService` 定义类型边界；方法入口：`__init__`, `create`, `list`, `get`, `delete`, `start`。
- `RsiDatasetService` 定义类型边界；方法入口：`__init__`, `validate`。
- `RsiReportService` 定义类型边界；方法入口：`__init__`, `get`。
- `RsiTreeService` 定义类型边界；方法入口：`__init__`, `get`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import json`；`import logging`；`import shutil`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/rsi/services.py#L1-L987)。
- **`jiuwenswarm/agents/harness/common/rsi/task_store.py`**
- 源码对模块职责的说明：RsiTaskStore：任务存储 + 状态机（内部 v3 §4.1 + 一致性规则 §8）。。
- `RsiTaskStore` 定义类型边界；方法入口：`__init__`, `task_dir`, `create`, `get`, `get_view`, `list`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import json`；`import shutil`；`import threading`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/rsi/task_store.py#L1-L231)。
- **`jiuwenswarm/agents/harness/common/rsi/usage_recorder.py`**
- 源码对模块职责的说明：RsiUsageRecorder：progress.usage 事件聚合（内部 v3 §4.6）。。
- `RsiUsageRecorder` 定义类型边界；方法入口：`__init__`, `record`, `record_engine_event`, `record_cumulative`, `get`, `usage_summary`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`from collections.abc import Mapping`；`from dataclasses import asdict, is_dataclass`；`from typing import Any`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/rsi/usage_recorder.py#L1-L277)。
- **`jiuwenswarm/agents/harness/common/rsi/validation_dataset.py`**
- 源码对模块职责的说明：Normalize Evo-Bench validation suites for the single-Harness engine.。
- 调用入口 `normalize_validation_suite(source_path)`；声明返回 `dict[str, Any] / None`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import json`；`from pathlib import Path`；`from typing import Any`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/rsi/validation_dataset.py#L1-L66)。
- **`jiuwenswarm/agents/harness/common/rsi/worker.py`**
- 源码对模块职责的说明：RsiWorker：单协程队列（并发=1）+ 事件链路装配（内部 v3 §4.2）。。
- `RsiWorker` 定义类型边界；方法入口：`__init__`, `enqueue`, `cancel`, `resume`, `register_push_callbacks`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import asyncio`；`import logging`；`import time`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/rsi/worker.py#L1-L932)。

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/agents-team/common-rsi/source-contracts-02.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
