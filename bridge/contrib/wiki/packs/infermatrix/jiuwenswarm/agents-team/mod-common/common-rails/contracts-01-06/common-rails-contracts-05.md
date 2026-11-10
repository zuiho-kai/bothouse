---
name: common-rails-contracts-05
description: common-rails 源码接口与集成边界 05：permission_interaction.py、permissions_config_rpc.py、permissions_layers.py、permissions_persist.py、persistent_audit.py、protected_paths.py 等 11 个模块
metadata:
  scope: 只收 common/rails/permissions 下 permission_interaction.py 至 root_permission_queue.py 共 11 个源码文件的静态声明（接口、类型、依赖与源码依据链接）；同目录其余契约页是 common-rails-contracts-01、common-rails-contracts-02、common-rails-contracts-03、common-rails-contracts-04、common-rails-contracts-06、source-contracts-07、source-contracts-08
---
# common-rails 源码接口与集成边界 05

## 现状

- 本页逐文件说明这一源码模块声明的接口、类型与依赖。记录来自静态源码声明，不证明控制流、配置生效、外部服务可用或测试通过；功能语义与设计取舍沿上级功能页继续阅读。
- **`jiuwenswarm/agents/harness/common/rails/permissions/permission_interaction.py`**
- 源码对模块职责的说明：Minimal permission-interaction presentation facts.。
- 调用入口 `contains_permission_interaction(value)`；声明返回 `bool`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`from collections.abc import Mapping`；`from typing import Any`。
- 模块级配置或常量名称：`PERMISSION_RUNTIME_QUARANTINED_KEY`；实际值与使用条件见源码。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/rails/permissions/permission_interaction.py#L1-L54)。
- **`jiuwenswarm/agents/harness/common/rails/permissions/permissions_config_rpc.py`**
- 源码对模块职责的说明：Permissions 配置 RPC（宿主侧）。。
- 调用入口 `get_permissions_config_req_methods()`；声明返回 `frozenset[ReqMethod]`。
- 调用入口 `dispatch_permissions_config_request(request)`；声明返回 `AgentResponse`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import logging`；`from typing import Any`；`from jiuwenswarm.common.schema.agent import AgentRequest, AgentResponse`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/rails/permissions/permissions_config_rpc.py#L1-L203)。
- **`jiuwenswarm/agents/harness/common/rails/permissions/permissions_layers.py`**
- 源码对模块职责的说明：Load and persist User / Session permission overlays.。
- 调用入口 `permission_storage_lock(session_id, lock_timeout)`。
- 调用入口 `user_permissions_path()`；声明返回 `Path`。
- 调用入口 `session_permissions_path(session_id)`；声明返回 `Path`。
- 调用入口 `load_global_permissions()`；声明返回 `dict[str, Any]`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import logging`；`from contextlib import ExitStack, contextmanager`；`from pathlib import Path`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/rails/permissions/permissions_layers.py#L1-L400)。
- **`jiuwenswarm/agents/harness/common/rails/permissions/permissions_persist.py`**
- 源码对模块职责的说明：权限配置落盘（宿主侧）。。
- 调用入口 `build_command_allow_pattern(cmd)`；声明返回 `str`。
- 调用入口 `persist_permission_allow_rule(tool_name, tool_args)`；声明返回 `bool`。
- 调用入口 `persist_exact_permission_allow_rule(tool_name, tool_args, ask_accesses, session_id, workspace_root)`；声明返回 `bool`。
- 调用入口 `persist_external_directory_allow(paths, actions)`；声明返回 `None`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import hashlib`；`import json`；`import logging`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/rails/permissions/permissions_persist.py#L1-L411)。
- **`jiuwenswarm/agents/harness/common/rails/permissions/persistent_audit.py`**
- 源码对模块职责的说明：Append-only persistent audit for auto-permission decisions.。
- `PersistentAuditWriteResult` 定义类型边界。
- `PersistentAuditWriter` 定义类型边界；方法入口：`__init__`, `audit_path`, `write`。
- 调用入口 `resolve_persistent_audit_root(config)`；声明返回 `Path / None`。
- 调用入口 `build_sanitized_audit_fields(facts, decision, reason, degraded, grant_id, grant_reason, extra)`；声明返回 `dict[str, Any]`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import json`；`import os`；`import re`。
- 模块级配置或常量名称：`AUDIT_SCHEMA_VERSION`, `AUDIT_SUBDIRECTORY`, `AUDIT_FILENAME`, `AUDIT_DIGEST_ALGORITHM`, `DATA_DIR_ENV_NAME`, `MAX_AUDIT_TEXT_LENGTH`, `AUDIT_TEXT_REDACTED`, `EXTRA_ALLOWLIST`；实际值与使用条件见源码。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/rails/permissions/persistent_audit.py#L1-L296)。
- **`jiuwenswarm/agents/harness/common/rails/permissions/protected_paths.py`**
- 源码对模块职责的说明：Central protected path defaults for JiuwenClaw auto permission.。
- 调用入口 `merge_protected_write_paths(*path_groups)`；声明返回 `tuple[str, ...]`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`。
- 模块级配置或常量名称：`JIUWENCLAW_PROTECTED_WRITE_PATHS`；实际值与使用条件见源码。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/rails/permissions/protected_paths.py#L1-L26)。
- **`jiuwenswarm/agents/harness/common/rails/permissions/reviewer_redaction.py`**
- 源码对模块职责的说明：Shared redaction helpers for AutoReviewer evidence.。
- 调用入口 `redact_text(value, max_length)`；声明返回 `str`。
- 调用入口 `reviewer_path_location(raw_path, workspace_root, platform_trusted_root)`；声明返回 `tuple[dict[str, str] / None, str]`。
- 调用入口 `redact_reviewer_intent(value, workspace_root, platform_trusted_root, max_length)`；声明返回 `str`。
- 调用入口 `redact_reviewable_payload_text(value, max_length, redact_relative_paths)`；声明返回 `str`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import json`；`import re`；`import unicodedata`。
- 模块级配置或常量名称：`DEFAULT_MAX_REDACTED_TEXT_LENGTH`, `DEFAULT_MAX_REDACTED_ITEMS`, `REVIEWABLE_PAYLOAD_TEXT_LIMIT`, `PERMISSION_UI_PAYLOAD_MAX_DEPTH`, `PERMISSION_UI_PAYLOAD_MAX_ITEMS`, `PERMISSION_UI_PAYLOAD_MAX_STRING_LENGTH`, `PERMISSION_UI_PAYLOAD_MAX_TOTAL_BYTES`, `PERMISSION_UI_REDACTED`；
  - 实际值与使用条件见源码。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/rails/permissions/reviewer_redaction.py#L1-L692)。
