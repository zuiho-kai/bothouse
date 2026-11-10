---
name: ascend-auto-trace-scripts-contracts-02
description: ascend-moe-optimizer-auto-trace-scripts 源码接口记录 02（ascend-moe-optimizer-auto-trace-scripts 脚本共两页之一）：覆盖 validate_trace_points.py、verify_trace_scaffold.py
metadata:
  scope: 只收 ascend-moe-optimizer-auto-trace-scripts 下这 2 个源文件的逐文件接口记录；本目录入口归 ascend-auto-trace-scripts-overview，其余文件的接口记录归 ascend-auto-trace-scripts-contracts-01
---
# ascend-moe-optimizer-auto-trace-scripts 源码接口与集成边界 02

## 现状

- 本页逐文件说明这一源码模块声明的接口、类型与依赖。记录来自静态源码声明，不证明控制流、配置生效、外部服务可用或测试通过；功能语义与设计取舍沿上级功能页继续阅读。
- **`jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/validate_trace_points.py`**
- 源码对模块职责的说明：Validate TRACE_POINT naming and B/E pairing quality for operator source files.。
- 调用入口 `iter_targets(path)`；声明返回 `List[pathlib.Path]`。
- 调用入口 `check_file(path)`；声明返回 `Tuple[int, List[str]]`。
- 调用入口 `main()`；声明返回 `None`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import argparse`；`import logging`；`import pathlib`。
- 模块级配置或常量名称：`TP_RE`, `NAME_RE`；实际值与使用条件见源码。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/validate_trace_points.py#L1-L86)。
- **`jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/verify_trace_scaffold.py`**
- 源码对模块职责的说明：Verify trace scaffold files and compile hook integration.。
- 调用入口 `main()`；声明返回 `None`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import argparse`；`import logging`；`from pathlib import Path`。
- 模块级配置或常量名称：`REQUIRED_FILES`；实际值与使用条件见源码。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/verify_trace_scaffold.py#L1-L58)。

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/config-resources/ascend-moe-optimizer-auto-trace-scripts/source-contracts-02.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
