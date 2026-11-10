---
name: channels-cli-contracts-01
description: channels-cli 源码接口与集成边界 01：jiuwenswarm/channels/cli 的 _terminal（write_stdout、write_stderr、STDOUT_FD/STDERR_FD）与 main（main 入口）两个文件的静态声明
metadata:
  scope: 只收这两个文件的函数、导入与常量名称声明，不证明运行行为；入口说明归 channels-cli-overview
---
# channels-cli 源码接口与集成边界 01

## 现状

- 本页逐文件说明这一源码模块声明的接口、类型与依赖。记录来自静态源码声明，不证明控制流、配置生效、外部服务可用或测试通过；功能语义与设计取舍沿上级功能页继续阅读。
- **`jiuwenswarm/channels/cli/_terminal.py`**
- 源码对模块职责的说明：Low-level terminal output primitives for CLI chat.。
- 调用入口 `write_stdout(text)`；声明返回 `None`。
- 调用入口 `write_stderr(text)`；声明返回 `None`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import os`；`import sys`。
- 模块级配置或常量名称：`STDOUT_FD`, `STDERR_FD`；实际值与使用条件见源码。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/cli/_terminal.py#L1-L48)。
- **`jiuwenswarm/channels/cli/main.py`**
- 源码对模块职责的说明：Root ''jiuwenswarm'' CLI entry point.。
- 调用入口 `main()`；声明返回 `None`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import logging`；`import os`；`import sys`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/cli/main.py#L1-L55)。

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/gateway-channels/channels-cli/source-contracts-01.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
