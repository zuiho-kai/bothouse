---
name: dynamic-memory-cli-scripts-contracts-01
description: dynamic-memory-cli-scripts 源码接口记录 01：dynamic-memory-cli 技能的 dynamic_memory_cli.py；覆盖 dynamic_memory_cli.py
metadata:
  scope: 只收 dynamic-memory-cli-scripts 下该源文件的逐文件接口记录；本目录入口归 dynamic-memory-cli-scripts-overview
---
# dynamic-memory-cli-scripts 源码接口与集成边界 01

## 现状

- 本页逐文件说明这一源码模块声明的接口、类型与依赖。记录来自静态源码声明，不证明控制流、配置生效、外部服务可用或测试通过；功能语义与设计取舍沿上级功能页继续阅读。
- **`jiuwenswarm/resources/agent/workspace/skills/dynamic-memory-cli/scripts/dynamic_memory_cli.py`**
- `ClosingConnection` 继承 `sqlite3.Connection`。
- 调用入口 `now()`；声明返回 `str`。
- 调用入口 `normalize(value)`；声明返回 `str`。
- 调用入口 `tokens(value)`；声明返回 `list[str]`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import argparse`；`import hashlib`；`import json`。
- 模块级配置或常量名称：`SCHEMA_VERSION`, `DB_NAME`；实际值与使用条件见源码。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/dynamic-memory-cli/scripts/dynamic_memory_cli.py#L1-L590)。

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/config-resources/dynamic-memory-cli-scripts/source-contracts-01.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
