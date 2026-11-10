---
name: jiuwenbox-src-contracts-01
description: jiuwenbox-src 源码接口 01：bundled_configs、cli/jiuwenbox、logging_config、models（__init__、common、policy、sandbox）、proxy/__init__、server 的 audit_logger、auth、launcher、policy_engine、policy_reader、proxy_manager 共十四个文件的声明与依赖
metadata:
  scope: 只收 jiuwenbox/src/jiuwenbox 下这十四个文件的接口记录；routes、runtime、sandbox_manager、workspace、supervisor 前五个文件归 jiuwenbox-src-contracts-02，其余 supervisor 文件归 jiuwenbox-src-contracts-03
---
# jiuwenbox-src 源码接口与集成边界 01

## 现状

- 本页逐文件说明这一源码模块声明的接口、类型与依赖。记录来自静态源码声明，不证明控制流、配置生效、外部服务可用或测试通过；功能语义与设计取舍沿上级功能页继续阅读。
- **`jiuwenbox/src/jiuwenbox/bundled_configs.py`**
- 源码对模块职责的说明：Bundled policy YAML files shipped inside the jiuwenbox package.。
- 调用入口 `configs_dir()`；声明返回 `Path`。
- 调用入口 `default_policy_path()`；声明返回 `Path`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`from pathlib import Path`；`import jiuwenbox`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenbox/src/jiuwenbox/bundled_configs.py#L1-L20)。
- **`jiuwenbox/src/jiuwenbox/cli/jiuwenbox.py`**
- 源码对模块职责的说明：jiuwenbox HTTP API 命令行客户端 (单文件实现).。
- 调用入口 `cmd_health(args, client)`；声明返回 `Any`。
- 调用入口 `cmd_sandbox_create(args, client)`；声明返回 `Any`。
- 调用入口 `cmd_sandbox_ls(args, client)`；声明返回 `Any`。
- 调用入口 `cmd_sandbox_get(args, client)`；声明返回 `Any`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import argparse`；`import json`；`import logging`。
- 模块级配置或常量名称：`EXIT_OK`, `EXIT_API_ERROR`, `EXIT_CONNECT_ERROR`, `EXIT_LOCAL_ERROR`, `EXIT_INTERRUPT`；实际值与使用条件见源码。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenbox/src/jiuwenbox/cli/jiuwenbox.py#L1-L1513)。
- **`jiuwenbox/src/jiuwenbox/logging_config.py`**
- 源码对模块职责的说明：Shared logging configuration for jiuwenbox.。
- 调用入口 `patch_uvicorn_logging()`；声明返回 `None`。
- 调用入口 `configure_logging(level)`；声明返回 `None`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import logging`。
- 模块级配置或常量名称：`LOG_FORMAT`, `LOG_DATE_FORMAT`, `UVICORN_LOGGER_NAMES`；实际值与使用条件见源码。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenbox/src/jiuwenbox/logging_config.py#L1-L43)。
- **`jiuwenbox/src/jiuwenbox/models/__init__.py`**
- 集成依赖（导入声明，不等于全部运行时依赖）：`from jiuwenbox.models.sandbox import BackgroundExecRequest, BackgroundExecR`；`from jiuwenbox.models.policy import ArchitectureSyscallPolicy, BindMount, D`；`from jiuwenbox.models.common import AuditEvent, AuditEventType, HealthRespo`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenbox/src/jiuwenbox/models/__init__.py#L1-L67)。
- **`jiuwenbox/src/jiuwenbox/models/common.py`**
- 源码对模块职责的说明：Common data models shared across components.。
- `AuditEventType` 继承 `str, enum.Enum`。
- `AuditEvent` 继承 `BaseModel`。
- `HealthResponse` 继承 `BaseModel`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import enum`；`from datetime import datetime`；`from pydantic import BaseModel, Field`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenbox/src/jiuwenbox/models/common.py#L1-L44)。
- **`jiuwenbox/src/jiuwenbox/models/policy.py`**
- 源码对模块职责的说明：Security policy data models (static only).。
- `BindMount` 继承 `BaseModel`；方法入口：`reject_wildcard_host_path`, `expand_paths`。
- `BindRootEntries` 继承 `BaseModel`；方法入口：`expand_paths`。
- `DeviceMount` 继承 `BaseModel`；方法入口：`expand_paths`。
- `DirectoryMount` 继承 `BaseModel`；方法入口：`expand_path`, `permissions_must_be_octal`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import enum`；`import os`；`from pathlib import Path`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenbox/src/jiuwenbox/models/policy.py#L1-L802)。
- **`jiuwenbox/src/jiuwenbox/models/sandbox.py`**
- 源码对模块职责的说明：Sandbox data models.。
- `InvalidSandboxIdError` 继承 `Exception`。
- `InvalidJobIdError` 继承 `Exception`。
- 调用入口 `generate_sandbox_id()`；声明返回 `str`。
- 调用入口 `validate_custom_sandbox_id(value)`；声明返回 `str`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import enum`；`import re`；`import uuid`。
- 模块级配置或常量名称：`SANDBOX_ID_MIN_LEN`, `SANDBOX_ID_MAX_LEN`, `CUSTOM_SANDBOX_ID_RE`, `SANDBOX_ID_FORMAT_MESSAGE`, `JOB_ID_MIN_LEN`, `JOB_ID_MAX_LEN`, `CUSTOM_JOB_ID_RE`, `JOB_ID_FORMAT_MESSAGE`；实际值与使用条件见源码。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenbox/src/jiuwenbox/models/sandbox.py#L1-L166)。
- **`jiuwenbox/src/jiuwenbox/proxy/__init__.py`**
- 源码对模块职责的说明：Inference privacy proxy package.。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from jiuwenbox.proxy.inference_privacy_proxy import InferencePrivacyProxy, `；`from jiuwenbox.proxy.inference_privacy_proxy_manager import InferencePrivac`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenbox/src/jiuwenbox/proxy/__init__.py#L1-L24)。
- **`jiuwenbox/src/jiuwenbox/server/audit_logger.py`**
- 源码对模块职责的说明：Structured audit logging in JSONL format.。
- `AuditLogger` 定义类型边界；方法入口：`__init__`, `log_event`, `log_event_sync`, `log`, `flush`, `read_logs`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import json`；`import logging`；`import threading`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenbox/src/jiuwenbox/server/audit_logger.py#L1-L243)。
- **`jiuwenbox/src/jiuwenbox/server/auth.py`**
- 源码对模块职责的说明：Opt-in Bearer token authentication for the jiuwenbox HTTP API.。
- 调用入口 `get_configured_token()`；声明返回 `str / None`。
- 调用入口 `extract_bearer_token(authorization)`；声明返回 `str / None`。
- 调用入口 `token_is_valid(provided, expected)`；声明返回 `bool`。
- `BearerTokenAuthMiddleware` 继承 `BaseHTTPMiddleware`；方法入口：`dispatch`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import hmac`；`import os`；`from starlette.middleware.base import BaseHTTPMiddleware`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenbox/src/jiuwenbox/server/auth.py#L1-L59)。
- **`jiuwenbox/src/jiuwenbox/server/launcher.py`**
- 源码对模块职责的说明：jiuwenbox server 启动器 (HTTP / UDS 二选一).。
- `ListenURIError` 继承 `ValueError`。
- 调用入口 `parse_listen(uri)`；声明返回 `ListenSpec`。
- 调用入口 `main(argv)`；声明返回 `int`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import argparse`；`import logging`；`import os`。
- 模块级配置或常量名称：`ENV_LISTEN`, `ENV_UDS_PATH`, `ENV_UDS_MODE`, `ENV_SAVE_LOGS_DIR`, `DEFAULT_LISTEN`；实际值与使用条件见源码。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenbox/src/jiuwenbox/server/launcher.py#L1-L300)。
- **`jiuwenbox/src/jiuwenbox/server/policy_engine.py`**
- 源码对模块职责的说明：Policy Engine - validates and resolves static security policies.。
- `PolicyValidationError` 继承 `Exception`；方法入口：`__init__`。
- `PolicyEngine` 定义类型边界；方法入口：`__init__`, `validate_policy`, `resolve_policy`, `merge_policy`, `write_sandbox_policy`, `load_policy_from_file`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import logging`；`from collections.abc import Mapping`；`from pathlib import Path, PurePosixPath`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenbox/src/jiuwenbox/server/policy_engine.py#L1-L311)。
- **`jiuwenbox/src/jiuwenbox/server/policy_reader.py`**
- 源码对模块职责的说明：Policy file reader for loading security policies from YAML files.。
- `PolicyReader` 定义类型边界；方法入口：`__init__`, `load_policy`, `load_policy_from_file`, `is_proxy_only`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import logging`；`import os`；`from pathlib import Path`。
- 模块级配置或常量名称：`JIUWENBOX_POLICY_PATH_ENV`；实际值与使用条件见源码。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenbox/src/jiuwenbox/server/policy_reader.py#L1-L121)。
- **`jiuwenbox/src/jiuwenbox/server/proxy_manager.py`**
- 源码对模块职责的说明：Proxy lifecycle manager.。
- `ProxyManager` 定义类型边界；方法入口：`__init__`, `load_policy`, `start`, `stop`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import logging`；`from pathlib import Path`；`from jiuwenbox.logging_config import configure_logging`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenbox/src/jiuwenbox/server/proxy_manager.py#L1-L67)。

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/subpackages/jiuwenbox-src/source-contracts-01.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
