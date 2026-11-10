---
name: agentos-auth-contracts-01
description: agentos-auth 源码接口与集成边界 01：extensions/agentos/auth 的 __init__、common（headers_to_dict、extract_token 等握手鉴权工具）、credential_authenticator（AuthContext、AuthResult、CredentialAuthenticator）、ssh_authenticator、ssh_key_issuer、ssh_key_registry（KeyRegistry）声明
metadata:
  scope: 只收 agentos/auth 目录六个文件的静态声明；入口说明归 agentos-auth-overview，AgentOSAuthenticator 在 router 目录，归 agentos-agentos-router-contracts-01
---
# agentos-auth 源码接口与集成边界 01

## 现状

- 本页逐文件说明这一源码模块声明的接口、类型与依赖。记录来自静态源码声明，不证明控制流、配置生效、外部服务可用或测试通过；功能语义与设计取舍沿上级功能页继续阅读。
- **`jiuwenswarm/extensions/agentos/auth/__init__.py`**
- 源码对模块职责的说明：AgentOS authentication modules.。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from jiuwenswarm.extensions.agentos.auth.credential_authenticator import Au`；`from jiuwenswarm.extensions.agentos.auth.ssh_authenticator import SshPublic`；`from jiuwenswarm.extensions.agentos.auth.ssh_key_issuer import AgentOSSshKe`；
  - `from jiuwenswarm.extensions.agentos.auth.ssh_key_registry import KeyRegistr`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/extensions/agentos/auth/__init__.py#L1-L29)。
- **`jiuwenswarm/extensions/agentos/auth/common.py`**
- 源码对模块职责的说明：WebSocket 握手鉴权公共工具。。
- 调用入口 `headers_to_dict(headers)`；声明返回 `dict[str, str]`。
- 调用入口 `extract_token_from_path_and_headers(path, headers)`；声明返回 `str / None`。
- 调用入口 `extract_token(ws)`；声明返回 `str / None`。
- 调用入口 `extract_headers(ws)`；声明返回 `dict`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import time`；`from http import HTTPStatus`；`from typing import Any`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/extensions/agentos/auth/common.py#L1-L113)。
- **`jiuwenswarm/extensions/agentos/auth/credential_authenticator.py`**
- `AuthContext` 定义类型边界。
- `AuthResult` 定义类型边界。
- `CredentialAuthenticator` 继承 `ABC`；方法入口：`authenticate`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from abc import ABC, abstractmethod`；`from dataclasses import dataclass, field`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/extensions/agentos/auth/credential_authenticator.py#L1-L42)。
- **`jiuwenswarm/extensions/agentos/auth/ssh_authenticator.py`**
- 源码对模块职责的说明：Verify SSH public-key fingerprints via KeyRegistry.。
- `SshPublicKeyAuthenticator` 继承 `CredentialAuthenticator`；方法入口：`__init__`, `registry`, `lookup_entry`, `verify`, `authenticate`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`from jiuwenswarm.extensions.agentos.auth.credential_authenticator import Au`；`from jiuwenswarm.extensions.agentos.auth.ssh_key_registry import KeyRegistr`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/extensions/agentos/auth/ssh_authenticator.py#L1-L71)。
- **`jiuwenswarm/extensions/agentos/auth/ssh_key_issuer.py`**
- 源码对模块职责的说明：Issue short-lived SSH key pairs and register public fingerprints.。
- `SshKeyIssuer` 继承 `Protocol`；方法入口：`issue_ephemeral_key`。
- `AgentOSSshKeyIssuer` 定义类型边界；方法入口：`__init__`, `registry`, `issue_ephemeral_key`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import logging`；`import time`；`from typing import Protocol`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/extensions/agentos/auth/ssh_key_issuer.py#L1-L93)。
- **`jiuwenswarm/extensions/agentos/auth/ssh_key_registry.py`**
- 源码对模块职责的说明：SSH public-key fingerprint registry for AgentOS identity mapping.。
- `KeyRegistryEntry` 定义类型边界。
- `KeyRegistry` 定义类型边界；方法入口：`__init__`, `register`, `lookup`, `revoke`, `cleanup_expired`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import time`；`from dataclasses import dataclass`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/extensions/agentos/auth/ssh_key_registry.py#L1-L57)。

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/extensions-plugins/agentos-auth/source-contracts-01.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
