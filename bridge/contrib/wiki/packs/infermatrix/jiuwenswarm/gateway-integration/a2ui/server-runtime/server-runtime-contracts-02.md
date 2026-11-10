---
name: server-runtime-contracts-02
description: server-runtime 源码接口与集成边界 02：server/runtime/a2ui 下 text_formatter.py、types.py、validator.py 三个后端文件的静态声明
metadata:
  scope: 只收这三个文件的静态声明，不证明运行行为；其余后端文件归 server-runtime-contracts-01，入口说明归 server-runtime-overview
---
# server-runtime 源码接口与集成边界 02

## 现状

- 本页逐文件说明这一源码模块声明的接口、类型与依赖。记录来自静态源码声明，不证明控制流、配置生效、外部服务可用或测试通过；功能语义与设计取舍沿上级功能页继续阅读。
- **`jiuwenswarm/server/runtime/a2ui/text_formatter.py`**
- 源码对模块职责的说明：Format A2UI responses into plain text for fallback paths.。
- 调用入口 `format_for_text_channel(content, parse_response, validate_response)`；声明返回 `str`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`from collections.abc import Callable`；`from typing import Any`；`from a2ui.schema.constants import A2UI_OPEN_TAG`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/a2ui/text_formatter.py#L1-L113)。
- **`jiuwenswarm/server/runtime/a2ui/types.py`**
- 源码对模块职责的说明：Shared A2UI runtime data structures.。
- `A2UIResponsePart` 定义类型边界。
- `A2UIExample` 定义类型边界。
- `A2UIValidationResult` 定义类型边界。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`from dataclasses import dataclass`；`from pathlib import Path`；`from typing import Any, Literal`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/a2ui/types.py#L1-L35)。
- **`jiuwenswarm/server/runtime/a2ui/validator.py`**
- 源码对模块职责的说明：A2UI schema and runtime semantic validation.。
- 调用入口 `validate_a2ui_messages(catalog, messages)`；声明返回 `None`。
- 调用入口 `validate_a2ui_response(content, parse_response, validate_messages)`；声明返回 `A2UIValidationResult`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import json`；`from collections.abc import Callable`；`from typing import Any`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/a2ui/validator.py#L1-L305)。

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/a2ui/server-runtime/source-contracts-02.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
