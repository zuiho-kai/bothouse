---
name: common-auto-harness-contracts-01
description: common-auto-harness 源码接口与集成边界 01：__init__.py、capabilities.py、config_validator.py、__init__.py、code_rules.py、gitcode_issue_client.py 等 14 个模块
metadata:
  scope: 只收 common/auto_harness 下 __init__.py 至 gitcode.py 共 14 个源码文件的静态声明（接口、类型、依赖与源码依据链接）；同目录其余契约页是 common-auto-harness-contracts-02
---
# common-auto-harness 源码接口与集成边界 01

## 现状

- 本页逐文件说明这一源码模块声明的接口、类型与依赖。记录来自静态源码声明，不证明控制流、配置生效、外部服务可用或测试通过；功能语义与设计取舍沿上级功能页继续阅读。
- **`jiuwenswarm/agents/harness/common/auto_harness/__init__.py`**
- 源码对模块职责的说明：Auto-Harness module: single execution and scheduled task management.。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from .service import AutoHarnessService, ActiveAutoHarnessRun, reset_harnes`；`from .scheduler import Scheduler`；`from .task_store import TaskStore`；`from .config_validator import ConfigValidator`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/auto_harness/__init__.py#L1-L28)。
- **`jiuwenswarm/agents/harness/common/auto_harness/capabilities.py`**
- 源码对模块职责的说明：Capability registry for auto-harness scenario extensions.。
- `AutoHarnessCapability` 继承 `Protocol`；方法入口：`handle`。
- `AutoHarnessCapabilityRegistry` 定义类型边界；方法入口：`__init__`, `register`, `handle`。
- 调用入口 `create_default_capability_registry(data_dir, task_store, harness_service, base_config_getter, default_repo_url)`；声明返回 `AutoHarnessCapabilityRegistry`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`from pathlib import Path`；`from typing import Any, Callable, Optional, Protocol`；`from openjiuwen.core.foundation.llm import Model`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/auto_harness/capabilities.py#L1-L84)。
- **`jiuwenswarm/agents/harness/common/auto_harness/config_validator.py`**
- 源码对模块职责的说明：Configuration validator for scheduled auto_harness tasks.。
- `ConfigValidator` 定义类型边界；方法入口：`__init__`, `check_config`, `update_config`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import logging`；`import os`；`from pathlib import Path`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/auto_harness/config_validator.py#L1-L177)。
- **`jiuwenswarm/agents/harness/common/auto_harness/issue_fix/__init__.py`**
- 源码对模块职责的说明：Issue-fix integration for auto-harness.。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from .gitcode_issue_client import GitCodeIssue, GitCodeIssueClient`；`from .issue_runner import GitCodeIssueRunner, IssueWatchOptions`；`from .issue_state_store import IssueStateStore`；`from .service import IssueFixService`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/auto_harness/issue_fix/__init__.py#L1-L19)。
- **`jiuwenswarm/agents/harness/common/auto_harness/issue_fix/code_rules.py`**
- 源码对模块职责的说明：Code rule loading for GitCode issue-fix tasks.。
- 调用入口 `load_code_rules()`；声明返回 `str`。
- 调用入口 `format_code_rules_prompt()`；声明返回 `str`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`from functools import lru_cache`；`from pathlib import Path`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/auto_harness/issue_fix/code_rules.py#L1-L33)。
- **`jiuwenswarm/agents/harness/common/auto_harness/issue_fix/gitcode_issue_client.py`**
- 源码对模块职责的说明：Small GitCode API client for auto-harness issue ingestion.。
- `GitCodeIssue` 定义类型边界。
- `GitCodeIssueClient` 定义类型边界；方法入口：`__init__`, `list_issues`, `list_all_issues`, `get_issue`, `list_issue_pull_requests`, `list_pull_requests`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`from dataclasses import dataclass`；`import logging`；`from typing import Any, Optional`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/auto_harness/issue_fix/gitcode_issue_client.py#L1-L226)。
- **`jiuwenswarm/agents/harness/common/auto_harness/issue_fix/issue_matrix_store.py`**
- 源码对模块职责的说明：Issue matrix storage for tracking analyzed GitCode issues.。
- `IssueMatrixStore` 定义类型边界；方法入口：`__init__`, `load`, `save`, `get_entry`, `remove_entry`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import json`；`import logging`；`from datetime import datetime, timezone`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/auto_harness/issue_fix/issue_matrix_store.py#L1-L106)。
- **`jiuwenswarm/agents/harness/common/auto_harness/issue_fix/issue_runner.py`**
- 源码对模块职责的说明：GitCode issue ingestion and auto-harness task orchestration.。
- `AutoHarnessTaskService` 继承 `Protocol`；方法入口：`run_task`, `get_scheduled_task_status`。
- `IssueWatchOptions` 定义类型边界。
- `GitCodeIssueRunner` 定义类型边界；方法入口：`__init__`, `build_issue_fix_query`, `assess_issue_difficulty`, `reconcile`, `process_issues_once`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import asyncio`；`from dataclasses import dataclass`；`import json`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/auto_harness/issue_fix/issue_runner.py#L1-L566)。
- **`jiuwenswarm/agents/harness/common/auto_harness/issue_fix/issue_state_store.py`**
- 源码对模块职责的说明：Persistent state for GitCode issue auto-harness runs.。
- `IssueStateStore` 定义类型边界；方法入口：`__init__`, `issue_key`, `get`, `list`, `update`, `delete`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import asyncio`；`import json`；`from datetime import datetime, timezone`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/auto_harness/issue_fix/issue_state_store.py#L1-L87)。
- **`jiuwenswarm/agents/harness/common/auto_harness/issue_fix/run_progress.py`**
- 源码对模块职责的说明：Issue-fix run-log status extensions.。
- 调用入口 `infer_issue_fix_skipped_stages(content)`；声明返回 `tuple[str, ...]`。
- 调用入口 `enrich_issue_fix_progress(progress, logs)`；声明返回 `dict[str, Any]`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import re`；`from typing import Any`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/auto_harness/issue_fix/run_progress.py#L1-L72)。
- **`jiuwenswarm/agents/harness/common/auto_harness/issue_fix/service.py`**
- 源码对模块职责的说明：Issue-fix facade that keeps GitCode issue handling out of core service.。
- `IssueFixService` 定义类型边界；方法入口：`__init__`, `handle`, `process_gitcode_issues_once`, `list_gitcode_issue_states`, `delete_issue_states`, `refresh_issue_matrix`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import os`；`from pathlib import Path`；`from typing import Any, Callable, Optional`。
- 模块级配置或常量名称：`RUNNING_STATUSES`；实际值与使用条件见源码。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/auto_harness/issue_fix/service.py#L1-L534)。
- **`jiuwenswarm/agents/harness/common/auto_harness/issue_fix/task_factory.py`**
- 源码对模块职责的说明：Task construction helpers for GitCode issue-fix runs.。
- 调用入口 `build_issue_fix_task(issue_number, query)`；声明返回 `OptimizationTask`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`from openjiuwen.rsi.harness_rsi.auto_harness.schema import OptimizationTask`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/auto_harness/issue_fix/task_factory.py#L1-L17)。
- **`jiuwenswarm/agents/harness/common/auto_harness/repo_auth/__init__.py`**
- 源码对模块职责的说明：Repository authentication helpers for auto-harness.。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from .gitcode import configure_gitcode_auth`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/auto_harness/repo_auth/__init__.py#L1-L7)。
- **`jiuwenswarm/agents/harness/common/auto_harness/repo_auth/gitcode.py`**
- 源码对模块职责的说明：GitCode repository authentication helpers.。
- 异步入口 `configure_gitcode_auth(local_path, username, token, push_remote)`；声明返回 `None`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import asyncio`；`import logging`；`from pathlib import Path`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/auto_harness/repo_auth/gitcode.py#L1-L64)。

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/agents-team/common-auto-harness/source-contracts-01.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
