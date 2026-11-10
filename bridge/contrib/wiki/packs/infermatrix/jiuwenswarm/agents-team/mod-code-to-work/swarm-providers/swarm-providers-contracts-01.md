---
name: swarm-providers-contracts-01
description: swarm-providers 源码接口与集成边界 01：swarm/providers 下 builtin_rails、code_rails、evolution_rails、member_rails、runtime_tools、tools 六个文件的声明
metadata:
  scope: 只收 swarm/providers 下六个文件的静态声明；swarm 包根目录文件归 swarm-contracts-01
---
# swarm-providers 源码接口与集成边界 01

## 现状

- 本页逐文件说明这一源码模块声明的接口、类型与依赖。记录来自静态源码声明，不证明控制流、配置生效、外部服务可用或测试通过；功能语义与设计取舍沿上级功能页继续阅读。
- **`jiuwenswarm/agents/swarm/providers/builtin_rails.py`**
- 源码对模块职责的说明：No-factory class-rail declarations for swarm-owned team rails.。
- `ResponsePromptInput` 继承 `ConstructionInput`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`from typing import Any`；`from openjiuwen.agent_teams.harness.manifest import ConstructionInput, Elem`；`from jiuwenswarm.agents.harness.common.rails.avatar_rail import AvatarPromp`。
- 模块级配置或常量名称：`RESPONSE_PROMPT`, `STREAM_EVENT`, `AVATAR_PROMPT`, `MULTIMODAL_IMAGE`；实际值与使用条件见源码。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/swarm/providers/builtin_rails.py#L1-L96)。
- **`jiuwenswarm/agents/swarm/providers/code_rails.py`**
- 源码对模块职责的说明：Config-sourced code-mode rail providers for swarm team assembly.。
- 调用入口 `code_runtime_language(ctx)`；声明返回 `str`。
- 调用入口 `structured_ask_user_language(ctx)`；声明返回 `str`。
- `CodeRuntimePromptInput` 继承 `ConstructionInput`。
- 调用入口 `build_code_runtime_prompt(params, ctx)`；声明返回 `Any`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import logging`；`from typing import Any`；`from openjiuwen.agent_teams.harness.manifest import ConstructionInput, cont`。
- 模块级配置或常量名称：`CODE_RUNTIME_PROMPT`, `CODE_PROJECT_MEMORY`, `PERMISSION_INTERRUPT`, `CODE_CODING_MEMORY`, `CODE_AGENT_MODE`, `TEAM_PLAN_APPROVAL`, `STRUCTURED_ASK_USER`, `CODE_TASK_PLANNING`；实际值与使用条件见源码。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/swarm/providers/code_rails.py#L1-L559)。
- **`jiuwenswarm/agents/swarm/providers/evolution_rails.py`**
- 源码对模块职责的说明：Skill-evolution rail providers for swarm provider-based team assembly.。
- 调用入口 `build_symphony_graph_evolution_rail(params, ctx)`；声明返回 `Any / None`。
- `SwarmTeamSkillEvolutionRail` 继承 `TeamSkillEvolutionRail`；方法入口：`bind_swarm_context`, `init`。
- `SwarmTeamSkillCreateRail` 继承 `TeamSkillCreateRail`；方法入口：`bind_swarm_context`, `init`。
- `SwarmMemberSkillEvolutionRail` 继承 `SkillEvolutionRail`；方法入口：`bind_swarm_context`, `init`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import logging`；`from pathlib import Path`；`from typing import Any`。
- 模块级配置或常量名称：`TEAM_SKILL_EVOLUTION`, `TEAM_SKILL_CREATE`, `MEMBER_SKILL_EVOLUTION`, `EVOLUTION_INTERRUPT`, `SYMPHONY_GRAPH_EVOLUTION`；实际值与使用条件见源码。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/swarm/providers/evolution_rails.py#L1-L865)。
- **`jiuwenswarm/agents/swarm/providers/member_rails.py`**
- 源码对模块职责的说明：Swarm member rail providers (config-sourced, per-member).。
- `SkillRetrievalPromptInput` 继承 `ConstructionInput`。
- `RuntimePromptInput` 继承 `ConstructionInput`。
- `TeamSkillStoragePolicyInput` 继承 `ConstructionInput`。
- `TeamSkillLibraryReloadInput` 继承 `ConstructionInput`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import logging`；`from pathlib import Path`；`from types import SimpleNamespace`。
- 模块级配置或常量名称：`PERSONAL_CONTEXT`, `RUNTIME_PROMPT`, `TEAM_SKILL_STORAGE_POLICY`, `TEAM_SKILL_LIBRARY_RELOAD`, `TEAM_WORKSPACE_REPORT_PATH`, `CONTEXT_PROCESSOR`, `MODEL_ANOMALY_DETECTION`, `PLUGIN_RAILS`；实际值与使用条件见源码。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/swarm/providers/member_rails.py#L1-L758)。
- **`jiuwenswarm/agents/swarm/providers/runtime_tools.py`**
- 源码对模块职责的说明：Runtime tool providers for swarm provider-based team assembly.。
- `CronToolsInput` 继承 `ConstructionInput`。
- 调用入口 `build_cron_tools(params, ctx)`；声明返回 `list[Any]`。
- `SendFileInput` 继承 `ConstructionInput`。
- 调用入口 `build_send_file_tools(params, ctx)`；声明返回 `list[Any]`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import logging`；`from types import SimpleNamespace`；`from typing import Any`。
- 模块级配置或常量名称：`CRON_TOOLS`, `SEND_FILE`；实际值与使用条件见源码。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/swarm/providers/runtime_tools.py#L1-L287)。
- **`jiuwenswarm/agents/swarm/providers/tools.py`**
- 源码对模块职责的说明：Config-sourced swarm-owned tool providers for team assembly.。
- 调用入口 `visible_skill_names_for_list_skill(ctx)`；声明返回 `set[str]`。
- 调用入口 `vision_model_config_params(config)`；声明返回 `dict[str, Any]`。
- 调用入口 `audio_dedicated_configured(config)`；声明返回 `bool`。
- 调用入口 `audio_model_config_params(config)`；声明返回 `dict[str, Any]`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import logging`；`import os`；`from pathlib import Path`。
- 模块级配置或常量名称：`SKILL_TOOLKIT`, `SKILL_RETRIEVAL`, `USER_TODOS`, `VIDEO`, `IMAGE_GEN`, `VIDEO_GEN`, `VISUAL_GEN`, `XIAOYI_PHONE`；实际值与使用条件见源码。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/swarm/providers/tools.py#L1-L653)。

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/agents-team/swarm-providers/source-contracts-01.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
