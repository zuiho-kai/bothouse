---
name: code-contracts-01
description: code 源码接口与集成边界 01：harness/code/spec.py 的 CodeBuildArtifacts、CodeBuildContext、register_code_spec_providers 与 convert_code_config_to_deep_agent_spec 声明
metadata:
  scope: 只收 harness/code/spec.py 一个文件的静态声明；子目录 prompt、rails、tools 的声明归 code-prompt-contracts-01、code-rails-contracts-01-1、code-tools-contracts-01
---
# code 源码接口与集成边界 01

## 现状

- 本页逐文件说明这一源码模块声明的接口、类型与依赖。记录来自静态源码声明，不证明控制流、配置生效、外部服务可用或测试通过；功能语义与设计取舍沿上级功能页继续阅读。
- **`jiuwenswarm/agents/harness/code/spec.py`**
- 源码对模块职责的说明：Convert the single-agent code config into a declarative DeepAgentSpec.。
- `CodeBuildArtifacts` 定义类型边界。
- `CodeBuildContext` 继承 `BuildContext`。
- 调用入口 `register_code_spec_providers()`；声明返回 `None`。
- 调用入口 `convert_code_config_to_deep_agent_spec(adapter, config_base, react_config, model, card, system_prompt, workspace_root, project_dir, sys_operation, sys_operation_card, …)`；声明返回 `tuple[DeepAgentSpec, CodeBuildContext]`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`from copy import deepcopy`；`from dataclasses import dataclass, field`；`from typing import Any`。
- 模块级配置或常量名称：`CODE_RAIL_BUNDLE`, `CODE_TOOL_BUNDLE`, `CODE_SUBAGENT_BUNDLE`；实际值与使用条件见源码。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/code/spec.py#L1-L324)。

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/agents-team/code/source-contracts-01.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