- **`jiuwenswarm/agents/harness/common/rails/permissions/reviewer_route.py`**
- 源码对模块职责的说明：Compact Host routing for the stateless semantic reviewer.。
- 调用入口 `reviewer_route(facts, policy_level, guard_result, workspace_root, delivery_max_files, delivery_excluded_paths, original_user_intent, domain_route, recent_url_sources)`；声明返回 `DecisionRoute`。
- 调用入口 `file_delivery_manual_reason(facts, workspace_root, max_files, excluded_paths)`；声明返回 `str`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import re`；`import unicodedata`；`from pathlib import Path`。
- 模块级配置或常量名称：`SEMANTIC_REVIEW_SOURCE`, `MANUAL_REVIEW_SOURCE`, `HARD_BLOCK_SOURCE`, `RECENT_FETCH_SOURCE`, `ALLOWABLE_REVIEWER_OUTCOMES`, `WORKSPACE_WRITE_TOOLS`, `USER_PATH_TOOLS`, `DEFAULT_DELIVERY_EXCLUDED_PATHS`；实际值与使用条件见源码。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/rails/permissions/reviewer_route.py#L1-L330)。
- **`jiuwenswarm/agents/harness/common/rails/permissions/reviewer_stream_metadata.py`**
- 源码对模块职责的说明：Callback-local Reviewer metadata used by progress and terminal projection.。
- 调用入口 `record_reviewer_tool_result_metadata(extra, tool_call_id, metadata)`；声明返回 `None`。
- 调用入口 `consume_reviewer_tool_result_metadata(extra, tool_call_id)`；声明返回 `dict[str, Any] / None`。
- 调用入口 `peek_reviewer_tool_result_metadata(extra, tool_call_id)`；声明返回 `dict[str, Any] / None`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import copy`；`from collections.abc import Mapping, MutableMapping`；`from typing import Any`。
- 模块级配置或常量名称：`REVIEWER_TOOL_RESULT_METADATA_EXTRA_KEY`；实际值与使用条件见源码。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/rails/permissions/reviewer_stream_metadata.py#L1-L57)。
- **`jiuwenswarm/agents/harness/common/rails/permissions/root_ask_user.py`**
- 源码对模块职责的说明：Compact ordinary ''ask_user'' continuation owned by the root Host.。
- `AskUserQuestionReference` 定义类型边界；方法入口：`to_mapping`, `from_mapping`。
- `RootAskUserContinuation` 定义类型边界。
- `RootAskUserResume` 定义类型边界。
- 调用入口 `put_ask_user_resume_in_inputs(inputs, prepared)`；声明返回 `dict[str, Any]`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import json`；`from collections.abc import Mapping`；`from dataclasses import dataclass, replace`。
- 模块级配置或常量名称：`ASK_USER_TOOL_NAME`, `ASK_USER_CONTINUATION_METADATA_KEY`, `ASK_USER_RESUME_DTO_KEY`；实际值与使用条件见源码。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/rails/permissions/root_ask_user.py#L1-L280)。
- **`jiuwenswarm/agents/harness/common/rails/permissions/root_permission_queue.py`**
- 源码对模块职责的说明：Root-only per-card permission queue built on Core sparse resume.。
- `RootPermissionQueueError` 继承 `ValueError`。
- `RootPermissionCard` 定义类型边界。
- `RootPermissionSnapshot` 定义类型边界。
- `RootPermissionAnswer` 定义类型边界。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import secrets`；`import threading`；`from collections.abc import Callable, Mapping`。
- 模块级配置或常量名称：`MAX_ROOT_PERMISSION_CARDS`；实际值与使用条件见源码。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/rails/permissions/root_permission_queue.py#L1-L633)。

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/agents-team/common-rails/source-contracts-05.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
