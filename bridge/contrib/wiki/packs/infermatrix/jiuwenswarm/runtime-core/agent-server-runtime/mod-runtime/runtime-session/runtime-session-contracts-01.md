---
name: runtime-session-contracts-01
description: runtime-session 源码接口与集成边界 01：session 目录 git_diff_status、git_diff_watcher、history_io、kv_cache 下五个模块、model_selection_store、project_git、project_queries、project_store、session_archive 共十三个文件的静态声明
metadata:
  scope: 只收 session 目录按路径序前十三个文件的静态声明，不证明运行行为；session_history 起的其余文件归 runtime-session-contracts-02，规则归 runtime-session-rules，入口说明归 runtime-session-overview
---
# runtime-session 源码接口与集成边界 01

## 现状

- 本页逐文件说明这一源码模块声明的接口、类型与依赖。记录来自静态源码声明，不证明控制流、配置生效、外部服务可用或测试通过；功能语义与设计取舍沿上级功能页继续阅读。
- **`jiuwenswarm/server/runtime/session/git_diff_status.py`**
- 源码对模块职责的说明：DiffStatusService: 面向 Web 的 diff 状态聚合服务(设计文档 §2.4 / §3.5 / §4.1.16)。。
- `DiffStats` 定义类型边界；方法入口：`to_dict`。
- `DiffHunk` 定义类型边界；方法入口：`to_dict`。
- `DiffFileEntry` 定义类型边界；方法入口：`to_dict`。
- `DiffSummary` 定义类型边界；方法入口：`to_dict`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import logging`；`import os`；`import re`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/session/git_diff_status.py#L1-L1064)。
- **`jiuwenswarm/server/runtime/session/git_diff_watcher.py`**
- 源码对模块职责的说明：GitDiffWatcherRegistry: diff 实时监控核心逻辑(设计文档 §2.5 / §3.6 / §4.2)。。
- `GitDiffWatch` 定义类型边界。
- `GitDiffFilesState` 定义类型边界。
- `GitDiffDetailState` 定义类型边界。
- `GitDiffWatcherRegistry` 定义类型边界；方法入口：`__init__`, `set_channel`, `set_diff_status_fetcher`, `add_watch`, `remove_watch`, `update_files`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import asyncio`；`import hashlib`；`import logging`。
- 模块级配置或常量名称：`POLL_INTERVAL_SEC`, `DEBOUNCE_SEC`, `ERROR_BACKOFF_SEC`, `MAX_PUSH_FAILURES`；实际值与使用条件见源码。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/session/git_diff_watcher.py#L1-L1483)。
- **`jiuwenswarm/server/runtime/session/history_io.py`**
- 源码对模块职责的说明：Async boundary for synchronous history persistence and queue backpressure.。
- 异步入口 `run_history_io(fn, *args, **kwargs)`；声明返回 `Any`。
- 调用入口 `stream_chunk_writes_history(chunk)`；声明返回 `bool`。
- 异步入口 `run_stream_parser(parser, chunk, **kwargs)`；声明返回 `Any`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import asyncio`；`from typing import Any, Callable`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/session/history_io.py#L1-L42)。
- **`jiuwenswarm/server/runtime/session/kv_cache/kv_cache_application_owner.py`**
- 源码对模块职责的说明：Application-scoped ownership and publication of KVC lifecycle resources.。
- `KVCacheApplicationState` 继承 `str, Enum`。
- `KVCacheApplicationOwner` 定义类型边界；方法入口：`__init__`, `state`, `closed`, `attach_runtime`, `activate_from_config`, `set_enabled`。
- 调用入口 `get_kv_cache_application_owner()`；声明返回 `KVCacheApplicationOwner`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import asyncio`；`from collections.abc import Awaitable, Callable`；`from enum import Enum`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/session/kv_cache/kv_cache_application_owner.py#L1-L235)。
- **`jiuwenswarm/server/runtime/session/kv_cache/kv_cache_application_runtime.py`**
- 源码对模块职责的说明：Application ownership for the process-local Agent-Core KVC runtime.。
- 调用入口 `get_kv_cache_runtime()`；声明返回 `KVCacheRuntime / None`。
- 异步入口 `close_kv_cache_runtime()`；声明返回 `None`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import asyncio`；`import logging`；`from openjiuwen.core.kv_cache.kv_cache_config import KVC_TERMINAL_CLEANUP_T`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/session/kv_cache/kv_cache_application_runtime.py#L1-L90)。
- **`jiuwenswarm/server/runtime/session/kv_cache/kv_cache_model_provider.py`**
- 源码对模块职责的说明：JiuwenSwarm configuration bridge for the shared KVC runtime.。
- 调用入口 `is_kv_cache_affinity_enabled(config)`；声明返回 `bool`。
- 调用入口 `create_default_kv_cache_model()`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`from typing import Any`；`from jiuwenswarm.common.config import get_config, get_default_models`；`from jiuwenswarm.common.kv_cache_affinity_config import has_kv_cache_affini`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/session/kv_cache/kv_cache_model_provider.py#L1-L84)。
- **`jiuwenswarm/server/runtime/session/kv_cache/kv_cache_session_lifecycle_participant.py`**
- 源码对模块职责的说明：KVC product implementation of Runtime-owned Session lifecycle protocols.。
- `KVCacheSessionLifecycleParticipant` 定义类型边界；方法入口：`__init__`, `name`, `before_delete`, `release_resources`, `delete_failed`, `delete_committed`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import asyncio`；`import logging`；`from openjiuwen.core.kv_cache.kv_cache_config import KVC_TERMINAL_CLEANUP_T`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/session/kv_cache/kv_cache_session_lifecycle_participant.py#L1-L218)。
- **`jiuwenswarm/server/runtime/session/kv_cache/kv_cache_task_guard.py`**
- 源码对模块职责的说明：Lightweight, process-local product Session facts for KVC lifecycle.。
- `KVCGuardActionRequest` 定义类型边界。
- `SessionKVCFacts` 定义类型边界。
- `SessionKVCacheTaskGuard` 定义类型边界；方法入口：`__init__`, `forget`, `snapshot`, `set_foreground`, `prepare`, `task_started`。
- 调用入口 `get_session_kv_cache_task_guard()`；声明返回 `SessionKVCacheTaskGuard`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`from dataclasses import dataclass, field`；`from typing import Literal`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/session/kv_cache/kv_cache_task_guard.py#L1-L208)。
- **`jiuwenswarm/server/runtime/session/model_selection_store.py`**
- 源码对模块职责的说明：Safe persistence for stable per-session model selections.。
- 调用入口 `get_session_model_selection(session_id)`；声明返回 `ModelSelection / None`。
- 调用入口 `set_session_model_selection(session_id, selection)`；声明返回 `None`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import json`；`import os`；`import re`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/session/model_selection_store.py#L1-L54)。
- **`jiuwenswarm/server/runtime/session/project_git.py`**
- 源码对模块职责的说明：ProjectGitService: 项目目录的 Git 仓库探测与分支操作服务(设计文档 §3.4 / §6)。。
- `GitError` 定义类型边界；方法入口：`to_dict`。
- `GitRepoStatus` 定义类型边界；方法入口：`to_dict`。
- `GitProbeResult` 定义类型边界；方法入口：`to_dict`。
- `GitOperationResult` 定义类型边界；方法入口：`to_dict`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import logging`；`import os`；`import subprocess`。
- 模块级配置或常量名称：`GIT_COMMAND_TIMEOUT_SEC`, `GIT_DIFF_TIMEOUT_SEC`, `GIT_PUSH_TIMEOUT_SEC`；实际值与使用条件见源码。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/session/project_git.py#L1-L2206)。
- **`jiuwenswarm/server/runtime/session/project_queries.py`**
- 源码对模块职责的说明：Compatibility shim. Disk project queries live in Control store.。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from jiuwenswarm.server.control.store.project_queries import attribute_sess`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/session/project_queries.py#L1-L25)。
- **`jiuwenswarm/server/runtime/session/project_store.py`**
- 源码对模块职责的说明：项目存储模块 — projects.json 的持久化与 CRUD。。
- 调用入口 `file_lock(data_path)`；声明返回 `Iterator[None]`。
- `Project` 定义类型边界；方法入口：`to_dict`, `from_dict`。
- `CronProjectBinding` 定义类型边界。
- 调用入口 `get_project_by_id(project_id, cache_bust)`；声明返回 `Project / None`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import json`；`import logging`；`import os`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/session/project_store.py#L1-L1113)。
- **`jiuwenswarm/server/runtime/session/session_archive.py`**
- 源码对模块职责的说明：Archive operations owned by the AgentServer runtime, never Gateway fallback.。
- 调用入口 `get_agent_sessions_dir()`。
- `ProjectSessionInventoryItem` 定义类型边界。
- `SessionArchiveService` 定义类型边界；方法入口：`__init__`, `lock`, `start_recovery`, `close`, `stop`, `session`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import asyncio`；`import os`；`import logging`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/session/session_archive.py#L1-L1250)。

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/agent-server-runtime/runtime-session/source-contracts-01.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
