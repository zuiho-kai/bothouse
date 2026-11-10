---
name: code-prompt-contracts-01
description: code-prompt 源码接口与集成边界 01：harness/code/prompt 的 __init__、code_prompt_builder（CodePromptPriority、build_code_system_prompt）、code_todo_tool_prompts、plan_approval 声明
metadata:
  scope: 只收 harness/code/prompt 下四个文件的静态声明；code 顶层 spec.py 归 code-contracts-01
---
# code-prompt 源码接口与集成边界 01

## 现状

- 本页逐文件说明这一源码模块声明的接口、类型与依赖。记录来自静态源码声明，不证明控制流、配置生效、外部服务可用或测试通过；功能语义与设计取舍沿上级功能页继续阅读。
- **`jiuwenswarm/agents/harness/code/prompt/__init__.py`**
- 源码对模块职责的说明：Code mode prompt builder — independent from the general agent prompt system.。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from jiuwenswarm.agents.harness.code.prompt.code_prompt_builder import buil`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/code/prompt/__init__.py#L1-L11)。
- **`jiuwenswarm/agents/harness/code/prompt/code_prompt_builder.py`**
- 源码对模块职责的说明：Code mode prompt builder — English-only.。
- `CodePromptPriority` 继承 `IntEnum`。
- 调用入口 `build_code_system_prompt()`；声明返回 `str`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`from enum import IntEnum`；`from openjiuwen.harness.prompts import PromptSection, SystemPromptBuilder`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/code/prompt/code_prompt_builder.py#L1-L507)。
- **`jiuwenswarm/agents/harness/code/prompt/code_todo_tool_prompts.py`**
- 源码对模块职责的说明：CC-aligned todo tool descriptions and schemas for code mode.。
- 调用入口 `get_code_todo_create_input_params()`；声明返回 `dict[str, Any]`。
- 调用入口 `get_code_todo_modify_input_params()`；声明返回 `dict[str, Any]`。
- 调用入口 `get_code_todo_get_input_params()`；声明返回 `dict[str, Any]`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`from typing import Any`。
- 模块级配置或常量名称：`CODE_TODO_CREATE_DESCRIPTION_EN`, `CODE_TODO_LIST_DESCRIPTION_EN`, `CODE_TODO_GET_DESCRIPTION_EN`, `CODE_TODO_MODIFY_DESCRIPTION_EN`, `CODE_TODO_TOOL_PROMPTS`；实际值与使用条件见源码。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/code/prompt/code_todo_tool_prompts.py#L1-L173)。
- **`jiuwenswarm/agents/harness/code/prompt/plan_approval.py`**
- 源码对模块职责的说明：Plan approval definitions — templates and helpers.。
- 调用入口 `plan_skip_feedback(language)`；声明返回 `str`。
- 调用入口 `build_plan_approval_actions(language)`；声明返回 `list[dict[str, str]]`。
- 调用入口 `wrap_plan_revision_feedback(user_message, language)`；声明返回 `str`。
- 调用入口 `classify_plan_user_intent(user_message)`；声明返回 `PlanUserIntent`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import re`；`from typing import Literal`。
- 模块级配置或常量名称：`PLAN_APPROVAL_EVENT_TYPE`, `PLAN_MODE_EXITED_EVENT_TYPE`, `APPROVE_CMD_PREFIX`, `REJECT_CMD_PREFIX`, `PLAN_USER_APPROVED_FLAG`, `PLAN_SKIP_PAYLOAD_KEY`, `PLAN_SKIP_OPTION_VALUES`, `PLAN_SKIP_FEEDBACK`；实际值与使用条件见源码。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/code/prompt/plan_approval.py#L1-L391)。

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/agents-team/code-prompt/source-contracts-01.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
