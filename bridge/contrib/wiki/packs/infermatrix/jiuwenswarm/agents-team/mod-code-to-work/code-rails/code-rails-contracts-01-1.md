---
name: code-rails-contracts-01-1
description: code-rails 源码接口与集成边界 01 上半：harness/code/rails 的 __init__、code_agent_mode_rail、code_confirm_interrupt_rail、code_plan_approval_interrupt_rail、code_plan_approval_rail 声明
metadata:
  scope: 只收 harness/code/rails 顶层前五个文件的静态声明；heartbeat 子包声明归 code-rails-contracts-01-2，更后的文件归 code-rails-contracts-02
---
# code-rails 源码接口与集成边界 01（1/2）

## 现状

- 拆分说明：本页是源页 `source-contracts-01.md` 的第 1/2 部分；第 2 部分 [[code-rails-contracts-01-2]]
- 本页逐文件说明这一源码模块声明的接口、类型与依赖。记录来自静态源码声明，不证明控制流、配置生效、外部服务可用或测试通过；功能语义与设计取舍沿上级功能页继续阅读。
- **`jiuwenswarm/agents/harness/code/rails/__init__.py`**
- 集成依赖（导入声明，不等于全部运行时依赖）：`from jiuwenswarm.agents.harness.code.rails.code_task_planning_rail import C`；`from jiuwenswarm.agents.harness.code.rails.code_plan_approval_interrupt_rai`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/code/rails/__init__.py#L1-L13)。
- **`jiuwenswarm/agents/harness/code/rails/code_agent_mode_rail.py`**
- 源码对模块职责的说明：CodeAgentModeRail — plan-mode write enforcement for code mode.。
- `CodeAgentModeRail` 继承 `AgentModeRail`；方法入口：`init`, `before_tool_call`, `after_tool_call`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import json`；`import re`；`from typing import TYPE_CHECKING, Any`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/code/rails/code_agent_mode_rail.py#L1-L292)。
- **`jiuwenswarm/agents/harness/code/rails/code_confirm_interrupt_rail.py`**
- 源码对模块职责的说明：CodeConfirmInterruptRail — user-visible confirmation for sensitive control tools.。
- 调用入口 `build_confirm_interrupt_message(tool_name, tool_args)`；声明返回 `str`。
- `CodeConfirmInterruptRail` 继承 `ConfirmInterruptRail`；方法入口：`resolve_interrupt`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import json`；`from typing import Any, Optional`；`from openjiuwen.core.foundation.llm.schema.tool_call import ToolCall`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/code/rails/code_confirm_interrupt_rail.py#L1-L142)。
- **`jiuwenswarm/agents/harness/code/rails/code_plan_approval_interrupt_rail.py`**
- 源码对模块职责的说明：PlanApprovalInterruptRail — instant plan approval dialog for exit_plan_mode.。
- 调用入口 `is_plan_approval_message(message)`；声明返回 `bool`。
- 调用入口 `strip_inline_plan_approval_choices(message)`；声明返回 `str`。
- 调用入口 `extract_plan_approval_content(message)`；声明返回 `tuple[str, str]`。
- 调用入口 `build_plan_approval_options_from_message(message)`；声明返回 `list[dict[str, str]]`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`from typing import TYPE_CHECKING, Any, Optional`；`from openjiuwen.core.common.logging import logger`；`from openjiuwen.core.foundation.llm.schema.tool_call import ToolCall`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/code/rails/code_plan_approval_interrupt_rail.py#L1-L371)。
- **`jiuwenswarm/agents/harness/code/rails/code_plan_approval_rail.py`**
- 源码对模块职责的说明：PlanApprovalRail — pending-approval lifecycle for plan mode exit.。
- `PlanApprovalState` 定义类型边界；方法入口：`to_dict`。
- `PlanApprovalRail` 继承 `DeepAgentRail`；方法入口：`init`, `uninit`, `before_model_call`, `before_tool_call`, `after_tool_call`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`from dataclasses import dataclass`；`from pathlib import Path`；`from typing import TYPE_CHECKING, Any`。
- 模块级配置或常量名称：`PENDING_EXIT_RESULT_PREFIX`；实际值与使用条件见源码。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/code/rails/code_plan_approval_rail.py#L1-L226)。

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/agents-team/code-rails/source-contracts-01.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
