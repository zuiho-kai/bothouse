---
name: common-core-contracts-04
description: common-core 源码接口与集成边界 04：common/ws_diagnostics.py（describe_ws_exception、describe_ws_peer、format_ws_diagnostics）的逐文件静态声明记录与源码链接
metadata:
  scope: 只收 ws_diagnostics.py 一个文件的静态声明记录，是 common-core 契约记录的最后一页
---
# common-core 源码接口与集成边界 04

## 现状

- 本页逐文件说明这一源码模块声明的接口、类型与依赖。记录来自静态源码声明，不证明控制流、配置生效、外部服务可用或测试通过；功能语义与设计取舍沿上级功能页继续阅读。
- **`jiuwenswarm/common/ws_diagnostics.py`**
- 源码对模块职责的说明：Helpers for WebSocket diagnostic logging.。
- 调用入口 `describe_ws_exception(exc)`；声明返回 `dict[str, Any]`。
- 调用入口 `describe_ws_peer(ws)`；声明返回 `dict[str, Any]`。
- 调用入口 `format_ws_diagnostics(*parts, **fields)`；声明返回 `str`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`from collections.abc import Mapping`；`from enum import Enum`；`from typing import Any`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/ws_diagnostics.py#L1-L81)。

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/common-core/source-contracts-04.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
