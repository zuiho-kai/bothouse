---
name: team-rails-contracts-01
description: team-rails 源码接口与集成边界 01：harness/team/rails 下 team_member_skill_toolkit_rail、team_permission_policy_rail、team_skill_library_reload_rail、team_skill_storage_policy_rail、team_workspace_report_path_rail 的声明
metadata:
  scope: 只收 harness/team/rails 下五个文件的静态声明；team 根目录文件归 team-contracts-01
---
# team-rails 源码接口与集成边界 01

## 现状

- 本页逐文件说明这一源码模块声明的接口、类型与依赖。记录来自静态源码声明，不证明控制流、配置生效、外部服务可用或测试通过；功能语义与设计取舍沿上级功能页继续阅读。
- **`jiuwenswarm/agents/harness/team/rails/team_member_skill_toolkit_rail.py`**
- 源码对模块职责的说明：Register member-scoped skill-management tools for team mode.。
- `MemberSkillToolkitRail` 继承 `DeepAgentRail`；方法入口：`__init__`, `init`, `uninit`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import inspect`；`import logging`；`from collections.abc import Awaitable, Callable`。
- 模块级配置或常量名称：`SKILL_LIBRARY_MUTATING_TOOLS`；实际值与使用条件见源码。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/team/rails/team_member_skill_toolkit_rail.py#L1-L152)。
- **`jiuwenswarm/agents/harness/team/rails/team_permission_policy_rail.py`**
- 源码对模块职责的说明：Inject team permission policy into member prompts.。
- `TeamPermissionPolicyRail` 继承 `DeepAgentRail`；方法入口：`__init__`, `init`, `uninit`, `before_model_call`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`from typing import Any`；`from openjiuwen.agent_teams.security.narrowing import format_base_permissio`；`from openjiuwen.core.single_agent.rail.base import AgentCallbackContext`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/team/rails/team_permission_policy_rail.py#L1-L76)。
- **`jiuwenswarm/agents/harness/team/rails/team_skill_library_reload_rail.py`**
- 源码对模块职责的说明：Reload member Skill views after writes into the global Skill library.。
- 异步入口 `reload_agent_skill_views(agent)`；声明返回 `int`。
- `TeamSkillLibraryReloadRail` 继承 `DeepAgentRail`；方法入口：`__init__`, `after_tool_call`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import inspect`；`import json`；`import logging`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/team/rails/team_skill_library_reload_rail.py#L1-L147)。
- **`jiuwenswarm/agents/harness/team/rails/team_skill_storage_policy_rail.py`**
- 源码对模块职责的说明：Inject team skill storage policy into member prompts.。
- `TeamSkillStoragePolicyRail` 继承 `DeepAgentRail`；方法入口：`__init__`, `init`, `uninit`, `before_model_call`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`from openjiuwen.agent_teams.paths import SKILL_VISIBILITY_FILENAME`；`from openjiuwen.core.single_agent.rail.base import AgentCallbackContext`；`from openjiuwen.harness.prompts import PromptSection`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/team/rails/team_skill_storage_policy_rail.py#L1-L140)。
- **`jiuwenswarm/agents/harness/team/rails/team_workspace_report_path_rail.py`**
- 源码对模块职责的说明：Prompt rail separating project deliverables from team-shared outputs.。
- `TeamWorkspaceReportPathRail` 继承 `DeepAgentRail`；方法入口：`__init__`, `bind_swarm_context`, `init`, `uninit`, `before_model_call`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import logging`；`from pathlib import Path`；`from typing import Any`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/team/rails/team_workspace_report_path_rail.py#L1-L196)。

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/agents-team/team-rails/source-contracts-01.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
