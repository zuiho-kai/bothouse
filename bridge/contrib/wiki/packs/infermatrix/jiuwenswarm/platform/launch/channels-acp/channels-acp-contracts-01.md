---
name: channels-acp-contracts-01
description: channels-acp 源码接口与集成边界 01：channels/acp/app_acp.py 的逐文件静态声明记录与源码链接
metadata:
  scope: 只收上述文件的逐文件静态声明记录；入口说明与导航归 channels-acp-overview
---
# channels-acp 源码接口与集成边界 01

## 现状

- 本页逐文件说明这一源码模块声明的接口、类型与依赖。记录来自静态源码声明，不证明控制流、配置生效、外部服务可用或测试通过；功能语义与设计取舍沿上级功能页继续阅读。
- **`jiuwenswarm/channels/acp/app_acp.py`**
- 调用入口 `write_json_stdout(payload)`；声明返回 `None`。
- 调用入口 `run_acp(args)`；声明返回 `int`。
- 调用入口 `main()`；声明返回 `None`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import argparse`；`import json`；`import logging`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/acp/app_acp.py#L1-L194)。

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/launch/channels-acp/source-contracts-01.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
