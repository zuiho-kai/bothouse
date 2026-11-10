---
name: feature-yuanrong-faas-invocation
description: YuanRong FaaS 函数调用：HTTP invoke 与 FakeWs 适配的双端结构、gateway.agent_client 配置项与默认值、非流式与 SSE 流式调用行为、线程桥接与共享槽位取舍、send_request 与 send_request_stream 入口
metadata:
  scope: 只收 FaaS 非流式与 SSE 流式调用的功能概览；send_request_stream 与配置的实现证据归 feature-depth-yuanrong-faas-invocation
---
# YuanRong FaaS 函数调用（非流式 + SSE 流式）

## 现状

- **HTTP invoke 与 FakeWs 适配的双端结构**
- 客户端把 E2AEnvelope `to_dict()` 直接作为 POST body 发往 `{frontend_endpoint}/serverless/v1/functions/{urn}/invocations`，仅覆盖 `is_stream` 区分流式/非流式，透传完整 channel_context。流式路径在后台线程读 SSE（按行解析 `data: ` 前缀，识别 `[DONE]`），经 `loop.call_soon_threadsafe` 写入 asyncio.Queue 供事件循环消费。
  - 服务端 clawee 用 `FakeWs`（仅实现 `send()` 收帧进队列）适配 `AgentWebSocketServer._handle_message`，使 faas 链路与 websocket 链路复用完全相同的处理代码：非流式取最后一帧解析为 unary 响应，流式并发跑 handler 与帧转发、逐帧写 `context.get_stream()`。clawee 还维护长生命周期事件循环避免跨循环绑定问题。
