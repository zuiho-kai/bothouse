---
name: feature-gateway-server-multi-route-ws
description: GatewayServer 多路由 WebSocket 宿主概览：GatewayServerConfig/RouteConfig、2↔3 元组 client 查找兜底、send_response/send_event 回包契约、SESSION_IN_USE 会话独占与 pending 提升、_handle_raw_message 分发管线、test_app_gateway_acp 单测
metadata:
  scope: GatewayServer 的配置、公共入口、会话独占、消息分发管线与单测入口；帧发送守卫、绑定函数返回值和二元组键取舍的函数级细节归 feature-depth-gateway-server-multi-route-ws
---
# GatewayServer 多路由 WebSocket 宿主与会话/请求路由表

## 现状

- **GatewayServerConfig 与 RouteConfig**
- `GatewayServerConfig` 默认 enabled=True、host="127.0.0.1"、port=19001；`__post_init__` 在 routes 为空且同时给出 path 和 channel_id 时，兼容地合成单条 RouteConfig。
  - 每条 `RouteConfig` 除 local_handlers 字典和 forward_methods/forward_no_local_handler_methods 外，还可挂 inbound/outbound_interceptor、cleanup/disconnect/session_bind_handler 钩子，以及 V2 新增的 ws_channel（委托注册的外部 Channel，如 tui 的 TuiChannel；None 表示该 route 不委托）。路由匹配 `_resolve_route` 按精确路径并容忍尾部斜杠变体。
