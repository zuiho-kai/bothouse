---
name: work-rails-contracts-01
description: work-rails 源码接口与集成边界 01：work_agent_mode_rail.py
metadata:
  scope: 只收 work/rails 下 work_agent_mode_rail.py 至 work_agent_mode_rail.py 共 1 个源码文件的静态声明（接口、类型、依赖与源码依据链接）
---
# work-rails 源码接口与集成边界 01

## 现状

- 本页逐文件说明这一源码模块声明的接口、类型与依赖。记录来自静态源码声明，不证明控制流、配置生效、外部服务可用或测试通过；功能语义与设计取舍沿上级功能页继续阅读。
- **`jiuwenswarm/agents/harness/work/rails/work_agent_mode_rail.py`**
- 源码对模块职责的说明：WorkAgentModeRail — work profile 的 plan 模式约束。。
- `WorkAgentModeRail` 继承 `CodeAgentModeRail`；方法入口：`__init__`, `before_model_call`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`from openjiuwen.core.single_agent.rail.base import AgentCallbackContext`；`from jiuwenswarm.agents.harness.code.rails.code_agent_mode_rail import Code`；`from jiuwenswarm.agents.harness.work.prompt.work_plan_prompts import WORK_P`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/work/rails/work_agent_mode_rail.py#L1-L76)。

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/agents-team/work-rails/source-contracts-01.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
