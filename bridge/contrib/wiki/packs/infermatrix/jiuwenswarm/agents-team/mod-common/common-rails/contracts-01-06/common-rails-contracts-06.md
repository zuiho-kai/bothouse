---
name: common-rails-contracts-06
description: common-rails 源码接口与集成边界 06：root_context.py、root_context_rail.py、root_permission_queue_rail.py、sandbox_profile.py、send_file_approval_scope.py、send_file_path_guard.py 等 11 个模块
metadata:
  scope: 只收 common/rails/permissions 下 root_context.py 至 tool_invocation_key.py 共 11 个源码文件的静态声明（接口、类型、依赖与源码依据链接）；同目录其余契约页是 common-rails-contracts-01、common-rails-contracts-02、common-rails-contracts-03、common-rails-contracts-04、common-rails-contracts-05、source-contracts-07、source-contracts-08
---
# common-rails 源码接口与集成边界 06

## 现状

- 本页逐文件说明这一源码模块声明的接口、类型与依赖。记录来自静态源码声明，不证明控制流、配置生效、外部服务可用或测试通过；功能语义与设计取舍沿上级功能页继续阅读。
- **`jiuwenswarm/agents/harness/common/rails/permissions/root_context.py`**
- 源码对模块职责的说明：Compact root-only authority for one permission decision.。
- `RootIntentTurnKind` 定义类型边界。
- `RootAskUserOption` 定义类型边界；方法入口：`to_mapping`, `from_mapping`。
- `RootAskUserClarification` 定义类型边界；方法入口：`to_mapping`, `from_mapping`。
- `RootIntentTurn` 定义类型边界；方法入口：`to_mapping`, `from_mapping`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import json`；`from collections.abc import Iterable, Mapping`；`from contextvars import ContextVar, Token`。
- 模块级配置或常量名称：`ROOT_CONTEXT_KEY`, `HOST_USER_MESSAGE_SOURCE`, `ROOT_INTENT_MAX_TURNS`, `ROOT_INTENT_MAX_TURN_CHARS`, `ROOT_INTENT_MAX_TOTAL_CHARS`, `AUTO_REVIEW_BLOCK_INTENT_INPUT_TOO_LARGE`, `AUTO_REVIEW_BLOCK_HISTORY_WINDOW_TRUNCATED`, `HOST_USER_PROMPT_PREFIX_ZH`；实际值与使用条件见源码。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/rails/permissions/root_context.py#L1-L528)。
- **`jiuwenswarm/agents/harness/common/rails/permissions/root_context_rail.py`**
- 源码对模块职责的说明：Bind the compact root permission context inside OpenJiuwen callbacks.。
- `RootContextRail` 继承 `DeepAgentRail`；方法入口：`__init__`, `before_invoke`, `after_invoke`, `before_task_iteration`, `after_task_iteration`, `before_tool_call`。
- 调用入口 `put_permission_owner_in_inputs(inputs, owner)`；声明返回 `dict[str, Any]`。
- 调用入口 `root_context_failure_from_context(ctx)`；声明返回 `str / None`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`from collections.abc import Mapping`；`from contextvars import ContextVar`；`from dataclasses import dataclass`。
- 模块级配置或常量名称：`ROOT_CONTEXT_RAIL_PRIORITY`, `ROOT_CONTEXT_FAILURE_ATTRIBUTE`, `ROOT_PERMISSION_OWNER_KEY`；实际值与使用条件见源码。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/rails/permissions/root_context_rail.py#L1-L403)。
- **`jiuwenswarm/agents/harness/common/rails/permissions/root_permission_queue_rail.py`**
- 源码对模块职责的说明：Root tool identity rail and missing-sibling permission latch.。
- `RootPermissionRequestBinding` 定义类型边界。
- `RootPermissionResume` 定义类型边界。
- `RootNonPermissionResume` 定义类型边界。
- `RootPermissionWrapperResume` 定义类型边界。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`from collections.abc import Callable, Mapping`；`from contextvars import ContextVar, Token`；`from copy import deepcopy`。
- 模块级配置或常量名称：`ROOT_PERMISSION_QUEUE_PRIORITY`, `ROOT_PERMISSION_COMPLETION_PRIORITY`, `ROOT_PERMISSION_QUEUE_USER_INPUT_KEY`, `ROOT_NON_PERMISSION_RESUME_DTO_KEY`, `TOOL_INVOCATION_CONTEXT_ATTRIBUTE`, `ROOT_PERMISSION_RESUME_ATTRIBUTE`, `ROOT_NON_PERMISSION_RESUME_ATTRIBUTE`,
  - `ROOT_PERMISSION_WRAPPERS_KEY`；实际值与使用条件见源码。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/rails/permissions/root_permission_queue_rail.py#L1-L517)。
- **`jiuwenswarm/agents/harness/common/rails/permissions/sandbox_profile.py`**
- 源码对模块职责的说明：Sandbox operation-context extraction for auto permissions.。
- `SandboxDescriptor` 定义类型边界。
- 调用入口 `build_sandbox_profile(sys_operation)`；声明返回 `SandboxDescriptor`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`from collections.abc import Mapping`；`from dataclasses import dataclass`；`from typing import Any`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/rails/permissions/sandbox_profile.py#L1-L48)。
- **`jiuwenswarm/agents/harness/common/rails/permissions/send_file_approval_scope.py`**
- 源码对模块职责的说明：Human approval scopes for file delivery path decisions.。
- `SendFileApprovalOutcome` 定义类型边界。
- `SendFileSessionApprovalStore` 定义类型边界；方法入口：`__init__`, `remember`, `matches`, `clear_session`, `clear_all`。
- `SendFileHumanApprovalBridge` 定义类型边界；方法入口：`__init__`, `session_store`, `apply`。
- 调用入口 `parse_human_approval_scope(payload)`；声明返回 `HumanApprovalScope / None`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import logging`；`import threading`；`from collections.abc import Callable, Mapping`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/rails/permissions/send_file_approval_scope.py#L1-L234)。
- **`jiuwenswarm/agents/harness/common/rails/permissions/send_file_path_guard.py`**
- 源码对模块职责的说明：Adapt multi-path file delivery to OpenJiuwen ''file_guard'' reads.。
- `SendFilePathGuardResult` 定义类型边界。
- `SendFilePathGuardEvaluator` 定义类型边界；方法入口：`evaluate`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import json`；`import logging`；`from collections.abc import Mapping, Sequence`。
- 模块级配置或常量名称：`SEND_FILE_TOOL_NAME`, `SEND_FILE_PATH_ARGUMENT`；实际值与使用条件见源码。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/rails/permissions/send_file_path_guard.py#L1-L315)。
- **`jiuwenswarm/agents/harness/common/rails/permissions/session_deny.py`**
- 源码对模块职责的说明：Session-scoped denial records for auto permissions.。
- `SessionDenyRecord` 定义类型边界。
- `SessionDenyStore` 定义类型边界；方法入口：`__init__`, `record_denial`, `matches`。
- 调用入口 `evaluate_session_deny(store, session_id, tool_name, tool_args)`；声明返回 `DecisionRoute / None`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import hashlib`；`import json`；`from collections.abc import Mapping`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/rails/permissions/session_deny.py#L1-L111)。
- **`jiuwenswarm/agents/harness/common/rails/permissions/tool_binding.py`**
- 源码对模块职责的说明：Read the current executable binding without making permission decisions.。
- 调用入口 `matches_bound_method(method, expected_owner, expected_func)`；声明返回 `bool`。
- 调用入口 `resolve_tool_binding(agent, tool_name, expected_type)`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from openjiuwen.core.runner import Runner`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/rails/permissions/tool_binding.py#L1-L25)。
- **`jiuwenswarm/agents/harness/common/rails/permissions/tool_capabilities.py`**
- 源码对模块职责的说明：Security-relevant tool capability taxonomy for auto permissions.。
- `ToolCapability` 定义类型边界。
- 调用入口 `shell_tool_names()`；声明返回 `list[str]`。
- 调用入口 `normalize_tool_name(tool_name)`；声明返回 `str`。
- 调用入口 `classify_tool(tool_name)`；声明返回 `ToolCapability`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`from dataclasses import dataclass`；`from jiuwenswarm.common.permission_tools import PERMISSION_TOOL_ALIASES, Pe`。
- 模块级配置或常量名称：`TOOL_CAPABILITY_FACTS_VERSION`, `HOST_STATIC_FACTS`, `NAME_CLASSIFICATION_HINT`, `UNKNOWN_FACTS`；实际值与使用条件见源码。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/rails/permissions/tool_capabilities.py#L1-L612)。
- **`jiuwenswarm/agents/harness/common/rails/permissions/tool_decision_facts.py`**
- 源码对模块职责的说明：Thin Host facts for one already-normalized root tool call.。
- `ToolDecisionFacts` 定义类型边界；方法入口：`tool_name`, `tool_category`, `paths`。
- `DecisionRoute` 定义类型边界；方法入口：`is_hard_block`, `requires_manual`, `requires_reviewer`, `is_deterministic_allow`, `accepted`, `allowed_outcomes`。
- 调用入口 `build_tool_decision_facts(tool_name, tool_args, workspace_root, platform_trusted_root, original_args_were_valid_object, external_paths, send_paths)`；声明返回 `ToolDecisionFacts`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`from collections.abc import Mapping, Sequence`；`from dataclasses import dataclass`；`from pathlib import Path`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/rails/permissions/tool_decision_facts.py#L1-L179)。
- **`jiuwenswarm/agents/harness/common/rails/permissions/tool_invocation_key.py`**
- 源码对模块职责的说明：Host-owned identity and lifecycle state for one logical tool invocation.。
- 调用入口 `normalize_tool_invocation_text(name, value, maximum)`；声明返回 `str`。
- `ToolInvocationKeyV1` 定义类型边界；方法入口：`to_wire`, `from_wire`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`from collections.abc import Mapping`；`from dataclasses import dataclass`；`from typing import Any, Literal, TypeAlias`。
- 模块级配置或常量名称：`TOOL_INVOCATION_KEY_VERSION`, `MAX_TOOL_INVOCATION_ID_LENGTH`；实际值与使用条件见源码。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/rails/permissions/tool_invocation_key.py#L1-L94)。

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/agents-team/common-rails/source-contracts-06.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
