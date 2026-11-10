---
name: security-contracts-01
description: security 源码接口与集成边界 01：common/security/base_crypto.py、common/security/ws_origin.py 的逐文件静态声明记录与源码链接
metadata:
  scope: 只收上述文件的逐文件静态声明记录；入口说明与导航归 security-overview
---
# security 源码接口与集成边界 01

## 现状

- 本页逐文件说明这一源码模块声明的接口、类型与依赖。记录来自静态源码声明，不证明控制流、配置生效、外部服务可用或测试通过；功能语义与设计取舍沿上级功能页继续阅读。
- **`jiuwenswarm/common/security/base_crypto.py`**
- `CryptoProvider` 继承 `Protocol`；方法入口：`encrypt`, `decrypt`。
- 调用入口 `set_crypto_provider(provider)`；声明返回 `None`。
- 调用入口 `get_crypto_provider()`；声明返回 `Optional[CryptoProvider]`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from typing import Protocol, runtime_checkable, Optional`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/security/base_crypto.py#L1-L22)。
- **`jiuwenswarm/common/security/ws_origin.py`**
- 源码对模块职责的说明：Shared WebSocket Origin validation helpers.。
- 调用入口 `is_origin_check_enabled()`；声明返回 `bool`。
- 调用入口 `get_allowed_origin_hosts()`；声明返回 `set[str]`。
- 调用入口 `is_allowed_browser_origin(origin)`；声明返回 `bool`。
- 调用入口 `extract_handshake_request(args)`；声明返回 `tuple[str, Any]`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import os`；`from http import HTTPStatus`；`from typing import Any`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/security/ws_origin.py#L1-L88)。

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/common-core/security/source-contracts-01.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
