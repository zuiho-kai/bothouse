---
name: agent-group-creator-scripts-contracts-01
description: agent-group-creator-scripts 源码接口记录 01：agent-group-creator 技能的 register_group.py（AgentGroup 校验与导入）；覆盖 register_group.py
metadata:
  scope: 只收 agent-group-creator-scripts 下该源文件的逐文件接口记录；本目录入口归 agent-group-creator-scripts-overview
---
# agent-group-creator-scripts 源码接口与集成边界 01

## 现状

- 本页逐文件说明这一源码模块声明的接口、类型与依赖。记录来自静态源码声明，不证明控制流、配置生效、外部服务可用或测试通过；功能语义与设计取舍沿上级功能页继续阅读。
- **`jiuwenswarm/resources/agent/workspace/skills/agent-group-creator/scripts/register_group.py`**
- 源码对模块职责的说明：Validate and import an AgentGroup using the product's package lifecycle.。
- 调用入口 `main()`；声明返回 `int`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`import argparse`；`import logging`；`from pathlib import Path`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/agent-group-creator/scripts/register_group.py#L1-L44)。

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/config-resources/agent-group-creator-scripts/source-contracts-01.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
