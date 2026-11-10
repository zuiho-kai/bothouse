---
name: gateway-push-contracts-01
description: gateway-push 源码接口与集成边界 01：jiuwenswarm/server/gateway_push 下 __init__、transport（GatewayPushTransport 与 WebSocketGatewayPushTransport）、wire（build_server_push_wire）三个文件的静态声明
metadata:
  scope: 只收gateway_push 目录三个文件的静态声明，不证明运行行为；入口说明归 gateway-push-overview
---
# gateway-push 源码接口与集成边界 01

## 现状

- 本页逐文件说明这一源码模块声明的接口、类型与依赖。记录来自静态源码声明，不证明控制流、配置生效、外部服务可用或测试通过；功能语义与设计取舍沿上级功能页继续阅读。
- **`jiuwenswarm/server/gateway_push/__init__.py`**
- 集成依赖（导入声明，不等于全部运行时依赖）：`from jiuwenswarm.server.gateway_push.transport import GatewayPushTransport,`；`from jiuwenswarm.server.gateway_push.wire import build_server_push_wire`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/gateway_push/__init__.py#L1-L13)。
- **`jiuwenswarm/server/gateway_push/transport.py`**
- 源码对模块职责的说明：AgentServer → Gateway 下行推送抽象与 WebSocket 默认实现。。
- `GatewayPushTransport` 继承 `Protocol`；方法入口：`send_push`。
- `WebSocketGatewayPushTransport` 定义类型边界；方法入口：`send_push`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`from typing import Any, Protocol, runtime_checkable`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/gateway_push/transport.py#L1-L23)。
- **`jiuwenswarm/server/gateway_push/wire.py`**
- 源码对模块职责的说明：E2A server_push 线编码：WebSocket 与 HTTP SSE 下行共用同一 wire 形状。。
- 调用入口 `build_server_push_wire(msg)`；声明返回 `dict[str, Any]`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`from typing import Any`；`from jiuwenswarm.common.e2a.constants import E2A_RESPONSE_STATUS_SUCCEEDED,`；`from jiuwenswarm.common.e2a.models import E2AProvenance, E2AResponse, Ident`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/gateway_push/wire.py#L1-L74)。

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/agent-server-runtime/gateway-push/source-contracts-01.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
