---
name: common-rails-contracts-02
description: common-rails 源码接口与集成边界 02：interrupt_helpers、permission_options、memory_forbidden_rail、multimodal_image_rail 与 permissions/_auto_permission 前八个模块的声明
metadata:
  scope: 只收 interrupt 目录、memory_forbidden_rail、multimodal_image_rail、permissions/__init__ 与 _auto_permission 的 artifact_authorization 至 domain_manual 的静态声明；前半部分归 common-rails-contracts-01，其余 _auto_permission 文件归 common-rails-contracts-03
---
# common-rails 源码接口与集成边界 02

## 现状

- 本页逐文件说明这一源码模块声明的接口、类型与依赖。记录来自静态源码声明，不证明控制流、配置生效、外部服务可用或测试通过；功能语义与设计取舍沿上级功能页继续阅读。
- **`jiuwenswarm/agents/harness/common/rails/interrupt/interrupt_helpers.py`**
- 源码对模块职责的说明：Interrupt helpers for DeepAgent.。
- 调用入口 `resolve_permission_workspace_dir(session_id)`；声明返回 `Path`。
- 调用入口 `merge_permission_trusted_dirs(trusted_dirs, project_dir)`；声明返回 `list[str]`。
- 调用入口 `apply_permission_trusted_dirs(rail, trusted_dirs, project_dir)`；声明返回 `None`。
- 调用入口 `has_interrupt_resume_payload(params)`；声明返回 `bool`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import copy`；`import json`；`import re`。
- 模块级配置或常量名称：`SKILL_EVOLUTION_APPROVAL_SCHEMA`, `EVOLUTION_INTERRUPT_SOURCE`, `LEGACY_SKILL_EVOLUTION_APPROVAL_SOURCE`, `INTERRUPT_RESUME_SOURCES`, `EVOLUTION_INTERRUPT_METADATA_SOURCES`, `SKILL_EVOLUTION_APPROVAL_TOOL_KINDS`；实际值与使用条件见源码。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/rails/interrupt/interrupt_helpers.py#L1-L1508)。
- **`jiuwenswarm/agents/harness/common/rails/interrupt/permission_options.py`**
- 源码对模块职责的说明：权限/确认审批选项的统一词表。。
- 调用入口 `normalize_option_value(value)`；声明返回 `str`。
- 调用入口 `resolve_permission_action(value)`；声明返回 `str / None`。
- 调用入口 `is_keep_planning_value(value)`；声明返回 `bool`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import re`。
- 模块级配置或常量名称：`ALLOW_ONCE`, `SESSION_ALLOW`, `ALWAYS_ALLOW`, `REJECT`；实际值与使用条件见源码。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/rails/interrupt/permission_options.py#L1-L92)。
- **`jiuwenswarm/agents/harness/common/rails/memory_forbidden_rail.py`**
- 源码对模块职责的说明：Execution-time guard for sensitive information written to memory.。
- `MemoryForbiddenRail` 继承 `DeepAgentRail`；方法入口：`before_model_call`, `before_tool_call`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import json`；`from pathlib import PurePath`；`from typing import Any`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/rails/memory_forbidden_rail.py#L1-L255)。
- **`jiuwenswarm/agents/harness/common/rails/multimodal_image_rail.py`**
- 源码对模块职责的说明：Multimodal image input adaptation for Core model calls.。
- `MultimodalImageRail` 继承 `DeepAgentRail`；方法入口：`__init__`, `init`, `before_model_call`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`from typing import Any`；`from openjiuwen.core.single_agent.rail.base import AgentCallbackContext`；`from openjiuwen.harness.rails.base import DeepAgentRail`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/rails/multimodal_image_rail.py#L1-L60)。
- **`jiuwenswarm/agents/harness/common/rails/permissions/__init__.py`**
- 源码对模块职责的说明：Security and permission integration for AgentServer.。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`from importlib import import_module`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/rails/permissions/__init__.py#L1-L95)。
- **`jiuwenswarm/agents/harness/common/rails/permissions/_auto_permission/artifact_authorization.py`**
- 源码对模块职责的说明：Exact file-delivery authorization for Smart Approval decisions.。
- 调用入口 `has_user_file_delivery_prohibition(text)`；声明返回 `bool`。
- 调用入口 `is_file_delivery_action(facts)`；声明返回 `bool`。
- `AutoPermissionArtifactAuthorizationMixin` 定义类型边界。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import re`；`from collections.abc import Mapping`；`from pathlib import Path`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/rails/permissions/_auto_permission/artifact_authorization.py#L1-L132)。
- **`jiuwenswarm/agents/harness/common/rails/permissions/_auto_permission/artifact_declaration.py`**
- 源码对模块职责的说明：Exact send-file argument helpers.。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`from pathlib import Path`；`from jiuwenswarm.agents.harness.common.rails.permissions.tool_decision_fact`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/rails/permissions/_auto_permission/artifact_declaration.py#L1-L15)。
- **`jiuwenswarm/agents/harness/common/rails/permissions/_auto_permission/artifact_tracking_capture.py`**
- 源码对模块职责的说明：Generic after-tool capture for Auto Permission.。
- `AutoPermissionArtifactCaptureMixin` 定义类型边界；方法入口：`after_tool_call`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`from typing import Any`；`from jiuwenswarm.agents.harness.common.rails.permissions._auto_permission.i`；`from jiuwenswarm.server.runtime.sandbox_no_host_fallback import clear_no_ho`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/rails/permissions/_auto_permission/artifact_tracking_capture.py#L1-L23)。
- **`jiuwenswarm/agents/harness/common/rails/permissions/_auto_permission/before_tool.py`**
- 源码对模块职责的说明：Migrated Auto Permission before tool slice.。
- `AutoPermissionBeforeToolMixin` 定义类型边界；方法入口：`before_tool_call`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import asyncio`；`from collections.abc import Mapping`；`from typing import Any`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/rails/permissions/_auto_permission/before_tool.py#L1-L966)。
- **`jiuwenswarm/agents/harness/common/rails/permissions/_auto_permission/deny_response.py`**
- 源码对模块职责的说明：Migrated Auto Permission deny response slice.。
- `AutoPermissionDenyResponseMixin` 定义类型边界。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`from collections.abc import Mapping, MutableMapping`；`from typing import Any`；`from jiuwenswarm.agents.harness.common.rails.permissions._auto_permission.d`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/rails/permissions/_auto_permission/deny_response.py#L1-L86)。
- **`jiuwenswarm/agents/harness/common/rails/permissions/_auto_permission/deterministic.py`**
- 源码对模块职责的说明：Migrated Auto Permission deterministic slice.。
- `AutoPermissionDeterministicMixin` 定义类型边界。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`from typing import Any`；`from jiuwenswarm.agents.harness.common.rails.permissions._auto_permission.m`；`from jiuwenswarm.agents.harness.common.rails.permissions._auto_permission.r`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/rails/permissions/_auto_permission/deterministic.py#L1-L131)。
- **`jiuwenswarm/agents/harness/common/rails/permissions/_auto_permission/domain_grant_audit.py`**
- 源码对模块职责的说明：Compact fixed-domain routing and response handling.。
- `AutoPermissionDomainGrantAuditMixin` 定义类型边界。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`from typing import Any`；`from jiuwenswarm.agents.harness.common.rails.permissions._auto_permission.d`；`from jiuwenswarm.agents.harness.common.rails.permissions._auto_permission.m`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/rails/permissions/_auto_permission/domain_grant_audit.py#L1-L162)。
- **`jiuwenswarm/agents/harness/common/rails/permissions/_auto_permission/domain_manual.py`**
- 源码对模块职责的说明：Compact permission response helpers shared by manual and deny paths.。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`from collections.abc import Mapping`；`from typing import Any`；`from jiuwenswarm.agents.harness.common.rails.permissions.tool_decision_fact`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/rails/permissions/_auto_permission/domain_manual.py#L1-L43)。

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/agents-team/common-rails/source-contracts-02.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
