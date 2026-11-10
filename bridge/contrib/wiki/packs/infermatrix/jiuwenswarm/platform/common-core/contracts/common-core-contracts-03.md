---
name: common-core-contracts-03
description: common-core 源码接口与集成边界 03：common/ 下 stage_timer.py、startup_diagnostics.py、task_loop_config.py、team_artifacts.py、todo_snapshot.py、tool_display.py、tool_ownership.py、updater.py、updater_restart_helper.py、upgrade_executor.py、utils.py、version.py、version_source.py、work_mode.py 的逐文件静态声明记录与源码链接
metadata:
  scope: 只收这 14 个文件的静态声明记录；其余 common/ 文件的记录分在 common-core-contracts-01、common-core-contracts-02、common-core-contracts-03、common-core-contracts-04 的其他几页
---
# common-core 源码接口与集成边界 03

## 现状

- 本页逐文件说明这一源码模块声明的接口、类型与依赖。记录来自静态源码声明，不证明控制流、配置生效、外部服务可用或测试通过；功能语义与设计取舍沿上级功能页继续阅读。
- **`jiuwenswarm/common/stage_timer.py`**
- 源码对模块职责的说明：Per-stage timing for a linear sequence of steps on a hot path.。
- `StageTimer` 定义类型边界；方法入口：`__init__`, `mark`, `total_ms`, `render`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`from time import monotonic`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/stage_timer.py#L1-L72)。
- **`jiuwenswarm/common/startup_diagnostics.py`**
- 源码对模块职责的说明：Early, stdlib-only diagnostics for frozen desktop startup failures.。
- 调用入口 `default_doctor_output_path()`；声明返回 `Path`。
- 调用入口 `run_doctor(import_module, platform_name, windows_dll_loader)`；声明返回 `dict[str, Any]`。
- 调用入口 `summarize_doctor_result(result)`；声明返回 `str`。
- 调用入口 `write_doctor_result(path, result)`；声明返回 `None`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import argparse`；`import importlib`；`import json`。
- 模块级配置或常量名称：`DOCTOR_FLAG`, `DOCTOR_WORKER_FLAG`, `DOCTOR_OUTPUT_FLAG`, `DOCTOR_SUMMARY_OUTPUT_FLAG`, `DOCTOR_TIMEOUT_SECONDS`, `DOCTOR_EXIT_OK`, `DOCTOR_EXIT_ENVIRONMENT_ERROR`, `DOCTOR_EXIT_INTERNAL_ERROR`；实际值与使用条件见源码。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/startup_diagnostics.py#L1-L583)。
- **`jiuwenswarm/common/task_loop_config.py`**
- 源码对模块职责的说明：Task-loop configuration helpers.。
- 调用入口 `resolve_task_loop_completion_timeout(config)`；声明返回 `float / None`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import math`；`from typing import Any`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/task_loop_config.py#L1-L26)。
- **`jiuwenswarm/common/team_artifacts.py`**
- 源码对模块职责的说明：Team-scoped final-deliverables and per-member work directories.。
- `TeamArtifactWorkspace` 定义类型边界。
- 调用入口 `get_team_artifacts_dir(team_ws_root)`；声明返回 `Path`。
- 调用入口 `get_team_artifact_workspace(team_ws_root, session_id, task_name)`；声明返回 `TeamArtifactWorkspace`。
- 调用入口 `resolve_member_work_dir(root_dir, member_name)`；声明返回 `Path`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import os`；`from dataclasses import dataclass`；`from pathlib import Path`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/team_artifacts.py#L1-L144)。
- **`jiuwenswarm/common/todo_snapshot.py`**
- 源码对模块职责的说明：Todo workspace snapshot helpers for frontend restore.。
- 调用入口 `format_todos_for_frontend(todos_data)`；声明返回 `list[dict[str, Any]]`。
- 调用入口 `session_uses_project_todo_dir(project_dir, work_mode, mode)`；声明返回 `bool`。
- 调用入口 `todo_snapshot_candidate_paths(session_id, project_dir, work_mode, mode)`；声明返回 `list[Path]`。
- 调用入口 `load_todo_snapshot_for_frontend(session_id, project_dir, work_mode, mode)`；声明返回 `list[dict[str, Any]]`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import json`；`from pathlib import Path`；`from typing import Any`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/todo_snapshot.py#L1-L202)。
- **`jiuwenswarm/common/tool_display.py`**
- 源码对模块职责的说明：工具调用展示辅助：call_goal schema 注入与参数剥离。。
- 调用入口 `inject_call_goal_schema(parameters)`；声明返回 `None`。
- 调用入口 `extract_call_goal(arguments)`；声明返回 `tuple[str, Any]`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import json`；`from typing import Any, Mapping`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/tool_display.py#L1-L87)。
- **`jiuwenswarm/common/tool_ownership.py`**
- 源码对模块职责的说明：Single source of truth for how a tool instance is registered process-wide.。
- 调用入口 `mark_stateless(tools)`；声明返回 `list[Any]`。
- 调用入口 `qualify_tool_id(card, owner_id)`；声明返回 `str`。
- 调用入口 `register_tool(tool, owner_id)`；声明返回 `None`。
- 调用入口 `unregister_tool(tool)`；声明返回 `None`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`from typing import Any`；`from openjiuwen.core.foundation.tool import ToolCard`；`from openjiuwen.core.runner import Runner`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/tool_ownership.py#L1-L112)。
- **`jiuwenswarm/common/updater.py`**
- 调用入口 `get_access_token()`；声明返回 `str`。
- `UpdateStatus` 定义类型边界。
- `UpdaterService` 定义类型边界；方法入口：`__init__`, `get_status`, `get_runtime_config`, `check`, `start_download`, `start_upgrade`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import os`；`import signal`；`import sys`。
- 模块级配置或常量名称：`DEFAULT_RELEASE_API_GITCODE`, `DEFAULT_RELEASE_API_GITHUB`, `DEFAULT_RELEASE_API_PYPI`, `DEFAULT_ASSET_PATTERN_LINUX`, `DEFAULT_TIMEOUT_SECONDS`, `DEFAULT_TEXT`, `DESKTOP_ENV_FLAG`, `DESKTOP_INSTALLER_SUFFIXES`；实际值与使用条件见源码。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/updater.py#L1-L572)。
- **`jiuwenswarm/common/updater_restart_helper.py`**
- 调用入口 `main()`；声明返回 `None`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import json`；`import logging`；`import os`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/updater_restart_helper.py#L1-L128)。
- **`jiuwenswarm/common/upgrade_executor.py`**
- 调用入口 `restart_pending_path()`；声明返回 `Path`。
- `UpgradeExecutor` 继承 `ABC`；方法入口：`__init__`, `install`, `upgrade`。
- `DesktopExecutor` 继承 `UpgradeExecutor`；方法入口：`__init__`, `install`。
- `PipExecutor` 继承 `UpgradeExecutor`；方法入口：`__init__`, `install`, `upgrade`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import json`；`import os`；`import shutil`。
- 模块级配置或常量名称：`DOWNLOAD_CHUNK_SIZE`；实际值与使用条件见源码。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/upgrade_executor.py#L1-L439)。
- **`jiuwenswarm/common/utils.py`**
- 源码对模块职责的说明：Path management for JiuWenSwarm.。
- `CopyDiffResult` 定义类型边界。
- `TrackCopyDiff` 定义类型边界；方法入口：`__init__`。
- `LoggingLevels` 定义类型边界。
- `SafeRotatingFileHandler` 继承 `BaseRotatingHandler`；方法入口：`__init__`, `shouldRollover`, `doRollover`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`import ctypes`；`import hashlib`；`import json`；`import os`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/utils.py#L1-L3031)。
- **`jiuwenswarm/common/version.py`**
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`from jiuwenswarm.common._build_config import VERSION`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/version.py#L1-L6)。
- **`jiuwenswarm/common/version_source.py`**
- 调用入口 `is_prerelease_version(version)`；声明返回 `bool`。
- 调用入口 `strip_prerelease_suffix(version)`；声明返回 `str`。
- 调用入口 `release_sort_key(version)`；声明返回 `tuple[tuple[int, ...], int, tuple[int, ...]]`。
- 调用入口 `release_timestamp_key(value)`；声明返回 `datetime`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import json`；`import logging`；`import re`。
- 模块级配置或常量名称：`DEFAULT_TIMEOUT_SECONDS`, `RELEASES_PER_PAGE`, `MAX_RELEASE_PAGES`, `GITHUB_API`, `GITCODE_API`, `PYPI_SIMPLE_API`；实际值与使用条件见源码。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/version_source.py#L1-L640)。
- **`jiuwenswarm/common/work_mode.py`**
- 源码对模块职责的说明：工作模式（work_mode）共享基础设施。。
- 调用入口 `normalize_work_mode(raw, default)`；声明返回 `str`。
- 调用入口 `is_default_project_id(project_id)`；声明返回 `bool`。
- 调用入口 `resolve_default_project_id(work_mode)`；声明返回 `str`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`from typing import Any`。
- 模块级配置或常量名称：`DEFAULT_WEB_WORK_MODE`, `DEFAULT_TUI_WORK_MODE`, `SUPPORTED_WORK_MODES`, `DEFAULT_PROJECT_ID_WORK`, `DEFAULT_PROJECT_ID_CODE`, `DEFAULT_PROJECT_IDS`；实际值与使用条件见源码。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/work_mode.py#L1-L51)。

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/common-core/source-contracts-03.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
