---
name: gateway-hooks-contracts-01
description: gateway-hooks 源码接口与集成边界 01：gateway/hooks/handler.py 中 GatewayHookHandler 及其 on_session_start 等方法入口的声明
metadata:
  scope: 只收 gateway/hooks/handler.py 一个文件的静态声明；模块入口归 gateway-hooks-overview
---
# gateway-hooks 源码接口与集成边界 01

## 现状

- 本页逐文件说明这一源码模块声明的接口、类型与依赖。记录来自静态源码声明，不证明控制流、配置生效、外部服务可用或测试通过；功能语义与设计取舍沿上级功能页继续阅读。
- **`jiuwenswarm/gateway/hooks/handler.py`**
- 源码对模块职责的说明：GatewayHookHandler —— 在 Gateway 层执行 session / 生命周期类 hooks.。
- `GatewayHookHandler` 定义类型边界；方法入口：`__init__`, `on_session_start`, `on_user_prompt_submit`, `on_session_end`, `on_notification`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import logging`；`from pathlib import Path`；`from jiuwenswarm.common.hooks_config import HooksConfig, HookEvent`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/hooks/handler.py#L1-L128)。

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/gateway-channels/gateway-hooks/source-contracts-01.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
