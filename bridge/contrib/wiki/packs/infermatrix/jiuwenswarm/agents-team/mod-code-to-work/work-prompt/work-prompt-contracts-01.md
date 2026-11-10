---
name: work-prompt-contracts-01
description: work-prompt 源码接口与集成边界 01：work_plan_prompts.py
metadata:
  scope: 只收 work/prompt 下 work_plan_prompts.py 至 work_plan_prompts.py 共 1 个源码文件的静态声明（接口、类型、依赖与源码依据链接）
---
# work-prompt 源码接口与集成边界 01

## 现状

- 本页逐文件说明这一源码模块声明的接口、类型与依赖。记录来自静态源码声明，不证明控制流、配置生效、外部服务可用或测试通过；功能语义与设计取舍沿上级功能页继续阅读。
- **`jiuwenswarm/agents/harness/work/prompt/work_plan_prompts.py`**
- 源码对模块职责的说明：work profile 的 plan 模式提示词。。
- 调用入口 `work_plan_mode_system_note(language)`；声明返回 `str`。
- 调用入口 `work_enter_plan_instructions(language)`；声明返回 `str`。
- 调用入口 `work_exit_plan_notification(language)`；声明返回 `str`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`。
- 模块级配置或常量名称：`WORK_PLAN_MODE_SYSTEM_NOTE_CN`, `WORK_PLAN_MODE_SYSTEM_NOTE_EN`, `WORK_ENTER_PLAN_MODE_INSTRUCTIONS_CN`, `WORK_ENTER_PLAN_MODE_INSTRUCTIONS_EN`, `WORK_EXIT_PLAN_MODE_NOTIFICATION_CN`, `WORK_EXIT_PLAN_MODE_NOTIFICATION_EN`, `WORK_PLAN_ALLOWED_TOOLS`；实际值与使用条件见源码。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/work/prompt/work_plan_prompts.py#L1-L257)。

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/agents-team/work-prompt/source-contracts-01.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
