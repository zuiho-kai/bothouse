---
name: jiuwenswarm-common-contracts-01
description: jiuwenswarm-common 源码接口与集成边界 01：common/e2a 下 E2A 统一信封的 __init__、acp 子包（协议结果、会话与工具更新）、adapters、agent_compat、gateway_normalize、wire_codec 的声明
metadata:
  scope: 只收 common/e2a 目录各文件的静态声明；模块入口归 jiuwenswarm-common-overview
---
# jiuwenswarm-common 源码接口与集成边界 01

## 现状

- 本页逐文件说明这一源码模块声明的接口、类型与依赖。记录来自静态源码声明，不证明控制流、配置生效、外部服务可用或测试通过；功能语义与设计取舍沿上级功能页继续阅读。
- **`jiuwenswarm/common/e2a/__init__.py`**
- 源码对模块职责的说明：E2A（Everything-to-Agent）：统一信封；ACP / A2A 等经转换进入 E2A，并由 provenance 记录出处。。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from jiuwenswarm.common.e2a.adapters import e2a_response_to_a2a_stream_payl`；`from jiuwenswarm.common.e2a.constants import ACP_AGENT_TO_CLIENT_METHODS, A`；`from jiuwenswarm.common.e2a.agent_compat import e2a_to_agent_request`；
  - `from jiuwenswarm.common.e2a.gateway_normalize import E2A_FALLBACK_FAILED_KE`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/e2a/__init__.py#L1-L140)。
- **`jiuwenswarm/common/e2a/acp/__init__.py`**
- 集成依赖（导入声明，不等于全部运行时依赖）：`from jiuwenswarm.common.e2a.acp.protocol import build_acp_initialize_result`；`from jiuwenswarm.common.e2a.acp.session_updates import AcpSessionUpdateStat`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/e2a/acp/__init__.py#L1-L19)。
- **`jiuwenswarm/common/e2a/acp/acp_tool_updates.py`**
- 调用入口 `is_reasoning_event(event_type, payload)`；声明返回 `bool`。
- 调用入口 `normalize_tool_name(tool_name)`；声明返回 `str`。
- 调用入口 `build_acp_tool_descriptor(tool_name, arguments, tool_call_id, status, raw_output, title, kind)`；声明返回 `dict[str, Any]`。
- 调用入口 `build_acp_tool_call_update(payload, cache)`；声明返回 `dict[str, Any] / None`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import json`；`from pathlib import PurePath`；`from typing import Any, Iterable`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/e2a/acp/acp_tool_updates.py#L1-L520)。
- **`jiuwenswarm/common/e2a/acp/protocol.py`**
- 调用入口 `build_acp_initialize_result()`；声明返回 `dict[str, Any]`。
- 调用入口 `build_acp_session_new_result(session_id)`；声明返回 `dict[str, Any]`。
- 调用入口 `build_acp_session_list_result(session_ids)`；声明返回 `dict[str, Any]`。
- 调用入口 `build_acp_prompt_result(stop_reason, user_message_id)`；声明返回 `dict[str, Any]`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`from typing import Any`；`from jiuwenswarm.common.version import __version__`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/e2a/acp/protocol.py#L1-L70)。
- **`jiuwenswarm/common/e2a/acp/session_updates.py`**
- `AcpSessionUpdateState` 继承 `Protocol`。
- 调用入口 `build_acp_session_update(msg, payload, state)`；声明返回 `dict[str, Any] / None`。
- 调用入口 `build_acp_final_text_update(payload, state)`；声明返回 `dict[str, Any] / None`。
- 调用入口 `build_acp_usage_update(payload)`；声明返回 `dict[str, Any] / None`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import uuid`；`from typing import Any, Protocol`；`from jiuwenswarm.common.e2a.acp.acp_tool_updates import build_acp_todo_upda`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/e2a/acp/session_updates.py#L1-L194)。
- **`jiuwenswarm/common/e2a/adapters.py`**
- 源码对模块职责的说明：将 ACP JSON-RPC、A2A SendMessage 等外部形态转换为 E2A，并写入 provenance。。
- 调用入口 `envelope_from_acp_jsonrpc(method, params, jsonrpc_id, session_id, channel, identity_origin, converter, extra_provenance_details)`；声明返回 `E2AEnvelope`。
- 调用入口 `envelope_from_a2a_send_message(task_id, context_id, message_body, metadata, configuration, channel, identity_origin, converter, extra_provenance_details)`；声明返回 `E2AEnvelope`。
- 调用入口 `envelope_to_acp_jsonrpc_call(envelope)`；声明返回 `dict[str, Any]`。
- 调用入口 `e2a_response_to_acp_jsonrpc_response(response)`；声明返回 `dict[str, Any] / None`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import time`；`import uuid as uuid_module`；`from typing import Any`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/e2a/adapters.py#L1-L257)。
- **`jiuwenswarm/common/e2a/agent_compat.py`**
- 源码对模块职责的说明：AgentServer：E2AEnvelope → 现有 AgentRequest（第一阶段）；不得与 normalize_failed 兜底同时使用。。
- 调用入口 `e2a_to_agent_request(env)`；声明返回 `AgentRequest`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import logging`；`from datetime import datetime`；`from jiuwenswarm.common.e2a.gateway_normalize import E2A_INTERNAL_CONTEXT_K`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/e2a/agent_compat.py#L1-L70)。
- **`jiuwenswarm/common/e2a/gateway_normalize.py`**
- 源码对模块职责的说明：Gateway：Channel Message / 类 Agent 请求字段 → E2AEnvelope；AgentResponse/Chunk → E2AResponse；规范化失败时构造兜底信封。。
- 调用入口 `message_to_legacy_agent_dict(msg)`；声明返回 `dict[str, Any]`。
- 调用入口 `build_fallback_e2a(legacy)`；声明返回 `E2AEnvelope`。
- 调用入口 `message_to_e2a(msg)`；声明返回 `E2AEnvelope`。
- 调用入口 `message_to_e2a_or_fallback(msg)`；声明返回 `E2AEnvelope`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import json`；`import logging`；`from typing import TYPE_CHECKING, Any`。
- 模块级配置或常量名称：`E2A_INTERNAL_CONTEXT_KEY`, `E2A_FALLBACK_FAILED_KEY`, `E2A_LEGACY_AGENT_REQUEST_KEY`, `MAX_LEGACY_AGENT_REQUEST_JSON_BYTES`；实际值与使用条件见源码。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/e2a/gateway_normalize.py#L1-L642)。
- **`jiuwenswarm/common/e2a/wire_codec.py`**
- 源码对模块职责的说明：AgentServer ↔ Gateway WebSocket：E2AResponse 线编码 / 解码与 legacy 兜底。。
- 调用入口 `is_e2a_response_wire_dict(data)`；声明返回 `bool`。
- 调用入口 `parse_agent_server_wire_unary(data)`；声明返回 `AgentResponse`。
- 调用入口 `parse_agent_server_wire_chunk(data)`；声明返回 `AgentResponseChunk`。
- 调用入口 `encode_agent_response_for_wire(resp, response_id, sequence)`；声明返回 `dict[str, Any]`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import logging`；`from dataclasses import asdict`；`from datetime import date, datetime`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/e2a/wire_codec.py#L1-L450)。

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/protocols/jiuwenswarm-common/source-contracts-01.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
