---
name: sandbox-contracts-01
description: sandbox 源码接口与集成边界 01：jiuwenswarm/server/sandbox 下 host_port.py（parse_sandbox_host_port）与 jiuwenbox_runner.py（JiuwenBoxRunner）的静态声明
metadata:
  scope: 只收sandbox 目录两个文件的静态声明，不证明运行行为；入口说明归 sandbox-overview
---
# sandbox 源码接口与集成边界 01

## 现状

- 本页逐文件说明这一源码模块声明的接口、类型与依赖。记录来自静态源码声明，不证明控制流、配置生效、外部服务可用或测试通过；功能语义与设计取舍沿上级功能页继续阅读。
- **`jiuwenswarm/server/sandbox/host_port.py`**
- 源码对模块职责的说明：Parse sandbox TCP endpoint host/port from a URL string.。
- 调用入口 `parse_sandbox_host_port(url)`；声明返回 `tuple[str, int]`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`from urllib.parse import urlparse`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/sandbox/host_port.py#L1-L22)。
- **`jiuwenswarm/server/sandbox/jiuwenbox_runner.py`**
- 源码对模块职责的说明：管理本地 jiuwenbox uvicorn 子进程 — 由 ''/sandbox enable'' 触发启动.。
- `JiuwenBoxRunner` 定义类型边界；方法入口：`__init__`, `instance`, `base_url`, `get_stderr_tail`, `is_owned_listener`, `get_owned_endpoint`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import asyncio`；`import atexit`；`import contextlib`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/sandbox/jiuwenbox_runner.py#L1-L545)。

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/agent-server-runtime/sandbox/source-contracts-01.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
