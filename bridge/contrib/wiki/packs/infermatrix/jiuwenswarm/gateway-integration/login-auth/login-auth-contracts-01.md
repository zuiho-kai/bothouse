---
name: login-auth-contracts-01
description: login-auth 源码接口与集成边界 01：common/auth 下 __init__.py、apig.py（ApigConfig、QuotaExhausted）、net.py、remote_config.py（RemoteConfig）、session_owners.py 的声明
metadata:
  scope: 只收 common/auth 这五个文件的静态声明；service、account_kit、session_store 等其他文件的行为说明见 jiuwenswarm-common-auth
---
# login-auth 源码接口与集成边界 01

## 现状

- 本页逐文件说明这一源码模块声明的接口、类型与依赖。记录来自静态源码声明，不证明控制流、配置生效、外部服务可用或测试通过；功能语义与设计取舍沿上级功能页继续阅读。
- **`jiuwenswarm/common/auth/__init__.py`**
- 源码对模块职责的说明：华为账号 Account Kit 登录（本地回环回调）+ APIG 免费模型。。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from jiuwenswarm.common.auth.account_kit import AccountKitFlow, Credential,`；`from jiuwenswarm.common.auth.service import AuthService, ModelAuthRequired,`；`from jiuwenswarm.common.auth.session_store import AuthSession, AuthSessionS`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/auth/__init__.py#L1-L53)。
- **`jiuwenswarm/common/auth/apig.py`**
- 源码对模块职责的说明：APIG模型通道的客户端：模型列表/积分/推理接入点。
- `ApigError` 继承 `Exception`；方法入口：`__init__`。
- `QuotaExhausted` 继承 `ApigError`；方法入口：`__init__`。
- `ApigConfig` 定义类型边界；方法入口：`models_url`, `quota_url`, `invoke_base_url`。
- 调用入口 `resolve_apig_config(allow_refresh)`；声明返回 `ApigConfig / None`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import logging`；`import re`；`from dataclasses import dataclass, field`。
- 模块级配置或常量名称：`QUOTA_EXHAUSTED_CODE`, `LOGIN_REQUIRED_CODE`, `RATE_LIMITED_CODE`, `SERVICE_UNAVAILABLE_CODE`, `LOW_BALANCE_RATIO`；实际值与使用条件见源码。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/auth/apig.py#L1-L340)。
- **`jiuwenswarm/common/auth/net.py`**
- 源码对模块职责的说明：登录链路的出网请求。。
- 调用入口 `ssl_verify_enabled()`；声明返回 `bool`。
- 调用入口 `requests_request(method, url, **kwargs)`；声明返回 `requests.Response`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import os`；`from typing import Any`；`import requests`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/auth/net.py#L1-L28)。
- **`jiuwenswarm/common/auth/remote_config.py`**
- 源码对模块职责的说明：登录与免费模型的**远端配置**：官网接口下发。。
- `GatewaySettings` 定义类型边界。
- `ModelFilters` 定义类型边界。
- `LoginSection` 定义类型边界；方法入口：`value`。
- `RemoteConfig` 定义类型边界；方法入口：`login`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import logging`；`import os`；`import random`。
- 模块级配置或常量名称：`CONFIG_URL_ENV`, `DEFAULT_CONFIG_URL`, `REQUEST_TIMEOUT_S`, `LOGIN_SECTION_SUFFIX`；实际值与使用条件见源码。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/auth/remote_config.py#L1-L305)。
- **`jiuwenswarm/common/auth/session_owners.py`**
- 源码对模块职责的说明：对话会话 → 在这个会话里选了登录送的免费模型的华为账号。。
- `SessionOwner` 定义类型边界。
- 调用入口 `remember(session_id, credential_ref, model_name)`；声明返回 `None`。
- 调用入口 `lookup(session_id)`；声明返回 `SessionOwner / None`。
- 调用入口 `login_auth_for_owner(owner)`；声明返回 `dict / None`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import json`；`import logging`；`import os`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/auth/session_owners.py#L1-L147)。

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/login-auth/source-contracts-01.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
