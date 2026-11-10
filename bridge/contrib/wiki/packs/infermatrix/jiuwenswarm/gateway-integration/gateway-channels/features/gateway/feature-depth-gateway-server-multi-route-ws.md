---
name: feature-depth-gateway-server-multi-route-ws
description: GatewayServer 实现深读：_send_frame_to_ws 守卫、_bind_route_session_client 返回值与 session_bind_handler、RouteConfig 默认值与 ws_channel 委托、_client_route_key 二元组兼容、广播回退与 dropped 日志、提升单测断言
metadata:
  scope: GatewayServer 的函数级实现与注释所述耦合；整体配置、回包契约和分发管线归 feature-gateway-server-multi-route-ws
---
# GatewayServer 多路由 WebSocket 宿主与会话/请求路由表：实现深读

## 现状

- [[feature-gateway-server-multi-route-ws]]（功能概览） · [[gateway-channels-overview]]（owner 入口）
- **_send_frame_to_ws 在发送前检查 ws 开合，序列化 frame 为 JSON 后经 ws.send 发送** 对带 channel_id/request_id/session_id 的 frame：_ws_is_open 要求 ws 非 None 且 closed 属性为假，否则直接返回 False；通过则 await ws.send(json.dumps(frame, ensure_ascii=False)) 并在本地返回 True。
- 来源：[jiuwenswarm/gateway/app_gateway.py:L900–L925](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/app_gateway.py#L900-L925)
- **_bind_route_session_client 返回 bool；session_bind_handler 可为同步或协程** 入参 (route: RouteConfig, session_id, ws)。session 键为 None、或存在其它未关闭 ws 时返回 False；成功写入映射返回 True。绑定成功且 existing_ws is not ws 且 route.session_bind_handler 非 None 时调用 handler(route.channel_id, session_id)，若结果是协程则 await；
  - 异常被捕获并记 warning，仍返回 True。
- 来源：[jiuwenswarm/gateway/app_gateway.py:L943–L977](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/app_gateway.py#L943-L977)
- **RouteConfig 默认值：空 frozenset、空 local_handlers、ws_channel=None 不委托** 每条路由（如 /acp、/cli）的 RouteConfig 中 forward_methods 与 forward_no_local_handler_methods 默认 frozenset()，local_handlers 默认空 dict，各 handler/interceptor 与 ws_channel 默认 None；ws_channel=None 表示该路由无需把 ws 委托注册进外部 Channel。
- 来源：[jiuwenswarm/gateway/app_gateway.py:L644–L663](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/app_gateway.py#L644-L663)
- **二元组兼容旧路径 vs 可选 agent_ref 第三维** 设计推断（非作者历史意图）：
- （推断）_client_route_key 保持不传 agent_ref 时返回二元组以兼容旧索引路径，收益是旧调用无需改动；代价是同一 session 下二元组键无法区分多个 agent_ref，需调用方显式传入第三维才能共存，规范化失败（ar_str 为空）时静默退回二元组。
- 来源：[jiuwenswarm/gateway/app_gateway.py:L785–L806](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/app_gateway.py#L785-L806)
- **运行时单测覆盖：绑定返回 False、断连后提升并回调 handler** test_gateway_server_promotes_pending_session_client_after_stale_owner_cleanup 断言 _bind_route_session_client 返回 False，await _connection_handler(old_ws, "/tui") 后 disconnected == [([("tui","sess-race")], [])]、rebound == [("tui","sess-race")]、
  - _session_to_client[("tui","sess-race")] is new_ws。未执行，仅引用现有断言。
- 来源：[tests/unit_tests/gateway/test_app_gateway_acp.py:L656–L668](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/unit_tests/gateway/test_app_gateway_acp.py#L656-L668)
- **RouteConfig 可选委托字段 ws_channel/session_bind_handler（默认 None）及注释所述的 Channel 委托耦合** RouteConfig 声明 session_bind_handler 与 ws_channel 两个可选字段，默认均为 None（app_gateway.py:656,662）。
  - 随字段注释说明：ws_channel 非 None 时 GatewayServer 仍作 ws 宿主与入站帧解析，但把 ws 与 RoutingKey 委托注册进该外部 Channel 的五维索引（_clients_by_key/_ws_by_id），出站按 delivery.ws_id 由 ChannelManager 派发到该 Channel.send；RoutingKey 即 (user_id, channel_id, app_id, agent_ref, session_id) 五维不可变键。该耦合为注释声明，非本段可执行代码。
- 来源：[jiuwenswarm/gateway/app_gateway.py:L656–L663](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/app_gateway.py#L656-L663),
  - [jiuwenswarm/gateway/routing/keys.py:L34–L44](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/routing/keys.py#L34-L44)
- **发送帧的受守卫失败返回 False；无路由 session_id 的 msg 走 elif 广播回退否则记 dropped 警告** _send_frame_to_ws 先用 _ws_is_open（ws 非 None 且 closed 属性为假）守卫，不开放则返回 False；ws.send 抛 ConnectionClosed 时记 info 日志并同样返回 False，不向上抛出（app_gateway.py:901-925）。
  - 出站路径中，在一个未展示前置分支的 elif 里，若 _extract_routing_session_id(msg, include_top_level=True) 取不到 session_id 且该 channel 有已注册 clients，则以 gather(..., return_exceptions=True) 广播后 return；否则继续落到 "message dropped: no WebSocket client found" 的 warning 日志（条件取自 msg 而非 frame，后续动作未在摘录中展示）。
- 来源：[jiuwenswarm/gateway/app_gateway.py:L901–L925](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/app_gateway.py#L901-L925),
  - [jiuwenswarm/gateway/app_gateway.py:L1227–L1246](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/app_gateway.py#L1227-L1246)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/gateway-channels/feature-depth-gateway-server-multi-route-ws.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-06；updated: 2026-10-06
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/app_gateway.py:L943-L977；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/unit_tests/gateway/test_app_gateway_acp.py:L656-L668
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/app_gateway.py:L644-L663；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/app_gateway.py:L785-L806
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/app_gateway.py:L900-L925；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/app_gateway.py:L656-L663
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/routing/keys.py:L34-L44；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/app_gateway.py:L901-L925
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/app_gateway.py:L1227-L1246
- 源页字段（feature）：gateway-server-multi-route-ws
- 入口（entry_points）：jiuwenswarm/gateway/app_gateway.py
- 源页字段（source_globs）：jiuwenswarm/gateway/app_gateway.py；jiuwenswarm/gateway/channel_manager/channel_manager.py；jiuwenswarm/gateway/routing/route_binding.py；jiuwenswarm/gateway/channel_manager/base.py；jiuwenswarm/gateway/routing/keys.py