- Sources / 来源：[jiuwenswarm/extensions/yuanrong_frontend_client.py:L1549–L1562](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/extensions/yuanrong_frontend_client.py#L1549-L1562),
  - [jiuwenswarm/extensions/yuanrong_frontend_client.py:L1945–L1975](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/extensions/yuanrong_frontend_client.py#L1945-L1975),
  - [jiuwenswarm/extensions/clawee.py:L105–L117](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/extensions/clawee.py#L105-L117),
  - [jiuwenswarm/extensions/clawee.py:L233–L276](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/extensions/clawee.py#L233-L276)
- **gateway.agent_client 配置项与默认值**
- 注册由 `gateway.agent_client.type` 控制：非 "yuanrong"（默认 "websocket"）不注册；yuanrong 模式要求 `frontend_endpoint` 与 `function_version_urn` 非空，否则抛 ValueError。客户端参数及默认值：`concurrency`=1、`invoke_timeout_s`=60.0、`agent_timeout_s`=300.0、`agent_namespace`="default"。
  - 请求头方面，`X-Instance-Session` 携带 sessionID/sessionTTL/concurrency；当 user_id 去除首尾空白后非空时附加 `X-Session-Context: {"sessionCtx": <uid>}`，否则仅记一条 logger.info（非 warning 级别）日志且不加该 header——空白字符构成的 user_id 也会被省略该 header。
- Sources / 来源：[jiuwenswarm/extensions/agent_client/extension.py:L31–L57](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/extensions/agent_client/extension.py#L31-L57),
  - [jiuwenswarm/extensions/yuanrong_frontend_client.py:L1748–L1787](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/extensions/yuanrong_frontend_client.py#L1748-L1787)
- **调用行为与 faas 封装处理**
- 非流式与流式共用 `_build_invoke_payload`：以 `envelope.to_dict()` 透传（含 channel_context），仅覆盖 `is_stream`；流式额外设置 `Accept: text/event-stream`，服务端 clawee 按 `is_stream` 分流：非流式取最后一帧经 `parse_agent_server_wire_unary` 返回，流式逐帧写 `context.get_stream()`。
  - faas executor 的外层 `{"body", "innerCode"}` 封装（需含 body+innerCode 且非标准 AgentResponse 形状）由 `_normalize_faas_body` 剥离并二次解析，body 常是内层 JSON 字符串。`innerCode != "0"` 时错误码写入内层 dict 的 `_faas_error_code` 键；仅非流式解析的前两个分支（wire 解析成功或标准形状）把它复制进 metadata，最终兜底分支省略它，流式 chunk 则丢弃返回的错误码、只拷贝 chunk.metadata。
- Sources / 来源：[jiuwenswarm/extensions/yuanrong_frontend_client.py:L1553–L1562](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/extensions/yuanrong_frontend_client.py#L1553-L1562),
  - [jiuwenswarm/extensions/yuanrong_frontend_client.py:L1579–L1612](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/extensions/yuanrong_frontend_client.py#L1579-L1612),
  - [jiuwenswarm/extensions/yuanrong_frontend_client.py:L1650–L1695](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/extensions/yuanrong_frontend_client.py#L1650-L1695),
  - [jiuwenswarm/extensions/clawee.py:L233–L299](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/extensions/clawee.py#L233-L299)
- **线程桥接与共享槽位的取舍**
- Inference / 设计推断（非作者历史意图）：
- 复用 `AgentWebSocketServer._handle_message`（经 FakeWs 适配）让 faas 链路走同一处理入口（推断意图：减少双链路行为分叉；注释引用 docs/yuanrong.md 对齐方案），代价是直接依赖服务端私有属性 `_current_ws`/`_current_send_lock`。这些共享槽位在 finally 中被置 None 并清理 ACP capabilities（按 id(ws) 防 FakeWs 泄漏），但没有恢复调用前的上下文，也未对并发调用做隔离或串行化——并发 invoke 之间对这些共享槽位存在竞态风险。
  - 客户端侧则用后台线程读 SSE、经 `loop.call_soon_threadsafe` 写入 asyncio.Queue 做线程到事件循环的桥接，行缓冲保留不完整的最后一行以容忍分片。
- Sources / 来源：[jiuwenswarm/extensions/clawee.py:L226–L240](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/extensions/clawee.py#L226-L240),
  - [jiuwenswarm/extensions/clawee.py:L309–L316](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/extensions/clawee.py#L309-L316),
  - [jiuwenswarm/extensions/yuanrong_frontend_client.py:L1862–L1876](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/extensions/yuanrong_frontend_client.py#L1862-L1876),
  - [jiuwenswarm/extensions/yuanrong_frontend_client.py:L1963–L1975](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/extensions/yuanrong_frontend_client.py#L1963-L1975)
- **客户端调用入口：send_request 与 send_request_stream**
- `YuanrongFrontendAgentClient` 实现两条 FaaS 调用入口：`send_request(envelope)` 发送非流式请求，在内部线程执行 `_do_invoke`（`is_stream=False`），把 HTTP 响应体经 `_parse_invoke_response` 反解为 `AgentResponse`；调用抛出的 `YuanrongAgentApiError` 被捕获并转为 `ok=False`、`payload={"error": ...}` 的响应而非向上抛异常。
  - `send_request_stream(envelope)` 是异步生成器：`is_stream=True` 且请求头带 `Accept: text/event-stream`，由后台线程 `_do_invoke_stream` 逐行解析 SSE `data: ` 前缀，经 `loop.call_soon_threadsafe` 写入 asyncio.Queue，事件循环侧逐块 yield `AgentResponseChunk`，收到 `[DONE]` 或 "done" 后补发一个 `is_complete=True` 的空 chunk 收尾。
  - 两条路径共用 `_invoke_headers`：`X-Instance-Session` 携带 sessionID/sessionTTL/concurrency，user_id 非空时附加 `X-Session-Context`，并统一应用 trace 头。
- Sources / 来源：[jiuwenswarm/extensions/yuanrong_frontend_client.py:L1806–L1846](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/extensions/yuanrong_frontend_client.py#L1806-L1846),
  - [jiuwenswarm/extensions/yuanrong_frontend_client.py:L1848–L1914](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/extensions/yuanrong_frontend_client.py#L1848-L1914),
  - [jiuwenswarm/extensions/yuanrong_frontend_client.py:L1732–L1787](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/extensions/yuanrong_frontend_client.py#L1732-L1787)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/extensions-plugins/feature-yuanrong-faas-invocation.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-06；updated: 2026-10-07
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/extensions/yuanrong_frontend_client.py:L1549-L1562；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/extensions/yuanrong_frontend_client.py:L1945-L1975
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/extensions/clawee.py:L105-L117；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/extensions/clawee.py:L233-L276
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/extensions/agent_client/extension.py:L31-L57；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/extensions/yuanrong_frontend_client.py:L1748-L1787
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/extensions/yuanrong_frontend_client.py:L1553-L1562；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/extensions/yuanrong_frontend_client.py:L1579-L1612
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/extensions/yuanrong_frontend_client.py:L1650-L1695；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/extensions/clawee.py:L233-L299
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/extensions/clawee.py:L226-L240；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/extensions/clawee.py:L309-L316
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/extensions/yuanrong_frontend_client.py:L1862-L1876；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/extensions/yuanrong_frontend_client.py:L1963-L1975
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/extensions/yuanrong_frontend_client.py:L1806-L1846；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/extensions/yuanrong_frontend_client.py:L1848-L1914
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/extensions/yuanrong_frontend_client.py:L1732-L1787
- 源页字段（feature）：yuanrong-faas-invocation
- 入口（entry_points）：jiuwenswarm/extensions/yuanrong_frontend_client.py
- 源页字段（source_globs）：jiuwenswarm/extensions/yuanrong_frontend_client.py；jiuwenswarm/extensions/clawee.py；jiuwenswarm/extensions/agent_client/extension.py
