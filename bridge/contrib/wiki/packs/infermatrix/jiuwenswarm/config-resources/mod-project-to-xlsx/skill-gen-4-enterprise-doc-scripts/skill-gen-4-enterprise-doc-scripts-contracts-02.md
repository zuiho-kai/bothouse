---
name: skill-gen-4-enterprise-doc-scripts-contracts-02
description: skill-gen-4-enterprise-doc-scripts 源码接口记录 02（skill-gen-4-enterprise-doc-scripts 脚本共两页之一）：覆盖 validator.py、skill_generator_cli.py
metadata:
  scope: 只收 skill-gen-4-enterprise-doc-scripts 下这 2 个源文件的逐文件接口记录；本目录入口归 skill-gen-4-enterprise-doc-scripts-overview，其余文件的接口记录归 skill-gen-4-enterprise-doc-scripts-contracts-01
---
# skill-gen-4-enterprise-doc-scripts 源码接口与集成边界 02

## 现状

- 本页逐文件说明这一源码模块声明的接口、类型与依赖。记录来自静态源码声明，不证明控制流、配置生效、外部服务可用或测试通过；功能语义与设计取舍沿上级功能页继续阅读。
- **`jiuwenswarm/resources/agent/workspace/skills/skill-gen-4-enterprise-doc/scripts/skill_gen/validator.py`**
- 源码对模块职责的说明：Validation helpers for skill generator.。
- 调用入口 `validate_skill(skill_path)`；声明返回 `tuple[bool, str, dict[str, Any]]`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import re`；`from pathlib import Path`；`from typing import Any`。
- 模块级配置或常量名称：`ALLOWED_FRONTMATTER_KEYS`；实际值与使用条件见源码。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/skill-gen-4-enterprise-doc/scripts/skill_gen/validator.py#L1-L150)。
- **`jiuwenswarm/resources/agent/workspace/skills/skill-gen-4-enterprise-doc/scripts/skill_generator_cli.py`**
- 源码对模块职责的说明：CLI: SOP plain-text extraction and URL fetch for this skill package.。
- 调用入口 `main()`；声明返回 `int`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import argparse`；`import asyncio`；`import json`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/skill-gen-4-enterprise-doc/scripts/skill_generator_cli.py#L1-L137)。

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/config-resources/skill-gen-4-enterprise-doc-scripts/source-contracts-02.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
