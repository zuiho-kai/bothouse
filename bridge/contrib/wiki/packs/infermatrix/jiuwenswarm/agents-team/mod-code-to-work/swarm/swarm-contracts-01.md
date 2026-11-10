---
name: swarm-contracts-01
description: swarm 源码接口与集成边界 01：swarm/__init__、agent_group、config_specs、context、registry 五个文件的声明
metadata:
  scope: 只收 swarm 包根目录五个文件的静态声明；swarm/providers 下的声明归 swarm-providers-contracts-01
---
# swarm 源码接口与集成边界 01

## 现状

- 本页逐文件说明这一源码模块声明的接口、类型与依赖。记录来自静态源码声明，不证明控制流、配置生效、外部服务可用或测试通过；功能语义与设计取舍沿上级功能页继续阅读。
- **`jiuwenswarm/agents/swarm/__init__.py`**
- 源码对模块职责的说明：Swarm provider-based team assembly package.。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`from jiuwenswarm.agents.swarm.assembly import enrich_team_spec_for_swarm, p`；`from jiuwenswarm.agents.swarm.context import SwarmBuildContext`；`from jiuwenswarm.agents.swarm.registry import register_swarm_providers`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/swarm/__init__.py#L1-L28)。
- **`jiuwenswarm/agents/swarm/agent_group.py`**
- 源码对模块职责的说明：Strict loader for Team AgentGroup packages.。
- 调用入口 `load_agent_group_package(path)`；声明返回 `dict[str, AgentTemplateSpec]`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import json`；`from pathlib import Path, PureWindowsPath`；`from typing import Any`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/swarm/agent_group.py#L1-L302)。
- **`jiuwenswarm/agents/swarm/config_specs.py`**
- 源码对模块职责的说明：Config-sourced capability specs for swarm team members.。
- 调用入口 `build_member_capability_specs(config, mode, role, enable_permissions)`；声明返回 `tuple[list[RailSpec], list[BuiltinToolSpec]]`。
- 调用入口 `build_member_subagent_specs(config, mode, role)`；声明返回 `list[SubAgentSpec]`。
- 调用入口 `build_member_deep_agent_spec(config, mode, role, base_spec, enable_permissions, mcp_configs)`；声明返回 `DeepAgentSpec`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import os`；`from typing import Any, Callable`；`from openjiuwen.agent_teams.schema.deep_agent_spec import BuiltinToolSpec, `。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/swarm/config_specs.py#L1-L1000)。
- **`jiuwenswarm/agents/swarm/context.py`**
- 源码对模块职责的说明：Runtime build context for swarm provider-based team assembly.。
- 调用入口 `set_heartbeat_job_service(service)`；声明返回 `None`。
- 调用入口 `get_heartbeat_job_service()`；声明返回 `Any / None`。
- `SwarmBuildContext` 继承 `BuildContext`；方法入口：`resolve_member_skill_visibility_path`, `resolve_member_work_dir`, `to_seed`, `from_seed`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`from dataclasses import dataclass`；`from pathlib import Path`；`from typing import Any`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/swarm/context.py#L1-L277)。
- **`jiuwenswarm/agents/swarm/registry.py`**
- 源码对模块职责的说明：Central registration for swarm capability providers and rail types.。
- 调用入口 `register_swarm_providers()`；声明返回 `None`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`from typing import Any`；`from openjiuwen.agent_teams.harness.manifest import register_from_catalog`；`from openjiuwen.agent_teams.rails.builtin_elements import AUDIO as _OJ_AUDI`。
- 模块级配置或常量名称：`SKILL_TOOLKIT`, `SKILL_RETRIEVAL`, `USER_TODOS`, `VIDEO`, `IMAGE_GEN`, `VIDEO_GEN`, `VISUAL_GEN`, `XIAOYI_PHONE`；实际值与使用条件见源码。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/swarm/registry.py#L1-L249)。

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/agents-team/swarm/source-contracts-01.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