- Sources / 来源：[jiuwenswarm/gateway/app_gateway.py:L651–L680](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/app_gateway.py#L651-L680),
  - [jiuwenswarm/gateway/app_gateway.py:L1040–L1052](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/app_gateway.py#L1040-L1052)
- **2↔3 元组双向兜底与委托注册的职责拆分**
- Inference / 设计推断（非作者历史意图）：
- `_lookup_client` 在精确键 MISS 后做防御性双向兜底（3 元组降级查 2 元组、2 元组升级扫描前缀匹配的 3 元组、再裸 scope 兜底），注释引用设计 §6.3，动机是链路某环节丢 agent_ref 时不至于响应 dropped——代价是查找语义变宽，同 session 多 agent_ref 场景下兜底可能命中非严格对应连接（此为推断）。ws_channel 路由上，GatewayServer 保留自身表做入站响应反查，但把出站 chunk 精确路由委托给 TuiChannel 的五维索引，形成双路由表并存的职责拆分。
- Sources / 来源：[jiuwenswarm/gateway/app_gateway.py:L813–L847](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/app_gateway.py#L813-L847),
  - [jiuwenswarm/gateway/app_gateway.py:L1618–L1644](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/app_gateway.py#L1618-L1644)
- **公共入口与回包契约**
- `GatewayServer(config, router)` 构造后通过 `register_local_handler(path, method, handler)` 注册本地方法（路由不存在时自动合成 RouteConfig），`start()`/`stop()`/`wait_until_closed()` 管理生命周期。
  - 回包接口 `send_response(ws, req_id, ok, payload, error, code)` 发送 `type=res` 帧：失败时必附 `error`（缺省 "request failed"），`code` 仅在传入真值时才写入帧，是可选字段。`send_event(ws, event, payload)` 发送 `type=event` 帧；两者发送失败均只记 debug 日志不抛出。
- Sources / 来源：[jiuwenswarm/gateway/app_gateway.py:L1060–L1066](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/app_gateway.py#L1060-L1066),
  - [jiuwenswarm/gateway/app_gateway.py:L1078–L1092](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/app_gateway.py#L1078-L1092),
  - [jiuwenswarm/gateway/app_gateway.py:L1094–L1105](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/app_gateway.py#L1094-L1105),
  - [jiuwenswarm/gateway/app_gateway.py:L1107–L1148](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/app_gateway.py#L1107-L1148)
- **会话独占的两道防线：实时拒绝与 pending 挂起提升**
- 同 session 多连接冲突由两段逻辑分别处理。forward 路径中，若 session_key 已绑定到另一个仍活跃的连接，直接回 `SESSION_IN_USE` 错误帧并终止该请求，不会把新连接挂起（app_gateway.py:1572-1588）。挂起发生在 `_bind_route_session_client`：绑定冲突时若新 ws 仍打开，则记入 `_pending_session_clients` 并返回 False；
  - 旧连接断开清理后由 `_promote_pending_session_client` 提升——仅当 pending ws 仍打开且当前无其他活跃占用者时写入 `_session_to_client`，且仅在 route 配置了 session_bind_handler 时才调用该钩子。
- Sources / 来源：[jiuwenswarm/gateway/app_gateway.py:L1572–L1592](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/app_gateway.py#L1572-L1592),
  - [jiuwenswarm/gateway/app_gateway.py:L943–L978](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/app_gateway.py#L943-L978),
  - [jiuwenswarm/gateway/app_gateway.py:L979–L1007](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/app_gateway.py#L979-L1007)
- **_handle_raw_message 的分发管线与 forward 路径的提前拒绝**
- `_handle_raw_message` 按 JSON 解析 → ACP bridge → route.inbound_interceptor → req 帧校验的顺序预处理，随后进入方法分发。方法命中 forward_methods 并不必然转发：ReqMethod 枚举匹配失败时直接回 "unknown method" 错误帧（L1542–L1555），session_key 已绑定到另一个活跃连接时回 SESSION_IN_USE 错误帧并终止（L1572–L1588）。
  - forward 分支正常派发后，非 ACP 路由上不在 forward_no_local_handler_methods 中的方法会继续落入 local_handlers 查找，仍无匹配才回 unknown method（L1699–L1745）。
- Sources / 来源：[jiuwenswarm/gateway/app_gateway.py:L1540–L1555](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/app_gateway.py#L1540-L1555),
  - [jiuwenswarm/gateway/app_gateway.py:L1572–L1588](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/app_gateway.py#L1572-L1588),
  - [jiuwenswarm/gateway/app_gateway.py:L1693–L1745](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/app_gateway.py#L1693-L1745)
- **路由绑定与 stale 清理提升的运行时单元测试**
- tests/unit_tests/gateway/test_app_gateway_acp.py 含针对 GatewayServer 的运行时单元测试（测试存在但未在本次输入中执行）。test_gateway_server_binds_session_for_local_request_and_calls_hook 通过探针方法 handle_raw_message_public 喂入 /tui 路由的 config.get 请求，断言 session_bind_handler 以 ("tui", "sess-local") 被调用且后续 event 帧能路由回同一 ws；
  - test_gateway_server_promotes_pending_session_client_after_stale_owner_cleanup 验证绑定冲突返回 False 后，旧连接经 _connection_handler 清理时触发 disconnect_handler 并把 pending 新 ws 提升进 _session_to_client。
- Sources / 来源：[tests/unit_tests/gateway/test_app_gateway_acp.py:L572–L629](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/unit_tests/gateway/test_app_gateway_acp.py#L572-L629),
  - [tests/unit_tests/gateway/test_app_gateway_acp.py:L633–L668](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/unit_tests/gateway/test_app_gateway_acp.py#L633-L668)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/gateway-channels/feature-gateway-server-multi-route-ws.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-06；updated: 2026-10-07
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/app_gateway.py:L651-L680；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/app_gateway.py:L1040-L1052
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/app_gateway.py:L813-L847；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/app_gateway.py:L1618-L1644
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/app_gateway.py:L1060-L1066；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/app_gateway.py:L1078-L1092
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/app_gateway.py:L1094-L1105；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/app_gateway.py:L1107-L1148
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/app_gateway.py:L1572-L1592；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/app_gateway.py:L943-L978
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/app_gateway.py:L979-L1007；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/app_gateway.py:L1540-L1555
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/app_gateway.py:L1572-L1588；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/app_gateway.py:L1693-L1745
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/unit_tests/gateway/test_app_gateway_acp.py:L572-L629；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/unit_tests/gateway/test_app_gateway_acp.py:L633-L668
- 源页字段（feature）：gateway-server-multi-route-ws
- 入口（entry_points）：jiuwenswarm/gateway/app_gateway.py
- 源页字段（source_globs）：jiuwenswarm/gateway/app_gateway.py；jiuwenswarm/gateway/channel_manager/channel_manager.py；jiuwenswarm/gateway/routing/route_binding.py；jiuwenswarm/gateway/channel_manager/base.py；jiuwenswarm/gateway/routing/keys.py
